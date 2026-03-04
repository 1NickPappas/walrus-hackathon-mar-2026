/** Download a blob from Walrus via the aggregator (proxied through Next.js). */
export async function downloadBlob(blobId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/walrus/v1/blobs/${blobId}`);
  if (!response.ok) {
    throw new Error(`Failed to download blob ${blobId}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
