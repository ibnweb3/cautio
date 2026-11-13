# Run from the web page, 2026-11-13

Vault `0sc28f1987ea5e2ccfeace344ed95076ad2d46bdbd` (testnet). Terms: 2-minute claim window, 1-minute arbiter wait, cap 0.5 NEAR.

| Step | Who signed | How |
|---|---|---|
| Create the vault (`DeterministicStateInit`, 0.05 NEAR buffer) | a throwaway account created in the browser (the landlord) | web page, form "New vault" |
| Pay in 0.25 NEAR (`fund`) | the same account | web page, button "Pay deposit" |
| `declare_handover` | tenant account | script `scripts/role-call.mjs` (tx `5zwV6pRF3d59kDGWLbZ9FSF3ED5aEG98TmM8oxdrwcbu`) |
| `file_claim` for 0.1 NEAR with a hashed report | the browser account (landlord) | web page, button "File claim"; 0.15 NEAR was refunded to the tenant at once |
| `rule`: 0.08 to the landlord, 0.005 arbiter fee, 0.015 to the tenant | arbiter 1 | script (tx `8gogn7fBEz9Wrx7hw6rmcNGhFo3YeQ9n73JGVkDDu8gB`) |

Result read back by the page: phase Settled, held 0. The create, deposit and claim transactions were sent by the page; their hashes are listed in the browser account's explorer history, not copied here. A first deposit attempt of 0.4 NEAR from the page was refused for lack of balance (the account held 0.39 NEAR after the buffer), which is why the page now says so in plain words.

Things this run found and fixed: countdowns used the device clock, which was minutes off from chain time (now taken from the latest block); the arbiter's ruling needs 40 TGas reserved, and the first 60 TGas try failed on a low balance.
