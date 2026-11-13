# TenancyVault: scope

> Status at 2026-11-13: the plan below was followed except the Intents stub page (not built) and the on-chain runs of arbiter 2 and the recovery flow (unit tests only). See README and evidence/EVIDENCE.md for what actually ran.

Tracks: NFTs That Do Something + Real-World Money. Testnet only. Dev ends 2026-11-14 23:59 UTC.

## One line
A rental caution deposit sits in a NEAR account that has no access keys and runs code pinned by hash, so neither landlord nor tenant can move it. The tenant gets it back by default unless the landlord files an evidenced claim in time.

## Who it is for
Dollar-quoted rentals: diaspora-owned flats and corporate serviced apartments. Not hostels and not naira leases (round-trip conversion cost makes a dollar rail pointless for small deposits; not verified by us, from an unsourced report). Landlords must opt in. We have not verified that any landlord would.

## In
1. **Vault contract** (Rust, one global contract, referenced BY HASH). Initial state holds only: landlord, tenant refund address, tenant recovery address, arbiter 1, arbiter 2, deposit cap, token, claim window, arbiter SLA, salted hash of lease terms + move-in condition report. No names, addresses or photos on-chain. Vault address derives from that state, so the address commits to the terms.
2. **Rules**
   - Tenant (or anyone) funds the vault; address is shown only after deployment is verified.
   - Release is triggered by the tenant's "keys handed over" declaration, not by the lease end date. The claim window starts then.
   - Landlord may file a claim (amount, move-out report hash, kind = damage or service-charge shortfall). Any claim stops auto-refund; only the claimed amount stays locked, the rest refunds to the tenant at once.
   - No claim in the window: anyone can trigger refund to the tenant's fixed refund address.
   - Arbiter 1 rules; if silent past the SLA, arbiter 2 may. Ruling splits the locked amount: landlord + tenant + capped arbiter fee == locked amount, never more.
   - Zero yield, no platform fee, no admin function.
3. **Lease NFT** (NEP-171) on a unit sub-account (`unit-4b.<building>.testnet`), holding the lease terms hash and linking to the vault. Building = root account. Rental history stays on the unit/lease account.
4. **Evidence of the keyless claim**, recorded in `evidence/`: `view_access_key_list` returns zero keys for the vault; account code hash/global hash equals sha256 of our wasm; attempts to move funds from landlord and tenant accounts fail; a transfer to an undeployed deterministic address is tested and the result recorded.
5. **Web UI** (Cloudflare Worker, static assets): owner / tenant / arbiter walk-through against testnet. Labelled simulated parts.
6. **Tests** for the state machine incl. conservation rule; **README** (30-second explanation, rivals, honest limits, AI disclosure).

## Out (README "next steps", not built)
Naira and cNGN rails, VASP/tax handling; passkey/WebAuthn accounts; bonded arbiter panel; unpaid-rent claims (dropped on purpose: capped deposit cannot cover arrears, and a landlord-triggered rent claim could reward an illegal lockout); legal-grade evidence certificates and encrypted photo storage (we hash a checklist only; we claim nothing is court-admissible); lease renewal rollover; real NEAR Intents pay-in (no testnet: labelled stub; mainnet micro-test only if the user says yes); 50-100 unit pilot.

## Demo flow (5 steps)
1. Landlord creates building and unit; both sign terms + move-in report hash; vault state-init is sent and verified active.
2. Tenant pays the deposit (testnet token; Intents pay-in shown as a labelled stub).
3. Verify page: zero keys, code hash = pinned hash, landlord and tenant cannot withdraw (live RPC).
4. Tenant declares handover; landlord files a partial claim; undisputed remainder refunds immediately.
5. Arbiter rules (or SLA lapses, arbiter 2 rules); payouts shown and conservation checked.

## Verified on-chain (what the evidence folder must show)
Zero access keys; code identity by hash; funds moved only by contract rules; conservation invariant held on every settlement; deploy-before-fund behaviour.

## Cut line (1.5 days)
Must: vault + testnet deploy + evidence. Then: thin UI, tests, README. Then: NFT sub-account polish. Cut first: lease NFT extras, arbiter 2 fallback in UI, Intents stub page.

## Risks
No Rust installed (WSL Ubuntu has gcc; install there). Publishing a global contract burns NEAR (docs: about 10 NEAR per 100 KB), so the wasm must be small and the testnet faucet must give enough; unknown until tried. State-init flow is new to me.

## Identity
GitHub 0xderby (repo-local git config), isolated wrangler login under `.wrangler-home`, Cloudflare subdomain derbylabs. Public repo, sibling-project link, X post and form only after the user says yes.
