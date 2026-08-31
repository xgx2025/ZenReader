use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 序列化的高亮锚点，与前端 `types/note.ts` 的 `HighlightAnchor` 对齐。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightAnchor {
    quote: String,
    prefix: String,
    suffix: String,
    occurrence: u32,
}

/// 一条觉悟笔记，与前端 `types/note.ts` 的 `Note` 对齐。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    id: String,
    relative_path: String,
    kind: String,
    quote: String,
    note: String,
    anchor: Option<HighlightAnchor>,
    created_at: String,
    updated_at: String,
}

/// 打开书库下的 notes.db：建目录、建连接、设 WAL、幂等建表建索引。
/// 每次命令按需开关连接——本地 SQLite 开销极小，且天然随书库切换。
fn open_notes_db(dir: &str) -> Result<Connection, String> {
    let zen = Path::new(dir).join(".zenreader");
    std::fs::create_dir_all(&zen).map_err(|e| e.to_string())?;
    let conn = Connection::open(zen.join("notes.db")).map_err(|e| e.to_string())?;
    // WAL：读写不互斥；崩溃安全由默认 synchronous=FULL 保证。
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
            id            TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            kind          TEXT NOT NULL,
            quote         TEXT NOT NULL,
            note          TEXT NOT NULL,
            anchor_json   TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_relative_path ON notes(relative_path);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// 把一行查询结果组装成 `Note`；anchor_json 解析失败时降级为无锚点。
fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let anchor_json: Option<String> = row.get(5)?;
    let anchor = match anchor_json {
        Some(s) => serde_json::from_str(&s).ok(),
        None => None,
    };
    Ok(Note {
        id: row.get(0)?,
        relative_path: row.get(1)?,
        kind: row.get(2)?,
        quote: row.get(3)?,
        note: row.get(4)?,
        anchor,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

/// 列出某篇文档的全部笔记，按创建先后返回。
#[tauri::command]
pub fn notes_list(dir: String, relative_path: String) -> Result<Vec<Note>, String> {
    let conn = open_notes_db(&dir)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, relative_path, kind, quote, note, anchor_json, created_at, updated_at
             FROM notes WHERE relative_path = ?1 ORDER BY created_at, rowid",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([relative_path], row_to_note)
        .map_err(|e| e.to_string())?;
    let mut notes = Vec::new();
    for row in rows {
        notes.push(row.map_err(|e| e.to_string())?);
    }
    Ok(notes)
}

/// 新增一条笔记。
#[tauri::command]
pub fn notes_add(dir: String, note: Note) -> Result<(), String> {
    let conn = open_notes_db(&dir)?;
    let anchor_json = note
        .anchor
        .as_ref()
        .and_then(|a| serde_json::to_string(a).ok());
    conn.execute(
        "INSERT INTO notes (id, relative_path, kind, quote, note, anchor_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            note.id,
            note.relative_path,
            note.kind,
            note.quote,
            note.note,
            anchor_json,
            note.created_at,
            note.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 更新一条笔记的文本与/或类型，并刷新 `updated_at`；未提供的字段保持不变。
#[tauri::command]
pub fn notes_update(
    dir: String,
    id: String,
    note_text: Option<String>,
    kind: Option<String>,
    updated_at: String,
) -> Result<(), String> {
    if note_text.is_none() && kind.is_none() {
        return Ok(()); // 没有要更新的字段
    }
    let conn = open_notes_db(&dir)?;
    // 动态拼 SET 子句：只更新调用方提供的字段。
    let mut sets: Vec<&str> = Vec::new();
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(t) = &note_text {
        sets.push("note = ?");
        params.push(t);
    }
    if let Some(k) = &kind {
        sets.push("kind = ?");
        params.push(k);
    }
    sets.push("updated_at = ?");
    params.push(&updated_at);
    let sql = format!("UPDATE notes SET {} WHERE id = ?", sets.join(", "));
    params.push(&id);
    conn.execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除一条笔记。
#[tauri::command]
pub fn notes_delete(dir: String, id: String) -> Result<(), String> {
    let conn = open_notes_db(&dir)?;
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 文档移动：把该文档下所有笔记的路径改到新位置（目标路径已有笔记则自然合并）。
#[tauri::command]
pub fn notes_move_document(dir: String, from: String, to: String) -> Result<(), String> {
    let conn = open_notes_db(&dir)?;
    conn.execute(
        "UPDATE notes SET relative_path = ?1 WHERE relative_path = ?2",
        params![to, from],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除文档：清掉该文档下的全部笔记。
#[tauri::command]
pub fn notes_delete_document(dir: String, relative_path: String) -> Result<(), String> {
    let conn = open_notes_db(&dir)?;
    conn.execute(
        "DELETE FROM notes WHERE relative_path = ?1",
        params![relative_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("zenreader-notes-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.to_string_lossy().into_owned()
    }

    fn sample_note(id: &str, path: &str) -> Note {
        Note {
            id: id.to_string(),
            relative_path: path.to_string(),
            kind: "note".into(),
            quote: "引文".into(),
            note: "觉悟".into(),
            anchor: Some(HighlightAnchor {
                quote: "引文".into(),
                prefix: "前文".into(),
                suffix: "后文".into(),
                occurrence: 0,
            }),
            created_at: "2026-08-31T00:00:00Z".into(),
            updated_at: "2026-08-31T00:00:00Z".into(),
        }
    }

    #[test]
    fn serde_camel_case_round_trip() {
        let note = sample_note("a", "哲学/静夜思.md");
        let json = serde_json::to_string(&note).unwrap();
        // 前端传 camelCase、Rust 收 snake_case，映射必须成立。
        assert!(json.contains("\"relativePath\""));
        assert!(json.contains("\"createdAt\""));
        let back: Note = serde_json::from_str(&json).unwrap();
        assert_eq!(back.relative_path, "哲学/静夜思.md");
        assert_eq!(back.anchor.unwrap().occurrence, 0);
    }

    #[test]
    fn crud_round_trip() {
        let dir = temp_dir("crud");
        notes_add(dir.clone(), sample_note("n1", "a.md")).unwrap();

        let list = notes_list(dir.clone(), "a.md".into()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].kind, "note");

        // 同时更新文本与类型
        notes_update(
            dir.clone(),
            "n1".into(),
            Some("新的觉悟".into()),
            Some("free".into()),
            "2026-08-31T01:00:00Z".into(),
        )
        .unwrap();
        let list = notes_list(dir.clone(), "a.md".into()).unwrap();
        assert_eq!(list[0].note, "新的觉悟");
        assert_eq!(list[0].kind, "free");
        assert_eq!(list[0].updated_at, "2026-08-31T01:00:00Z");

        // 只更新类型，文本保持不变
        notes_update(dir.clone(), "n1".into(), None, Some("highlight".into()), "t".into())
            .unwrap();
        let list = notes_list(dir.clone(), "a.md".into()).unwrap();
        assert_eq!(list[0].kind, "highlight");
        assert_eq!(list[0].note, "新的觉悟");

        // 文档移动：笔记随迁
        notes_move_document(dir.clone(), "a.md".into(), "b.md".into()).unwrap();
        assert!(notes_list(dir.clone(), "a.md".into()).unwrap().is_empty());
        let list = notes_list(dir.clone(), "b.md".into()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].relative_path, "b.md");

        // 删除文档：笔记清除
        notes_delete_document(dir.clone(), "b.md".into()).unwrap();
        assert!(notes_list(dir.clone(), "b.md".into()).unwrap().is_empty());

        // 同一文档两条，删其一
        notes_add(dir.clone(), sample_note("n2", "c.md")).unwrap();
        notes_add(dir.clone(), sample_note("n3", "c.md")).unwrap();
        notes_delete(dir.clone(), "n2".into()).unwrap();
        let list = notes_list(dir.clone(), "c.md".into()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "n3");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn free_note_anchor_is_null() {
        let dir = temp_dir("free");
        let mut n = sample_note("f1", "d.md");
        n.anchor = None;
        n.quote = String::new();
        notes_add(dir.clone(), n).unwrap();
        let list = notes_list(dir.clone(), "d.md".into()).unwrap();
        assert!(list[0].anchor.is_none());
        assert_eq!(list[0].quote, "");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
