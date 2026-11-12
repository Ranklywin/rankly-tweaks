//! Transaction and recovery behavior (ported from tests/engine.test.mjs and
//! friends) using an in-memory Windows substitute. No real settings change.
use rankly_tweaks_lib::catalog::{validate_recovery_ids, validate_tweak_ids, CATALOG};
use rankly_tweaks_lib::engine::{atomic_json, Adapter, Engine};
use rankly_tweaks_lib::js::deep_eq;
use rankly_tweaks_lib::ops::{operation_key, operations_for};
use rankly_tweaks_lib::scripts::build_write_script;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

/// Runs instead of a normal write; it can fail or partially apply a call.
type WriteHook = Box<dyn Fn(usize, &[Value], &Memory) -> Result<(), String> + Send>;

#[derive(Clone, Default)]
struct Memory {
    values: Arc<Mutex<HashMap<String, Value>>>,
    writes: Arc<Mutex<usize>>,
    hook: Arc<Mutex<Option<WriteHook>>>,
    context: Arc<Value>,
}

impl Memory {
    fn with(initial: Vec<Value>, context: Value) -> Self {
        let m = Memory {
            context: Arc::new(context),
            ..Default::default()
        };
        for v in initial {
            m.values
                .lock()
                .unwrap()
                .insert(operation_key(&v).unwrap(), v);
        }
        m
    }
    fn store(&self, ops: &[Value]) {
        let mut values = self.values.lock().unwrap();
        for o in ops {
            let key = operation_key(o).unwrap();
            if o.get("exists") == Some(&json!(false)) {
                values.remove(&key);
            } else {
                values.insert(key, o.clone());
            }
        }
    }
    fn snapshot(&self, ops: &[Value]) -> Value {
        let values = self.values.lock().unwrap();
        Value::Array(
            ops.iter()
                .map(|o| values.get(&operation_key(o).unwrap()).cloned().unwrap_or_else(|| json!({"type":"registry","path":o["path"],"name":o["name"],"exists":false})))
                .collect(),
        )
    }
    fn on_write(
        &self,
        hook: impl Fn(usize, &[Value], &Memory) -> Result<(), String> + Send + 'static,
    ) {
        *self.hook.lock().unwrap() = Some(Box::new(hook));
    }
}

impl Adapter for Memory {
    fn read(&self, ops: &[Value]) -> Result<Value, String> {
        Ok(self.snapshot(ops))
    }
    fn write(&self, ops: &[Value]) -> Result<(), String> {
        let call = {
            let mut w = self.writes.lock().unwrap();
            *w += 1;
            *w
        };
        if let Some(hook) = self.hook.lock().unwrap().as_ref() {
            return hook(call, ops, self);
        }
        self.store(ops);
        Ok(())
    }
    fn resolve(
        &self,
        selected: &[rankly_tweaks_lib::catalog::Tweak],
    ) -> Result<Vec<Value>, String> {
        operations_for(selected, &self.context)
    }
}

struct Dir(PathBuf);
impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn temp() -> Dir {
    let dir = std::env::temp_dir().join(format!("rankly-engine-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    Dir(dir)
}

fn engine(dir: &Dir, memory: &Memory) -> Engine {
    Engine::new(&dir.0, Box::new(memory.clone()))
}

fn ops(ids: Value) -> Vec<Value> {
    operations_for(&validate_tweak_ids(&ids).unwrap(), &json!({})).unwrap()
}

fn journal(dir: &Dir) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.0.join("recovery.json")).unwrap()).unwrap()
}

#[test]
fn catalog_accepts_only_explicit_unique_ids() {
    for bad in [
        json!(["game-mode; Remove-Item C:"]),
        json!(["windows-cleanup", "windows-cleanup"]),
        json!([]),
        json!("windows-cleanup"),
        json!([5]),
    ] {
        assert_eq!(
            validate_tweak_ids(&bad).unwrap_err(),
            "Choose valid, unique tweaks from the library."
        );
    }
    assert_eq!(
        validate_tweak_ids(&json!(["windows-cleanup"])).unwrap()[0].name,
        "Windows cleanup"
    );
}

#[test]
fn withdrawn_controls_cannot_be_applied_or_written() {
    let (dir, memory) = (temp(), Memory::default());
    let e = engine(&dir, &memory);
    for id in &CATALOG.retired_tweak_ids {
        assert!(validate_tweak_ids(&json!([id])).is_err());
        assert!(validate_recovery_ids(&json!([id])).is_err());
        assert!(e.apply(&json!([id])).is_err());
    }
    for ty in ["defender", "defender-startup"] {
        assert_eq!(
            build_write_script(&[
                json!({"type": ty, "name": "DisableRealtimeMonitoring", "value": true})
            ])
            .unwrap_err(),
            "Setting is not in the tweak allowlist."
        );
    }
    assert_eq!(*memory.writes.lock().unwrap(), 0);
}

#[test]
fn backup_is_durable_before_the_first_write_and_restores_exactly() {
    let dir = temp();
    let original = json!({"type":"registry","path":"HKCU:\\Software\\Microsoft\\GameBar","name":"AllowAutoGameMode","exists":true,"kind":"String","value":"original"});
    let memory = Memory::with(vec![original.clone()], json!({}));
    let path = dir.0.join("recovery.json");
    memory.on_write(move |call, ops, m| {
        if call == 1 {
            let j: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(j[0]["status"], "prepared");
            assert_eq!(j[0]["before"][0], original);
        }
        m.store(ops);
        Ok(())
    });
    let e = engine(&dir, &memory);
    let before = memory.snapshot(&ops(json!(["gaming-optimization"])));
    let change = e.apply(&json!(["gaming-optimization"])).unwrap();
    assert_eq!(change["status"], "applied");
    e.restore(change["id"].as_str().unwrap()).unwrap();
    assert!(deep_eq(
        &memory.snapshot(&ops(json!(["gaming-optimization"]))),
        &before
    ));
    assert_eq!(e.history().unwrap()[0]["status"], "restored");
}

#[test]
fn partial_writes_roll_back_the_whole_batch() {
    let (dir, memory) = (temp(), Memory::default());
    memory.on_write(|call, ops, m| {
        if call == 1 {
            m.store(&ops[..1]);
            return Err("Simulated Windows failure".into());
        }
        m.store(ops);
        Ok(())
    });
    let e = engine(&dir, &memory);
    let err = e
        .apply(&json!(["gaming-optimization", "windows-cleanup"]))
        .unwrap_err();
    assert!(
        err.ends_with("Previous values were restored and verified."),
        "{err}"
    );
    assert_eq!(e.history().unwrap()[0]["status"], "rolled-back");
    let all = memory.snapshot(&ops(json!(["gaming-optimization", "windows-cleanup"])));
    assert!(all
        .as_array()
        .unwrap()
        .iter()
        .all(|o| o["exists"] == json!(false)));
}

#[test]
fn failed_rollback_blocks_new_changes_until_recovered() {
    let (dir, memory) = (temp(), Memory::default());
    memory.on_write(|_, _, _| Err("Simulated access denied".into()));
    let e = engine(&dir, &memory);
    assert!(e
        .apply(&json!(["windows-cleanup"]))
        .unwrap_err()
        .contains("Open Recovery"));
    assert!(e
        .apply(&json!(["gaming-optimization"]))
        .unwrap_err()
        .contains("Restore the interrupted change"));
    let entry = e.history().unwrap()[0].clone();
    assert_eq!(entry["status"], "recovery-needed");
    *memory.hook.lock().unwrap() = None;
    e.restore(entry["id"].as_str().unwrap()).unwrap();
    assert_eq!(e.history().unwrap()[0]["status"], "restored");
}

#[test]
fn verifies_persisted_settings_instead_of_trusting_exit() {
    let (dir, memory) = (temp(), Memory::default());
    memory.on_write(|_, _, _| Ok(()));
    let e = engine(&dir, &memory);
    assert!(e
        .apply(&json!(["windows-cleanup"]))
        .unwrap_err()
        .contains("did not retain"));
    assert_eq!(e.history().unwrap()[0]["status"], "rolled-back");
}

#[test]
fn restores_follow_reverse_chronological_order() {
    let (dir, memory) = (temp(), Memory::default());
    let e = engine(&dir, &memory);
    let a = e.apply(&json!(["gaming-optimization"])).unwrap();
    let b = e.apply(&json!(["windows-cleanup"])).unwrap();
    assert!(e
        .restore(a["id"].as_str().unwrap())
        .unwrap_err()
        .contains("most recent change first"));
    e.restore(b["id"].as_str().unwrap()).unwrap();
    e.restore(a["id"].as_str().unwrap()).unwrap();
    assert!(e
        .history()
        .unwrap()
        .iter()
        .all(|x| x["status"] == "restored"));
}

#[test]
fn matching_settings_create_no_redundant_backup() {
    let (dir, memory) = (temp(), Memory::default());
    let e = engine(&dir, &memory);
    e.apply(&json!(["windows-cleanup"])).unwrap();
    assert_eq!(
        e.apply(&json!(["windows-cleanup"])).unwrap(),
        json!({"unchanged": true})
    );
    assert_eq!(e.history().unwrap().len(), 1);
}

#[test]
fn malformed_journals_fail_closed_without_overwriting() {
    let (dir, memory) = (temp(), Memory::default());
    let e = engine(&dir, &memory);
    let file = dir.0.join("recovery.json");
    std::fs::write(&file, "{broken").unwrap();
    assert!(e
        .apply(&json!(["windows-cleanup"]))
        .unwrap_err()
        .contains("journal could not be read"));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "{broken");
    assert_eq!(*memory.writes.lock().unwrap(), 0);
}

#[test]
fn interrupted_prepared_transactions_recover_after_restart() {
    let (dir, memory) = (temp(), Memory::default());
    let desired = ops(json!(["windows-cleanup"]));
    let before = memory.snapshot(&desired);
    let after: Vec<Value> = desired
        .iter()
        .map(|o| {
            let mut o = o.clone();
            o["exists"] = json!(true);
            o
        })
        .collect();
    atomic_json(&dir.0.join("recovery.json"), &json!([{"id":"interrupted","date":"2026-11-12T00:00:00.000Z","ids":["windows-cleanup"],"names":["Windows cleanup"],"before":before,"after":after,"status":"prepared"}])).unwrap();
    memory.store(&after);
    let e = engine(&dir, &memory);
    assert!(e
        .apply(&json!(["gaming-optimization"]))
        .unwrap_err()
        .contains("interrupted"));
    e.restore("interrupted").unwrap();
    assert!(deep_eq(&memory.snapshot(&after), &before));
}

#[test]
fn parallel_changes_are_refused_while_one_is_in_flight() {
    let (dir, memory) = (temp(), Memory::default());
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let rx = Mutex::new(rx);
    memory.on_write(move |_, ops, m| {
        let _ = rx.lock().unwrap().recv();
        m.store(ops);
        Ok(())
    });
    let e = Arc::new(engine(&dir, &memory));
    let first = {
        let e = e.clone();
        std::thread::spawn(move || e.apply(&json!(["windows-cleanup"])))
    };
    while !e.busy() {
        std::thread::yield_now();
    }
    assert_eq!(
        e.apply(&json!(["gaming-optimization"])).unwrap_err(),
        "Another change is in progress. Please wait."
    );
    tx.send(()).unwrap();
    tx.send(()).unwrap();
    assert!(first.join().unwrap().is_ok());
}

#[test]
fn power_plan_backup_returns_to_the_original_plan() {
    let dir = temp();
    let original = json!({"type":"power","value":BALANCED});
    let memory = Memory::with(vec![original.clone()], json!({}));
    let e = engine(&dir, &memory);
    let entry = e.apply(&json!(["high-performance"])).unwrap();
    e.restore(entry["id"].as_str().unwrap()).unwrap();
    assert!(deep_eq(
        &memory.snapshot(std::slice::from_ref(&original)),
        &json!([original])
    ));
}

#[test]
fn all_ten_legacy_tweaks_remain_restorable() {
    let dir = temp();
    let ids = json!([
        "game-mode",
        "game-capture",
        "mouse-acceleration",
        "transparency",
        "advertising",
        "tailored",
        "tips",
        "welcome",
        "suggestions",
        "high-performance"
    ]);
    let memory = Memory::with(vec![json!({"type":"power","value":BALANCED})], json!({}));
    let after: Vec<Value> = operations_for(&validate_recovery_ids(&ids).unwrap(), &json!({}))
        .unwrap()
        .into_iter()
        .map(|mut o| {
            if o["type"] == "registry" {
                o["exists"] = json!(true);
            }
            o
        })
        .collect();
    let before = memory.snapshot(&after);
    // Legacy entries have no "format" field and are checked by shape.
    atomic_json(&dir.0.join("recovery.json"), &json!([{"id":"legacy-change","date":"2025-01-01T00:00:00.000Z","ids":ids,"names":ids,"before":before,"after":after,"status":"applied"}])).unwrap();
    memory.store(&after);
    let e = engine(&dir, &memory);
    assert_eq!(e.history().unwrap()[0]["ids"].as_array().unwrap().len(), 10);
    e.restore("legacy-change").unwrap();
    assert!(deep_eq(&memory.snapshot(&after), &before));
}

/// A recovery.json written by the Electron engine restores through the Rust
/// engine and returns the simulated PC to its exact original state.
#[test]
fn electron_written_journals_restore_exactly() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/electron-journal.json")).unwrap();
    let dir = temp();
    std::fs::write(
        dir.0.join("recovery.json"),
        fixture["journal"].as_str().unwrap(),
    )
    .unwrap();
    let memory = Memory::with(fixture["state"].as_array().unwrap().clone(), json!({}));
    let e = engine(&dir, &memory);
    assert_eq!(e.history().unwrap().len(), 5);
    for id in fixture["restoreOrder"].as_array().unwrap() {
        e.restore(id.as_str().unwrap()).unwrap();
    }
    let initial = fixture["initial"].as_array().unwrap();
    assert!(deep_eq(
        &memory.snapshot(initial),
        &Value::Array(initial.clone())
    ));
    let values = memory.values.lock().unwrap();
    assert_eq!(
        values.len(),
        initial.len(),
        "no setting was left behind: {:?}",
        values.keys().collect::<Vec<_>>()
    );
    drop(values);
    let j = journal(&dir);
    assert!(j
        .as_array()
        .unwrap()
        .iter()
        .all(|x| x["status"] == "restored"));
}

#[test]
fn service_batches_keep_original_startup_running_and_delay() {
    let dir = temp();
    let originals = vec![
        json!({"type":"service","name":"WSearch","value":{"startup":2,"running":true,"delayed":{"exists":true,"kind":"DWord","value":1}}}),
        json!({"type":"service","name":"SysMain","value":{"startup":2,"running":true,"delayed":{"exists":false}}}),
        json!({"type":"service","name":"DiagTrack","value":{"startup":3,"running":false,"delayed":{"exists":false}}}),
    ];
    let context = json!({"services": [{"name":"WSearch","available":true},{"name":"SysMain","available":true},{"name":"DiagTrack","available":true}]});
    let memory = Memory::with(originals.clone(), context);
    let e = engine(&dir, &memory);
    let entry = e.apply(&json!(["lean-services"])).unwrap();
    for (o, original) in entry["after"].as_array().unwrap().iter().zip(&originals) {
        assert_eq!(o["value"]["startup"], 4);
        assert_eq!(o["value"]["running"], false);
        assert_eq!(o["value"]["delayed"], original["value"]["delayed"]);
    }
    e.restore(entry["id"].as_str().unwrap()).unwrap();
    assert!(deep_eq(
        &memory.snapshot(&originals),
        &Value::Array(originals.clone())
    ));
}
