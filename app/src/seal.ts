/** Seal encrypt/decrypt via on-chain policy. */

import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SealClient, SessionKey } from "@mysten/seal";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import { sealApprove } from "./generated/walrus_drive/drive.js";

/** Build the 64-byte Seal ID from registryId + ownerAddress. */
export function buildSealId(registryId: string, ownerAddress: string): Uint8Array {
  const registryBytes = fromHex(registryId.replace(/^0x/, ""));
  const ownerBytes = fromHex(ownerAddress.replace(/^0x/, ""));
  const sealId = new Uint8Array(64);
  sealId.set(registryBytes, 0);
  sealId.set(ownerBytes, 32);
  return sealId;
}

/** Encrypt data using Seal with the on-chain allowlist policy. */
export async function encrypt(opts: {
  sealClient: SealClient;
  packageId: string;
  registryId: string;
  ownerAddress: string;
  data: Uint8Array;
  threshold?: number;
}): Promise<Uint8Array> {
  const sealId = buildSealId(opts.registryId, opts.ownerAddress);
  const { encryptedObject } = await opts.sealClient.encrypt({
    threshold: opts.threshold ?? 2,
    packageId: opts.packageId,
    id: toHex(sealId),
    data: opts.data,
  });
  return encryptedObject;
}

/** Decrypt data using Seal — builds the seal_approve transaction internally. */
export async function decrypt(opts: {
  sealClient: SealClient;
  sessionKey: SessionKey;
  packageId: string;
  registryId: string;
  ownerAddress: string;
  suiClient: SuiGrpcClient;
  data: Uint8Array;
}): Promise<Uint8Array> {
  const sealId = buildSealId(opts.registryId, opts.ownerAddress);

  const tx = new Transaction();
  sealApprove({
    package: opts.packageId,
    arguments: {
      id: Array.from(sealId),
      registry: opts.registryId,
    },
  })(tx);
  const txBytes = await tx.build({
    client: opts.suiClient,
    onlyTransactionKind: true,
  });

  return opts.sealClient.decrypt({
    data: opts.data,
    sessionKey: opts.sessionKey,
    txBytes,
  });
}
