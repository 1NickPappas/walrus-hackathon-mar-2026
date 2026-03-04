# CLAUDE.md — Walrus Drive

> **Keep this file up to date.** When introducing changes (new files, architectural decisions, dependency changes, implemented features), update the relevant sections below before finishing the task.

## What is this project?

Walrus Drive is a decentralized Dropbox for macOS. Files dropped into a FUSE-mounted drive get encrypted (Seal), stored on Walrus, and tracked on Sui. The stack:

- **FUSE** → virtual filesystem mounted via `fuse-native` (macFUSE)
- **Seal** → on-chain encryption policy (encrypt before upload, decrypt after download)
- **Walrus** → decentralized blob storage
- **Sui** → on-chain file registry (Move smart contract)

## Runtime & tooling

- **Runtime:** Two-process model — Bun runs the HTTP server, Node (via `tsx`) runs the FUSE client. See Architecture section below.
- **Language:** TypeScript — Bun runs `.ts` directly, `tsx` runs `.ts` under Node
- **Type checking:** `bun run --bun tsc --noEmit` (tsc is type-checker only, `noEmit: true`)
- **Package manager:** Bun (`bun.lock`, not `package-lock.json`)
- **Module resolution:** `"moduleResolution": "bundler"` — use `.ts` extensions in imports

## Repository layout

```
walrus-hackathon-mar-2026/
├── CLAUDE.md                          # ← you are here
├── contract/                          # Move smart contract (Sui)
│   ├── Move.toml
│   ├── bytecode.json                  # ✅ Pre-compiled Move bytecode (re-run `bun run compile` after contract changes)
│   └── sources/walrus_drive.move      # drive module: allowlist + manifest sharing via Seal
├── app/                               # TypeScript FUSE daemon
│   ├── package.json                   # Scripts: start, build, codegen
│   ├── tsconfig.json                  # Bun-compatible: module=preserve, bundler resolution
│   └── src/
│       ├── index.ts                   # Entry point — starts Bun server, spawns FUSE via tsx
│       ├── fuse-mount.ts             # ✅ Standalone FUSE entry point (runs under Node/tsx)
│       ├── server.ts                  # ✅ Bun.serve() HTTP server — in-memory FS, 12 FUSE ops
│       ├── fuse.ts                    # ✅ FUSE HTTP thin client (12 ops → localhost:3001)
│       ├── types/fuse-native.d.ts     # ✅ TypeScript declarations for fuse-native
│       ├── db.ts                      # ✅ SQLite blob tracker (bun:sqlite) — initDb, insertBlob, getBlob, listBlobs
│       ├── walrus.ts                  # ✅ Walrus blob upload/download via @mysten/walrus SDK
│       ├── seal.ts                    # ✅ Seal encrypt (decrypt stub) — initSeal, encrypt via SealClient
│       ├── publish.ts                 # ✅ SDK publish utility — reads pre-compiled bytecode, publishes via SDK
│       └── sui.ts                     # 🔲 Stub — Sui on-chain file metadata
│   ├── test/
│   │   └── walrus-drive.test.ts       # ✅ Integration tests: publish, allowlist, walrus, encrypt, decrypt
│   ├── test_assets/
│   │   └── hello.txt                  # Test fixture for encrypt/decrypt
│   ├── jest.config.ts                 # Jest config (ts-jest, ESM)
│   └── .env.example                   # Required env vars (keys + package/registry IDs)
├── .walrus-drive.sqlite               # (gitignored) Local blob tracker DB — lives next to mount point
├── fuse-plan.md                       # Research notes on FUSE + macOS + TypeScript
└── .gitignore
```

Legend: ✅ = implemented, 🔲 = stub/TODO

## Architecture: Two-process FUSE ↔ HTTP server split

The app runs as **two processes** connected via HTTP:

```
┌─────────────────────┐   HTTP POST (JSON)   ┌──────────────────┐
│  fuse-mount.ts      │ ──────────────────── │  HTTP server     │
│  (Node via tsx)     │  localhost:3001      │  (Bun.serve)     │
│                     │ ◄──────────────────── │  db + walrus +   │
│  kernel ↔ fuse.ts   │   JSON responses     │  seal + sui      │
└─────────────────────┘                      └──────────────────┘
     Process 2 (Node)                            Process 1 (Bun)
```

**Why two processes:** `fuse-native` is a native Node addon that relies on `libuv` internals (semaphores, threading). Bun doesn't fully support these — especially on Linux ARM64 where no prebuilt binaries exist. Running the FUSE client under Node (via `tsx`) gives full native addon support. The HTTP split makes this a clean process boundary.

**How it works:** `index.ts` (Bun) starts the HTTP server, then spawns `fuse-mount.ts` as a child process under `npx tsx`. Signals (SIGINT/SIGTERM) are forwarded to the child for graceful FUSE unmount.

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

## Smart contract (`walrus_drive::drive`)

`contract/sources/walrus_drive.move` — A single shared `Registry` object with two tables:

- **`allowlists`**: `Table<address, VecSet<address>>` — who can decrypt each owner's files
- **`manifests`**: `Table<address, String>` — each owner's Walrus blob ID pointing to a JSON manifest of shared files

Key functions: `register`, `grant_access`, `revoke_access`, `publish_manifest`, `unpublish_manifest`, `seal_approve`.

## Sharing flow

### Alice (owner) shares files:

1. Files already stored via FUSE (encrypted → Walrus → tracked locally)
2. Calls `grant_access(registry, bob_address)` — adds Bob to her allowlist
3. Creates a manifest JSON: `[{name: "report.pdf", blobId: "abc", size: 1024}, ...]`
4. Uploads manifest to Walrus → gets manifest blob ID
5. Calls `publish_manifest(registry, manifest_blob_id)` on-chain

### Bob (recipient) accesses shared files via web UI:

1. Connects wallet
2. Queries the shared Registry — finds all owners who have Bob on their allowlist
3. For each owner, reads their manifest blob ID
4. Downloads manifest from Walrus → gets the file listing
5. Clicks a file → downloads that blob from Walrus → Seal decrypts → Bob gets plaintext

**Key design decision:** Bob does NOT download shared files into his FUSE mount — that would trigger the write flow and re-upload to Walrus. Shared files are accessed read-only via a separate web UI.

## Key patterns & gotchas

- **`read`/`write` callback quirk:** In `fuse-native`, most callbacks are `cb(err, result)`. But `read` and `write` use `cb(bytesTransferred)` — `0` means EOF (not success), negative means error. This is handled in `fuse.ts`.
- **Binary data over JSON:** `read` responses and `write` requests use base64 encoding for file content.
- **Fetch timeout:** 30-second `AbortSignal.timeout` prevents FUSE hangs if the server is down.
- **Graceful unmount:** SIGINT/SIGTERM handlers call `fuse.unmount()` with `diskutil unmount force` fallback.
- **Type declarations:** `fuse-native` has no built-in types. We use namespace merging in `types/fuse-native.d.ts` so `Fuse.FuseOperations` works alongside `export = Fuse`.
- **No `better-sqlite3`:** Using `bun:sqlite` (built into Bun runtime). `db.ts` tracks blob ID ↔ file name mappings.
- **Two-process model:** `index.ts` spawns `fuse-mount.ts` via `npx tsx` (Node). Signals are forwarded for graceful cleanup. Each half can be run independently with `start:server` / `start:fuse` for debugging.
- **Release pipeline:** On `handleRelease`, if file has content and signer is set: encrypt (Seal) → upload (Walrus) → insertBlob (SQLite). Pipeline is disabled gracefully if env vars are missing.
- **Walrus SDK uses client extension pattern:** `suiClient.$extend(walrus())` — not a standalone constructor. Methods accessed via `client.walrus.writeBlob()` / `client.walrus.readBlob()`. Uploads require WAL tokens (not SUI) for storage fees.

## Commands

```bash
cd app
bun install                    # install deps (includes tsx for Node FUSE process)
bun run start                  # start server (Bun) + FUSE (Node/tsx) at ./mnt
bun run start /path/to/mount   # mount at custom path
bun run start:server           # run HTTP server only (Bun)
bun run start:fuse             # run FUSE client only (Node/tsx) — needs server running
bun run build                  # type-check only (no JS output)
bun run compile                # re-compile Move bytecode to contract/bytecode.json (requires sui CLI)
bun run codegen                # generate TS bindings from Move contract
bun run test                   # run integration tests (requires .env with keys)
```

**Linux ARM64 note:** Ensure `libfuse-dev` (or `fuse3`) is installed for `fuse-native` to compile its native addon. Node must be available (for `tsx`).

## Testing

Integration tests in `app/test/walrus-drive.test.ts` run against **testnet**. They require a `.env` file (see `.env.example`):

- `ADMIN_PRIVATE_KEY` / `USER_PRIVATE_KEY` — Sui private keys (`suiprivkey1q...`)
- `NETWORK` — defaults to `testnet`
- `RPC_URL` — defaults to `https://fullnode.testnet.sui.io:443`
- `PACKAGE_ID` — published Move package object ID (required for encrypt pipeline)
- `REGISTRY_ID` — shared Registry object ID (required for encrypt pipeline)

The test suite is sequential (each test depends on the previous):

1. **Publish** — reads pre-compiled `contract/bytecode.json`, publishes via `publishPackage()` SDK utility
2. **Create allowlist** — admin creates a Seal allowlist in the registry
3. **Add user** — admin adds user address to allowlist
4. **Walrus upload/download** — uploads `hello.txt` to Walrus, downloads and verifies match
5. **Encrypt** — encrypts `hello.txt` via Seal with threshold encryption
6. **Upload encrypted blob + publish manifest** — uploads encrypted bytes to Walrus, records blob ID on-chain via `publishManifest`
7. **Decrypt** — user decrypts as an authorized allowlist member

**Note:** Publishing uses the TypeScript SDK with pre-compiled bytecode (`contract/bytecode.json`). No `sui` CLI is needed at test runtime — only for re-compiling via `bun run compile` when the contract changes.

## What's next (TODO)

1. ~~**HTTP server** (`app/src/server.ts`)~~ — ✅ Implemented with in-memory file tree + encrypt→upload→SQLite pipeline on release
2. ~~**SQLite cache** (`app/src/db.ts`)~~ — ✅ Blob tracker using `bun:sqlite` (blob_id ↔ file_name)
3. ~~**Walrus client** (`app/src/walrus.ts`)~~ — ✅ Implemented with `@mysten/walrus` SDK (upload/download blobs)
4. ~~**Seal encrypt** (`app/src/seal.ts`)~~ — ✅ `initSeal` + `encrypt` using `SealClient` (decrypt still TODO)
5. **Sui client** (`app/src/sui.ts`) — create/update/delete FileEntry objects on-chain
6. ~~**Replace `sui move build` CLI with SDK**~~ — ✅ Pre-compiled bytecode in `contract/bytecode.json` + `publishPackage()` utility in `app/src/publish.ts`. No CLI needed at runtime
