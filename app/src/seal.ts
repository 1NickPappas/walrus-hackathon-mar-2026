/** Seal encrypt/decrypt via on-chain policy. */

import { SealClient } from "@mysten/seal";
import { fromHex, toHex } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

interface SealConfig {
  suiClient: SuiGrpcClient;
  keyServers: { objectId: string; weight: number }[];
  packageId: string;
  registryId: string;
  ownerAddress: string;
}

let sealClient: SealClient | null = null;
let config: SealConfig | null = null;

export function initSeal(cfg: SealConfig): void {
  config = cfg;
  sealClient = new SealClient({
    suiClient: cfg.suiClient,
    serverConfigs: cfg.keyServers,
    verifyKeyServers: false,
  });
  console.log("[seal] Seal ready");
}

export async function encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
  if (!sealClient || !config) throw new Error("Seal not initialized — call initSeal first");

  // Build Seal ID: registryId bytes (32) + owner address bytes (32)
  // Matches check_policy in drive.move
  const registryBytes = fromHex(config.registryId.replace(/^0x/, ""));
  const ownerBytes = fromHex(config.ownerAddress.replace(/^0x/, ""));
  const sealId = new Uint8Array(64);
  sealId.set(registryBytes, 0);
  sealId.set(ownerBytes, 32);

  const { encryptedObject } = await sealClient.encrypt({
    threshold: 2,
    packageId: config.packageId,
    id: toHex(sealId),
    data: plaintext,
  });

  return encryptedObject;
}

export async function decrypt(_ciphertext: Uint8Array): Promise<Uint8Array> {
  // TODO: decrypt using Seal policy (separate concern — needs session key + tx bytes)
  throw new Error("decrypt not yet implemented");
}
