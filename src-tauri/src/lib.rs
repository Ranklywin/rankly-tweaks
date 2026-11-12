//! Rankly Tweaks native backend. The interface calls these commands through a
//! small bridge (src/bridge.ts); every system change goes through the
//! allowlisted, journaled engine. Commands never accept scripts, paths, or URLs.
pub mod apps;
pub mod catalog;
pub mod engine;
pub mod js;
pub mod ops;
pub mod ps;
pub mod scripts;
pub mod system;

use apps::SessionApps;
use catalog::CATALOG;
use engine::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub engine: Engine,
    pub apps: SessionApps,
    network_busy: AtomicBool,
}

type Shared = Arc<AppState>;

/// Same directory the Electron version used, so existing backups stay restorable.
fn data_directory() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("rankly-tweaks")
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn status(state: tauri::State<'_, Shared>) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        let run: &system::Runner = &system::powershell;
        let (system, states, history, checkup) = std::thread::scope(|s| {
            let system = s.spawn(|| system::system_info(run, true));
            let states = s.spawn(|| system::scan_settings(run));
            let checkup = s.spawn(|| system::checkup(run));
            let history = state.engine.history();
            let join = |h: std::thread::ScopedJoinHandle<'_, Result<Value, String>>| {
                h.join()
                    .unwrap_or_else(|_| Err("A system read stopped unexpectedly.".into()))
            };
            (join(system), join(states), history, join(checkup))
        });
        let errors: Vec<String> = [
            system.as_ref().err(),
            states.as_ref().err(),
            history.as_ref().err(),
        ]
        .into_iter()
        .flatten()
        .cloned()
        .collect();
        // A failed checkup leaves the rest of the scan usable; the panel shows it as unavailable.
        Ok(json!({
            "system": system.ok(),
            "states": states.unwrap_or_else(|_| json!({})),
            "history": history.unwrap_or_default(),
            "checkupRaw": checkup.ok(),
            "errors": errors,
        }))
    })
    .await
}

#[tauri::command]
async fn session_apps(state: tauri::State<'_, Shared>) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || state.apps.scan()).await
}

#[tauri::command]
async fn close_apps(state: tauri::State<'_, Shared>, tokens: Value) -> Result<Value, String> {
    let state = state.inner().clone();
    if state.engine.busy() {
        return Err("Wait for your settings change to finish.".into());
    }
    blocking(move || state.apps.close(&tokens)).await
}

#[tauri::command]
async fn apply(state: tauri::State<'_, Shared>, ids: Value) -> Result<Value, String> {
    let state = state.inner().clone();
    if state.apps.busy() {
        return Err("Wait for app closing to finish.".into());
    }
    blocking(move || state.engine.apply(&ids)).await
}

#[tauri::command]
async fn restore(state: tauri::State<'_, Shared>, id: Value) -> Result<Value, String> {
    let state = state.inner().clone();
    if state.apps.busy() {
        return Err("Wait for app closing to finish.".into());
    }
    let id = id.as_str().ok_or("Invalid backup.")?.to_string();
    blocking(move || state.engine.restore(&id)).await
}

#[tauri::command]
async fn network(state: tauri::State<'_, Shared>, target: Value) -> Result<Value, String> {
    let state = state.inner().clone();
    if state.network_busy.swap(true, Ordering::SeqCst) {
        return Err("A connection test is already running.".into());
    }
    let target = target.as_str().unwrap_or_default().to_string();
    let result = blocking(move || system::ping(&system::powershell, &target)).await;
    state.network_busy.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let guide = CATALOG
        .guides
        .iter()
        .find(|g| g.id == id)
        .ok_or("Unknown settings page.")?;
    app.opener()
        .open_url(&guide.uri, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_source(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let link = CATALOG
        .links
        .iter()
        .find(|l| l.id == id)
        .filter(|l| l.source.starts_with("https://"))
        .ok_or("No source for this link.")?;
    app.opener()
        .open_url(&link.source, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_report(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("Export your Rankly report")
            .set_file_name("Rankly-system-report.json")
            .add_filter("JSON report", &["json"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        let run: &system::Runner = &system::powershell;
        let report = json!({
            "version": 1,
            "exportedAt": engine::now_iso(),
            "system": system::system_info(run, false)?,
            "states": system::scan_settings(run)?,
            "history": state.engine.history()?,
            "checkup": system::checkup(run).ok(),
        });
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(path.file_name().map(|n| n.to_string_lossy().to_string()))
    })
    .await
}

pub fn run() {
    let state: Shared = Arc::new(AppState {
        engine: Engine::new(&data_directory(), Box::new(system::WindowsAdapter)),
        apps: SessionApps::new(Box::new(system::WindowsApps)),
        network_busy: AtomicBool::new(false),
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Shared>();
                if state.engine.busy() || state.apps.busy() {
                    api.prevent_close();
                    window
                        .dialog()
                        .message("Please wait for this operation to finish.")
                        .kind(MessageDialogKind::Info)
                        .show(|_| {});
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            status,
            session_apps,
            close_apps,
            apply,
            restore,
            network,
            open_settings,
            open_source,
            export_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rankly Tweaks");
}
