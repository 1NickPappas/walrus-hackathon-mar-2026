# CLAUDE.md — Walrus Drive

> **Keep this file up to date.** When introducing changes (new files, architectural decisions, dependency changes, implemented features), update the relevant sections below before finishing the task.

## What is this project?

Walrus Drive is a decentralized Dropbox for macOS. Files dropped into a FUSE-mounted drive get encrypted (Seal), stored on Walrus, and tracked on Sui. The stack:

- **FUSE** → virtual filesystem mounted via `fuse-native` (macFUSE)
- **Seal** → on-chain encryption policy (encrypt before upload, decrypt after download)
- **Walrus** → decentralized blob storage
- **Sui** → on-chain file registry (Move smart contract)

## Runtime & tooling

- **Runtime:** Bun (not Node). Use `bun run`, `bun install`, etc.
- **Language:** TypeScript — Bun runs `.ts` directly, no compile step needed
- **Type checking:** `bun run --bun tsc --noEmit` (tsc is type-checker only, `noEmit: true`)
- **Package manager:** Bun (`bun.lock`, not `package-lock.json`)
- **Module resolution:** `"moduleResolution": "bundler"` — use `.ts` extensions in imports

## Repository layout

```
walrus-hackathon-mar-2026/
├── CLAUDE.md                          # ← you are here
├── contract/                          # Move smart contract (Sui)
│   ├── Move.toml
│   └── sources/walrus_drive.move      # Seal registry: allowlist-based encrypt/decrypt policy
├── app/                               # TypeScript FUSE daemon
│   ├── package.json                   # Scripts: start, build, codegen
│   ├── tsconfig.json                  # Bun-compatible: module=preserve, bundler resolution
│   └── src/
│       ├── index.ts                   # Entry point — parses CLI arg, calls mountDrive()
│       ├── fuse.ts                    # ✅ FUSE HTTP thin client (12 ops → localhost:3001)
│       ├── types/fuse-native.d.ts     # ✅ TypeScript declarations for fuse-native
│       ├── db.ts                      # 🔲 Stub — SQLite local cache (will use bun:sqlite)
│       ├── walrus.ts                  # 🔲 Stub — Walrus blob upload/download
│       ├── seal.ts                    # 🔲 Stub — Seal encrypt/decrypt
│       └── sui.ts                     # 🔲 Stub — Sui on-chain file metadata
├── fuse-plan.md                       # Research notes on FUSE + macOS + TypeScript
└── .gitignore
```

Legend: ✅ = implemented, 🔲 = stub/TODO

## Architecture: FUSE ↔ HTTP server split

The FUSE layer is a **thin client** that delegates all operations to a local HTTP server:

```
┌──────────────┐   HTTP POST (JSON)   ┌──────────────────┐
│  fuse.ts     │ ──────────────────── │  HTTP server     │
│  (FUSE ops)  │  localhost:3001      │  (Bun.serve)     │
│              │ ◄──────────────────── │  db + walrus +   │
│  kernel ↔ JS │   JSON responses     │  seal + sui      │
└──────────────┘                      └──────────────────┘
```

**Why this split:** Makes the FUSE layer independently testable (mock the HTTP server), and separates filesystem concerns from storage/encryption/chain logic.

### HTTP API contract

RPC-style: `POST http://localhost:3001/fuse/{operation}` with JSON bodies.

| Operation  | Request body                                    | Success response               |
|------------|------------------------------------------------|---------------------------------|
| `getattr`  | `{ path }`                                      | `{ stat: { mode, size, ... } }` |
| `readdir`  | `{ path }`                                      | `{ entries: [...] }`            |
| `open`     | `{ path, flags }`                               | `{ fd }`                        |
| `read`     | `{ path, fd, length, position }`                | `{ data: "<base64>", bytesRead }` |
| `write`    | `{ path, fd, data: "<base64>", length, position }` | `{ bytesWritten }`          |
| `create`   | `{ path, mode }`                                | `{ fd }`                        |
| `unlink`   | `{ path }`                                      | `{}`                            |
| `rename`   | `{ src, dest }`                                 | `{}`                            |
| `mkdir`    | `{ path, mode }`                                | `{}`                            |
| `rmdir`    | `{ path }`                                      | `{}`                            |
| `truncate` | `{ path, size }`                                | `{}`                            |
| `release`  | `{ path, fd }`                                  | `{}`                            |

**Errors:** Non-200 → `{ "error": "ENOENT" }`. Client maps string → `Fuse.ENOENT` etc., fallback `Fuse.EIO`.

## Smart contract (Seal registry)

`contract/sources/walrus_drive.move` — A shared `Registry` object where each user has an allowlist of addresses. The `seal_approve` entry function is the Seal callback: it verifies the namespace prefix matches the registry ID, extracts the owner address, and checks the caller is on the owner's list.

Key functions: `create_list`, `add`, `remove`, `seal_approve`.

## Key patterns & gotchas

- **`read`/`write` callback quirk:** In `fuse-native`, most callbacks are `cb(err, result)`. But `read` and `write` use `cb(bytesTransferred)` — `0` means EOF (not success), negative means error. This is handled in `fuse.ts`.
- **Binary data over JSON:** `read` responses and `write` requests use base64 encoding for file content.
- **Fetch timeout:** 30-second `AbortSignal.timeout` prevents FUSE hangs if the server is down.
- **Graceful unmount:** SIGINT/SIGTERM handlers call `fuse.unmount()` with `diskutil unmount force` fallback.
- **Type declarations:** `fuse-native` has no built-in types. We use namespace merging in `types/fuse-native.d.ts` so `Fuse.FuseOperations` works alongside `export = Fuse`.
- **No `better-sqlite3`:** Removed in favor of `bun:sqlite` (built into Bun runtime). `db.ts` is still a stub.

## Commands

```bash
cd app
bun install                    # install deps
bun run start                  # mount FUSE at ./mnt (or pass custom path)
bun run start /path/to/mount   # mount at custom path
bun run build                  # type-check only (no JS output)
bun run codegen                # generate TS bindings from Move contract
```

## What's next (TODO)

1. **HTTP server** (`app/src/server.ts`) — `Bun.serve()` implementing the API contract above, wiring db + walrus + seal + sui
2. **SQLite cache** (`app/src/db.ts`) — file tree metadata using `bun:sqlite`
3. **Walrus client** (`app/src/walrus.ts`) — blob upload/download via Walrus HTTP API
4. **Seal integration** (`app/src/seal.ts`) — encrypt/decrypt using on-chain policy
5. **Sui client** (`app/src/sui.ts`) — create/update/delete FileEntry objects on-chain
