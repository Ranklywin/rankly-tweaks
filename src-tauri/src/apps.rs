//! Background-app scan and close (port of electron/session-apps.mjs). Scans
//! hand out one-use tokens; the interface never supplies process IDs or paths.
use crate::catalog::CATALOG;
use crate::js::{get, get_str, is_integer, num};
use crate::ops::is_local_game_executable;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

static STARTED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{15,20}$").unwrap());
const TOKEN_LIFETIME: Duration = Duration::from_secs(300);

fn known_executable(name: &str) -> bool {
    CATALOG
        .background_apps
        .iter()
        .any(|a| a.executables.iter().any(|n| n.eq_ignore_ascii_case(name)))
}

pub fn valid_process(p: &Value) -> bool {
    let pid_ok = is_integer(get(p, "pid"))
        && num(get(p, "pid")).is_some_and(|n| n > 0.0 && n <= 4_294_967_295.0);
    let started_ok = get_str(p, "started").is_some_and(|s| STARTED.is_match(s));
    let Some(executable) = get_str(p, "executable") else {
        return false;
    };
    let path_ok = is_local_game_executable(get(p, "path"))
        && get_str(p, "path")
            .and_then(|path| path.rsplit('\\').next())
            .is_some_and(|file| file.to_lowercase() == executable.to_lowercase());
    pid_ok && started_ok && path_ok && known_executable(executable)
}

pub trait AppAdapter: Send + Sync {
    fn list(&self) -> Result<Value, String>;
    fn close(&self, processes: &[Value]) -> Result<Value, String>;
}

pub struct SessionApps {
    adapter: Box<dyn AppAdapter>,
    tokens: Mutex<HashMap<String, (Vec<Value>, Instant)>>,
    busy: std::sync::atomic::AtomicBool,
}

impl SessionApps {
    pub fn new(adapter: Box<dyn AppAdapter>) -> Self {
        Self {
            adapter,
            tokens: Mutex::new(HashMap::new()),
            busy: Default::default(),
        }
    }

    pub fn busy(&self) -> bool {
        self.busy.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn scan(&self) -> Result<Value, String> {
        if self.busy() {
            return Err("Wait for app closing to finish.".into());
        }
        let processes = self.adapter.list()?;
        let processes = processes
            .as_array()
            .ok_or("Could not read background apps.")?;
        let mut tokens = self.tokens.lock().unwrap();
        tokens.clear();
        let mut out = Vec::new();
        for app in &CATALOG.background_apps {
            let matches: Vec<Value> = processes
                .iter()
                .filter(|p| {
                    valid_process(p)
                        && get_str(p, "executable").is_some_and(|e| {
                            app.executables.iter().any(|n| n.eq_ignore_ascii_case(e))
                        })
                })
                .cloned()
                .collect();
            if matches.is_empty() {
                continue;
            }
            let bytes: f64 = matches
                .iter()
                .map(|p| {
                    num(get(p, "memoryBytes"))
                        .filter(|b| b.is_finite() && *b > 0.0)
                        .unwrap_or(0.0)
                })
                .sum();
            let token = uuid::Uuid::new_v4().to_string();
            let count = matches.len();
            tokens.insert(token.clone(), (matches, Instant::now() + TOKEN_LIFETIME));
            out.push(json!({"token": token, "name": app.name, "processCount": count, "memoryMB": (bytes / 1_048_576.0).round() as i64}));
        }
        Ok(Value::Array(out))
    }

    pub fn close(&self, tokens: &Value) -> Result<Value, String> {
        if self.busy() {
            return Err("Another app close is in progress.".into());
        }
        let refresh = || "Refresh the app list and choose the apps again.".to_string();
        let list = tokens.as_array().ok_or_else(refresh)?;
        let processes = {
            let mut saved = self.tokens.lock().unwrap();
            let now = Instant::now();
            let names: Vec<String> = list
                .iter()
                .map(|t| {
                    t.as_str()
                        .map(String::from)
                        .unwrap_or_else(|| format!("\u{0}{t}"))
                })
                .collect();
            let unique: std::collections::HashSet<&String> = names.iter().collect();
            if list.is_empty()
                || list.len() > CATALOG.background_apps.len()
                || unique.len() != list.len()
                || list.iter().any(|t| {
                    t.as_str()
                        .is_none_or(|t| saved.get(t).is_none_or(|(_, expires)| *expires < now))
                })
            {
                return Err(refresh());
            }
            let processes: Vec<Value> = list
                .iter()
                .flat_map(|t| saved[t.as_str().unwrap()].0.clone())
                .collect();
            // One-use tokens prevent replaying an old selection.
            saved.clear();
            processes
        };
        self.busy.store(true, std::sync::atomic::Ordering::SeqCst);
        let result = self.adapter.close(&processes);
        self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
        result
    }
}
