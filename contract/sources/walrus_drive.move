module walrus_drive::drive {
    use sui::vec_set::{Self, VecSet};
    use sui::table::{Self, Table};
    use std::string::String;

    /// Single shared registry mapping owners to their allowlists.
    /// The UID bytes serve as the Seal encryption namespace prefix.
    /// `manifests` maps each owner to a Walrus blob ID containing their shared file listing.
    public struct Registry has key {
        id: UID,
        allowlists: Table<address, VecSet<address>>,
        manifests: Table<address, String>,
    }

    /// Create the registry on publish.
    fun init(ctx: &mut TxContext) {
        transfer::share_object(Registry {
            id: object::new(ctx),
            allowlists: table::new(ctx),
            manifests: table::new(ctx),
        });
    }

    /// Register the caller as a drive owner, auto-adding themselves to their allowlist.
    public fun register(registry: &mut Registry, ctx: &TxContext) {
        let owner = ctx.sender();
        assert!(!registry.allowlists.contains(owner));
        let mut addresses = vec_set::empty<address>();
        addresses.insert(owner);
        registry.allowlists.add(owner, addresses);
    }

    /// Grant an address access to the caller's files.
    public fun grant_access(registry: &mut Registry, addr: address, ctx: &TxContext) {
        let allowlist = &mut registry.allowlists[ctx.sender()];
        allowlist.insert(addr);
    }

    /// Revoke an address's access to the caller's files.
    public fun revoke_access(registry: &mut Registry, addr: address, ctx: &TxContext) {
        let allowlist = &mut registry.allowlists[ctx.sender()];
        allowlist.remove(&addr);
    }

    /// Publish or update the caller's manifest blob ID (points to a Walrus blob
    /// containing a list of shared file references).
    public fun publish_manifest(registry: &mut Registry, blob_id: String, ctx: &TxContext) {
        let owner = ctx.sender();
        if (registry.manifests.contains(owner)) {
            *&mut registry.manifests[owner] = blob_id;
        } else {
            registry.manifests.add(owner, blob_id);
        };
    }

    /// Unpublish the caller's manifest (stops sharing).
    public fun unpublish_manifest(registry: &mut Registry, ctx: &TxContext) {
        let owner = ctx.sender();
        if (registry.manifests.contains(owner)) {
            let _blob_id = registry.manifests.remove(owner);
        };
    }

    /// Seal callback: verifies namespace prefix, extracts owner, checks membership.
    public fun seal_approve(id: vector<u8>, registry: &Registry, ctx: &TxContext) {
        check_policy(ctx.sender(), id, registry);
    }

    fun check_policy(caller: address, id: vector<u8>, registry: &Registry) {
        let ns = object::id_to_bytes(&object::uid_to_inner(&registry.id));
        let prefix_len = ns.length();
        // ID must contain prefix (32 bytes) + owner address (32 bytes)
        assert!(id.length() >= prefix_len + 32);

        // Verify namespace prefix
        let mut i = 0;
        while (i < prefix_len) {
            assert!(id[i] == ns[i]);
            i = i + 1;
        };

        // Extract owner address from bytes after prefix
        let mut owner_bytes = vector::empty<u8>();
        let mut j = prefix_len;
        while (j < prefix_len + 32) {
            owner_bytes.push_back(id[j]);
            j = j + 1;
        };
        let owner = sui::address::from_bytes(owner_bytes);

        // Verify owner has an allowlist and caller is in it
        assert!(registry.allowlists.contains(owner));
        assert!(registry.allowlists[owner].contains(&caller));
    }
}
