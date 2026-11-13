//! NVIDIA driver, MPO, and hybrid-CPU controls: support checks, exact values,
//! backup validation, and full apply/restore cycles against in-memory systems.
use rankly_tweaks_lib::catalog::{validate_recovery_ids, validate_tweak_ids, Tweak, CATALOG};
use rankly_tweaks_lib::engine::{Adapter, Engine};
use rankly_tweaks_lib::js::deep_eq;
use rankly_tweaks_lib::nvapi::{Drs, Snapshot};
use rankly_tweaks_lib::ops::*;
use rankly_tweaks_lib::system::{read_operations_with, write_operations_with};
use rankly_tweaks_lib::win::{efficiency_classes, gsync_frame_cap};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PRERENDER: u32 = 0x007B_A09E;
const POWER_MODE: u32 = 0x1057_EB71;
const VSYNC: u32 = 0x00A8_79CF;
const LIMITER: u32 = 0x1083_5002;
const VSYNC_ON: u32 = 0x4781_4940;
const CPU: &str = "54533251-82be-4824-96c1-47b60b740d00";
const SCHED: &str = "93b8b6dc-0698-4d1c-9ee4-0644e900c85d";
const SCHEME: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

fn tweak(id: &str) -> Tweak {
    validate_tweak_ids(&json!([id])).unwrap().remove(0)
}

fn context(nvidia: Value) -> Value {
    json!({"build": 26100, "admin": true, "scheme": SCHEME, "nvidia": nvidia, "hybrid": true,
        "powerValues": [{"scheme": SCHEME, "subgroup": CPU, "setting": SCHED, "value": 5, "available": true}]})
}

fn nv(vrr: bool) -> Value {
    json!({"available": true, "vrrPossible": vrr, "vrrOn": vrr, "frameCap": 224})
}

#[test]
fn nvidia_controls_resolve_documented_values_only_with_a_driver() {
    let ctx = context(nv(true));
    assert_eq!(
        operations_for(&[tweak("nvidia-low-latency")], &ctx).unwrap(),
        vec![json!({"type":"nvidia-setting","setting":PRERENDER,"value":1})]
    );
    assert_eq!(
        operations_for(&[tweak("nvidia-max-performance")], &ctx).unwrap(),
        vec![json!({"type":"nvidia-setting","setting":POWER_MODE,"value":1})]
    );
    assert_eq!(
        operations_for(&[tweak("nvidia-gsync-latency")], &ctx).unwrap(),
        vec![
            json!({"type":"nvidia-setting","setting":VSYNC,"value":VSYNC_ON}),
            json!({"type":"nvidia-setting","setting":LIMITER,"value":224})
        ]
    );
    for id in [
        "nvidia-low-latency",
        "nvidia-max-performance",
        "nvidia-gsync-latency",
    ] {
        assert_eq!(unavailable_reason(&tweak(id), &ctx).unwrap(), "");
        let none = context(json!({"available": false}));
        assert_eq!(
            unavailable_reason(&tweak(id), &none).unwrap(),
            "No NVIDIA graphics driver detected"
        );
        assert!(operations_for(&[tweak(id)], &none).unwrap().is_empty());
        assert_eq!(
            unavailable_reason(&tweak(id), &json!({})).unwrap(),
            "No NVIDIA graphics driver detected"
        );
    }
}

#[test]
fn gsync_setup_needs_gsync_on_and_a_usable_frame_cap() {
    let t = tweak("nvidia-gsync-latency");
    assert_eq!(
        unavailable_reason(&t, &context(nv(false))).unwrap(),
        "Turn on G-SYNC for your main display in the NVIDIA app first"
    );
    // No refresh rate means no cap: the whole control is unavailable, not half-applied.
    let no_cap = context(json!({"available": true, "vrrOn": true}));
    assert!(operations_for(std::slice::from_ref(&t), &no_cap)
        .unwrap()
        .is_empty());
    assert_eq!(
        unavailable_reason(&t, &no_cap).unwrap(),
        "Not exposed by your hardware"
    );
    assert!(operations_for(
        &[t],
        &context(json!({"available": true, "vrrOn": true, "frameCap": 5000}))
    )
    .unwrap()
    .is_empty());
}

#[test]
fn frame_cap_stays_inside_the_gsync_range() {
    assert_eq!(gsync_frame_cap(240), Some(224));
    assert_eq!(gsync_frame_cap(144), Some(138));
    assert_eq!(gsync_frame_cap(165), Some(157));
    assert_eq!(gsync_frame_cap(60), Some(57));
    assert_eq!(gsync_frame_cap(360), Some(324));
    assert_eq!(gsync_frame_cap(0), None);
    assert_eq!(gsync_frame_cap(30), None);
    for hz in 48..=500 {
        let cap = gsync_frame_cap(hz).unwrap();
        assert!(cap + 3 <= hz && cap > hz / 2, "{hz} Hz -> {cap}");
    }
}

#[test]
fn nvidia_snapshots_materialize_compare_and_validate_exactly() {
    let t = tweak("nvidia-gsync-latency");
    let ops = operations_for(std::slice::from_ref(&t), &context(nv(true))).unwrap();
    let before = vec![
        json!({"type":"nvidia-setting","setting":VSYNC,"exists":false}),
        json!({"type":"nvidia-setting","setting":LIMITER,"exists":true,"value":0}),
    ];
    let after = materialize_operations(&ops, &before).unwrap();
    assert_eq!(
        after[1],
        json!({"type":"nvidia-setting","setting":LIMITER,"value":224,"exists":true})
    );
    assert!(!equal_operations(&after, &Value::Array(before.clone())).unwrap());
    assert!(equal_operations(&after, &Value::Array(after.clone())).unwrap());
    assert!(equal_operations(
        &before[..1],
        &json!([{"type":"nvidia-setting","setting":VSYNC,"exists":false}])
    )
    .unwrap());
    assert!(!equal_operations(
        &before[..1],
        &json!([{"type":"nvidia-setting","setting":VSYNC,"exists":true,"value":0}])
    )
    .unwrap());
    let entry = json!({"before": before, "after": after});
    validate_backup_operations(&entry, std::slice::from_ref(&t)).unwrap();
    // Tampering is refused: other values, other settings, missing parts.
    let mut wrong_value = entry.clone();
    wrong_value["after"][0]["value"] = json!(1);
    assert_eq!(
        validate_backup_operations(&wrong_value, std::slice::from_ref(&t)).unwrap_err(),
        "The NVIDIA backup contains an unexpected change."
    );
    let mut big_cap = entry.clone();
    big_cap["after"][1]["value"] = json!(5000);
    assert_eq!(
        validate_backup_operations(&big_cap, std::slice::from_ref(&t)).unwrap_err(),
        "The NVIDIA backup contains an unexpected change."
    );
    let mut foreign = entry.clone();
    foreign["before"][0]["setting"] = json!(0x1234_5678);
    foreign["after"][0]["setting"] = json!(0x1234_5678);
    assert_eq!(
        validate_backup_operations(&foreign, std::slice::from_ref(&t)).unwrap_err(),
        "The backup does not match its original tweak definitions."
    );
    let partial = json!({"before": [entry["before"][1]], "after": [entry["after"][1]]});
    assert_eq!(
        validate_backup_operations(&partial, &[t]).unwrap_err(),
        "The backup is missing part of an NVIDIA control."
    );
    assert!(!allowed_operation(
        &json!({"type":"nvidia-setting","setting":PRERENDER,"value":-1}),
        &default_definitions()
    ));
    assert!(!allowed_operation(
        &json!({"type":"nvidia-setting","setting":"x","value":1}),
        &default_definitions()
    ));
}

#[test]
fn mpo_and_hybrid_controls_resolve_exact_settings() {
    let mpo = operations_for(&[tweak("mpo-off")], &json!({})).unwrap();
    assert_eq!(
        mpo,
        vec![
            json!({"type":"registry","path":r"HKLM:\SOFTWARE\Microsoft\Windows\Dwm","name":"OverlayTestMode","value":5,"kind":"DWord"})
        ]
    );
    let hybrid = tweak("hybrid-pcore");
    assert_eq!(
        operations_for(std::slice::from_ref(&hybrid), &context(nv(false))).unwrap(),
        vec![
            json!({"type":"power-setting","scheme":SCHEME,"subgroup":CPU,"setting":SCHED,"value":2})
        ]
    );
    let mut not_hybrid = context(nv(false));
    not_hybrid["hybrid"] = json!(false);
    assert_eq!(
        unavailable_reason(&hybrid, &not_hybrid).unwrap(),
        "Requires a CPU with performance and efficiency cores"
    );
    assert!(hybrid.admin);
}

#[test]
fn hybrid_cpus_are_detected_from_efficiency_classes() {
    let entry = |class: u8| {
        let mut e = vec![0u8; 32];
        e[0..4].copy_from_slice(&32u32.to_le_bytes());
        e[18] = class;
        e
    };
    let uniform: Vec<u8> = [entry(0), entry(0)].concat();
    let hybrid: Vec<u8> = [entry(0), entry(1), entry(1)].concat();
    assert_eq!(efficiency_classes(&uniform).len(), 1);
    assert_eq!(efficiency_classes(&hybrid).len(), 2);
    assert!(efficiency_classes(&[0u8; 8]).is_empty());
}

#[test]
fn vrr_left_the_library_but_old_backups_still_restore() {
    assert!(validate_tweak_ids(&json!(["windowed-vrr"])).is_err());
    assert!(!CATALOG.tweaks.iter().any(|t| t.id == "windowed-vrr"));
    let defs = validate_recovery_ids(&json!(["windowed-vrr"])).unwrap();
    let op = operations_for(&defs, &json!({})).unwrap();
    assert_eq!(op[0]["value"], "VRROptimizeEnable=1;");
}

#[derive(Clone, Default)]
struct FakeDriver(Arc<Mutex<HashMap<u32, u32>>>);

impl Drs for FakeDriver {
    fn read(&self, ids: &[u32]) -> Result<Vec<Snapshot>, String> {
        let map = self.0.lock().unwrap();
        Ok(ids
            .iter()
            .map(|id| Snapshot {
                id: *id,
                exists: map.contains_key(id),
                value: map.get(id).copied().unwrap_or(0),
            })
            .collect())
    }
    fn write(&self, changes: &[(u32, Option<u32>)]) -> Result<(), String> {
        let mut map = self.0.lock().unwrap();
        for (id, value) in changes {
            match value {
                Some(v) => map.insert(*id, *v),
                None => map.remove(id),
            };
        }
        Ok(())
    }
}

/// Registry values through a fake PowerShell runner; NVIDIA values through a fake driver.
#[derive(Clone, Default)]
struct Machine {
    registry: Arc<Mutex<Vec<String>>>,
    driver: FakeDriver,
}

impl Machine {
    fn runner(&self) -> impl Fn(&str, Duration) -> Result<Value, String> + Send + Sync + 'static {
        let registry = self.registry.clone();
        move |script: &str, _| {
            registry.lock().unwrap().push(script.to_string());
            if script.contains("ConvertTo-Json -InputObject @($result)") {
                Ok(
                    json!([{"type":"registry","path":r"HKLM:\SOFTWARE\Microsoft\Windows\Dwm","name":"OverlayTestMode","exists":false}]),
                )
            } else {
                Ok(json!({"success": true}))
            }
        }
    }
}

#[test]
fn mixed_batches_split_between_powershell_and_the_driver_in_order() {
    let m = Machine::default();
    m.driver.0.lock().unwrap().insert(POWER_MODE, 2);
    let ops = vec![
        json!({"type":"nvidia-setting","setting":POWER_MODE,"value":1}),
        json!({"type":"registry","path":r"HKLM:\SOFTWARE\Microsoft\Windows\Dwm","name":"OverlayTestMode","value":5,"kind":"DWord"}),
        json!({"type":"nvidia-setting","setting":PRERENDER,"value":1}),
    ];
    let run = m.runner();
    let read = read_operations_with(&run, &m.driver, &ops).unwrap();
    assert_eq!(
        read[0],
        json!({"type":"nvidia-setting","setting":POWER_MODE,"exists":true,"value":2})
    );
    assert_eq!(read[1]["type"], "registry");
    assert_eq!(
        read[2],
        json!({"type":"nvidia-setting","setting":PRERENDER,"exists":false})
    );
    let scripts = m.registry.lock().unwrap().clone();
    assert_eq!(scripts.len(), 1);
    assert!(!scripts[0].contains("nvidia"));
    let after = materialize_operations(&ops, read.as_array().unwrap()).unwrap();
    write_operations_with(&run, &m.driver, &after).unwrap();
    assert_eq!(m.driver.0.lock().unwrap().get(&PRERENDER), Some(&1));
    // Restoring "no user value" removes the setting so the driver default applies.
    write_operations_with(&run, &m.driver, read.as_array().unwrap()).unwrap();
    assert_eq!(m.driver.0.lock().unwrap().get(&PRERENDER), None);
    assert_eq!(m.driver.0.lock().unwrap().get(&POWER_MODE), Some(&2));
    // Invalid NVIDIA values never reach the driver.
    let bad = vec![json!({"type":"nvidia-setting","setting":PRERENDER,"value":"1; evil"})];
    assert!(write_operations_with(&run, &m.driver, &bad).is_err());
}

struct EngineAdapter {
    driver: FakeDriver,
    context: Value,
}

impl Adapter for EngineAdapter {
    fn read(&self, ops: &[Value]) -> Result<Value, String> {
        read_operations_with(
            &|_: &str, _| Err("no PowerShell expected".into()),
            &self.driver,
            ops,
        )
    }
    fn write(&self, ops: &[Value]) -> Result<(), String> {
        write_operations_with(
            &|_: &str, _| Err("no PowerShell expected".into()),
            &self.driver,
            ops,
        )
    }
    fn resolve(&self, selected: &[Tweak]) -> Result<Vec<Value>, String> {
        operations_for(selected, &self.context)
    }
}

#[test]
fn nvidia_controls_apply_verify_and_restore_through_the_engine() {
    let dir = std::env::temp_dir().join(format!("rankly-nvidia-{}", uuid::Uuid::new_v4()));
    let driver = FakeDriver::default();
    driver.0.lock().unwrap().insert(VSYNC, 0x6092_5292);
    let engine = Engine::new(
        &dir,
        Box::new(EngineAdapter {
            driver: driver.clone(),
            context: context(nv(true)),
        }),
    );
    let entry = engine
        .apply(&json!([
            "nvidia-gsync-latency",
            "nvidia-low-latency",
            "nvidia-max-performance"
        ]))
        .unwrap();
    assert_eq!(entry["status"], "applied");
    let expected: HashMap<u32, u32> = [
        (VSYNC, VSYNC_ON),
        (LIMITER, 224),
        (PRERENDER, 1),
        (POWER_MODE, 1),
    ]
    .into();
    assert_eq!(*driver.0.lock().unwrap(), expected);
    assert_eq!(
        engine.apply(&json!(["nvidia-low-latency"])).unwrap(),
        json!({"unchanged": true})
    );
    engine.restore(entry["id"].as_str().unwrap()).unwrap();
    let restored: HashMap<u32, u32> = [(VSYNC, 0x6092_5292)].into();
    assert_eq!(*driver.0.lock().unwrap(), restored);
    let journal: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("recovery.json")).unwrap()).unwrap();
    assert!(deep_eq(
        &journal[0]["before"][0],
        &json!({"type":"nvidia-setting","setting":VSYNC,"exists":true,"value":0x6092_5292u32})
    ));
    std::fs::remove_dir_all(dir).unwrap();
}
