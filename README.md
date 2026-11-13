# Cautio

A rental caution deposit that nobody can move by hand. It sits in a NEAR account with **no access keys**, running code that is referenced **by hash**. The tenant gets it back by default. The landlord can keep part of it only by filing a claim inside a fixed window, and an arbiter named in the lease settles disputes.

Built for NEAR HACKATHON. (Renamed from "TenancyVault" before submission. The on-chain accounts, vaults and published code predate the rename and keep their addresses; the Rust crate in `contract/` is still called `tenancy-vault`.) Tracks: NFTs That Do Something, Real-World Money. **Testnet only.**

Live demo: https://cautio.ibnweb3lab.workers.dev (testnet).

## Second entry by the same author

NEAR HACKATHON allows one person two independent, disclosed projects. This is one; the other is **WellKeep**, a keyless repair fund for community water points: https://github.com/ibnweb3/wellkeep. It is a separate repository with its own contract and deployment.

Commits dated up to 2026-11-13 are authored by the GitHub account `0xderby`, a second account of the same author, because this project was started under it. The repository was then moved here and the old copy made private.

## The problem in 30 seconds

Today the landlord holds the caution deposit. Getting it back after move-out is often slow or disputed, and the tenant has little leverage. Cautio takes the landlord's hands off the money:

1. Both sides agree the lease terms and a move-in condition report. Only a salted **hash** of them goes on chain (no names, addresses or photos).
2. The deposit is paid into a vault account. Nobody holds a key to it.
3. At move-out the tenant declares handover. The landlord then has a fixed window to file **one** claim.
4. No claim: the deposit goes back to the tenant (anyone can trigger it). A claim: only the claimed amount stays locked; the rest goes back at once.
5. The arbiter splits the locked amount. A second arbiter can step in if the first is silent. Payouts always sum to exactly the amount held.

## Try it (what to do, what you should see)

| Do | See |
|---|---|
| `npm test` | 8 simulator tests pass |
| `cd contract && cargo test` (needs Rust) | 20 contract tests pass |
| Open the site (or `python -m http.server -d public` and open the page), tab **Walk-through**: pay deposit as Anyone, declare handover as Tenant, file a 300 claim as Landlord, rule as Arbiter 1 | log shows every step; payouts add up to the amount held |
| Tab **Verify live** and press Check | live RPC checks: no access keys, code referenced by hash and re-hashed in your browser, `get_state`, and the lease NFT |
| Read [`evidence/EVIDENCE.md`](evidence/EVIDENCE.md) | transaction links for the live runs |

The Walk-through tab is a **simulation** of the same rules in your browser (fake money). The Verify tab is **live testnet**.

## What is live on testnet

- Contract published as an immutable global contract. Code hash `2HRG5fYiAwTZ74iZV3P2VynPWDq8J2Eu36XYHqSoXAwM` (sha256 of [`build/opt.wasm`](build/opt.wasm)).
- Three vaults created with `DeterministicStateInit` (keyless accounts whose address is derived from the code hash and the terms). Vault C, `0sbe62faf670eea0865bcc7cdb7536c1b670dc81d4`, ran the full claim and arbiter path. Vaults A and B ran the default-refund path.
- Building root account `derby-tv-bldg.testnet`, unit sub-account `unit-4b.derby-tv-bldg.testnet`, and a lease NFT (`lease-4b-1`) owned by the tenant. Its metadata names the vault and terms hash.

See [`evidence/EVIDENCE.md`](evidence/EVIDENCE.md) for what was checked and what was not.

## How NEAR is used

- **Deterministic (keyless) accounts**: the vault is created by a `DeterministicStateInit` action. It has no access keys, and its address is derived from the code reference and the initial storage. The terms are in that storage, so the address commits to the terms.
- **Global contracts by hash**: the vault code is referenced by hash, so no publisher account can swap it. (A reference by publisher account could be updated by the publisher, so we do not use that.)
- **Nested named accounts**: a building is a root account and each unit is a sub-account.
- **NEP-171**: the unit sub-account runs a standard NFT contract (the testnet `nft.globals.primitives.testnet` code, referenced by its hash) and holds the lease NFT.

## Why NEAR, honestly

Refund-by-default escrow can be written on other chains, and the projects above did. We do not claim NEAR is the only place this could run. What NEAR adds:

- **Keyless is a checkable property.** The vault is a deterministic account created from a code hash plus its terms. One RPC call shows it has zero keys and which code it runs.
- **One published copy of the code.** Each vault references the global contract by hash, so a new vault is cheap after the one-time publish (12.84 testnet NEAR for our 128 KB wasm).
- **Named nested accounts** fit buildings and units: `unit-4b.<building>`.
- **Intents pay-in** (not built) is where NEAR's cross-chain feature would matter most.

## Other on-chain rental-deposit projects, and what is different

Found by web search on 2026-11-12 from their own pages and papers; we have not tested them: **Trustless Work** (Stellar, used by the SafeTrust co-living platform), **Rentible** (Solidity, test deployment), **RxEAL** (Ethereum), **DeWork** (ETHGlobal Taipei prototype), **zk-Agreements** (arXiv). As far as we saw, they settle by mutual sign-off or an oracle or approver.

What Cautio does differently:

- The vault has **no admin and no keys**: code by hash, no upgrade path.
- **Refund by default**: silence from the landlord means the tenant is paid, and only the claimed part is ever locked.
- **Handover-triggered**: the window starts when the tenant declares handover, not at the lease end date, so a holdover tenant cannot trigger a refund just by waiting.
- **Unit sub-account naming**: `unit-4b.<building>` with the lease NFT.
- Payouts are checked by construction to sum to the amount held.

We did not build NEAR Intents pay-in (see below), so that part of the idea is not yet different from anyone.

## Honest limits

- **Testnet only.** The deposit is testnet NEAR. No mainnet funds were used.
- **No naira rail.** NEAR's docs have no fiat on-ramp or naira support that we found. This is meant for dollar-quoted rentals (for example diaspora-owned or corporate flats). How common those are, we have not verified.
- **Disputes still need a human arbiter.** An arbiter can be wrong or bribed. The contract only limits what an arbiter can do: split the locked amount, with a capped fee.
- **Landlords must opt in.** We have not verified that any would.
- **Not a court.** This is a private contract between the parties. We have not checked how Nigerian courts would treat it, nor any tax or licensing duties that apply to holding or converting crypto in Nigeria. Get local legal advice before real use.
- **Evidence hashes are not proof of truth.** A condition-report hash shows the document existed unchanged, not that it is accurate.
- **Panic messages are generic.** Rejected calls show on chain as "WebAssembly trap: unreachable", not a readable reason, because the wasm was built without the `--cfg near` flag. Rejections still fail correctly. Fixing it changes the code hash and needs a re-publish (about 13 testnet NEAR).
- **Fixed address, no storage top-up.** A vault's balance must stay above NEAR's storage minimum. We send a small plain-NEAR buffer to each vault before use.
- **Refund address must exist.** If the tenant's refund account does not exist, a payout transfer would fail and the money would stay in the vault. The refund address is fixed at creation.
- **The lease NFT is a standard contract.** It points to the vault, but nothing on chain makes the vault check the NFT. Rental history "travelling with the tenant" is not built.
- **Recovery address and arbiter 2** are covered by unit tests only, not run on chain.

## Not built

NEAR Intents pay-in from other chains (Intents has no testnet and we did not spend mainnet funds), naira or cNGN rails, passkey accounts, a bonded arbiter panel, unpaid-rent claims (dropped on purpose: a capped deposit cannot cover arrears, and a landlord-triggered rent claim could reward an illegal lockout), encrypted condition-report storage, lease renewal.

## Files

- `contract/`: the Rust contract and its 20 unit tests.
- `public/`: the web app (static). `sim.js` mirrors the contract rules; `app.js` runs the live checks.
- `scripts/`: publish, create vault, run the flows, build the evidence report. They need a funded testnet key in `secrets/` (gitignored).
- `build/opt.wasm`: the published code. `evidence/`: recorded chain responses.

## Rebuild the contract

Rust nightly with `rust-src`, target `wasm32-unknown-unknown`, then `scripts/build.sh` (uses `-Z build-std` and `target-cpu=mvp` so the wasm uses only features NEAR accepts), then `wasm-opt --mvp-features -Oz`. On 2026-11-13 a fresh rebuild with these steps (Rust 1.100 nightly, binaryen 125) reproduced the published hash `2HRG5f…` exactly. A different toolchain will likely give a different hash.

## AI disclosure

Built with Claude Code (Claude Sonnet 5.5) working with the human author. The AI wrote the contract, tests, scripts and web app, and ran the testnet transactions. All claims about chain behaviour come from the recorded RPC responses in `evidence/`. No third-party code is copied; dependencies are `near-sdk` (Rust), `near-api-js`, and the NEAR CLI for offline address derivation.

## Licence

MIT, see [LICENSE](LICENSE).

Background photo: "Ikoyi, Lagos, Nigeria" by Reginald Bassey, [CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Ikoyi,_Lagos,_Nigeria.jpg), resized, in `public/lagos.jpg`. The page layout borrows the calm full-image-and-floating-cards approach of Econia (econia-production.up.railway.app); no code or assets were copied.
