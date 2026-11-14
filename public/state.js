// Borsh encoding of the vault's initial state, byte-for-byte what near-sdk stores under "STATE".
// Field order must match `struct Vault` in contract/src/lib.rs. Works in browsers and Node (no Buffer).
const enc = new TextEncoder();

export function u(n, bytes) {
  let v = BigInt(n);
  if (v < 0n) throw new Error("negative number");
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  if (v !== 0n) throw new Error("number too large for " + bytes + " bytes");
  return out;
}
export function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const str = (s) => { const b = enc.encode(s); return cat(u(b.length, 4), b); };
export const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const utf8 = (s) => enc.encode(s);

/** t: {landlord,tenant,recovery,arbiter1,arbiter2,capYocto,claimWindowNs,arbiterSlaNs,recoveryTimelockNs,arbiterFeeBps,termsHashHex,token?} */
export function encodeState(t) {
  if (!/^[0-9a-f]{64}$/.test(t.termsHashHex)) throw new Error("termsHashHex must be 64 hex chars");
  return cat(
    str(t.landlord), str(t.tenant), str(t.recovery), str(t.arbiter1), str(t.arbiter2),
    u(t.capYocto, 16), u(t.claimWindowNs, 8), u(t.arbiterSlaNs, 8), u(t.recoveryTimelockNs, 8),
    u(t.arbiterFeeBps, 2), fromHex(t.termsHashHex),
    // token: Borsh Option<AccountId>. None = native NEAR, Some = the NEP-141 token the deposit is paid in
    t.token ? cat(u(1, 1), str(t.token)) : u(0, 1),
    // progress fields, all zero at creation
    u(0, 1), u(0, 16), u(0, 8), u(0, 16), u(0, 1), new Uint8Array(32), u(0, 8), u(0, 8), u(0, 1),
    new Uint8Array(32), u(0, 8), new Uint8Array(32), u(0, 4), // response_hash, response_at, ruling_hash, owed (empty Vec)
  );
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? enc.encode(bytes) : bytes));
}
export const sha256Hex = async (x) => toHex(await sha256(x));

// ---- amounts ----
/** "0.25" -> smallest units (bigint) for a token with `decimals` places. Throws on anything that is not a plain decimal. */
export function parseUnits(s, decimals) {
  const m = new RegExp("^(\\d+)(?:\\.(\\d{1," + Math.max(decimals, 1) + "}))?$").exec(String(s).trim());
  if (!m || (decimals === 0 && m[2])) throw new Error("Enter an amount like 0.5");
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] || "").padEnd(decimals, "0") || "0");
}
/** smallest units -> "0.25" (trims zeros, up to 6 decimals, never rounds a non-zero amount down to 0.000000 silently). */
export function fmtUnits(y, decimals) {
  const v = BigInt(y), base = 10n ** BigInt(decimals);
  const whole = v / base, frac = decimals ? (v % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "") : "";
  if (v > 0n && whole === 0n && frac === "") return "<0." + "0".repeat(Math.min(decimals, 6) - 1) + "1";
  return frac ? `${whole}.${frac}` : String(whole);
}
export const parseNear = (s) => parseUnits(s, 24);
export const fmtNear = (y) => fmtUnits(y, 24);
