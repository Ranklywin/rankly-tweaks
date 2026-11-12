//! Windows reads and the real adapters (port of electron/windows.mjs and capabilities.mjs).
use crate::apps::AppAdapter;
use crate::catalog::{Tweak, CATALOG};
use crate::engine::Adapter;
use crate::js::{get, truthy};
use crate::ops::{equal_operations, operations_for, security_tweak_state, unavailable_reason};
use crate::ps;
use crate::scripts;
use serde_json::{json, Map, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub type Runner = dyn Fn(&str, Duration) -> Result<Value, String> + Send + Sync;

static GRAPHICS: OnceLock<Value> = OnceLock::new();

fn graphics_support(run: &Runner) -> Value {
    GRAPHICS
        .get_or_init(|| {
            let report = std::env::temp_dir()
                .join(format!("rankly-capabilities-{}.xml", uuid::Uuid::new_v4()));
            run(
                &scripts::graphics_script(&report.to_string_lossy()),
                Duration::from_secs(30),
            )
            .unwrap_or(Value::Bool(false))
        })
        .clone()
}

/// Reads everything support checks need. Nothing changes during discovery.
pub fn capabilities(run: &Runner) -> Result<Value, String> {
    let (main, graphics) = std::thread::scope(|s| {
        let graphics = s.spawn(|| graphics_support(run));
        let main = run(&scripts::capabilities_script(), ps::DEFAULT_TIMEOUT);
        (main, graphics.join().unwrap_or(Value::Bool(false)))
    });
    let mut context = main?
        .as_object()
        .cloned()
        .ok_or("Windows returned an unreadable response. No success was assumed.")?;
    let hags = graphics == Value::Bool(true) || get(&graphics, "hags") == Some(&Value::Bool(true));
    let vrr = get(&graphics, "wddm")
        .and_then(Value::as_f64)
        .is_some_and(|w| w >= 206.0);
    context.insert("hags".into(), json!(hags));
    context.insert("vrr".into(), json!(vrr));
    Ok(Value::Object(context))
}

pub fn read_operations(run: &Runner, operations: &[Value]) -> Result<Value, String> {
    run(
        &scripts::build_read_script(operations)?,
        ps::DEFAULT_TIMEOUT,
    )
}

pub fn write_operations(run: &Runner, operations: &[Value]) -> Result<(), String> {
    let timeout = if operations
        .iter()
        .any(|o| get(o, "type") == Some(&json!("service")))
    {
        Duration::from_secs(90)
    } else {
        ps::DEFAULT_TIMEOUT
    };
    run(&scripts::build_write_script(operations)?, timeout).map(|_| ())
}

pub fn resolve_operations(run: &Runner, selected: &[Tweak]) -> Result<Vec<Value>, String> {
    let context = capabilities(run)?;
    // Validate against the same destination plan that operations_for will write.
    let mut target = context.clone();
    if let Some(power) = selected.iter().find_map(|t| t.power.clone()) {
        target["scheme"] = json!(power);
    }
    for t in selected {
        let reason = unavailable_reason(t, &target)?;
        if !reason.is_empty() {
            return Err(format!("{}: {reason}.", t.name));
        }
        if t.admin && !truthy(get(&context, "admin")) {
            return Err("Open Rankly as administrator to apply system tweaks.".into());
        }
    }
    let operations = operations_for(selected, &context)?;
    if operations.is_empty() {
        return Err("No supported changes were found.".into());
    }
    Ok(operations)
}

fn state(enabled: bool, available: bool, reason: Option<&str>, current: Value) -> Value {
    let mut s = Map::new();
    s.insert("enabled".into(), json!(enabled));
    s.insert("available".into(), json!(available));
    if let Some(r) = reason {
        s.insert("reason".into(), json!(r));
    }
    s.insert("current".into(), current);
    Value::Object(s)
}

/// Reports each tweak's support and whether it is already configured.
pub fn scan_settings(run: &Runner) -> Result<Value, String> {
    let context = capabilities(run)?;
    let mut states = Map::new();
    let mut supported: Vec<&Tweak> = Vec::new();
    for t in &CATALOG.tweaks {
        let reason = unavailable_reason(t, &context)?;
        if !reason.is_empty() {
            states.insert(t.id.clone(), state(false, false, Some(&reason), json!([])));
        } else {
            supported.push(t);
        }
    }
    let mut groups = Vec::new();
    for t in &supported {
        groups.push(operations_for(std::slice::from_ref(*t), &context)?);
    }
    let all: Vec<Value> = groups.iter().flatten().cloned().collect();
    let combined = (|| -> Result<Vec<(String, Value)>, String> {
        let actual = read_operations(run, &all)?
            .as_array()
            .cloned()
            .ok_or("Unreadable")?;
        let mut offset = 0;
        let mut out = Vec::new();
        for (t, expected) in supported.iter().zip(&groups) {
            let end = (offset + expected.len()).min(actual.len());
            let current = Value::Array(actual[offset.min(end)..end].to_vec());
            offset += expected.len();
            out.push((
                t.id.clone(),
                state(equal_operations(expected, &current)?, true, None, current),
            ));
        }
        Ok(out)
    })();
    match combined {
        Ok(results) => {
            for (id, value) in results {
                states.insert(id, value);
            }
        }
        Err(_) => {
            // Per-control reads keep one missing driver or inaccessible setting from hiding the library.
            for (t, expected) in supported.iter().zip(&groups) {
                let result = read_operations(run, expected)
                    .and_then(|current| Ok((equal_operations(expected, &current)?, current)));
                let value = match result {
                    Ok((enabled, current)) => state(enabled, true, None, current),
                    Err(_) => state(
                        false,
                        false,
                        Some("Windows could not read this setting"),
                        json!([]),
                    ),
                };
                states.insert(t.id.clone(), value);
            }
        }
    }
    for t in &CATALOG.tweaks {
        let current = states.shift_remove(&t.id).unwrap_or(Value::Null);
        states.insert(t.id.clone(), security_tweak_state(t, current, &context));
    }
    Ok(Value::Object(states))
}

static SYSTEM_CACHE: Mutex<Option<(Instant, Value)>> = Mutex::new(None);

pub fn system_info(run: &Runner, force: bool) -> Result<Value, String> {
    if !force {
        if let Some((at, value)) = SYSTEM_CACHE.lock().unwrap().as_ref() {
            if at.elapsed() < Duration::from_secs(30) {
                return Ok(value.clone());
            }
        }
    }
    let mut detected = run(scripts::SYSTEM, ps::DEFAULT_TIMEOUT)?
        .as_object()
        .cloned()
        .ok_or("Windows returned an unreadable response. No success was assumed.")?;
    detected.insert("platform".into(), json!("win32"));
    detected.insert("appVersion".into(), json!(CATALOG.version));
    let value = Value::Object(detected);
    *SYSTEM_CACHE.lock().unwrap() = Some((Instant::now(), value.clone()));
    Ok(value)
}

pub fn ping(run: &Runner, target: &str) -> Result<Value, String> {
    run(&scripts::ping_script(target)?, Duration::from_secs(20))
}

/// Raw hardware snapshot; the interface turns it into checkup findings.
pub fn checkup(run: &Runner) -> Result<Value, String> {
    run(scripts::CHECKUP, Duration::from_secs(30))
}

pub fn powershell(script: &str, timeout: Duration) -> Result<Value, String> {
    ps::run(script, timeout)
}

pub struct WindowsAdapter;

impl Adapter for WindowsAdapter {
    fn read(&self, operations: &[Value]) -> Result<Value, String> {
        read_operations(&powershell, operations)
    }
    fn write(&self, operations: &[Value]) -> Result<(), String> {
        write_operations(&powershell, operations)
    }
    fn resolve(&self, selected: &[Tweak]) -> Result<Vec<Value>, String> {
        resolve_operations(&powershell, selected)
    }
}

pub struct WindowsApps;

impl AppAdapter for WindowsApps {
    fn list(&self) -> Result<Value, String> {
        powershell(&scripts::app_snapshot_script(), ps::DEFAULT_TIMEOUT)
    }
    fn close(&self, processes: &[Value]) -> Result<Value, String> {
        powershell(
            &scripts::close_apps_script(processes)?,
            Duration::from_secs(60),
        )
    }
}
