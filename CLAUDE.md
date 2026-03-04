# CLAUDE.md — Walrus Drive

> **Keep this file up to date.** When introducing changes (new files, architectural decisions, dependency changes, implemented features), update the relevant sections below before finishing the task.

## What is this project?

Walrus Drive is a decentralized Dropbox for macOS. Files dropped into a FUSE-mounted drive get encrypted (Seal), stored on Walrus, and tracked on Sui. The stack:

- **FUSE** → virtual filesystem mounted via `fuse-native` (macFUSE)
- **Seal** → on-chain encryption policy (encrypt before upload, decrypt after download)
- **Walrus** → decentralized blob storage
- **Sui** → on-chain file registry (Move smart contract)

## Prerequisites

### System dependencies

| Dependency | Version | Why | Install (Debian/Ubuntu ARM64) |
|---|---|---|---|
| **Node.js** | ≥ 18 | `fuse-native` is a native Node addon; `tsx` runs the FUSE client under Node | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo bash - && sudo apt install -y nodejs` |
| **Bun** | ≥ 1.1 | HTTP server runtime, package manager, SQLite (`bun:sqlite`) | `curl -fsSL https://bun.sh/install \| bash` |
| **libfuse-dev** | 2.x or 3.x | FUSE kernel interface — `fuse-native` compiles against this | `sudo apt install -y libfuse-dev` (or `fuse3 libfuse3-dev`) |
| **build-essential** | — | C/C++ toolchain for compiling `fuse-native` native addon | `sudo apt install -y build-essential` |
| **Sui CLI** | ≥ 1.x | `sui move build` for Move contract compilation (used by tests) | See [Sui install docs](https://docs.sui.io/guides/developer/getting-started/sui-install) |

**macOS:** Install [macFUSE](https://osxfuse.github.io/) instead of `libfuse-dev`. Xcode command line tools provide the C++ toolchain.

### Sui wallet setup

You need two funded Sui testnet wallets (admin + user):

1. Generate keys: `sui keytool generate ed25519` (run twice)
2. Export private keys in `suiprivkey1q...` format
3. Fund with testnet SUI via [Sui faucet](https://faucet.testnet.sui.io/)
4. Fund with testnet WAL tokens for Walrus storage fees — WAL is separate from SUI

### Environment variables

Copy `app/.env.example` to `app/.env` and fill in:

```bash
NETWORK=testnet
RPC_URL=https://fullnode.testnet.sui.io:443
ADMIN_PRIVATE_KEY=suiprivkey1q...    # Admin wallet (owns files, pays for uploads)
USER_PRIVATE_KEY=suiprivkey1q...     # Test user (for decrypt tests)
PACKAGE_ID=0x...                     # Published Move package ID (from test or manual deploy)
REGISTRY_ID=0x...                    # Shared Registry object ID (created on publish)
DB_PATH=./data/walrus.db             # Optional — defaults to ./data/walrus.db
```

### Quick start

```bash
# 1. Install system deps (Linux ARM64)
sudo apt install -y build-essential libfuse-dev

# 2. Install JS deps
cd app
bun install

# 3. Set up env
cp .env.example .env
# Edit .env with your keys and IDs

# 4. Type-check
bun run build

# 5. Run server only (no FUSE mount)
bun run start:server

# 6. Run full stack (server + FUSE mount at ./mnt)
bun run start
```

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
│   └── sources/walrus_drive.move      # drive module: allowlist + manifest sharing via Seal
├── app/                               # TypeScript FUSE daemon
│   ├── package.json                   # Scripts: start, build, codegen
│   ├── tsconfig.json                  # Bun-compatible: module=preserve, bundler resolution
│   └── src/
│       ├── index.ts                   # Entry point — starts Bun server, spawns FUSE via tsx
│       ├── fuse-mount.ts             # ✅ Standalone FUSE entry point (runs under Node/tsx)
│       ├── server.ts                  # ✅ Bun.serve() HTTP server — in-memory FS, 12 FUSE ops, Walrus upload on release
│       ├── fuse.ts                    # ✅ FUSE HTTP thin client (12 ops → localhost:3001)
│       ├── types/fuse-native.d.ts     # ✅ TypeScript declarations for fuse-native
│       ├── db.ts                      # ✅ SQLite local cache via bun:sqlite (filename → blobId)
│       ├── walrus.ts                  # ✅ Walrus blob upload/download via @mysten/walrus SDK
│       ├── seal.ts                    # ✅ Seal encrypt (decrypt stub — needs SessionKey)
│       └── sui.ts                     # 🔲 Stub — Sui on-chain file metadata
│   ├── test/
│   │   └── walrus-drive.test.ts       # ✅ Integration tests: publish, allowlist, walrus, encrypt, decrypt
│   ├── test_assets/
│   │   └── hello.txt                  # Test fixture for encrypt/decrypt
│   ├── jest.config.ts                 # Jest config (ts-jest, ESM)
│   └── .env.example                   # Required env vars for tests
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
- **No `better-sqlite3`:** Uses `bun:sqlite` (built into Bun runtime) — no native SQLite addon needed.
- **Two-process model:** `index.ts` spawns `fuse-mount.ts` via `npx tsx` (Node). Signals are forwarded for graceful cleanup. Each half can be run independently with `start:server` / `start:fuse` for debugging.
- **Internal files** (`.walrusfs.db`, `.walrusfs.db-wal`, `.walrusfs.db-shm`, `.DS_Store`) are excluded from Walrus upload — they only exist locally in the in-memory FS.
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
bun run codegen                # generate TS bindings from Move contract
bun run test                   # run integration tests (requires .env with keys)
```

See **Prerequisites** section above for system dependency installation.

## Testing

Integration tests in `app/test/walrus-drive.test.ts` run against **testnet**. They require a `.env` file (see `.env.example`):

- `ADMIN_PRIVATE_KEY` / `USER_PRIVATE_KEY` — Sui private keys (`suiprivkey1q...`)
- `PACKAGE_ID` — published Move package ID (`0x...`)
- `REGISTRY_ID` — shared Registry object ID (`0x...`)
- `NETWORK` — defaults to `testnet`
- `RPC_URL` — defaults to `https://fullnode.testnet.sui.io:443`
- `DB_PATH` — SQLite database path (defaults to `./data/walrus.db`)

The test suite is sequential (each test depends on the previous):

1. **Publish** — compiles Move via `sui move build --dump-bytecode-as-base64`, publishes via SDK `tx.publish()`
2. **Create allowlist** — admin creates a Seal allowlist in the registry
3. **Add user** — admin adds user address to allowlist
4. **Walrus upload/download** — uploads `hello.txt` to Walrus, downloads and verifies match
5. **Encrypt** — encrypts `hello.txt` via Seal with threshold encryption
6. **Upload encrypted blob + publish manifest** — uploads encrypted bytes to Walrus, records blob ID on-chain via `publishManifest`
7. **Decrypt** — user decrypts as an authorized allowlist member

**Note:** Publishing uses the TypeScript SDK (not `sui client publish`), so no CLI env/key configuration is needed — only `sui move build` is called for Move compilation.

## What's next (TODO)

1. ~~**HTTP server** (`app/src/server.ts`)~~ — ✅ Implemented with in-memory file tree (placeholder until Walrus/Seal/Sui replace it)
2. ~~**SQLite cache** (`app/src/db.ts`)~~ — ✅ Implemented with `bun:sqlite` (filename → blobId tracking)
3. ~~**Walrus client** (`app/src/walrus.ts`)~~ — ✅ Implemented with `@mysten/walrus` SDK (upload/download blobs)
4. ~~**Seal integration** (`app/src/seal.ts`)~~ — ✅ Encrypt implemented (decrypt stub — needs SessionKey for read flow)
5. **Sui client** (`app/src/sui.ts`) — create/update/delete FileEntry objects on-chain
6. **Replace `sui move build` CLI with SDK** — test publish step uses `execSync("sui move build --dump-bytecode-as-base64")` which requires the Sui CLI binary. Replace with SDK-based Move compilation to remove CLI dependency and enable Dockerization
