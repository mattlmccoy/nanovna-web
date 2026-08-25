import { db, impedance, phase, vswr, type SweepPoint } from './rf.ts';

export type AnalysisMode = 'overview' | 'vswr' | 'resonance' | 'peak' | 'low-pass' | 'high-pass' | 'band-pass' | 'band-stop';
export type PeakMetric = 's11-db' | 's21-db' | 'vswr' | 'resistance' | 'reactance';

export interface AnalysisRow {
  label: string;
  value: string;
  index?: number;
}

export interface AnalysisResult {
  title: string;
  summary: string;
  rows: AnalysisRow[];
  markerIndices: number[];
  caution?: string;
}

export interface AnalysisOptions {
  vswrLimit?: number;
  peakMetric?: PeakMetric;
  peakDirection?: 'highest' | 'lowest';
  peakCount?: number;
}

function formatFrequency(value: number): string {
  if (!Number.isFinite(value)) return 'Not found';
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} GHz`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} MHz`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return 'Not found';
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

function nearestIndex(points: SweepPoint[], frequency: number): number {
  return points.reduce((best, point, index) => Math.abs(point.frequency - frequency) < Math.abs(points[best].frequency - frequency) ? index : best, 0);
}

function crossingFrequency(points: SweepPoint[], values: number[], left: number, level: number): number {
  const right = left + 1;
  if (right >= points.length || values[right] === values[left]) return points[left].frequency;
  const fraction = (level - values[left]) / (values[right] - values[left]);
  return points[left].frequency + Math.max(0, Math.min(1, fraction)) * (points[right].frequency - points[left].frequency);
}

function findCrossing(points: SweepPoint[], values: number[], start: number, direction: -1 | 1, level: number): { frequency: number; index: number } | null {
  for (let index = start; direction < 0 ? index > 0 : index < values.length - 1; index += direction) {
    const left = direction < 0 ? index - 1 : index;
    const a = values[left] - level;
    const b = values[left + 1] - level;
    if (a === 0 || b === 0 || a * b < 0) {
      const frequency = crossingFrequency(points, values, left, level);
      return { frequency, index: nearestIndex(points, frequency) };
    }
  }
  return null;
}

function localExtrema(values: number[], direction: 'highest' | 'lowest'): number[] {
  const signed = direction === 'highest' ? values : values.map((value) => -value);
  const extrema: number[] = [];
  for (let index = 1; index < signed.length - 1; index += 1) {
    if (!Number.isFinite(signed[index])) continue;
    if (signed[index] >= signed[index - 1] && signed[index] > signed[index + 1]) extrema.push(index);
  }
  return extrema;
}

function metricValues(points: SweepPoint[], metric: PeakMetric): { values: number[]; unit: string; label: string } {
  if (metric === 's11-db') return { values: points.map((point) => db(point.s11)), unit: 'dB', label: 'S11 log magnitude' };
  if (metric === 's21-db') return { values: points.map((point) => db(point.s21)), unit: 'dB', label: 'S21 gain' };
  if (metric === 'vswr') return { values: points.map((point) => vswr(point.s11)), unit: ':1', label: 'VSWR' };
  if (metric === 'resistance') return { values: points.map((point) => impedance(point.s11).re), unit: 'Ω', label: 'Resistance' };
  return { values: points.map((point) => impedance(point.s11).im), unit: 'Ω', label: 'Reactance' };
}

export function analyzePeak(points: SweepPoint[], options: AnalysisOptions = {}): AnalysisResult {
  const metric = options.peakMetric ?? 's21-db';
  const direction = options.peakDirection ?? 'highest';
  const count = Math.max(1, Math.min(10, Math.round(options.peakCount ?? 3)));
  const { values, unit, label } = metricValues(points, metric);
  let indices = localExtrema(values, direction);
  if (!indices.length && values.length) indices = [values.reduce((best, value, index) => direction === 'highest' ? (value > values[best] ? index : best) : (value < values[best] ? index : best), 0)];
  indices.sort((a, b) => direction === 'highest' ? values[b] - values[a] : values[a] - values[b]);
  indices = indices.slice(0, count);
  return {
    title: 'Peak search',
    summary: `${indices.length} ${direction === 'highest' ? 'maximum' : 'minimum'} ${indices.length === 1 ? 'feature' : 'features'} in raw ${label}.`,
    rows: indices.map((index, rank) => ({ label: `${rank + 1}. ${formatFrequency(points[index].frequency)}`, value: `${formatNumber(values[index])} ${unit}`, index })),
    markerIndices: indices,
    caution: 'Local extrema are detected on acquired samples without smoothing. Noise can therefore appear as a feature.',
  };
}

export function analyzeVswr(points: SweepPoint[], limit = 1.5): AnalysisResult {
  const values = points.map((point) => vswr(point.s11));
  const regions: Array<{ start: number; end: number; minimum: number }> = [];
  let start = -1;
  for (let index = 0; index <= values.length; index += 1) {
    if (index < values.length && values[index] < limit && start < 0) start = index;
    if ((index === values.length || values[index] >= limit) && start >= 0) {
      const end = index - 1;
      let minimum = start;
      for (let candidate = start + 1; candidate <= end; candidate += 1) if (values[candidate] < values[minimum]) minimum = candidate;
      regions.push({ start, end, minimum });
      start = -1;
    }
  }
  regions.sort((a, b) => values[a.minimum] - values[b.minimum]);
  const selected = regions.slice(0, 3);
  const rows = selected.flatMap((region, rank) => [
    { label: `Band ${rank + 1} minimum`, value: `${formatFrequency(points[region.minimum].frequency)} · ${formatNumber(values[region.minimum], 2)}:1`, index: region.minimum },
    { label: `Band ${rank + 1} span`, value: `${formatFrequency(points[region.start].frequency)} – ${formatFrequency(points[region.end].frequency)} · ${formatFrequency(points[region.end].frequency - points[region.start].frequency)}` },
  ]);
  return {
    title: 'VSWR analysis',
    summary: selected.length ? `${regions.length} region${regions.length === 1 ? '' : 's'} below ${formatNumber(limit, 2)}:1.` : `No acquired samples are below ${formatNumber(limit, 2)}:1.`,
    rows,
    markerIndices: selected.map((region) => region.minimum),
    caution: 'Band edges are acquired samples. Increase point density when an edge location matters.',
  };
}

export function analyzeResonance(points: SweepPoint[]): AnalysisResult {
  const phases = points.map((point) => phase(point.s11));
  const indices: number[] = [];
  for (let index = 0; index < phases.length - 1; index += 1) {
    if (Math.abs(phases[index + 1] - phases[index]) > 180) continue;
    if (phases[index] === 0 || phases[index] * phases[index + 1] < 0) indices.push(Math.abs(phases[index]) <= Math.abs(phases[index + 1]) ? index : index + 1);
  }
  const unique = [...new Set(indices)];
  return {
    title: 'Resonance analysis',
    summary: unique.length ? `${unique.length} S11 phase zero-crossing${unique.length === 1 ? '' : 's'} found.` : 'No S11 phase zero-crossing found in this span.',
    rows: unique.slice(0, 10).flatMap((index, rank) => {
      const z = impedance(points[index].s11);
      return [
        { label: `Resonance ${rank + 1}`, value: `${formatFrequency(points[index].frequency)} · ${formatNumber(z.re)} ${z.im < 0 ? '−' : '+'} j${formatNumber(Math.abs(z.im))} Ω`, index },
      ];
    }),
    markerIndices: unique.slice(0, 10),
    caution: 'This matches NanoVNA Saver’s S11 phase-crossing method and ignores ±180° phase wraps. Confirm with reactance and impedance plots.',
  };
}

function rolloff(points: SweepPoint[], gains: number[], a: { frequency: number; index: number } | null, b: { frequency: number; index: number } | null): { octave: number; decade: number } | null {
  if (!a || !b || a.frequency <= 0 || b.frequency <= 0 || a.frequency === b.frequency) return null;
  const attenuation = Math.abs(gains[a.index] - gains[b.index]);
  const factor = Math.max(a.frequency, b.frequency) / Math.min(a.frequency, b.frequency);
  if (factor <= 1) return null;
  const decade = attenuation / Math.log10(factor);
  return { octave: decade * Math.log10(2), decade };
}

export function analyzeFilter(points: SweepPoint[], mode: 'low-pass' | 'high-pass' | 'band-pass' | 'band-stop'): AnalysisResult {
  const gains = points.map((point) => db(point.s21));
  if (!gains.length) return { title: 'Filter analysis', summary: 'No S21 data.', rows: [], markerIndices: [] };
  const isStop = mode === 'band-stop';
  const peakIndex = gains.reduce((best, value, index) => isStop ? (value < gains[best] ? index : best) : (value > gains[best] ? index : best), 0);
  const peakGain = gains[peakIndex];
  const level3 = isStop ? peakGain + 3 : peakGain - 3;
  const level6 = isStop ? peakGain + 6 : peakGain - 6;
  const level10 = isStop ? peakGain + 10 : peakGain - 10;
  const level20 = isStop ? peakGain + 20 : peakGain - 20;
  const left3 = (mode === 'high-pass' || mode === 'band-pass' || mode === 'band-stop') ? findCrossing(points, gains, peakIndex, -1, level3) : null;
  const right3 = (mode === 'low-pass' || mode === 'band-pass' || mode === 'band-stop') ? findCrossing(points, gains, peakIndex, 1, level3) : null;
  const primary3 = mode === 'high-pass' ? left3 : right3;
  const primary10 = mode === 'high-pass' ? findCrossing(points, gains, peakIndex, -1, level10) : findCrossing(points, gains, peakIndex, 1, level10);
  const primary20 = mode === 'high-pass' ? findCrossing(points, gains, peakIndex, -1, level20) : findCrossing(points, gains, peakIndex, 1, level20);
  const rows: AnalysisRow[] = [{ label: isStop ? 'Minimum transmission' : 'Passband peak', value: `${formatFrequency(points[peakIndex].frequency)} · ${formatNumber(peakGain)} dB`, index: peakIndex }];
  const markerIndices = [peakIndex];
  if (left3) { rows.push({ label: 'Lower −3 dB edge', value: formatFrequency(left3.frequency), index: left3.index }); markerIndices.push(left3.index); }
  if (right3) { rows.push({ label: 'Upper −3 dB edge', value: formatFrequency(right3.frequency), index: right3.index }); markerIndices.push(right3.index); }
  if (left3 && right3) {
    const width = right3.frequency - left3.frequency;
    rows.push({ label: isStop ? '−3 dB stop width' : '−3 dB bandwidth', value: formatFrequency(width) });
    if (!isStop && width > 0) rows.push({ label: 'Loaded Q estimate', value: formatNumber(points[peakIndex].frequency / width, 2) });
  }
  if (primary3 && mode !== 'band-pass' && mode !== 'band-stop') rows.push({ label: '−3 dB cutoff', value: formatFrequency(primary3.frequency), index: primary3.index });
  const slope = rolloff(points, gains, primary10, primary20);
  if (slope) rows.push({ label: '10–20 dB roll-off', value: `${formatNumber(slope.octave, 2)} dB/oct · ${formatNumber(slope.decade, 2)} dB/dec` });
  const missing = (mode === 'band-pass' || mode === 'band-stop') ? (!left3 || !right3) : !primary3;
  return {
    title: `${mode.replace('-', ' ')} filter analysis`,
    summary: missing ? 'The sweep does not contain every required −3 dB crossing.' : 'Required −3 dB crossing points were found.',
    rows,
    markerIndices: [...new Set(markerIndices)],
    caution: 'Cutoff frequencies are linearly interpolated between adjacent raw samples; no smoothing or curve fitting is applied.',
  };
}

export function analyzeOverview(points: SweepPoint[]): AnalysisResult {
  if (!points.length) return { title: 'Sweep overview', summary: 'No data.', rows: [], markerIndices: [] };
  const s11 = points.map((point) => db(point.s11));
  const s21 = points.map((point) => db(point.s21));
  const swr = points.map((point) => vswr(point.s11));
  const minS11 = s11.reduce((best, value, index) => value < s11[best] ? index : best, 0);
  const minVswr = swr.reduce((best, value, index) => value < swr[best] ? index : best, 0);
  const maxS21 = s21.reduce((best, value, index) => value > s21[best] ? index : best, 0);
  const minS21 = s21.reduce((best, value, index) => value < s21[best] ? index : best, 0);
  return {
    title: 'Sweep overview',
    summary: `${points.length} raw samples from ${formatFrequency(points[0].frequency)} to ${formatFrequency(points.at(-1)!.frequency)}.`,
    rows: [
      { label: 'Best S11 match', value: `${formatFrequency(points[minS11].frequency)} · ${formatNumber(s11[minS11])} dB`, index: minS11 },
      { label: 'Minimum VSWR', value: `${formatFrequency(points[minVswr].frequency)} · ${formatNumber(swr[minVswr], 2)}:1`, index: minVswr },
      { label: 'Maximum S21', value: `${formatFrequency(points[maxS21].frequency)} · ${formatNumber(s21[maxS21])} dB`, index: maxS21 },
      { label: 'Minimum S21', value: `${formatFrequency(points[minS21].frequency)} · ${formatNumber(s21[minS21])} dB`, index: minS21 },
    ],
    markerIndices: [...new Set([minS11, minVswr, maxS21, minS21])],
  };
}

export function runAnalysis(points: SweepPoint[], mode: AnalysisMode, options: AnalysisOptions = {}): AnalysisResult {
  if (mode === 'overview') return analyzeOverview(points);
  if (mode === 'vswr') return analyzeVswr(points, options.vswrLimit ?? 1.5);
  if (mode === 'resonance') return analyzeResonance(points);
  if (mode === 'peak') return analyzePeak(points, options);
  return analyzeFilter(points, mode);
}
