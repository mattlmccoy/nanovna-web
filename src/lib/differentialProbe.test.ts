import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDifferentialBaseline, frequencyGridsMatch, scoreDifferentialPoint, scoreDifferentialSweep } from './differentialProbe.ts';
import type { SweepPoint } from './rf.ts';

function sweep(offset = 0, phase = 0): SweepPoint[] {
  return Array.from({ length: 11 }, (_, index) => ({ frequency: 10e6 + index * 100e3, s11: { re: 0.2 + index * 0.001 + offset, im: -0.1 + phase }, s21: { re: 0, im: 0 } }));
}

test('baseline requires repeated identical frequency grids', () => {
  assert.equal(frequencyGridsMatch([sweep(), sweep()]), true);
  const changed = sweep(); changed[2].frequency += 1;
  assert.equal(frequencyGridsMatch([sweep(), changed]), false);
  assert.throws(() => buildDifferentialBaseline(Array.from({ length: 19 }, () => sweep())), /At least 20/);
});

test('measured baseline noise sets silence and a complex perturbation produces an event', () => {
  const captures = Array.from({ length: 50 }, (_, n) => sweep(Math.sin(n * 1.7) * 1e-4, Math.cos(n * 1.3) * 1.5e-4));
  const baseline = buildDifferentialBaseline(captures);
  const quiet = scoreDifferentialPoint(sweep()[5], baseline, 5);
  assert.equal(quiet.valid, true);
  assert.equal(quiet.excess, 0);
  const changed = sweep(); changed[5].s11.re += 0.02; changed[5].s11.im -= 0.015;
  const event = scoreDifferentialPoint(changed[5], baseline, 5);
  assert.ok(event.distance > baseline.threshold);
  assert.ok(event.excess > 0);
});

test('replay is deterministic and grid mismatches fail closed', () => {
  const baseline = buildDifferentialBaseline(Array.from({ length: 40 }, (_, n) => sweep(Math.sin(n) * 2e-4, Math.cos(n) * 2e-4)));
  const replay = sweep(0.003, -0.002);
  assert.deepEqual(scoreDifferentialSweep(replay, baseline), scoreDifferentialSweep(structuredClone(replay), structuredClone(baseline)));
  const wrong = sweep(); wrong[0].frequency += 1;
  assert.equal(scoreDifferentialPoint(wrong[0], baseline, 0).valid, false);
});
