use crate::notes::open_notes_db;
use rusqlite::params;

/// 地图是用户编辑的一份整体手稿。SQLite 的单行事务保证每次保存完整落盘。
#[tauri::command]
pub fn knowledge_load(dir: String) -> Result<String, String> {
    let conn = open_notes_db(&dir)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS knowledge_map (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL
        )",
    )
    .map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT payload FROM knowledge_map WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => {
            Ok("{\"topics\":[],\"relations\":[],\"evidence\":[]}".to_string())
        }
        other => Err(other),
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn knowledge_save(dir: String, content: String) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if !parsed.get("topics").is_some_and(|v| v.is_array())
        || !parsed.get("relations").is_some_and(|v| v.is_array())
        || !parsed.get("evidence").is_some_and(|v| v.is_array())
    {
        return Err("知识图数据格式无效".into());
    }
    let conn = open_notes_db(&dir)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS knowledge_map (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL
        )",
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO knowledge_map (id, payload) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        params![content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knowledge_map_round_trip_and_invalid_write_preserves_previous() {
        let dir = std::env::temp_dir().join(format!(
            "zenreader-knowledge-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let vault = dir.to_string_lossy().into_owned();
        let payload = r#"{"topics":[{"id":"one"}],"relations":[],"evidence":[]}"#.to_string();
        knowledge_save(vault.clone(), payload.clone()).unwrap();
        assert_eq!(knowledge_load(vault.clone()).unwrap(), payload);
        assert!(knowledge_save(vault.clone(), "{\"topics\":null}".into()).is_err());
        assert_eq!(knowledge_load(vault).unwrap(), payload);
        let _ = std::fs::remove_dir_all(dir);
    }
}
