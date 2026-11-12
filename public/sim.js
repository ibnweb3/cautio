// Rule-for-rule JavaScript mirror of contract/src/lib.rs, used by the walk-through simulator.
// NOT on chain. Amounts are BigInt in thousandths of a NEAR ("milli").
export const OPEN = 0, HANDED_OVER = 1, CLAIMED = 2, SETTLED = 3;
export const PHASE = ["Open: accepting deposit", "Handed over: claim window running", "Claimed: amount locked", "Settled"];
export const DAY = 86_400;

export class SimVault {
  constructor(t) {
    this.t = { cap: 1000n, claimWindow: 7 * DAY, arbiterSla: 5 * DAY, recoveryTimelock: 14 * DAY, feeBps: 500n, ...t };
    this.now = 0; this.phase = OPEN; this.held = 0n; this.handoverAt = 0; this.claim = null;
    this.redirected = false; this.recoveryAt = 0; this.paid = { landlord: 0n, tenant: 0n, arbiter: 0n }; this.log = [];
  }
  _say(m) { this.log.push({ at: this.now, m }); }
  _req(ok, why) { if (!ok) throw new Error(why); }
  advance(sec) { this.now += sec; }
  fund(amt) {
    this._req(this.phase === OPEN, "Deposit is closed.");
    this._req(amt > 0n, "Enter an amount above zero.");
    this._req(this.held + amt <= this.t.cap, "Over the deposit cap.");
    this.held += amt; this._say(`Deposit paid in: ${amt} (held ${this.held}).`);
  }
  declareHandover(who) {
    this._req(this.phase === OPEN, "Wrong phase.");
    this._req(who === "tenant", "Only the tenant can declare handover.");
    this._req(this.held > 0n, "Nothing deposited yet.");
    this.phase = HANDED_OVER; this.handoverAt = this.now; this._say("Tenant declared keys handed over. Claim window starts.");
  }
  fileClaim(who, amt, kind) {
    this._req(this.phase === HANDED_OVER, "Wrong phase.");
    this._req(who === "landlord", "Only the landlord can file a claim.");
    this._req(this.now <= this.handoverAt + this.t.claimWindow, "Claim window has closed.");
    this._req(amt > 0n && amt <= this.held, "Claim must be between 1 and the held amount.");
    const back = this.held - amt;
    this.claim = { amt, kind, at: this.now }; this.held = amt; this.phase = CLAIMED;
    this.paid.tenant += back;
    this._say(`Landlord claimed ${amt} (${kind}). Undisputed ${back} refunded to tenant now.`);
  }
  _settle(landlordAmt, fee, arbiter) {
    const total = this.held; const tenantAmt = total - landlordAmt - fee;
    this._req(landlordAmt + fee <= total, "Split exceeds the locked amount.");
    this._req(landlordAmt + fee + tenantAmt === total, "Conservation broken.");
    this.paid.landlord += landlordAmt; this.paid.tenant += tenantAmt; if (arbiter) this.paid.arbiter += fee;
    this.held = 0n; this.phase = SETTLED;
    this._say(`Settled: landlord ${landlordAmt}, tenant ${tenantAmt}, arbiter fee ${fee}.`);
  }
  acceptClaim(who) {
    this._req(this.phase === CLAIMED, "There is no claim.");
    this._req(who === "tenant", "Only the tenant can accept a claim.");
    this._settle(this.held, 0n, null);
  }
  withdrawClaim(who) {
    this._req(this.phase === CLAIMED, "There is no claim.");
    this._req(who === "landlord", "Only the landlord can withdraw a claim.");
    this._settle(0n, 0n, null);
  }
  release() {
    this._req(this.phase === HANDED_OVER, "Wrong phase.");
    this._req(this.now > this.handoverAt + this.t.claimWindow, "Claim window is still open.");
    this._settle(0n, 0n, null);
  }
  rule(who, landlordAmt, fee) {
    this._req(this.phase === CLAIMED, "There is no claim.");
    const a2ok = this.now >= this.claim.at + this.t.arbiterSla;
    this._req(who === "arbiter1" || (who === "arbiter2" && a2ok), "That arbiter is not on duty yet.");
    this._req(fee <= (this.held * this.t.feeBps) / 10000n, "Arbiter fee is over the cap.");
    this._settle(landlordAmt, fee, who);
  }
  feeCap() { return (this.held * this.t.feeBps) / 10000n; }
}
