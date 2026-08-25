import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSweep, commonFrequencySpan } from './comparison.ts';
import type { SweepPoint } from './rf.ts';

function sweep(start: number, values: number[]): SweepPoint[] {
  return values.map((value, index) => ({
    frequency: start + index * 1e6,
    s11: { re: value, im: 0 },
    s21: { re: 0.5 + index * 0.1, im: 0 },
  }));
}

test('comparison analysis reports measured extrema without resampling', () => {
  const points = sweep(1e6, [0.8, 0.2, 0.1, 0.2, 0.8]);
  const analysis = analyzeSweep(points);
  assert.equal(analysis.pointCount, 5);
  assert.equal(analysis.minimumS11Frequency, 3e6);
  assert.ok(Math.abs(analysis.minimumS11Db + 20) < 1e-12);
  assert.equal(analysis.bandwidth10Db, 2e6);
  assert.equal(analysis.minimumS21Db, 20 * Math.log10(0.5));
  assert.equal(analysis.maximumS21Db, 20 * Math.log10(0.9));
});

test('common span is the intersection and rejects disjoint files', () => {
  assert.deepEqual(commonFrequencySpan([sweep(1e6, [0.5, 0.4, 0.3]), sweep(2e6, [0.5, 0.4, 0.3])]), { start: 2e6, stop: 3e6 });
  assert.equal(commonFrequencySpan([sweep(1e6, [0.5]), sweep(2e6, [0.5])]), null);
});
