// Live testnet run of the stablecoin vault and the dispute fixes, using the public throwaway demo accounts:
//   A) token deposit, over-cap refund, partial claim, tenant reply, arbiter ruling with reasons, exact payouts
//   B) silent arbiters: a late ruling is refused and the claim lapses to the tenant
//   C) a payee that is not registered with the token: the payout fails safely, is recorded, and is retried
// Usage: node scripts/live-e3.mjs   (needs the new contract published, the token deployed, build/opt.wasm current)
import { readFileSync, writeFileSync } from "node:fs";
import { DeterministicStateInit, KeyPair } from "near-api-js";
import { provider, accountFrom, loadKey } from "./lib/chain.mjs";
import { encodeState, globalHash, sha256hex } from "./lib/state.mjs";

const NEAR = 10n ** 24n, T = 10n ** 12n, USD = 10n ** 6n;
const demo = JSON.parse(readFileSync("public/demo.json", "utf8")).accounts;
const token = loadKey("token").id;
const hash = globalHash(readFileSync("build/opt.wasm"));
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const acct = (role) => accountFrom(demo[role].id, demo[role].secret);
const view = async (id, method, args = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: "call_function", finality: "optimistic", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());
const bal = async (id) => BigInt(await view(token, "ft_balance_of", { account_id: id }));
const log = []; const say = (...a) => { const l = a.join(" "); log.push(l); console.log(l); };
const call = async (who, to, method, args = {}, deposit = 0n, gas = 40n) => {
  try { const r = await acct(who).callFunctionRaw({ contractId: to, methodName: method, args, deposit, gas: gas * T }); await sleep(7); return "ok"; }
  catch (e) { const st = JSON.stringify(e.transactionResult?.status || e.message); const m = /panicked: ([^"\\]+)/.exec(st); return "REJECTED: " + (m ? m[1].trim() : st.slice(0, 200)); }
};
const H = (s) => sha256hex(s);
const hf = (id) => ({ ...id });

async function makeVault(label, tenantId, windowS, slaS) {
  const t = {
    landlord: demo.landlord.id, tenant: tenantId, recovery: demo.recovery.id, arbiter1: demo.arbiter1.id, arbiter2: demo.arbiter2.id,
    capYocto: 300n * USD, claimWindowNs: BigInt(windowS) * 10n ** 9n, arbiterSlaNs: BigInt(slaS) * 10n ** 9n, recoveryTimelockNs: 120n * 10n ** 9n,
    arbiterFeeBps: 500, termsHashHex: sha256hex(label + Date.now()), token,
  };
  const si = new DeterministicStateInit({ code: { codeHash: hash }, data: [[Buffer.from("STATE"), encodeState(t)]] });
  const id = si.deriveAccountId();
  await acct("landlord").createDeterministicAccount({ stateInit: si, deposit: 5n * 10n ** 22n });
  await sleep(5);
  await acct("landlord").transfer({ receiverId: id, amount: 2n * 10n ** 22n }); // reserve so the vault can attach 1 yocto to token transfers
  await sleep(4);
  const bounds = await view(token, "storage_balance_bounds");
  const reg = [id, demo.landlord.id, demo.tenant.id, demo.recovery.id, demo.arbiter1.id, demo.arbiter2.id, tenantId];
  for (const a of [...new Set(reg)]) if (!(await view(token, "storage_balance_of", { account_id: a }))) await acct("landlord").callFunctionRaw({ contractId: token, methodName: "storage_deposit", args: { account_id: a, registration_only: true }, deposit: BigInt(bounds.min), gas: 10n * T });
  say(label, "vault", id, "code hash", hash);
  return id;
}
const pay = (who, vault, amount) => call(who, token, "ft_transfer_call", { receiver_id: vault, amount: amount.toString(), msg: "" }, 1n, 100n);

// ---- A: full token path with a dispute ----
const A = await makeVault("A", demo.tenant.id, 45, 40);
say("mint 1000 tUSD to the tenant", await call("tenant", token, "mint", { account_id: demo.tenant.id, amount: (1000n * USD).toString() }, 0n, 30n));
const t0 = await bal(demo.tenant.id), l0 = await bal(demo.landlord.id), a0 = await bal(demo.arbiter1.id);
say("pay 250 tUSD", await pay("tenant", A, 250n * USD));
say("pay 100 tUSD (only 50 fit under the 300 cap; 50 must come back)", await pay("tenant", A, 100n * USD));
let s = await view(A, "get_state");
say("held after both payments (expect 300 tUSD):", (BigInt(s.held) / USD).toString(), "| vault token balance:", ((await bal(A)) / USD).toString(), "| tenant paid in total:", ((t0 - (await bal(demo.tenant.id))) / USD).toString());
say("native fund() on a token vault (expect rejection)", await call("tenant", A, "fund", {}, NEAR / 100n));
say("declare_handover", await call("tenant", A, "declare_handover"));
say("file_claim 100 tUSD", await call("landlord", A, "file_claim", { amount: (100n * USD).toString(), kind: 0, report_hash: H("report") }, 0n, 120n));
say("tenant got the undisputed 200 back at once; tenant total paid so far (expect 100):", ((t0 - (await bal(demo.tenant.id))) / USD).toString());
say("tenant reply", await call("tenant", A, "respond", { response_hash: H("reply") }));
say("second tenant reply (expect rejection)", await call("tenant", A, "respond", { response_hash: H("reply2") }));
say("landlord replying as tenant (expect rejection)", await call("landlord", A, "respond", { response_hash: H("x") }));
s = await view(A, "get_state"); say("reply on record:", s.response_hash !== "0".repeat(64));
say("arbiter 1 rules: landlord 60, fee 5, tenant 35", await call("arbiter1", A, "rule", { landlord_amount: (60n * USD).toString(), arbiter_fee: (5n * USD).toString(), reason_hash: H("reasons") }, 0n, 120n));
await sleep(6);
s = await view(A, "get_state");
say("A final phase", s.phase, "held", s.held, "ruling hash recorded:", s.ruling_hash !== "0".repeat(64));
say("payouts: landlord +", ((await bal(demo.landlord.id)) - l0) / USD, "arbiter +", ((await bal(demo.arbiter1.id)) - a0) / USD, "tenant net cost", (t0 - (await bal(demo.tenant.id))) / USD, "(expect 60, 5, 65)");

// ---- B: silent arbiters ----
const B = await makeVault("B", demo.tenant.id, 30, 20);
say("pay 100 tUSD", await pay("tenant", B, 100n * USD));
say("declare_handover", await call("tenant", B, "declare_handover"));
say("file_claim 80 tUSD", await call("landlord", B, "file_claim", { amount: (80n * USD).toString(), kind: 0, report_hash: H("r2") }, 0n, 120n));
say("lapse too early (expect rejection)", await call("landlord", B, "lapse_claim", {}, 0n, 120n));
say("waiting 45 s for both arbiter waits to pass"); await sleep(45);
say("arbiter 1 ruling after the deadline (expect rejection)", await call("arbiter1", B, "rule", { landlord_amount: "0", arbiter_fee: "0", reason_hash: H("late") }, 0n, 120n));
const tb = await bal(demo.tenant.id);
say("anyone closes the lapsed claim", await call("landlord", B, "lapse_claim", {}, 0n, 120n));
await sleep(6);
s = await view(B, "get_state");
say("B final phase", s.phase, "held", s.held, "| tenant refunded +", ((await bal(demo.tenant.id)) - tb) / USD, "(expect 80)");

// ---- C: payee not registered with the token ----
const x = KeyPair.fromRandom("ed25519"); const xid = Buffer.from(x.getPublicKey().ed25519Key.data).toString("hex");
await acct("landlord").transfer({ receiverId: xid, amount: NEAR / 10n }); await sleep(4);
const xAcc = accountFrom(xid, x.toString());
const C = await makeVault("C", xid, 20, 20);
// makeVault registered xid; remove that so this payee really is unregistered
await xAcc.callFunctionRaw({ contractId: token, methodName: "storage_unregister", args: { force: true }, deposit: 1n, gas: 20n * T }); await sleep(5);
say("tenant account registered with the token?", !!(await view(token, "storage_balance_of", { account_id: xid })));
say("landlord pays 40 tUSD for the tenant", await call("landlord", token, "mint", { account_id: demo.landlord.id, amount: (100n * USD).toString() }, 0n, 30n), await pay("landlord", C, 40n * USD));
await xAcc.callFunctionRaw({ contractId: C, methodName: "declare_handover", args: {}, deposit: 0n, gas: 20n * T }); await sleep(5);
say("waiting 25 s for the claim window"); await sleep(25);
say("release (the tenant payout must fail safely)", await call("landlord", C, "release", {}, 0n, 120n));
await sleep(6);
s = await view(C, "get_state");
say("C state: phase", s.phase, "owed", JSON.stringify(s.owed));
await acct("landlord").callFunctionRaw({ contractId: token, methodName: "storage_deposit", args: { account_id: xid, registration_only: true }, deposit: 2n * 10n ** 21n, gas: 10n * T }); await sleep(4);
say("retry the payout", await call("landlord", C, "claim_owed", { account: xid }, 0n, 120n));
await sleep(6);
s = await view(C, "get_state");
say("after retry: owed", JSON.stringify(s.owed), "| tenant token balance", ((await bal(xid)) / USD).toString(), "(expect 40)");

writeFileSync("evidence/live-e3.md", "# Live run: stablecoin vault and dispute fixes (NEAR testnet)\n\nToken: " + token + " (test dollar, 6 decimals)\n\n" + log.map((l) => "- " + l).join("\n") + "\n");
console.log("written evidence/live-e3.md");
