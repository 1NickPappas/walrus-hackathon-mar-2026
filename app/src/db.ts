/** SQLite local cache — tracks filename → Walrus blob ID mappings. */

import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "fs";

let db: Database;

export interface FileRecord {
  filename: string;
  blob_id: string;
  blob_object_id: string;
  size: number;
  epochs: number;
  created_at: string;
}

export function initDb(path: string): void {
  if (existsSync(path)) {
    console.warn(`[db] WARNING: Existing database found at ${path} — deleting and recreating`);
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = path + suffix;
      if (existsSync(f)) unlinkSync(f);
    }
  }
  db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      filename       TEXT PRIMARY KEY,
      blob_id        TEXT NOT NULL,
      blob_object_id TEXT NOT NULL,
      size           INTEGER NOT NULL,
      epochs         INTEGER NOT NULL,
      created_at     TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function upsertFile(filename: string, blobId: string, blobObjectId: string, size: number, epochs: number): void {
  db.run(
    `INSERT INTO files (filename, blob_id, blob_object_id, size, epochs) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(filename) DO UPDATE SET blob_id = excluded.blob_id, blob_object_id = excluded.blob_object_id, size = excluded.size, epochs = excluded.epochs, created_at = datetime('now')`,
    [filename, blobId, blobObjectId, size, epochs],
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
