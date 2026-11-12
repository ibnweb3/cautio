import test from "node:test";
import assert from "node:assert/strict";
import { SimVault, SETTLED, DAY } from "../public/sim.js";

const ready = () => { const v = new SimVault({}); v.fund(1000n); v.declareHandover("tenant"); return v; };

test("default refund only after the window", () => {
  const v = ready();
  v.advance(7 * DAY);
  assert.throws(() => v.release(), /still open/);
  v.advance(1);
  v.release();
  assert.equal(v.paid.tenant, 1000n);
});
test("landlord cannot declare handover", () => {
  const v = new SimVault({}); v.fund(500n);
  assert.throws(() => v.declareHandover("landlord"), /Only the tenant/);
});
test("partial claim refunds the remainder at once", () => {
  const v = ready(); v.fileClaim("landlord", 300n, "damage");
  assert.equal(v.paid.tenant, 700n); assert.equal(v.held, 300n);
});
test("late claim rejected", () => {
  const v = ready(); v.advance(7 * DAY + 1);
  assert.throws(() => v.fileClaim("landlord", 100n, "damage"), /closed/);
});
test("arbiter 2 only after SLA, fee capped, conservation holds", () => {
  const v = ready(); v.fileClaim("landlord", 400n, "damage");
  assert.throws(() => v.rule("arbiter2", 400n, 0n), /not on duty/);
  assert.throws(() => v.rule("arbiter1", 100n, 100n), /over the cap/);
  v.advance(5 * DAY);
  v.rule("arbiter2", 250n, 20n);
  assert.equal(v.phase, SETTLED);
  assert.equal(v.paid.landlord + v.paid.tenant + v.paid.arbiter, 1000n);
});
test("split cannot exceed locked", () => {
  const v = ready(); v.fileClaim("landlord", 400n, "damage");
  assert.throws(() => v.rule("arbiter1", 400n, 20n), /exceeds/);
});
test("cap enforced", () => {
  const v = new SimVault({}); assert.throws(() => v.fund(1001n), /cap/);
});
