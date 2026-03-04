# Walrus FS

A decentralized Dropbox for macOS.

**FUSE** filesystem + **Seal** encryption + **Walrus** storage + **Sui** on-chain logic.

Drop files into a mounted drive. They get encrypted, stored on Walrus, and managed on Sui. Or use the web UI to browse and download shared files from the browser.

## Project Structure

```
walrus-hackathon-mar-2026/
├── contract/                  # Move smart contract (Sui)
│   ├── Move.toml
│   └── sources/
│       └── walrus_drive.move  # Seal policy, file metadata, access control
├── app/                       # TypeScript FUSE daemon + client
│   ├── src/
│   │   ├── index.ts           # Entry point — mount FUSE, start daemon
│   │   ├── fuse.ts            # FUSE ops (read/write/readdir/stat)
│   │   ├── db.ts              # SQLite local cache for fast file tree lookups
│   │   ├── walrus.ts          # Upload/download encrypted blobs to Walrus
│   │   ├── seal.ts            # Encrypt before upload, decrypt after download
│   │   └── sui.ts             # Read/write file metadata objects on Sui
│   └── scripts/
│       └── seed.ts        # Seed script — populates on-chain + Walrus data
├── web/                       # Next.js web UI
│   └── app/
│       ├── page.tsx            # Entry page
│       ├── components/
│       │   ├── SharedFilesPage.tsx  # Main file browser UI
│       │   ├── Providers.tsx        # dapp-kit + React Query providers
│       │   └── ConnectWallet.tsx    # Wallet connection button
│       └── lib/
│           ├── seal.ts         # Browser Seal decrypt (session keys)
│           ├── sharing.ts      # Registry discovery (manifests, allowlists)
│           ├── walrus.ts       # Download blobs via aggregator proxy
│           └── constants.ts    # Env var exports
```

## How It Works

| Component | What it does |
|-----------|-------------|
| **contract/** | Move package on Sui — defines a **Seal encryption policy** that controls who can encrypt/decrypt files |
| **app/src/fuse.ts** | Translates Finder/shell actions (open, read, write, ls) into Walrus uploads/downloads + SQLite cache updates |
| **app/src/db.ts** | SQLite — caches the file tree locally so `ls` and `stat` are instant without hitting the chain |
| **app/src/walrus.ts** | Talks to the Walrus network — stores and retrieves encrypted file blobs |
| **app/src/seal.ts** | Wraps Seal SDK — encrypts plaintext before upload, decrypts ciphertext after download, using the on-chain policy |
| **app/src/sui.ts** | Sui client — creates/updates/deletes `FileEntry` objects on-chain so the file registry stays in sync |
| **web/** | Next.js browser UI — connects wallet, discovers files from on-chain Registry, decrypts Seal-encrypted blobs on download |

## Running the Web UI

### Prerequisites

- Node.js 18+
- A deployed contract (you need `PACKAGE_ID` and `REGISTRY_ID`)

### 1. Install dependencies

```bash
cd web
npm install
```

### 2. Configure environment

Create `web/.env.local`:

```env
NEXT_PUBLIC_PACKAGE_ID=0x<your-package-id>
NEXT_PUBLIC_REGISTRY_ID=0x<your-registry-id>
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
```

### 3. Start the dev server

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect your Sui wallet, and you'll see your files.

## Seed Script

The seed script populates the on-chain Registry and Walrus with test data so the web UI has files to display.

**What it does:**
1. Registers the admin in the Registry (creates allowlist)
2. Grants access to a user address
3. Encrypts test files with Seal
4. Uploads encrypted blobs to Walrus
5. Builds a JSON manifest and uploads it to Walrus
6. Publishes the manifest blob ID on-chain

### Configure

Make sure `app/.env` has:

```env
ADMIN_PRIVATE_KEY=suiprivkey1...
USER_PRIVATE_KEY=suiprivkey1...
PACKAGE_ID=0x...
REGISTRY_ID=0x...
NETWORK=testnet
```

### Run

```bash
cd app
bun run scripts/seed.ts
```

Or with a custom user address:

```bash
bun run scripts/seed.ts --user-address=0xABC...
```
