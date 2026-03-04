"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useCurrentAccount,
  useSuiClient,
  useSignPersonalMessage,
} from "@mysten/dapp-kit";
import ConnectWallet from "./ConnectWallet";
import {
  findSharedWithMe,
  getManifestBlobId,
  fetchManifest,
  type ManifestEntry,
} from "../lib/sharing";
import { downloadBlob } from "../lib/walrus";
import { createSealClient, createSessionKey, decrypt } from "../lib/seal";

// ── File icon SVGs ──────────────────────────────────────────

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
      </svg>
    );
  }
  if (["pptx", "ppt", "key"].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
      </svg>
    );
  }
  if (["docx", "doc", "odt"].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12m-5.25 0H5.625c-.621 0-1.125-.504-1.125-1.125V4.125c0-.621.504-1.125 1.125-1.125h5.25a9 9 0 0 1 9 9v5.625c0 .621-.504 1.125-1.125 1.125H16.5" />
      </svg>
    );
  }
  if (["txt", "md", "json", "csv", "log"].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin-slow" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function truncAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Types ───────────────────────────────────────────────────

interface SharedOwner {
  address: string;
  manifestBlobId: string | null;
  files: ManifestEntry[];
}

type DownloadState = "idle" | "downloading" | "done";

// ── File Row Component ──────────────────────────────────────

function FileRow({
  file,
  ownerAddress,
  index,
  downloadState,
  onDownload,
}: {
  file: ManifestEntry;
  ownerAddress: string;
  index: number;
  downloadState: DownloadState;
  onDownload: () => void;
}) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 transition-colors"
      style={{
        background: "var(--card)",
        borderTop: index > 0 ? "1px solid var(--border)" : undefined,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--card)")}
    >
      <FileIcon name={file.name} />
      <span className="font-medium text-sm flex-1 truncate" style={{ color: "var(--foreground)" }}>
        {file.name}
      </span>
      <span className="text-xs tabular-nums w-16 text-right" style={{ color: "var(--muted)" }}>
        {formatSize(file.size)}
      </span>
      <span className="text-xs w-24 text-right hidden sm:block" style={{ color: "var(--muted)" }}>
        {file.createdAt ? formatDate(file.createdAt) : "—"}
      </span>
      <button
        onClick={onDownload}
        disabled={downloadState === "downloading"}
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50"
        style={{
          color: downloadState === "done" ? "var(--success)" : "var(--accent)",
          background: "transparent",
        }}
        onMouseEnter={(e) => {
          if (downloadState === "idle") e.currentTarget.style.background = "var(--border)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        title={downloadState === "downloading" ? "Decrypting..." : "Download & Decrypt"}
      >
        {downloadState === "idle" && <DownloadIcon />}
        {downloadState === "downloading" && <SpinnerIcon />}
        {downloadState === "done" && <CheckIcon />}
      </button>
    </div>
  );
}

// ── Section Header ──────────────────────────────────────────

function SectionHeader({
  title,
  count,
  onRefresh,
}: {
  title: string;
  count: number;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-medium uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {title}
      </h2>
      <div className="flex items-center gap-3">
        {count > 0 && (
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--card)", color: "var(--muted)" }}>
            {count} file{count !== 1 ? "s" : ""}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-xs hover:opacity-70 transition-opacity"
            style={{ color: "var(--accent)" }}
          >
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

export default function SharedFilesPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [myFiles, setMyFiles] = useState<ManifestEntry[]>([]);
  const [owners, setOwners] = useState<SharedOwner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});
  const [discovered, setDiscovered] = useState(false);
  const lastAccountRef = useRef<string | null>(null);

  const REGISTRY_ID = process.env.NEXT_PUBLIC_REGISTRY_ID!;

  const discover = useCallback(async () => {
    if (!account) return;
    console.log("[discover] starting for", account.address);
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch my own files
      console.log("[discover] getManifestBlobId for self...");
      const myManifestBlobId = await getManifestBlobId(suiClient, REGISTRY_ID, account.address);
      if (myManifestBlobId) {
        try {
          const files = await fetchManifest(myManifestBlobId);
          console.log("[discover] my files:", files);
          setMyFiles(files);
        } catch (e) {
          console.error("[discover] fetchManifest (self) failed:", e);
          setMyFiles([]);
        }
      } else {
        setMyFiles([]);
      }

      // 2. Fetch files shared with me
      console.log("[discover] findSharedWithMe...");
      const ownerAddresses = await findSharedWithMe(
        suiClient,
        REGISTRY_ID,
        account.address,
      );
      console.log("[discover] owners:", ownerAddresses);

      const results: SharedOwner[] = [];
      for (const addr of ownerAddresses) {
        // Skip self — already fetched above
        if (addr === account.address) continue;

        console.log("[discover] getManifestBlobId for", addr);
        const manifestBlobId = await getManifestBlobId(suiClient, REGISTRY_ID, addr);
        console.log("[discover] manifestBlobId:", manifestBlobId);
        let files: ManifestEntry[] = [];
        if (manifestBlobId) {
          try {
            files = await fetchManifest(manifestBlobId);
            console.log("[discover] files:", files);
          } catch (e) {
            console.error("[discover] fetchManifest failed:", e);
          }
        }
        results.push({ address: addr, manifestBlobId, files });
      }

      setOwners(results);
    } catch (err: any) {
      console.error("[discover] error:", err);
      setError(err.message ?? "Failed to discover shared files");
    } finally {
      setLoading(false);
      setDiscovered(true);
    }
  }, [account, suiClient, REGISTRY_ID]);

  const discoverRef = useRef(discover);
  discoverRef.current = discover;

  useEffect(() => {
    const addr = account?.address ?? null;
    if (addr !== lastAccountRef.current) {
      // Account changed — reset and re-discover
      lastAccountRef.current = addr;
      setOwners([]);
      setMyFiles([]);
      setDownloadStates({});
      setDiscovered(false);
      if (addr) {
        discoverRef.current();
      }
      return;
    }
    if (account && !discovered) {
      discoverRef.current();
    }
  }, [account, discovered]);

  const handleDownload = useCallback(
    async (ownerAddress: string, file: ManifestEntry) => {
      if (!account) return;
      setDownloadStates((s) => ({ ...s, [file.blobId]: "downloading" }));
      setError(null);
      try {
        const sessionKey = await createSessionKey(account.address, suiClient);
        const msg = sessionKey.getPersonalMessage();
        const { signature } = await signPersonalMessage({ message: msg });
        sessionKey.setPersonalMessageSignature(signature);

        const encryptedData = await downloadBlob(file.blobId);
        const sealClient = createSealClient(suiClient);
        const decryptedBytes = await decrypt({
          sealClient,
          sessionKey,
          ownerAddress,
          suiClient,
          data: encryptedData,
        });

        const blob = new Blob([new Uint8Array(decryptedBytes)]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);

        setDownloadStates((s) => ({ ...s, [file.blobId]: "done" }));
        setTimeout(() => {
          setDownloadStates((s) => ({ ...s, [file.blobId]: "idle" }));
        }, 2000);
      } catch (err: any) {
        setError(err.message ?? "Failed to download/decrypt");
        setDownloadStates((s) => ({ ...s, [file.blobId]: "idle" }));
      }
    },
    [account, suiClient, signPersonalMessage],
  );

  const sharedFileCount = owners.reduce((sum, o) => sum + o.files.length, 0);
  const totalFiles = myFiles.length + sharedFileCount;

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Navbar */}
      <nav
        className="sticky top-0 z-10 border-b backdrop-blur-md"
        style={{
          borderColor: "var(--border)",
          background: "rgba(15, 17, 23, 0.8)",
        }}
      >
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/walrus.png" alt="Walrus FS" className="w-10 h-10 object-contain" />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)", fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>
              Walrus FS
            </h1>
          </div>
          <ConnectWallet />
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Error banner */}
        {error && (
          <div
            className="mb-6 px-4 py-3 rounded-lg flex items-center justify-between"
            style={{ background: "var(--error-bg)", border: "1px solid var(--error)" }}
          >
            <span className="text-sm" style={{ color: "var(--error)" }}>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 hover:opacity-70"
              style={{ color: "var(--error)" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Not connected */}
        {!account && (
          <div className="flex flex-col items-center justify-center py-32">
            <svg className="w-16 h-16 mb-6" style={{ color: "var(--muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <p className="text-lg font-medium" style={{ color: "var(--muted)" }}>
              Connect your wallet to view your files
            </p>
            <p className="text-sm mt-2" style={{ color: "var(--border)" }}>
              Your files are encrypted and stored on Walrus
            </p>
          </div>
        )}

        {/* Connected — loading */}
        {account && loading && (
          <div>
            <div className="mb-8">
              <SectionHeader title="My Files" count={0} />
              <div className="space-y-px rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                {[1, 2].map((i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-4" style={{ background: "var(--card)" }}>
                    <div className="skeleton w-5 h-5 rounded" />
                    <div className="skeleton h-4 rounded flex-1" style={{ maxWidth: 160 }} />
                    <div className="skeleton h-3 rounded w-12" />
                    <div className="skeleton h-3 rounded w-20" />
                    <div className="skeleton h-8 rounded w-8" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <SectionHeader title="Shared with me" count={0} />
              <div className="space-y-px rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                {[1, 2].map((i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-4" style={{ background: "var(--card)" }}>
                    <div className="skeleton w-5 h-5 rounded" />
                    <div className="skeleton h-4 rounded flex-1" style={{ maxWidth: 160 }} />
                    <div className="skeleton h-3 rounded w-12" />
                    <div className="skeleton h-3 rounded w-20" />
                    <div className="skeleton h-8 rounded w-8" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Connected — empty state */}
        {account && !loading && discovered && totalFiles === 0 && (
          <div className="flex flex-col items-center justify-center py-32">
            <svg className="w-16 h-16 mb-6" style={{ color: "var(--muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            <p className="text-lg font-medium" style={{ color: "var(--muted)" }}>
              No files found
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--border)" }}>
              Upload files via the CLI or ask someone to share with you
            </p>
            <button
              onClick={discover}
              className="mt-4 text-sm px-4 py-2 rounded-lg transition-colors"
              style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
            >
              Refresh
            </button>
          </div>
        )}

        {/* Connected — file lists */}
        {account && !loading && discovered && totalFiles > 0 && (
          <div>
            {/* My Files section */}
            <div className="mb-10">
              <SectionHeader title="My Files" count={myFiles.length} onRefresh={discover} />
              {myFiles.length === 0 ? (
                <p className="text-sm py-4" style={{ color: "var(--muted)" }}>
                  No files uploaded yet
                </p>
              ) : (
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  {myFiles.map((file, i) => (
                    <FileRow
                      key={file.blobId}
                      file={file}
                      ownerAddress={account.address}
                      index={i}
                      downloadState={downloadStates[file.blobId] ?? "idle"}
                      onDownload={() => handleDownload(account.address, file)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Shared with me section */}
            <div>
              <SectionHeader title="Shared with me" count={sharedFileCount} />
              {sharedFileCount === 0 ? (
                <p className="text-sm py-4" style={{ color: "var(--muted)" }}>
                  No files shared with you yet
                </p>
              ) : (
                owners.map((owner) =>
                  owner.files.length === 0 ? null : (
                    <div key={owner.address} className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
                        <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                          from {truncAddr(owner.address)}
                        </span>
                      </div>
                      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                        {owner.files.map((file, i) => (
                          <FileRow
                            key={file.blobId}
                            file={file}
                            ownerAddress={owner.address}
                            index={i}
                            downloadState={downloadStates[file.blobId] ?? "idle"}
                            onDownload={() => handleDownload(owner.address, file)}
                          />
                        ))}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
