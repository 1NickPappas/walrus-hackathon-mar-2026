/** Seal decrypt for browser — uses wallet signing flow. */

import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SealClient, SessionKey } from "@mysten/seal";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import { sealApprove } from "../generated/walrus_drive/drive";
import { PACKAGE_ID, REGISTRY_ID, SEAL_KEY_SERVERS } from "./constants";

/** Build the 64-byte Seal ID from registryId + ownerAddress. */
export function buildSealId(registryId: string, ownerAddress: string): Uint8Array {
  const registryBytes = fromHex(registryId.replace(/^0x/, ""));
  const ownerBytes = fromHex(ownerAddress.replace(/^0x/, ""));
  const sealId = new Uint8Array(64);
  sealId.set(registryBytes, 0);
  sealId.set(ownerBytes, 32);
  return sealId;
}

/** Create a SealClient for browser use. */
export function createSealClient(suiClient: SuiJsonRpcClient): SealClient {
  return new SealClient({
    suiClient,
    serverConfigs: SEAL_KEY_SERVERS,
    verifyKeyServers: false,
  });
}

/** Create a SessionKey (without signer — wallet signs separately). */
export async function createSessionKey(
  address: string,
  suiClient: SuiJsonRpcClient,
): Promise<SessionKey> {
  return SessionKey.create({
    address,
    packageId: PACKAGE_ID,
    ttlMin: 10,
    suiClient,
  });
}

/** Decrypt data using Seal with the browser wallet signing flow. */
export async function decrypt(opts: {
  sealClient: SealClient;
  sessionKey: SessionKey;
  ownerAddress: string;
  suiClient: SuiJsonRpcClient;
  data: Uint8Array;
}): Promise<Uint8Array> {
  const sealId = buildSealId(REGISTRY_ID, opts.ownerAddress);

  const tx = new Transaction();
  sealApprove({
    package: PACKAGE_ID,
    arguments: {
      id: Array.from(sealId),
      registry: REGISTRY_ID,
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
