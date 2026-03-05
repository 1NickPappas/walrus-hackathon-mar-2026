/**
 * Share script — reads the local .walrusfs.db, builds a manifest JSON from
 * tracked files, uploads it to Walrus, and publishes the manifest blob ID
 * on-chain so other users can discover and decrypt shared files.
 *
 * Usage:
 *   cd app && bun run share
 *   cd app && bun run share --db ~/.walrusfs.db
 *   cd app && bun run share --user-address 0xABC...
 */

import "dotenv/config";
import { resolve, dirname, join } from "path";
import { homedir } from "os";

import { Database } from "bun:sqlite";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

import { publishManifest, register, grantAccess } from "../src/generated/walrus_drive/drive.js";
import { initWalrus, uploadBlob } from "../src/walrus.ts";

const TESTNET_KEY_SERVERS = [
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
  { objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", weight: 1 },
];

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

// Optional: grant access to a user address
const cliUserAddress = process.argv.find((a) => a.startsWith("--user-address="))?.split("=")[1];
let userAddress: string | null = null;
if (cliUserAddress) {
  userAddress = cliUserAddress;
} else if (process.env.USER_PRIVATE_KEY) {
  const userKey = decodeSuiPrivateKey(process.env.USER_PRIVATE_KEY);
  const userKeypair = Ed25519Keypair.fromSecretKey(userKey.secretKey);
  userAddress = userKeypair.getPublicKey().toSuiAddress();
}

// DB path: CLI arg or default (~/.walrusfs.db)
const cliDbPath = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
const dbPath = cliDbPath ?? join(homedir(), ".walrusfs.db");

console.log("Admin:", adminAddress);
if (userAddress) console.log("User:", userAddress);
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

// ── Step 1: Read the local DB ────────────────────────────────

console.log("1/4  Reading local DB...");
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

// ── Step 2: Build manifest JSON ──────────────────────────────

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

console.log("\n2/4  Uploading manifest to Walrus...");
initWalrus(client);
const manifestJson = new TextEncoder().encode(JSON.stringify(manifest));
const { blobId: manifestBlobId } = await uploadBlob(manifestJson, adminKeypair, { epochs: 5 });
console.log("     Manifest Blob ID:", manifestBlobId);

// ── Step 3: Publish manifest on-chain ────────────────────────

console.log("\n3/4  Publishing manifest on-chain...");
{
  const tx = new Transaction();
  publishManifest({ package: packageId, arguments: { registry: registryId, blobId: manifestBlobId } })(tx);
  try {
    const txn = await signAndExec(tx);
    console.log("     Done. Digest:", txn.digest);
  } catch (e: any) {
    // If admin isn't registered yet, register first then retry
    if (e.message?.includes("abort")) {
      console.log("     Admin not registered yet, registering...");
      const regTx = new Transaction();
      register({ package: packageId, arguments: { registry: registryId } })(regTx);
      await signAndExec(regTx);

      const retryTx = new Transaction();
      publishManifest({ package: packageId, arguments: { registry: registryId, blobId: manifestBlobId } })(retryTx);
      const txn = await signAndExec(retryTx);
      console.log("     Done. Digest:", txn.digest);
    } else {
      throw e;
    }
  }
}

// ── Step 4: Grant access (optional) ──────────────────────────

if (userAddress) {
  console.log(`\n4/4  Granting access to ${userAddress}...`);
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
} else {
  console.log("\n4/4  No user address provided, skipping access grant.");
}

console.log("\nSharing complete! Manifest published with", files.length, "file(s).");
