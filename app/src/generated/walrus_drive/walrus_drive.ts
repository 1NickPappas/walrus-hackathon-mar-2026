/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import { type Transaction } from '@mysten/sui/transactions';
import * as table from './deps/sui/table.js';
const $moduleName = '@local-pkg/walrus-drive::walrus_drive';
export const Registry = new MoveStruct({ name: `${$moduleName}::Registry`, fields: {
        id: bcs.Address,
        lists: table.Table
    } });
export interface CreateListArguments {
    registry: RawTransactionArgument<string>;
}
export interface CreateListOptions {
    package?: string;
    arguments: CreateListArguments | [
        registry: RawTransactionArgument<string>
    ];
}
/** Create an allowlist entry for the caller, auto-adding themselves. */
export function createList(options: CreateListOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["registry"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'walrus_drive',
        function: 'create_list',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface AddArguments {
    registry: RawTransactionArgument<string>;
    addr: RawTransactionArgument<string>;
}
export interface AddOptions {
    package?: string;
    arguments: AddArguments | [
        registry: RawTransactionArgument<string>,
        addr: RawTransactionArgument<string>
    ];
}
/** Owner adds an address to their allowlist. */
export function add(options: AddOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null,
        'address'
    ] satisfies (string | null)[];
    const parameterNames = ["registry", "addr"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'walrus_drive',
        function: 'add',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface RemoveArguments {
    registry: RawTransactionArgument<string>;
    addr: RawTransactionArgument<string>;
}
export interface RemoveOptions {
    package?: string;
    arguments: RemoveArguments | [
        registry: RawTransactionArgument<string>,
        addr: RawTransactionArgument<string>
    ];
}
/** Owner removes an address from their allowlist. */
export function remove(options: RemoveOptions) {
    const packageAddress = options.package ?? '@local-pkg/walrus-drive';
    const argumentsTypes = [
        null,
        'address'
    ] satisfies (string | null)[];
    const parameterNames = ["registry", "addr"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'walrus_drive',
        function: 'remove',
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
        module: 'walrus_drive',
        function: 'seal_approve',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}