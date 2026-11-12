// Writes build/state.json for the demo vault. Usage: node scripts/demo-terms.mjs <landlord> <tenant> <recovery> <arb1> <arb2> [salt]
import { writeFileSync, readFileSync } from "node:fs";
import { stateJson, globalHash, sha256hex } from "./lib/state.mjs";
const [landlord, tenant, recovery, arbiter1, arbiter2, salt = "demo-1"] = process.argv.slice(2);
const termsDoc = JSON.stringify({ lease: "demo 12-month lease, unit 4B", reportOnMoveIn: "checklist v1", salt });
const t = {
  landlord, tenant, recovery, arbiter1, arbiter2,
  capYocto: 1_000_000_000_000_000_000_000_000n, // 1 NEAR cap for the testnet demo
  claimWindowNs: 120n * 1_000_000_000n,     // 120 s for the demo; real leases would use days
  arbiterSlaNs: 90n * 1_000_000_000n,
  recoveryTimelockNs: 120n * 1_000_000_000n,
  arbiterFeeBps: 500,
  termsHashHex: sha256hex(termsDoc),
};
writeFileSync("build/state.json", JSON.stringify(stateJson(t), null, 2));
console.log("global hash", globalHash(readFileSync("build/opt.wasm")), "terms hash", t.termsHashHex);
