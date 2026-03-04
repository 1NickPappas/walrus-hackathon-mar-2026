# Building a FUSE filesystem on macOS with TypeScript

**You can create virtual filesystems on macOS using TypeScript, Node.js, and macFUSE — but the ecosystem demands careful navigation.** The core approach pairs macFUSE (the macOS kernel-level FUSE implementation) with a Node.js native binding like `fuse-native`, then wraps everything in TypeScript types you'll largely write yourself. This guide walks through every step: installing macFUSE, choosing the right npm package, writing a complete hello-world filesystem, defining TypeScript interfaces, and avoiding the pitfalls that trip up nearly every beginner.

FUSE (Filesystem in Userspace) lets you implement filesystem operations — `readdir`, `getattr`, `read`, `write` — as ordinary functions in your application code rather than kernel modules. macFUSE bridges this concept to macOS, and Node.js bindings expose the C-level FUSE API as JavaScript callbacks. The result: you can `cat` a virtual file whose content is generated on-the-fly by your TypeScript code.

---

## What you need installed before writing any code

Three layers of dependencies must be in place: macFUSE itself, native build tools, and the Node.js binding package.

**macFUSE** is the foundational layer. The latest release is **macFUSE 5.1.3** (December 2025), supporting macOS 12 through macOS 26 on both Apple Silicon and Intel. Install it via Homebrew or direct download:

```bash
# Option A: Homebrew (recommended)
brew install --cask macfuse

# Option B: Direct download
# https://github.com/macfuse/macfuse/releases/download/macfuse-5.1.3/macfuse-5.1.3.dmg
```

After installation, macOS blocks the kernel extension by default. Navigate to **System Settings → Privacy & Security** and click **Allow** next to the macFUSE extension prompt, then restart. **On Apple Silicon Macs**, you must first boot into Recovery Mode (shut down → hold power button), open Startup Security Utility, select your disk, choose **Reduced Security**, and enable "Allow user management of kernel extensions from identified developers." This is a one-time step but is non-negotiable — without it, macFUSE cannot load.

Verify the installation works:

```bash
pkg-config --cflags fuse
# Expected: -I/usr/local/include/fuse -D_FILE_OFFSET_BITS=64
```

You also need **Xcode Command Line Tools** and **pkg-config** for native module compilation:

```bash
xcode-select --install
brew install pkg-config
```

**For the npm binding**, three packages exist in this space. Here's how they compare:

| Package              | Last updated | macOS support              | TypeScript types | Status                            |
| -------------------- | ------------ | -------------------------- | ---------------- | --------------------------------- |
| `fuse-native`        | ~2021        | ✅ Ships embedded libfuse  | None built-in    | Unmaintained but stable via N-API |
| `@gcas/fuse`         | ~2025        | ✅ Fork of fuse-native     | None built-in    | Most recently updated fork        |
| `node-fuse-bindings` | ~2020        | ✅ Requires system macFUSE | None built-in    | Unmaintained but functional       |

**Use `fuse-native`** for the broadest community knowledge and examples, or **`@gcas/fuse`** if you want the most recently maintained fork. Both use the same class-based API: `new Fuse(mountPoint, handlers, options)`. This guide uses `fuse-native` since most documentation and examples target it.

---

## Setting up the TypeScript project from scratch

Initialize your project and install all dependencies:

```bash
mkdir hello-fuse && cd hello-fuse
npm init -y
npm install fuse-native
npm install -D typescript @types/node ts-node
npx tsc --init
```

Since `fuse-native` ships no TypeScript declarations, create a type definition file. This is the most important setup step for TypeScript developers — without it, every FUSE call will be `any`-typed. Place this file at `src/types/fuse-native.d.ts`:

```typescript
declare module "fuse-native" {
  interface FuseStats {
    mode: number;
    uid: number;
    gid: number;
    size: number;
    dev: number;
    nlink: number;
    ino: number;
    rdev: number;
    blksize: number;
    blocks: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
  }

  interface FuseStatFS {
    bsize: number;
    frsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
    files: number;
    ffree: number;
    favail: number;
    fsid: number;
    flag: number;
    namemax: number;
  }

  interface FuseOperations {
    init?(cb: (err: number) => void): void;
    access?(path: string, mode: number, cb: (err: number) => void): void;
    statfs?(path: string, cb: (err: number, stats?: FuseStatFS) => void): void;
    getattr?(path: string, cb: (err: number, stat?: FuseStats) => void): void;
    fgetattr?(
      path: string,
      fd: number,
      cb: (err: number, stat?: FuseStats) => void,
    ): void;
    readdir?(path: string, cb: (err: number, names?: string[]) => void): void;
    open?(
      path: string,
      flags: number,
      cb: (err: number, fd?: number) => void,
    ): void;
    read?(
      path: string,
      fd: number,
      buffer: Buffer,
      length: number,
      position: number,
      cb: (bytesRead: number) => void,
    ): void;
    write?(
      path: string,
      fd: number,
      buffer: Buffer,
      length: number,
      position: number,
      cb: (bytesWritten: number) => void,
    ): void;
    release?(path: string, fd: number, cb: (err: number) => void): void;
    create?(
      path: string,
      mode: number,
      cb: (err: number, fd?: number) => void,
    ): void;
    unlink?(path: string, cb: (err: number) => void): void;
    rename?(src: string, dest: string, cb: (err: number) => void): void;
    mkdir?(path: string, mode: number, cb: (err: number) => void): void;
    rmdir?(path: string, cb: (err: number) => void): void;
    truncate?(path: string, size: number, cb: (err: number) => void): void;
    chmod?(path: string, mode: number, cb: (err: number) => void): void;
    chown?(
      path: string,
      uid: number,
      gid: number,
      cb: (err: number) => void,
    ): void;
    utimens?(
      path: string,
      atime: Date,
      mtime: Date,
      cb: (err: number) => void,
    ): void;
    link?(src: string, dest: string, cb: (err: number) => void): void;
    symlink?(src: string, dest: string, cb: (err: number) => void): void;
    readlink?(path: string, cb: (err: number, linkName?: string) => void): void;
    flush?(path: string, fd: number, cb: (err: number) => void): void;
    fsync?(
      path: string,
      dataSync: boolean,
      fd: number,
      cb: (err: number) => void,
    ): void;
    setxattr?(
      path: string,
      name: string,
      value: Buffer,
      size: number,
      flags: number,
      cb: (err: number) => void,
    ): void;
    getxattr?(
      path: string,
      name: string,
      size: number,
      cb: (err: number) => void,
    ): void;
    listxattr?(path: string, cb: (err: number, list?: string[]) => void): void;
    removexattr?(path: string, name: string, cb: (err: number) => void): void;
  }

  interface FuseOptions {
    debug?: boolean;
    force?: boolean;
    mkdir?: boolean;
    displayFolder?: string;
    allowOther?: boolean;
    autoUnmount?: boolean;
    fsname?: string;
    uid?: number;
    gid?: number;
  }

  class Fuse {
    constructor(mnt: string, ops: FuseOperations, opts?: FuseOptions);
    mount(cb: (err: Error | null) => void): void;
    unmount(cb: (err: Error | null) => void): void;
    static unmount(mnt: string, cb: (err: Error | null) => void): void;

    // POSIX error codes (negated)
    static EPERM: -1;
    static ENOENT: -2;
    static EIO: -5;
    static EACCES: -13;
    static EBUSY: -16;
    static EEXIST: -17;
    static ENOTDIR: -20;
    static EISDIR: -21;
    static EINVAL: -22;
    static ENOSPC: -28;
    static EROFS: -30;
    static ENOSYS: -38;
    static ENOTEMPTY: -39;
  }

  export = Fuse;
}
```

Two `tsconfig.json` settings are essential — without `esModuleInterop` the default import from `fuse-native` breaks:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "moduleResolution": "node",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

---

## A complete hello-world in-memory filesystem

This filesystem exposes a virtual directory containing two read-only files. Every FUSE operation is typed and annotated. Save this as `src/index.ts`:

```typescript
import Fuse from "fuse-native";
import * as path from "path";

// ── Virtual file system data ────────────────────────────────

interface VirtualFile {
  name: string;
  content: Buffer;
  ctime: Date;
  mtime: Date;
  atime: Date;
}

const files = new Map<string, VirtualFile>();

files.set("/hello.txt", {
  name: "hello.txt",
  content: Buffer.from("Hello, World!\n"),
  ctime: new Date(),
  mtime: new Date(),
  atime: new Date(),
});

files.set("/about.txt", {
  name: "about.txt",
  content: Buffer.from(
    "This virtual filesystem is powered by FUSE, Node.js, and TypeScript.\n",
  ),
  ctime: new Date(),
  mtime: new Date(),
  atime: new Date(),
});

// ── Mode constants ──────────────────────────────────────────

const DIR_MODE = 0o40755; // drwxr-xr-x  (decimal 16877)
const FILE_MODE = 0o100644; // -rw-r--r--  (decimal 33188)

// ── Stat helper ─────────────────────────────────────────────

function makeStat(opts: {
  mode: number;
  size: number;
  mtime?: Date;
  atime?: Date;
  ctime?: Date;
}) {
  const now = new Date();
  return {
    mode: opts.mode,
    uid: process.getuid ? process.getuid() : 0,
    gid: process.getgid ? process.getgid() : 0,
    size: opts.size,
    dev: 0,
    nlink: opts.mode === DIR_MODE ? 2 : 1,
    ino: 0,
    rdev: 0,
    blksize: 4096,
    blocks: Math.ceil(opts.size / 512),
    atime: opts.atime ?? now,
    mtime: opts.mtime ?? now,
    ctime: opts.ctime ?? now,
  };
}

// ── File descriptor tracking ────────────────────────────────

let nextFd = 10;
const openFds = new Map<number, string>();

// ── FUSE operation handlers ─────────────────────────────────

const ops: Fuse.prototype.ops extends infer T ? T : never = {
  // getattr: called on every stat(), ls, or file access.
  // Must return valid stat for known paths or ENOENT otherwise.
  getattr(path: string, cb) {
    if (path === "/") {
      return cb(0, makeStat({ mode: DIR_MODE, size: 4096 }));
    }

    const file = files.get(path);
    if (file) {
      return cb(
        0,
        makeStat({
          mode: FILE_MODE,
          size: file.content.length,
          mtime: file.mtime,
          atime: file.atime,
          ctime: file.ctime,
        }),
      );
    }

    return cb(Fuse.ENOENT);
  },

  // readdir: return an array of filenames (no leading slash).
  readdir(path: string, cb) {
    if (path === "/") {
      const names = Array.from(files.values()).map((f) => f.name);
      return cb(0, names);
    }
    return cb(Fuse.ENOENT);
  },

  // open: validate the file exists, return a file descriptor.
  open(path: string, flags: number, cb) {
    if (!files.has(path)) return cb(Fuse.ENOENT);
    const fd = nextFd++;
    openFds.set(fd, path);
    return cb(0, fd);
  },

  // read: copy file content into the provided buffer.
  // IMPORTANT — the callback signature is cb(bytesRead), NOT cb(err, bytesRead).
  read(
    path: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    cb,
  ) {
    const file = files.get(path);
    if (!file) return cb(0);

    if (position >= file.content.length) return cb(0); // EOF

    const slice = file.content.slice(position, position + length);
    slice.copy(buffer);
    return cb(slice.length);
  },

  // release: clean up the file descriptor.
  release(path: string, fd: number, cb) {
    openFds.delete(fd);
    return cb(0);
  },
};

// ── Mount ───────────────────────────────────────────────────

const mountPoint = path.resolve(process.argv[2] || "./mnt");

const fuse = new Fuse(mountPoint, ops, {
  debug: false,
  force: true,
  mkdir: true,
});

fuse.mount((err) => {
  if (err) {
    console.error("Mount failed:", err.message);
    process.exit(1);
  }
  console.log(`✅ Filesystem mounted at ${mountPoint}`);
  console.log(`   ls ${mountPoint}`);
  console.log(`   cat ${mountPoint}/hello.txt`);
  console.log(`   Press Ctrl+C to unmount.`);
});

// ── Graceful unmount on exit ────────────────────────────────

function cleanup() {
  console.log("\nUnmounting...");
  fuse.unmount((err) => {
    if (err) {
      console.error("Unmount failed, forcing:", err.message);
      try {
        require("child_process").execSync(
          `diskutil unmount force "${mountPoint}"`,
        );
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  });
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
```

Run it:

```bash
npx ts-node src/index.ts
# In another terminal:
ls ./mnt            # → hello.txt  about.txt
cat ./mnt/hello.txt # → Hello, World!
```

When a program runs `cat /mnt/hello.txt`, the kernel triggers FUSE operations in a specific sequence: `getattr("/")` → `getattr("/hello.txt")` → `open("/hello.txt")` → `read("/hello.txt", fd, buf, 4096, 0)` → `read(... pos=14)` returns 0 (EOF) → `release("/hello.txt", fd)`. Every handler in the chain must call its callback exactly once, or the entire filesystem hangs.

---

## How the `read` callback differs from every other operation

The single most confusing aspect of the `fuse-native` API is an inconsistency in callback signatures. **Most operations use `cb(errorCode, result?)` where 0 means success.** But `read` and `write` break this convention — their callbacks take a single argument representing **bytes transferred**: `cb(bytesRead)`. Returning `0` signals EOF, not an error.

```typescript
// Every other operation — first argument is an error code:
getattr(path, (err, stat) => { ... })    // err=0 means success
readdir(path, (err, names) => { ... })   // err=Fuse.ENOENT means not found

// read and write — first argument is bytes, NOT an error:
read(path, fd, buf, len, pos, (bytesRead) => { ... })  // 0 = EOF
write(path, fd, buf, len, pos, (bytesWritten) => { ... })
```

Getting this wrong produces silent failures: files appear empty, reads hang, or the kernel retries infinitely. If you need to signal an error from `read`, return a negative FUSE error code (e.g., `cb(Fuse.EIO)`).

---

## Five pitfalls that catch every beginner on macOS

**1. Forgetting to call the callback on every code path.** This is the number-one cause of filesystem hangs. If `getattr` lacks a `cb(Fuse.ENOENT)` fallthrough for unknown paths, accessing any non-existent file freezes your terminal — and the only recovery is `diskutil unmount force` or a reboot. Use a wrapper to guarantee callbacks fire:

```typescript
function safeHandler<T>(
  fn: () => Promise<T>,
  cb: (err: number, result?: T) => void,
) {
  fn()
    .then((result) => cb(0, result))
    .catch(() => cb(Fuse.EIO));
}
```

**2. The `size` field in `getattr` must exactly match your file content.** If `getattr` reports `size: 100` but the file content is 14 bytes, the kernel either won't call `read` at all or will pad the output with null bytes. Always compute size from the actual `Buffer.length`.

**3. macOS Finder generates constant background noise.** Expect unexpected `getattr` calls for `._*` files (Apple Double resource forks), `.DS_Store`, and extended attribute queries via `getxattr`. Return `Fuse.ENOENT` for paths you don't recognize and ignore `getxattr` by not implementing it or returning `ENOTSUP` — otherwise Finder operations slow your filesystem dramatically.

**4. Zombie mount points after crashes.** If your Node.js process crashes or is killed with `kill -9` without unmounting, the mount point becomes a dead reference. Any shell that touches it will hang. Recovery requires `diskutil unmount force ./mnt` from another terminal. Always register `SIGINT` and `SIGTERM` handlers that call `fuse.unmount()`, and use the `force: true` mount option so subsequent runs auto-unmount stale mounts.

**5. Apple Silicon requires a one-time Recovery Mode step.** On M-series Macs, macFUSE's kernel extension won't load until you boot into Recovery Mode and enable Reduced Security with third-party kernel extension management. This is a hard requirement with no workaround — except on **macOS 15.4+**, where macFUSE 5.x offers a new FSKit backend (`-o backend=fskit`) that runs entirely in userspace and skips the kernel extension entirely. The FSKit backend has limitations (mount points must be in `/Volumes`, some API gaps) but eliminates the Recovery Mode requirement.

---

## Extending to a read-write filesystem

The read-only example above covers the minimum viable FUSE filesystem. Adding write support requires four additional operations. Here's the pattern for `create`, `write`, `unlink`, and `truncate`:

```typescript
// Add to your operations object:
create(filePath: string, mode: number, cb: (err: number, fd?: number) => void) {
  const name = filePath.split("/").pop()!;
  files.set(filePath, {
    name,
    content: Buffer.alloc(0),
    ctime: new Date(),
    mtime: new Date(),
    atime: new Date(),
  });
  const fd = nextFd++;
  openFds.set(fd, filePath);
  return cb(0, fd);
},

write(filePath: string, fd: number, buffer: Buffer, length: number, position: number, cb: (bytesWritten: number) => void) {
  const file = files.get(filePath);
  if (!file) return cb(0);

  const newData = Buffer.from(buffer.slice(0, length));
  const before = file.content.slice(0, position);
  const after = file.content.slice(position + length);
  file.content = Buffer.concat([before, newData, after]);
  file.mtime = new Date();
  return cb(length);
},

unlink(filePath: string, cb: (err: number) => void) {
  if (!files.has(filePath)) return cb(Fuse.ENOENT);
  files.delete(filePath);
  return cb(0);
},

truncate(filePath: string, size: number, cb: (err: number) => void) {
  const file = files.get(filePath);
  if (!file) return cb(Fuse.ENOENT);
  if (size === 0) {
    file.content = Buffer.alloc(0);
  } else {
    file.content = file.content.slice(0, size);
  }
  file.mtime = new Date();
  return cb(0);
},
```

The `write` callback follows the same convention as `read` — the argument is **bytes written**, not an error code. Also note that `getattr` must now return accurate, updated sizes after writes, since the kernel uses the stat `size` to determine read boundaries.

---

## Debugging when things go wrong

Enable verbose logging by setting `debug: true` in your Fuse options. This prints every FUSE request and response to stdout. For production debugging, add structured logging to each handler:

```typescript
getattr(path: string, cb) {
  console.log(`[getattr] ${path}`);
  // ... handler logic
}
```

When a mount goes unresponsive, use these commands in another terminal:

```bash
# See what's holding the mount open
lsof +D ./mnt

# Graceful unmount (macOS-native)
diskutil unmount ./mnt

# Force unmount when graceful fails
diskutil unmount force ./mnt

# Nuclear option
sudo umount -f ./mnt
```

Check macFUSE kernel logs with `log show --predicate 'process == "mount_macfuse"' --last 1h` to diagnose mount failures. Common error patterns include "mount point is not empty" (use `force: true`), "operation not permitted" (kernel extension not approved), and "Resource busy" (Finder or Spotlight holding a file handle).

---

## Conclusion

Building a FUSE filesystem on macOS with TypeScript is entirely practical but requires navigating a fragmented ecosystem. The critical path is: install macFUSE 5.x, approve the kernel extension (or use FSKit on macOS 15.4+), install `fuse-native` via npm, and supply your own TypeScript type definitions since none of the binding packages ship them. The `read`/`write` callback signature inconsistency is the most dangerous API quirk — every other operation uses `cb(err, result)` while these two use `cb(bytesTransferred)`. Always guarantee every callback fires exactly once, keep `getattr` responses fast, and register signal handlers for clean unmounting. With those fundamentals in place, you can build anything from in-memory virtual filesystems to network-backed file stores — all in TypeScript running on the Node.js event loop.
