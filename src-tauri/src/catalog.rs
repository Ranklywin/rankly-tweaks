//! Tweak definitions exported from shared/catalog.mjs (see scripts/export-catalog.mjs).
use serde::Deserialize;
use serde_json::{Map, Value};
use std::sync::LazyLock;

#[derive(Debug, Clone, Deserialize)]
pub struct RegSetting {
    pub path: String,
    pub name: String,
    pub value: Value,
    pub kind: String,
    #[serde(default)]
    pub transform: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PowerSetting {
    pub subgroup: String,
    pub setting: String,
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NetworkSetting {
    pub keyword: String,
    pub value: Vec<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WifiSetting {
    pub keyword: String,
    pub target: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tweak {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub admin: bool,
    pub min_build: Option<f64>,
    #[serde(default)]
    pub pro_only: bool,
    pub hardware: Option<String>,
    pub operations: Option<Vec<RegSetting>>,
    pub power: Option<String>,
    #[serde(default)]
    pub require_all_power_settings: bool,
    pub power_settings: Option<Vec<PowerSetting>>,
    pub network_settings: Option<Vec<NetworkSetting>>,
    pub services: Option<Vec<String>>,
    pub keyboard_shortcuts: Option<Vec<String>>,
    pub wifi_setting: Option<WifiSetting>,
    /// Per-game GPU preference saved by older versions (recovery only).
    #[serde(skip)]
    pub game_preference: bool,
    #[serde(skip)]
    pub game_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Guide {
    pub id: String,
    pub uri: String,
}

#[derive(Debug, Deserialize)]
pub struct Link {
    pub id: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct BackgroundApp {
    pub name: String,
    pub executables: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: String,
    pub tweaks: Vec<Tweak>,
    pub recovery_tweaks: Vec<Tweak>,
    pub guides: Vec<Guide>,
    pub links: Vec<Link>,
    pub power_controls: Map<String, Value>,
    pub network_controls: Map<String, Value>,
    pub wifi_controls: Map<String, Value>,
    pub keyboard_shortcuts: Vec<String>,
    pub lean_services: Vec<String>,
    pub background_apps: Vec<BackgroundApp>,
    pub retired_tweak_ids: Vec<String>,
    pub memory_integrity_path: String,
    pub game_gpu_registry: String,
}

pub static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../catalog.json")).expect("catalog.json is valid")
});

pub const GAME_GPU_ID: &str = "game-gpu-preference";

/// The recovery-only definition that allows any saved per-game GPU preference.
pub fn game_preference_recovery() -> Tweak {
    Tweak {
        id: GAME_GPU_ID.into(),
        name: "Game GPU preference".into(),
        game_preference: true,
        ..Default::default()
    }
}

fn select<'a>(ids: &Value, catalog: &'a [Tweak]) -> Result<Vec<&'a Tweak>, String> {
    let invalid = || "Choose valid, unique tweaks from the library.".to_string();
    let list = ids.as_array().ok_or_else(invalid)?;
    if list.is_empty() || list.len() > catalog.len() {
        return Err(invalid());
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for id in list {
        let id = id.as_str().ok_or_else(invalid)?;
        let tweak = catalog.iter().find(|t| t.id == id).ok_or_else(invalid)?;
        seen.insert(id);
        out.push(tweak);
    }
    if seen.len() != list.len() {
        return Err(invalid());
    }
    Ok(out)
}

pub fn validate_tweak_ids(ids: &Value) -> Result<Vec<Tweak>, String> {
    select(ids, &CATALOG.tweaks).map(|v| v.into_iter().cloned().collect())
}

pub fn validate_recovery_ids(ids: &Value) -> Result<Vec<Tweak>, String> {
    select(ids, &CATALOG.recovery_tweaks).map(|v| v.into_iter().cloned().collect())
}

pub fn power_controls(id: &str) -> Vec<PowerSetting> {
    CATALOG
        .power_controls
        .get(id)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Every distinct power setting the catalog can read, in catalog order.
pub fn all_power_settings() -> Vec<PowerSetting> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for list in CATALOG.power_controls.values() {
        let settings: Vec<PowerSetting> = serde_json::from_value(list.clone()).unwrap_or_default();
        for s in settings {
            if seen.insert(format!("{}/{}", s.subgroup, s.setting)) {
                out.push(s);
            }
        }
    }
    out
}

/// Every distinct Ethernet driver keyword the catalog can read, in catalog order.
pub fn network_keywords() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for list in CATALOG.network_controls.values() {
        for item in list.as_array().into_iter().flatten() {
            if let Some(k) = item.get("keyword").and_then(Value::as_str) {
                if !out.iter().any(|x| x == k) {
                    out.push(k.to_string());
                }
            }
        }
    }
    out
}

pub fn wifi_keywords() -> Vec<String> {
    CATALOG
        .wifi_controls
        .values()
        .filter_map(|v| v.get("keyword").and_then(Value::as_str).map(String::from))
        .collect()
}

pub fn is_retired_backup(entry: &Value) -> bool {
    entry
        .get("ids")
        .and_then(Value::as_array)
        .is_some_and(|ids| {
            ids.iter().any(|id| {
                id.as_str()
                    .is_some_and(|s| CATALOG.retired_tweak_ids.iter().any(|r| r == s))
            })
        })
}
