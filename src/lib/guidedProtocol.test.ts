import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuidedProtocol } from './guidedProtocol.ts';

test('guided protocol creates labeled approach, hold, withdraw, and recovery steps', () => {
  const plan = buildGuidedProtocol(['Series capacitor bank', 'Transformer'], 2);
  assert.equal(plan.length, 20);
  assert.deepEqual(plan.slice(0, 5).map((step) => step.action), ['prepare', 'approach', 'hold', 'withdraw', 'rest']);
  assert.equal(plan[0].component, 'Series capacitor bank');
  assert.equal(plan[10].repetition, 2);
  assert.match(plan[2].tag, /series-capacitor-bank-r1-hold/);
});

test('guided protocol rejects an empty component list and caps repetitions', () => {
  assert.deepEqual(buildGuidedProtocol([], 3), []);
  assert.equal(buildGuidedProtocol(['Inductor'], 99).length, 25);
});
