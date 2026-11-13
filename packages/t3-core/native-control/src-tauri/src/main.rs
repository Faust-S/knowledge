#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use serde::Deserialize;
use std::collections::HashSet;
use std::io::{self, Read, Write};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::menu::MenuBuilder;
use tauri::webview::{NewWindowResponse, PermissionResponse, WebviewWindowBuilder};
use tauri::{Url, WebviewUrl};

const LAUNCH_SCHEMA: &str = "IWXA_T3_NATIVE_CONTEXT_LAUNCH/1";
const EVENT_SCHEMA: &str = "IWXA_T3_NATIVE_CONTEXT_EVENT/1";
const MAX_LAUNCH_BYTES: usize = 64 * 1024;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeChoice {
    #[serde(rename = "selectionId")]
    selection_id: String,
    label: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeEnvelope {
    schema: String,
    url: Option<String>,
    choices: Vec<NativeChoice>,
}

#[derive(Clone)]
struct NativeLaunch {
    signed_url: Option<Url>,
    choices: Vec<NativeChoice>,
}

// Existing original Host URL, never a remote domain or arbitrary local port.
// The bearer is stripped immediately by the compiled signed Workspace.
// Native context choices are only session pointers, not IAM grants.
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

fn parse_native_launch(raw: &str) -> Option<NativeLaunch> {
    if raw.len() > MAX_LAUNCH_BYTES {
        return None;
    }
    if !raw.trim_start().starts_with('{') {
        // Compatibility with the previously qualified native Control URL.
        return Some(NativeLaunch {
            signed_url: Some(parse_signed_host_launch(raw)?),
            choices: vec![],
        });
    }
    let envelope: NativeEnvelope = serde_json::from_str(raw).ok()?;
    if envelope.schema != LAUNCH_SCHEMA || envelope.choices.len() > 128 {
        return None;
    }
    let url = match envelope.url {
        Some(url) => Some(parse_signed_host_launch(&url)?),
        None => None,
    };
    let mut ids = HashSet::new();
    for choice in &envelope.choices {
        if choice.selection_id.is_empty()
            || choice.selection_id.contains("..")
            || choice.selection_id.len() > 160
            || !choice
                .selection_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._:/@-".contains(&byte))
            || choice.label.is_empty()
            || choice.label.len() > 240
            || choice.label.trim().is_empty()
            || choice.label.contains(['\n', '\r'])
            || !ids.insert(choice.selection_id.as_str())
        {
            return None;
        }
    }
    if url.is_none() && envelope.choices.is_empty() {
        return None;
    }
    Some(NativeLaunch {
        signed_url: url,
        choices: envelope.choices,
    })
}

fn original_host_launch() -> Option<NativeLaunch> {
    // An application opened independently has no trusted stdin connection.
    // Reject oversized frames without waiting for an unbounded pipe or
    // leaking the bearer through command-line arguments or environment.
    let (tx, rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut raw = String::new();
        let valid = io::stdin()
            .take((MAX_LAUNCH_BYTES + 1) as u64)
            .read_to_string(&mut raw)
            .ok()
            .filter(|bytes| *bytes <= MAX_LAUNCH_BYTES)
            .and_then(|_| parse_native_launch(&raw));
        let _ = tx.send(valid);
    });
    rx.recv_timeout(Duration::from_millis(2500)).ok().flatten()
}

fn main() {
    let launch = original_host_launch();
    let signed = launch.as_ref().and_then(|value| value.signed_url.clone());
    let choices = launch.map_or_else(Vec::new, |value| value.choices);
    let menu_choices = choices.clone();
    let event_choices = choices;

    tauri::Builder::default()
        // This is a real OS menu, not a WebView script, remote-page IPC,
        // browser extension or another IAM. Only a direct human menu event
        // can request a different trusted subject from the original Host.
        .menu(move |app| {
            let mut builder = MenuBuilder::new(app);
            if menu_choices.is_empty() {
                builder = builder.text("subject:none", "Контуры не подключены");
            } else {
                for (i, choice) in menu_choices.iter().enumerate() {
                    builder = builder.text(format!("subject:{i}"), &choice.label);
                }
            }
            builder.build()
        })
        .on_menu_event(move |app, event| {
            let id: &str = event.id().as_ref();
            let Some(index) = id
                .strip_prefix("subject:")
                .and_then(|value| value.parse::<usize>().ok())
            else {
                return;
            };
            let Some(choice) = event_choices.get(index) else {
                return;
            };
            // The native process writes only the selected *identifier* to
            // its own private stdout pipe. The original Host obtains fresh
            // signed issuer/STATUS evidence and JIT authorization later.
            let message = serde_json::json!({
                "schema": EVENT_SCHEMA,
                "kind": "select",
                "selectionId": choice.selection_id,
            });
            if writeln!(io::stdout(), "{message}").is_ok() {
                let _ = io::stdout().flush();
                // Host will reopen the SAME signed Workspace after it has
                // accepted this explicit selection and invalidated old SSE.
                app.exit(0);
            }
        })
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
            // The sole UI window is native, keyboard-focusable and restricted
            // to the one signed Host origin. No additional browser windows,
            // remote Tauri command surface or privileged WebView2 permissions.
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
    use super::{parse_native_launch, parse_signed_host_launch, LAUNCH_SCHEMA};

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

    #[test]
    fn native_menu_accepts_only_host_pinned_context_candidates() {
        let frame = serde_json::json!({
            "schema": LAUNCH_SCHEMA,
            "url": null,
            "choices": [
                {"selectionId":"personal","label":"Личный контур"},
                {"selectionId":"north","label":"Организация North"},
                {"selectionId":"south","label":"Организация South"}
            ]
        });
        let parsed = parse_native_launch(&frame.to_string()).expect("native subject list");
        assert!(parsed.signed_url.is_none());
        assert_eq!(parsed.choices.len(), 3);
        let signed = format!("http://127.0.0.1:38421/workspace/#{}", "A".repeat(48));
        let with_url = serde_json::json!({
            "schema": LAUNCH_SCHEMA,"url":signed,"choices":frame["choices"]
        });
        assert!(parse_native_launch(&with_url.to_string())
            .unwrap().signed_url.is_some());
    }

    #[test]
    fn denies_forged_native_menu_contexts_and_unapproved_remote_origins() {
        let valid = serde_json::json!({
            "schema": LAUNCH_SCHEMA,
            "url": null,
            "choices":[{"selectionId":"personal","label":"Личный контур"}]
        });
        for altered in [
            serde_json::json!({"schema":"unknown","url":null,"choices":valid["choices"]}),
            serde_json::json!({"schema":LAUNCH_SCHEMA,"url":null,"choices":[]}),
            serde_json::json!({"schema":LAUNCH_SCHEMA,"url":"https://example.org/workspace/#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","choices":valid["choices"]}),
            serde_json::json!({"schema":LAUNCH_SCHEMA,"url":null,"choices":[{"selectionId":"north","label":"N"},{"selectionId":"north","label":"N"}]}),
            serde_json::json!({"schema":LAUNCH_SCHEMA,"url":null,"choices":[{"selectionId":"../../secret","label":"X"}]}),
            serde_json::json!({"schema":LAUNCH_SCHEMA,"url":null,"choices":[{"selectionId":"north","label":"X\nY"}]}),
        ] {
            assert!(parse_native_launch(&altered.to_string()).is_none(),
                "invalid envelope must be rejected");
        }
        assert!(parse_native_launch("a".repeat(65537).as_str()).is_none());
        assert!(parse_native_launch("{}").is_none());
    }
}
