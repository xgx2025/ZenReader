use serde::Serialize;
use std::path::Path;

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
}

/// Open a native folder picker; returns the chosen path, or `None` if cancelled.
#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

/// Recursively list all `.md` files under `dir`.
#[tauri::command]
fn read_vault(dir: String) -> Result<Vec<VaultFile>, String> {
    let root = Path::new(&dir);
    let mut files = Vec::new();

    for entry in walkdir::WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
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
        });
    }

    Ok(files)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            read_vault,
            read_file,
            write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZenReader");
}
