/**
 * HTTP server implementing the FUSE RPC contract against an in-memory file tree.
 * On file release: encrypt (Seal) → upload (Walrus) → track (SQLite).
 *
 * Every operation is logged to console: [op] /path
 */

import type { Keypair } from "@mysten/sui/cryptography";
import { encrypt } from "./seal.ts";
import { uploadBlob } from "./walrus.ts";
import { insertBlob } from "./db.ts";

// Bun's Server type is generic; we don't use WebSockets so `unknown` suffices.
type BunServer = ReturnType<typeof Bun.serve>;

// ── Pipeline state (set via initServerPipeline) ─────────────

let signer: Keypair | null = null;

export function initServerPipeline(keypair: Keypair): void {
  signer = keypair;
  console.log("[server] pipeline ready (encrypt → upload → SQLite)");
}

// ── In-memory filesystem types ──────────────────────────────

interface FileNode {
  type: "file";
  mode: number;
  content: Buffer;
  ctime: Date;
  mtime: Date;
  atime: Date;
}

interface DirNode {
  type: "dir";
  mode: number;
  children: Map<string, FsNode>;
  ctime: Date;
  mtime: Date;
  atime: Date;
}

type FsNode = FileNode | DirNode;

// ── File descriptor tracking ────────────────────────────────

let nextFd = 10;
const openFds = new Map<number, { path: string; node: FileNode }>();

// ── Root directory ──────────────────────────────────────────

const root: DirNode = {
  type: "dir",
  mode: 0o40755,
  children: new Map(),
  ctime: new Date(),
  mtime: new Date(),
  atime: new Date(),
};

// ── Utility functions ───────────────────────────────────────

function resolvePath(path: string): FsNode | null {
  if (path === "/") return root;

  const parts = path.split("/").filter(Boolean);
  let current: FsNode = root;

  for (const part of parts) {
    if (current.type !== "dir") return null;
    const child = current.children.get(part);
    if (!child) return null;
    current = child;
  }

  return current;
}

function resolveParent(path: string): { parent: DirNode; name: string } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const name = parts.pop()!;
  let current: FsNode = root;

  for (const part of parts) {
    if (current.type !== "dir") return null;
    const child = current.children.get(part);
    if (!child) return null;
    current = child;
  }

  if (current.type !== "dir") return null;
  return { parent: current, name };
}

function makeStat(node: FsNode) {
  const size = node.type === "file" ? node.content.length : 0;
  return {
    mode: node.mode,
    uid: process.getuid?.() ?? 501,
    gid: process.getgid?.() ?? 20,
    size,
    dev: 0,
    nlink: 1,
    ino: 0,
    rdev: 0,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atime: node.atime.toISOString(),
    mtime: node.mtime.toISOString(),
    ctime: node.ctime.toISOString(),
  };
}

function jsonOk(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Logging ────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function log(op: string, detail: string, extra = ""): void {
  const suffix = extra ? `  ${extra}` : "";
  console.log(`${timestamp()} [${op}] ${detail}${suffix}`);
}

function logError(op: string, detail: string, error: string): void {
  console.log(`${timestamp()} [${op}] ${detail}  ✗ ${error}`);
}

// ── Operation handlers ──────────────────────────────────────

type HandlerFn = (body: Record<string, unknown>) => Response | Promise<Response>;

function handleGetattr(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const node = resolvePath(path);
  if (!node) {
    logError("getattr", path, "ENOENT");
    return jsonError("ENOENT", 404);
  }
  const stat = makeStat(node);
  log("getattr", path, `${node.type} mode=${stat.mode.toString(8)} size=${stat.size}`);
  return jsonOk({ stat });
}

function handleReaddir(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const node = resolvePath(path);
  if (!node) {
    logError("readdir", path, "ENOENT");
    return jsonError("ENOENT", 404);
  }
  if (node.type !== "dir") {
    logError("readdir", path, "ENOTDIR");
    return jsonError("ENOTDIR", 400);
  }
  const childNames = [...node.children.keys()];
  const entries = [".", "..", ...childNames];
  log("readdir", path, `${childNames.length} entries: [${childNames.join(", ")}]`);
  return jsonOk({ entries });
}

function handleOpen(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const flags = body.flags as number;
  const node = resolvePath(path);
  if (!node) {
    logError("open", path, "ENOENT");
    return jsonError("ENOENT", 404);
  }
  if (node.type !== "file") {
    logError("open", path, "EISDIR");
    return jsonError("EISDIR", 400);
  }
  const fd = nextFd++;
  openFds.set(fd, { path, node });
  log("open", path, `fd=${fd} flags=${flags} size=${node.content.length}`);
  return jsonOk({ fd });
}

function handleRead(body: Record<string, unknown>): Response {
  const fd = body.fd as number;
  const length = body.length as number;
  const position = body.position as number;

  const entry = openFds.get(fd);
  if (!entry) {
    logError("read", `fd=${fd}`, "EBADF");
    return jsonError("EBADF", 400);
  }

  const { node, path } = entry;
  if (position >= node.content.length) {
    log("read", path, `fd=${fd} pos=${position} EOF (size=${node.content.length})`);
    return jsonOk({ data: "", bytesRead: 0 });
  }

  const end = Math.min(position + length, node.content.length);
  const slice = node.content.subarray(position, end);
  log("read", path, `fd=${fd} pos=${position} len=${length} → ${slice.length}B`);
  return jsonOk({
    data: Buffer.from(slice).toString("base64"),
    bytesRead: slice.length,
  });
}

function handleWrite(body: Record<string, unknown>): Response {
  const fd = body.fd as number;
  const data = body.data as string;
  const position = body.position as number;

  const entry = openFds.get(fd);
  if (!entry) {
    logError("write", `fd=${fd}`, "EBADF");
    return jsonError("EBADF", 400);
  }

  const { node, path } = entry;
  const incoming = Buffer.from(data, "base64");
  const bytesWritten = incoming.length;
  const needed = position + bytesWritten;
  const oldSize = node.content.length;

  // Grow the buffer if writing past current end
  if (needed > node.content.length) {
    const grown = Buffer.alloc(needed);
    node.content.copy(grown);
    node.content = grown;
  }

  incoming.copy(node.content, position);
  node.mtime = new Date();
  log("write", path, `fd=${fd} pos=${position} ${bytesWritten}B written (${oldSize}→${node.content.length}B)`);
  return jsonOk({ bytesWritten });
}

function handleCreate(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const mode = (body.mode as number) | 0o100000; // ensure regular file bit

  const result = resolveParent(path);
  if (!result) {
    logError("create", path, "ENOENT (parent)");
    return jsonError("ENOENT", 404);
  }
  const { parent, name } = result;

  if (parent.children.has(name)) {
    logError("create", path, "EEXIST");
    return jsonError("EEXIST", 400);
  }

  const now = new Date();
  const node: FileNode = {
    type: "file",
    mode,
    content: Buffer.alloc(0),
    ctime: now,
    mtime: now,
    atime: now,
  };

  parent.children.set(name, node);
  parent.mtime = new Date();

  const fd = nextFd++;
  openFds.set(fd, { path, node });
  log("create", path, `fd=${fd} mode=${mode.toString(8)}`);
  return jsonOk({ fd });
}

function handleUnlink(body: Record<string, unknown>): Response {
  const path = body.path as string;

  const result = resolveParent(path);
  if (!result) {
    logError("unlink", path, "ENOENT (parent)");
    return jsonError("ENOENT", 404);
  }
  const { parent, name } = result;

  const child = parent.children.get(name);
  if (!child) {
    logError("unlink", path, "ENOENT");
    return jsonError("ENOENT", 404);
  }
  if (child.type !== "file") {
    logError("unlink", path, "EISDIR");
    return jsonError("EISDIR", 400);
  }

  const size = child.content.length;
  parent.children.delete(name);
  parent.mtime = new Date();
  log("unlink", path, `removed (was ${size}B)`);
  return jsonOk({});
}

function handleRename(body: Record<string, unknown>): Response {
  const src = body.src as string;
  const dest = body.dest as string;

  const srcResult = resolveParent(src);
  if (!srcResult) {
    logError("rename", `${src} → ${dest}`, "ENOENT (src parent)");
    return jsonError("ENOENT", 404);
  }

  const srcNode = srcResult.parent.children.get(srcResult.name);
  if (!srcNode) {
    logError("rename", `${src} → ${dest}`, "ENOENT (src)");
    return jsonError("ENOENT", 404);
  }

  const destResult = resolveParent(dest);
  if (!destResult) {
    logError("rename", `${src} → ${dest}`, "ENOENT (dest parent)");
    return jsonError("ENOENT", 404);
  }

  srcResult.parent.children.delete(srcResult.name);
  srcResult.parent.mtime = new Date();

  destResult.parent.children.set(destResult.name, srcNode);
  destResult.parent.mtime = new Date();

  log("rename", `${src} → ${dest}`, srcNode.type);
  return jsonOk({});
}

function handleMkdir(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const mode = (body.mode as number) | 0o40000; // ensure directory bit

  const result = resolveParent(path);
  if (!result) {
    logError("mkdir", path, "ENOENT (parent)");
    return jsonError("ENOENT", 404);
  }
  const { parent, name } = result;

  if (parent.children.has(name)) {
    logError("mkdir", path, "EEXIST");
    return jsonError("EEXIST", 400);
  }

  const now = new Date();
  parent.children.set(name, {
    type: "dir",
    mode,
    children: new Map(),
    ctime: now,
    mtime: now,
    atime: now,
  });
  parent.mtime = new Date();

  log("mkdir", path, `mode=${mode.toString(8)}`);
  return jsonOk({});
}

function handleRmdir(body: Record<string, unknown>): Response {
  const path = body.path as string;

  const result = resolveParent(path);
  if (!result) {
    logError("rmdir", path, "ENOENT (parent)");
    return jsonError("ENOENT", 404);
  }
  const { parent, name } = result;

  const child = parent.children.get(name);
  if (!child) {
    logError("rmdir", path, "ENOENT");
    return jsonError("ENOENT", 404);
  }
  if (child.type !== "dir") {
    logError("rmdir", path, "ENOTDIR");
    return jsonError("ENOTDIR", 400);
  }
  if (child.children.size > 0) {
    logError("rmdir", path, `ENOTEMPTY (${child.children.size} children)`);
    return jsonError("ENOTEMPTY", 400);
  }

  parent.children.delete(name);
  parent.mtime = new Date();
  log("rmdir", path, "removed");
  return jsonOk({});
}

function handleTruncate(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const size = body.size as number;

  const node = resolvePath(path);
  if (!node) {
    logError("truncate", path, "ENOENT");
    return jsonError("ENOENT", 404);
  }
  if (node.type !== "file") {
    logError("truncate", path, "EISDIR");
    return jsonError("EISDIR", 400);
  }

  const oldSize = node.content.length;
  if (size < node.content.length) {
    node.content = Buffer.from(node.content.subarray(0, size));
  } else if (size > node.content.length) {
    const grown = Buffer.alloc(size);
    node.content.copy(grown);
    node.content = grown;
  }

  node.mtime = new Date();
  log("truncate", path, `${oldSize}→${size}B`);
  return jsonOk({});
}

async function handleRelease(body: Record<string, unknown>): Promise<Response> {
  const fd = body.fd as number;
  const entry = openFds.get(fd);
  const path = entry?.path ?? "?";
  openFds.delete(fd);

  // Encrypt → Upload → SQLite pipeline for files with content
  if (entry && entry.node.content.length > 0 && signer) {
    const fileName = path.split("/").pop() ?? path;
    try {
      const encrypted = await encrypt(entry.node.content);
      log("release", path, `encrypted ${entry.node.content.length}B → ${encrypted.length}B`);

      const blobId = await uploadBlob(encrypted, signer);
      log("release", path, `uploaded → blobId=${blobId}`);

      insertBlob(blobId, fileName);
      log("release", path, `blobId=${blobId} (encrypted, uploaded, tracked)`);
    } catch (err) {
      logError("release", path, `pipeline failed: ${err}`);
    }
  }

  log("release", path, `fd=${fd} (${openFds.size} fds open)`);
  return jsonOk({});
}

// ── Handler dispatch table ──────────────────────────────────

const handlers: Record<string, HandlerFn> = {
  getattr: handleGetattr,
  readdir: handleReaddir,
  open: handleOpen,
  read: handleRead,
  write: handleWrite,
  create: handleCreate,
  unlink: handleUnlink,
  rename: handleRename,
  mkdir: handleMkdir,
  rmdir: handleRmdir,
  truncate: handleTruncate,
  release: handleRelease,
};

// ── Server entrypoint ───────────────────────────────────────

export function startServer(port = 3001): { server: BunServer; stop: () => void } {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method !== "POST") {
        log("server", url.pathname, "405 Method Not Allowed");
        return jsonError("Method not allowed", 405);
      }

      const match = url.pathname.match(/^\/fuse\/(\w+)$/);
      if (!match) {
        log("server", url.pathname, "404 Not Found");
        return jsonError("Not found", 404);
      }

      const op = match[1];
      const handler = handlers[op];
      if (!handler) {
        logError("server", op, "ENOSYS (unknown op)");
        return jsonError("ENOSYS", 400);
      }

      const body = (await req.json()) as Record<string, unknown>;
      return handler(body);
    },
  });

  return {
    server,
    stop: () => server.stop(),
  };
}
