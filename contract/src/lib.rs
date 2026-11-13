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
//! Money rules (native NEAR in this build):
//!   fund -> declare_handover (tenant) -> window -> release (default refund)
//!                                      -> file_claim (landlord) -> accept / rule / withdraw
//! Invariant: every payout of a settlement sums to exactly the amount held.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

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
    pub phase: u8,
    pub held: U128,
    pub handover_at: U64,
    pub claim_amount: U128,
    pub claim_kind: u8,
    pub claim_hash: String,
    pub claim_at: U64,
    pub recovery_at: U64,
    pub redirected: bool,
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
        if amount > 0 {
            let _ = Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount));
        }
    }
}

#[near]
impl Vault {
    // ---------- deposit ----------

    /// Anyone may pay the deposit in, until the cap is reached.
    #[payable]
    pub fn fund(&mut self) {
        require!(self.phase == OPEN, "deposit is closed");
        let amt = env::attached_deposit().as_yoctonear();
        require!(amt > 0, "attach a deposit");
        require!(self.held + amt <= self.cap, "over the deposit cap");
        self.held += amt;
        log(&["EVENT funded amount=", &n(amt), " held=", &n(self.held)]);
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
    pub fn rule(&mut self, landlord_amount: U128, arbiter_fee: U128) {
        require!(self.phase == CLAIMED, "no claim");
        let who = env::predecessor_account_id();
        let a2_ok = env::block_timestamp() >= self.claim_at + self.arbiter_sla_ns;
        require!(who == self.arbiter1 || (who == self.arbiter2 && a2_ok), "not the arbiter on duty");
        let fee = arbiter_fee.0;
        require!(fee <= self.held * (self.arbiter_fee_bps as u128) / 10_000, "arbiter fee over the cap");
        require!(landlord_amount.0 + fee <= self.held, "split exceeds the locked amount");
        self.settle(landlord_amount.0, fee, Some(who));
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
            phase: self.phase,
            held: U128(self.held),
            handover_at: U64(self.handover_at),
            claim_amount: U128(self.claim_amount),
            claim_kind: self.claim_kind,
            claim_hash: hex(&self.claim_hash),
            claim_at: U64(self.claim_at),
            recovery_at: U64(self.recovery_at),
            redirected: self.redirected,
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
            recovery_timelock_ns: 300, arbiter_fee_bps: 500, terms_hash: [7; 32],
            phase: OPEN, held: 0, handover_at: 0, claim_amount: 0, claim_kind: 0,
            claim_hash: [0; 32], claim_at: 0, recovery_at: 0, redirected: false,
        }
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
        v.rule(U128(2 * ONE), U128(ONE / 10));
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
        v.rule(U128(ONE), U128(ONE));
    }
    #[test]
    #[should_panic(expected = "split exceeds the locked amount")]
    fn split_cannot_exceed_locked() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(4 * ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(3), 30, 0);
        v.rule(U128(4 * ONE), U128(ONE / 10));
    }
    #[test]
    #[should_panic(expected = "not the arbiter on duty")]
    fn arbiter2_cannot_rule_before_sla() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(4), 20 + SLA - 1, 0);
        v.rule(U128(0), U128(0));
    }
    #[test]
    fn arbiter2_rules_after_sla() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(4), 20 + SLA, 0);
        v.rule(U128(ONE), U128(0));
        assert_eq!(v.phase, SETTLED);
    }
    #[test]
    #[should_panic(expected = "not the arbiter on duty")]
    fn stranger_cannot_rule() {
        let mut v = funded_handed();
        ctx(accounts(0), 20, 0);
        v.file_claim(U128(ONE), KIND_DAMAGE, H.to_string());
        ctx(accounts(5), 9999, 0);
        v.rule(U128(ONE), U128(0));
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
