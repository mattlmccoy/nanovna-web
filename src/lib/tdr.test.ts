import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBandpassTdr, computeLowpassTdr } from './tdr.ts';
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

test('bandpass TDR retains delays in the latter half of the unambiguous range', () => {
  const velocity = 0.66;
  const length = 70;
  const points: SweepPoint[] = Array.from({ length: 201 }, (_, index) => {
    const frequency = 1e6 + index * 1e6;
    const angle = -4 * Math.PI * frequency * length / (C * velocity);
    return { frequency, s11: { re: Math.cos(angle), im: Math.sin(angle) }, s21: { re: 0, im: 0 } };
  });
  const result = computeBandpassTdr(points, velocity, 'rectangular');
  assert.ok(length > result.unambiguousRangeMeters / 2);
  assert.ok(Math.abs(result.estimatedLengthMeters - length) <= result.distanceBinMeters);
});

test('low-pass TDR requires measured DC and recovers a delayed reflection', () => {
  const velocity = 0.66;
  const length = 8;
  const dcPoints: SweepPoint[] = Array.from({ length: 101 }, (_, index) => {
    const frequency = index * 1e6;
    const angle = -4 * Math.PI * frequency * length / (C * velocity);
    return { frequency, s11: { re: .2 * Math.cos(angle), im: .2 * Math.sin(angle) }, s21: { re: 0, im: 0 } };
  });
  const result = computeLowpassTdr(dcPoints, velocity, 'rectangular', 'reflection');
  assert.ok(Math.abs(result.estimatedLengthMeters - length) <= result.distanceBinMeters);
  const windowed = computeLowpassTdr(dcPoints, velocity, 'hann', 'reflection');
  assert.ok(Math.abs(windowed.estimatedLengthMeters - length) <= windowed.distanceBinMeters);
  assert.throws(() => computeLowpassTdr(dcPoints.slice(1), velocity), /acquired DC sample/);
});
