/**
 * FUSE filesystem thin client — delegates every VFS operation to a local HTTP
 * server via JSON RPC. This decouples the kernel-facing FUSE layer from
 * storage/encryption logic, making both independently testable.
 */

import Fuse from "fuse-native";
import { execSync } from "child_process";
import { resolve } from "path";

// ── Constants ───────────────────────────────────────────────

const DEFAULT_BASE_URL = "http://localhost:3001";
const FETCH_TIMEOUT_MS = 30_000;

// ── Error mapping ───────────────────────────────────────────

const ERROR_MAP: Record<string, number> = {
  EPERM: Fuse.EPERM,
  ENOENT: Fuse.ENOENT,
  EIO: Fuse.EIO,
  EACCES: Fuse.EACCES,
  EBUSY: Fuse.EBUSY,
  EEXIST: Fuse.EEXIST,
  ENOTDIR: Fuse.ENOTDIR,
  EISDIR: Fuse.EISDIR,
  EINVAL: Fuse.EINVAL,
  ENOSPC: Fuse.ENOSPC,
  EROFS: Fuse.EROFS,
  ENOSYS: Fuse.ENOSYS,
  ENOTEMPTY: Fuse.ENOTEMPTY,
};

class FuseHttpError extends Error {
  code: number;
  constructor(errorName: string) {
    super(`FUSE error: ${errorName}`);
    this.code = ERROR_MAP[errorName] ?? Fuse.EIO;
  }
}

// ── HTTP helper ─────────────────────────────────────────────

async function fetchOp(
  baseUrl: string,
  op: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/fuse/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const errorName =
      typeof json.error === "string" ? json.error : "EIO";
    throw new FuseHttpError(errorName);
  }

  return json;
}

// ── Stat parsing ────────────────────────────────────────────

function parseStat(raw: Record<string, unknown>): Fuse.FuseStats {
  return {
    mode: raw.mode as number,
    uid: raw.uid as number,
    gid: raw.gid as number,
    size: raw.size as number,
    dev: (raw.dev as number) ?? 0,
    nlink: (raw.nlink as number) ?? 1,
    ino: (raw.ino as number) ?? 0,
    rdev: (raw.rdev as number) ?? 0,
    blksize: (raw.blksize as number) ?? 4096,
    blocks: (raw.blocks as number) ?? 0,
    atime: new Date(raw.atime as string),
    mtime: new Date(raw.mtime as string),
    ctime: new Date(raw.ctime as string),
  };
}

// ── FUSE operations ─────────────────────────────────────────

function createOps(baseUrl: string): Fuse.FuseOperations {
  return {
    getattr(path, cb) {
      fetchOp(baseUrl, "getattr", { path })
        .then((json) => {
          const stat = parseStat(json.stat as Record<string, unknown>);
          cb(0, stat);
        })
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    readdir(path, cb) {
      fetchOp(baseUrl, "readdir", { path })
        .then((json) => cb(0, json.entries as string[]))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    open(path, flags, cb) {
      fetchOp(baseUrl, "open", { path, flags })
        .then((json) => cb(0, json.fd as number))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    // read callback: cb(bytesRead) — 0 = EOF, negative = error
    read(path, fd, buffer, length, position, cb) {
      fetchOp(baseUrl, "read", { path, fd, length, position })
        .then((json) => {
          const b64 = json.data as string;
          const bytesRead = json.bytesRead as number;
          if (bytesRead === 0) return cb(0);
          const decoded = Buffer.from(b64, "base64");
          decoded.copy(buffer, 0, 0, bytesRead);
          cb(bytesRead);
        })
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    // write callback: cb(bytesWritten) — negative = error
    write(path, fd, buffer, length, position, cb) {
      const data = buffer.subarray(0, length).toString("base64");
      fetchOp(baseUrl, "write", { path, fd, data, length, position })
        .then((json) => cb(json.bytesWritten as number))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    create(path, mode, cb) {
      fetchOp(baseUrl, "create", { path, mode })
        .then((json) => cb(0, json.fd as number))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    unlink(path, cb) {
      fetchOp(baseUrl, "unlink", { path })
        .then(() => cb(0))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    rename(src, dest, cb) {
      fetchOp(baseUrl, "rename", { src, dest })
        .then(() => cb(0))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    mkdir(path, mode, cb) {
      fetchOp(baseUrl, "mkdir", { path, mode })
        .then(() => cb(0))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    rmdir(path, cb) {
      fetchOp(baseUrl, "rmdir", { path })
        .then(() => cb(0))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    truncate(path, size, cb) {
      fetchOp(baseUrl, "truncate", { path, size })
        .then(() => cb(0))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },

    release(path, fd, cb) {
      fetchOp(baseUrl, "release", { path, fd })
        .then(() => cb(0))
        .catch((e: FuseHttpError) => cb(e.code ?? Fuse.EIO));
    },
  };
}

// ── Mount entrypoint ────────────────────────────────────────

export function mountDrive(
  mountPoint: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  const mnt = resolve(mountPoint);
  const ops = createOps(baseUrl);

  const fuse = new Fuse(mnt, ops, {
    debug: false,
    force: true,
    mkdir: true,
  });

  return new Promise<void>((resolveP, reject) => {
    fuse.mount((err) => {
      if (err) {
        reject(new Error(`Mount failed: ${err.message}`));
        return;
      }

      console.log(`walrus-drive mounted at ${mnt}`);
      console.log(`  backend: ${baseUrl}`);
      console.log("  press Ctrl+C to unmount");

      const cleanup = () => {
        console.log("\nunmounting…");
        fuse.unmount((unmountErr) => {
          if (unmountErr) {
            console.error(
              "unmount failed, forcing:",
              unmountErr.message,
            );
            try {
              execSync(`diskutil unmount force "${mnt}"`);
            } catch {
              // best-effort
            }
          }
          process.exit(0);
        });
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      resolveP();
    });
  });
}
