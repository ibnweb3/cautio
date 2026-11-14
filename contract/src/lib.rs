//! Cautio: a rental caution-deposit vault with no admin and no keys.
//!
//! Intended use: deployed as a NEAR *deterministic account* (DeterministicStateInit)
//! from a global contract referenced BY CODE HASH, so the account has no access keys
//! and the code cannot be swapped. The initial state (below, "terms") is part of the
//! derived address, so the address commits to the terms.
//!
//! State layout is plain Borsh of `Vault` under the key `STATE`, which is what
//! `near-sdk` writes, so the same bytes can be produced off-chain for state-init
//! (see scripts/state.mjs).
//!
//! Money rules (native NEAR, or any NEP-141 token such as a dollar stablecoin when `token` is set):
//!   fund -> declare_handover (tenant) -> window -> release (default refund)
//!                                      -> file_claim (landlord) -> accept / rule / withdraw
//! Invariant: every payout of a settlement sums to exactly the amount held.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

pub const OPEN: u8 = 0; // accepting deposit
pub const HANDED_OVER: u8 = 1; // tenant declared handover, claim window running
pub const CLAIMED: u8 = 2; // landlord claim filed, claimed amount locked
pub const SETTLED: u8 = 3; // everything paid out

pub const KIND_DAMAGE: u8 = 0;
pub const KIND_SERVICE_CHARGE: u8 = 1;

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Vault {
    // ---- terms: fixed at creation, committed by the account address ----
    pub landlord: AccountId,
    pub tenant: AccountId,
    pub recovery: AccountId,
    pub arbiter1: AccountId,
    pub arbiter2: AccountId,
    pub cap: u128,
    pub claim_window_ns: u64,
    pub arbiter_sla_ns: u64,
    pub recovery_timelock_ns: u64,
    pub arbiter_fee_bps: u16,
    pub terms_hash: [u8; 32],
    /// None = the deposit is native NEAR. Some(t) = the deposit is the NEP-141 token `t` (for example a USD stablecoin).
    pub token: Option<AccountId>,
    // ---- progress: all zero at creation ----
    pub phase: u8,
    pub held: u128,
    pub handover_at: u64,
    pub claim_amount: u128,
    pub claim_kind: u8,
    pub claim_hash: [u8; 32],
    pub claim_at: u64,
    pub recovery_at: u64,
    pub redirected: bool,
    /// Tenant's one recorded reply to the claim (hash of the reply and its evidence).
    pub response_hash: [u8; 32],
    pub response_at: u64,
    /// Hash of the arbiter's written reasons, recorded with the ruling.
    pub ruling_hash: [u8; 32],
    /// Token payouts that failed (for example the payee was not registered with the token). Anyone can retry with `claim_owed`.
    pub owed: Vec<(AccountId, u128)>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct View {
    pub landlord: AccountId,
    pub tenant: AccountId,
    pub recovery: AccountId,
    pub arbiter1: AccountId,
    pub arbiter2: AccountId,
    pub cap: U128,
    pub claim_window_ns: U64,
    pub arbiter_sla_ns: U64,
    pub recovery_timelock_ns: U64,
    pub arbiter_fee_bps: u16,
    pub terms_hash: String,
    pub token: Option<AccountId>,
    pub phase: u8,
    pub held: U128,
    pub handover_at: U64,
    pub claim_amount: U128,
    pub claim_kind: u8,
    pub claim_hash: String,
    pub claim_at: U64,
    pub recovery_at: U64,
    pub redirected: bool,
    pub response_hash: String,
    pub response_at: U64,
    pub ruling_hash: String,
    pub owed: Vec<(AccountId, U128)>,
}

fn hex(b: &[u8; 32]) -> String {
    const D: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for x in b {
        out.push(D[(x >> 4) as usize] as char);
        out.push(D[(x & 15) as usize] as char);
    }
    out
}

/// Tiny integer-to-text so the binary does not carry core::fmt (keeps the wasm small).
fn n(mut v: u128) -> String {
    if v == 0 {
        return String::from("0");
    }
    let mut buf = [0u8; 40];
    let mut i = buf.len();
    while v > 0 {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    String::from_utf8(buf[i..].to_vec()).unwrap_or_default()
}

fn log(parts: &[&str]) {
    env::log_str(&parts.concat());
}

fn parse_hash(s: &str) -> [u8; 32] {
    require!(s.len() == 64, "hash must be 64 hex chars");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap_or_else(|_| env::panic_str("bad hex"));
    }
    out
}

impl Vault {
    fn payee(&self) -> AccountId {
        if self.redirected { self.recovery.clone() } else { self.tenant.clone() }
    }
    fn is_tenant(&self, who: &AccountId) -> bool {
        *who == self.payee()
    }
    fn pay(&self, to: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        match &self.token {
            None => {
                let _ = Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount));
            }
            Some(tok) => {
                // Arguments are built by hand (account ids and decimal digits only) to keep the binary small.
                let args = ["{\"receiver_id\":\"", to.as_str(), "\",\"amount\":\"", &n(amount), "\"}"].concat();
                let cb = ["{\"to\":\"", to.as_str(), "\",\"amount\":\"", &n(amount), "\"}"].concat();
                let _ = Promise::new(tok.clone())
                    .function_call("ft_transfer".to_string(), args.into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(15))
                    .then(Promise::new(env::current_account_id()).function_call(
                        "on_paid".to_string(),
                        cb.into_bytes(),
                        NearToken::from_yoctonear(0),
                        Gas::from_tgas(8),
                    ));
            }
        }
    }
}

#[near]
impl Vault {
    // ---------- deposit ----------

    /// Anyone may pay the deposit in, until the cap is reached.
    #[payable]
    pub fn fund(&mut self) {
        require!(self.token.is_none(), "this vault takes a token: pay with ft_transfer_call");
        require!(self.phase == OPEN, "deposit is closed");
        let amt = env::attached_deposit().as_yoctonear();
        require!(amt > 0, "attach a deposit");
        require!(self.held + amt <= self.cap, "over the deposit cap");
        self.held += amt;
        log(&["EVENT funded amount=", &n(amt), " held=", &n(self.held)]);
    }

    /// NEP-141 receiver. The token contract calls this after `ft_transfer_call`. Returns the amount NOT used
    /// (anything over the cap), which the token contract sends back to the payer.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let _ = (sender_id, msg);
        require!(self.token.as_ref() == Some(&env::predecessor_account_id()), "this vault takes a different token");
        require!(self.phase == OPEN, "deposit is closed");
        require!(amount.0 > 0, "attach a deposit");
        let room = self.cap - self.held;
        let take = if amount.0 < room { amount.0 } else { room };
        self.held += take;
        log(&["EVENT funded amount=", &n(take), " held=", &n(self.held)]);
        U128(amount.0 - take)
    }

    /// Callback after a token payout. If the token refused the transfer, remember the amount so it can be retried.
    #[private]
    pub fn on_paid(&mut self, to: AccountId, amount: U128) {
        if env::promise_result_checked(0, 16).is_err() {
            match self.owed.iter_mut().find(|e| e.0 == to) {
                Some(e) => e.1 += amount.0,
                None => self.owed.push((to.clone(), amount.0)),
            }
            log(&["EVENT payout_failed to=", to.as_str(), " amount=", &n(amount.0)]);
        }
    }

    /// Anyone can retry a failed token payout (for example after the payee registered with the token).
    pub fn claim_owed(&mut self, account: AccountId) {
        let mut total = 0u128;
        self.owed.retain(|e| {
            if e.0 == account {
                total += e.1;
                false
            } else {
                true
            }
        });
        require!(total > 0, "nothing owed to that account");
        self.pay(&account, total);
    }

    // ---------- tenant ----------

    /// Tenant says the keys are handed over. Starts the landlord's claim window.
    pub fn declare_handover(&mut self) {
        require!(self.phase == OPEN, "wrong phase");
        require!(self.is_tenant(&env::predecessor_account_id()), "tenant only");
        require!(self.held > 0, "nothing deposited");
        self.phase = HANDED_OVER;
        self.handover_at = env::block_timestamp();
        log(&["EVENT handover at=", &n(self.handover_at as u128)]);
    }

    /// Tenant accepts the landlord's claim: the claimed amount goes to the landlord.
    pub fn accept_claim(&mut self) {
        require!(self.phase == CLAIMED, "no claim");
        require!(self.is_tenant(&env::predecessor_account_id()), "tenant only");
        let amt = self.held;
        self.settle(amt, 0, None);
    }

    /// Tenant puts one reply on the record while a claim is open (hash of the reply and any evidence).
    pub fn respond(&mut self, response_hash: String) {
        require!(self.phase == CLAIMED, "no claim");
        require!(self.is_tenant(&env::predecessor_account_id()), "tenant only");
        require!(self.response_hash == [0u8; 32], "a reply is already on the record");
        self.response_hash = parse_hash(&response_hash);
        self.response_at = env::block_timestamp();
        log(&["EVENT response hash=", &response_hash]);
    }

    // ---------- landlord ----------

    /// Landlord files one claim inside the window. Only the claimed amount is locked;
    /// the undisputed remainder goes back to the tenant straight away.
    pub fn file_claim(&mut self, amount: U128, kind: u8, report_hash: String) {
        require!(self.phase == HANDED_OVER, "wrong phase");
        require!(env::predecessor_account_id() == self.landlord, "landlord only");
        require!(env::block_timestamp() <= self.handover_at + self.claim_window_ns, "claim window closed");
        require!(kind == KIND_DAMAGE || kind == KIND_SERVICE_CHARGE, "unknown claim kind");
        let a = amount.0;
        require!(a > 0 && a <= self.held, "claim must be between 1 and the held amount");
        self.claim_hash = parse_hash(&report_hash);
        self.claim_amount = a;
        self.claim_kind = kind;
        self.claim_at = env::block_timestamp();
        let back = self.held - a;
        self.held = a;
        self.phase = CLAIMED;
        let to = self.payee();
        self.pay(&to, back);
        log(&["EVENT claim amount=", &n(a), " kind=", &n(kind as u128), " refunded_now=", &n(back)]);
    }

    /// Landlord drops the claim: the locked amount goes back to the tenant.
    pub fn withdraw_claim(&mut self) {
        require!(self.phase == CLAIMED, "no claim");
        require!(env::predecessor_account_id() == self.landlord, "landlord only");
        self.settle(0, 0, None);
    }

    // ---------- default refund ----------

    /// Nobody filed a claim in the window: anyone can send the deposit back to the tenant.
    pub fn release(&mut self) {
        require!(self.phase == HANDED_OVER, "wrong phase");
        require!(env::block_timestamp() > self.handover_at + self.claim_window_ns, "claim window still open");
        self.settle(0, 0, None);
    }

    // ---------- arbiter ----------

    /// Arbiter splits the locked amount. Arbiter 1 any time after a claim; arbiter 2 only
    /// after the SLA has lapsed. landlord + fee + tenant == locked amount by construction.
    pub fn rule(&mut self, landlord_amount: U128, arbiter_fee: U128, reason_hash: String) {
        require!(self.phase == CLAIMED, "no claim");
        let who = env::predecessor_account_id();
        let a2_ok = env::block_timestamp() >= self.claim_at + self.arbiter_sla_ns;
        require!(who == self.arbiter1 || (who == self.arbiter2 && a2_ok), "not the arbiter on duty");
        require!(env::block_timestamp() <= self.claim_at + 2 * self.arbiter_sla_ns, "ruling deadline passed: the claim can lapse");
        self.ruling_hash = parse_hash(&reason_hash);
        let fee = arbiter_fee.0;
        require!(fee <= self.held * (self.arbiter_fee_bps as u128) / 10_000, "arbiter fee over the cap");
        require!(landlord_amount.0 + fee <= self.held, "split exceeds the locked amount");
        self.settle(landlord_amount.0, fee, Some(who));
    }

    /// Neither arbiter ruled by the deadline (two SLAs after the claim): the claim lapses and the tenant is refunded.
    /// Refund by default also covers an arbiter who never shows up. Anyone can call this.
    pub fn lapse_claim(&mut self) {
        require!(self.phase == CLAIMED, "no claim");
        require!(env::block_timestamp() > self.claim_at + 2 * self.arbiter_sla_ns, "arbiters still have time");
        self.settle(0, 0, None);
    }

    // ---------- recovery of the refund address ----------

    /// Recovery address asks to take over the tenant role (lost key). The tenant can cancel.
    pub fn start_recovery(&mut self) {
        require!(self.phase != SETTLED, "already settled");
        require!(env::predecessor_account_id() == self.recovery, "recovery address only");
        self.recovery_at = env::block_timestamp();
        env::log_str("EVENT recovery_started");
    }

    pub fn cancel_recovery(&mut self) {
        require!(env::predecessor_account_id() == self.tenant, "tenant only");
        require!(!self.redirected, "already redirected");
        self.recovery_at = 0;
        env::log_str("EVENT recovery_cancelled");
    }

    pub fn complete_recovery(&mut self) {
        require!(self.phase != SETTLED, "already settled");
        require!(env::predecessor_account_id() == self.recovery, "recovery address only");
        require!(self.recovery_at > 0, "not started");
        require!(env::block_timestamp() >= self.recovery_at + self.recovery_timelock_ns, "timelock not over");
        self.redirected = true;
        env::log_str("EVENT recovery_completed");
    }

    // ---------- views ----------

    pub fn get_state(&self) -> View {
        View {
            landlord: self.landlord.clone(),
            tenant: self.tenant.clone(),
            recovery: self.recovery.clone(),
            arbiter1: self.arbiter1.clone(),
            arbiter2: self.arbiter2.clone(),
            cap: U128(self.cap),
            claim_window_ns: U64(self.claim_window_ns),
            arbiter_sla_ns: U64(self.arbiter_sla_ns),
            recovery_timelock_ns: U64(self.recovery_timelock_ns),
            arbiter_fee_bps: self.arbiter_fee_bps,
            terms_hash: hex(&self.terms_hash),
            token: self.token.clone(),
            phase: self.phase,
            held: U128(self.held),
            handover_at: U64(self.handover_at),
            claim_amount: U128(self.claim_amount),
            claim_kind: self.claim_kind,
            claim_hash: hex(&self.claim_hash),
            claim_at: U64(self.claim_at),
            recovery_at: U64(self.recovery_at),
            redirected: self.redirected,
            response_hash: hex(&self.response_hash),
            response_at: U64(self.response_at),
            ruling_hash: hex(&self.ruling_hash),
            owed: self.owed.iter().map(|e| (e.0.clone(), U128(e.1))).collect(),
        }
    }
}

impl Vault {
    /// Pay out the whole held amount: `landlord_amt` and `fee` as given, the rest to the tenant.
    fn settle(&mut self, landlord_amt: u128, fee: u128, arbiter: Option<AccountId>) {
        let total = self.held;
        require!(landlord_amt + fee <= total, "payout exceeds held");
        let tenant_amt = total - landlord_amt - fee;
        // conservation: nothing created, nothing left behind
        require!(landlord_amt + fee + tenant_amt == total, "conservation broken");
        self.held = 0;
        self.phase = SETTLED;
        let t = self.payee();
        let l = self.landlord.clone();
        self.pay(&l, landlord_amt);
        self.pay(&t, tenant_amt);
        if let Some(a) = arbiter {
            self.pay(&a, fee);
        }
        log(&["EVENT settled landlord=", &n(landlord_amt), " tenant=", &n(tenant_amt), " arbiter_fee=", &n(fee)]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const ONE: u128 = 1_000_000_000_000_000_000_000_000;
    const WINDOW: u64 = 1_000;
    const SLA: u64 = 500;
    const H: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    fn ctx(who: AccountId, ts: u64, dep: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who)
            .block_timestamp(ts)
            .attached_deposit(NearToken::from_yoctonear(dep))
            .build());
    }
    // accounts: 0 alice=landlord, 1 bob=tenant, 2 charlie=recovery, 3 danny=arb1, 4 eugene=arb2
    fn vault() -> Vault {
        Vault {
            landlord: accounts(0), tenant: accounts(1), recovery: accounts(2),
            arbiter1: accounts(3), arbiter2: accounts(4),
            cap: 10 * ONE, claim_window_ns: WINDOW, arbiter_sla_ns: SLA,
            recovery_timelock_ns: 300, arbiter_fee_bps: 500, terms_hash: [7; 32], token: None,
            phase: OPEN, held: 0, handover_at: 0, claim_amount: 0, claim_kind: 0,
            claim_hash: [0; 32], claim_at: 0, recovery_at: 0, redirected: false,
            response_hash: [0; 32], response_at: 0, ruling_hash: [0; 32], owed: vec![],
        }
    }
    fn token_vault() -> Vault {
        let mut v = vault();
        v.token = Some("usd.testnet".parse().unwrap());
        v
    }
    fn token_funded_handed() -> Vault {
        let mut v = token_vault();
        ctx(accounts(5), 1, 0);
        testing_env!(VMContextBuilder::new().predecessor_account_id("usd.testnet".parse().unwrap()).block_timestamp(1).build());
        let unused = v.ft_on_transfer(accounts(5), U128(10 * ONE), String::new());
        assert_eq!(unused.0, 0);
        ctx(accounts(1), 10, 0);
        v.declare_handover();
        v
    }
    fn funded_handed() -> Vault {
        let mut v = vault();
        ctx(accounts(5), 1, 10 * ONE);
        v.fund();
        ctx(accounts(1), 10, 0);
        v.declare_handover();
        v
    }

    #[test]
    fn fund_respects_cap() {
        let mut v = vault();
        ctx(accounts(5), 1, 6 * ONE);
        v.fund();
        ctx(accounts(5), 2, 4 * ONE);
        v.fund();
        assert_eq!(v.held, 10 * ONE);
    }
    #[test]
    #[should_panic(expected = "over the deposit cap")]
    fn fund_over_cap_fails() {
        let mut v = vault();
        ctx(accounts(5), 1, 11 * ONE);
        v.fund();
    }
    #[test]
    #[should_panic(expected = "tenant only")]
    fn landlord_cannot_declare_handover() {
        let mut v = vault();
        ctx(accounts(5), 1, ONE);
        v.fund();
        ctx(accounts(0), 2, 0);
        v.declare_handover();
    }
    #[test]
    #[should_panic(expected = "claim window still open")]
    fn no_early_release() {
        let mut v = funded_handed();
        ctx(accounts(5), 10 + WINDOW, 0);
        v.release();
    }
    #[test]
    fn default_refund_after_window() {
        let mut v = funded_handed();
        ctx(accounts(5), 10 + WINDOW + 1, 0);
        v.release();
        assert_eq!(v.phase, SETTLED);
        assert_eq!(v.held, 0);
    }
    #[test]
    #[should_panic(expected = "claim window closed")]
    fn late_claim_rejected() {
        let mut v = funded_handed();
        ctx(accounts(0), 10 + WINDOW + 1, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
    }
    #[test]
    #[should_panic(expected = "landlord only")]
    fn tenant_cannot_claim() {
        let mut v = funded_handed();
        ctx(accounts(1), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
    }
    #[test]
    fn partial_claim_locks_only_claimed() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(3 * ONE), KIND_DAMAGE, H.to_string());
        assert_eq!(v.held, 3 * ONE);
        assert_eq!(v.phase, CLAIMED);
    }
    #[test]
    #[should_panic(expected = "claim must be between")]
    fn claim_over_held_rejected() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(11 * ONE), KIND_DAMAGE, H.to_string());
    }
    #[test]
    fn accept_pays_landlord() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(3 * ONE), KIND_SERVICE_CHARGE, H.to_string());
        ctx(accounts(1), 30, 0);
        v.accept_claim();
        assert_eq!(v.phase, SETTLED);
    }
    #[test]
    fn arbiter_split_is_conserved() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(4 * ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(3), 30, 0);
        // cap is 5% of 4 NEAR = 0.2 NEAR
        v.rule(U128(2 * ONE), U128(ONE / 10), H.to_string());
        assert_eq!(v.phase, SETTLED);
        assert_eq!(v.held, 0);
    }
    #[test]
    #[should_panic(expected = "arbiter fee over the cap")]
    fn fee_cap_enforced() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(4 * ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(3), 30, 0);
        v.rule(U128(ONE), U128(ONE), H.to_string());
    }
    #[test]
    #[should_panic(expected = "split exceeds the locked amount")]
    fn split_cannot_exceed_locked() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(4 * ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(3), 30, 0);
        v.rule(U128(4 * ONE), U128(ONE / 10), H.to_string());
    }
    #[test]
    #[should_panic(expected = "not the arbiter on duty")]
    fn arbiter2_cannot_rule_before_sla() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(4), 20 + SLA - 1, 0);
        v.rule(U128(0), U128(0), H.to_string());
    }
    #[test]
    fn arbiter2_rules_after_sla() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(4), 20 + SLA, 0);
        v.rule(U128(ONE), U128(0), H.to_string());
        assert_eq!(v.phase, SETTLED);
    }
    #[test]
    #[should_panic(expected = "not the arbiter on duty")]
    fn stranger_cannot_rule() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(5), 9999, 0);
        v.rule(U128(ONE), U128(0), H.to_string());
    }
    #[test]
    fn token_vault_takes_only_its_token_and_refunds_over_cap() {
        let mut v = token_vault();
        testing_env!(VMContextBuilder::new().predecessor_account_id("usd.testnet".parse().unwrap()).build());
        assert_eq!(v.ft_on_transfer(accounts(5), U128(7 * ONE), String::new()).0, 0);
        // 3 of 10 left: a payment of 5 keeps 3 and sends 2 back
        assert_eq!(v.ft_on_transfer(accounts(5), U128(5 * ONE), String::new()).0, 2 * ONE);
        assert_eq!(v.held, 10 * ONE);
    }
    #[test]
    #[should_panic(expected = "this vault takes a different token")]
    fn token_vault_rejects_other_token() {
        let mut v = token_vault();
        testing_env!(VMContextBuilder::new().predecessor_account_id("fake.testnet".parse().unwrap()).build());
        v.ft_on_transfer(accounts(5), U128(ONE), String::new());
    }
    #[test]
    #[should_panic(expected = "this vault takes a token")]
    fn token_vault_rejects_native_fund() {
        let mut v = token_vault();
        ctx(accounts(5), 1, ONE);
        v.fund();
    }
    #[test]
    #[should_panic(expected = "this vault takes a different token")]
    fn native_vault_rejects_token_deposit() {
        let mut v = vault();
        testing_env!(VMContextBuilder::new().predecessor_account_id("usd.testnet".parse().unwrap()).build());
        v.ft_on_transfer(accounts(5), U128(ONE), String::new());
    }
    #[test]
    fn token_vault_settles_by_default() {
        let mut v = token_funded_handed();
        ctx(accounts(5), 10 + WINDOW + 1, 0);
        v.release();
        assert_eq!(v.phase, SETTLED);
        assert_eq!(v.held, 0);
    }
    #[test]
    fn tenant_reply_is_recorded_once() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(1), 25, 0);
        v.respond(H.to_string());
        assert_eq!(v.response_at, 25);
        assert_ne!(v.response_hash, [0u8; 32]);
    }
    #[test]
    #[should_panic(expected = "a reply is already on the record")]
    fn tenant_cannot_reply_twice() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(1), 25, 0);
        v.respond(H.to_string());
        v.respond(H.to_string());
    }
    #[test]
    #[should_panic(expected = "tenant only")]
    fn landlord_cannot_reply_for_tenant() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        v.respond(H.to_string());
    }
    #[test]
    fn ruling_records_reason_hash() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(3), 30, 0);
        v.rule(U128(ONE), U128(0), H.to_string());
        assert_ne!(v.ruling_hash, [0u8; 32]);
    }
    #[test]
    fn silent_arbiters_lapse_the_claim_to_the_tenant() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(4 * ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(5), 20 + 2 * SLA + 1, 0);
        v.lapse_claim();
        assert_eq!(v.phase, SETTLED);
        assert_eq!(v.held, 0);
    }
    #[test]
    #[should_panic(expected = "arbiters still have time")]
    fn lapse_not_before_the_deadline() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(5), 20 + 2 * SLA, 0);
        v.lapse_claim();
    }
    #[test]
    #[should_panic(expected = "ruling deadline passed")]
    fn no_ruling_after_deadline() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(3), 20 + 2 * SLA + 1, 0);
        v.rule(U128(ONE), U128(0), H.to_string());
    }
    #[test]
    #[should_panic(expected = "nothing owed")]
    fn claim_owed_with_nothing_fails() {
        let mut v = token_vault();
        ctx(accounts(5), 1, 0);
        v.claim_owed(accounts(1));
    }
    #[test]
    fn landlord_can_withdraw_claim() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        v.withdraw_claim();
        assert_eq!(v.phase, SETTLED);
    }
    #[test]
    #[should_panic(expected = "wrong phase")]
    fn no_second_settlement() {
        let mut v = funded_handed();
        ctx(accounts(5), 10 + WINDOW + 1, 0);
        v.release();
        v.release();
    }
    #[test]
    fn recovery_flow_respects_timelock_and_cancel() {
        let mut v = vault();
        ctx(accounts(2), 100, 0);
        v.start_recovery();
        ctx(accounts(1), 150, 0);
        v.cancel_recovery();
        assert_eq!(v.recovery_at, 0);
        ctx(accounts(2), 200, 0);
        v.start_recovery();
        ctx(accounts(2), 200 + 300, 0);
        v.complete_recovery();
        assert!(v.redirected);
        // after redirect the recovery account acts as the tenant
        ctx(accounts(5), 1, ONE);
        v.fund();
        ctx(accounts(2), 600, 0);
        v.declare_handover();
    }
    #[test]
    #[should_panic(expected = "timelock not over")]
    fn recovery_too_early() {
        let mut v = vault();
        ctx(accounts(2), 100, 0);
        v.start_recovery();
        ctx(accounts(2), 399, 0);
        v.complete_recovery();
    }
}
