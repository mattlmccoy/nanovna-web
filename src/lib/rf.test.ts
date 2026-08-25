import assert from 'node:assert/strict';
import test from 'node:test';
import { bandwidth, db, demoSweep, impedance, magnitude, phase, vswr, type SweepPoint } from './rf.ts';

test('matched load produces 50 ohms and VSWR 1:1', () => {
  const reflection = { re: 0, im: 0 };
  assert.deepEqual(impedance(reflection), { re: 50, im: 0 });
  assert.equal(vswr(reflection), 1);
  assert.equal(magnitude(reflection), 0);
});

test('reflection coefficient one third produces 100 ohms', () => {
  const result = impedance({ re: 1 / 3, im: 0 });
  assert.ok(Math.abs(result.re - 100) < 1e-10);
  assert.equal(result.im, 0);
});

test('complex display quantities retain sign and units-ready values', () => {
  const reflection = { re: 0, im: 0.5 };
  assert.ok(Math.abs(db(reflection) + 6.020599913) < 1e-6);
  assert.equal(phase(reflection), 90);
  assert.equal(vswr(reflection), 3);
});

test('bandwidth uses raw threshold crossings without smoothing', () => {
  const magnitudes = [0.8, 0.2, 0.1, 0.2, 0.8];
  const points: SweepPoint[] = magnitudes.map((value, index) => ({
    frequency: index * 1e6,
    s11: { re: value, im: 0 },
    s21: { re: 1, im: 0 },
  }));
  assert.equal(bandwidth(points, -10), 2e6);
});

test('demo trace has the requested unresampled point count', () => {
  const points = demoSweep(1e6, 2e6, 101);
  assert.equal(points.length, 101);
  assert.equal(points[0].frequency, 1e6);
  assert.equal(points.at(-1)?.frequency, 2e6);
});
