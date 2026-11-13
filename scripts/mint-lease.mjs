// Mints the lease NFT on the unit sub-account to the tenant, linking the vault and the terms hash.
import { readFileSync, writeFileSync } from "node:fs";
import { accountFrom, loadKey, provider } from "./lib/chain.mjs";
const BUILDING = "derby-tv-bldg.testnet", UNIT = `unit-4b.${BUILDING}`;
const keys = loadKey("building"), roles = loadKey("roles");
const vaults = JSON.parse(readFileSync("evidence/vaults.json", "utf8"));
const bld = accountFrom(BUILDING, keys.building.secret);
const termsHashHex = "b".repeat(0) + (vaults.vaultC.termsHash || "");
const meta = {
  title: "Lease, unit 4B (demo)",
  description: "Demo lease record. The caution deposit sits in the keyless vault named in extra.",
  extra: JSON.stringify({ vault: vaults.vaultC.account, vaultCodeHash: vaults.vaultC.codeHash, termsHash: termsHashHex }),
};
const r = await bld.callFunctionRaw({ contractId: UNIT, methodName: "nft_mint", args: { token_id: "lease-4b-1", token_metadata: meta, token_owner_id: roles.tenant.id }, deposit: 2n * 10n ** 22n, gas: 40_000_000_000_000n })
  .catch((e) => { console.log("FAILED", JSON.stringify(e.transactionResult?.status || String(e.message)).slice(0, 400)); process.exit(1); });
console.log("mint tx", r.transaction.hash);
const tok = await provider.query({ request_type: "call_function", finality: "optimistic", account_id: UNIT, method_name: "nft_token", args_base64: Buffer.from(JSON.stringify({ token_id: "lease-4b-1" })).toString("base64") });
const token = JSON.parse(Buffer.from(tok.result).toString());
const ev = JSON.parse(readFileSync("evidence/unit-nft.json", "utf8"));
ev.mintTx = r.transaction.hash; ev.token = token; writeFileSync("evidence/unit-nft.json", JSON.stringify(ev, null, 2));
console.log(JSON.stringify(token).slice(0, 500));
