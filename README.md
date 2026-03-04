# Walrus Drive

A decentralized Dropbox for macOS.

**FUSE** filesystem + **Seal** encryption + **Walrus** storage + **Sui** on-chain logic.

Drop files into a mounted drive. They get encrypted, stored on Walrus, and managed on Sui.

## Project Structure

```
walrus-hackathon-mar-2026/
├── contract/                  # Move smart contract (Sui)
│   ├── Move.toml
│   └── sources/
│       └── walrus_drive.move  # Seal policy, file metadata, access control
├── app/                       # TypeScript FUSE daemon + client
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Entry point — mount FUSE, start daemon
│       ├── fuse.ts            # FUSE ops (read/write/readdir/stat)
│       ├── db.ts              # SQLite local cache for fast file tree lookups
│       ├── walrus.ts          # Upload/download encrypted blobs to Walrus
│       ├── seal.ts            # Encrypt before upload, decrypt after download
│       └── sui.ts             # Read/write file metadata objects on Sui
```

## How It Works

| Component | What it does |
|-----------|-------------|
| **contract/** | Move package on Sui — defines a **Seal encryption policy** that controls who can encrypt/decrypt files |
| **fuse.ts** | Translates Finder/shell actions (open, read, write, ls) into Walrus uploads/downloads + SQLite cache updates |
| **db.ts** | SQLite — caches the file tree locally so `ls` and `stat` are instant without hitting the chain |
| **walrus.ts** | Talks to the Walrus network — stores and retrieves encrypted file blobs |
| **seal.ts** | Wraps Seal SDK — encrypts plaintext before upload, decrypts ciphertext after download, using the on-chain policy |
| **sui.ts** | Sui client — creates/updates/deletes `FileEntry` objects on-chain so the file registry stays in sync |
| **index.ts** | Wires everything together — inits the DB, mounts the FUSE drive, and runs the daemon loop |
