import { SimVault, PHASE, DAY, parseNear } from "./sim.js";

const $ = (s) => document.querySelector(s);
const milli = (x) => (Number(x) / 1000).toFixed(3) + " NEAR";
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
};

let cfg = { rpc: "https://test.rpc.fastnear.com", pinnedCodeHash: "", vault: null };
// ---------- tabs ----------
const tabs = ["sim", "ver", "how"];
let verifyAuto = false;
function showTab(id) {
  for (const t of tabs) {
    $("#tab-" + t).setAttribute("aria-selected", String(t === id));
    $("#panel-" + t).hidden = t !== id;
  }
  try { sessionStorage.setItem("tab", id); } catch {}
  if (id === "ver" && !verifyAuto && cfg.vault) { verifyAuto = true; $("#verify-form").requestSubmit(); }
}
for (const t of tabs) $("#tab-" + t).addEventListener("click", () => showTab(t));
try { const s = sessionStorage.getItem("tab"); if (tabs.includes(s)) showTab(s); } catch {}

// ---------- simulator ----------
let vault, role = "anyone";
const newVault = () => { vault = new SimVault({}); $("#err").textContent = ""; $("#log").replaceChildren(el("li", { className: "muted", textContent: "Nothing yet. Start by paying the deposit as anyone, then act as the tenant." })); render(); };

function field(label, name, type, value, extra = {}) {
  const id = "f-" + name + "-" + Math.random().toString(36).slice(2, 6);
  const input = type === "select"
    ? el("select", { id, name }, ...extra.options.map((o) => el("option", { value: o, textContent: o })))
    : el("input", { id, name, type, value, min: "0", step: "1", inputMode: "decimal", required: true, autocomplete: "off" });
  return el("div", { className: "f" }, el("label", { htmlFor: id, textContent: label }), input);
}
function action(title, hint, fields, run, primary = true) {
  const form = el("form", { autocomplete: "off" });
  for (const f of fields) form.append(f);
  const btn = el("button", { type: "submit", className: primary ? "primary" : "", textContent: title });
  form.append(btn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try { run(data); $("#err").textContent = ""; } catch (x) { $("#err").textContent = x.message; }
    render();
  });
  const wrap = el("div", { className: "act" });
  if (hint) wrap.append(el("p", { className: "muted", textContent: hint, style: "margin:0 0 6px" }));
  wrap.append(form);
  return wrap;
}
const big = parseNear;

function renderActions() {
  const box = $("#actions"); box.replaceChildren();
  const v = vault;
  if (role === "anyone") {
    box.append(action("Pay deposit", "Anyone can pay the deposit in, up to the cap (1 NEAR in this demo). Amounts are in NEAR.", [field("Amount (NEAR)", "amt", "text", "1")], (d) => v.fund(big(d.amt))));
    box.append(action("Trigger refund", "After the window closes with no claim, anyone can send the deposit back to the tenant.", [], () => v.release(), false));
  }
  if (role === "tenant") {
    box.append(action("Declare handover", "Keys handed over. Starts the landlord's claim window.", [], () => v.declareHandover("tenant")));
    box.append(action("Accept claim", "Pay the claimed amount to the landlord and close.", [], () => v.acceptClaim("tenant"), false));
  }
  if (role === "landlord") {
    box.append(action("File claim", "One claim, inside the window, up to the held amount. Only that amount is locked; the rest goes back to the tenant at once.", [field("Amount (NEAR)", "amt", "text", "0.3"), field("Kind", "kind", "select", "", { options: ["damage", "service charge"] })], (d) => v.fileClaim("landlord", big(d.amt), d.kind)));
    box.append(action("Withdraw claim", "Drop the claim; the locked amount goes to the tenant.", [], () => v.withdrawClaim("landlord"), false));
  }
  if (role === "arbiter1" || role === "arbiter2") {
    const cap = v.phase === 2 ? `Fee cap right now: ${(Number(v.feeCap()) / 1000).toFixed(3)} NEAR (5% of the locked amount).` : "No claim to rule on yet.";
    box.append(action("Rule", `Split the locked amount. The rest goes to the tenant. ${cap} Arbiter 2 can only act 5 days after the claim.`, [field("To landlord (NEAR)", "l", "text", "0.15"), field("Arbiter fee (NEAR)", "fee", "text", "0.01")], (d) => v.rule(role, big(d.l), big(d.fee))));
  }
}

function render() {
  const v = vault;
  $("#phase").textContent = PHASE[v.phase];
  $("#held").textContent = milli(v.held);
  $("#cap").textContent = milli(v.t.cap);
  $("#day").textContent = "Day " + Math.floor(v.now / DAY);
  $("#win").textContent = v.phase === 1 ? (v.now > v.handoverAt + v.t.claimWindow ? "closed" : Math.ceil((v.handoverAt + v.t.claimWindow - v.now) / DAY) + " day(s) left") : v.phase === 0 ? "7 days after handover" : "n/a";
  for (const k of ["landlord", "tenant", "arbiter"]) $("#p-" + k).textContent = milli(v.paid[k]);
  const log = $("#log");
  if (v.log.length) log.replaceChildren(...v.log.map((e) => el("li", { textContent: `Day ${Math.floor(e.at / DAY)}: ${e.m}` })));
  renderActions();
}
$("#roles").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-role]"); if (!b) return;
  role = b.dataset.role;
  for (const x of $("#roles").children) x.setAttribute("aria-checked", String(x === b));
  $("#err").textContent = ""; renderActions();
});
for (const b of document.querySelectorAll("[data-adv]")) b.addEventListener("click", () => { vault.advance(Number(b.dataset.adv) * DAY); render(); });
$("#reset").addEventListener("click", newVault);
newVault();

// ---------- live verifier ----------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (bytes) => {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
};

fetch("config.json").then((r) => r.json()).then((c) => {
  cfg = c;
  if (c.vault) { $("#vault-id").value = c.vault; $("#ver-hint").textContent = "A vault that has already run a full claim and arbiter ruling on testnet. Paste any other vault account to check it."; if (!$("#panel-ver").hidden) { verifyAuto = true; $("#verify-form").requestSubmit(); } }
  else $("#ver-hint").textContent = "No demo vault is configured in this build yet.";
}).catch(() => { $("#ver-hint").textContent = "Could not load config.json."; });

async function rpc(method, params) {
  const r = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.data || j.error.message || "RPC error");
  if (j.result && j.result.error) throw new Error(j.result.error);
  return j.result;
}
const row = (cls, tag, ...kids) => el("li", {}, el("span", { className: "tag " + cls, textContent: tag }), el("span", {}, ...kids));
const code = (t) => el("code", { textContent: t });

$("#verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#vault-id").value.trim();
  const btn = $("#verify-btn"); btn.disabled = true; btn.textContent = "Checking";
  const out = $("#checks"); out.replaceChildren(row("info", "...", "Reading the chain."));
  const rows = [];
  try {
    const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
    const gh = acc.global_contract_hash || null, ga = acc.global_contract_account_id || null;
    rows.push(row("info", "INFO", "Account state: ", code(JSON.stringify({ code_hash: acc.code_hash, global_contract_hash: gh, global_contract_account_id: ga }))));
    const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: id });
    rows.push(keys.keys.length === 0
      ? row("pass", "PASS", "Access keys: none. No one holds a key to this account.")
      : row("fail", "FAIL", `Access keys: ${keys.keys.length} found. This account is not keyless.`));
    if (gh) {
      rows.push(gh === cfg.pinnedCodeHash
        ? row("pass", "PASS", "Code is referenced by hash and matches the pinned TenancyVault hash: ", code(gh))
        : row("fail", "FAIL", "Code hash differs from the pinned TenancyVault hash. Account: ", code(gh), " pinned: ", code(cfg.pinnedCodeHash)));
      try {
        const g = await rpc("query", { request_type: "view_global_contract_code", finality: "final", code_hash: gh });
        const bin = Uint8Array.from(atob(g.code_base64), (c) => c.charCodeAt(0));
        const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", bin));
        rows.push(b58(sha) === gh
          ? row("pass", "PASS", `Published code (${bin.length} bytes) hashes to that value, so the code cannot differ from what is pinned.`)
          : row("fail", "FAIL", "Published code does not hash to the referenced value."));
      } catch (x) { rows.push(row("info", "INFO", "Could not fetch the published code to re-hash it: " + x.message)); }
    } else if (ga) {
      rows.push(row("fail", "FAIL", "Code is referenced by publisher account " + ga + ". The publisher could change it. Not safe."));
    } else {
      rows.push(row("fail", "FAIL", "This account does not use a global contract by hash."));
    }
    const st = await rpc("query", { request_type: "call_function", finality: "final", account_id: id, method_name: "get_state", args_base64: btoa("{}") });
    const state = JSON.parse(new TextDecoder().decode(Uint8Array.from(st.result)));
    rows.push(row("pass", "PASS", "get_state answered, so the contract is running."));
    $("#state").textContent = JSON.stringify(state, null, 2);
    rows.push(row("info", "INFO", `Balance ${acc.amount} yoctoNEAR on the account; the vault tracks ${state.held} yoctoNEAR as held.`));
    if (cfg.unit && id === cfg.vault) {
      try {
        const u = await rpc("query", { request_type: "view_account", finality: "final", account_id: cfg.unit });
        const t = await rpc("query", { request_type: "call_function", finality: "final", account_id: cfg.unit, method_name: "nft_token", args_base64: btoa(JSON.stringify({ token_id: cfg.token })) });
        const tok = JSON.parse(new TextDecoder().decode(Uint8Array.from(t.result)));
        rows.push(row("pass", "PASS", "Lease NFT ", code(`${cfg.unit} / ${tok.token_id}`), " is owned by ", code(tok.owner_id), tok.owner_id === state.tenant ? " (the vault's tenant)." : " (not the vault's tenant)."));
        rows.push(row("info", "INFO", "Unit account runs standard NEP-171 code referenced by hash: ", code(String(u.global_contract_hash)), ". Link back to the vault, from the NFT metadata: ", code(tok.metadata.extra)));
      } catch (x) { rows.push(row("info", "INFO", "Could not read the lease NFT: " + x.message)); }
    }
  } catch (x) {
    rows.push(row("fail", "ERROR", x.message));
    $("#state").textContent = "No state read.";
  }
  out.replaceChildren(...rows);
  btn.disabled = false; btn.textContent = "Check";
});
