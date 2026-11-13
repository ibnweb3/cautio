import { Account, JsonRpcProvider, KeyPairSigner, KeyPair, DeterministicStateInit } from "./near.bundle.js";
import { encodeState, b58, sha256Hex, sha256, utf8, parseNear, fmtNear, toHex } from "./state.js";

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
const EXPLORER = "https://testnet.nearblocks.io";
const NS = 1_000_000n; // ns per millisecond
const PHASES = ["Open: waiting for the deposit", "Handed over: landlord's claim window", "Claim filed: waiting for the arbiter", "Settled"];

let cfg = { rpc: "https://test.rpc.fastnear.com", pinnedCodeHash: "", vault: null };
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
const signerAccount = () => new Account(me.id, provider, new KeyPairSigner(KeyPair.fromString(me.secret)));
const short = (s) => (s.length > 22 ? s.slice(0, 10) + "…" + s.slice(-8) : s);
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const validAccount = (s) => s.length >= 2 && s.length <= 64 && ACCOUNT_RE.test(s);
function friendly(e) {
  const m = String(e && e.message || e);
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
  $("#acct-none").hidden = !!me; $("#acct-have").hidden = !me;
  if (!me) return;
  $("#acct-id").textContent = me.id;
  const b = await getBalance(me.id);
  $("#acct-bal").textContent = b === null ? "0 NEAR (account does not exist on testnet yet)" : fmtNear(b) + " NEAR";
  $("#acct-hint").textContent = b === null || b < 10n ** 23n
    ? "This account is empty. Send testnet NEAR to the address above from a testnet faucet or any funded testnet account. About 0.2 NEAR is enough to open a vault and make several calls."
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
  if (!me) return [];
  const r = [];
  if (me.id === s.landlord) r.push("landlord");
  if (me.id === (s.redirected ? s.recovery : s.tenant)) r.push("tenant");
  if (me.id === s.recovery) r.push("recovery");
  if (me.id === s.arbiter1) r.push("arbiter1");
  if (me.id === s.arbiter2) r.push("arbiter2");
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
    $("#vault-empty").textContent = /does not exist/i.test(String(x.message)) ? "No account with that address exists on testnet." : "That account is not a Cautio vault, or the chain could not be read: " + friendly(x);
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
  renderActions();
}

// ---------- actions ----------
const GAS = { fund: 20, declare_handover: 20, file_claim: 40, withdraw_claim: 40, accept_claim: 40, release: 40, rule: 40 };
async function send(method, args, depositYocto = 0n, doneText = "Done.") {
  const msg = $("#act-msg");
  say(msg, "Sending to the network…");
  for (const b of document.querySelectorAll("#actions button")) b.disabled = true;
  try {
    const r = await signerAccount().callFunctionRaw({ contractId: current.id, methodName: method, args, deposit: depositYocto, gas: BigInt(GAS[method]) * 10n ** 12n });
    const tx = r.transaction.hash;
    msg.className = "msg";
    msg.replaceChildren(doneText + " ", el("a", { href: `${EXPLORER}/txns/${tx}`, target: "_blank", rel: "noopener", textContent: "View transaction" }));
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
  $("#you").textContent = !me
    ? "You have no account yet. Create one in the Account tab to act on a vault."
    : roles.length ? `You are signed in as ${short(me.id)}: ${roles.join(", ").replace("arbiter1", "arbiter 1").replace("arbiter2", "arbiter 2")}.` : `You are signed in as ${short(me.id)}. You are not a named party in this vault, but anyone can pay in the deposit or trigger a refund.`;
  const winEnd = BigInt(s.handover_at) + BigInt(s.claim_window_ns);
  const winOpen = nowNs() <= winEnd;
  const needAccount = !me;
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
      await send("file_claim", { amount: y.toString(), kind: Number(i.kind.value), report_hash: hash }, 0n, "Claim filed. The undisputed rest was refunded.");
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
      rows.push(gh === cfg.pinnedCodeHash ? row("pass", "PASS", "Code is referenced by hash and matches the pinned Cautio hash: ", code(gh)) : row("fail", "FAIL", "Code hash differs from the pinned Cautio hash. Account: ", code(gh)));
      try {
        const g = await rpc("query", { request_type: "view_global_contract_code", finality: "final", code_hash: gh });
        const bin = Uint8Array.from(atob(g.code_base64), (c) => c.charCodeAt(0));
        rows.push(b58(await sha256(bin)) === gh ? row("pass", "PASS", `Published code (${bin.length} bytes) hashes to that value in your browser.`) : row("fail", "FAIL", "Published code does not hash to the referenced value."));
      } catch (x) { rows.push(row("info", "INFO", "Could not fetch the published code to re-hash it: " + x.message)); }
    } else if (ga) rows.push(row("fail", "FAIL", "Code is referenced by publisher account " + ga + ". The publisher could change it."));
    else rows.push(row("fail", "FAIL", "This account does not use a global contract by hash."));
    rows.push(row("info", "INFO", `Account balance ${fmtNear(acc.amount)} NEAR; the vault tracks ${fmtNear(state.held)} NEAR as held. The difference is the small storage buffer.`));
    if (cfg.unit && id === cfg.vault) {
      try {
        const u = await rpc("query", { request_type: "view_account", finality: "final", account_id: cfg.unit });
        const tok = await viewCall(cfg.unit, "nft_token", { token_id: cfg.token });
        rows.push(row("pass", "PASS", "Lease NFT ", code(`${cfg.unit} / ${tok.token_id}`), " is owned by ", code(tok.owner_id), tok.owner_id === state.tenant ? " (the vault's tenant)." : " (not the vault's tenant)."));
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
  if (!me) { say($("#open-msg"), "Create an account in the Account tab first.", true); return; }
  $("#" + b.dataset.me).value = me.id;
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
    if (tb === null) throw new Error("The tenant refund account does not exist on testnet yet. A refund to a missing account would fail, so fund or create it first.");
    if (rb === null) throw new Error("The recovery account does not exist on testnet yet. Fund or create it first.");
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
    say(msg, "Creating the vault on testnet…");
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
      el("div", { className: "row" }, go, dl, el("a", { href: `${EXPLORER}/txns/${tx}`, target: "_blank", rel: "noopener", textContent: "View transaction" })),
    );
    say(msg, ok ? "Done." : "Created. The network is still catching up; open the vault in a few seconds.");
  } catch (x) { say(msg, friendly(x), true); }
  btn.disabled = false;
});

// ---------- boot ----------
loadMe();
fetch("config.json").then((r) => r.json()).then((c) => {
  cfg = c;
  provider = new JsonRpcProvider({ url: cfg.rpc });
  renderRecent();
  const m = /#vault=([a-z0-9_.\-]+)/.exec(location.hash);
  if (m) openVault(m[1]);
  else if (cfg.vault) { $("#vault-id").value = cfg.vault; }
}).catch(() => { $("#vault-empty").textContent = "Could not load config.json."; });
