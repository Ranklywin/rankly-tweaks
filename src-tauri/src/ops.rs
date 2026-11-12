//! Port of shared/operations.mjs and the small settings modules it used.
//! Behavior is pinned by tests/parity.rs against the original JavaScript.
use crate::catalog::{
    game_preference_recovery, RegSetting, Tweak, WifiSetting, CATALOG, GAME_GPU_ID,
};
use crate::js::{array, get, get_str, is_integer, js_len, js_string, json_eq, strict_eq, truthy};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

static GUID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$").unwrap());
static INTEL_WIFI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^PCI\\VEN_8086&DEV_[0-9A-F]{4}(?:&|\\)").unwrap());
static WIFI_ID_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^[a-z0-9_&\\.\-]+$").unwrap());
static SCALAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,10}$").unwrap());
static CONTROL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\x00-\x1f]").unwrap());
static PRO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(Professional|Enterprise|Education|IoTEnterprise)").unwrap()
});
static X3D: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)X3D").unwrap());
static DRIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z]:\\").unwrap());
static EXE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.exe$").unwrap());
static BAD_PART: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[\x00-\x1f<>:"/|?*]"#).unwrap());
static TRAILING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ .]$").unwrap());
static RESERVED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)").unwrap());

pub fn is_guid(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| GUID.is_match(s))
}

// --- Wi-Fi (shared/wifi-settings.mjs) ---------------------------------------------

fn scalar(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str)
        .is_some_and(|s| SCALAR.is_match(s) && s.parse::<u64>().is_ok_and(|n| n <= 4_294_967_295))
}

pub fn is_intel_wifi_id(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str)
        .is_some_and(|s| js_len(s) <= 512 && INTEL_WIFI.is_match(s) && WIFI_ID_CHARS.is_match(s))
}

pub fn wifi_label(v: Option<&Value>) -> String {
    v.and_then(Value::as_str)
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default()
}

pub fn valid_wifi_value(o: Option<&Value>) -> bool {
    let Some(o) = o else { return false };
    let Some(values) = array(get(o, "value")) else {
        return false;
    };
    let Some(label) = get_str(o, "label") else {
        return false;
    };
    values.len() == 1
        && scalar(values.first())
        && !label.trim().is_empty()
        && js_len(label) <= 128
        && !CONTROL.is_match(label)
}

pub fn wifi_target(setting: &WifiSetting, property: &Value) -> Option<Value> {
    if !truthy(Some(property))
        || get_str(property, "keyword") != Some(setting.keyword.as_str())
        || !is_intel_wifi_id(get(property, "deviceId"))
        || get(property, "available") != Some(&Value::Bool(true))
        || get(property, "up") != Some(&Value::Bool(true))
        || !valid_wifi_value(Some(property))
    {
        return None;
    }
    let choices = array(get(property, "choices"))?;
    if choices.len() < 2
        || choices.len() > 16
        || choices.iter().any(|c| {
            !truthy(Some(c))
                || !scalar(get(c, "value"))
                || !valid_wifi_value(Some(
                    &json!({"value":[get(c,"value")], "label": get(c,"label")}),
                ))
        })
    {
        return None;
    }
    let values: HashSet<String> = choices.iter().map(|c| js_string(get(c, "value"))).collect();
    let labels: HashSet<String> = choices
        .iter()
        .map(|c| wifi_label(get(c, "label")))
        .collect();
    if values.len() != choices.len() || labels.len() != choices.len() {
        return None;
    }
    let current = array(get(property, "value")).and_then(|v| v.first());
    if !choices.iter().any(|c| {
        strict_eq(get(c, "value"), current)
            && wifi_label(get(c, "label")) == wifi_label(get(property, "label"))
    }) {
        return None;
    }
    let target = setting.target.trim().to_lowercase();
    choices
        .iter()
        .find(|c| wifi_label(get(c, "label")) == target)
        .cloned()
}

// --- Keyboard (shared/keyboard-settings.mjs) --------------------------------------

pub fn valid_shortcut_value(v: Option<&Value>) -> bool {
    is_integer(v)
        && v.and_then(Value::as_f64)
            .is_some_and(|f| [0.0, 4.0, 8.0, 12.0].contains(&f))
}

pub fn keyboard_availability(context: &Value) -> String {
    let Some(values) = array(get(context, "keyboardShortcuts")) else {
        return "Windows keyboard shortcut support could not be verified".into();
    };
    let verified = |name: &str| {
        values.iter().any(|s| {
            get_str(s, "name") == Some(name)
                && get(s, "available") == Some(&Value::Bool(true))
                && get(s, "active").is_some_and(Value::is_boolean)
                && valid_shortcut_value(get(s, "value"))
        })
    };
    if CATALOG.keyboard_shortcuts.iter().any(|n| !verified(n)) {
        return "Windows keyboard shortcut support could not be verified".into();
    }
    if values.iter().any(|s| {
        get_str(s, "name").is_some_and(|n| CATALOG.keyboard_shortcuts.iter().any(|k| k == n))
            && truthy(get(s, "active"))
    }) {
        return "Preserves active Sticky Keys, Toggle Keys, or Filter Keys".into();
    }
    String::new()
}

// --- Services (shared/aggressive.mjs) ---------------------------------------------

pub fn valid_service_value(v: Option<&Value>) -> bool {
    let Some(v) = v.filter(|v| truthy(Some(v))) else {
        return false;
    };
    let startup = get(v, "startup").and_then(Value::as_f64);
    let Some(delayed) = get(v, "delayed").filter(|d| truthy(Some(d))) else {
        return false;
    };
    let Some(exists) = get(delayed, "exists").and_then(Value::as_bool) else {
        return false;
    };
    startup.is_some_and(|s| [2.0, 3.0, 4.0].contains(&s))
        && get(v, "running").is_some_and(Value::is_boolean)
        && (!exists
            || (get_str(delayed, "kind") == Some("DWord")
                && get(delayed, "value")
                    .and_then(Value::as_f64)
                    .is_some_and(|d| d == 0.0 || d == 1.0)))
}

fn field<'a>(v: Option<&'a Value>, k: &str) -> Option<&'a Value> {
    v.and_then(|v| get(v, k))
}

pub fn equal_service_value(expected: Option<&Value>, actual: Option<&Value>) -> bool {
    if !strict_eq(field(expected, "startup"), field(actual, "startup"))
        || !strict_eq(field(expected, "running"), field(actual, "running"))
    {
        return false;
    }
    let Some(ed) = field(expected, "delayed").filter(|d| truthy(Some(d))) else {
        return true;
    };
    let ad = field(actual, "delayed");
    if !strict_eq(get(ed, "exists"), ad.and_then(|d| get(d, "exists"))) {
        return false;
    }
    if !truthy(get(ed, "exists")) {
        return true;
    }
    strict_eq(get(ed, "kind"), ad.and_then(|d| get(d, "kind")))
        && strict_eq(get(ed, "value"), ad.and_then(|d| get(d, "value")))
}

// --- Game preferences (shared/game-preferences.mjs) -------------------------------

pub fn is_local_game_executable(v: Option<&Value>) -> bool {
    let Some(s) = v.and_then(Value::as_str) else {
        return false;
    };
    if js_len(s) > 16383 || !DRIVE.is_match(s) || !EXE.is_match(s) {
        return false;
    }
    let rest: String = s.chars().skip(3).collect();
    let parts: Vec<&str> = rest.split('\\').collect();
    !parts.is_empty()
        && parts.iter().all(|p| {
            !p.is_empty()
                && !BAD_PART.is_match(p)
                && !TRAILING.is_match(p)
                && *p != "."
                && *p != ".."
                && !RESERVED.is_match(p)
        })
}

pub fn game_preference_definition(path: &str) -> Tweak {
    let name = path.rsplit('\\').next().unwrap_or(path);
    Tweak {
        name: format!("{name} · High performance GPU"),
        game_path: Some(path.to_string()),
        operations: Some(vec![RegSetting {
            path: CATALOG.game_gpu_registry.clone(),
            name: path.to_string(),
            kind: "String".into(),
            value: json!("GpuPreference=2;"),
            transform: Some("semicolon".into()),
        }]),
        ..game_preference_recovery()
    }
}

fn is_game_preference_operation(o: &Value) -> bool {
    get_str(o, "type") == Some("registry")
        && get_str(o, "path") == Some(CATALOG.game_gpu_registry.as_str())
        && is_local_game_executable(get(o, "name"))
}

pub fn game_recovery_definitions(entry: &Value) -> Result<Option<Vec<Tweak>>, String> {
    let Some(ids) = array(get(entry, "ids")) else {
        return Ok(None);
    };
    if !ids.iter().any(|i| i.as_str() == Some(GAME_GPU_ID)) {
        return Ok(None);
    }
    let format_ok = get(entry, "format").and_then(Value::as_f64) == Some(2.0);
    if !format_ok || ids.len() != 1 || !is_local_game_executable(get(entry, "gamePath")) {
        return Err("The game preference backup has an invalid target.".into());
    }
    Ok(Some(vec![game_preference_definition(
        get_str(entry, "gamePath").unwrap_or_default(),
    )]))
}

// --- Security (shared/security-settings.mjs) --------------------------------------

fn security_availability(t: &Tweak, context: &Value) -> String {
    if t.hardware.as_deref() == Some("memory-integrity") {
        let mi = get(context, "memoryIntegrity");
        if truthy(mi.and_then(|m| get(m, "available"))) {
            return String::new();
        }
        let reason = mi.and_then(|m| get(m, "reason"));
        return if truthy(reason) {
            js_string(reason)
        } else {
            "Memory Integrity status unavailable".into()
        };
    }
    String::new()
}

pub fn security_tweak_state(t: &Tweak, state: Value, context: &Value) -> Value {
    if t.hardware.as_deref() == Some("memory-integrity") && truthy(get(&state, "available")) {
        let running = get(context, "memoryIntegrity")
            .and_then(|m| get(m, "running"))
            .and_then(Value::as_bool);
        let mut s = state.as_object().cloned().unwrap_or_default();
        match running {
            None => {
                s.insert("enabled".into(), json!(false));
                s.insert("available".into(), json!(false));
                s.insert(
                    "reason".into(),
                    json!("Memory Integrity status unavailable"),
                );
                return Value::Object(s);
            }
            Some(false) => {
                s.insert("enabled".into(), json!(true));
                s.insert("label".into(), json!("Off"));
                s.insert("reason".into(), json!("Memory Integrity is not running"));
                return Value::Object(s);
            }
            Some(true) if truthy(get(&state, "enabled")) => {
                s.insert("enabled".into(), json!(false));
                s.insert("pending".into(), json!(true));
                s.insert("label".into(), json!("Restart required"));
                s.insert(
                    "reason".into(),
                    json!("Change saved. Memory Integrity is still running until restart."),
                );
                return Value::Object(s);
            }
            _ => {}
        }
    }
    state
}

// --- Operations -------------------------------------------------------------------

fn power_key(o: &Value) -> String {
    format!(
        "{}/{}/{}",
        js_string(get(o, "scheme")),
        js_string(get(o, "subgroup")),
        js_string(get(o, "setting"))
    )
    .to_lowercase()
}

pub fn operation_key(o: &Value) -> Result<String, String> {
    Ok(match get_str(o, "type") {
        Some("wifi-property") => format!(
            "wifi-property/{}/{}/{}",
            js_string(get(o, "adapter")).to_lowercase(),
            js_string(get(o, "deviceId")).to_uppercase(),
            js_string(get(o, "keyword"))
        ),
        Some("keyboard-shortcut") => format!("keyboard-shortcut/{}", js_string(get(o, "name"))),
        Some("service") => format!("service/{}", js_string(get(o, "name"))),
        Some("power") => "power".into(),
        Some("power-setting") => format!("power-setting/{}", power_key(o)),
        Some("network") => format!(
            "network/{}/{}",
            js_string(get(o, "adapter")).to_lowercase(),
            js_string(get(o, "keyword"))
        ),
        Some("registry") => format!(
            "registry/{}/{}",
            js_string(get(o, "path")),
            js_string(get(o, "name"))
        ),
        _ => return Err("Unknown setting type.".into()),
    })
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

/// Several controls can own tokens in one semicolon-list value. Writing them as
/// separate operations would let the second write discard the first, so tokens
/// for the same value are combined into one read, backup, and write.
fn merge_shared_preferences(operations: Vec<Value>) -> Vec<Value> {
    let mut merged: Vec<Value> = Vec::new();
    for o in operations {
        let semicolon = get_str(&o, "type") == Some("registry")
            && get_str(&o, "transform") == Some("semicolon");
        if semicolon {
            if let Some(prior) = merged.iter_mut().find(|m| {
                get_str(m, "type") == Some("registry")
                    && get_str(m, "transform") == Some("semicolon")
                    && get(m, "path") == get(&o, "path")
                    && get(m, "name") == get(&o, "name")
            }) {
                let combined = format!(
                    "{};{}",
                    js_string(get(prior, "value")),
                    js_string(get(&o, "value"))
                );
                let tokens: Vec<&str> = combined.split(';').filter(|t| !t.is_empty()).collect();
                prior["value"] = json!(format!("{};", tokens.join(";")));
                continue;
            }
        }
        merged.push(o);
    }
    merged
}

pub fn operations_for(selected: &[Tweak], context: &Value) -> Result<Vec<Value>, String> {
    Ok(merge_shared_preferences(raw_operations_for(
        selected, context,
    )?))
}

fn raw_operations_for(selected: &[Tweak], context: &Value) -> Result<Vec<Value>, String> {
    let scheme: Option<Value> = selected
        .iter()
        .find_map(|t| t.power.clone().filter(|p| !p.is_empty()).map(Value::String))
        .or_else(|| get(context, "scheme").filter(|s| truthy(Some(s))).cloned());
    let mut out = Vec::new();
    for t in selected {
        if let Some(setting) = &t.wifi_setting {
            let properties: &[Value] = array(get(context, "wifiProperties"))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            for p in properties {
                let Some(target) = wifi_target(setting, p) else {
                    continue;
                };
                if !is_guid(get(p, "adapter")) {
                    continue;
                }
                let adapter = get_str(p, "adapter").unwrap_or_default().to_lowercase();
                let same = properties
                    .iter()
                    .filter(|other| {
                        js_string(get(other, "adapter")).to_lowercase() == adapter
                            && strict_eq(get(other, "keyword"), get(p, "keyword"))
                    })
                    .count();
                if same != 1 {
                    continue;
                }
                out.push(obj(vec![
                    ("type", json!("wifi-property")),
                    ("adapter", get(p, "adapter").cloned().unwrap_or(Value::Null)),
                    (
                        "deviceId",
                        get(p, "deviceId").cloned().unwrap_or(Value::Null),
                    ),
                    ("keyword", get(p, "keyword").cloned().unwrap_or(Value::Null)),
                    (
                        "value",
                        json!([get(&target, "value").cloned().unwrap_or(Value::Null)]),
                    ),
                    (
                        "label",
                        get(&target, "label").cloned().unwrap_or(Value::Null),
                    ),
                    ("requireUp", json!(true)),
                ]));
            }
            continue;
        }
        if let Some(names) = &t.keyboard_shortcuts {
            if keyboard_availability(context).is_empty() {
                for name in names {
                    out.push(obj(vec![
                        ("type", json!("keyboard-shortcut")),
                        ("name", json!(name)),
                        ("value", json!(0)),
                    ]));
                }
            }
            continue;
        }
        if let Some(services) = &t.services {
            let available = array(get(context, "services"));
            for name in services {
                if available.is_some_and(|list| {
                    list.iter().any(|s| {
                        get_str(s, "name") == Some(name.as_str()) && truthy(get(s, "available"))
                    })
                }) {
                    out.push(obj(vec![
                        ("type", json!("service")),
                        ("name", json!(name)),
                        ("value", json!({"startup": 4, "running": false})),
                    ]));
                }
            }
            continue;
        }
        if let Some(power) = &t.power {
            out.push(obj(vec![("type", json!("power")), ("value", json!(power))]));
            continue;
        }
        if let Some(settings) = &t.power_settings {
            if !is_guid(scheme.as_ref()) {
                return Err("Read the active power plan before choosing power controls.".into());
            }
            let values = array(get(context, "powerValues"));
            let mut supported = Vec::new();
            for s in settings {
                let o = obj(vec![
                    ("type", json!("power-setting")),
                    ("scheme", scheme.clone().unwrap_or(Value::Null)),
                    ("subgroup", json!(s.subgroup)),
                    ("setting", json!(s.setting)),
                    ("value", s.value.clone()),
                ]);
                if values.is_some_and(|list| {
                    list.iter()
                        .any(|v| power_key(v) == power_key(&o) && truthy(get(v, "available")))
                }) {
                    supported.push(o);
                }
            }
            if !(t.require_all_power_settings && supported.len() != settings.len()) {
                out.extend(supported);
            }
            continue;
        }
        if let Some(settings) = &t.network_settings {
            let properties: &[Value] = array(get(context, "networkProperties"))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let mut adapters: Vec<Value> = Vec::new();
            for p in properties {
                let a = get(p, "adapter").cloned().unwrap_or(Value::Null);
                if !adapters.contains(&a) {
                    adapters.push(a);
                }
            }
            for adapter in adapters {
                let supported = |s: &crate::catalog::NetworkSetting| {
                    properties.iter().any(|p| {
                        get(p, "adapter").cloned().unwrap_or(Value::Null) == adapter
                            && get_str(p, "keyword") == Some(s.keyword.as_str())
                            && s.value.iter().all(|v| {
                                array(get(p, "validValues")).is_some_and(|valid| {
                                    valid.iter().any(|x| x.as_str() == Some(v))
                                })
                            })
                    })
                };
                if settings.iter().any(|s| s.required && !supported(s)) {
                    continue;
                }
                for s in settings.iter().filter(|s| supported(s)) {
                    out.push(obj(vec![
                        ("type", json!("network")),
                        ("adapter", adapter.clone()),
                        ("keyword", json!(s.keyword)),
                        ("value", json!(s.value)),
                    ]));
                }
            }
            continue;
        }
        for r in t.operations.iter().flatten() {
            let mut pairs = vec![
                ("type", json!("registry")),
                ("path", json!(r.path)),
                ("name", json!(r.name)),
            ];
            if t.game_preference {
                pairs.push(("kind", json!(r.kind)));
                pairs.push(("value", r.value.clone()));
            } else {
                pairs.push(("value", r.value.clone()));
                pairs.push(("kind", json!(r.kind)));
            }
            if let Some(tf) = &r.transform {
                pairs.push(("transform", json!(tf)));
            }
            out.push(obj(pairs));
        }
    }
    Ok(out)
}

pub fn unavailable_reason(t: &Tweak, context: &Value) -> Result<String, String> {
    let security = security_availability(t, context);
    if !security.is_empty() {
        return Ok(security);
    }
    if let Some(min) = t.min_build.filter(|m| *m != 0.0) {
        let build = get(context, "build");
        if !is_integer(build) || build.and_then(Value::as_f64).unwrap_or(0.0) < min {
            return Ok(if min >= 22621.0 {
                "Requires Windows 11 22H2 or newer"
            } else if min >= 22000.0 {
                "Requires Windows 11"
            } else {
                "Requires a newer Windows version"
            }
            .into());
        }
    }
    if t.keyboard_shortcuts.is_some() {
        let reason = keyboard_availability(context);
        if !reason.is_empty() {
            return Ok(reason);
        }
    }
    let single = std::slice::from_ref(t);
    if t.wifi_setting.is_some() && operations_for(single, context)?.is_empty() {
        return Ok("No connected Intel Wi-Fi adapter with verified driver choices (English labels required)".into());
    }
    let edition = get(context, "edition");
    let edition = if truthy(edition) {
        js_string(edition)
    } else {
        String::new()
    };
    if t.pro_only && !PRO.is_match(&edition) {
        return Ok("Requires Windows Pro, Enterprise, or Education".into());
    }
    let hw = t.hardware.as_deref();
    let flag = |k: &str| truthy(get(context, k));
    if hw == Some("browser") && !flag("browser") {
        return Ok("Edge or Chrome was not detected".into());
    }
    if hw == Some("onedrive") && !flag("onedrive") {
        return Ok("OneDrive was not detected".into());
    }
    if t.services.is_some() && operations_for(single, context)?.is_empty() {
        return Ok("No available optional services".into());
    }
    let checks = [
        ("hags", "hags", "GPU scheduling support was not detected"),
        ("vrr", "vrr", "Requires a WDDM 2.6 or newer graphics driver"),
        ("wifi", "wifi", "No Wi-Fi adapter detected"),
        ("hdd", "hdd", "No mechanical hard drive detected"),
        (
            "nvme",
            "nvme",
            "No active Microsoft NVMe storage controller detected",
        ),
        (
            "ahci",
            "ahci",
            "No active Microsoft SATA AHCI controller detected",
        ),
    ];
    for (name, key, reason) in checks {
        if hw == Some(name) && !flag(key) {
            return Ok(reason.into());
        }
    }
    let cpu = get(context, "cpu");
    let cpu = if truthy(cpu) {
        js_string(cpu)
    } else {
        String::new()
    };
    if hw == Some("non-x3d") && X3D.is_match(&cpu) {
        return Ok("Preserves Ryzen X3D core scheduling".into());
    }
    if let Some(power) = &t.power {
        let included = match get(context, "plans") {
            Some(Value::Array(plans)) => plans.iter().any(|p| p.as_str() == Some(power.as_str())),
            Some(Value::String(s)) => s.contains(power.as_str()),
            _ => false,
        };
        if !included {
            return Ok("Power plan unavailable on this PC".into());
        }
    }
    if operations_for(single, context)?.is_empty() {
        return Ok(if t.network_settings.is_some() {
            "No supported active Ethernet adapter"
        } else {
            "Not exposed by your hardware"
        }
        .into());
    }
    Ok(String::new())
}

pub fn materialize_operations(
    operations: &[Value],
    before: &[Value],
) -> Result<Vec<Value>, String> {
    if operations.len() != before.len() {
        return Err("Incomplete settings snapshot.".into());
    }
    let mut out = Vec::with_capacity(operations.len());
    for (o, b) in operations.iter().zip(before) {
        if operation_key(o)? != operation_key(b)? {
            return Err("Settings snapshot does not match the requested changes.".into());
        }
        match get_str(o, "type") {
            Some("wifi-property") => {
                if get(b, "available") != Some(&Value::Bool(true))
                    || get(b, "up") != Some(&Value::Bool(true))
                    || !valid_wifi_value(Some(b))
                {
                    return Err("The Wi-Fi adapter or its restorable setting is no longer available. Scan again.".into());
                }
                let wanted = array(get(o, "value")).and_then(|v| v.first());
                let found = array(get(b, "choices")).is_some_and(|choices| {
                    choices.iter().any(|c| {
                        strict_eq(get(c, "value"), wanted)
                            && wifi_label(get(c, "label")) == wifi_label(get(o, "label"))
                    })
                });
                if !found {
                    return Err("Wi-Fi driver choices changed. Scan again before applying.".into());
                }
                out.push(o.clone());
            }
            Some("keyboard-shortcut") => {
                if get(b, "available") != Some(&Value::Bool(true))
                    || get(b, "active") != Some(&Value::Bool(false))
                    || !valid_shortcut_value(get(b, "value"))
                {
                    return Err("Keyboard shortcut support changed or an accessibility feature is active. Scan again before applying.".into());
                }
                out.push(o.clone());
            }
            Some("service") => {
                if !valid_service_value(get(b, "value")) {
                    return Err("Unsupported service snapshot.".into());
                }
                let mut result = o.clone();
                let mut value = get(o, "value")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                value.insert(
                    "delayed".into(),
                    get(b, "value")
                        .and_then(|v| get(v, "delayed"))
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                result["value"] = Value::Object(value);
                out.push(result);
            }
            Some("registry") => {
                let mut result = o.as_object().cloned().unwrap_or_default();
                let transform = result.shift_remove("transform");
                if truthy(transform.as_ref()) {
                    if transform.as_ref().and_then(Value::as_str) != Some("semicolon") {
                        return Err("Unknown preference transformation.".into());
                    }
                    let exists = truthy(get(b, "exists"));
                    if exists && get_str(b, "kind") != Some("String") {
                        return Err(
                            "The existing graphics preference is not a supported string.".into(),
                        );
                    }
                    let previous = if exists { get(b, "value") } else { None };
                    let previous = match (exists, previous) {
                        (false, _) => String::new(),
                        (true, Some(Value::String(s))) => s.clone(),
                        _ => {
                            return Err("The existing graphics preference could not be read.".into())
                        }
                    };
                    let changes_text = js_string(get(o, "value"));
                    let changes: Vec<&str> =
                        changes_text.split(';').filter(|s| !s.is_empty()).collect();
                    let keys: HashSet<&str> = changes
                        .iter()
                        .map(|c| c.split('=').next().unwrap_or_default())
                        .collect();
                    let kept: Vec<&str> = previous
                        .split(';')
                        .filter(|v| {
                            !v.is_empty() && !keys.contains(v.split('=').next().unwrap_or_default())
                        })
                        .collect();
                    let combined: Vec<&str> = kept.into_iter().chain(changes).collect();
                    result.insert("value".into(), json!(format!("{};", combined.join(";"))));
                }
                result.insert("exists".into(), json!(true));
                out.push(Value::Object(result));
            }
            _ => {
                if get(b, "available") == Some(&Value::Bool(false)) {
                    return Err("A selected device or power setting is no longer available.".into());
                }
                out.push(o.clone());
            }
        }
    }
    Ok(out)
}

pub fn equal_operations(expected: &[Value], actual: &Value) -> Result<bool, String> {
    let Some(actual) = actual.as_array() else {
        return Ok(false);
    };
    if expected.len() != actual.len() {
        return Ok(false);
    }
    for (e, a) in expected.iter().zip(actual) {
        if !truthy(Some(a))
            || operation_key(e)? != operation_key(a)?
            || get(a, "available") == Some(&Value::Bool(false))
        {
            return Ok(false);
        }
        let ok = match get_str(e, "type") {
            Some("wifi-property") => {
                valid_wifi_value(Some(e))
                    && valid_wifi_value(Some(a))
                    && strict_eq(
                        array(get(e, "value")).and_then(|v| v.first()),
                        array(get(a, "value")).and_then(|v| v.first()),
                    )
                    && wifi_label(get(e, "label")) == wifi_label(get(a, "label"))
            }
            Some("service") => equal_service_value(get(e, "value"), get(a, "value")),
            Some("power") => a
                .get("value")
                .and_then(Value::as_str)
                .is_some_and(|av| js_string(get(e, "value")).to_lowercase() == av.to_lowercase()),
            Some("registry") => {
                if get(e, "exists") == Some(&Value::Bool(false)) {
                    get(a, "exists") == Some(&Value::Bool(false))
                } else if !truthy(get(a, "exists")) || !strict_eq(get(a, "kind"), get(e, "kind")) {
                    false
                } else if get_str(e, "transform") == Some("semicolon") {
                    let actual_text = js_string(get(a, "value"));
                    let mut tokens: std::collections::HashMap<&str, &str> =
                        std::collections::HashMap::new();
                    for token in actual_text.split(';').filter(|t| !t.is_empty()) {
                        tokens.insert(token.split('=').next().unwrap_or_default(), token);
                    }
                    let expected_text = js_string(get(e, "value"));
                    expected_text
                        .split(';')
                        .filter(|t| !t.is_empty())
                        .all(|token| {
                            tokens.get(token.split('=').next().unwrap_or_default()) == Some(&token)
                        })
                } else {
                    json_eq(get(e, "value"), get(a, "value"))
                }
            }
            _ => json_eq(get(e, "value"), get(a, "value")),
        };
        if !ok {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Definitions used when no specific tweak list applies: everything that may
/// appear in a backup, including per-game GPU preferences from older versions.
pub fn default_definitions() -> Vec<Tweak> {
    let mut defs = CATALOG.recovery_tweaks.clone();
    defs.push(game_preference_recovery());
    defs
}

pub fn allowed_operation(o: &Value, definitions: &[Tweak]) -> bool {
    match get_str(o, "type") {
        Some("wifi-property") => {
            is_guid(get(o, "adapter"))
                && is_intel_wifi_id(get(o, "deviceId"))
                && definitions.iter().any(|t| {
                    t.wifi_setting
                        .as_ref()
                        .is_some_and(|w| get_str(o, "keyword") == Some(w.keyword.as_str()))
                })
        }
        Some("keyboard-shortcut") => definitions.iter().any(|t| {
            t.keyboard_shortcuts
                .as_ref()
                .is_some_and(|k| get_str(o, "name").is_some_and(|n| k.iter().any(|x| x == n)))
        }),
        Some("service") => definitions.iter().any(|t| {
            t.services
                .as_ref()
                .is_some_and(|s| get_str(o, "name").is_some_and(|n| s.iter().any(|x| x == n)))
        }),
        Some("power") => {
            is_guid(get(o, "value"))
                && definitions
                    .iter()
                    .any(|t| t.power.as_ref().is_some_and(|p| !p.is_empty()))
        }
        Some("power-setting") => {
            is_guid(get(o, "scheme"))
                && definitions.iter().any(|t| {
                    t.power_settings.as_ref().is_some_and(|list| {
                        list.iter().any(|s| {
                            get_str(o, "subgroup") == Some(s.subgroup.as_str())
                                && get_str(o, "setting") == Some(s.setting.as_str())
                        })
                    })
                })
        }
        Some("network") => {
            is_guid(get(o, "adapter"))
                && definitions.iter().any(|t| {
                    t.network_settings.as_ref().is_some_and(|list| {
                        list.iter()
                            .any(|s| get_str(o, "keyword") == Some(s.keyword.as_str()))
                    })
                })
        }
        Some("registry") => definitions.iter().any(|t| {
            if t.game_preference {
                is_game_preference_operation(o)
                    && t.game_path
                        .as_ref()
                        .is_none_or(|p| get_str(o, "name") == Some(p.as_str()))
            } else {
                t.operations.as_ref().is_some_and(|list| {
                    list.iter().any(|s| {
                        get_str(o, "path") == Some(s.path.as_str())
                            && get_str(o, "name") == Some(s.name.as_str())
                    })
                })
            }
        }),
        _ => false,
    }
}

pub fn validate_backup_operations(entry: &Value, definitions: &[Tweak]) -> Result<(), String> {
    let empty = Vec::new();
    let before = array(get(entry, "before")).unwrap_or(&empty);
    let after = array(get(entry, "after")).unwrap_or(&empty);
    if before.is_empty() || before.len() != after.len() {
        return Err("The backup is incomplete.".into());
    }
    let keys = before
        .iter()
        .map(operation_key)
        .collect::<Result<Vec<_>, _>>()?;
    if keys.iter().collect::<HashSet<_>>().len() != keys.len() {
        return Err("The backup contains duplicate settings.".into());
    }
    for (i, key) in keys.iter().enumerate() {
        if *key != operation_key(&after[i])?
            || !allowed_operation(&before[i], definitions)
            || !allowed_operation(&after[i], definitions)
        {
            return Err("The backup does not match its original tweak definitions.".into());
        }
    }
    if definitions.iter().any(|t| {
        !before
            .iter()
            .any(|o| allowed_operation(o, std::slice::from_ref(t)))
    }) {
        return Err("The backup is missing a selected tweak.".into());
    }
    for t in definitions {
        let only = std::slice::from_ref(t);
        if let Some(setting) = &t.wifi_setting {
            for original in before.iter().filter(|o| allowed_operation(o, only)) {
                let key = operation_key(original)?;
                let mut changed = None;
                for o in after {
                    if operation_key(o)? == key {
                        changed = Some(o);
                        break;
                    }
                }
                let target = wifi_target(setting, original);
                let bad = match (target, changed) {
                    (Some(target), Some(changed)) => {
                        original
                            .as_object()
                            .is_some_and(|m| m.contains_key("requireUp"))
                            || !valid_wifi_value(Some(changed))
                            || !strict_eq(
                                array(get(changed, "value")).and_then(|v| v.first()),
                                get(&target, "value"),
                            )
                            || wifi_label(get(changed, "label"))
                                != setting.target.trim().to_lowercase()
                            || get(changed, "requireUp") != Some(&Value::Bool(true))
                            || truthy(get(changed, "transform"))
                    }
                    _ => true,
                };
                if bad {
                    return Err("The Wi-Fi backup contains an unexpected change.".into());
                }
            }
        }
        if let Some(names) = &t.keyboard_shortcuts {
            let original: Vec<&Value> = before
                .iter()
                .filter(|o| allowed_operation(o, only))
                .collect();
            let changed: Vec<&Value> = after
                .iter()
                .filter(|o| allowed_operation(o, only))
                .collect();
            if original.len() != names.len()
                || names.iter().any(|n| {
                    !original
                        .iter()
                        .any(|o| get_str(o, "name") == Some(n.as_str()))
                })
            {
                return Err("The backup is missing part of the keyboard shortcut control.".into());
            }
            if original.iter().any(|o| {
                get(o, "available") != Some(&Value::Bool(true))
                    || get(o, "active") != Some(&Value::Bool(false))
                    || !valid_shortcut_value(get(o, "value"))
            }) || changed.iter().any(|o| {
                !strict_eq(get(o, "value"), Some(&json!(0))) || truthy(get(o, "transform"))
            }) {
                return Err("The keyboard shortcut backup contains an unexpected change.".into());
            }
        }
        if t.require_all_power_settings {
            let settings: Vec<&Value> = before
                .iter()
                .filter(|o| allowed_operation(o, only))
                .collect();
            let list = t.power_settings.as_deref().unwrap_or_default();
            let schemes: HashSet<String> = settings
                .iter()
                .map(|o| js_string(get(o, "scheme")).to_lowercase())
                .collect();
            if settings.len() != list.len()
                || schemes.len() != 1
                || list.iter().any(|s| {
                    !settings.iter().any(|o| {
                        get_str(o, "subgroup") == Some(s.subgroup.as_str())
                            && get_str(o, "setting") == Some(s.setting.as_str())
                    })
                })
            {
                return Err("The backup is missing part of a power control.".into());
            }
        }
        if t.operations.as_ref().is_some_and(|list| {
            list.iter().any(|s| {
                !before.iter().any(|o| {
                    get_str(o, "type") == Some("registry")
                        && get_str(o, "path") == Some(s.path.as_str())
                        && get_str(o, "name") == Some(s.name.as_str())
                })
            })
        }) {
            return Err("The backup is missing part of a grouped tweak.".into());
        }
        if t.hardware.as_deref() == Some("memory-integrity") {
            let originals: Vec<Value> = before
                .iter()
                .filter(|o| allowed_operation(o, only))
                .cloned()
                .collect();
            let expected = materialize_operations(&operations_for(only, &json!({}))?, &originals)?;
            let changed: Vec<Value> = after
                .iter()
                .filter(|o| allowed_operation(o, only))
                .cloned()
                .collect();
            if !equal_operations(&expected, &Value::Array(changed))? {
                return Err("The Memory Integrity backup contains an unexpected change.".into());
            }
        }
        if let Some(services) = &t.services {
            for o in after.iter().filter(|o| {
                get_str(o, "type") == Some("service")
                    && get_str(o, "name").is_some_and(|n| services.iter().any(|s| s == n))
            }) {
                let key = operation_key(o)?;
                let mut original = None;
                for b in before {
                    if operation_key(b)? == key {
                        original = Some(b);
                        break;
                    }
                }
                let value = original.and_then(|b| get(b, "value"));
                let ok = valid_service_value(value) && {
                    let mut expected = value
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    expected.insert("startup".into(), json!(4));
                    expected.insert("running".into(), json!(false));
                    equal_service_value(Some(&Value::Object(expected)), get(o, "value"))
                };
                if !ok {
                    return Err("The service backup contains an unexpected change.".into());
                }
            }
        }
        if t.game_preference {
            let game_path_matches = match (get(entry, "gamePath"), &t.game_path) {
                (Some(Value::String(a)), Some(b)) => a == b,
                (None, None) => true,
                _ => false,
            };
            if definitions.len() != 1 || before.len() != 1 || !game_path_matches {
                return Err(
                    "The game preference backup does not match its saved executable.".into(),
                );
            }
            let expected = materialize_operations(&operations_for(only, &json!({}))?, before)?;
            if !equal_operations(&expected, &Value::Array(after.clone()))?
                || after.iter().any(|o| truthy(get(o, "transform")))
            {
                return Err("The game preference backup contains an unexpected change.".into());
            }
        }
    }
    Ok(())
}
