//! Runs trusted, generated PowerShell. The script is sent on stdin to a fixed
//! bootstrap, avoiding command-line length limits and argument quoting.
use base64::Engine as _;
use serde_json::Value;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const BOOTSTRAP: &str = "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $ranklyScript = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($ranklyScript))";
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

pub fn wrap(script: &str) -> String {
    format!(
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$ErrorActionPreference = 'Stop'\ntry {{\n{script}\n}} catch {{ ConvertTo-Json -InputObject @{{ ranklyError=$_.Exception.Message }} -Compress }}"
    )
}

fn powershell() -> std::path::PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    std::path::Path::new(&root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

pub fn parse_output(stdout: &str) -> Result<Value, String> {
    let text = stdout.trim().trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(text).map_err(|_| {
        "Windows returned an unreadable response. No success was assumed.".to_string()
    })?;
    if let Some(message) = value.get("ranklyError") {
        return Err(crate::js::js_string(Some(message)));
    }
    Ok(value)
}

#[cfg(windows)]
pub fn run(script: &str, timeout: Duration) -> Result<Value, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        BOOTSTRAP
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<u8>>(),
    );
    let mut child = Command::new(powershell())
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Windows PowerShell could not start: {e}"))?;
    let body = wrap(script);
    let mut stdin = child.stdin.take().expect("piped stdin");
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(body.as_bytes());
    });
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let out_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });
    let err_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        buffer
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Windows operation timed out. Check Recovery before retrying.".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let _ = writer.join();
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    if out.len() > MAX_OUTPUT {
        return Err("Windows returned too much output. No success was assumed.".into());
    }
    if !status.success() {
        let message = String::from_utf8_lossy(&err).trim().to_string();
        return Err(if message.is_empty() {
            format!(
                "Windows PowerShell exited with code {}.",
                status.code().unwrap_or(-1)
            )
        } else {
            message
        });
    }
    parse_output(&String::from_utf8_lossy(&out))
}

#[cfg(not(windows))]
pub fn run(_script: &str, _timeout: Duration) -> Result<Value, String> {
    Err("This feature requires Windows.".into())
}

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(40);
