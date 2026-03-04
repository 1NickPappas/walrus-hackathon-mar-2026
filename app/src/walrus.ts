/** Walrus blob upload/download. */

import { walrus } from "@mysten/walrus";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Keypair } from "@mysten/sui/cryptography";

let extendedClient: ReturnType<typeof initWalrus> | null = null;

export function initWalrus(suiClient: SuiGrpcClient) {
  const client = suiClient.$extend(walrus());
  extendedClient = client;
  return client;
}

export async function uploadBlob(
  data: Uint8Array,
  signer: Keypair,
  opts?: { epochs?: number; deletable?: boolean },
): Promise<string> {
  const { blobId } = await extendedClient!.walrus.writeBlob({
    blob: data,
    deletable: opts?.deletable ?? true,
    epochs: opts?.epochs ?? 3,
    signer,
  });
  return blobId;
}

export async function downloadBlob(blobId: string): Promise<Uint8Array> {
  return extendedClient!.walrus.readBlob({ blobId });
}
