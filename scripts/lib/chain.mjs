// Small helpers around near-api-js. Keys live in secrets/*.json (gitignored) and are never printed.
import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairSigner, KeyPair } from "near-api-js";

export const RPC = "https://test.rpc.fastnear.com";
export const provider = new JsonRpcProvider({ url: RPC });

export function loadKey(file) { return JSON.parse(readFileSync(`secrets/${file}.json`, "utf8")); }
export function accountFrom(id, secret) {
  return new Account(id, provider, new KeyPairSigner(KeyPair.fromString(secret)));
}
export function deployer() {
  const k = loadKey("deployer");
  const id = k.implicitId;
  return { id, account: accountFrom(id, k.secret), publicKey: k.public };
}
export async function balance(id) {
  try { return (await provider.query({ request_type: "view_account", finality: "final", account_id: id })).amount; }
  catch { return null; }
}
