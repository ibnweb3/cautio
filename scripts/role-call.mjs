// Calls a vault method as one of the stored role accounts. Usage: node scripts/role-call.mjs <vault> <role> <method> [argsJson]
import { loadKey, accountFrom } from "./lib/chain.mjs";
const [vault, role, method, args] = process.argv.slice(2);
const r = loadKey("roles")[role];
const gas = 40n;
const out = await accountFrom(r.id, r.secret).callFunctionRaw({ contractId: vault, methodName: method, args: args ? JSON.parse(args) : {}, deposit: 0n, gas: gas * 10n ** 12n });
console.log(role, method, "ok tx", out.transaction.hash);
