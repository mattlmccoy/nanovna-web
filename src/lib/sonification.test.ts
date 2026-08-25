import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSonificationTarget, gridsMatch } from './sonification.ts';
import type { SweepPoint } from './rf.ts';

function point(frequency: number, re: number, im: number): SweepPoint {
  return { frequency, s11: { re, im }, s21: { re: 0, im: 0 } };
}

const options = { baseFrequency: 220, reactancePerOctave: 75, pitchDirection: 1 as const, fullVolumeChange: 100, deadband: .25, maxGain: .03 };

test('identical and within-deadband measurements remain silent without mutation', () => {
  const current = point(1e6, 0, 0);
  const reference = structuredClone(current);
  const before = structuredClone([current, reference]);
  assert.equal(computeSonificationTarget(current, reference, options).gain, 0);
  const near = point(1e6, .005, 0);
  assert.equal(computeSonificationTarget(near, reference, { ...options, deadband: 2 }).gain, 0);
  assert.deepEqual([current, reference], before);
});

test('signed reactance controls pitch and output is hard limited', () => {
  const reference = point(1e6, 0, 0);
  const inductive = computeSonificationTarget(point(1e6, 0, .5), reference, options);
  const capacitive = computeSonificationTarget(point(1e6, 0, -.5), reference, options);
  assert.ok(inductive.frequency > options.baseFrequency);
  assert.ok(capacitive.frequency < options.baseFrequency);
  assert.ok(inductive.frequency <= 2000 && capacitive.frequency >= 80);
  assert.ok(inductive.gain <= .05);
});

test('pitch direction can be inverted for plate proximity control', () => {
  const reference = point(1e6, 0, 0);
  const capacitive = computeSonificationTarget(point(1e6, 0, -.5), reference, { ...options, pitchDirection: -1 });
  assert.ok(capacitive.frequency > options.baseFrequency);
});

test('singular impedance and incompatible grids fail closed', () => {
  assert.equal(computeSonificationTarget(point(1e6, 1, 0), point(1e6, 0, 0), options).valid, false);
  assert.equal(gridsMatch([point(1e6, 0, 0)], [point(2e6, 0, 0)]), false);
});
