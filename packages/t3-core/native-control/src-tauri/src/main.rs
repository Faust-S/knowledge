#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::io::{self, Read};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PermissionResponse, WebviewWindowBuilder};
use tauri::{Url, WebviewUrl};

// The installed ORIGINAL Host writes exactly one opaque launch URL to this
// native process's stdin, then closes the pipe. Neither CLI arguments nor
// environment variables can carry the Control bearer. A standalone start
// displays a truthful disconnected screen, with no fake PERSONAL/CORP grant.
fn parse_signed_host_launch(raw: &str) -> Option<Url> {
    let trimmed = raw.trim();
    if trimmed.len() < 65 || trimmed.len() > 512 || trimmed.contains('\n')
        || trimmed.contains('\r')
    {
        return None;
    }
    let url = Url::parse(trimmed).ok()?;
    let bearer = url.fragment()?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/workspace/"
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || !(40..=128).contains(&bearer.len())
        || !bearer
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return None;
    }
    Some(url)
}

fn original_host_launch() -> Option<Url> {
    // A GUI application opened normally has no trusted stdin connection.
    // A silent or unresponsive pipe must never freeze the native window.
    let (tx, rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut raw = String::new();
        let valid = io::stdin()
            .take(1025)
            .read_to_string(&mut raw)
            .ok()
            .filter(|bytes| *bytes <= 1024)
            .and_then(|_| parse_signed_host_launch(&raw));
        let _ = tx.send(valid);
    });
    rx.recv_timeout(Duration::from_millis(2500)).ok().flatten()
}

fn main() {
    let signed = original_host_launch();
    tauri::Builder::default()
        .setup(move |app| {
            let base = if let Some(url) = signed {
                let allowed_origin = url.origin().ascii_serialization();
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                    .on_navigation(move |next| {
                        next.origin().ascii_serialization() == allowed_origin
                            && next.path().starts_with("/workspace/")
                    })
            } else {
                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
            };
            // One native window, no browser launch, additional windows,
            // privileged WebView2 permissions or extra native IPC commands.
            base.title("IWXA T3 Control")
                .inner_size(1170.0, 790.0)
                .min_inner_size(820.0, 620.0)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("IWXA T3 native Control startup failed");
}

#[cfg(test)]
mod tests {
    use super::parse_signed_host_launch;

    #[test]
    fn accepts_only_pinned_loopback_workspace_with_bearer() {
        let valid = format!("http://127.0.0.1:38421/workspace/#{}", "A".repeat(48));
        assert!(parse_signed_host_launch(&valid).is_some());
        assert!(parse_signed_host_launch(&(valid.clone() + "\n")).is_some());
        assert!(parse_signed_host_launch(&(valid.clone() + "\nother")).is_none());
    }

    #[test]
    fn refuses_untrusted_urls_and_missing_control_bearers() {
        let token = "A".repeat(48);
        for value in [
            format!("https://example.com/workspace/#{token}"),
            format!("http://localhost:38421/workspace/#{token}"),
            format!("http://127.0.0.1:38421/workspace/"),
            format!("http://127.0.0.1:38421/workspace/other#{token}"),
            format!("http://127.0.0.1:38421/workspace/?debug=1#{token}"),
            format!("http://admin@127.0.0.1:38421/workspace/#{token}"),
            format!("http://127.0.0.1:38421/workspace/#{token}%20"),
            "http://127.0.0.1:38421/workspace/#short".to_string(),
        ] {
            assert!(parse_signed_host_launch(&value).is_none(), "{value}");
        }
    }
}
