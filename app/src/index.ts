import { startServer } from "./server.ts";
import { mountDrive } from "./fuse.ts";

export async function main() {
  console.log("walrus-drive starting…");

  const mountPoint = process.argv[2] || "./mnt";
  const port = Number(process.argv[3]) || 3001;

  const { stop } = startServer(port);
  console.log(`server listening on http://localhost:${port}`);

  await mountDrive(mountPoint, `http://localhost:${port}`);
}

main();
