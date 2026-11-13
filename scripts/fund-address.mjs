// Sends testnet NEAR from the deployer to an address. Usage: node scripts/fund-address.mjs <id> <near>
import { deployer } from "./lib/chain.mjs";
const [id, near] = process.argv.slice(2);
const amt = BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n;
const { account } = deployer();
const r = await account.transfer({ receiverId: id, amount: amt });
console.log("sent", near, "NEAR to", id, "tx", r.transaction.hash);
