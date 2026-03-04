module walrus_drive::walrus_drive {
    use sui::vec_set::{Self, VecSet};
    use sui::table::{Self, Table};

    /// Single shared registry mapping owners to their allowlists.
    /// The UID bytes serve as the Seal encryption namespace prefix.
    public struct Registry has key {
        id: UID,
        lists: Table<address, VecSet<address>>,
    }

    /// Create the registry on publish.
    fun init(ctx: &mut TxContext) {
        transfer::share_object(Registry {
            id: object::new(ctx),
            lists: table::new(ctx),
        });
    }

    /// Create an allowlist entry for the caller, auto-adding themselves.
    public fun create_list(registry: &mut Registry, ctx: &TxContext) {
        let owner = ctx.sender();
        assert!(!registry.lists.contains(owner));
        let mut addresses = vec_set::empty<address>();
        addresses.insert(owner);
        registry.lists.add(owner, addresses);
    }

    /// Owner adds an address to their allowlist.
    public fun add(registry: &mut Registry, addr: address, ctx: &TxContext) {
        let list = &mut registry.lists[ctx.sender()];
        list.insert(addr);
    }

    /// Owner removes an address from their allowlist.
    public fun remove(registry: &mut Registry, addr: address, ctx: &TxContext) {
        let list = &mut registry.lists[ctx.sender()];
        list.remove(&addr);
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

        // Verify owner has a list and caller is in it
        assert!(registry.lists.contains(owner));
        assert!(registry.lists[owner].contains(&caller));
    }
}
