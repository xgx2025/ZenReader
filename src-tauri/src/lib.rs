use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            read_vault,
            read_file,
            write_file,
            delete_file,
            create_dir,
            move_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZenReader");
}
