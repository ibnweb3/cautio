// Creates a vault as a deterministic (keyless) account from the published global code hash.
// Usage: node scripts/create-vault.mjs <label> <salt>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DeterministicStateInit } from "near-api-js";
import { deployer, loadKey, provider } from "./lib/chain.mjs";
import { encodeState, globalHash, sha256hex } from "./lib/state.mjs";

const [label, salt] = process.argv.slice(2);
if (!label || !salt) throw new Error("usage: create-vault.mjs <label> <salt>");
const roles = loadKey("roles");
const hash = globalHash(readFileSync("build/opt.wasm"));
const termsDoc = JSON.stringify({ lease: "demo 12-month lease, unit 4B", reportOnMoveIn: "checklist v1", salt });
const terms = {
  landlord: roles.landlord.id, tenant: roles.tenant.id, recovery: roles.recovery.id,
  arbiter1: roles.arbiter1.id, arbiter2: roles.arbiter2.id,
  capYocto: 5n * 10n ** 23n,                // 0.5 NEAR cap on testnet
  claimWindowNs: BigInt(process.env.WINDOW_S || 120) * 1_000_000_000n, // short so the demo can be run live
  arbiterSlaNs: 90n * 1_000_000_000n,
  recoveryTimelockNs: 120n * 1_000_000_000n,
  arbiterFeeBps: 500,
  termsHashHex: sha256hex(termsDoc),
};
const stateInit = new DeterministicStateInit({ code: { codeHash: hash }, data: [[Buffer.from("STATE"), encodeState(terms)]] });
const id = stateInit.deriveAccountId();
console.log("vault address:", id);
const { account } = deployer();
const obs = {};
if (process.env.PRESEND) {
  // Hazard test: money sent to the derived address BEFORE it is deployed.
  const t = await account.transfer({ receiverId: id, amount: 10n ** 21n });
  obs.preSendTx = t.transaction.hash;
  obs.afterPreSend = await provider.query({ request_type: "view_account", finality: "final", account_id: id }).catch((e) => ({ error: String(e.message || e).slice(0, 200) }));
  console.log("after pre-send:", JSON.stringify(obs.afterPreSend).slice(0, 300));
}
const r = await account.createDeterministicAccount({ stateInit, deposit: 5n * 10n ** 22n });
console.log("status:", JSON.stringify(r.status).slice(0, 80), "tx:", r.transaction.hash);
const file = "evidence/vaults.json";
const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
all[label] = { account: id, codeHash: hash, termsHash: terms.termsHashHex, salt, createTx: r.transaction.hash, ...obs };
await new Promise((r) => setTimeout(r, 4000));
obs.afterCreate = await provider.query({ request_type: "view_account", finality: "optimistic", account_id: id });
all[label].afterCreate = obs.afterCreate;
writeFileSync(file, JSON.stringify(all, null, 2));
console.log("after create:", JSON.stringify(obs.afterCreate).slice(0, 300));
