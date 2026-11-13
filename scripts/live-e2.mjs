// Live testnet run of the two paths the page had not exercised: arbiter 2 stepping in after arbiter 1's silence,
// and the tenant-recovery path. Also checks that a rejected call now reports its real message (--cfg near build).
// Usage: node scripts/live-e2.mjs   (creates two fresh vaults from the current build/opt.wasm hash)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { accountFrom, loadKey, provider } from "./lib/chain.mjs";
const roles = loadKey("roles"), N = 10n ** 24n, T = 10n ** 12n;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const view = async (v) => JSON.parse(Buffer.from((await provider.query({ request_type: "call_function", finality: "optimistic", account_id: v, method_name: "get_state", args_base64: Buffer.from("{}").toString("base64") })).result).toString());
const call = async (v, role, method, args = {}, deposit = 0n) => accountFrom(roles[role].id, roles[role].secret).callFunctionRaw({ contractId: v, methodName: method, args, deposit, gas: 40n * T });
const tryCall = async (v, role, method, args, deposit) => { try { const r = await call(v, role, method, args, deposit); return "ok " + r.transaction.hash; } catch (e) { return "REJECTED: " + JSON.stringify(e.transactionResult?.status || e.message).slice(0, 260); } };
const mk = (label, salt) => { execSync(`node scripts/create-vault.mjs ${label} ${salt}`, { stdio: "pipe", env: { ...process.env, WINDOW_S: "60" } }); return JSON.parse(readFileSync("evidence/vaults.json", "utf8"))[label].account; };
const log = []; const say = (...a) => { const l = a.join(" "); log.push(l); console.log(l); };
const rid = process.argv[2] || Date.now().toString(36);

// ---- Vault E: arbiter 2 path ----
const E = mk("vaultE", "e" + rid); say("vault E", E);
say("fund", await tryCall(E, "tenant", "fund", {}, 3n * N / 10n));
say("declare_handover", await tryCall(E, "tenant", "declare_handover"));
say("file_claim", await tryCall(E, "landlord", "file_claim", { amount: (N / 10n).toString(), kind: 0, report_hash: "ab".repeat(32) }));
say("arbiter 2 too early (expect rejection with a readable reason)", await tryCall(E, "arbiter2", "rule", { landlord_amount: (6n * N / 100n).toString(), arbiter_fee: (5n * N / 1000n).toString() }));
say("waiting 95 s for the arbiter wait to pass"); await sleep(95);
say("arbiter 2 rule", await tryCall(E, "arbiter2", "rule", { landlord_amount: (6n * N / 100n).toString(), arbiter_fee: (5n * N / 1000n).toString() }));
const sE = await view(E); say("E final phase", sE.phase, "held", sE.held);

// ---- Vault F: recovery path ----
const F = mk("vaultF", "f" + rid); say("vault F", F);
say("fund", await tryCall(F, "tenant", "fund", {}, N / 10n));
say("start_recovery by recovery", await tryCall(F, "recovery", "start_recovery"));
say("complete_recovery too early (expect rejection)", await tryCall(F, "recovery", "complete_recovery"));
say("waiting 125 s for the recovery wait"); await sleep(125);
say("complete_recovery", await tryCall(F, "recovery", "complete_recovery"));
const sF1 = await view(F); say("F redirected", sF1.redirected);
say("declare_handover (now by the recovery account)", await tryCall(F, "recovery", "declare_handover"));
say("waiting 65 s for the claim window"); await sleep(65);
const before = BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: roles.recovery.id })).amount);
say("release", await tryCall(F, "tenant", "release"));
await sleep(4);
const after = BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: roles.recovery.id })).amount);
const sF = await view(F); say("F final phase", sF.phase, "held", sF.held, "recovery account gained (yocto)", (after - before).toString());
writeFileSync("evidence/live-e2.md", "# Live run: arbiter 2 and recovery paths\n\n" + log.map((l) => "- " + l).join("\n") + "\n");
