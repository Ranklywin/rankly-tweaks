//! Golden tests: tests/fixtures/parity.json.gz was recorded from the original
//! JavaScript backend (v1.0 plus the fps-checkup additions). The Rust port must
//! produce identical operations, decisions, error messages, and PowerShell text.
use flate2::read::GzDecoder;
use rankly_tweaks_lib::apps::{AppAdapter, SessionApps};
use rankly_tweaks_lib::catalog::{validate_recovery_ids, validate_tweak_ids, Tweak, CATALOG};
use rankly_tweaks_lib::engine::{Adapter, Engine};
use rankly_tweaks_lib::js::deep_eq;
use rankly_tweaks_lib::ops::*;
use rankly_tweaks_lib::scripts::*;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::LazyLock;

static FIXTURES: LazyLock<Value> = LazyLock::new(|| {
    let mut text = String::new();
    GzDecoder::new(&include_bytes!("fixtures/parity.json.gz")[..])
        .read_to_string(&mut text)
        .unwrap();
    serde_json::from_str(&text).unwrap()
});

fn cases(name: &str) -> &'static Vec<Value> {
    FIXTURES[name]
        .as_array()
        .unwrap_or_else(|| panic!("missing fixture {name}"))
}

fn context(case: &Value) -> &'static Value {
    &FIXTURES["contexts"][case["context"].as_str().unwrap()]
}

fn definitions(case: &Value) -> Vec<Tweak> {
    if case["recovery"] == json!(true) {
        validate_recovery_ids(&case["ids"]).unwrap()
    } else {
        validate_tweak_ids(&case["ids"]).unwrap()
    }
}

fn arr(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

/// Compares a Result with a fixture holding either `key` or `error`.
fn outcome(case: &Value, key: &str, actual: Result<Value, String>) -> Option<String> {
    match (actual, case.get("error")) {
        (Err(e), Some(expected)) if expected == &json!(e) => None,
        (Ok(v), None) if deep_eq(&v, &case[key]) => None,
        (actual, _) => Some(format!(
            "expected {}\n   got {:?}",
            if case.get("error").is_some() {
                format!("error {}", case["error"])
            } else {
                case[key].to_string()
            },
            actual
        )),
    }
}

fn report(name: &str, failures: Vec<String>) {
    let total = cases(name).len();
    assert!(
        failures.is_empty(),
        "{} of {total} {name} cases differ. First:\n{}",
        failures.len(),
        failures
            .iter()
            .take(4)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}

#[test]
fn tweak_resolution_matches() {
    let mut failures = Vec::new();
    for c in cases("resolve") {
        if let Some(f) = outcome(
            c,
            "operations",
            operations_for(&definitions(c), context(c)).map(Value::Array),
        ) {
            failures.push(format!("{} {}: {f}", c["context"], c["ids"]));
        }
    }
    report("resolve", failures);
}

#[test]
fn availability_matches() {
    let mut failures = Vec::new();
    for c in cases("unavailable") {
        let t = CATALOG.tweaks.iter().find(|t| t.id == c["id"]).unwrap();
        if let Some(f) = outcome(
            c,
            "reason",
            unavailable_reason(t, context(c)).map(Value::String),
        ) {
            failures.push(format!("{} {}: {f}", c["context"], c["id"]));
        }
    }
    report("unavailable", failures);
}

#[test]
fn materialization_matches() {
    let mut failures = Vec::new();
    for c in cases("materialize") {
        if let Some(f) = outcome(
            c,
            "result",
            materialize_operations(&arr(&c["operations"]), &arr(&c["before"])).map(Value::Array),
        ) {
            failures.push(f);
        }
    }
    report("materialize", failures);
}

#[test]
fn equality_matches() {
    let mut failures = Vec::new();
    for c in cases("equal") {
        let actual = equal_operations(&arr(&c["expected"]), &c["actual"]);
        if actual != Ok(c["result"].as_bool().unwrap()) {
            failures.push(format!(
                "{} vs {}: expected {} got {actual:?}",
                c["expected"], c["actual"], c["result"]
            ));
        }
    }
    report("equal", failures);
}

#[test]
fn allowlist_matches() {
    let mut failures = Vec::new();
    for c in cases("allowed") {
        let defs = if c.get("ids").is_some() {
            validate_tweak_ids(&c["ids"]).unwrap()
        } else {
            default_definitions()
        };
        if allowed_operation(&c["operation"], &defs) != c["result"].as_bool().unwrap() {
            failures.push(format!(
                "{} with {:?}: expected {}",
                c["operation"],
                c.get("ids"),
                c["result"]
            ));
        }
    }
    report("allowed", failures);
}

#[test]
fn backup_validation_matches() {
    let mut failures = Vec::new();
    for c in cases("backups") {
        let actual = validate_backup_operations(&c["entry"], &definitions(c)).map(|_| json!("ok"));
        if let Some(f) = outcome(c, "result", actual) {
            failures.push(format!("{}: {f}", c["ids"]));
        }
    }
    report("backups", failures);
}

#[test]
fn read_scripts_match_byte_for_byte() {
    let mut failures = Vec::new();
    for c in cases("readScripts") {
        if let Some(f) = outcome(
            c,
            "script",
            build_read_script(&arr(&c["operations"])).map(Value::String),
        ) {
            failures.push(f);
        }
    }
    report("readScripts", failures);
}

#[test]
fn write_scripts_match_byte_for_byte() {
    let mut failures = Vec::new();
    for c in cases("writeScripts") {
        if let Some(f) = outcome(
            c,
            "script",
            build_write_script(&arr(&c["operations"])).map(Value::String),
        ) {
            failures.push(format!("{}: {f}", c["operations"]));
        }
    }
    report("writeScripts", failures);
}

#[test]
fn security_states_match() {
    let mut failures = Vec::new();
    for c in cases("securityState") {
        let t = CATALOG
            .recovery_tweaks
            .iter()
            .find(|t| t.id == c["id"])
            .unwrap();
        let actual = security_tweak_state(t, c["state"].clone(), &c["context"]);
        if !deep_eq(&actual, &c["result"]) {
            failures.push(format!("{c}: got {actual}"));
        }
    }
    report("securityState", failures);
}

#[test]
fn static_scripts_match() {
    let s = &FIXTURES["scripts"];
    assert_eq!(capabilities_script(), s["capabilities"].as_str().unwrap());
    let path = r"C:\Users\x\AppData\Local\Temp\rankly-capabilities-1.xml";
    assert_eq!(
        graphics_script(path),
        s["graphics"]
            .as_str()
            .unwrap()
            .replace("__RANKLY_REPORT_PATH__", &ps_quote(path))
    );
    assert_eq!(SYSTEM, s["system"].as_str().unwrap());
    assert_eq!(CHECKUP, s["checkup"].as_str().unwrap());
    assert_eq!(app_snapshot_script(), s["appSnapshot"].as_str().unwrap());
    for target in ["cloudflare", "google", "quad9"] {
        assert_eq!(
            ping_script(target).unwrap(),
            s["ping"][target].as_str().unwrap()
        );
    }
    assert_eq!(
        ping_script("evil").unwrap_err(),
        "Choose one of the available test endpoints."
    );
    for c in cases("quote") {
        assert_eq!(
            ps_quote(c["input"].as_str().unwrap()),
            c["output"].as_str().unwrap()
        );
    }
}

#[test]
fn close_scripts_match() {
    let mut failures = Vec::new();
    for c in cases("closeApps") {
        if let Some(f) = outcome(
            c,
            "script",
            close_apps_script(&arr(&c["processes"])).map(Value::String),
        ) {
            failures.push(f);
        }
    }
    report("closeApps", failures);
}

struct FixedApps(Value);
impl AppAdapter for FixedApps {
    fn list(&self) -> Result<Value, String> {
        Ok(self.0.clone())
    }
    fn close(&self, processes: &[Value]) -> Result<Value, String> {
        Ok(json!({"closedProcesses": processes.len(), "skippedProcesses": 0, "failedProcesses": 0}))
    }
}

#[test]
fn background_app_scan_matches() {
    for c in cases("sessionScan") {
        let manager = SessionApps::new(Box::new(FixedApps(c["processes"].clone())));
        let mut scanned = manager.scan().unwrap();
        let tokens: Vec<Value> = scanned
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["token"].clone())
            .collect();
        for app in scanned.as_array_mut().unwrap() {
            app["token"] = json!("<token>");
        }
        assert!(deep_eq(&scanned, &c["result"]), "scan: {scanned}");
        let expected: u64 = scanned
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["processCount"].as_u64().unwrap())
            .sum();
        let closed = manager.close(&Value::Array(tokens.clone())).unwrap();
        assert_eq!(closed["closedProcesses"], json!(expected));
        // Tokens are single use.
        assert_eq!(
            manager.close(&Value::Array(tokens)).unwrap_err(),
            "Refresh the app list and choose the apps again."
        );
    }
}

#[test]
fn game_preference_recovery_matches() {
    for c in cases("gameRecovery") {
        match game_recovery_definitions(&c["entry"]) {
            Err(e) => assert_eq!(json!(e), c["error"], "{c}"),
            Ok(None) => assert!(c["definitions"].is_null(), "{c}"),
            Ok(Some(defs)) => {
                let expected = &c["definitions"][0];
                assert_eq!(json!(defs[0].name), expected["name"]);
                assert_eq!(json!(defs[0].game_path), expected["gamePath"]);
                let validation =
                    validate_backup_operations(&c["entry"], &defs).map(|_| json!("ok"));
                assert!(
                    outcome(&c["validation"], "result", validation).is_none(),
                    "{c}"
                );
            }
        }
    }
}

#[test]
fn recovery_id_validation_matches() {
    for c in cases("recoveryIds") {
        let actual = validate_recovery_ids(&c["ids"]).map(|_| json!("ok"));
        assert!(outcome(c, "result", actual).is_none(), "{c}");
    }
}

#[test]
fn checkup_script_is_read_only() {
    let write = regex::Regex::new(r"(?i)ChangeDisplaySettings|Set-ItemProperty|New-ItemProperty|Remove-Item|Set-Cim|Invoke-Cim|powercfg|SetSystemPowerState|bcdedit|reg\.exe").unwrap();
    assert!(!write.is_match(CHECKUP));
}

#[test]
fn graphics_support_maps_hags_and_the_vrr_driver_floor() {
    use rankly_tweaks_lib::system::capabilities;
    // The dxdiag result is cached for the process, so this is the only caller.
    let run = |script: &str, _: std::time::Duration| -> Result<Value, String> {
        Ok(if script.contains("dxdiag") {
            json!({"hags": true, "wddm": 206})
        } else {
            json!({"build": 26100})
        })
    };
    let context = capabilities(&run).unwrap();
    assert_eq!(
        (
            context["hags"].clone(),
            context["vrr"].clone(),
            context["build"].clone()
        ),
        (json!(true), json!(true), json!(26100))
    );
}

struct NoSystem;
impl Adapter for NoSystem {
    fn read(&self, _: &[Value]) -> Result<Value, String> {
        Err("unused".into())
    }
    fn write(&self, _: &[Value]) -> Result<(), String> {
        Err("unused".into())
    }
}

#[test]
fn journal_parsing_matches() {
    let dir = std::env::temp_dir().join(format!("rankly-journal-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    for c in cases("journals") {
        std::fs::write(dir.join("recovery.json"), c["text"].as_str().unwrap()).unwrap();
        let engine = Engine::new(&dir, Box::new(NoSystem));
        let actual = engine.history().map(Value::Array);
        assert!(outcome(c, "history", actual).is_none(), "{}", c["text"]);
    }
    std::fs::remove_dir_all(dir).unwrap();
}
