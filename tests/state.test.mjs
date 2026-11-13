import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicStateInit } from "near-api-js";
import { encodeState as nodeEncode, sha256hex, globalHash } from "../scripts/lib/state.mjs";
import { encodeState, sha256Hex, b58, sha256, parseNear, fmtNear } from "../public/state.js";
import { readFileSync } from "node:fs";

const terms = {
  landlord: "landlord.testnet", tenant: "tenant.testnet", recovery: "recovery.testnet",
  arbiter1: "arb1.testnet", arbiter2: "arb2.testnet",
  capYocto: 5n * 10n ** 23n, claimWindowNs: 120n * 10n ** 9n, arbiterSlaNs: 90n * 10n ** 9n,
  recoveryTimelockNs: 120n * 10n ** 9n, arbiterFeeBps: 500,
  termsHashHex: sha256hex("some lease text"),
};

test("browser encoder matches the Node encoder byte for byte", () => {
  assert.deepEqual(Buffer.from(encodeState(terms)), nodeEncode(terms));
});
test("browser sha256 matches Node sha256", async () => {
  assert.equal(await sha256Hex("some lease text"), terms.termsHashHex);
});
test("published code hash matches the pinned hash", async () => {
  const wasm = readFileSync(new URL("../build/opt.wasm", import.meta.url));
  assert.equal(b58(await sha256(new Uint8Array(wasm))), globalHash(wasm));
  assert.equal(globalHash(wasm), "2HRG5fYiAwTZ74iZV3P2VynPWDq8J2Eu36XYHqSoXAwM");
});
test("same vault address from Uint8Array and Buffer state", () => {
  const hash = "2HRG5fYiAwTZ74iZV3P2VynPWDq8J2Eu36XYHqSoXAwM";
  const a = new DeterministicStateInit({ code: { codeHash: hash }, data: [[Buffer.from("STATE"), nodeEncode(terms)]] }).deriveAccountId();
  const b = new DeterministicStateInit({ code: { codeHash: hash }, data: [[new TextEncoder().encode("STATE"), encodeState(terms)]] }).deriveAccountId();
  assert.equal(a, b);
  assert.match(a, /^0s[0-9a-f]{40}$/);
});
test("amount parsing and formatting", () => {
  assert.equal(parseNear("0.5"), 5n * 10n ** 23n);
  assert.equal(fmtNear(5n * 10n ** 23n), "0.5");
  assert.equal(fmtNear(0n), "0");
  assert.equal(fmtNear(1n), "<0.000001");
  assert.throws(() => parseNear("abc"));
  assert.throws(() => parseNear("-1"));
});
