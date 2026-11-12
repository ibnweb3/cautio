// Borsh encoding of the vault's initial state, byte-for-byte what near-sdk stores under "STATE".
// Field order must match `struct Vault` in contract/src/lib.rs.
import { createHash } from "node:crypto";

const u = (n, bytes) => {
  let v = BigInt(n);
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  if (v !== 0n) throw new Error("number too large for " + bytes + " bytes");
  return out;
};
const str = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u(b.length, 4), b]); };

/** terms: {landlord,tenant,recovery,arbiter1,arbiter2,capYocto,claimWindowNs,arbiterSlaNs,recoveryTimelockNs,arbiterFeeBps,termsHashHex} */
export function encodeState(t) {
  if (!/^[0-9a-f]{64}$/.test(t.termsHashHex)) throw new Error("termsHashHex must be 64 hex chars");
  return Buffer.concat([
    str(t.landlord), str(t.tenant), str(t.recovery), str(t.arbiter1), str(t.arbiter2),
    u(t.capYocto, 16), u(t.claimWindowNs, 8), u(t.arbiterSlaNs, 8), u(t.recoveryTimelockNs, 8),
    u(t.arbiterFeeBps, 2), Buffer.from(t.termsHashHex, "hex"),
    // progress fields, all zero at creation
    u(0, 1), u(0, 16), u(0, 8), u(0, 16), u(0, 1), Buffer.alloc(32), u(0, 8), u(0, 8), u(0, 1),
  ]);
}

/** JSON the NEAR CLI wants for `data-from-file`: base64 key -> base64 value. */
export function stateJson(t) {
  return { [Buffer.from("STATE").toString("base64")]: encodeState(t).toString("base64") };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(buf) {
  let n = BigInt("0x" + buf.toString("hex")), s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}
export const globalHash = (wasm) => b58(createHash("sha256").update(wasm).digest());

export const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
