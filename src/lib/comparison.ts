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
