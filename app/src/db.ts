/** SQLite local cache — blob ID ↔ file name tracking using bun:sqlite. */

import { Database } from "bun:sqlite";

let db: Database | null = null;

export function initDb(path: string): void {
  db = new Database(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS blobs (
      blob_id    TEXT PRIMARY KEY,
      file_name  TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log(`[db] SQLite ready at ${path}`);
}

export function insertBlob(blobId: string, fileName: string): void {
  db!.run(
    `INSERT OR REPLACE INTO blobs (blob_id, file_name) VALUES (?, ?)`,
    [blobId, fileName],
  );
}

export function getBlob(fileName: string): { blob_id: string; file_name: string; created_at: string } | null {
  return db!.query<{ blob_id: string; file_name: string; created_at: string }, [string]>(
    `SELECT blob_id, file_name, created_at FROM blobs WHERE file_name = ?`,
  ).get(fileName);
}

export function listBlobs(): { blob_id: string; file_name: string; created_at: string }[] {
  return db!.query<{ blob_id: string; file_name: string; created_at: string }, []>(
    `SELECT blob_id, file_name, created_at FROM blobs ORDER BY created_at DESC`,
  ).all();
}
