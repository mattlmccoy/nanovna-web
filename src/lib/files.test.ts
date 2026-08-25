import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMeasurementFile } from './files.ts';

test('loads NanoVNA Web complex CSV without recalculating complex values', () => {
  const csv = '# Processing: 3-measurement complex mean\nfrequency_hz,s11_real,s11_imag,s11_db,s11_phase_deg,s21_real,s21_imag,s21_db,s21_phase_deg\n1000000,0.2,-0.1,0,0,0.8,0.3,0,0';
  const [point] = parseMeasurementFile(csv, 'sweep.csv');
  assert.deepEqual(point, { frequency: 1e6, s11: { re: 0.2, im: -0.1 }, s21: { re: 0.8, im: 0.3 } });
});

test('loads S1P RI data and leaves unavailable S21 explicitly invalid', () => {
  const [point] = parseMeasurementFile('# MHz S RI R 50\n1 0.5 -0.25', 'sweep.s1p');
  assert.equal(point.frequency, 1e6);
  assert.deepEqual(point.s11, { re: 0.5, im: -0.25 });
  assert.equal(Number.isNaN(point.s21.re), true);
});

test('converts Touchstone dB-angle pairs to complex values', () => {
  const [point] = parseMeasurementFile('# GHz S DB R 50\n1 -6.020599913 90', 'sweep.s1p');
  assert.ok(Math.abs(point.s11.re) < 1e-9);
  assert.ok(Math.abs(point.s11.im - 0.5) < 1e-9);
});

test('loads multiline S2P rows in S11, S21, S12, S22 order', () => {
  const [point] = parseMeasurementFile('# MHz S RI R 50\n1 0.1 0.2 0.3 0.4\n0.5 0.6 0.7 0.8', 'fixture.s2p');
  assert.equal(point.frequency, 1e6);
  assert.deepEqual(point.s11, { re: 0.1, im: 0.2 });
  assert.deepEqual(point.s21, { re: 0.3, im: 0.4 });
});

test('rejects non-50-ohm, incomplete, and nonmonotonic Touchstone data', () => {
  assert.throws(() => parseMeasurementFile('# MHz S RI R 75\n1 0.1 0.2', 'fixture.s1p'), /50 Ω/);
  assert.throws(() => parseMeasurementFile('# MHz S RI R 50\n1 0.1', 'fixture.s1p'), /incomplete/);
  assert.throws(() => parseMeasurementFile('# MHz S RI R 50\n2 0.1 0.2\n1 0.2 0.3', 'fixture.s1p'), /strictly increasing/);
});

test('rejects unsupported Touchstone 2.0 keywords instead of guessing', () => {
  assert.throws(() => parseMeasurementFile('[Version] 2.0\n# MHz S RI R 50\n[Network Data]\n1 0.1 0.2', 'fixture.s1p'), /Touchstone 2.0/);
});
