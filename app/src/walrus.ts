/** Walrus blob upload/download. */

export async function uploadBlob(_data: Uint8Array): Promise<string> {
  // TODO: upload encrypted blob to Walrus, return blob ID
  return "";
}

export async function downloadBlob(_blobId: string): Promise<Uint8Array> {
  // TODO: download blob from Walrus by ID
  return new Uint8Array();
}
