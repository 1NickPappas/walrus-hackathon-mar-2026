/**
 * Seed script — reads the local .walrusfs.db (populated by the FUSE server),
 * builds a manifest, uploads it to Walrus, and publishes on-chain so the
 * web UI has something to display.
 *
 * What it does (as admin):
 *   1. Register admin in the Registry (create allowlist) — skips if already done
 *   2. Grant access to the user address
 *   3. Read file records from the local SQLite DB
 *   4. Build a JSON manifest from DB records
 *   5. Upload manifest JSON to Walrus
 *   6. Publish manifest blob ID on-chain
 *
 * Usage:
 *   cd app && bun run seed-web
 *   cd app && bun run seed-web --user-address 0xABC...
 *   cd app && bun run seed-web --db ~/.walrusfs.db
 *
 * Reads ADMIN_PRIVATE_KEY, USER_PRIVATE_KEY, PACKAGE_ID, REGISTRY_ID from .env
 */

import "dotenv/config";
import { join } from "path";
import { homedir } from "os";

import { Database } from "bun:sqlite";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

import {
  register,
  grantAccess,
  publishManifest,
} from "../src/generated/walrus_drive/drive.js";
import { initWalrus, uploadBlob } from "../src/walrus.ts";
import { findSharedWithMe, getManifestBlobId } from "../src/sharing.ts";

// ── Config ──────────────────────────────────────────────────

const network = process.env.NETWORK ?? "testnet";
const rpcUrl = process.env.RPC_URL ?? `https://fullnode.${network}.sui.io:443`;
const packageId = process.env.PACKAGE_ID!;
const registryId = process.env.REGISTRY_ID!;

if (!packageId || !registryId) {
  console.error("Missing PACKAGE_ID or REGISTRY_ID in .env");
  process.exit(1);
}

const client = new SuiGrpcClient({ network, baseUrl: rpcUrl });

const adminKey = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY!);
const adminKeypair = Ed25519Keypair.fromSecretKey(adminKey.secretKey);
const adminAddress = adminKeypair.getPublicKey().toSuiAddress();

// User address: CLI arg or derived from USER_PRIVATE_KEY
const cliUserAddress = process.argv.find((a) => a.startsWith("--user-address="))?.split("=")[1];
let userAddress: string;
if (cliUserAddress) {
  userAddress = cliUserAddress;
} else {
  const userKey = decodeSuiPrivateKey(process.env.USER_PRIVATE_KEY!);
  const userKeypair = Ed25519Keypair.fromSecretKey(userKey.secretKey);
  userAddress = userKeypair.getPublicKey().toSuiAddress();
}

// DB path: CLI arg or default (~/.walrusfs.db)
const cliDbPath = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
const dbPath = cliDbPath ?? join(homedir(), ".walrusfs.db");

console.log("Admin:", adminAddress);
console.log("User:", userAddress);
console.log("Package:", packageId);
console.log("Registry:", registryId);
console.log("DB:", dbPath);
console.log();

// ── Helpers ─────────────────────────────────────────────────

async function signAndExec(tx: Transaction) {
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: adminKeypair,
  });
  await client.waitForTransaction({ result });
  const txn = result.Transaction!;
  if (!txn.status.success) {
    throw new Error(`Transaction failed: ${txn.status.error ?? "unknown"}`);
  }
  return txn;
}

// ── Step 1: Register admin ──────────────────────────────────

console.log("1/6  Registering admin (creating allowlist)...");
try {
  const tx = new Transaction();
  register({ package: packageId, arguments: { registry: registryId } })(tx);
  const txn = await signAndExec(tx);
  console.log("     Done. Digest:", txn.digest);
} catch (e: any) {
  if (e.message?.includes("already") || e.message?.includes("exists") || e.message?.includes("abort")) {
    console.log("     Already registered, skipping.");
  } else {
    throw e;
  }
}

// ── Step 2: Grant access to user ────────────────────────────

console.log("2/6  Granting access to user...");
try {
  const tx = new Transaction();
  grantAccess({ package: packageId, arguments: { registry: registryId, addr: userAddress } })(tx);
  const txn = await signAndExec(tx);
  console.log("     Done. Digest:", txn.digest);
} catch (e: any) {
  if (e.message?.includes("already") || e.message?.includes("abort")) {
    console.log("     Already granted, skipping.");
  } else {
    throw e;
  }
}

// ── Step 3: Read file records from local DB ──────────────────

console.log("3/6  Reading local DB...");
const db = new Database(dbPath, { readonly: true });
const files = db.query("SELECT filename, blob_id, size, created_at FROM files ORDER BY created_at DESC").all() as {
  filename: string;
  blob_id: string;
  size: number;
  created_at: string;
}[];
db.close();

if (files.length === 0) {
  console.error("No files found in the database. Upload some files via FUSE first.");
  process.exit(1);
}

console.log(`     Found ${files.length} file(s):`);
for (const f of files) {
  console.log(`       - ${f.filename} (${f.size} bytes, blob=${f.blob_id})`);
}

// ── Step 4: Build manifest JSON ──────────────────────────────

interface ManifestEntry {
  name: string;
  blobId: string;
  size: number;
  createdAt: number;
}

const manifest: ManifestEntry[] = files.map((f) => ({
  name: f.filename,
  blobId: f.blob_id,
  size: f.size,
  createdAt: new Date(f.created_at).getTime(),
}));

console.log("4/6  Building manifest JSON...");
console.log("     Manifest:", JSON.stringify(manifest, null, 2));

// ── Step 5: Upload manifest to Walrus ────────────────────────

console.log("5/6  Uploading manifest to Walrus...");
initWalrus(client);
const manifestJson = new TextEncoder().encode(JSON.stringify(manifest));
const { blobId: manifestBlobId } = await uploadBlob(manifestJson, adminKeypair, { epochs: 5 });
console.log("     Manifest Blob ID:", manifestBlobId);

// ── Step 6: Publish manifest on-chain ────────────────────────

console.log("6/6  Publishing manifest on-chain...");
{
  const tx = new Transaction();
  publishManifest({ package: packageId, arguments: { registry: registryId, blobId: manifestBlobId } })(tx);
  const txn = await signAndExec(tx);
  console.log("     Done. Digest:", txn.digest);
}

// ── Verify ──────────────────────────────────────────────────

console.log("\n--- Verification ---");
const owners = await findSharedWithMe(client, registryId, userAddress);
console.log("Owners who shared with user:", owners);

const onChainManifest = await getManifestBlobId(client, registryId, adminAddress);
console.log("On-chain manifest blob ID:", onChainManifest);

console.log("\nDone! Open the web UI, connect with the user wallet, and you should see the shared files.");
