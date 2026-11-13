// Publishes build/opt.wasm as an immutable global contract (referenced by code hash).
import { readFileSync } from "node:fs";
import { deployer, balance } from "./lib/chain.mjs";
import { globalHash } from "./lib/state.mjs";
const wasm = readFileSync("build/opt.wasm");
const { id, account } = deployer();
console.log("code hash:", globalHash(wasm), "size:", wasm.length);
console.log("balance before:", await balance(id));
try {
  const r = await account.deployGlobalContract(new Uint8Array(wasm), "codeHash");
  console.log("status:", JSON.stringify(r.status).slice(0, 200));
  console.log("tx:", r.transaction.hash);
} catch (e) { console.log("FAILED:", String(e.message || e).slice(0, 600)); }
console.log("balance after:", await balance(id));
