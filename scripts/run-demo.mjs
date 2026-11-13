// Runs the full vault flow live on testnet and records every result in evidence/.
// Usage: node scripts/run-demo.mjs <vaultLabel>
import { readFileSync, writeFileSync } from "node:fs";
import { provider, loadKey, accountFrom, deployer, balance } from "./lib/chain.mjs";

const label = process.argv[2] || "vaultA";
const vaults = JSON.parse(readFileSync("evidence/vaults.json", "utf8"));
const V = vaults[label].account;
const roles = loadKey("roles");
const who = Object.fromEntries(Object.entries(roles).map(([n, r]) => [n, accountFrom(r.id, r.secret)]));
const rec = { vault: V, steps: [] };
const N = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);
const NEAR = 10n ** 24n;
const step = (name, data) => { rec.steps.push({ name, ...data }); console.log(name, "=>", data.ok === undefined ? "" : data.ok ? "ok" : "REJECTED", data.error ? data.error.slice(0, 140) : ""); };
const state = async () => JSON.parse(Buffer.from((await provider.query({ request_type: "call_function", finality: "final", account_id: V, method_name: "get_state", args_base64: Buffer.from("{}").toString("base64") })).result).toString());
const bals = async () => { const o = {}; for (const k of Object.keys(roles)) o[k] = await balance(roles[k].id); o.vault = await balance(V); return o; };
async function call(role, method, args = {}, deposit = 0n) {
  try {
    const r = await who[role].callFunctionRaw({ contractId: V, methodName: method, args, deposit, gas: 15_000_000_000_000n });
    const logs = (r.receipts_outcome || []).flatMap((o) => o.outcome.logs).filter((l) => l.startsWith("EVENT"));
    const st = await state();
    step(`${role}.${method}`, { ok: true, tx: r.transaction.hash, logs, phaseAfter: st.phase, heldAfter: st.held });
  } catch (e) {
    const st = await state();
    step(`${role}.${method}`, { ok: false, error: String(e.message || e), phaseAfter: st.phase, heldAfter: st.held });
  }
}

// 0. storage buffer: keeps the account above NEAR's storage-balance minimum so a full refund can always leave it
const { account: dep } = deployer();
const t0 = await dep.transfer({ receiverId: V, amount: NEAR / 100n });
step("buffer: 0.01 NEAR plain transfer to vault", { ok: true, tx: t0.transaction.hash });
const before = await bals(); rec.balancesBefore = before;

// 1. keyless proof: the vault cannot sign for itself, and the parties' keys do not work on it
for (const role of ["landlord", "tenant"]) {
  try {
    const stolen = accountFrom(V, roles[role].secret);
    await stolen.transfer({ receiverId: roles[role].id, amount: 1n });
    step(`attempt: ${role}'s key signs a transfer FROM the vault`, { ok: true, note: "UNEXPECTED: moved" });
  } catch (e) { step(`attempt: ${role}'s key signs a transfer FROM the vault`, { ok: false, error: String(e.message || e) }); }
}

// 2. rule checks before the happy path
await call("landlord", "declare_handover");               // only the tenant may
await call("tenant", "fund", {}, 4n * 10n ** 23n);        // 0.4 NEAR deposit
await call("landlord", "release");                          // too early / wrong phase
await call("tenant", "declare_handover");
await call("landlord", "release");                          // window still open
await call("landlord", "file_claim", { amount: "150000000000000000000000", kind: 0, report_hash: "ab".repeat(32) });
const afterClaim = await bals(); rec.balancesAfterClaim = afterClaim;
rec.stateAfterClaim = await state();
await call("arbiter2", "rule", { landlord_amount: "0", arbiter_fee: "0" });   // before SLA: must fail
await call("arbiter1", "rule", { landlord_amount: "100000000000000000000000", arbiter_fee: "5000000000000000000000" });
rec.stateFinal = await state(); rec.balancesAfter = await bals();
const d = (k) => (BigInt(rec.balancesAfter[k]) - BigInt(before[k]));
rec.netChange = Object.fromEntries(["landlord", "tenant", "arbiter1", "vault"].map((k) => [k, N(d(k) < 0n ? -d(k) : d(k)) + (d(k) < 0n ? " (out)" : " (in)")]));
writeFileSync(`evidence/${label}-run.json`, JSON.stringify(rec, null, 2));
console.log("final phase:", rec.stateFinal.phase, "held:", rec.stateFinal.held, "net:", JSON.stringify(rec.netChange));
