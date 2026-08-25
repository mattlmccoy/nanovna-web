import type { SweepPoint } from './rf.ts';

export type TdrWindow = 'rectangular' | 'hann' | 'hamming' | 'blackman';

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
}

const SPEED_OF_LIGHT = 299_792_458;

function windowWeight(kind: TdrWindow, index: number, count: number): number {
  if (kind === 'rectangular' || count <= 1) return 1;
  const angle = 2 * Math.PI * index / (count - 1);
  if (kind === 'hann') return 0.5 - 0.5 * Math.cos(angle);
  if (kind === 'hamming') return 0.54 - 0.46 * Math.cos(angle);
  return 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
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
  const count = Math.floor(fftPoints / 2);
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
    unambiguousRangeMeters: bins.at(-1)?.distanceMeters ?? 0,
  };
}
