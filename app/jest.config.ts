import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testTimeout: 120_000,
  roots: ["<rootDir>/test"],
  setupFiles: ["dotenv/config"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          rootDir: ".",
          outDir: "dist",
          module: "Node16",
          moduleResolution: "Node16",
          target: "ES2022",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ["jest", "node"],
        },
      },
    ],
  },
};

export default config;
