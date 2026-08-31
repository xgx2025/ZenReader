use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::Manager;

mod notes;

/// A single markdown file discovered under a vault folder.
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

/// A scan of the vault: every `.md` file plus every (possibly empty) directory.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultListing {
    files: Vec<VaultFile>,
    dirs: Vec<String>,
}

/// Open a native folder picker; returns the chosen path, or `None` if cancelled.
#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

/// Recursively list all `.md` files and directories under `dir`.
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
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 外链经系统默认浏览器打开，WebView 永不离开应用。
        .plugin(tauri_plugin_opener::init())
        // 香尽的系统通知：人在别的窗口/页面时也接得住。
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            read_vault,
            read_file,
            write_file,
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
