/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import { type Transaction } from '@mysten/sui/transactions';
import * as table from './deps/sui/table.js';
const $moduleName = '@local-pkg/walrus-drive::drive';
export const Registry = new MoveStruct({ name: `${$moduleName}::Registry`, fields: {
        id: bcs.Address,
        allowlists: table.Table,
        manifests: table.Table
    } });
export interface RegisterArguments {
    registry: RawTransactionArgument<string>;
}
export interface RegisterOptions {
    package?: string;
    arguments: RegisterArguments | [
        registry: RawTransactionArgument<string>
    ];
}
/** Register the caller as a drive owner, auto-adding themselves to their allowlist. */
export function register(options: RegisterOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["registry"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'drive',
        function: 'register',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface GrantAccessArguments {
    registry: RawTransactionArgument<string>;
    addr: RawTransactionArgument<string>;
}
export interface GrantAccessOptions {
    package?: string;
    arguments: GrantAccessArguments | [
        registry: RawTransactionArgument<string>,
        addr: RawTransactionArgument<string>
    ];
}
/** Grant an address access to the caller's files. */
export function grantAccess(options: GrantAccessOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null,
        'address'
    ] satisfies (string | null)[];
    const parameterNames = ["registry", "addr"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'drive',
        function: 'grant_access',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface RevokeAccessArguments {
    registry: RawTransactionArgument<string>;
    addr: RawTransactionArgument<string>;
}
export interface RevokeAccessOptions {
    package?: string;
    arguments: RevokeAccessArguments | [
        registry: RawTransactionArgument<string>,
        addr: RawTransactionArgument<string>
    ];
}
/** Revoke an address's access to the caller's files. */
export function revokeAccess(options: RevokeAccessOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null,
        'address'
    ] satisfies (string | null)[];
    const parameterNames = ["registry", "addr"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'drive',
        function: 'revoke_access',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface PublishManifestArguments {
    registry: RawTransactionArgument<string>;
    blobId: RawTransactionArgument<string>;
}
export interface PublishManifestOptions {
    package?: string;
    arguments: PublishManifestArguments | [
        registry: RawTransactionArgument<string>,
        blobId: RawTransactionArgument<string>
    ];
}
/**
 * Publish or update the caller's manifest blob ID (points to a Walrus blob
 * containing a list of shared file references).
 */
export function publishManifest(options: PublishManifestOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null,
        '0x1::string::String'
    ] satisfies (string | null)[];
    const parameterNames = ["registry", "blobId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'drive',
        function: 'publish_manifest',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface UnpublishManifestArguments {
    registry: RawTransactionArgument<string>;
}
export interface UnpublishManifestOptions {
    package?: string;
    arguments: UnpublishManifestArguments | [
        registry: RawTransactionArgument<string>
    ];
}
/** Unpublish the caller's manifest (stops sharing). */
export function unpublishManifest(options: UnpublishManifestOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["registry"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'drive',
        function: 'unpublish_manifest',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface SealApproveArguments {
    id: RawTransactionArgument<number[]>;
    registry: RawTransactionArgument<string>;
}
export interface SealApproveOptions {
    package?: string;
    arguments: SealApproveArguments | [
        id: RawTransactionArgument<number[]>,
        registry: RawTransactionArgument<string>
    ];
}
/** Seal callback: verifies namespace prefix, extracts owner, checks membership. */
export function sealApprove(options: SealApproveOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        'vector<u8>',
        null
    ] satisfies (string | null)[];
    const parameterNames = ["id", "registry"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'drive',
        function: 'seal_approve',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}