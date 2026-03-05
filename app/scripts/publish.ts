/**
 * Publish manifest — reads the local .walrusfs.db, builds a manifest,
 * uploads it to Walrus, and publishes the manifest blob ID on-chain.
 * Does NOT grant access to anyone — just makes your own files visible.
 *
 * Usage:
 *   cd app && bun run publish
 *   cd app && bun run publish --db ~/.walrusfs.db
 */

import "dotenv/config";
import { join } from "path";
import { homedir } from "os";

import { Database } from "bun:sqlite";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

import { register, publishManifest } from "../src/generated/walrus_drive/drive.js";
import { initWalrus, uploadBlob } from "../src/walrus.ts";

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

const cliDbPath = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
const dbPath = cliDbPath ?? join(homedir(), ".walrusfs.db");

console.log("Admin:", adminAddress);
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

console.log("1/3  Reading local DB...");
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

// ── Step 2: Upload manifest to Walrus ────────────────────────

const manifest = files.map((f) => ({
  name: f.filename,
  blobId: f.blob_id,
  size: f.size,
  createdAt: new Date(f.created_at).getTime(),
}));

console.log("\n2/3  Uploading manifest to Walrus...");
initWalrus(client);
const manifestJson = new TextEncoder().encode(JSON.stringify(manifest));
const { blobId: manifestBlobId } = await uploadBlob(manifestJson, adminKeypair, { epochs: 5 });
console.log("     Manifest Blob ID:", manifestBlobId);

// ── Step 3: Publish manifest on-chain ────────────────────────

console.log("\n3/3  Publishing manifest on-chain...");
{
  const tx = new Transaction();
  publishManifest({ package: packageId, arguments: { registry: registryId, blobId: manifestBlobId } })(tx);
  try {
    const txn = await signAndExec(tx);
    console.log("     Done. Digest:", txn.digest);
  } catch (e: any) {
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

console.log("\nPublished! Manifest with", files.length, "file(s) is now visible on-chain.");
