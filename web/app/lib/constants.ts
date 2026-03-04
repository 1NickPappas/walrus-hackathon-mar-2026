export const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID!;
export const REGISTRY_ID = process.env.NEXT_PUBLIC_REGISTRY_ID!;
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const WALRUS_AGGREGATOR_URL =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ?? "https://aggregator.walrus-testnet.walrus.space";

export const SEAL_KEY_SERVERS = [
  {
    objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    weight: 1,
  },
  {
    objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
    weight: 1,
  },
];
