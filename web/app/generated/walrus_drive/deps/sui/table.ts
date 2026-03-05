import { MoveStruct } from '../../../utils/index';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '0x2::table';
export const Table = new MoveStruct({ name: `${$moduleName}::Table<phantom K, phantom V>`, fields: {
        id: bcs.Address,
        size: bcs.u64()
    } });
