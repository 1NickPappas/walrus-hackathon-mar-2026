module walrus_drive::walrus_drive {
    /// On-chain file metadata entry.
    public struct FileEntry has key, store {
        id: UID,
        name: vector<u8>,
        blob_id: vector<u8>,
        size: u64,
        owner: address,
    }
}
