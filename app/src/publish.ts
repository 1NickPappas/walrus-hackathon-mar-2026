import { readFileSync } from "fs";
import { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Keypair } from "@mysten/sui/cryptography";

export interface PublishResult {
  packageId: string;
  createdObjects: Record<string, string>; // type pattern → objectId
  digest: string;
}

export async function publishPackage(opts: {
  client: SuiGrpcClient;
  signer: Keypair;
  bytecodePath: string;
  extractObjects?: string[]; // type substrings to match, e.g. ["::Registry"]
}): Promise<PublishResult> {
  const { client, signer, bytecodePath, extractObjects = [] } = opts;

  const { modules, dependencies } = JSON.parse(
    readFileSync(bytecodePath, "utf-8"),
  );

  const tx = new Transaction();
  const upgradeCap = tx.publish({ modules, dependencies });
  tx.transferObjects(
    [upgradeCap],
    signer.getPublicKey().toSuiAddress(),
  );

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, objectTypes: true },
  });
  await client.waitForTransaction({ result });

  if (result.$kind !== "Transaction" || !result.Transaction!.status.success) {
    throw new Error(`Publish failed: ${JSON.stringify(result)}`);
  }

  const txn = result.Transaction!;

  // Extract packageId — changedObject with PackageWrite
  const published = txn.effects!.changedObjects.find(
    (c) => c.outputState === "PackageWrite",
  );
  if (!published) {
    throw new Error("No PackageWrite found in transaction effects");
  }
  const packageId = published.objectId;

  // Extract requested objects by type pattern
  const createdObjects: Record<string, string> = {};
  const created = txn.effects!.changedObjects.filter(
    (c) => c.idOperation === "Created" && c.outputState === "ObjectWrite",
  );
  for (const pattern of extractObjects) {
    const match = created.find((c) =>
      txn.objectTypes![c.objectId]?.includes(pattern),
    );
    if (match) {
      createdObjects[pattern] = match.objectId;
    }
  }

  return { packageId, createdObjects, digest: txn.digest };
}
