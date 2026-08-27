import type { SweepPoint } from './rf.ts';

export interface DifferentialFrequencyModel {
  frequency: number;
  meanRe: number;
  meanIm: number;
  covarianceReRe: number;
  covarianceReIm: number;
  covarianceImIm: number;
  inverseReRe: number;
  inverseReIm: number;
  inverseImIm: number;
}

export interface DifferentialBaseline {
  schemaVersion: 1;
  sweepCount: number;
  trainingCount: number;
  validationCount: number;
  threshold: number;
  validationFalseAlarmFraction: number;
  frequencies: DifferentialFrequencyModel[];
}

export interface DifferentialScore {
  valid: boolean;
  reason: string;
  frequency: number;
  deltaGammaRe: number;
  deltaGammaIm: number;
  distance: number;
  threshold: number;
  excess: number;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * probability));
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + fraction * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]);
}

export function frequencyGridsMatch(sweeps: SweepPoint[][]): boolean {
  if (!sweeps.length || !sweeps[0].length) return false;
  return sweeps.every((sweep) => sweep.length === sweeps[0].length && sweep.every((point, index) => point.frequency === sweeps[0][index].frequency));
}

function scorePoint(point: SweepPoint, model: DifferentialFrequencyModel) {
  const re = point.s11.re - model.meanRe;
  const im = point.s11.im - model.meanIm;
  const squared = re * re * model.inverseReRe + 2 * re * im * model.inverseReIm + im * im * model.inverseImIm;
  return Math.sqrt(Math.max(0, squared));
}

export function buildDifferentialBaseline(sweeps: SweepPoint[][], validationFraction = 0.2, thresholdQuantile = 0.995): DifferentialBaseline {
  if (sweeps.length < 20) throw new Error('At least 20 complete baseline sweeps are required.');
  if (!frequencyGridsMatch(sweeps)) throw new Error('Baseline sweeps must use one identical, nonempty frequency grid.');
  if (!(validationFraction >= 0.1 && validationFraction <= 0.4)) throw new Error('Validation fraction must be from 0.1 through 0.4.');
  const validationCount = Math.max(4, Math.round(sweeps.length * validationFraction));
  const training = sweeps.slice(0, sweeps.length - validationCount);
  const validation = sweeps.slice(sweeps.length - validationCount);
  const pointCount = training[0].length;
  const raw = Array.from({ length: pointCount }, (_, index) => {
    const samples = training.map((sweep) => sweep[index].s11);
    const meanRe = samples.reduce((sum, value) => sum + value.re, 0) / samples.length;
    const meanIm = samples.reduce((sum, value) => sum + value.im, 0) / samples.length;
    const denominator = Math.max(1, samples.length - 1);
    const covarianceReRe = samples.reduce((sum, value) => sum + (value.re - meanRe) ** 2, 0) / denominator;
    const covarianceReIm = samples.reduce((sum, value) => sum + (value.re - meanRe) * (value.im - meanIm), 0) / denominator;
    const covarianceImIm = samples.reduce((sum, value) => sum + (value.im - meanIm) ** 2, 0) / denominator;
    return { frequency: samples.length ? training[0][index].frequency : 0, meanRe, meanIm, covarianceReRe, covarianceReIm, covarianceImIm };
  });
  const variances = raw.flatMap((value) => [value.covarianceReRe, value.covarianceImIm]).filter((value) => Number.isFinite(value) && value > 0);
  const globalFloor = Math.max(1e-14, quantile(variances, 0.5) * 1e-3);
  const shrinkage = 0.1;
  const frequencies: DifferentialFrequencyModel[] = raw.map((value) => {
    const averageVariance = (value.covarianceReRe + value.covarianceImIm) / 2;
    const a = Math.max(globalFloor, (1 - shrinkage) * value.covarianceReRe + shrinkage * averageVariance);
    const c = Math.max(globalFloor, (1 - shrinkage) * value.covarianceImIm + shrinkage * averageVariance);
    const b = (1 - shrinkage) * value.covarianceReIm;
    const determinant = Math.max(globalFloor * globalFloor, a * c - b * b);
    return { ...value, covarianceReRe: a, covarianceReIm: b, covarianceImIm: c, inverseReRe: c / determinant, inverseReIm: -b / determinant, inverseImIm: a / determinant };
  });
  const validationScores = validation.flatMap((sweep) => sweep.map((point, index) => scorePoint(point, frequencies[index]))).filter(Number.isFinite);
  const threshold = quantile(validationScores, thresholdQuantile);
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('The baseline did not produce a finite detection threshold.');
  return {
    schemaVersion: 1,
    sweepCount: sweeps.length,
    trainingCount: training.length,
    validationCount,
    threshold,
    validationFalseAlarmFraction: validationScores.filter((score) => score > threshold).length / validationScores.length,
    frequencies,
  };
}

export function scoreDifferentialPoint(point: SweepPoint, baseline: DifferentialBaseline, index: number): DifferentialScore {
  const model = baseline.frequencies[index];
  if (!model || point.frequency !== model.frequency) return { valid: false, reason: 'The live frequency grid does not match the baseline.', frequency: point.frequency, deltaGammaRe: Number.NaN, deltaGammaIm: Number.NaN, distance: Number.NaN, threshold: baseline.threshold, excess: 0 };
  const deltaGammaRe = point.s11.re - model.meanRe;
  const deltaGammaIm = point.s11.im - model.meanIm;
  const distance = scorePoint(point, model);
  if (![deltaGammaRe, deltaGammaIm, distance].every(Number.isFinite)) return { valid: false, reason: 'The live residual is nonfinite.', frequency: point.frequency, deltaGammaRe, deltaGammaIm, distance, threshold: baseline.threshold, excess: 0 };
  return { valid: true, reason: distance > baseline.threshold ? 'Outside the measured baseline tolerance.' : 'Inside the measured baseline tolerance.', frequency: point.frequency, deltaGammaRe, deltaGammaIm, distance, threshold: baseline.threshold, excess: Math.max(0, distance - baseline.threshold) };
}

export function scoreDifferentialSweep(points: SweepPoint[], baseline: DifferentialBaseline): DifferentialScore[] {
  if (points.length !== baseline.frequencies.length) return [];
  return points.map((point, index) => scoreDifferentialPoint(point, baseline, index));
}
