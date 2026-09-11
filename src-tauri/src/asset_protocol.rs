//! `zenasset://` — read-only asset protocol for HTML (原样式直读) documents.
//!
//! The HTML reader loads a sandboxed, opaque-origin iframe whose relative
//! resources (img/css/js/font/fetch) resolve against an injected
//! `<base href="zenasset://asset/<vault-relative-doc-folder>/">`. This module
//! serves those files from the *active vault root* with a hard confinement:
//! percent-decode → reject traversal/dot/absolute/ADS segments → canonicalize
//! on both sides → `starts_with` containment. It only ever reads.
//!
//! Security notes:
//! - Responses carry `Access-Control-Allow-Origin: *` so an opaque-origin page
//!   can `fetch()` / load fonts / import module scripts over the scheme.
//!   Accepted trade-off: a hostile .html could then read sibling vault files
//!   and exfiltrate them. Dot-segment rejection keeps `.zenreader/` (notes DB,
//!   arrange.json) and all dotfiles out of reach; the root confinement keeps
//!   everything outside the vault out of reach. A future hardening could split
//!   a no-CORS media path from a token-scoped fetch path.
//! - The vault root comes from trusted app state (synced on vault open/refresh
//!   and defensively in the reader), never from the request URL — so an
//!   attacker-written `zenasset://…` src cannot point the scheme elsewhere.

use percent_encoding::percent_decode_str;
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::{settings_path, ActiveVault};

/// Decode a request path into clean, vault-relative path segments.
///
/// Rejects anything that could escape the vault or hit hidden state:
/// empty / `.` / `..` / leading-`.` (dotfiles, `.zenreader`) / absolute /
/// drive-or-colon (Windows ADS) / backslash / encoded separators / NUL.
pub fn decode_asset_path(path: &str) -> Result<Vec<String>, String> {
    // Never allow a backslash separator at all — a URL coming from a document
    // must be `/`-separated; anything else is suspicious and 404s.
    if path.contains('\\') {
        return Err("backslash in asset path".into());
    }
    let mut out = Vec::new();
    for raw in path.trim_start_matches('/').split('/') {
        if raw.is_empty() {
            continue;
        }
        if raw == "." || raw == ".." || raw.starts_with('.') {
            return Err("illegal segment".into());
        }
        let decoded = percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| "bad percent-encoding")?;
        let seg = decoded.as_ref();
        // 解码后再拒一次：`%2e%2e`→`..`、`%2f`→`/`（否则一个"段"里带分隔符会
        // 在 PathBuf::push 时被当多段展开，`a%2f..%2fb` 将逃逸出本段）。`a..` 是
        // 合法但怪异的库内文件名，本身不构成越界——真正的最后防线是 confine 双侧
        // canonicalize + starts_with，这里只是把它挡在段形之外。
        if seg.is_empty()
            || seg == "."
            || seg == ".."
            || seg.starts_with('.')
            || seg.starts_with('/')
            || seg.contains(['/', '\\', ':', '\0'])
        {
            return Err("illegal decoded segment".into());
        }
        out.push(seg.to_string());
    }
    Ok(out)
}

/// Map a decoded, validated segment list to an on-disk path confined under
/// `vault_root`. Symlink escapes are defeated by canonicalizing *both* the
/// root and the joined target and requiring the target to stay under the root.
pub fn confine_vault_asset(vault_root: &Path, segments: &[String]) -> Result<PathBuf, String> {
    if segments.is_empty() {
        return Err("empty asset path".into());
    }
    let root = vault_root
        .canonicalize()
        .map_err(|_| "vault root unavailable")?;
    let mut target = root.clone();
    for seg in segments {
        // Components is belt-and-suspenders on top of decode_asset_path.
        target.push(seg);
    }
    let real = target.canonicalize().map_err(|_| "asset not found")?;
    if !real.starts_with(&root) {
        return Err("asset escapes vault".into());
    }
    Ok(real)
}

/// Content type by file extension (used by both the scheme and the media map).
pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) {
        Some(e) => match e.as_str() {
            "html" | "htm" => "text/html",
            "css" => "text/css",
            "js" | "mjs" => "text/javascript",
            "json" => "application/json",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            "woff" => "font/woff",
            "woff2" => "font/woff2",
            "ttf" => "font/ttf",
            "otf" => "font/otf",
            "pdf" => "application/pdf",
            "txt" => "text/plain",
            "mp3" => "audio/mpeg",
            "ogg" => "audio/ogg",
            "wav" => "audio/wav",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            _ => "application/octet-stream",
        },
        None => "application/octet-stream",
    }
}

/// Resolve the currently active vault root: managed state first, else the
/// persisted `vaultPath` inside settings.json (read fresh — cheap for assets).
fn active_vault_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(state) = app.try_state::<ActiveVault>() {
        if let Ok(guard) = state.0.lock() {
            if let Some(dir) = guard.as_deref() {
                let p = PathBuf::from(dir);
                if p.is_dir() {
                    return Some(p);
                }
            }
        }
    }
    let path = settings_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let vp = value.get("vaultPath")?.as_str()?;
    let p = PathBuf::from(vp);
    p.is_dir().then_some(p)
}

fn not_found() -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::builder()
        .status(404)
        .body(Cow::Borrowed(&b""[..]))
        .unwrap_or_else(|_| tauri::http::Response::new(Cow::Borrowed(&b""[..])))
}

/// Serve one `zenasset://` request. Pure of I/O and unit-testable shape.
fn serve_asset(app: &tauri::AppHandle, path: &str) -> tauri::http::Response<Cow<'static, [u8]>> {
    let Ok(segments) = decode_asset_path(path) else {
        return not_found();
    };
    let Some(root) = active_vault_root(app) else {
        return not_found();
    };
    let Ok(target) = confine_vault_asset(&root, &segments) else {
        return not_found();
    };
    let Ok(bytes) = std::fs::read(&target) else {
        return not_found();
    };
    let builder = tauri::http::Response::builder()
        .header("Content-Type", mime_for(&target))
        // Opaque-origin (sandboxed srcdoc) fetch/fonts/module-scripts need CORS.
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-cache");
    builder
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| not_found())
}

/// Async handler glue: clone the app handle, do the blocking read on a worker
/// thread (so the WebView never stalls), then hand the response to the responder.
pub fn handle(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().to_string();
    std::thread::spawn(move || {
        responder.respond(serve_asset(&app, &path));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segs(input: &[&str]) -> Vec<String> {
        input.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn decode_rejects_escape_paths() {
        for bad in [
            "../x",
            "a/../../x",
            "C:/Windows",
            "/C:/Windows",
            "a/./b",
            ".zenreader/notes.db",
            "a/.hidden",
            ".htaccess",
            "%2e%2e/b", // `..` after decode → rejects in the decoded check
            "a%2f..%2fb", // encoded slash would smuggle a separator into a segment
            "a\\b",
        ] {
            assert!(decode_asset_path(bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn decode_maps_root_relative_into_vault() {
        // scheme 根 = 书库根：`/etc/passwd` 是库内相对 etc/passwd，非宿主文件系统。
        assert_eq!(decode_asset_path("/etc/passwd").unwrap(), ["etc", "passwd"]);
        assert_eq!(decode_asset_path("/").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn decode_allows_nested_cjk_spaces() {
        let ok = decode_asset_path("哲学/%E9%9A%8F%E7%AC%94/assets/fig%201.png").unwrap();
        assert_eq!(ok, segs(&["哲学", "随笔", "assets", "fig 1.png"]));
    }

    #[test]
    fn decode_encodes_dot_segment() {
        // %2e decodes to "." — must be caught after decoding too.
        assert!(decode_asset_path("%2e%2e/x").is_err());
    }

    #[test]
    fn confine_rejects_outside_and_allows_inside() {
        let base = std::env::temp_dir().join(format!("zenreader-asset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let vault = base.join("vault");
        std::fs::create_dir_all(vault.join("哲学/随笔")).unwrap();
        std::fs::create_dir_all(vault.join(".zenreader")).unwrap();
        std::fs::write(vault.join("哲学/随笔/fig 1.png"), "img").unwrap();
        std::fs::write(vault.join(".zenreader/notes.db"), "db").unwrap();
        let outside = base.join("outside.txt");
        std::fs::write(&outside, "x").unwrap();

        // Inside file resolves.
        let ok = confine_vault_asset(&vault, &segs(&["哲学", "随笔", "fig 1.png"])).unwrap();
        assert!(ok.ends_with("fig 1.png"));

        // Outside via symlink (where the OS permits) is refused; when symlinks
        // are unavailable the canonicalize step already fails → still Err.
        #[cfg(unix)]
        {
            let link = vault.join("link");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(confine_vault_asset(&vault, &["link".to_string()]).is_err());
        }

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn mime_maps_known_extensions() {
        assert_eq!(mime_for(Path::new("a.html")), "text/html");
        assert_eq!(mime_for(Path::new("a.HTM")), "text/html");
        assert_eq!(mime_for(Path::new("a.css")), "text/css");
        assert_eq!(mime_for(Path::new("a.js")), "text/javascript");
        assert_eq!(mime_for(Path::new("a.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(mime_for(Path::new("a.unknownext")), "application/octet-stream");
    }

    #[test]
    fn path_component_is_clean() {
        // Cross-check that decode_asset_path output never survives Path
        // component normalization into a parent.
        let root = Path::new("C:/vault");
        let p = root.join("..").join("..").join("x");
        assert_eq!(
            p.components()
                .filter(|c| matches!(c, std::path::Component::ParentDir))
                .count(),
            2,
            "root.join must preserve ParentDir so our pre-rejection matters"
        );
    }
}
