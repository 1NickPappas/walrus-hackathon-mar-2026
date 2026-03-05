# Walrus FS — Web UI

Browser-based file manager for Walrus FS. Connect your Sui wallet to browse, discover, and download Seal-encrypted files stored on Walrus.

## Quick Start

```bash
npm install
cp .env.local.example .env.local   # edit with your contract IDs
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- **My Files** — view files from your own manifest
- **Shared with me** — discover files others have shared with you via on-chain allowlists
- **Download & Decrypt** — Seal session-key decryption happens in the browser on click
- **Dark theme** — custom dapp-kit theme matching the UI
- **Auto-discover** — files load automatically on wallet connect; refreshes on account switch
