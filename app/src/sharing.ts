/**
 * Sharing flow — query the on-chain Registry, fetch manifests from Walrus,
 * download and decrypt shared files via Seal.
 */

import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { bcs } from "@mysten/sui/bcs";
import { downloadBlob } from "./walrus.ts";

// ── Types ───────────────────────────────────────────────────

export interface ManifestEntry {
  name: string;
  blobId: string;
  size: number;
}

// ── Registry queries ────────────────────────────────────────

/** Read the Registry object and return its Table object IDs. */
export async function getRegistryTables(
  client: SuiGrpcClient,
  registryId: string,
): Promise<{ allowlistsId: string; manifestsId: string }> {
  const obj = await client.getObject({
    objectId: registryId,
    include: { json: true },
  });
  const fields = obj.object.json as any;
  return {
    allowlistsId: fields.allowlists.id,
    manifestsId: fields.manifests.id,
  };
}

/**
 * Find all owners who have granted `myAddress` access to their files.
 * Iterates the allowlists Table and checks each VecSet for membership.
 */
export async function findSharedWithMe(
  client: SuiGrpcClient,
  registryId: string,
  myAddress: string,
): Promise<string[]> {
  const { allowlistsId } = await getRegistryTables(client, registryId);
  const sharedBy: string[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const page = await client.listDynamicFields({
      parentId: allowlistsId,
      ...(cursor ? { cursor } : {}),
    });

    for (const field of page.dynamicFields) {
      // Read the field object to get name (owner address) and value (VecSet)
      const fieldObj = await client.getObject({
        objectId: field.fieldId,
        include: { json: true },
      });
      const json = fieldObj.object.json as any;
      const ownerAddress = json.name as string;
      const contents: string[] = json.value?.contents ?? [];

      if (contents.includes(myAddress)) {
        sharedBy.push(ownerAddress);
      }
    }

    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);

  return sharedBy;
}

/**
 * Get the manifest blob ID for a specific owner from the Registry.
 * Returns null if the owner has not published a manifest.
 */
export async function getManifestBlobId(
  client: SuiGrpcClient,
  registryId: string,
  ownerAddress: string,
): Promise<string | null> {
  const { manifestsId } = await getRegistryTables(client, registryId);

  try {
    const entry = await client.getDynamicField({
      parentId: manifestsId,
      name: { type: "address", bcs: bcs.Address.serialize(ownerAddress).toBytes() },
    });

    return bcs.string().parse(entry.dynamicField.value.bcs);
  } catch {
    return null;
  }
}

// ── Manifest ────────────────────────────────────────────────

/** Download a manifest blob from Walrus and parse the JSON file listing. */
export async function fetchManifest(
  manifestBlobId: string,
): Promise<ManifestEntry[]> {
  const bytes = await downloadBlob(manifestBlobId);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as ManifestEntry[];
}

