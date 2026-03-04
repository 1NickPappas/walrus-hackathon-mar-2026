import { startServer } from "./server.ts";
import { spawn } from "child_process";
import { resolve } from "path";

export async function main() {
  console.log("walrus-drive starting…");

  const mountPoint = process.argv[2] || "./mnt";
  const port = Number(process.argv[3]) || 3001;
  const baseUrl = `http://localhost:${port}`;

  // 1. Start HTTP server (runs in Bun)
  startServer(port);
  console.log(`server listening on ${baseUrl}`);

  // 2. Spawn FUSE client under Node via tsx (fuse-native needs libuv)
  const fuseMountScript = resolve(import.meta.dir, "fuse-mount.ts");
  const child = spawn("npx", ["tsx", fuseMountScript, mountPoint, baseUrl], {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    console.log(`fuse-mount exited with code ${code}`);
    process.exit(code ?? 1);
  });

  // Forward signals so the FUSE cleanup handler can unmount gracefully
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

main();
