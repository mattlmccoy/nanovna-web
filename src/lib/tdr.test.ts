import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBandpassTdr } from './tdr.ts';
import type { SweepPoint } from './rf.ts';

const C = 299_792_458;

test('bandpass TDR recovers a synthetic delayed reflection within one distance bin', () => {
  const velocity = 0.66;
  const length = 12;
  const points: SweepPoint[] = Array.from({ length: 201 }, (_, index) => {
    const frequency = 1e6 + index * 1e6;
    const angle = -4 * Math.PI * frequency * length / (C * velocity);
    return { frequency, s11: { re: 0.4 * Math.cos(angle), im: 0.4 * Math.sin(angle) }, s21: { re: 0, im: 0 } };
  });
  const result = computeBandpassTdr(points, velocity, 'rectangular');
  assert.ok(Math.abs(result.estimatedLengthMeters - length) <= result.distanceBinMeters);
});

test('TDR rejects nonuniform grids instead of resampling silently', () => {
  const points: SweepPoint[] = [1, 2, 4, 5].map((frequency) => ({ frequency, s11: { re: 0, im: 0 }, s21: { re: 0, im: 0 } }));
  assert.throws(() => computeBandpassTdr(points), /uniform linear/);
});
