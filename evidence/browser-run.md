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

## Run 2 (2026-11-13, current contract build `7sPm7E…`): named account, vault and lease NFT, all from the page

- The browser account created the named account `cautiolandlord226.testnet` (same key) through the `testnet` registrar.
- As that landlord, the page opened vault `0s744202fdb8e2dd7c2719952f551a7798d5bfd795` (cap 0.2 NEAR).
- The page then issued the lease NFT: it created `unit-a495.cautiolandlord226.testnet` (keyless), pointed it at the standard NFT code by hash, called `new_default_meta`, and minted `lease-1` to the tenant. The vault page's checks showed: zero access keys, code hash matches the pin and re-hashes in the browser, and the NFT is owned by the vault's tenant.
- Not tested: signing through a real wallet.
