//! Live end-to-end bridge (tests only). Serves the app's API commands over
//! local HTTP so `tests/live/*.test.js` can run the real JS modules against
//! a real server through the real Rust request code: the same `api::*`,
//! `account::exchange` and `sync::*` functions the Tauri commands call, with
//! one explicit token per simulated device instead of the OS keyring.
//!
//! Run it with `scripts/e2e-live.sh`, or by hand:
//!   DR_VIBE_WEB_BASE_URL=http://localhost:8080 DRVIBE_E2E_BRIDGE_PORT=8790 \
//!     cargo test e2e_bridge -- --ignored --nocapture
//!
//! `POST /invoke { device, cmd, args }` answers `{ result }` or `{ error }`,
//! with `cmd` and `args` named as the Tauri commands. Extra commands:
//! `start_link` (returns the `/connect` URL), `deep_link { url }` (the
//! `dr-vibe://auth/callback` redirect), `set_store { store }` (the Tauri
//! store sections `sync_profile` reads), `reset` (forget the device). `POST /shutdown` stops it.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::account;
use crate::api::{self, Ctx};
use crate::sync;

#[derive(Default)]
struct Device {
    install_id: String,
    verifier: Option<String>,
    token: Option<String>,
    profile: Value,
    store: Value,
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("bad arg {key}: {e}"))
}

fn to_json<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

async fn invoke(dev: &mut Device, cmd: &str, args: &Value) -> Result<Value, String> {
    let token = dev.token.clone();
    let ctx = Ctx::Token(token.as_deref());
    // Commands other than linking need a token, like the app's keyring path.
    let needs_link = !matches!(
        cmd,
        "start_link" | "deep_link" | "get_profile" | "set_store" | "reset"
    );
    if needs_link && token.is_none() {
        return to_json(api::ApiResponse {
            unlinked: true,
            ..Default::default()
        });
    }
    match cmd {
        "start_link" => {
            let (verifier, url) = account::new_link(
                &account::web_base_url(),
                dev.install_id.clone(),
                "2.0.0".into(),
                None,
            );
            dev.verifier = Some(verifier);
            Ok(json!(url))
        }
        "deep_link" => {
            let url: String = arg(args, "url")?;
            let code = crate::deeplink::link_code_from_url(&url).ok_or("not a link callback")?;
            let verifier = dev.verifier.take().ok_or("no link in progress")?;
            let resp = account::exchange(&code, &verifier, &dev.install_id).await?;
            dev.token = Some(resp.token.clone());
            dev.profile = json!({
                "userId": resp.user.id, "username": resp.user.username,
                "displayName": resp.user.display_name, "avatarUrl": resp.user.avatar_url,
            });
            // The `account-linked` event payload.
            Ok(json!({
                "username": resp.user.username, "displayName": resp.user.display_name,
                "avatarUrl": resp.user.avatar_url, "firstLink": resp.first_link,
            }))
        }
        "get_profile" => {
            let mut p = if dev.token.is_some() {
                dev.profile.clone()
            } else {
                json!({})
            };
            p["linked"] = json!(dev.token.is_some());
            Ok(p)
        }
        "reset" => {
            // A fresh install: new install id, no token.
            *dev = Device {
                install_id: format!("e2e-{}", api::new_nonce()),
                ..Default::default()
            };
            Ok(Value::Null)
        }
        "set_store" => {
            dev.store = args.get("store").cloned().unwrap_or(json!({}));
            Ok(Value::Null)
        }
        "api_request" => {
            let method: String = arg(args, "method")?;
            let path: String = arg(args, "path")?;
            let body: Option<Value> = arg(args, "body")?;
            let signed: Option<bool> = arg(args, "signed")?;
            let etag: Option<String> = arg(args, "etag")?;
            let tz: Option<String> = arg(args, "timezone")?;
            let r = api::request(
                ctx,
                &method,
                &path,
                body.as_ref(),
                signed.unwrap_or(false),
                etag.as_deref(),
                tz.as_deref(),
            )
            .await?;
            to_json(r)
        }
        "api_poll" => {
            let etag: Option<String> = arg(args, "etag")?;
            to_json(api::poll(ctx, etag.as_deref()).await)
        }
        "api_ack" => to_json(api::ack(ctx, &arg(args, "ack")?).await),
        "api_send_events" => {
            let tz: Option<String> = arg(args, "timezone")?;
            to_json(api::send_events(ctx, &arg(args, "batch")?, tz.as_deref()).await)
        }
        "api_send_visit" => to_json(api::send_visit(ctx, &arg(args, "request")?).await),
        "api_update_privacy" => to_json(api::update_privacy(ctx, &arg(args, "patch")?).await),
        "api_collection" => to_json(api::collection(ctx).await),
        "api_set_equipped" => to_json(api::set_equipped(ctx, &arg(args, "request")?).await),
        "api_send_recap" => to_json(api::send_recap(ctx, &arg(args, "request")?).await?),
        "api_submit_design" => {
            let png: String = arg(args, "pngBase64")?;
            let r = api::submit_design(
                ctx,
                &png,
                arg(args, "animJson")?,
                arg(args, "name")?,
                arg(args, "description")?,
                arg(args, "vibeId")?,
            )
            .await?;
            to_json(r)
        }
        "sync_profile" => {
            let transient: sync::TransientSyncState = arg(args, "transient")?;
            let store = dev.store.clone();
            let section = move |k: &str| store.get(k).cloned().unwrap_or(json!({}));
            let payload = sync::build_payload(
                transient,
                &section,
                None,
                json!({}),
                true,
                Some("2.0.0".into()),
            );
            sync::send_sync(ctx, &payload).await
        }
        "get_last_sync" => Ok(sync::last_sync(ctx).await.unwrap_or(Value::Null)),
        // Window/tray side effects of the real commands are not simulated.
        "cache_companion_skin" => Ok(json!(format!(
            "companion-{}",
            arg::<String>(args, "slug").unwrap_or_default()
        ))),
        "update_companions_tray" | "cache_visitor_sprite" => Ok(Value::Null),
        other => Err(format!("unknown command {other}")),
    }
}

#[test]
#[ignore = "needs a running server; see scripts/e2e-live.sh"]
fn e2e_bridge() {
    let port = std::env::var("DRVIBE_E2E_BRIDGE_PORT").unwrap_or_else(|_| "8790".into());
    let server =
        tiny_http::Server::http(format!("127.0.0.1:{port}")).expect("bind the bridge port");
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut devices: HashMap<String, Device> = HashMap::new();
    eprintln!(
        "[e2e-bridge] listening on {port}, server {}",
        account::web_base_url()
    );

    for mut req in server.incoming_requests() {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        if req.url() == "/shutdown" {
            let _ = req.respond(tiny_http::Response::from_string("{}"));
            break;
        }
        let input: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let name = input["device"].as_str().unwrap_or("a").to_string();
        let cmd = input["cmd"].as_str().unwrap_or_default().to_string();
        let args = input.get("args").cloned().unwrap_or(json!({}));
        let dev = devices.entry(name.clone()).or_insert_with(|| Device {
            install_id: format!("e2e-{name}-{}", api::new_nonce()),
            ..Default::default()
        });
        let out = match rt.block_on(invoke(dev, &cmd, &args)) {
            Ok(result) => json!({ "result": result }),
            Err(error) => json!({ "error": error }),
        };
        let header =
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
        let _ = req.respond(tiny_http::Response::from_string(out.to_string()).with_header(header));
    }
}
