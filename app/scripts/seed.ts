/**
 * Seed script — sets up on-chain + Walrus data so the web UI has something to display.
 *
 * What it does (as admin):
 *   1. Register admin in the Registry (create allowlist) — skips if already done
 *   2. Grant access to the user address
 *   3. Encrypt test files with Seal (hello.txt + walrus.jpg)
 *   4. Upload encrypted blobs to Walrus
 *   5. Build a JSON manifest: [{name, blobId, size, createdAt}]
 *   6. Upload manifest JSON to Walrus
 *   7. Publish manifest blob ID on-chain
 *
 * Usage:
 *   cd app && bun run scripts/seed-web.ts
 *   cd app && bun run scripts/seed-web.ts --user-address 0xABC...
 *
 * Reads ADMIN_PRIVATE_KEY, USER_PRIVATE_KEY, PACKAGE_ID, REGISTRY_ID from .env
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SealClient } from "@mysten/seal";

import {
  register,
  grantAccess,
  publishManifest,
} from "../src/generated/walrus_drive/drive.js";
import { initWalrus, uploadBlob } from "../src/walrus.ts";
import { encrypt } from "../src/seal.ts";
import { findSharedWithMe, getManifestBlobId } from "../src/sharing.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const sealClient = new SealClient({
  suiClient: client,
  serverConfigs: TESTNET_KEY_SERVERS,
  verifyKeyServers: false,
});

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

console.log("Admin:", adminAddress);
console.log("User:", userAddress);
console.log("Package:", packageId);
console.log("Registry:", registryId);
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

console.log("1/7  Registering admin (creating allowlist)...");
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

console.log("2/7  Granting access to user...");
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

// ── Step 3–4: Encrypt and upload test files ─────────────────

const testFiles = [
  { path: resolve(__dirname, "../test_assets/sui.jpg"), name: "sui.jpg" },
  { path: resolve(__dirname, "../test_assets/Walrus Protocol Pitch.pptx"), name: "Walrus Protocol Pitch.pptx" },
  { path: resolve(__dirname, "../test_assets/Sui & Move Bootcamp _ Thessaloniki, 19-30 May, Recordings.docx"), name: "Sui & Move Bootcamp _ Thessaloniki, 19-30 May, Recordings.docx" },
];

initWalrus(client);

interface ManifestEntry {
  name: string;
  blobId: string;
  size: number;
  createdAt: number;
}

const manifest: ManifestEntry[] = [];

for (const [i, file] of testFiles.entries()) {
  const plaintext = readFileSync(file.path);
  console.log(`3/7  [${i + 1}/${testFiles.length}] Encrypting ${file.name} (${plaintext.length} bytes)...`);

  const encryptedBytes = await encrypt({
    sealClient,
    packageId,
    registryId,
    ownerAddress: adminAddress,
    data: plaintext,
  });
  console.log(`     Encrypted: ${encryptedBytes.length} bytes`);

  console.log(`4/7  [${i + 1}/${testFiles.length}] Uploading ${file.name} to Walrus...`);
  const blobId = await uploadBlob(encryptedBytes, adminKeypair, { epochs: 3 });
  console.log("     Blob ID:", blobId);

  manifest.push({
    name: file.name,
    blobId,
    size: plaintext.length,
    createdAt: Date.now(),
  });
}

// ── Step 5: Build manifest JSON ─────────────────────────────

console.log("5/7  Building manifest JSON...");
const manifestJson = new TextEncoder().encode(JSON.stringify(manifest));
console.log("     Manifest:", JSON.stringify(manifest, null, 2));

// ── Step 6: Upload manifest to Walrus ───────────────────────

console.log("6/7  Uploading manifest to Walrus...");
const manifestBlobId = await uploadBlob(manifestJson, adminKeypair, { epochs: 3 });
console.log("     Manifest Blob ID:", manifestBlobId);

// ── Step 7: Publish manifest on-chain ───────────────────────

console.log("7/7  Publishing manifest on-chain...");
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
