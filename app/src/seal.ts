/** Seal encrypt/decrypt via on-chain policy. */

import type { SealClient } from "@mysten/seal";
import { fromHex, toHex } from "@mysten/sui/utils";

let sealClient: SealClient;
let sealPackageId: string;
let sealId: Uint8Array;

export function initSeal(
  client: SealClient,
  packageId: string,
  registryId: string,
  ownerAddress: string,
): void {
  sealClient = client;
  sealPackageId = packageId;
  sealId = buildSealId(registryId, ownerAddress);
}

/** Concatenate registryId (32B) + ownerAddress (32B) to form the Seal ID. */
export function buildSealId(registryId: string, ownerAddress: string): Uint8Array {
  const registryBytes = fromHex(registryId.replace(/^0x/, ""));
  const ownerBytes = fromHex(ownerAddress.replace(/^0x/, ""));
  const id = new Uint8Array(64);
  id.set(registryBytes, 0);
  id.set(ownerBytes, 32);
  return id;
}

export async function encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
  const { encryptedObject } = await sealClient.encrypt({
    threshold: 2,
    packageId: sealPackageId,
    id: toHex(sealId),
    data: plaintext,
  });
  return encryptedObject;
}

export async function decrypt(_ciphertext: Uint8Array): Promise<Uint8Array> {
  // TODO: decrypt requires SessionKey — not part of write flow
  throw new Error("decrypt not yet implemented");
}
