import { MoveStruct, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index';
import { bcs } from '@mysten/sui/bcs';
import { type Transaction } from '@mysten/sui/transactions';
import * as table from './deps/sui/table';
const $moduleName = '@local-pkg/walrus-drive::drive';
export const Registry = new MoveStruct({ name: `${$moduleName}::Registry`, fields: {
        id: bcs.Address,
        allowlists: table.Table,
        manifests: table.Table
    } });
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
