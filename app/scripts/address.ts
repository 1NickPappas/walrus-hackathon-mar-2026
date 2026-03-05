/**
 * Print wallet addresses derived from the private keys in .env
 *
 * Usage:
 *   cd app && bun run address
 */

import "dotenv/config";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

if (process.env.ADMIN_PRIVATE_KEY) {
  const key = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
  const kp = Ed25519Keypair.fromSecretKey(key.secretKey);
  console.log("Admin:", kp.getPublicKey().toSuiAddress());
}

if (process.env.USER_PRIVATE_KEY) {
  const key = decodeSuiPrivateKey(process.env.USER_PRIVATE_KEY);
  const kp = Ed25519Keypair.fromSecretKey(key.secretKey);
  console.log("User: ", kp.getPublicKey().toSuiAddress());
}
