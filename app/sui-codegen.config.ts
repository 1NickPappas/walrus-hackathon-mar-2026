import type { SuiCodegenConfig } from "@mysten/codegen";

const config: SuiCodegenConfig = {
  output: "./src/generated",
  generateSummaries: true,
  prune: true,
  packages: [
    {
      package: "@local-pkg/walrus-drive",
      path: "../contract",
    },
  ],
};

export default config;
