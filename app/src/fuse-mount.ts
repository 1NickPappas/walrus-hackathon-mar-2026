/**
 * Standalone FUSE mount entry point — designed to run under Node via tsx.
 *
 * Usage: npx tsx src/fuse-mount.ts [mountPoint] [baseUrl]
 */

import { mountDrive } from "./fuse.ts";

const mountPoint = process.argv[2] || "./mnt";
const baseUrl = process.argv[3] || "http://localhost:3001";

console.log(`fuse-mount: mounting ${mountPoint} → ${baseUrl}`);
await mountDrive(mountPoint, baseUrl);
