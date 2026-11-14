# Live run: stablecoin vault and dispute fixes (NEAR testnet)

Token: cautio-usd.testnet (test dollar, 6 decimals)

- A vault 0s0e4a439ebc6471e3e2d887c0fc69edd0153c9654 code hash CfQddEJ2WDcQVSgCZ1cTrVkNxJRXhjpHdy3J7TPGpVvg
- mint 1000 tUSD to the tenant ok
- pay 250 tUSD ok
- pay 100 tUSD (only 50 fit under the 300 cap; 50 must come back) ok
- held after both payments (expect 300 tUSD): 300 | vault token balance: 300 | tenant paid in total: 300
- native fund() on a token vault (expect rejection) REJECTED: this vault takes a token: pay with ft_transfer_call
- declare_handover ok
- file_claim 100 tUSD ok
- tenant got the undisputed 200 back at once; tenant total paid so far (expect 100): 100
- tenant reply ok
- second tenant reply (expect rejection) REJECTED: a reply is already on the record
- landlord replying as tenant (expect rejection) REJECTED: tenant only
- reply on record: true
- arbiter 1 rules: landlord 60, fee 5, tenant 35 ok
- A final phase 3 held 0 ruling hash recorded: true
- payouts: landlord + 60 arbiter + 5 tenant net cost 65 (expect 60, 5, 65)
- B vault 0s2581727c9d8058499f0d94cbd1db83cb960a09fa code hash CfQddEJ2WDcQVSgCZ1cTrVkNxJRXhjpHdy3J7TPGpVvg
- pay 100 tUSD ok
- declare_handover ok
- file_claim 80 tUSD ok
- lapse too early (expect rejection) REJECTED: arbiters still have time
- waiting 45 s for both arbiter waits to pass
- arbiter 1 ruling after the deadline (expect rejection) REJECTED: ruling deadline passed: the claim can lapse
- anyone closes the lapsed claim ok
- B final phase 3 held 0 | tenant refunded + 80 (expect 80)
- C vault 0sa4ed4ea55f39da444b8dd19b32dba4b0662b92f8 code hash CfQddEJ2WDcQVSgCZ1cTrVkNxJRXhjpHdy3J7TPGpVvg
- tenant account registered with the token? false
- landlord pays 40 tUSD for the tenant ok ok
- waiting 25 s for the claim window
- release (the tenant payout must fail safely) ok
- C state: phase 3 owed [["cc21f3cb9f69c59e3aac95d6270988d8ca720e3dc3a92e47d88eea84dfdb3f96","40000000"]]
- retry the payout ok
- after retry: owed [] | tenant token balance 40 (expect 40)
