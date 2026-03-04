import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SealClient, SessionKey } from "@mysten/seal";

import {
  register,
  grantAccess,
  publishManifest,
} from "../src/generated/walrus_drive/drive.js";
import { initWalrus, uploadBlob, downloadBlob } from "../src/walrus.ts";
import { encrypt, decrypt } from "../src/seal.ts";
import {
  findSharedWithMe,
  getManifestBlobId,
} from "../src/sharing.ts";

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
  let encryptedBytes: Uint8Array;
  let encryptedBlobId: string;
  let manifestBlobId: string;

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
    const contractPath = resolve(__dirname, "../../contract");

    // Compile Move bytecode (no env/key config needed)
    const buildOutput = execSync(
      `sui move build --dump-bytecode-as-base64 --path "${contractPath}"`,
      { encoding: "utf-8" },
    );
    const { modules, dependencies } = JSON.parse(buildOutput);

    // Publish via SDK
    const tx = new Transaction();
    const upgradeCap = tx.publish({ modules, dependencies });
    tx.transferObjects([upgradeCap], adminAddress);

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: adminKeypair,
      include: { effects: true, objectTypes: true },
    });
    await client.waitForTransaction({ result });

    expect(result.$kind).toBe("Transaction");
    const txn = result.Transaction!;
    expect(txn.status.success).toBe(true);

    // Extract packageId — find changedObject with PackageWrite
    const published = txn.effects!.changedObjects.find(
      (c) => c.outputState === "PackageWrite",
    );
    expect(published).toBeDefined();
    packageId = published!.objectId;

    // Extract registryId — find created object whose type contains ::Registry
    const created = txn.effects!.changedObjects.filter(
      (c) => c.idOperation === "Created" && c.outputState === "ObjectWrite",
    );
    const registryEntry = created.find((c) =>
      txn.objectTypes![c.objectId]?.includes("::Registry"),
    );
    expect(registryEntry).toBeDefined();
    registryId = registryEntry!.objectId;

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
    encryptedBytes = await encrypt({
      sealClient,
      packageId,
      registryId,
      ownerAddress: adminAddress,
      data: plaintext,
    });

    expect(encryptedBytes.length).toBeGreaterThan(plaintext.length);
    console.log(
      `Encrypted: ${plaintext.length} bytes -> ${encryptedBytes.length} bytes`,
    );
  });

  it("should upload encrypted blob and publish manifest", async () => {
    // Upload encrypted bytes to Walrus
    encryptedBlobId = await uploadBlob(encryptedBytes, adminKeypair, { epochs: 3 });
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
    const sessionKey = await SessionKey.create({
      address: userAddress,
      packageId,
      ttlMin: 10,
      signer: userKeypair,
      suiClient: client,
    });

    const decryptedBytes = await decrypt({
      sealClient,
      sessionKey,
      packageId,
      registryId,
      ownerAddress: adminAddress,
      suiClient: client,
      data: encryptedBytes,
    });

    expect(decryptedBytes).toEqual(plaintext);
    console.log(
      "Decrypted successfully:",
      new TextDecoder().decode(decryptedBytes),
    );
  });

  it("should let Bob discover shared files from the registry", async () => {
    // Bob queries: who shared with me?
    const owners = await findSharedWithMe(client, registryId, userAddress);
    expect(owners).toContain(adminAddress);
    console.log("Owners who shared with Bob:", owners);

    // Read admin's manifest blob ID from chain
    manifestBlobId = (await getManifestBlobId(client, registryId, adminAddress))!;
    expect(manifestBlobId).toBe(encryptedBlobId);
    console.log("Admin's manifest blob ID:", manifestBlobId);
  });

  it("should let Bob download and decrypt a shared file end-to-end", async () => {
    // Bob creates a session key
    const sessionKey = await SessionKey.create({
      address: userAddress,
      packageId,
      ttlMin: 10,
      signer: userKeypair,
      suiClient: client,
    });

    // Bob downloads the encrypted blob from Walrus and decrypts via Seal
    const encryptedData = await downloadBlob(manifestBlobId);
    const decrypted = await decrypt({
      sealClient,
      sessionKey,
      packageId,
      registryId,
      ownerAddress: adminAddress,
      suiClient: client,
      data: encryptedData,
    });

    expect(decrypted).toEqual(plaintext);
    console.log(
      "Bob decrypted shared file:",
      new TextDecoder().decode(decrypted),
    );
  });
});
