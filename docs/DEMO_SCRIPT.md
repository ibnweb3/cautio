# Cautio: demo voiceover and X post (draft, not recorded, not posted)

Length target: about 2:30 spoken at a calm pace (about 360 words). One uncut voiceover; the screen recording follows it.
Every claim below was checked against the live testnet run (`evidence/live-e3.md`). Do not add claims beyond these.

## Voiceover (v2: story opening, NEAR tech up front)

The story is an illustration, told as a story. It is not a real person or a real case.

**[0:00, hero page]**
Picture Tolu, a tenant in Lagos. She pays a one-million-naira caution deposit and moves in. A year later she hands back the keys, and the landlord says the wall is damaged. Weeks pass. The deposit is gone, and what it could have bought a year ago, it can't buy now. Cautio is built so that story ends differently.

**[0:25, Vaults tab, "Try the demo" card]**
Here is what NEAR makes possible. The deposit sits in an account created with NEAR's deterministic state init, so it is born with no access keys at all. Not the landlord, not the tenant, not us can take the money out. Its code is a NEAR global contract, referenced by hash, so anyone can check that it is exactly the published code. And the deposit is held in a NEP-141 dollar token, so it keeps its value while the lease runs. On testnet that is a test token, not real money.

**[0:55, click "Start a demo vault"]**
I'll open one with no wallet and no sign-up. These are shared test accounts, so I can play every role. The page reads the chain and checks the vault: no access keys, and the code hash matches the pinned one.

**[1:10, tenant pays, declares handover]**
Tolu pays three hundred dollars in and declares handover. That starts the landlord's claim window.

**[1:25, landlord files a claim]**
The landlord can file one claim for part of the deposit, with a move-out report. Only the report's hash goes on chain. The undisputed rest goes back to Tolu straight away.

**[1:40, tenant reply, arbiter rules]**
Tolu answers on the record. The arbiter named in the lease rules and records the reasons. The vault pays out exactly what the ruling says, using NEAR's token transfers, and the numbers always add up to the deposit.

**[2:00, How it works tab]**
If nobody files, anyone can trigger the full refund. If the arbiters stay silent, the claim lapses and Tolu is refunded. The lease itself is an NFT on its own unit account, running standard NEP-171 code by hash.

**[2:15, last screen: title and link]**
Arbiters are still agreed between the two sides, and a court is not replaced. But the deposit can no longer be held hostage. Cautio, on NEAR. Your deposit comes back by default.

## Screen plan (follows the voice; no captions)

1. Hero (hold during the story), then scroll to the demo card while the NEAR-tech paragraph plays.
2. Click "Start a demo vault"; wait for "Demo vault ready" (about 15 s; talk over the checks list).
3. Tenant: Pay deposit (300). Declare handover.
4. Landlord: File claim (100, short note).
5. Tenant: Reply to the claim.
6. Arbiter 1: Rule (60 to landlord, fee 5, reasons note). Show "Settled" and the figures.
7. How it works tab: refund-by-default, lapse, and the lease NFT lines. End on the title.

Timing note: the demo uses 2 minute windows and a 1 minute arbiter wait. The ruling must come within 2 minutes of the claim, so do steps 4 to 6 in one go.

## X post (you post it; it must carry the tag and the video)

Main post (under 280 characters):

> Caution deposits in Lagos: hard to get back, and the naira keeps sliding.
> Cautio holds the deposit in a keyless NEAR account (code pinned by hash), in a dollar token. Tenant is refunded by default unless the landlord files a claim in time.
> @NEARProtocol #NEARHackathon
> [video]

Reply under it (links):

> Try it with no wallet (testnet, test dollars): https://cautio.ibnweb3lab.workers.dev
> Code: https://github.com/ibnweb3/cautio

Optional second reply (honest limits, it earns trust):

> Testnet only. The dollar is a test token. Arbiters are agreed by both sides, not chosen by us. No audit or legal review yet.

## Words to avoid

- "Protects against inflation" without the dollar-vs-naira caveat.
- "Mainnet ready", "audited", "legally binding".
- "Works with all wallets": wallet signing is not tested.
