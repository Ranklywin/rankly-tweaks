//! Real PowerShell, no real settings: writes go to a disposable HKCU subkey
//! by rebinding the HKCU/HKLM drives inside the test's PowerShell process.
#![cfg(windows)]
use rankly_tweaks_lib::catalog::validate_tweak_ids;
use rankly_tweaks_lib::ops::operations_for;
use rankly_tweaks_lib::ps;
use rankly_tweaks_lib::scripts::{build_read_script, build_write_script, ps_quote, CHECKUP};
use rankly_tweaks_lib::system;
use serde_json::{json, Value};
use std::time::Duration;

#[test]
fn generated_registry_scripts_apply_and_restore_in_an_isolated_key() {
    let root = format!(
        "HKEY_CURRENT_USER\\Software\\RanklyNativeTest-{}",
        uuid::Uuid::new_v4()
    );
    let registry = format!("Registry::{root}");
    let ids = json!([
        "gaming-optimization",
        "mouse-acceleration",
        "gpu-scheduling",
        "background-apps",
        "update-bandwidth",
        "windowed-gaming",
        "browser-background",
        "onedrive-off"
    ]);
    let after: Vec<Value> = operations_for(&validate_tweak_ids(&ids).unwrap(), &json!({}))
        .unwrap()
        .into_iter()
        .map(|mut o| {
            o.as_object_mut().unwrap().shift_remove("transform");
            o["exists"] = json!(true);
            o
        })
        .collect();
    let before: Vec<Value> = after
        .iter()
        .enumerate()
        .map(|(i, o)| {
            if i == 0 {
                let mut o = o.clone();
                o["value"] = json!("Original string");
                o["kind"] = json!("String");
                o
            } else {
                json!({"type":"registry","path":o["path"],"name":o["name"],"exists":false})
            }
        })
        .collect();
    let (write_before, read, write_after) = (
        build_write_script(&before).unwrap(),
        build_read_script(&after).unwrap(),
        build_write_script(&after).unwrap(),
    );
    let script = format!(
        r#"
$testRoot={tr}
New-Item -Path $testRoot -Force | Out-Null
try {{
  Remove-PSDrive -Name HKCU
  New-PSDrive -Name HKCU -PSProvider Registry -Root {r} | Out-Null
  Remove-PSDrive -Name HKLM
  New-PSDrive -Name HKLM -PSProvider Registry -Root {r} | Out-Null
  $null = & {{ {write_before} }}
  New-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\GameBar' -Name 'UnrelatedValue' -Value 'Keep me' -PropertyType String | Out-Null
  $original = & {{ {read} }} | ConvertFrom-Json
  $null = & {{ {write_after} }}
  $configured = & {{ {read} }} | ConvertFrom-Json
  $unrelated = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\GameBar').UnrelatedValue
  $null = & {{ {write_before} }}
  $restored = & {{ {read} }} | ConvertFrom-Json
  @{{ original=@($original); configured=@($configured); restored=@($restored); unrelated=$unrelated }} | ConvertTo-Json -Depth 8 -Compress
}} finally {{
  Remove-PSDrive -Name HKCU -ErrorAction SilentlyContinue
  Remove-PSDrive -Name HKLM -ErrorAction SilentlyContinue
  if ($testRoot -notmatch '^Registry::HKEY_CURRENT_USER\\Software\\RanklyNativeTest-[a-f0-9-]+$') {{ throw 'Test cleanup target escaped its registry namespace.' }}
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}}"#,
        tr = ps_quote(&registry),
        r = ps_quote(&root)
    );
    let out = ps::run(&script, Duration::from_secs(60)).unwrap();
    assert_eq!(out["unrelated"], "Keep me");
    assert_eq!(out["original"], out["restored"]);
    assert_eq!(out["configured"][0]["kind"], "DWord");
    assert_eq!(out["configured"][0]["value"], 1);
    let configured = out["configured"].as_array().unwrap();
    let mouse = configured
        .iter()
        .find(|o| o["name"] == "MouseSpeed")
        .unwrap();
    assert_eq!(
        (mouse["kind"].as_str(), mouse["value"].as_str()),
        (Some("String"), Some("0"))
    );
    assert_eq!(
        configured
            .iter()
            .find(|o| o["name"] == "HwSchMode")
            .unwrap()["value"],
        2
    );
}

#[test]
fn errors_from_powershell_are_reported_and_output_is_parsed() {
    assert_eq!(
        ps::run("throw 'Exact message'", Duration::from_secs(30)).unwrap_err(),
        "Exact message"
    );
    assert_eq!(
        ps::run(
            "ConvertTo-Json -InputObject @{a='é';b=@(1,2)} -Compress",
            Duration::from_secs(30)
        )
        .unwrap(),
        json!({"a":"é","b":[1,2]})
    );
    assert!(ps::run("'not json'", Duration::from_secs(30))
        .unwrap_err()
        .contains("unreadable"));
    assert!(ps::run("Start-Sleep -Seconds 20", Duration::from_secs(2))
        .unwrap_err()
        .contains("timed out"));
}

/// Read-only: discovery, scan, system info, and checkup on this PC.
#[test]
#[ignore = "reads this PC; run with --ignored"]
fn read_only_scans_work_on_this_pc() {
    let run: &system::Runner = &system::powershell;
    let context = system::capabilities(run).unwrap();
    assert!(context["build"].as_u64().unwrap() > 10000);
    let states = system::scan_settings(run).unwrap();
    assert!(states.as_object().unwrap().len() >= 28);
    assert!(states
        .as_object()
        .unwrap()
        .values()
        .all(|s| s.get("available").is_some()));
    let info = system::system_info(run, true).unwrap();
    assert!(info["cpu"].is_string());
    let raw = ps::run(CHECKUP, Duration::from_secs(60)).unwrap();
    assert!(raw["memory"].is_array());
}
