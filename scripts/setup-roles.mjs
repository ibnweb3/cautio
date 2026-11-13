// Generates throwaway testnet keys for the demo roles (implicit accounts) and funds them from the deployer.
import { writeFileSync, existsSync } from "node:fs";
import { KeyPair } from "near-api-js";
import { deployer } from "./lib/chain.mjs";
import { b58 } from "./lib/state.mjs";

if (existsSync("secrets/roles.json")) { console.log("secrets/roles.json exists, not regenerating"); process.exit(0); }
const NEAR = 10n ** 24n;
const fund = { landlord: NEAR / 20n, tenant: (NEAR * 6n) / 10n, recovery: NEAR / 100n, arbiter1: NEAR / 20n, arbiter2: NEAR / 20n };
const { account } = deployer();
const roles = {};
for (const [name, amt] of Object.entries(fund)) {
  const kp = KeyPair.fromRandom("ed25519");
  const raw = Buffer.from(kp.getPublicKey().toString().split(":")[1] ? [...kp.getPublicKey().data] : []);
  const id = raw.toString("hex");
  roles[name] = { id, secret: kp.toString() };
  const r = await account.transfer({ receiverId: id, amount: amt });
  console.log(name, id, JSON.stringify(r.status).slice(0, 40));
}
writeFileSync("secrets/roles.json", JSON.stringify(roles));
