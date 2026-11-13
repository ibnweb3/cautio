# Evidence (testnet)

All values below are copied from RPC responses recorded by `scripts/` (raw JSON in this folder). Network: NEAR testnet.

## 1. Code is pinned by hash
- Published once as an immutable global contract (deploy mode "code hash"). Hash: `2HRG5fYiAwTZ74iZV3P2VynPWDq8J2Eu36XYHqSoXAwM` (base58 of sha256 of `build/opt.wasm`, 128,377 bytes).
- Each vault is created with a `DeterministicStateInit` that references that hash and the terms as initial storage. The account id is derived from them.

| Vault | Account | Create tx |
|---|---|---|
| vaultA | `0s297fb7bcf0e33968377ebbb93e12bb799f444c1d` | [5p5Y1FS1…](https://testnet.nearblocks.io/txns/5p5Y1FS14Fs69mwq69B5otZoiX1UWTjRbPWtkUL8CGPd) |
| vaultB | `0s14f17e445b6526dbc728cdc6225a035d6742a3b9` | [6KjwnXnB…](https://testnet.nearblocks.io/txns/6KjwnXnBTva7ruEJgQtC1r6UpiiyDJkBXu42C1r3o5yA) |
| vaultC | `0sbe62faf670eea0865bcc7cdb7536c1b670dc81d4` | [55JuWKGx…](https://testnet.nearblocks.io/txns/55JuWKGxQNg2fgqPRkSpFX4smtTj9cRTDere5apMLqRg) |

## 2. No keys, code by hash (live RPC, vault C)
- `view_access_key_list` returned `keys: []`.
- `view_account` returned `global_contract_hash: 2HRG5fYiAwTZ74iZV3P2VynPWDq8J2Eu36XYHqSoXAwM` and `code_hash: 1111…` (no local code).
- The "Verify on testnet" tab repeats these checks in the browser and also re-hashes the published code.

## 3. Nobody can sign for the vault
- attempt: landlord's key signs a transfer FROM the vault: **rejected**. RPC said: `Access key ed25519:DSUsqYJgeMiLzwwd3iXML2w6oPozoPnk5X172YB4UdSP does not exist at block height 277436214`
- attempt: tenant's key signs a transfer FROM the vault: **rejected**. RPC said: `Access key ed25519:ExH2s18n9dCbwNqrhruuhxE5myrkaiqKExeikTuRFkDs does not exist at block height 277436214`

## 4. Claim path (vault C, run live)
Balances in NEAR. Window 300 s, arbiter SLA 90 s, cap 0.5.

| Step | Result | State read right after (phase, held) |
|---|---|---|
| landlord.declare_handover | rejected | 0, 0.000000 |
| tenant.fund | accepted [7yXcwJPP…](https://testnet.nearblocks.io/txns/7yXcwJPP9nKd1SuBaRqCM4TKoeoXyvhwpka6aqutYtbW) | 0, 0.000000 |
| landlord.release | rejected | 0, 0.400000 |
| tenant.declare_handover | accepted [49TembdF…](https://testnet.nearblocks.io/txns/49TembdFiGC5Y3M1ZMfZafFX53GHsjtArQpSkPKJUJ6a) | 0, 0.400000 |
| landlord.release | rejected | 1, 0.400000 |
| landlord.file_claim | accepted [GFTxhebz…](https://testnet.nearblocks.io/txns/GFTxhebzDVEPTPvtCTDD2j9zsZukdaL7uj4gVPsgZNjG) | 1, 0.400000 |
| arbiter2.rule | rejected | 2, 0.150000 |
| arbiter1.rule (40 TGas rerun: first try ran out of the 15 TGas prepaid) | accepted [8W6MD6ka…](https://testnet.nearblocks.io/txns/8W6MD6kaHnpY7MorHX8H8UA5USaEcncNJkzBGc7n1rfU) | 3, 0.000000 |

Phases: 0 open, 1 handed over, 2 claimed, 3 settled. The state column is read with finality "final", which lags the transaction by about one step, so it is shown as recorded but not used as proof; the settled end state (phase 3, nothing held) and the payout deltas below are what count.

Final event log: `EVENT settled landlord=100000000000000000000000 tenant=45000000000000000000000 arbiter_fee=5000000000000000000000`

Payout deltas on the ruling transaction (yoctoNEAR): landlord +100000000000000000000000, tenant +45000000000000000000000, vault -150000000000000000000000. Landlord + tenant + arbiter fee (0.005) = 0.150 = the amount the vault released.

**Known limit of this build.** Rejections show on chain as "WebAssembly trap: unreachable", not as a readable message. Each of those calls failed and the claim path then went through in the expected order, but the message is generic. Cause: the wasm was built without the `--cfg near` flag, so `env::panic_str` falls back to a plain abort. Fixing it changes the code hash, so it needs a re-publish (about 13 NEAR on testnet).

## 5. Default refund (vaults A and B)
Tenant funded 0.4 NEAR and declared handover. No claim was filed. After the window the **landlord** called `release` (they can trigger it, but it only pays the tenant):
- Vault A: [CkDKk3U9…](https://testnet.nearblocks.io/txns/CkDKk3U94uyBJ8KfJT59XeJNFK1qodgBmjabyuY7Cvbx) `EVENT settled landlord=0 tenant=400000000000000000000000 arbiter_fee=0`; tenant balance change 0.400000 NEAR.
- Vault B: [7xZwrDqG…](https://testnet.nearblocks.io/txns/7xZwrDqGxkxFfh3XGU6dghCkXaVypyTyhVMRFx6g21Ls) `EVENT settled landlord=0 tenant=400000000000000000000000 arbiter_fee=0`; tenant balance change 0.400000 NEAR.

## 6. Funds sent before the vault exists (vault B)
A plain 0.001 NEAR transfer was sent to B's derived address before it was deployed. A query straight after returned "account does not exist" (this may be RPC lag). After the state-init, the account existed with that 0.001 NEAR as balance, the pinned hash and 682 bytes of state, so the plain-NEAR transfer was not lost. This is one test with native NEAR only. Fungible-token transfers to an undeployed address were not tested, so the UI should still only show a deposit address after deployment is verified.

## 7. What is not evidenced
- Cross-chain pay-in (NEAR Intents): not built; Intents has no testnet.
- Arbiter 2 taking over after the SLA, and the recovery-address flow: covered by unit tests only, not run on chain.
- Rejections of an early `release`, a landlord `declare_handover` and an early arbiter 2 ruling are in the table above, but because of the generic trap message they show only that the call failed, not which rule fired.
- A first attempt (`discarded-first-attempt-gas-too-high.json`, `discarded-vaultB-attempt.json`) failed because my gas prepay exceeded the demo accounts' balances; those results are not used as evidence.
