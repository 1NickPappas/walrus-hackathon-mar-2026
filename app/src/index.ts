import { startServer, initServerPipeline } from "./server.ts";
import { initDb } from "./db.ts";
import { initWalrus } from "./walrus.ts";
import { initSeal } from "./seal.ts";
import { spawn } from "child_process";
import { resolve, dirname } from "path";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const TESTNET_KEY_SERVERS = [
  {
    objectId:
      "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    weight: 1,
  },
  {
    objectId:
      "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
    weight: 1,
  },
];

export async function main() {
  console.log("walrus-drive starting…");

  const mountPoint = process.argv[2] || "./mnt";
  const port = Number(process.argv[3]) || 3001;
  const baseUrl = `http://localhost:${port}`;

  // ── Initialize pipeline: SuiClient → Walrus → Seal → SQLite ──
  const network = process.env.NETWORK ?? "testnet";
  const rpcUrl =
    process.env.RPC_URL ?? `https://fullnode.${network}.sui.io:443`;
  const adminPrivKey = process.env.ADMIN_PRIVATE_KEY;
  const packageId = process.env.PACKAGE_ID;
  const registryId = process.env.REGISTRY_ID;

  if (!adminPrivKey || !packageId || !registryId) {
    console.warn(
      "[init] Missing ADMIN_PRIVATE_KEY, PACKAGE_ID, or REGISTRY_ID — pipeline disabled (in-memory only)",
    );
  } else {
    const suiClient = new SuiGrpcClient({ network, baseUrl: rpcUrl });

    const decoded = decodeSuiPrivateKey(adminPrivKey);
    const adminKeypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
    const ownerAddress = adminKeypair.getPublicKey().toSuiAddress();

    initWalrus(suiClient);
    initSeal({
      suiClient,
      keyServers: TESTNET_KEY_SERVERS,
      packageId,
      registryId,
      ownerAddress,
    });
    const dbPath = resolve(dirname(resolve(mountPoint)), ".walrus-drive.sqlite");
    initDb(dbPath);
    initServerPipeline(adminKeypair);

    console.log(`[init] pipeline ready — owner=${ownerAddress}`);
  }

  // ── Start HTTP server (runs in Bun) ──
  startServer(port);
  console.log(`server listening on ${baseUrl}`);

  // ── Spawn FUSE client under Node via tsx (fuse-native needs libuv) ──
  const fuseMountScript = resolve(import.meta.dir, "fuse-mount.ts");
  const child = spawn("npx", ["tsx", fuseMountScript, mountPoint, baseUrl], {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    console.log(`fuse-mount exited with code ${code}`);
    process.exit(code ?? 1);
  });

  // Forward signals so the FUSE cleanup handler can unmount gracefully
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

main();
