/** SQLite local cache — tracks filename → Walrus blob ID mappings. */

import { Database } from "bun:sqlite";

let db: Database;

export interface FileRecord {
  filename: string;
  blob_id: string;
  size: number;
  created_at: string;
}

export function initDb(path: string): void {
  db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      filename   TEXT PRIMARY KEY,
      blob_id    TEXT NOT NULL,
      size       INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function upsertFile(filename: string, blobId: string, size: number): void {
  db.run(
    `INSERT INTO files (filename, blob_id, size) VALUES (?, ?, ?)
     ON CONFLICT(filename) DO UPDATE SET blob_id = excluded.blob_id, size = excluded.size, created_at = datetime('now')`,
    [filename, blobId, size],
  );
}

export function getFile(filename: string): FileRecord | null {
  return db.query("SELECT * FROM files WHERE filename = ?").get(filename) as FileRecord | null;
}

export function listFiles(): FileRecord[] {
  return db.query("SELECT * FROM files ORDER BY created_at DESC").all() as FileRecord[];
}

export function deleteFile(filename: string): void {
  db.run("DELETE FROM files WHERE filename = ?", [filename]);
}
