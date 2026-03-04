/** Registry queries using SuiJsonRpcClient (JSON-RPC, browser-compatible). */

import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { downloadBlob } from "./walrus";

export interface ManifestEntry {
  name: string;
  blobId: string;
  size: number;
  createdAt: number;
}

/** Read the Registry object and return its Table object IDs. */
export async function getRegistryTables(
  client: SuiJsonRpcClient,
  registryId: string,
): Promise<{ allowlistsId: string; manifestsId: string }> {
  console.log("[sharing] getObject for registry:", registryId);
  const obj = await client.getObject({
    id: registryId,
    options: { showContent: true },
  });
  console.log("[sharing] registry object:", JSON.stringify(obj.data?.content));
  const fields = (obj.data?.content as any)?.fields;
  return {
    allowlistsId: fields.allowlists.fields.id.id,
    manifestsId: fields.manifests.fields.id.id,
  };
}

/**
 * Find all owners who have granted `myAddress` access to their files.
 * Iterates the allowlists Table and checks each VecSet for membership.
 */
export async function findSharedWithMe(
  client: SuiJsonRpcClient,
  registryId: string,
  myAddress: string,
): Promise<string[]> {
  const { allowlistsId } = await getRegistryTables(client, registryId);
  const sharedBy: string[] = [];
  let cursor: string | null | undefined = undefined;

  let hasMore = true;
  while (hasMore) {
    console.log("[sharing] getDynamicFields cursor:", cursor);
    const page = await client.getDynamicFields({
      parentId: allowlistsId,
      ...(cursor ? { cursor } : {}),
    });
    console.log("[sharing] got", page.data.length, "fields, hasNextPage:", page.hasNextPage);

    for (const field of page.data) {
      console.log("[sharing] reading field:", field.name);
      const fieldObj = await client.getDynamicFieldObject({
        parentId: allowlistsId,
        name: field.name,
      });
      const content = (fieldObj.data?.content as any)?.fields;
      console.log("[sharing] field content:", JSON.stringify(content));
      const ownerAddress = content?.name as string;
      const contents: string[] = content?.value?.fields?.contents ?? [];

      if (contents.includes(myAddress)) {
        sharedBy.push(ownerAddress);
      }
    }

    hasMore = page.hasNextPage;
    cursor = page.nextCursor ?? null;
  }

  return sharedBy;
}

/**
 * Get the manifest blob ID for a specific owner from the Registry.
 * Returns null if the owner has not published a manifest.
 */
export async function getManifestBlobId(
  client: SuiJsonRpcClient,
  registryId: string,
  ownerAddress: string,
): Promise<string | null> {
  const { manifestsId } = await getRegistryTables(client, registryId);

  try {
    const entry = await client.getDynamicFieldObject({
      parentId: manifestsId,
      name: { type: "address", value: ownerAddress },
    });

    const content = (entry.data?.content as any)?.fields;
    return content?.value ?? null;
  } catch {
    return null;
  }
}

/** Download a manifest blob from Walrus and parse the JSON file listing. */
export async function fetchManifest(
  manifestBlobId: string,
): Promise<ManifestEntry[]> {
  const bytes = await downloadBlob(manifestBlobId);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as ManifestEntry[];
}
