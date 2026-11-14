// Deploys the TEST dollar stablecoin (token/, build/token-opt.wasm) to a named testnet account and initialises it.
// It is a faucet token with no value, only for the testnet demo. Never deploy it on mainnet: use a real stablecoin there.
// Usage: node scripts/deploy-token.mjs [accountName]   (default cautio-usd.testnet). The account key goes to secrets/token.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { KeyPair } from "near-api-js";
import { deployer, accountFrom, balance } from "./lib/chain.mjs";

const NEAR = 10n ** 24n, T = 10n ** 12n;
const id = process.argv[2] || "cautio-usd.testnet";
if (existsSync("secrets/token.json")) { console.log("secrets/token.json exists, not redeploying"); process.exit(0); }
if ((await balance(id)) !== null) throw new Error(id + " already exists");
const wasm = new Uint8Array(readFileSync("build/token-opt.wasm"));
const { account } = deployer();
const kp = KeyPair.fromRandom("ed25519");
// 161 KB of code needs about 1.6 NEAR of storage, so the named account is created with 2.5 NEAR
await account.callFunctionRaw({ contractId: "testnet", methodName: "create_account", args: { new_account_id: id, new_public_key: kp.getPublicKey().toString() }, deposit: (5n * NEAR) / 2n, gas: 60n * T });
writeFileSync("secrets/token.json", JSON.stringify({ id, secret: kp.toString() }));
await new Promise((r) => setTimeout(r, 3000));
const tok = accountFrom(id, kp.toString());
await tok.deployContract(wasm);
await new Promise((r) => setTimeout(r, 3000));
await tok.callFunctionRaw({ contractId: id, methodName: "new", args: {}, deposit: 0n, gas: 30n * T });
console.log("token deployed at", id, "balance left", (await balance(id)));
