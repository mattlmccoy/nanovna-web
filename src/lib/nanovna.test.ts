import assert from 'node:assert/strict';
import test from 'node:test';
import { atLeastVersion } from './nanovna.ts';

test('firmware comparison is lexicographic, not component-wise', () => {
  assert.equal(atLeastVersion('0.7.1', [0, 7, 1]), true);
  assert.equal(atLeastVersion('0.8.0', [0, 7, 1]), true);
  assert.equal(atLeastVersion('1.0.0', [0, 7, 1]), true);
  assert.equal(atLeastVersion('0.6.99', [0, 7, 1]), false);
  assert.equal(atLeastVersion('0.7.0', [0, 7, 1]), false);
});

test('firmware comparison tolerates labels around semantic versions', () => {
  assert.equal(atLeastVersion('NanoVNA-H firmware version 0.7.2', [0, 7, 1]), true);
  assert.equal(atLeastVersion('unknown', [0, 7, 1]), false);
});
