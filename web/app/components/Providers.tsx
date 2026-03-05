"use client";

import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import type { Theme } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NETWORK } from "../lib/constants";
import "@mysten/dapp-kit/dist/index.css";

const queryClient = new QueryClient();

const networks = {
  testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" as const },
  mainnet: { url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" as const },
};

const darkTheme: Theme = {
  blurs: { modalOverlay: "blur(8px)" },
  backgroundColors: {
    primaryButton: "#06b6d4",
    primaryButtonHover: "#22d3ee",
    outlineButtonHover: "#22252f",
    modalOverlay: "rgba(0, 0, 0, 0.6)",
    modalPrimary: "#1a1d27",
    modalSecondary: "#0f1117",
    iconButton: "transparent",
    iconButtonHover: "#22252f",
    dropdownMenu: "#1a1d27",
    dropdownMenuSeparator: "#2a2d3a",
    walletItemSelected: "#22252f",
    walletItemHover: "#22252f",
  },
  borderColors: { outlineButton: "#2a2d3a" },
  colors: {
    primaryButton: "#ffffff",
    outlineButton: "#e4e4e7",
    iconButton: "#71717a",
    body: "#e4e4e7",
    bodyMuted: "#71717a",
    bodyDanger: "#ef4444",
  },
  radii: { small: "8px", medium: "12px", large: "16px", xlarge: "20px" },
  shadows: { primaryButton: "none", walletItemSelected: "none" },
  fontWeights: { normal: "400", medium: "500", bold: "600" },
  fontSizes: { small: "14px", medium: "16px", large: "18px", xlarge: "20px" },
  typography: {
    fontFamily:
      'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
    fontStyle: "normal",
    lineHeight: "1.3",
    letterSpacing: "1",
  },
};

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork={NETWORK}>
        <WalletProvider autoConnect theme={darkTheme}>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
