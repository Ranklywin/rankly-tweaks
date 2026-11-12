fn main() {
    // Release builds always run elevated, like the Electron portable build did.
    // Debug builds and `cargo test` stay unelevated so development and CI work.
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    let mut windows = tauri_build::WindowsAttributes::new();
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        windows = windows.app_manifest(include_str!("windows-app-manifest.xml"));
    }
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
