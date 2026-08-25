import { impedance, type SweepPoint } from './rf.ts';

export interface SonificationOptions {
  baseFrequency: number;
  reactancePerOctave: number;
  pitchDirection: 1 | -1;
  fullVolumeChange: number;
  deadband: number;
  maxGain: number;
}

export interface SonificationTarget {
  valid: boolean;
  reason: string;
  resistanceDelta: number;
  reactanceDelta: number;
  totalChange: number;
  frequency: number;
  gain: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function gridsMatch(current: SweepPoint[], reference: SweepPoint[]): boolean {
  return current.length === reference.length && current.every((point, index) => point.frequency === reference[index].frequency);
}

export function computeSonificationTarget(current: SweepPoint, reference: SweepPoint, options: SonificationOptions): SonificationTarget {
  const currentZ = impedance(current.s11);
  const referenceZ = impedance(reference.s11);
  const values = [currentZ.re, currentZ.im, referenceZ.re, referenceZ.im];
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e6)) return { valid: false, reason: 'Impedance is nonfinite or outside the sonification limit.', resistanceDelta: Number.NaN, reactanceDelta: Number.NaN, totalChange: Number.NaN, frequency: 0, gain: 0 };
  const resistanceDelta = currentZ.re - referenceZ.re;
  const reactanceDelta = currentZ.im - referenceZ.im;
  const totalChange = Math.hypot(resistanceDelta, reactanceDelta);
  const level = clamp((totalChange - Math.max(0, options.deadband)) / Math.max(1e-6, options.fullVolumeChange), 0, 1);
  const frequency = clamp(options.baseFrequency * 2 ** clamp((reactanceDelta * options.pitchDirection) / Math.max(1e-6, options.reactancePerOctave), -3, 3), 80, 2000);
  return { valid: true, reason: level === 0 ? 'Inside the selected silent deadband.' : 'Ready', resistanceDelta, reactanceDelta, totalChange, frequency, gain: level * clamp(options.maxGain, 0, .05) };
}
