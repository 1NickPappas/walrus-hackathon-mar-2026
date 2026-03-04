import { mountDrive } from "./fuse.ts";

export async function main() {
  console.log("walrus-drive starting…");
  const mountPoint = process.argv[2] || "./mnt";
  await mountDrive(mountPoint);
}

main();
