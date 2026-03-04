declare module "fuse-native" {
  namespace Fuse {
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
      statfs?(
        path: string,
        cb: (err: number, stats?: FuseStatFS) => void,
      ): void;
      getattr?(
        path: string,
        cb: (err: number, stat?: FuseStats) => void,
      ): void;
      fgetattr?(
        path: string,
        fd: number,
        cb: (err: number, stat?: FuseStats) => void,
      ): void;
      readdir?(
        path: string,
        cb: (err: number, names?: string[]) => void,
      ): void;
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
      readlink?(
        path: string,
        cb: (err: number, linkName?: string) => void,
      ): void;
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
      listxattr?(
        path: string,
        cb: (err: number, list?: string[]) => void,
      ): void;
      removexattr?(
        path: string,
        name: string,
        cb: (err: number) => void,
      ): void;
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
  }

  class Fuse {
    constructor(
      mnt: string,
      ops: Fuse.FuseOperations,
      opts?: Fuse.FuseOptions,
    );
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
