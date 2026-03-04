/**
 * HTTP server implementing the FUSE RPC contract against an in-memory file tree.
 * Placeholder until Walrus/Seal/Sui integration replaces the storage layer.
 *
 * Every operation is logged to console: [op] /path
 */

// Bun's Server type is generic; we don't use WebSockets so `unknown` suffices.
type BunServer = ReturnType<typeof Bun.serve>;

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

// ── Operation handlers ──────────────────────────────────────

type HandlerFn = (body: Record<string, unknown>) => Response;

function handleGetattr(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const node = resolvePath(path);
  if (!node) return jsonError("ENOENT", 404);
  return jsonOk({ stat: makeStat(node) });
}

function handleReaddir(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const node = resolvePath(path);
  if (!node) return jsonError("ENOENT", 404);
  if (node.type !== "dir") return jsonError("ENOTDIR", 400);
  const entries = [".", "..", ...node.children.keys()];
  return jsonOk({ entries });
}

function handleOpen(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const node = resolvePath(path);
  if (!node) return jsonError("ENOENT", 404);
  if (node.type !== "file") return jsonError("EISDIR", 400);
  const fd = nextFd++;
  openFds.set(fd, { path, node });
  return jsonOk({ fd });
}

function handleRead(body: Record<string, unknown>): Response {
  const fd = body.fd as number;
  const length = body.length as number;
  const position = body.position as number;

  const entry = openFds.get(fd);
  if (!entry) return jsonError("EBADF", 400);

  const { node } = entry;
  if (position >= node.content.length) {
    return jsonOk({ data: "", bytesRead: 0 });
  }

  const end = Math.min(position + length, node.content.length);
  const slice = node.content.subarray(position, end);
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
  if (!entry) return jsonError("EBADF", 400);

  const { node } = entry;
  const incoming = Buffer.from(data, "base64");
  const bytesWritten = incoming.length;
  const needed = position + bytesWritten;

  // Grow the buffer if writing past current end
  if (needed > node.content.length) {
    const grown = Buffer.alloc(needed);
    node.content.copy(grown);
    node.content = grown;
  }

  incoming.copy(node.content, position);
  node.mtime = new Date();
  return jsonOk({ bytesWritten });
}

function handleCreate(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const mode = (body.mode as number) | 0o100000; // ensure regular file bit

  const result = resolveParent(path);
  if (!result) return jsonError("ENOENT", 404);
  const { parent, name } = result;

  if (parent.children.has(name)) return jsonError("EEXIST", 400);

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
  return jsonOk({ fd });
}

function handleUnlink(body: Record<string, unknown>): Response {
  const path = body.path as string;

  const result = resolveParent(path);
  if (!result) return jsonError("ENOENT", 404);
  const { parent, name } = result;

  const child = parent.children.get(name);
  if (!child) return jsonError("ENOENT", 404);
  if (child.type !== "file") return jsonError("EISDIR", 400);

  parent.children.delete(name);
  parent.mtime = new Date();
  return jsonOk({});
}

function handleRename(body: Record<string, unknown>): Response {
  const src = body.src as string;
  const dest = body.dest as string;

  const srcResult = resolveParent(src);
  if (!srcResult) return jsonError("ENOENT", 404);

  const srcNode = srcResult.parent.children.get(srcResult.name);
  if (!srcNode) return jsonError("ENOENT", 404);

  const destResult = resolveParent(dest);
  if (!destResult) return jsonError("ENOENT", 404);

  srcResult.parent.children.delete(srcResult.name);
  srcResult.parent.mtime = new Date();

  destResult.parent.children.set(destResult.name, srcNode);
  destResult.parent.mtime = new Date();

  return jsonOk({});
}

function handleMkdir(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const mode = (body.mode as number) | 0o40000; // ensure directory bit

  const result = resolveParent(path);
  if (!result) return jsonError("ENOENT", 404);
  const { parent, name } = result;

  if (parent.children.has(name)) return jsonError("EEXIST", 400);

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

  return jsonOk({});
}

function handleRmdir(body: Record<string, unknown>): Response {
  const path = body.path as string;

  const result = resolveParent(path);
  if (!result) return jsonError("ENOENT", 404);
  const { parent, name } = result;

  const child = parent.children.get(name);
  if (!child) return jsonError("ENOENT", 404);
  if (child.type !== "dir") return jsonError("ENOTDIR", 400);
  if (child.children.size > 0) return jsonError("ENOTEMPTY", 400);

  parent.children.delete(name);
  parent.mtime = new Date();
  return jsonOk({});
}

function handleTruncate(body: Record<string, unknown>): Response {
  const path = body.path as string;
  const size = body.size as number;

  const node = resolvePath(path);
  if (!node) return jsonError("ENOENT", 404);
  if (node.type !== "file") return jsonError("EISDIR", 400);

  if (size < node.content.length) {
    node.content = Buffer.from(node.content.subarray(0, size));
  } else if (size > node.content.length) {
    const grown = Buffer.alloc(size);
    node.content.copy(grown);
    node.content = grown;
  }

  node.mtime = new Date();
  return jsonOk({});
}

function handleRelease(body: Record<string, unknown>): Response {
  const fd = body.fd as number;
  openFds.delete(fd);
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
        return jsonError("Method not allowed", 405);
      }

      const match = url.pathname.match(/^\/fuse\/(\w+)$/);
      if (!match) {
        return jsonError("Not found", 404);
      }

      const op = match[1];
      const handler = handlers[op];
      if (!handler) {
        return jsonError("ENOSYS", 400);
      }

      const body = (await req.json()) as Record<string, unknown>;

      // Log the operation
      if (op === "rename") {
        console.log(`[${op}] ${body.src} → ${body.dest}`);
      } else {
        console.log(`[${op}] ${body.path ?? ""}`);
      }

      return handler(body);
    },
  });

  return {
    server,
    stop: () => server.stop(),
  };
}
