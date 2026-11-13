// Building = named root account; unit = nested named sub-account running a standard NEP-171 contract
// (referenced BY HASH from an existing testnet global contract) that holds the lease NFT.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { KeyPair } from "near-api-js";
import { deployer, accountFrom, loadKey, provider } from "./lib/chain.mjs";

const BUILDING = "derby-tv-bldg.testnet";
const UNIT = `unit-4b.${BUILDING}`;
const NFT_HASH = "ivu1e9obVRnMJLSvVPRgtYefUYUS1L3f5eYHjS86zL9"; // sha256 of nft.globals.primitives.testnet's code at 2026-11-13
const NEAR = 10n ** 24n;
const out = existsSync("evidence/unit-nft.json") ? JSON.parse(readFileSync("evidence/unit-nft.json", "utf8")) : {};
const save = () => writeFileSync("evidence/unit-nft.json", JSON.stringify(out, null, 2));
const say = (k, r) => { out[k] = r.transaction?.hash || r; save(); console.log(k, r.transaction?.hash || r); };

let keys = existsSync("secrets/building.json") ? JSON.parse(readFileSync("secrets/building.json", "utf8")) : null;
if (!keys) {
  const b = KeyPair.fromRandom("ed25519"), u = KeyPair.fromRandom("ed25519");
  keys = { building: { secret: b.toString(), public: b.getPublicKey().toString() }, unit: { secret: u.toString(), public: u.getPublicKey().toString() } };
  writeFileSync("secrets/building.json", JSON.stringify(keys));
}
const { account: dep } = deployer();
let exists = async (id) => provider.query({ request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);

if (!(await exists(BUILDING))) {
  say("createBuilding", await dep.callFunctionRaw({ contractId: "testnet", methodName: "create_account", args: { new_account_id: BUILDING, new_public_key: keys.building.public }, deposit: NEAR / 5n, gas: 60_000_000_000_000n }));
}
const bld = accountFrom(BUILDING, keys.building.secret);
if (!(await exists(UNIT))) {
  say("createUnit", await bld.createAccount({ newAccountId: UNIT, publicKey: keys.unit.public, nearToTransfer: NEAR / 10n }));
}
const unit = accountFrom(UNIT, keys.unit.secret);
say("useGlobalNft", await unit.useGlobalContract({ codeHash: NFT_HASH }));
say("init", await unit.callFunctionRaw({ contractId: UNIT, methodName: "new_default_meta", args: { owner_id: BUILDING }, gas: 30_000_000_000_000n }));
