import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFilter, analyzeOverview, analyzePeak, analyzeResonance, analyzeVswr } from './analysis.ts';
import type { SweepPoint } from './rf.ts';

function point(frequency: number, s11Re: number, s11Im: number, s21Magnitude = 1): SweepPoint {
  return { frequency, s11: { re: s11Re, im: s11Im }, s21: { re: s21Magnitude, im: 0 } };
}

test('VSWR analysis returns raw-sample band limits and minimum', () => {
  const data = [point(1, .5, 0), point(2, .1, 0), point(3, 0, 0), point(4, .1, 0), point(5, .5, 0)];
  const result = analyzeVswr(data, 1.5);
  assert.equal(result.markerIndices[0], 2);
  assert.match(result.summary, /1 region/);
  assert.match(result.rows[1].value, /2 Hz – 4 Hz/);
});

test('resonance analysis ignores phase wraps and finds a true zero crossing', () => {
  const data = [point(1, .5, -.2), point(2, .5, -.05), point(3, .5, .02), point(4, -.5, .01), point(5, -.5, -.01)];
  const result = analyzeResonance(data);
  assert.equal(result.markerIndices[0], 2);
  assert.equal(result.markerIndices.includes(4), false);
});

test('peak analysis works directly on unsmoothed acquired samples', () => {
  const data = [point(1, 0, 0, .1), point(2, 0, 0, .8), point(3, 0, 0, .2), point(4, 0, 0, .9), point(5, 0, 0, .1)];
  const result = analyzePeak(data, { peakMetric: 's21-db', peakDirection: 'highest', peakCount: 2 });
  assert.deepEqual(result.markerIndices, [3, 1]);
});

test('low-pass analysis interpolates the minus three dB crossing', () => {
  const mags = [1, 1, Math.pow(10, -2 / 20), Math.pow(10, -4 / 20), Math.pow(10, -10 / 20)];
  const data = mags.map((magnitude, index) => point((index + 1) * 1e6, 0, 0, magnitude));
  const result = analyzeFilter(data, 'low-pass');
  assert.match(result.summary, /found/);
  assert.match(result.rows.find((row) => row.label === '−3 dB cutoff')?.value ?? '', /3.5 MHz/);
});

test('band-stop width is referenced to the passband baseline, not notch minimum', () => {
  const gains = [-1, -1, -40, -1, -1];
  const data = gains.map((gain, index) => point((index + 1) * 1e6, 0, 0, 10 ** (gain / 20)));
  const result = analyzeFilter(data, 'band-stop');
  const width = result.rows.find((row) => row.label.includes('Stop width'));
  assert.ok(width);
  assert.match(width.value, /MHz/);
  assert.doesNotMatch(width.label, /notch/);
});

test('transmission analyses report unavailable S21 instead of fabricated extrema', () => {
  const data = [point(1, 0, 0), point(2, 0, 0), point(3, 0, 0)];
  data.forEach((sample) => { sample.s21 = { re: Number.NaN, im: Number.NaN }; });
  assert.match(analyzeFilter(data, 'low-pass').summary, /unavailable/);
  assert.equal(analyzeOverview(data).rows.find((row) => row.label === 'S21')?.value, 'Unavailable in this dataset');
  const peak = analyzePeak(data, { peakMetric: 's21-db' });
  assert.match(peak.summary, /unavailable/);
  assert.deepEqual(peak.markerIndices, []);
});
