import { bandwidth, db, impedance, markerIndex, vswr, type SweepPoint } from './rf.ts';

export interface ComparisonAnalysis {
  pointCount: number;
  startFrequency: number;
  stopFrequency: number;
  minimumS11Db: number;
  minimumS11Frequency: number;
  minimumVswr: number;
  resistanceAtMinimum: number;
  reactanceAtMinimum: number;
  bandwidth10Db: number | null;
  minimumS21Db: number | null;
  maximumS21Db: number | null;
}

export interface PointwiseComparison {
  aligned: boolean;
  pointCount: number;
  maximumFrequencyDeltaHz: number | null;
  rmsS11ComplexDelta: number | null;
  maximumS11ComplexDelta: number | null;
  rmsS21ComplexDelta: number | null;
  maximumS21ComplexDelta: number | null;
  s21PointCount: number;
  reason: string | null;
}

export function analyzeSweep(points: SweepPoint[]): ComparisonAnalysis {
  if (!points.length) throw new Error('Cannot analyze an empty sweep.');
  const index = markerIndex(points);
  const point = points[index];
  const z = impedance(point.s11);
  const s21Values = points.map((candidate) => db(candidate.s21)).filter(Number.isFinite);
  const s21Range = s21Values.reduce((range, value) => ({ minimum: Math.min(range.minimum, value), maximum: Math.max(range.maximum, value) }), { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY });
  return {
    pointCount: points.length,
    startFrequency: points[0].frequency,
    stopFrequency: points.at(-1)!.frequency,
    minimumS11Db: db(point.s11),
    minimumS11Frequency: point.frequency,
    minimumVswr: vswr(point.s11),
    resistanceAtMinimum: z.re,
    reactanceAtMinimum: z.im,
    bandwidth10Db: bandwidth(points),
    minimumS21Db: s21Values.length ? s21Range.minimum : null,
    maximumS21Db: s21Values.length ? s21Range.maximum : null,
  };
}

export function commonFrequencySpan(sweeps: SweepPoint[][]): { start: number; stop: number } | null {
  if (!sweeps.length || sweeps.some((points) => !points.length)) return null;
  const start = Math.max(...sweeps.map((points) => points[0].frequency));
  const stop = Math.min(...sweeps.map((points) => points.at(-1)!.frequency));
  return stop >= start ? { start, stop } : null;
}

export function comparePointwise(reference: SweepPoint[], candidate: SweepPoint[]): PointwiseComparison {
  if (reference.length !== candidate.length) return {
    aligned: false, pointCount: 0, maximumFrequencyDeltaHz: null, rmsS11ComplexDelta: null, maximumS11ComplexDelta: null,
    rmsS21ComplexDelta: null, maximumS21ComplexDelta: null, s21PointCount: 0, reason: `Point counts differ (${reference.length} versus ${candidate.length}).`,
  };
  const frequencyDeltas = reference.map((point, index) => Math.abs(point.frequency - candidate[index].frequency));
  const maximumFrequencyDeltaHz = frequencyDeltas.reduce((maximum, value) => Math.max(maximum, value), 0);
  if (maximumFrequencyDeltaHz !== 0) return {
    aligned: false, pointCount: reference.length, maximumFrequencyDeltaHz, rmsS11ComplexDelta: null, maximumS11ComplexDelta: null,
    rmsS21ComplexDelta: null, maximumS21ComplexDelta: null, s21PointCount: 0, reason: 'Frequency grids are not identical; no interpolation was applied.',
  };
  const s11 = reference.map((point, index) => Math.hypot(point.s11.re - candidate[index].s11.re, point.s11.im - candidate[index].s11.im));
  const s21 = reference.map((point, index) => Math.hypot(point.s21.re - candidate[index].s21.re, point.s21.im - candidate[index].s21.im)).filter(Number.isFinite);
  const rms = (values: number[]) => values.length ? Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length) : null;
  return {
    aligned: true,
    pointCount: reference.length,
    maximumFrequencyDeltaHz,
    rmsS11ComplexDelta: rms(s11),
    maximumS11ComplexDelta: s11.reduce((maximum, value) => Math.max(maximum, value), 0),
    rmsS21ComplexDelta: rms(s21),
    maximumS21ComplexDelta: s21.length ? s21.reduce((maximum, value) => Math.max(maximum, value), 0) : null,
    s21PointCount: s21.length,
    reason: null,
  };
}
