import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { fromHex, toHex } from "@mysten/sui/utils";
import { SealClient, SessionKey } from "@mysten/seal";

import { publishPackage } from "../src/publish.ts";

import {
  register,
  grantAccess,
  publishManifest,
  sealApprove,
} from "../src/generated/walrus_drive/drive.js";
import { initWalrus, uploadBlob, downloadBlob } from "../src/walrus.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TESTNET_KEY_SERVERS = [
  {
    objectId:
      "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    weight: 1,
  },
  {
    objectId:
      "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
    weight: 1,
  },
];

describe("walrus-drive", () => {
  let client: SuiGrpcClient;
  let sealClient: SealClient;
  let adminKeypair: Ed25519Keypair;
  let userKeypair: Ed25519Keypair;
  let adminAddress: string;
  let userAddress: string;
  let plaintext: Uint8Array;

  // Shared state across sequential tests
  let packageId: string;
  let registryId: string;
  let blobId: string;
  let sealId: Uint8Array;
  let encryptedBytes: Uint8Array;

  beforeAll(() => {
    const network = process.env.NETWORK ?? "testnet";
    const rpcUrl =
      process.env.RPC_URL ?? `https://fullnode.${network}.sui.io:443`;
    client = new SuiGrpcClient({ network, baseUrl: rpcUrl });

    sealClient = new SealClient({
      suiClient: client,
      serverConfigs: TESTNET_KEY_SERVERS,
      verifyKeyServers: false,
    });

    const adminKey = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY!);
    adminKeypair = Ed25519Keypair.fromSecretKey(adminKey.secretKey);
    adminAddress = adminKeypair.getPublicKey().toSuiAddress();

    const userKey = decodeSuiPrivateKey(process.env.USER_PRIVATE_KEY!);
    userKeypair = Ed25519Keypair.fromSecretKey(userKey.secretKey);
    userAddress = userKeypair.getPublicKey().toSuiAddress();

    const filePath = resolve(__dirname, "../test_assets/hello.txt");
    plaintext = readFileSync(filePath);

    console.log("Admin address:", adminAddress);
    console.log("User address:", userAddress);
  });

  it("should publish the contract", async () => {
    const bytecodePath = resolve(__dirname, "../../contract/bytecode.json");

    const result = await publishPackage({
      client,
      signer: adminKeypair,
      bytecodePath,
      extractObjects: ["::Registry"],
    });

    packageId = result.packageId;
    registryId = result.createdObjects["::Registry"];

    expect(packageId).toBeTruthy();
    expect(registryId).toBeTruthy();

    console.log("Package ID:", packageId);
    console.log("Registry ID:", registryId);
  });

  it("should create an allowlist for admin", async () => {
    const tx = new Transaction();
    register({
      package: packageId,
      arguments: { registry: registryId },
    })(tx);

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: adminKeypair,
    });
    await client.waitForTransaction({ result });

    expect(result.$kind).toBe("Transaction");
    expect(result.Transaction!.status.success).toBe(true);
    console.log("Allowlist created, digest:", result.Transaction!.digest);
  });

  it("should add user to admin allowlist", async () => {
    const tx = new Transaction();
    grantAccess({
      package: packageId,
      arguments: { registry: registryId, addr: userAddress },
    })(tx);

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: adminKeypair,
    });
    await client.waitForTransaction({ result });

    expect(result.$kind).toBe("Transaction");
    expect(result.Transaction!.status.success).toBe(true);
    console.log(
      "User added to allowlist, digest:",
      result.Transaction!.digest,
    );
  });

  it("should upload and download a blob via Walrus", async () => {
    initWalrus(client);
    blobId = await uploadBlob(plaintext, adminKeypair, { epochs: 3 });
    expect(blobId).toBeTruthy();
    console.log("Blob ID:", blobId);

    const downloaded = await downloadBlob(blobId);
    expect(downloaded).toEqual(plaintext);
    console.log("Downloaded blob matches original");
  });

  it("should encrypt hello.txt with Seal", async () => {
    // Build Seal ID: registryId bytes (32) + admin address bytes (32)
    // Matches check_policy in drive.move
    const registryBytes = fromHex(registryId.replace(/^0x/, ""));
    const ownerBytes = fromHex(adminAddress.replace(/^0x/, ""));
    sealId = new Uint8Array(64);
    sealId.set(registryBytes, 0);
    sealId.set(ownerBytes, 32);

    const { encryptedObject } = await sealClient.encrypt({
      threshold: 2,
      packageId,
      id: toHex(sealId),
      data: plaintext,
    });

    encryptedBytes = encryptedObject;
    expect(encryptedBytes.length).toBeGreaterThan(plaintext.length);
    console.log(
      `Encrypted: ${plaintext.length} bytes -> ${encryptedBytes.length} bytes`,
    );
  });

  it("should upload encrypted blob and publish manifest", async () => {
    // Upload encrypted bytes to Walrus
    const encryptedBlobId = await uploadBlob(encryptedBytes, adminKeypair, { epochs: 3 });
    expect(encryptedBlobId).toBeTruthy();
    console.log("Encrypted Blob ID:", encryptedBlobId);

    // Publish manifest on-chain with the blob ID
    const tx = new Transaction();
    publishManifest({
      package: packageId,
      arguments: { registry: registryId, blobId: encryptedBlobId },
    })(tx);

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: adminKeypair,
    });
    await client.waitForTransaction({ result });

    expect(result.$kind).toBe("Transaction");
    expect(result.Transaction!.status.success).toBe(true);
    console.log("Manifest published, digest:", result.Transaction!.digest);
  });

  it("should decrypt as authorized user", async () => {
    // Create session key for the user
    const sessionKey = await SessionKey.create({
      address: userAddress,
      packageId,
      ttlMin: 10,
      signer: userKeypair,
      suiClient: client,
    });

    // Build transaction bytes with seal_approve call
    const tx = new Transaction();
    sealApprove({
      package: packageId,
      arguments: {
        id: Array.from(sealId),
        registry: registryId,
      },
    })(tx);
    const txBytes = await tx.build({
      client,
      onlyTransactionKind: true,
    });

    // Decrypt
    const decryptedBytes = await sealClient.decrypt({
      data: encryptedBytes,
      sessionKey,
      txBytes,
    });

    expect(decryptedBytes).toEqual(plaintext);
    console.log(
      "Decrypted successfully:",
      new TextDecoder().decode(decryptedBytes),
    );
  });
});
