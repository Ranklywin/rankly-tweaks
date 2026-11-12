//! Recovery journal and transactional apply/restore (port of electron/engine.mjs).
//! The journal stays at %APPDATA%\rankly-tweaks\recovery.json in the same
//! format, so backups made by the Electron version restore unchanged.
use crate::catalog::{
    is_retired_backup, validate_recovery_ids, validate_tweak_ids, Tweak, CATALOG,
};
use crate::js::{array, get, get_str};
use crate::ops::{
    equal_operations, game_recovery_definitions, materialize_operations, operations_for,
    validate_backup_operations,
};
use crate::scripts::build_write_script;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub trait Adapter: Send + Sync {
    fn read(&self, operations: &[Value]) -> Result<Value, String>;
    fn write(&self, operations: &[Value]) -> Result<(), String>;
    /// Resolves supported operations for the selected tweaks on this PC.
    fn resolve(&self, selected: &[Tweak]) -> Result<Vec<Value>, String> {
        operations_for(selected, &json!({}))
    }
}

const JOURNAL_ERROR: &str = "The recovery journal could not be read. Preserve recovery.json and resolve the file error before making changes.";
const STATUSES: [&str; 5] = [
    "prepared",
    "applied",
    "restored",
    "rolled-back",
    "recovery-needed",
];

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn valid_date(v: Option<&Value>) -> bool {
    let Some(s) = v.and_then(Value::as_str) else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(s).is_ok()
        || chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f").is_ok()
        || chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// Writes JSON durably: temporary file, flush to disk, then atomic replace.
pub fn atomic_json(file: &Path, data: &Value) -> Result<(), String> {
    let dir = file.parent().ok_or("Invalid journal path.")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temporary = file.with_file_name(format!(
        "{}.{}.tmp",
        file.file_name().unwrap().to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut handle = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        handle
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        handle.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&temporary, file).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        e.to_string()
    })
}

fn is_active(entry: &Value) -> bool {
    !is_retired_backup(entry)
        && get_str(entry, "status")
            .is_some_and(|s| ["prepared", "applied", "recovery-needed"].contains(&s))
}

fn definitions_for(entry: &Value) -> Result<Vec<Tweak>, String> {
    match game_recovery_definitions(entry)? {
        Some(defs) => Ok(defs),
        None => validate_recovery_ids(get(entry, "ids").unwrap_or(&Value::Null)),
    }
}

pub struct Engine {
    file: PathBuf,
    adapter: Box<dyn Adapter>,
    busy: AtomicBool,
}

struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Engine {
    pub fn new(directory: &Path, adapter: Box<dyn Adapter>) -> Self {
        Self {
            file: directory.join("recovery.json"),
            adapter,
            busy: AtomicBool::new(false),
        }
    }

    pub fn busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    pub fn read_journal(&self) -> Result<Vec<Value>, String> {
        let text = match std::fs::read_to_string(&self.file) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(JOURNAL_ERROR.into()),
        };
        let parse = || -> Result<Vec<Value>, String> {
            let entries: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let entries = entries.as_array().ok_or("Invalid journal")?.clone();
            let valid = |e: &Value| {
                e.is_object()
                    && get(e, "id").is_some_and(Value::is_string)
                    && valid_date(get(e, "date"))
                    && array(get(e, "names")).is_some_and(|n| n.iter().all(Value::is_string))
                    && array(get(e, "ids")).is_some()
                    && array(get(e, "before")).is_some()
                    && array(get(e, "after")).is_some()
                    && get_str(e, "status").is_some_and(|s| STATUSES.contains(&s))
            };
            if !entries.iter().all(valid) {
                return Err("Invalid journal".into());
            }
            for entry in &entries {
                let ids = array(get(entry, "ids")).unwrap();
                if is_retired_backup(entry) {
                    let remaining: Vec<Value> = ids
                        .iter()
                        .filter(|id| {
                            !id.as_str()
                                .is_some_and(|s| CATALOG.retired_tweak_ids.iter().any(|r| r == s))
                        })
                        .cloned()
                        .collect();
                    if !remaining.is_empty() {
                        validate_recovery_ids(&Value::Array(remaining))?;
                    }
                } else {
                    definitions_for(entry)?;
                }
                if array(get(entry, "names")).unwrap().len() != ids.len() {
                    return Err("Incomplete journal metadata".into());
                }
            }
            Ok(entries)
        };
        parse().map_err(|_| JOURNAL_ERROR.to_string())
    }

    /// Entries the interface shows; withdrawn controls stay on disk untouched.
    pub fn history(&self) -> Result<Vec<Value>, String> {
        Ok(self
            .read_journal()?
            .into_iter()
            .filter(|e| !is_retired_backup(e))
            .collect())
    }

    fn exclusive<T>(&self, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err("Another change is in progress. Please wait.".into());
        }
        let _guard = BusyGuard(&self.busy);
        action()
    }

    pub fn apply(&self, ids: &Value) -> Result<Value, String> {
        self.exclusive(|| {
            let selected = validate_tweak_ids(ids)?;
            self.apply_selected(&selected)
        })
    }

    fn apply_selected(&self, selected: &[Tweak]) -> Result<Value, String> {
        let mut history = self.read_journal()?;
        if history.iter().any(|e| {
            !is_retired_backup(e)
                && get_str(e, "status").is_some_and(|s| s == "prepared" || s == "recovery-needed")
        }) {
            return Err(
                "Restore the interrupted change in Recovery before applying more tweaks.".into(),
            );
        }
        let operations = self.adapter.resolve(selected)?;
        let before_value = self.adapter.read(&operations)?;
        let before = before_value
            .as_array()
            .cloned()
            .ok_or("Windows returned an unreadable response. No success was assumed.")?;
        // Validate the entire rollback path before permitting the first system write.
        build_write_script(&before)?;
        let after = materialize_operations(&operations, &before)?;
        build_write_script(&after)?;
        if equal_operations(&after, &Value::Array(before.clone()))? {
            return Ok(json!({"unchanged": true}));
        }
        let entry = json!({
            "format": 2,
            "id": uuid::Uuid::new_v4().to_string(),
            "date": now_iso(),
            "ids": selected.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
            "names": selected.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
            "before": before,
            "after": after,
            "status": "prepared",
        });
        validate_backup_operations(&entry, selected)?;
        history.push(entry);
        let index = history.len() - 1;
        atomic_json(&self.file, &Value::Array(history.clone()))?;
        let attempt = (|| -> Result<(), String> {
            self.adapter.write(&after)?;
            if !equal_operations(&after, &self.adapter.read(&after)?)? {
                return Err("Windows did not retain the requested values.".into());
            }
            history[index]["status"] = json!("applied");
            atomic_json(&self.file, &Value::Array(history.clone()))
        })();
        match attempt {
            Ok(()) => Ok(history[index].clone()),
            Err(error) => {
                history[index]["error"] = json!(error);
                let rollback = (|| -> Result<(), String> {
                    self.adapter.write(&before)?;
                    if !equal_operations(&before, &self.adapter.read(&before)?)? {
                        return Err("Rollback verification failed".into());
                    }
                    Ok(())
                })();
                let rolled_back = rollback.is_ok();
                history[index]["status"] = json!(if rolled_back {
                    "rolled-back"
                } else {
                    "recovery-needed"
                });
                atomic_json(&self.file, &Value::Array(history.clone()))?;
                Err(format!(
                    "{error} {}",
                    if rolled_back {
                        "Previous values were restored and verified."
                    } else {
                        "Open Recovery to restore the saved values."
                    }
                ))
            }
        }
    }

    pub fn restore(&self, id: &str) -> Result<Value, String> {
        self.exclusive(|| {
            let mut history = self.read_journal()?;
            let index = history
                .iter()
                .rposition(is_active)
                .filter(|i| get_str(&history[*i], "id") == Some(id))
                .ok_or("Restore the most recent change first to preserve the correct original values.")?;
            let entry = history[index].clone();
            // Journals cannot expand the native registry allowlist or invent power plans.
            let definitions = definitions_for(&entry)?;
            if get(&entry, "format").and_then(Value::as_f64) == Some(2.0) {
                validate_backup_operations(&entry, &definitions)?;
            } else {
                let expected = operations_for(&definitions, &json!({}))?;
                let before = array(get(&entry, "before")).unwrap();
                let mismatch = before.len() != expected.len()
                    || before.iter().zip(&expected).any(|(o, e)| {
                        get(o, "type") != get(e, "type")
                            || (get_str(o, "type") == Some("registry") && (get(o, "path") != get(e, "path") || get(o, "name") != get(e, "name")))
                    });
                if mismatch {
                    return Err("The backup does not match its original tweak definitions.".into());
                }
            }
            let original = array(get(&entry, "before")).unwrap().clone();
            build_write_script(&original)?;
            history[index]["status"] = json!("recovery-needed");
            atomic_json(&self.file, &Value::Array(history.clone()))?;
            self.adapter.write(&original)?;
            let current = self.adapter.read(&original)?;
            if !equal_operations(&original, &current)? {
                return Err("Some original values could not be restored. The backup has been kept; retry Recovery.".into());
            }
            history[index]["status"] = json!("restored");
            history[index]["restoredAt"] = json!(now_iso());
            atomic_json(&self.file, &Value::Array(history.clone()))?;
            Ok(history[index].clone())
        })
    }
}
