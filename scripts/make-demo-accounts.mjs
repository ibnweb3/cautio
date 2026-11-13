// Creates the shared, throwaway testnet role accounts used by the page's demo mode and funds them from the deployer.
// Their keys are written to public/demo.json ON PURPOSE: the demo lets any visitor act as each role.
// Never put real money in these accounts. Usage: node scripts/make-demo-accounts.mjs   (refuses to overwrite)
import { writeFileSync, existsSync } from "node:fs";
import { KeyPair } from "near-api-js";
import { deployer } from "./lib/chain.mjs";

if (existsSync("public/demo.json")) { console.log("public/demo.json exists, not regenerating"); process.exit(0); }
const NEAR = 10n ** 24n;
const fund = { landlord: (NEAR * 3n) / 2n, tenant: NEAR, arbiter1: (NEAR * 3n) / 10n, arbiter2: (NEAR * 3n) / 10n, recovery: (NEAR * 3n) / 10n };
const { account } = deployer();
const accounts = {};
for (const [role, amt] of Object.entries(fund)) {
  const kp = KeyPair.fromRandom("ed25519");
  const id = Buffer.from(kp.getPublicKey().ed25519Key.data).toString("hex");
  const r = await account.transfer({ receiverId: id, amount: amt });
  accounts[role] = { id, secret: kp.toString() };
  console.log(role, id.slice(0, 10) + "…", JSON.stringify(r.status).slice(0, 30));
}
writeFileSync("public/demo.json", JSON.stringify({ note: "Throwaway testnet keys for demo mode. Public on purpose. Never hold real funds.", accounts }, null, 2));
