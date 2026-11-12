//! PowerShell generation. Static text lives in scripts/*.ps1; only validated,
//! quoted values are interpolated here. Output is pinned byte-for-byte by
//! tests/parity.rs against the original JavaScript generators.
use crate::catalog::{all_power_settings, network_keywords, wifi_keywords, CATALOG};
use crate::js::{array, get, get_str, is_integer, js_len, js_string, number_string};
use crate::ops::{
    allowed_operation, default_definitions, is_guid, is_intel_wifi_id, valid_service_value,
    valid_shortcut_value, valid_wifi_value,
};
use serde_json::Value;

pub const POWER_READ: &str = include_str!("../scripts/power-read.ps1");
pub const NETWORK_READ: &str = include_str!("../scripts/network-read.ps1");
const WIFI_READ: &str = include_str!("../scripts/wifi-read.ps1");
pub const KEYBOARD_READ: &str = include_str!("../scripts/keyboard-read.ps1");
pub const SERVICE_READ: &str = include_str!("../scripts/service-read.ps1");
pub const SECURITY_READ: &str = include_str!("../scripts/security-read.ps1");
pub const MEMORY_INTEGRITY_GUARD: &str = include_str!("../scripts/memory-integrity-guard.ps1");
pub const CHECKUP: &str = include_str!("../scripts/checkup.ps1");
pub const SYSTEM: &str = include_str!("../scripts/system.ps1");
const GRAPHICS: &str = include_str!("../scripts/graphics.ps1");
const PING: &str = include_str!("../scripts/ping.ps1");
const APP_SNAPSHOT: &str = include_str!("../scripts/app-snapshot.ps1");
const CAPABILITIES: &str = include_str!("../scripts/capabilities.ps1");

pub fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn q(v: Option<&Value>) -> String {
    ps_quote(&js_string(v))
}

fn quoted_list(items: &[String]) -> String {
    items
        .iter()
        .map(|s| ps_quote(s))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn wifi_read_prelude() -> String {
    WIFI_READ.replace("__RANKLY_WIFI_KEYWORDS__", &quoted_list(&wifi_keywords()))
}

pub fn capabilities_script() -> String {
    let reads = all_power_settings()
        .iter()
        .map(|s| {
            let (g, o) = (ps_quote(&s.subgroup), ps_quote(&s.setting));
            format!("[uint32]$value=0; $result=[RanklyPowerReader]::Read($plan,{g},{o},[ref]$value); @{{scheme=$plan;subgroup={g};setting={o};value=$value;available=($result -eq 0)}}")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let keyboard = CATALOG
        .keyboard_shortcuts
        .iter()
        .map(|n| format!("Get-RanklyKeyboardShortcut {}", ps_quote(n)))
        .collect::<Vec<_>>()
        .join("\n");
    // Fill data lists before inserting preludes so prelude text is never rescanned.
    CAPABILITIES
        .replace("__RANKLY_POWER_READS__", &reads)
        .replace(
            "__RANKLY_NETWORK_KEYWORDS__",
            &quoted_list(&network_keywords()),
        )
        .replace("__RANKLY_WIFI_KEYWORDS__", &quoted_list(&wifi_keywords()))
        .replace(
            "__RANKLY_LEAN_SERVICES__",
            &quoted_list(&CATALOG.lean_services),
        )
        .replace("__RANKLY_KEYBOARD_READS__", &keyboard)
        .replace("__RANKLY_POWER_READ_PRELUDE__", POWER_READ)
        .replace("__RANKLY_SECURITY_READ_PRELUDE__", SECURITY_READ)
        .replace("__RANKLY_WIFI_READ_PRELUDE__", &wifi_read_prelude())
        .replace("__RANKLY_KEYBOARD_READ_PRELUDE__", KEYBOARD_READ)
}

pub fn graphics_script(report_path: &str) -> String {
    GRAPHICS.replace("__RANKLY_REPORT_PATH__", &ps_quote(report_path))
}

pub fn ping_script(target: &str) -> Result<String, String> {
    let ip = match target {
        "cloudflare" => "1.1.1.1",
        "google" => "8.8.8.8",
        "quad9" => "9.9.9.9",
        _ => return Err("Choose one of the available test endpoints.".into()),
    };
    Ok(PING.replace("__RANKLY_PING_TARGET__", &ps_quote(ip)))
}

pub fn app_snapshot_script() -> String {
    let filter = CATALOG
        .background_apps
        .iter()
        .flat_map(|a| a.executables.iter())
        .map(|n| format!("Name='{n}'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    APP_SNAPSHOT.replace("__RANKLY_PROCESS_FILTER__", &ps_quote(&filter))
}

fn any_type(ops: &[Value], t: &str) -> bool {
    ops.iter().any(|o| get_str(o, "type") == Some(t))
}

pub fn build_read_script(operations: &[Value]) -> Result<String, String> {
    let defs = default_definitions();
    let mut statements = Vec::new();
    for o in operations {
        let s = match get_str(o, "type") {
            Some("wifi-property") => {
                if !allowed_operation(o, &defs) {
                    return Err("Wi-Fi setting is not in the tweak allowlist.".into());
                }
                format!("(Get-RanklySavedWifiSetting {} {} {}).snapshot", q(get(o, "adapter")), q(get(o, "deviceId")), q(get(o, "keyword")))
            }
            Some("keyboard-shortcut") => {
                if !allowed_operation(o, &defs) {
                    return Err("Keyboard shortcut is not in the tweak allowlist.".into());
                }
                format!("Get-RanklyKeyboardShortcut {}", q(get(o, "name")))
            }
            Some("service") => {
                if !allowed_operation(o, &defs) {
                    return Err("Service is not in the tweak allowlist.".into());
                }
                format!("Get-RanklyServiceSnapshot {}", q(get(o, "name")))
            }
            Some("power") => "$text=(& powercfg.exe /getactivescheme | Out-String); if ($LASTEXITCODE -ne 0) { throw 'Cannot read active power plan' }; $match=[regex]::Match($text,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}'); if (!$match.Success) { throw 'Cannot identify active power plan' }; @{type='power';value=$match.Value.ToLower()}".to_string(),
            Some("power-setting") => {
                let (s, g, k) = (q(get(o, "scheme")), q(get(o, "subgroup")), q(get(o, "setting")));
                format!("[uint32]$value=0; $result=[RanklyPowerReader]::Read({s},{g},{k},[ref]$value); if ($result -ne 0) {{ throw 'A saved power setting is unavailable in this plan.' }}; @{{type='power-setting';scheme={s};subgroup={g};setting={k};value=$value}}")
            }
            Some("network") => {
                let (a, k) = (q(get(o, "adapter")), q(get(o, "keyword")));
                format!("$property=Get-RanklyNetworkProperty {a} {k}; @{{type='network';adapter={a};keyword={k};value=@($property.RegistryValue | ForEach-Object {{ [string]$_ }})}}")
            }
            Some("registry") => {
                let (p, n) = (q(get(o, "path")), q(get(o, "name")));
                format!("$key=Get-Item -LiteralPath {p} -ErrorAction SilentlyContinue; if ($null -ne $key -and $key.GetValueNames() -contains {n}) {{ @{{type='registry';path={p};name={n};exists=$true;value=$key.GetValue({n},$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$key.GetValueKind({n}).ToString()}} }} else {{ @{{type='registry';path={p};name={n};exists=$false}} }}")
            }
            _ => return Err("Unknown setting type.".into()),
        };
        statements.push(s);
    }
    let mut script = String::new();
    if any_type(operations, "wifi-property") {
        script += &wifi_read_prelude();
    }
    if any_type(operations, "keyboard-shortcut") {
        script += KEYBOARD_READ;
    }
    if any_type(operations, "service") {
        script += SERVICE_READ;
    }
    if any_type(operations, "power-setting") {
        script += POWER_READ;
    }
    if any_type(operations, "network") {
        script += NETWORK_READ;
    }
    script += &format!(
        "\n$result=@(\n{}\n)\nConvertTo-Json -InputObject @($result) -Depth 8 -Compress",
        statements.join("\n")
    );
    Ok(script)
}

fn wifi_write_script(o: &Value) -> Result<String, String> {
    if !is_intel_wifi_id(get(o, "deviceId")) || !valid_wifi_value(Some(o)) {
        return Err("Invalid Wi-Fi setting snapshot.".into());
    }
    let value = q(array(get(o, "value")).and_then(|v| v.first()));
    let label = ps_quote(get_str(o, "label").unwrap_or_default().trim());
    let require_up = if get(o, "requireUp") == Some(&Value::Bool(true)) {
        "if (!$wifi.snapshot.up) { throw 'The selected Wi-Fi adapter is no longer connected. Scan again before applying.' }"
    } else {
        ""
    };
    Ok(format!(
        "\n$wifi=Get-RanklySavedWifiSetting {} {} {}\n{require_up}\n$choice=@($wifi.snapshot.choices | Where-Object {{ $_.value -ceq {value} -and $_.label -ieq {label} }})\nif ($choice.Count -ne 1) {{ throw 'The Wi-Fi driver choices changed. No replacement value was guessed; the backup has been kept.' }}\nif ($wifi.snapshot.value[0] -cne {value}) {{\n  Set-NetAdapterAdvancedProperty -InputObject $wifi.property -RegistryValue @({value}) -NoRestart -ErrorAction Stop | Out-Null\n}}\n",
        q(get(o, "adapter")),
        q(get(o, "deviceId")),
        q(get(o, "keyword"))
    ))
}

fn service_write_script(o: &Value) -> Result<String, String> {
    let name = get_str(o, "name").unwrap_or_default();
    let v = get(o, "value");
    if !CATALOG.lean_services.iter().any(|s| s == name) || !valid_service_value(v) {
        return Err("Unsupported service snapshot.".into());
    }
    let v = v.unwrap();
    let running = get(v, "running") == Some(&Value::Bool(true));
    let startup_code = get(v, "startup").and_then(Value::as_f64).unwrap_or(0.0) as i64;
    let startup = match startup_code {
        2 => "Automatic",
        3 => "Manual",
        _ => "Disabled",
    };
    let qn = ps_quote(name);
    let delay_path = ps_quote(&format!(
        "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\{name}"
    ));
    let dependency = if running {
        "if ([string]$svc.Status -ne 'Running' -and @($svc.ServicesDependedOn | Where-Object Status -ne 'Running').Count) { throw 'A required service is stopped. Start it in Windows before restoring this backup.' }".to_string()
    } else {
        "if ([string]$svc.Status -ne 'Stopped' -and @($svc.DependentServices | Where-Object Status -ne 'Stopped').Count) { throw 'Another service depends on this one. No dependent services were stopped.' }".to_string()
    };
    let state = if running {
        let temporary = if startup_code == 4 { "Manual" } else { startup };
        format!("if ([string]$svc.Status -ne 'Running') {{\n  Set-Service -Name {qn} -StartupType {temporary} -ErrorAction Stop\n  Start-Service -Name {qn} -ErrorAction Stop\n  $svc.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(15))\n}}\nSet-Service -Name {qn} -StartupType {startup} -ErrorAction Stop")
    } else {
        format!("Set-Service -Name {qn} -StartupType {startup} -ErrorAction Stop\nif ([string]$svc.Status -ne 'Stopped') {{\n  Stop-Service -Name {qn} -ErrorAction Stop\n  $svc.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(15))\n}}")
    };
    let delayed = get(v, "delayed").unwrap();
    let delay = if get(delayed, "exists") == Some(&Value::Bool(true)) {
        let value = get(delayed, "value")
            .map(|x| js_string(Some(x)))
            .unwrap_or_default();
        format!("New-ItemProperty -LiteralPath {delay_path} -Name 'DelayedAutoStart' -PropertyType DWord -Value {value} -Force -ErrorAction Stop | Out-Null")
    } else {
        format!("Remove-ItemProperty -LiteralPath {delay_path} -Name 'DelayedAutoStart' -ErrorAction SilentlyContinue")
    };
    Ok(format!(
        "\n$svc=Get-Service -Name {qn} -ErrorAction Stop\n$svc.Refresh()\nif ([string]$svc.Status -notin @('Running','Stopped')) {{ throw 'The service is changing state. Retry recovery when it settles.' }}\n{dependency}\n{state}\n{delay}\n"
    ))
}

fn registry_value(o: &Value) -> Result<String, String> {
    let value = get(o, "value");
    let n = value.and_then(Value::as_f64);
    match get_str(o, "kind") {
        Some("DWord") => {
            let ok = is_integer(value)
                && n.is_some_and(|f| (-2_147_483_648.0..=4_294_967_295.0).contains(&f));
            if !ok {
                return Err("Invalid DWORD.".into());
            }
            let f = n.unwrap();
            let shown = if f > 2_147_483_647.0 {
                (f - 4_294_967_296.0) as i64
            } else {
                f as i64
            };
            Ok(format!("([int]{shown})"))
        }
        Some("QWord") => {
            let ok = is_integer(value) && n.is_some_and(|f| f.abs() <= 9_007_199_254_740_991.0);
            if !ok {
                return Err("Cannot safely restore this QWORD.".into());
            }
            Ok(format!(
                "([long]{})",
                value
                    .and_then(Value::as_number)
                    .map(number_string)
                    .unwrap_or_default()
            ))
        }
        Some("Binary") => {
            let items = array(value).filter(|items| {
                items.iter().all(|v| {
                    is_integer(Some(v)) && v.as_f64().is_some_and(|f| (0.0..=255.0).contains(&f))
                })
            });
            let Some(items) = items else {
                return Err("Invalid binary value.".into());
            };
            Ok(format!(
                "([byte[]]@({}))",
                items
                    .iter()
                    .map(|v| js_string(Some(v)))
                    .collect::<Vec<_>>()
                    .join(",")
            ))
        }
        Some("MultiString") => {
            let items = array(value).filter(|items| items.iter().all(Value::is_string));
            let Some(items) = items else {
                return Err("Invalid multi-string.".into());
            };
            Ok(format!(
                "([string[]]@({}))",
                items
                    .iter()
                    .map(|v| ps_quote(v.as_str().unwrap()))
                    .collect::<Vec<_>>()
                    .join(",")
            ))
        }
        _ => match value {
            Some(Value::String(s)) => Ok(ps_quote(s)),
            _ => Err("Invalid string.".into()),
        },
    }
}

pub fn build_write_script(operations: &[Value]) -> Result<String, String> {
    let defs = default_definitions();
    let mut parts = Vec::new();
    for o in operations {
        if crate::js::truthy(get(o, "transform")) {
            return Err("Resolve the preference change before writing.".into());
        }
        let ty = get_str(o, "type");
        if ty == Some("power") {
            if !is_guid(get(o, "value")) {
                return Err("Invalid power plan.".into());
            }
            parts.push(format!("& powercfg.exe /setactive {} | Out-Null; if ($LASTEXITCODE -ne 0) {{ throw 'Windows could not activate this power plan. It may be unavailable or managed.' }}", q(get(o, "value"))));
            continue;
        }
        if !allowed_operation(o, &defs) {
            return Err("Setting is not in the tweak allowlist.".into());
        }
        let part = match ty {
            Some("wifi-property") => wifi_write_script(o)?,
            Some("keyboard-shortcut") => {
                if !valid_shortcut_value(get(o, "value")) {
                    return Err("Invalid keyboard shortcut flags.".into());
                }
                format!(
                    "[RanklyKeyboard]::Write({},[uint32]{})",
                    q(get(o, "name")),
                    js_string(get(o, "value"))
                )
            }
            Some("service") => service_write_script(o)?,
            Some("power-setting") => {
                let value = get(o, "value");
                let ok = is_integer(value)
                    && value
                        .and_then(Value::as_f64)
                        .is_some_and(|f| (0.0..=4_294_967_295.0).contains(&f));
                if !ok {
                    return Err("Invalid power setting value.".into());
                }
                format!(
                    "& powercfg.exe /setacvalueindex {} {} {} {} | Out-Null; if ($LASTEXITCODE -ne 0) {{ throw 'Windows could not change this power setting.' }}",
                    q(get(o, "scheme")),
                    q(get(o, "subgroup")),
                    q(get(o, "setting")),
                    js_string(value)
                )
            }
            Some("network") => {
                let items = array(get(o, "value")).filter(|v| {
                    !v.is_empty()
                        && v.len() <= 16
                        && v.iter()
                            .all(|x| x.as_str().is_some_and(|s| js_len(s) <= 256))
                });
                let Some(items) = items else {
                    return Err("Invalid network property value.".into());
                };
                let values = items
                    .iter()
                    .map(|v| ps_quote(v.as_str().unwrap()))
                    .collect::<Vec<_>>()
                    .join(",");
                format!(
                    "$property=Get-RanklyNetworkProperty {} {}; Set-NetAdapterAdvancedProperty -InputObject $property -RegistryValue @({values}) -NoRestart -ErrorAction Stop | Out-Null",
                    q(get(o, "adapter")),
                    q(get(o, "keyword"))
                )
            }
            _ => {
                let (p, n) = (q(get(o, "path")), q(get(o, "name")));
                if get(o, "exists") == Some(&Value::Bool(false)) {
                    format!("if (Test-Path -LiteralPath {p}) {{ Remove-ItemProperty -LiteralPath {p} -Name {n} -ErrorAction SilentlyContinue }}")
                } else {
                    let kind = get_str(o, "kind").unwrap_or_default();
                    if ![
                        "String",
                        "ExpandString",
                        "DWord",
                        "QWord",
                        "Binary",
                        "MultiString",
                    ]
                    .contains(&kind)
                    {
                        return Err("Unsupported registry value type.".into());
                    }
                    let value = registry_value(o)?;
                    format!("if (!(Test-Path -LiteralPath {p})) {{ New-Item -Path {p} -Force | Out-Null }}; New-ItemProperty -LiteralPath {p} -Name {n} -PropertyType {kind} -Value {value} -Force | Out-Null")
                }
            }
        };
        parts.push(part);
    }
    let memory = operations.iter().any(|o| {
        get_str(o, "type") == Some("registry")
            && get_str(o, "path") == Some(CATALOG.memory_integrity_path.as_str())
    });
    let mut script = String::new();
    if any_type(operations, "wifi-property") {
        script += &wifi_read_prelude();
    }
    if any_type(operations, "keyboard-shortcut") {
        script += KEYBOARD_READ;
    }
    if memory {
        script += SECURITY_READ;
        script += MEMORY_INTEGRITY_GUARD;
    }
    if any_type(operations, "network") {
        script += NETWORK_READ;
    }
    script += &parts.join("\n");
    if any_type(operations, "power-setting") {
        script += "\n$text=(& powercfg.exe /getactivescheme | Out-String); if ($LASTEXITCODE -ne 0) { throw 'Cannot refresh power settings.' }; $plan=[regex]::Match($text,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value; if (!$plan) { throw 'Cannot identify the active plan.' }; & powercfg.exe /setactive $plan | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Cannot activate the changed power settings.' }";
    }
    script += "\nConvertTo-Json -InputObject @{ success=$true } -Compress";
    Ok(script)
}

/// Builds the script that ends previously scanned background-app processes.
pub fn close_apps_script(processes: &[Value]) -> Result<String, String> {
    if processes.is_empty()
        || processes.len() > 1024
        || processes.iter().any(|p| !crate::apps::valid_process(p))
    {
        return Err("Invalid app snapshot.".into());
    }
    let blocks = processes
        .iter()
        .map(|p| {
            let pid = js_string(get(p, "pid"));
            format!(
                "\n$proc=$null\ntry {{\n  $proc=[System.Diagnostics.Process]::GetProcessById({pid})\n  $null=$proc.Handle\n  if($proc.SessionId -ne $sessionId -or $proc.StartTime.ToUniversalTime().Ticks.ToString() -cne {started} -or $proc.MainModule.FileName -ine {path}) {{ @{{status='skipped'}} }}\n  else {{\n    $cim=Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}' -ErrorAction Stop\n    $owner=Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop\n    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $ownerSid) {{ @{{status='skipped'}} }}\n    else {{\n      $proc.Kill()\n      if(!$proc.WaitForExit(2000)) {{ @{{status='failed'}} }} else {{ @{{status='closed'}} }}\n    }}\n  }}\n}} catch [System.ArgumentException] {{ @{{status='skipped'}} }}\ncatch {{ @{{status='failed'}} }}\nfinally {{if($null -ne $proc) {{$proc.Dispose()}}}}\n",
                started = q(get(p, "started")),
                path = q(get(p, "path"))
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!(
        "\n$sessionId=(Get-Process -Id $PID).SessionId\n$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$results=@(\n{blocks}\n)\n@{{closedProcesses=@($results | Where-Object status -eq 'closed').Count;skippedProcesses=@($results | Where-Object status -eq 'skipped').Count;failedProcesses=@($results | Where-Object status -eq 'failed').Count}} | ConvertTo-Json -Compress\n"
    ))
}
