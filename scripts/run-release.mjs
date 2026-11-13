// Default-refund path on a vault that is already in HANDED_OVER: anyone triggers release after the window.
import { readFileSync, writeFileSync } from "node:fs";
import { provider, loadKey, accountFrom, balance } from "./lib/chain.mjs";
const label = process.argv[2];
const V = JSON.parse(readFileSync("evidence/vaults.json", "utf8"))[label].account;
const roles = loadKey("roles");
const st = async () => JSON.parse(Buffer.from((await provider.query({ request_type: "call_function", finality: "final", account_id: V, method_name: "get_state", args_base64: Buffer.from("{}").toString("base64") })).result).toString());
const rec = { vault: V, stateBefore: await st(), tenantBalanceBefore: await balance(roles.tenant.id), vaultBalanceBefore: await balance(V) };
// caller is the landlord on purpose: even the landlord can only trigger the refund TO THE TENANT
const lan = accountFrom(roles.landlord.id, roles.landlord.secret);
const r = await lan.callFunctionRaw({ contractId: V, methodName: "release", args: {}, gas: 15_000_000_000_000n });
rec.tx = r.transaction.hash;
rec.logs = (r.receipts_outcome || []).flatMap((o) => o.outcome.logs).filter((l) => l.startsWith("EVENT"));
await new Promise((x) => setTimeout(x, 4000));
rec.stateAfter = await st(); rec.tenantBalanceAfter = await balance(roles.tenant.id); rec.vaultBalanceAfter = await balance(V);
rec.landlordBalanceNote = "landlord called release and paid gas only; the refund went to the tenant";
writeFileSync(`evidence/${label}-release.json`, JSON.stringify(rec, null, 2));
console.log(rec.logs, "phase", rec.stateAfter.phase, "held", rec.stateAfter.held, "tenant +", (BigInt(rec.tenantBalanceAfter) - BigInt(rec.tenantBalanceBefore)).toString());
