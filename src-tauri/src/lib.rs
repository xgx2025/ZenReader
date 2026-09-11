use encoding_rs::Encoding;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::Manager;

mod asset_protocol;
mod notes;

/// 当前活跃书库根（绝对路径）。由前端在开库/refresh 及 reader.open(html) 时
/// 经 `set_active_vault` 上报；`zenasset://` 资产协议以此为准做路径收敛，
/// 绝不信任请求 URL 自带的根。书库未开时为空（资产一律 404）。
pub struct ActiveVault(pub Mutex<Option<String>>);

/// A single supported document (.md/.html/.htm) discovered under a vault folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultFile {
    /// File name (e.g. `静夜思.md`).
    name: String,
    /// Absolute path on disk.
    path: String,
    /// Path relative to the vault root, `/`-separated (e.g. `notes/哲学/静夜思.md`).
    relative_path: String,
    /// Last-modified time in milliseconds since the Unix epoch.
    mtime: u64,
}

fn modified_millis(path: &Path) -> u64 {
    path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A scan of the vault: every supported document plus every (possibly empty) directory.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultListing {
    files: Vec<VaultFile>,
    dirs: Vec<String>,
}

/// Is `path` a document this app reads — Markdown or raw-HTML reader-mode?
fn is_supported_doc(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(e) => {
            e.eq_ignore_ascii_case("md")
                || e.eq_ignore_ascii_case("markdown")
                || e.eq_ignore_ascii_case("html")
                || e.eq_ignore_ascii_case("htm")
        }
        None => false,
    }
}

/// Open a native folder picker; returns the chosen path, or `None` if cancelled.
#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

/// Recursively list all supported documents (.md/.markdown/.html/.htm) and
/// directories under `dir`.
#[tauri::command]
fn read_vault(dir: String) -> Result<VaultListing, String> {
    let root = Path::new(&dir);
    let mut files = Vec::new();
    let mut dirs = Vec::new();

    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        // Skip hidden directories (e.g. `.zenreader`) — they are not 分组.
        .filter_entry(|e| {
            if e.depth() > 0 && e.file_type().is_dir() {
                !e.file_name().to_string_lossy().starts_with('.')
            } else {
                true
            }
        });

    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if entry.file_type().is_dir() {
            if entry.depth() > 0 {
                let rel = path
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                dirs.push(rel);
            }
            continue;
        }

        if !entry.file_type().is_file() {
            continue;
        }
        if !is_supported_doc(path) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        files.push(VaultFile {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            relative_path,
            mtime: modified_millis(path),
        });
    }

    Ok(VaultListing { files, dirs })
}

/// Read a UTF-8 text file to a string.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Sniff `charset=…` from the `<meta charset>` of an HTML document's head.
/// Searches only the first bytes (decoded lossy as ASCII), so it is safe on
/// any encoding. Returns `None` when no usable label is found.
fn sniff_meta_charset(bytes: &[u8]) -> Option<&'static Encoding> {
    let head_len = bytes.len().min(2048);
    let ascii: String = bytes[..head_len].iter().map(|&b| b as char).collect();
    let lower = ascii.to_ascii_lowercase();
    let mut search_from = 0;
    while let Some(meta_pos) = lower[search_from..].find("<meta") {
        let seg_start = search_from + meta_pos;
        // Look at the attribute window right after the tag name.
        let rest = &lower[seg_start..seg_start + 400.min(lower.len() - seg_start)];
        if let Some(eq) = rest.find("charset=") {
            let value = &rest[eq + "charset=".len()..];
            let value = value.trim_start().trim_start_matches(['"', '\'']);
            let label: String = value
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
                .collect();
            if let Some(enc) = Encoding::for_label(label.as_bytes()) {
                return Some(enc);
            }
            return None;
        }
        search_from = seg_start + "<meta".len();
    }
    None
}

/// Decode HTML bytes to a Unicode string for embedding (srcdoc / indexing).
/// Order: BOM sniff → `<meta charset>` label (encoding_rs) → UTF-8 fallback.
fn decode_html_bytes(bytes: &[u8]) -> Result<String, String> {
    // UTF-8 BOM.
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec()).map_err(|e| e.to_string());
    }
    // UTF-16 LE / BE BOMs.
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return Ok(text.into_owned());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        return Ok(text.into_owned());
    }
    match sniff_meta_charset(bytes) {
        Some(enc) => {
            let (text, _, had_errors) = enc.decode(bytes);
            // Fall back to UTF-8 if the declared encoding clearly failed.
            if had_errors {
                String::from_utf8(bytes.to_vec()).map_err(|_| text.into_owned())
            } else {
                Ok(text.into_owned())
            }
        }
        None => String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string()),
    }
}

/// Read an HTML file, decoding it by BOM / `<meta charset>` (存档中文页常为
/// GBK——严格 UTF-8 的 `read_file` 会对其报错).
#[tauri::command]
fn read_html(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    decode_html_bytes(&bytes)
}

/// 记录当前活跃书库根（绝对路径），供 `zenasset://` 资产协议收敛使用。
/// 书库在 settings.json 里也有持久化副本（资产协议读盘兜底），这里只是热路径。
#[tauri::command]
fn set_active_vault(app: tauri::AppHandle, dir: String) {
    let trimmed = dir.trim();
    if !trimmed.is_empty() {
        if let Ok(mut guard) = app.state::<ActiveVault>().0.lock() {
            *guard = Some(trimmed.to_string());
        }
    }
}

/// Write text to a file, creating parent directories as needed.
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Delete a file from disk (e.g. removing a document from the vault).
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Copy a file verbatim into the vault. HTML 导入必须保字节——text 往返会把 GBK
/// 内容重编码成 UTF-8 却留下 `charset=gb2312` 的 meta，日后 read_html 会按旧码再解而乱码。
#[tauri::command]
fn copy_file(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
    Ok(())
}

/// Write raw bytes (base64) to a file — 浏览器通道拖入的 HTML File 走内存字节。
#[tauri::command]
fn write_base64(path: String, data: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("坏 base64：{e}"))?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Create a directory (and any missing parents) under the vault.
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Move/rename a file, creating the destination's parent directories as needed.
#[tauri::command]
fn move_file(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Delete an empty 分组 inside the vault. The directory tree (including
/// sub-directories) must contain no files at all, or the command refuses —
/// 分组 must be emptied before it can be 释怀, so real `.md` files are never
/// touched. `relative_path` is a `/`-separated path relative to the vault root.
#[tauri::command]
fn remove_folder(dir: String, relative_path: String) -> Result<(), String> {
    // 防御：分组路径应始终落在书库内——拒绝空路径、绝对路径、根相对路径
    // （Windows 下 `/` 开头的路径不算 is_absolute，但 join 会逃出书库）与 `..`。
    if relative_path.is_empty()
        || Path::new(&relative_path).is_absolute()
        || relative_path.starts_with('/')
        || relative_path.starts_with('\\')
        || relative_path.split(['/', '\\']).any(|seg| seg == "..")
    {
        return Err("非法分组路径".into());
    }
    let target = Path::new(&dir).join(&relative_path);
    if !target.is_dir() {
        return Err(format!("分组不存在：{relative_path}"));
    }
    for entry in walkdir::WalkDir::new(&target).into_iter() {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_file() {
            return Err(format!("分组非空：{relative_path}"));
        }
    }
    std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
}

/// Absolute path to the app-level settings file inside the OS config directory
/// (e.g. `~/.config/com.zenreader.app/settings.json` on Linux,
/// `%APPDATA%\com.zenreader.app\settings.json` on Windows).
fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Read the persisted settings JSON; `None` when it does not exist yet.
#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Write the settings JSON to disk, creating the config directory as needed.
#[tauri::command]
fn write_settings(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 分组删除只允许空分组：含文件的目录拒绝且保留，空树整体删除。
    #[test]
    fn remove_folder_only_when_empty() {
        let base = std::env::temp_dir().join(format!(
            "zenreader-folder-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("vault");
        std::fs::create_dir_all(root.join("a/b")).unwrap(); // a 只含空子目录 b
        std::fs::create_dir_all(root.join("c")).unwrap();
        std::fs::write(root.join("c/doc.md"), "x").unwrap();
        let dir = root.to_string_lossy().into_owned();

        // c 含文件 → 拒绝，且目录仍在。
        assert!(remove_folder(dir.clone(), "c".into()).is_err());
        assert!(root.join("c").is_dir());

        // 空分组 a（含空子目录 b）→ 整棵空树一并删除。
        assert!(remove_folder(dir.clone(), "a".into()).is_ok());
        assert!(!root.join("a").exists());

        // 路径防御：`..`、根相对、绝对路径一律拒绝。
        assert!(remove_folder(dir.clone(), "..".into()).is_err());
        assert!(remove_folder(dir.clone(), "../x".into()).is_err());
        assert!(remove_folder(dir.clone(), "/abs".into()).is_err());
        assert!(remove_folder(dir.clone(), "".into()).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// read_vault 列出 .md/.html/.htm，跳过其它扩展与点目录。
    #[test]
    fn read_vault_lists_html_and_md() {
        let base = std::env::temp_dir().join(format!(
            "zenreader-vault-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("vault");
        std::fs::create_dir_all(root.join("哲学/随笔")).unwrap();
        std::fs::create_dir_all(root.join(".zenreader")).unwrap();
        std::fs::write(root.join("a.md"), "# a").unwrap();
        std::fs::write(root.join("b.HTML"), "<b>b</b>").unwrap();
        std::fs::write(root.join("c.htm"), "<b>c</b>").unwrap();
        std::fs::write(root.join("哲学/随笔/d.markdown"), "d").unwrap();
        std::fs::write(root.join("e.txt"), "skip").unwrap();
        std::fs::write(root.join("script.js"), "skip").unwrap();
        std::fs::write(root.join(".zenreader/notes.db"), "skip").unwrap();

        let listing = read_vault(root.to_string_lossy().into_owned()).unwrap();
        let mut names: Vec<&str> = listing.files.iter().map(|f| f.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["a.md", "b.HTML", "c.htm", "d.markdown"]);
        assert!(
            listing.dirs.iter().any(|d| d == "哲学/随笔"),
            "dirs should include the CJK folder, got {:?}",
            listing.dirs
        );
        assert!(
            !listing.dirs.iter().any(|d| d.starts_with('.')),
            "hidden dirs excluded"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// decode_html_bytes 按 <meta charset> 解 GBK，UTF-8 与 BOM 皆可。
    #[test]
    fn decode_html_bytes_handles_gbk_and_utf8() {
        // UTF-8 with BOM stays intact.
        let utf8 = b"\xEF\xBB\xBF<h1>\xe5\x9d\x90\xe5\xbf\x83</h1>";
        assert_eq!(
            decode_html_bytes(utf8).unwrap(),
            "<h1>坐心</h1>".to_string()
        );

        // GBK bytes with a gb2312 meta declaration.
        let mut gbk: Vec<u8> =
            b"<meta charset=\"gb2312\"><p>".to_vec();
        let (enc, _, _) = encoding_rs::GBK.encode("你好，禅阅读");
        gbk.extend_from_slice(&enc);
        gbk.extend_from_slice(b"</p>");
        let decoded = decode_html_bytes(&gbk).unwrap();
        assert!(decoded.contains("你好，禅阅读"), "got {decoded}");

        // Plain UTF-8 without declaration.
        let plain = b"<html><head></head><body>ok</body></html>";
        assert_eq!(decode_html_bytes(plain).unwrap(), "<html><head></head><body>ok</body></html>");
    }

    /// sniff_meta_charset 认 charset=… 标签（单/双引号均可）。
    #[test]
    fn sniff_meta_charset_finds_labels() {
        // Encoding::name() 返回 WHATWG 大写标签（"GBK"/"UTF-8"），统一小写比较。
        fn lower_name(e: &'static Encoding) -> String {
            e.name().to_ascii_lowercase()
        }
        let gbk = sniff_meta_charset(b"<meta http-equiv=\"Content-Type\" content=\"text/html; charset=gbk\">");
        assert_eq!(gbk.map(lower_name), Some("gbk".to_string()));
        let utf8 = sniff_meta_charset(b"<meta charset='utf-8'>");
        assert_eq!(utf8.map(lower_name), Some("utf-8".to_string()));
        assert!(sniff_meta_charset(b"<html><body>x</body></html>").is_none());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 外链经系统默认浏览器打开，WebView 永不离开应用。
        .plugin(tauri_plugin_opener::init())
        // 香尽的系统通知：人在别的窗口/页面时也接得住。
        .plugin(tauri_plugin_notification::init())
        .manage(ActiveVault(Mutex::new(None)))
        // HTML 原样式直读的本地资产服务：只读、收敛于活跃书库根。
        // 由前端经 set_active_vault 上报根，响应带 ACAO:*（不透明源 fetch/字体需要）。
        .register_asynchronous_uri_scheme_protocol("zenasset", |ctx, request, responder| {
            asset_protocol::handle(ctx, request, responder)
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            read_vault,
            read_file,
            read_html,
            set_active_vault,
            write_file,
            copy_file,
            write_base64,
            delete_file,
            create_dir,
            move_file,
            remove_folder,
            read_settings,
            write_settings,
            notes::notes_list,
            notes::notes_add,
            notes::notes_update,
            notes::notes_delete,
            notes::notes_move_document,
            notes::notes_delete_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZenReader");
}
