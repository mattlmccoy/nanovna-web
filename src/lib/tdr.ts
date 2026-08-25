import type { Complex, SweepPoint } from './rf.ts';

export type TdrWindow = 'rectangular' | 'hann' | 'hamming' | 'blackman';
export type LowpassTdrFormat = 'reflection' | 'impedance' | 's11-db' | 'vswr';

export interface TdrBin {
  distanceMeters: number;
  magnitude: number;
}

export interface TdrResult {
  bins: TdrBin[];
  peakIndex: number;
  estimatedLengthMeters: number;
  frequencyStepHz: number;
  fftPoints: number;
  distanceBinMeters: number;
  rangeResolutionMeters: number;
  unambiguousRangeMeters: number;
  valueLabel: string;
  valueUnit: string;
}

const SPEED_OF_LIGHT = 299_792_458;

function windowWeight(kind: TdrWindow, index: number, count: number): number {
  if (kind === 'rectangular' || count <= 1) return 1;
  const angle = 2 * Math.PI * index / (count - 1);
  if (kind === 'hann') return 0.5 - 0.5 * Math.cos(angle);
  if (kind === 'hamming') return 0.54 - 0.46 * Math.cos(angle);
  return 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
}

function lowpassWindowWeight(kind: TdrWindow, index: number, count: number): number {
  if (kind === 'rectangular' || count <= 1) return 1;
  const angle = Math.PI * index / (count - 1);
  if (kind === 'hann') return 0.5 + 0.5 * Math.cos(angle);
  if (kind === 'hamming') return 0.54 + 0.46 * Math.cos(angle);
  return 0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function computeBandpassTdr(points: SweepPoint[], velocityFactor = 0.66, window: TdrWindow = 'hann'): TdrResult {
  if (points.length < 4) throw new Error('TDR requires at least four frequency samples.');
  if (!(velocityFactor > 0 && velocityFactor <= 1)) throw new Error('Velocity factor must be greater than 0 and no more than 1.');
  const step = points[1].frequency - points[0].frequency;
  if (!(step > 0)) throw new Error('TDR requires a strictly increasing frequency grid.');
  const tolerance = Math.max(1e-6 * Math.abs(step), 1e-6);
  for (let index = 2; index < points.length; index += 1) {
    if (Math.abs((points[index].frequency - points[index - 1].frequency) - step) > tolerance) throw new Error('TDR requires a uniform linear frequency grid; this dataset was not resampled.');
  }
  const fftPoints = Math.max(256, nextPowerOfTwo(points.length * 2));
  const weights = points.map((_, index) => windowWeight(window, index, points.length));
  const normalization = weights.reduce((sum, value) => sum + value, 0) || 1;
  const count = fftPoints;
  const bins: TdrBin[] = [];
  for (let timeIndex = 0; timeIndex < count; timeIndex += 1) {
    let re = 0;
    let im = 0;
    for (let frequencyIndex = 0; frequencyIndex < points.length; frequencyIndex += 1) {
      const angle = 2 * Math.PI * timeIndex * frequencyIndex / fftPoints;
      const sample = points[frequencyIndex].s11;
      const weight = weights[frequencyIndex];
      re += weight * (sample.re * Math.cos(angle) - sample.im * Math.sin(angle));
      im += weight * (sample.re * Math.sin(angle) + sample.im * Math.cos(angle));
    }
    bins.push({
      distanceMeters: SPEED_OF_LIGHT * velocityFactor * timeIndex / (2 * fftPoints * step),
      magnitude: Math.hypot(re, im) / normalization,
    });
  }
  let peakIndex = bins.length > 1 ? 1 : 0;
  for (let index = peakIndex + 1; index < bins.length; index += 1) if (bins[index].magnitude > bins[peakIndex].magnitude) peakIndex = index;
  const span = points.at(-1)!.frequency - points[0].frequency;
  return {
    bins,
    peakIndex,
    estimatedLengthMeters: bins[peakIndex]?.distanceMeters ?? 0,
    frequencyStepHz: step,
    fftPoints,
    distanceBinMeters: bins[1]?.distanceMeters ?? 0,
    rangeResolutionMeters: SPEED_OF_LIGHT * velocityFactor / (2 * Math.max(span, step)),
    unambiguousRangeMeters: SPEED_OF_LIGHT * velocityFactor / (2 * step),
    valueLabel: 'Bandpass reflection magnitude',
    valueUnit: 'ratio',
  };
}

export function computeLowpassTdr(points: SweepPoint[], velocityFactor = 0.66, window: TdrWindow = 'hann', format: LowpassTdrFormat = 'reflection'): TdrResult {
  if (points.length < 4) throw new Error('Low-pass TDR requires at least four frequency samples.');
  if (!(velocityFactor > 0 && velocityFactor <= 1)) throw new Error('Velocity factor must be greater than 0 and no more than 1.');
  const step = points[1].frequency - points[0].frequency;
  if (!(step > 0)) throw new Error('Low-pass TDR requires a strictly increasing frequency grid.');
  const tolerance = Math.max(1e-6 * Math.abs(step), 1e-6);
  if (Math.abs(points[0].frequency) > tolerance) throw new Error('Low-pass TDR requires an acquired DC sample at 0 Hz. Use bandpass mode for sweeps that start above DC.');
  for (let index = 2; index < points.length; index += 1) {
    if (Math.abs((points[index].frequency - points[index - 1].frequency) - step) > tolerance) throw new Error('Low-pass TDR requires a uniform linear frequency grid; this dataset was not resampled.');
  }
  const fftPoints = Math.max(256, nextPowerOfTwo((points.length * 2 - 2) * 2));
  const weights = points.map((_, index) => lowpassWindowWeight(window, index, points.length));
  const impulse: Complex[] = [];
  for (let timeIndex = 0; timeIndex < fftPoints / 2; timeIndex += 1) {
    let re = weights[0] * points[0].s11.re;
    let im = weights[0] * points[0].s11.im;
    let normalization = weights[0];
    for (let frequencyIndex = 1; frequencyIndex < points.length; frequencyIndex += 1) {
      const angle = 2 * Math.PI * timeIndex * frequencyIndex / fftPoints;
      const sample = points[frequencyIndex].s11;
      const weight = weights[frequencyIndex];
      re += 2 * weight * (sample.re * Math.cos(angle) - sample.im * Math.sin(angle));
      im += 2 * weight * (sample.re * Math.sin(angle) + sample.im * Math.cos(angle));
      normalization += 2 * weight;
    }
    impulse.push({ re: re / Math.max(normalization, 1e-12), im: im / Math.max(normalization, 1e-12) });
  }
  let cumulative = 0;
  const displayValues = impulse.map((sample) => {
    cumulative += sample.re;
    const gamma = cumulative;
    if (format === 'reflection') return sample.re;
    if (format === 'impedance') return Math.abs(50 * (1 + gamma) / (1 - gamma));
    const magnitude = Math.abs(gamma);
    if (format === 's11-db') return 20 * Math.log10(Math.max(magnitude, 1e-12));
    return magnitude >= 1 ? Number.NaN : (1 + magnitude) / (1 - magnitude);
  });
  let peakIndex = 1;
  for (let index = 2; index < impulse.length; index += 1) if (Math.abs(impulse[index].re) > Math.abs(impulse[peakIndex].re)) peakIndex = index;
  const distanceBinMeters = SPEED_OF_LIGHT * velocityFactor / (2 * fftPoints * step);
  const bins = displayValues.map((value, index) => ({ distanceMeters: index * distanceBinMeters, magnitude: value }));
  const labels: Record<LowpassTdrFormat, [string, string]> = {
    reflection: ['Low-pass reflection impulse', 'ratio'],
    impedance: ['Low-pass step impedance', 'Ω'],
    's11-db': ['Low-pass step S11', 'dB'],
    vswr: ['Low-pass step VSWR', 'ratio'],
  };
  const span = points.at(-1)!.frequency - points[0].frequency;
  return {
    bins,
    peakIndex,
    estimatedLengthMeters: bins[peakIndex]?.distanceMeters ?? 0,
    frequencyStepHz: step,
    fftPoints,
    distanceBinMeters,
    rangeResolutionMeters: SPEED_OF_LIGHT * velocityFactor / (2 * Math.max(span, step)),
    unambiguousRangeMeters: bins.at(-1)?.distanceMeters ?? 0,
    valueLabel: labels[format][0],
    valueUnit: labels[format][1],
  };
}
