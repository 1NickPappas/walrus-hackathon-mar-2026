/** Sui client — read/write on-chain file metadata. */

export async function createFileEntry(_name: string, _blobId: string, _size: number) {
  // TODO: create FileEntry object on Sui
}

export async function listFiles(): Promise<string[]> {
  // TODO: query owned FileEntry objects
  return [];
}
