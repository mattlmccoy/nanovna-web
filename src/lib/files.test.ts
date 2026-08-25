import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMeasurementFile } from './files.ts';

test('loads NanoVNA Web raw CSV without recalculating complex values', () => {
  const csv = 'frequency_hz,s11_real,s11_imag,s11_db,s11_phase_deg,s21_real,s21_imag,s21_db,s21_phase_deg\n1000000,0.2,-0.1,0,0,0.8,0.3,0,0';
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
