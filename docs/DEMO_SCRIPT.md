# Cautio: demo voiceover and X post (draft, not recorded, not posted)

Length target: about 2:10 spoken at a calm pace (about 300 words). One uncut voiceover; the screen recording follows it.
Every claim below was checked against the live testnet run (`evidence/live-e3.md`). Do not add claims beyond these.

## Voiceover

**[0:00, hero page]**
In Lagos, a caution deposit is paid to the landlord, and getting it back at move-out is a common fight. Meanwhile the naira keeps losing value, so a deposit held for a year buys less when it returns.

**[0:20, Vaults tab, "Try the demo" card]**
Cautio fixes both. The deposit goes into a vault on NEAR that has no keys. Not the landlord, not the tenant, not us can take the money out. Its rules are fixed by code, and anyone can check that code by its hash. And the deposit is held in a dollar stablecoin, so it keeps its value while the lease runs. On testnet this is a test token, so nothing here is real money.

**[0:45, click "Start a demo vault"]**
I'll open a vault with no wallet and no sign-up. These are shared test accounts, so I can play every role. Here is the vault, and the page checks it against the chain: no access keys, and the code matches the pinned hash.

**[1:00, tenant pays, declares handover]**
The tenant pays three hundred dollars in. Then declares handover. That starts the landlord's claim window.

**[1:15, landlord files a claim]**
The landlord can file one claim, for part of the deposit, with a move-out report. Only the report's hash goes on chain. The undisputed rest goes back to the tenant straight away.

**[1:30, tenant reply, arbiter rules]**
The tenant puts a reply on the record. Then the arbiter named in the lease rules, and records the reasons. The vault pays out exactly what the ruling says: landlord, arbiter fee, tenant. The numbers always add up to the deposit.

**[1:50, back to the figures, or the "How it works" tab]**
If nobody files a claim, anyone can trigger the full refund after the window. If the arbiters stay silent past the deadline, the claim lapses and the tenant is refunded. Silence never locks the money.

**[2:05, last screen: title and link]**
Who the arbiters are is still agreed between the two sides, and a court is not replaced. But the deposit itself can no longer be held hostage. Cautio. Your deposit comes back by default.

## Screen plan (follows the voice; no captions)

1. Hero, then scroll to the demo card.
2. Click "Start a demo vault"; wait for "Demo vault ready" (about 15 s; talk over the checks list).
3. Tenant: Pay deposit (300). Declare handover.
4. Landlord: File claim (100, short note).
5. Tenant: Reply to the claim.
6. Arbiter 1: Rule (60 to landlord, fee 5, reasons note). Show "Settled" and the figures.
7. How it works tab: the refund-by-default and lapse lines. End on the title.

Timing note: the demo uses 2 minute windows and a 1 minute arbiter wait. The ruling must come within 2 minutes of the claim, so do steps 4 to 6 in one go.

## X post (you post it; it must carry the tag and the video)

Main post (under 280 characters):

> Caution deposits in Lagos: hard to get back, and the naira keeps sliding.
> Cautio holds the deposit in a NEAR vault with no keys, in a dollar stablecoin. Tenant is refunded by default unless the landlord files a claim in time.
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
