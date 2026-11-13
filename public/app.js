import { Account, JsonRpcProvider, KeyPairSigner, KeyPair, DeterministicStateInit, NearConnector, actions } from "./near.bundle.js";
import { encodeState, b58, sha256Hex, sha256, utf8, parseNear, fmtNear, toHex } from "./state.js";

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
const NS = 1_000_000n; // ns per millisecond
const PHASES = ["Open: waiting for the deposit", "Handed over: landlord's claim window", "Claim filed: waiting for the arbiter", "Settled"];

let cfg = { network: "testnet", label: "NEAR testnet", rpc: "https://test.rpc.fastnear.com", explorer: "https://testnet.nearblocks.io", pinnedCodeHash: "", legacyCodeHashes: [], vault: null };
const EXPLORER = () => cfg.explorer;
const netName = () => cfg.network;
let provider;
let me = null;          // { id, secret }
let current = null;     // { id, state, acc }

// ---------- storage (always optional) ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- tabs ----------
const tabs = ["vault", "open", "account", "how"];
function showTab(id) {
  for (const t of tabs) {
    $("#tab-" + t).setAttribute("aria-selected", String(t === id));
    $("#panel-" + t).hidden = t !== id;
  }
  if (id === "account") refreshAccount();
  if (id === "open") updateOpenCost();
}
for (const t of tabs) $("#tab-" + t).addEventListener("click", () => showTab(t));
$("#cta-open").addEventListener("click", () => { showTab("open"); $("#panel-open").scrollIntoView({ behavior: "smooth" }); });
$("#cta-how").addEventListener("click", () => { showTab("how"); $("#panel-how").scrollIntoView({ behavior: "smooth" }); });

// ---------- chain helpers ----------
async function rpc(method, params) {
  const r = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.data || j.error.message || "RPC error");
  if (j.result && j.result.error) throw new Error(j.result.error);
  return j.result;
}
const viewAccount = (id) => rpc("query", { request_type: "view_account", finality: "optimistic", account_id: id });
async function getBalance(id) { try { return BigInt((await viewAccount(id)).amount); } catch { return null; } }
async function viewCall(id, method, args = {}) {
  const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: id, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
}
let connector = null, wallet = null, acting = "key"; // wallet = { id }
const actorId = () => (acting === "wallet" && wallet ? wallet.id : me ? me.id : null);
const signerAccount = () => new Account(me.id, provider, new KeyPairSigner(KeyPair.fromString(me.secret)));
const short = (s) => (s.length > 22 ? s.slice(0, 10) + "…" + s.slice(-8) : s);
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const validAccount = (s) => s.length >= 2 && s.length <= 64 && ACCOUNT_RE.test(s);
function friendly(e) {
  const m = String(e && e.message || e);
  const pm = /panicked: ([^"\\]+)/.exec(m) || /panicked: ([^"\\]+)/.exec(JSON.stringify(e && e.transactionResult && e.transactionResult.status || ""));
  if (pm) { const t = pm[1].trim(); return "The vault rejected this: " + t.charAt(0).toUpperCase() + t.slice(1) + "."; }
  if (/unreachable|ExecutionError|FunctionCallError/i.test(m)) return "The vault rejected this call. Usually the wrong account, the wrong phase, or an amount over a limit.";
  if (/NotEnoughBalance|Not enough balance|lacks balance|LackBalance/i.test(m)) return "This account does not have enough NEAR for the amount plus the network fee (a few hundredths of a NEAR are reserved for gas). Lower the amount or top up in the Account tab.";
  if (/GasLimit|Exceeded the prepaid gas/i.test(m)) return "Ran out of gas for this call.";
  return m.slice(0, 220);
}
const say = (node, text, bad = false) => { node.textContent = text; node.className = "msg" + (bad ? " bad" : ""); };

// ---------- my account ----------
function loadMe() {
  try { const j = JSON.parse(store.get("cautio.account") || "null"); if (j && j.id && j.secret) me = j; } catch {}
}
function saveMe() { if (me && !store.set("cautio.account", JSON.stringify(me))) say($("#acct-msg"), "This browser blocked local storage, so the key will be lost when you close the page. Export it now.", true); }
function newAccount() {
  const kp = KeyPair.fromRandom("ed25519");
  me = { id: toHex(kp.getPublicKey().ed25519Key.data), secret: kp.toString() };
  saveMe(); refreshAccount(); renderActions();
}
async function refreshAccount() {
  $("#wallet-none").hidden = !!wallet; $("#wallet-have").hidden = !wallet;
  $("#acting-row").hidden = !(wallet && me);
  if (wallet) {
    $("#wallet-id").textContent = wallet.id;
    $("#acting").value = acting;
    getBalance(wallet.id).then((b) => { $("#wallet-bal").textContent = b === null ? "0 NEAR (account does not exist on " + netName() + " yet)" : fmtNear(b) + " NEAR"; });
  }
  $("#acct-none").hidden = !!me; $("#acct-have").hidden = !me;
  $("#topup-form").hidden = !(me && wallet);
  $("#name-form").hidden = !(me && /^[0-9a-f]{64}$/.test(me.id) && cfg.registrar);
  if (!me) return;
  $("#acct-id").textContent = me.id;
  const b = await getBalance(me.id);
  $("#acct-bal").textContent = b === null ? "0 NEAR (account does not exist on " + netName() + " yet)" : fmtNear(b) + " NEAR";
  $("#acct-hint").textContent = b === null || b < 10n ** 23n
    ? "This account is empty. Send NEAR to the address above" + (cfg.network === "testnet" ? " from a testnet faucet or any funded testnet account" : "") + ". About 0.2 NEAR is enough to open a vault and make several calls."
    : "";
}
$("#acct-new").addEventListener("click", newAccount);
$("#import-form").addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const secret = $("#import-key").value.trim(), id = $("#import-id").value.trim();
    KeyPair.fromString(secret);
    if (!validAccount(id)) throw new Error("That is not a valid account id.");
    me = { id, secret }; saveMe(); $("#import-key").value = ""; refreshAccount(); renderActions();
  } catch (x) { say($("#acct-msg"), "Could not use that key: " + x.message, true); }
});
$("#acct-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(me.id); say($("#acct-msg"), "Address copied."); } catch { say($("#acct-msg"), "Copy failed. Select the address and copy it by hand.", true); } });
$("#acct-refresh").addEventListener("click", refreshAccount);
$("#acct-export").addEventListener("click", () => {
  const pre = $("#acct-secret");
  pre.hidden = !pre.hidden;
  pre.textContent = pre.hidden ? "" : me.secret;
  $("#acct-export").textContent = pre.hidden ? "Show private key" : "Hide private key";
});
$("#acct-remove").addEventListener("click", () => {
  if (!confirm("Remove this key from this browser? If you have not exported it, any NEAR in this account is lost for good.")) return;
  store.del("cautio.account"); me = null; $("#acct-secret").hidden = true; refreshAccount(); renderActions();
});

// ---------- recent vaults ----------
const recents = () => { try { return JSON.parse(store.get("cautio.recent") || "[]"); } catch { return []; } };
function remember(id) { const r = [id, ...recents().filter((x) => x !== id)].slice(0, 6); store.set("cautio.recent", JSON.stringify(r)); renderRecent(); }
function renderRecent() {
  const ids = [...new Set([...(cfg.vault ? [cfg.vault] : []), ...recents()])];
  $("#recent").replaceChildren(...ids.map((id) => {
    const b = el("button", { type: "button", className: "chip", textContent: (id === cfg.vault ? "Example · " : "") + short(id) });
    b.addEventListener("click", () => openVault(id));
    return b;
  }));
}

// ---------- vault view ----------
$("#lookup").addEventListener("submit", (e) => { e.preventDefault(); openVault($("#vault-id").value.trim()); });
$("#refresh").addEventListener("click", () => current && loadVault(current.id, true));
$("#copy-link").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#vault=" + current.id;
  try { await navigator.clipboard.writeText(url); $("#copy-note").textContent = "Copied."; } catch { $("#copy-note").textContent = url; }
});
function openVault(id) {
  showTab("vault");
  $("#vault-id").value = id;
  history.replaceState(null, "", "#vault=" + id);
  loadVault(id);
}

const t2 = (ns) => new Date(Number(BigInt(ns) / NS)).toLocaleString();
function dur(ns) {
  const s = Number(BigInt(ns) / 1_000_000_000n);
  if (s >= 86400 && s % 86400 === 0) return s / 86400 + " day" + (s / 86400 === 1 ? "" : "s");
  if (s >= 3600 && s % 3600 === 0) return s / 3600 + " hour" + (s / 3600 === 1 ? "" : "s");
  if (s >= 60) return Math.round(s / 60) + " minute" + (Math.round(s / 60) === 1 ? "" : "s");
  return s + " seconds";
}
const left = (ns) => { const ms = Number(BigInt(ns) / NS) - (Date.now() + skewMs); if (ms <= 0) return "now"; const m = Math.ceil(ms / 60000); return m >= 2880 ? Math.ceil(m / 1440) + " days" : m >= 120 ? Math.ceil(m / 60) + " hours" : m + " minutes"; };
let skewMs = 0; // chain time minus this device's clock, so countdowns follow the chain, not a wrong local clock
const nowNs = () => BigInt(Date.now() + skewMs) * NS;
const row = (cls, tag, ...kids) => el("li", {}, el("span", { className: "tag " + cls, textContent: tag }), el("span", {}, ...kids));
const code = (t) => el("code", { textContent: t });

function roleList(s) {
  const aid = actorId();
  if (!aid) return [];
  const r = [];
  if (aid === s.landlord) r.push("landlord");
  if (aid === (s.redirected ? s.recovery : s.tenant)) r.push("tenant");
  if (aid === s.recovery) r.push("recovery");
  if (aid === s.arbiter1) r.push("arbiter1");
  if (aid === s.arbiter2) r.push("arbiter2");
  return r;
}

async function loadVault(id, quiet = false) {
  $("#vault-empty").hidden = true;
  const view = $("#vault-view");
  if (!quiet) { view.hidden = true; $("#vault-empty").hidden = false; $("#vault-empty").textContent = "Reading the chain…"; }
  let acc, state;
  try {
    const blk = await rpc("block", { finality: "optimistic" });
    skewMs = Number(BigInt(blk.header.timestamp) / NS) - Date.now();
    acc = await viewAccount(id);
    state = await viewCall(id, "get_state");
  } catch (x) {
    $("#vault-empty").hidden = false; view.hidden = true;
    $("#vault-empty").textContent = /does not exist/i.test(String(x.message)) ? "No account with that address exists on " + netName() + "." : "That account is not a Cautio vault, or the chain could not be read: " + friendly(x);
    return;
  }
  current = { id, state, acc };
  remember(id);
  $("#vault-empty").hidden = true; view.hidden = false;
  renderVault();
  runChecks(id, acc, state);
}

function renderVault() {
  const { id, state: s } = current;
  const held = BigInt(s.held), cap = BigInt(s.cap);
  let phase = PHASES[s.phase], next = "";
  const winEnd = BigInt(s.handover_at) + BigInt(s.claim_window_ns);
  if (s.phase === 0) next = `Next: someone pays in the deposit (up to ${fmtNear(cap)} NEAR), then the tenant declares handover.`;
  if (s.phase === 1) {
    const open = nowNs() <= winEnd;
    phase = open ? "Handed over: the landlord can file one claim" : "Handed over: window closed, no claim filed";
    next = open ? `The landlord's claim window closes in ${left(winEnd)} (${t2(winEnd)}). If no claim is filed, anyone can trigger the refund to the tenant.` : "Anyone can now trigger the refund to the tenant.";
  }
  if (s.phase === 2) next = `A claim of ${fmtNear(s.claim_amount)} NEAR is locked. Arbiter 1 rules; arbiter 2 can rule from ${t2(BigInt(s.claim_at) + BigInt(s.arbiter_sla_ns))} if arbiter 1 stays silent.`;
  if (s.phase === 3) next = "This vault is settled. The funds have been paid out by the contract rules.";
  $("#phase").textContent = phase;
  $("#next").textContent = next;
  const kv = (dl, rows) => dl.replaceChildren(...rows.flatMap(([k, v, cls]) => [el("dt", { textContent: k }), el("dd", { textContent: v, className: cls || "" })]));
  kv($("#figures"), [
    ["Held by the vault", fmtNear(held) + " NEAR", "num"],
    ["Deposit cap", fmtNear(cap) + " NEAR", "num"],
    ["Claim window", dur(s.claim_window_ns), "num"],
    ["Arbiter 2 may act after", dur(s.arbiter_sla_ns) + " of silence", "num"],
    ["Arbiter fee cap", (s.arbiter_fee_bps / 100) + "% of the locked amount", "num"],
    ["Lease terms hash", short(s.terms_hash), "addr"],
  ]);
  const yours = new Set(roleList(s));
  const label = (r, a) => a + (yours.has(r) ? "  (you)" : "");
  kv($("#parties"), [
    ["Landlord", label("landlord", s.landlord), "addr"],
    ["Tenant refund", label("tenant", s.tenant) + (s.redirected ? "  (redirected to recovery)" : ""), "addr"],
    ["Tenant recovery", label("recovery", s.recovery), "addr"],
    ["Arbiter 1", label("arbiter1", s.arbiter1), "addr"],
    ["Arbiter 2", label("arbiter2", s.arbiter2), "addr"],
  ]);
  $("#state").textContent = JSON.stringify(s, null, 2);
  $("#ics").hidden = deadlines(s).length === 0;
  renderActions();
  renderNft();
}

// ---------- actions ----------
const GAS = { fund: 20, declare_handover: 20, file_claim: 40, withdraw_claim: 40, accept_claim: 40, release: 40, rule: 40, start_recovery: 20, cancel_recovery: 20, complete_recovery: 20 };
const T12 = 10n ** 12n;
// One transaction with several actions, signed by the connected wallet or by the browser key.
async function sendTx(receiverId, specs) {
  if (acting === "wallet" && wallet) {
    const acts = specs.map((a) => a.t === "create" ? { type: "CreateAccount" }
      : a.t === "transfer" ? { type: "Transfer", params: { deposit: a.deposit.toString() } }
      : a.t === "global" ? { type: "UseGlobalContract", params: { contractIdentifier: { codeHash: a.codeHash } } }
      : { type: "FunctionCall", params: { methodName: a.method, args: a.args, gas: (BigInt(a.gas) * T12).toString(), deposit: (a.deposit || 0n).toString() } });
    const w = await connector.wallet();
    const out = await w.signAndSendTransaction({ signerId: wallet.id, receiverId, actions: acts });
    if (out && out.status && out.status.Failure) throw new Error(JSON.stringify(out.status.Failure));
    return (out.transaction && out.transaction.hash) || (out.transaction_outcome && out.transaction_outcome.id);
  }
  const acts = specs.map((a) => a.t === "create" ? actions.createAccount()
    : a.t === "transfer" ? actions.transfer(a.deposit)
    : a.t === "global" ? actions.useGlobalContract({ codeHash: a.codeHash })
    : actions.functionCall(a.method, a.args, BigInt(a.gas) * T12, a.deposit || 0n));
  const r = await signerAccount().signAndSendTransaction({ receiverId, actions: acts });
  return r.transaction.hash;
}
const callContract = (contractId, method, args, deposit, gasT) => sendTx(contractId, [{ t: "call", method, args, deposit, gas: gasT }]);
async function send(method, args, depositYocto = 0n, doneText = "Done.") {
  const msg = $("#act-msg");
  say(msg, "Sending to the network…");
  for (const b of document.querySelectorAll("#actions button")) b.disabled = true;
  try {
    const tx = await callContract(current.id, method, args, depositYocto, GAS[method]);
    msg.className = "msg";
    msg.replaceChildren(doneText + " ", el("a", { href: `${EXPLORER()}/txns/${tx}`, target: "_blank", rel: "noopener", textContent: "View transaction" }));
  } catch (x) { say(msg, friendly(x), true); }
  await loadVault(current.id, true);
}

function act(title, hint, fields, run, primary = true) {
  const form = el("form", { autocomplete: "off", className: "actform" });
  const inputs = {};
  for (const [name, label, init, kind, options] of fields) {
    const id = "a-" + name;
    const input = kind === "select"
      ? el("select", { id, name }, ...options.map(([v, t]) => el("option", { value: v, textContent: t })))
      : kind === "area" ? el("textarea", { id, name, rows: 3, required: true, placeholder: init })
      : kind === "file" ? el("input", { id, name, type: "file" })
      : el("input", { id, name, type: "text", inputMode: "decimal", value: init, required: true, autocomplete: "off" });
    inputs[name] = input;
    form.append(el("div", { className: "f" }, el("label", { htmlFor: id, textContent: label }), input));
  }
  form.append(el("button", { type: "submit", className: primary ? "primary" : "", textContent: title }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await run(inputs); } catch (x) { say($("#act-msg"), x.message, true); }
  });
  const wrap = el("div", { className: "act" });
  if (hint) wrap.append(el("p", { className: "muted hint", textContent: hint }));
  wrap.append(form);
  return wrap;
}

function renderActions() {
  const box = $("#actions"); if (!box) return;
  box.replaceChildren();
  if (!current) return;
  const s = current.state, roles = roleList(s), has = (r) => roles.includes(r);
  const held = BigInt(s.held), cap = BigInt(s.cap);
  const aid = actorId();
  const via = acting === "wallet" && wallet ? "your wallet" : "this browser";
  $("#you").textContent = !aid
    ? "No account connected. Connect a wallet or create a browser account in the Account tab to act on a vault."
    : roles.length ? `Acting as ${short(aid)} (${via}): ${roles.join(", ").replace("arbiter1", "arbiter 1").replace("arbiter2", "arbiter 2")}.` : `Acting as ${short(aid)} (${via}). You are not a named party in this vault, but anyone can pay in the deposit or trigger a refund.`;
  const winEnd = BigInt(s.handover_at) + BigInt(s.claim_window_ns);
  const winOpen = nowNs() <= winEnd;
  const needAccount = !aid;
  if (needAccount && s.phase < 3) { box.append(el("p", { className: "muted", textContent: "No actions available without an account." })); return; }

  if (s.phase === 0) {
    const room = cap - held;
    if (room > 0n) box.append(act("Pay deposit", `Anyone can pay in. Room left under the cap: ${fmtNear(room)} NEAR. The money goes into the vault and only the contract rules can move it.`, [["amt", "Amount (NEAR)", fmtNear(room), "text"]], async (i) => {
      const y = parseNear(i.amt.value); if (y <= 0n || y > room) throw new Error(`Enter an amount up to ${fmtNear(room)} NEAR.`);
      await send("fund", {}, y, "Deposit paid in.");
    }));
    if (has("tenant") && held > 0n) box.append(act("Declare handover", "Keys handed over. This starts the landlord's claim window and cannot be undone.", [], () => send("declare_handover", {}, 0n, "Handover declared; the claim window is open.")));
  }
  if (s.phase === 1) {
    if (has("landlord") && winOpen) box.append(act("File claim", "One claim, inside the window. Only the claimed amount is locked; the rest goes back to the tenant at once. Describe the move-out condition: the text or file is hashed in your browser and only the hash goes on chain.", [
      ["amt", "Claimed amount (NEAR)", fmtNear(held), "text"],
      ["kind", "Kind", "", "select", [["0", "Damage"], ["1", "Service-charge shortfall"]]],
      ["note", "Move-out report", "What was found at move-out", "area"],
      ["file", "Or a file (photos, PDF)", "", "file"],
    ], async (i) => {
      const y = parseNear(i.amt.value); if (y <= 0n || y > held) throw new Error(`The claim must be between 0 and ${fmtNear(held)} NEAR.`);
      const f = i.file.files[0];
      const hash = f ? await sha256Hex(new Uint8Array(await f.arrayBuffer())) : await sha256Hex(i.note.value.trim());
      if (!f && !i.note.value.trim()) throw new Error("Write the move-out report, or choose a file.");
      const rec = { vault: current.id, filedBy: actorId(), amountYocto: y.toString(), kind: Number(i.kind.value) === 0 ? "damage" : "service charge", reportSha256: hash, report: f ? { fileName: f.name, bytes: f.size, note: "Keep the original file: its SHA-256 must match reportSha256." } : i.note.value.trim(), createdAt: new Date().toISOString() };
      el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" })), download: `cautio-claim-${hash.slice(0, 10)}.json` }).click();
      await send("file_claim", { amount: y.toString(), kind: Number(i.kind.value), report_hash: hash }, 0n, "Claim filed. A copy of your report was downloaded: keep it, the chain holds only its hash. The undisputed rest was refunded.");
    }));
    if (!winOpen) box.append(act("Trigger refund", "The window closed with no claim. Anyone can send the deposit back to the tenant.", [], () => send("release", {}, 0n, "Refund triggered."), true));
    if (winOpen && !has("landlord")) box.append(el("p", { className: "muted", textContent: "Waiting for the claim window to close. Only the landlord can act now." }));
  }
  if (s.phase === 2) {
    if (has("tenant")) box.append(act("Accept claim", "Pay the claimed amount to the landlord and close the vault.", [], () => send("accept_claim", {}, 0n, "Claim accepted."), false));
    if (has("landlord")) box.append(act("Withdraw claim", "Drop the claim. The locked amount goes to the tenant.", [], () => send("withdraw_claim", {}, 0n, "Claim withdrawn."), false));
    const a2ok = nowNs() >= BigInt(s.claim_at) + BigInt(s.arbiter_sla_ns);
    if (has("arbiter1") || (has("arbiter2") && a2ok)) {
      const feeCap = held * BigInt(s.arbiter_fee_bps) / 10000n;
      box.append(act("Rule", `Split the locked ${fmtNear(held)} NEAR. The rest goes to the tenant. The fee cap is ${fmtNear(feeCap)} NEAR.`, [
        ["l", "To landlord (NEAR)", "0", "text"], ["fee", "Arbiter fee (NEAR)", "0", "text"],
      ], async (i) => {
        const l = parseNear(i.l.value), fee = parseNear(i.fee.value);
        if (fee > feeCap) throw new Error(`The fee cap is ${fmtNear(feeCap)} NEAR.`);
        if (l + fee > held) throw new Error("Landlord amount plus fee is more than the locked amount.");
        await send("rule", { landlord_amount: l.toString(), arbiter_fee: fee.toString() }, 0n, "Ruling recorded and paid out.");
      }));
    } else if (has("arbiter2")) box.append(el("p", { className: "muted", textContent: `Arbiter 2 can rule from ${t2(BigInt(s.claim_at) + BigInt(s.arbiter_sla_ns))}.` }));
  }
  if (s.phase < 3) {
    const recAt = BigInt(s.recovery_at), tl = BigInt(s.recovery_timelock_ns);
    if (!s.redirected && has("recovery") && recAt === 0n) box.append(act("Start recovery", `Use this if the tenant lost their key. After ${dur(tl)} with no objection you can take over the tenant's refund address. The tenant can cancel while the wait runs.`, [], () => send("start_recovery", {}, 0n, "Recovery started."), false));
    if (!s.redirected && recAt > 0n) {
      const ready = nowNs() >= recAt + tl;
      if (has("recovery")) box.append(ready
        ? act("Complete recovery", "The waiting time is over and the tenant did not cancel. Redirect the tenant's refund to the recovery account.", [], () => send("complete_recovery", {}, 0n, "Recovery complete: refunds now go to the recovery account."), false)
        : el("p", { className: "muted", textContent: `Recovery started. You can complete it in ${left(recAt + tl)}.` }));
      if (aid === s.tenant) box.append(act("Cancel recovery", `Someone started recovery of your refund address (waiting time ends ${t2(recAt + tl)}). If that is not you, cancel now.`, [], () => send("cancel_recovery", {}, 0n, "Recovery cancelled."), true));
    }
  }
  if (!box.children.length) box.append(el("p", { className: "muted", textContent: s.phase === 3 ? "Nothing more to do: this vault is settled." : "No actions for your account right now." }));
}

// ---------- checks ----------
async function runChecks(id, acc, state) {
  const out = $("#checks");
  const rows = [];
  const gh = acc.global_contract_hash || null, ga = acc.global_contract_account_id || null;
  try {
    const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: id });
    rows.push(keys.keys.length === 0 ? row("pass", "PASS", "Access keys: none. No one holds a key to this account.") : row("fail", "FAIL", `Access keys: ${keys.keys.length} found. This account is not keyless.`));
    if (gh) {
      rows.push(gh === cfg.pinnedCodeHash ? row("pass", "PASS", "Code is referenced by hash and matches the pinned Cautio hash: ", code(gh)) : (cfg.legacyCodeHashes || []).includes(gh) ? row("info", "OLDER", "Code matches an older published Cautio build (same rules; its error messages show as a generic failure): ", code(gh)) : row("fail", "FAIL", "Code hash differs from the pinned Cautio hash. Account: ", code(gh)));
      try {
        const g = await rpc("query", { request_type: "view_global_contract_code", finality: "final", code_hash: gh });
        const bin = Uint8Array.from(atob(g.code_base64), (c) => c.charCodeAt(0));
        rows.push(b58(await sha256(bin)) === gh ? row("pass", "PASS", `Published code (${bin.length} bytes) hashes to that value in your browser.`) : row("fail", "FAIL", "Published code does not hash to the referenced value."));
      } catch (x) { rows.push(row("info", "INFO", "Could not fetch the published code to re-hash it: " + x.message)); }
    } else if (ga) rows.push(row("fail", "FAIL", "Code is referenced by publisher account " + ga + ". The publisher could change it."));
    else rows.push(row("fail", "FAIL", "This account does not use a global contract by hash."));
    rows.push(row("info", "INFO", `Account balance ${fmtNear(acc.amount)} NEAR; the vault tracks ${fmtNear(state.held)} NEAR as held. The difference is the small storage buffer.`));
    const ref = (cfg.unit && id === cfg.vault) ? { unit: cfg.unit, token: cfg.token } : nftRef(id);
    if (ref) {
      try {
        const u = await rpc("query", { request_type: "view_account", finality: "final", account_id: ref.unit });
        const tok = await viewCall(ref.unit, "nft_token", { token_id: ref.token });
        rows.push(row("pass", "PASS", "Lease NFT ", code(`${ref.unit} / ${tok.token_id}`), " is owned by ", code(tok.owner_id), tok.owner_id === state.tenant ? " (the vault's tenant)." : " (not the vault's tenant)."));
        rows.push(row("info", "INFO", "Unit account runs standard NEP-171 code referenced by hash: ", code(String(u.global_contract_hash))));
      } catch (x) { rows.push(row("info", "INFO", "Could not read the lease NFT: " + x.message)); }
    }
  } catch (x) { rows.push(row("fail", "ERROR", x.message)); }
  if (current && current.id === id) out.replaceChildren(...rows);
}

// ---------- open a vault ----------
const unitNs = (n, u) => BigInt(Math.round(Number(n))) * (u === "d" ? 86_400n : 60n) * 1_000_000_000n;
const OPEN_BUFFER = 5n * 10n ** 22n; // 0.05 NEAR left in the vault as a storage buffer
async function updateOpenCost() {
  $("#open-cost").textContent = me
    ? `Cost: 0.05 NEAR goes into the vault as a storage buffer, plus a small fee, both paid by ${short(me.id)}.`
    : "You need an account first: open the Account tab and create one.";
}
for (const b of document.querySelectorAll("[data-me]")) b.addEventListener("click", () => {
  const a = actorId() || (me && me.id);
  if (!a) { say($("#open-msg"), "Connect a wallet or create an account in the Account tab first.", true); return; }
  $("#" + b.dataset.me).value = a;
});

$("#open-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  const msg = $("#open-msg"), btn = $("#open-btn");
  try {
    if (!me) throw new Error("Create an account first (Account tab). It pays the fee for opening the vault.");
    const ids = { landlord: v.landlord.trim(), tenant: v.tenant.trim(), recovery: v.recovery.trim(), arbiter1: v.arbiter1.trim(), arbiter2: v.arbiter2.trim() };
    for (const [k, a] of Object.entries(ids)) if (!validAccount(a)) throw new Error(`${k}: that is not a valid account id.`);
    if (ids.landlord === ids.tenant) throw new Error("Landlord and tenant must be different accounts.");
    if ([ids.arbiter1, ids.arbiter2].some((a) => a === ids.landlord || a === ids.tenant)) throw new Error("Arbiters must not be the landlord or the tenant.");
    if (ids.arbiter1 === ids.arbiter2) throw new Error("Arbiter 1 and arbiter 2 must be different.");
    if (ids.recovery === ids.landlord) throw new Error("The tenant's recovery account must not be the landlord.");
    const cap = parseNear(v.cap); if (cap <= 0n) throw new Error("The cap must be above zero.");
    const bps = Math.round(Number(v.fee) * 100); if (!(bps >= 0 && bps <= 1000)) throw new Error("The arbiter fee cap must be between 0 and 10 percent.");
    for (const [k, n] of [["claim window", v.window], ["arbiter wait", v.sla], ["recovery wait", v.timelock]]) if (!(Number(n) >= 1)) throw new Error(`The ${k} must be at least 1.`);
    const terms = v.terms.trim(); if (!terms) throw new Error("Paste the lease terms. Only their hash goes on chain.");
    say(msg, "Checking the accounts…"); btn.disabled = true;
    const [bal, tb, rb] = await Promise.all([getBalance(me.id), getBalance(ids.tenant), getBalance(ids.recovery)]);
    if (tb === null) throw new Error("The tenant refund account does not exist on " + netName() + " yet. A refund to a missing account would fail, so fund or create it first.");
    if (rb === null) throw new Error("The recovery account does not exist on " + netName() + " yet. Fund or create it first.");
    if (bal === null || bal < OPEN_BUFFER + 10n ** 22n) throw new Error("Your account needs at least about 0.07 NEAR. See the Account tab.");
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const doc = JSON.stringify({ lease: terms, salt, created: new Date().toISOString() });
    const termsHashHex = await sha256Hex(doc);
    const state = {
      ...ids, capYocto: cap, claimWindowNs: unitNs(v.window, v.windowUnit), arbiterSlaNs: unitNs(v.sla, v.slaUnit),
      recoveryTimelockNs: unitNs(v.timelock, v.timelockUnit), arbiterFeeBps: bps, termsHashHex,
    };
    const stateInit = new DeterministicStateInit({ code: { codeHash: cfg.pinnedCodeHash }, data: [[utf8("STATE"), encodeState(state)]] });
    const vaultId = stateInit.deriveAccountId();
    say(msg, "Creating the vault on " + netName() + "…");
    const r = await signerAccount().createDeterministicAccount({ stateInit, deposit: OPEN_BUFFER });
    const tx = r.transaction.hash;
    // the new account can lag a moment behind the transaction result
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { try { await viewCall(vaultId, "get_state"); ok = true; } catch { await new Promise((res) => setTimeout(res, 1500)); } }
    const done = $("#open-done"); done.hidden = false;
    const blob = new Blob([doc], { type: "application/json" });
    const dl = el("a", { href: URL.createObjectURL(blob), download: `cautio-terms-${vaultId.slice(0, 10)}.json`, textContent: "Download the terms file" });
    const go = el("button", { type: "button", className: "primary", textContent: "Open the vault" });
    go.addEventListener("click", () => openVault(vaultId));
    done.replaceChildren(
      el("h3", { textContent: "Vault created" }),
      el("p", { className: "addr", textContent: vaultId }),
      el("p", { className: "muted", textContent: "Keep the terms file. The chain holds only its hash; you need the exact file to prove later what was agreed. Share the vault address with the other parties." }),
      el("div", { className: "row" }, go, dl, el("a", { href: `${EXPLORER()}/txns/${tx}`, target: "_blank", rel: "noopener", textContent: "View transaction" })),
    );
    say(msg, ok ? "Done." : "Created. The network is still catching up; open the vault in a few seconds.");
  } catch (x) { say(msg, friendly(x), true); }
  btn.disabled = false;
});

// ---------- wallet ----------
function setWallet(id) {
  wallet = id ? { id } : null;
  acting = wallet ? "wallet" : "key";
  refreshAccount(); renderActions();
}
function initWallet() {
  try {
    connector = new NearConnector({ network: cfg.network === "mainnet" ? "mainnet" : "testnet" });
    connector.on("wallet:signIn", (t) => { setWallet(t.accounts[0].accountId); say($("#wallet-msg"), "Wallet connected."); });
    connector.on("wallet:signOut", () => setWallet(null));
    connector.getConnectedWallet().then((c) => { if (c && c.accounts && c.accounts[0]) setWallet(c.accounts[0].accountId); }).catch(() => {});
  } catch (x) { connector = null; say($("#wallet-msg"), "Wallet support could not start in this browser: " + x.message, true); }
}
$("#wallet-connect").addEventListener("click", async () => {
  if (!connector) return say($("#wallet-msg"), "Wallet support is not available in this browser.", true);
  try { await connector.connect(); } catch (x) { say($("#wallet-msg"), "Could not connect: " + String(x && x.message || x).slice(0, 160), true); }
});
$("#wallet-disconnect").addEventListener("click", async () => { try { await connector.disconnect(); } catch {} setWallet(null); });
$("#acting").addEventListener("change", (e) => { acting = e.target.value; renderActions(); });

$("#topup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#acct-msg");
  try {
    const y = parseNear($("#topup-amt").value); if (y <= 0n) throw new Error("Enter an amount above zero.");
    say(msg, "Waiting for your wallet…");
    const prev = acting; acting = "wallet";
    try { await sendTx(me.id, [{ t: "transfer", deposit: y }]); } finally { acting = prev; }
    say(msg, "Sent."); refreshAccount();
  } catch (x) { say(msg, friendly(x), true); }
});

$("#name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#acct-msg");
  try {
    const label = $("#name-in").value.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(label) || label.length < 6) throw new Error("Use at least 6 letters or digits (a-z, 0-9, - or _).");
    const id = label + "." + cfg.registrar;
    if ((await getBalance(id)) !== null) throw new Error(id + " is already taken. Try another name.");
    say(msg, "Creating " + id + "…");
    const kp = KeyPair.fromString(me.secret);
    await signerAccount().callFunctionRaw({ contractId: cfg.registrar, methodName: "create_account", args: { new_account_id: id, new_public_key: kp.getPublicKey().toString() }, deposit: 3n * 10n ** 23n, gas: 60n * T12 });
    me = { id, secret: me.secret }; saveMe();
    say(msg, "Created " + id + ". It now holds 0.3 NEAR from your previous address."); refreshAccount(); renderActions();
  } catch (x) { say(msg, friendly(x), true); }
});

// ---------- calendar ----------
function deadlines(s) {
  const out = [];
  if (s.phase === 1) out.push(["Cautio: landlord claim window closes", BigInt(s.handover_at) + BigInt(s.claim_window_ns), "After this the deposit can be refunded to the tenant."]);
  if (s.phase === 2) out.push(["Cautio: arbiter 2 may step in", BigInt(s.claim_at) + BigInt(s.arbiter_sla_ns), "If arbiter 1 has not ruled by now, arbiter 2 can."]);
  if (s.phase < 3 && !s.redirected && BigInt(s.recovery_at) > 0n) out.push(["Cautio: recovery waiting time ends", BigInt(s.recovery_at) + BigInt(s.recovery_timelock_ns), "The recovery account can now take over the refund address unless the tenant cancels."]);
  return out.filter(([, t]) => t > nowNs());
}
const icsTime = (ns) => new Date(Number(ns / NS)).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
$("#ics").addEventListener("click", () => {
  const link = location.origin + location.pathname + "#vault=" + current.id;
  const ev = deadlines(current.state).map(([t, ns, d], i) => ["BEGIN:VEVENT", `UID:cautio-${current.id.slice(0, 12)}-${i}-${ns}@cautio`, `DTSTAMP:${icsTime(nowNs())}`, `DTSTART:${icsTime(ns)}`, `DTEND:${icsTime(ns + 900_000_000_000n)}`, `SUMMARY:${t}`, `DESCRIPTION:${d} ${link}`, "BEGIN:VALARM", "TRIGGER:-PT24H", "ACTION:DISPLAY", `DESCRIPTION:${t}`, "END:VALARM", "END:VEVENT"].join("\r\n"));
  const txt = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cautio//EN", ...ev, "END:VCALENDAR"].join("\r\n");
  el("a", { href: URL.createObjectURL(new Blob([txt], { type: "text/calendar" })), download: "cautio-deadlines.ics" }).click();
});

// ---------- lease NFT ----------
const nftKey = (v) => "cautio.nft." + v;
function nftRef(v) { try { return JSON.parse(store.get(nftKey(v)) || "null"); } catch { return null; } }
function renderNft() {
  const card = $("#nft-card");
  if (!current || !cfg.nftCodeHash) { card.hidden = true; return; }
  const s = current.state, aid = actorId();
  const ref = (cfg.unit && current.id === cfg.vault) ? { unit: cfg.unit, token: cfg.token } : nftRef(current.id);
  const named = aid && !/^[0-9a-f]{64}$/.test(aid);
  const box = $("#nft-actions"); box.replaceChildren();
  card.hidden = false;
  if (ref) { $("#nft-text").textContent = `The lease is recorded as NFT ${ref.token} on ${ref.unit}. It names this vault and the lease-terms hash, and its owner is checked below.`; return; }
  if (aid !== s.landlord) { $("#nft-text").textContent = "No lease NFT is linked to this vault in this browser. The landlord can issue one from here."; return; }
  if (!named) { $("#nft-text").textContent = "To issue a lease NFT the landlord needs a named account (like name.testnet), because only named accounts can own unit sub-accounts. Use a wallet with a named account, or create a named account in the Account tab."; return; }
  $("#nft-text").textContent = "Optional. Creates a unit account under yours, running the standard NFT contract by hash, and mints the lease to the tenant. The NFT carries this vault's address and the terms hash. Costs about 0.13 NEAR.";
  box.append(act("Issue lease NFT", "", [["unit", "Unit name", "unit-1", "text"], ["tok", "Token id", "lease-1", "text"]], async (i) => {
    const unitLabel = i.unit.value.trim().toLowerCase(), tok = i.tok.value.trim();
    if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(unitLabel) || !tok) throw new Error("Give a unit name (letters, digits, - or _) and a token id.");
    const unit = unitLabel + "." + aid, msg = $("#nft-msg");
    if ((await getBalance(unit)) !== null) throw new Error(unit + " already exists. Pick another unit name.");
    say(msg, "Creating the unit account…");
    await sendTx(unit, [{ t: "create" }, { t: "transfer", deposit: 10n ** 23n }, { t: "global", codeHash: cfg.nftCodeHash }, { t: "call", method: "new_default_meta", args: { owner_id: aid }, gas: 30 }]);
    say(msg, "Minting the lease NFT…");
    const meta = { title: "Rental lease and caution deposit", description: "Lease record. The caution deposit sits in the keyless vault named in extra.", extra: JSON.stringify({ vault: current.id, vaultCodeHash: current.acc.global_contract_hash || null, termsHash: s.terms_hash }) };
    const tx = await sendTx(unit, [{ t: "call", method: "nft_mint", args: { token_id: tok, token_metadata: meta, token_owner_id: s.tenant }, deposit: 2n * 10n ** 22n, gas: 40 }]);
    store.set(nftKey(current.id), JSON.stringify({ unit, token: tok }));
    msg.className = "msg"; msg.replaceChildren("Lease NFT minted to the tenant. ", el("a", { href: `${EXPLORER()}/txns/${tx}`, target: "_blank", rel: "noopener", textContent: "View transaction" }));
    renderNft(); runChecks(current.id, current.acc, current.state);
  }, true));
}

// ---------- boot ----------
loadMe();
fetch("config.json").then((r) => r.json()).then((c) => {
  const want = new URLSearchParams(location.search).get("network");
  const net = c.networks && c.networks[want] ? want : c.network;
  cfg = { ...cfg, ...c.networks[net], network: net };
  $("#net-tag").textContent = cfg.label || net;
  document.title = "Cautio · " + (cfg.label || net);
  provider = new JsonRpcProvider({ url: cfg.rpc });
  if (!cfg.pinnedCodeHash) { $("#open-btn").disabled = true; say($("#open-msg"), "Cautio's contract is not published on " + net + " yet, so vaults cannot be opened here.", true); }
  initWallet();
  renderRecent();
  const m = /#vault=([a-z0-9_.\-]+)/.exec(location.hash);
  if (m) openVault(m[1]);
  else if (cfg.vault) { $("#vault-id").value = cfg.vault; }
}).catch((x) => { $("#vault-empty").textContent = "Could not load config.json: " + x.message; });
