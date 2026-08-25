import type { Complex, SweepPoint } from './rf';

function requireAscending(points: SweepPoint[]): SweepPoint[] {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].frequency <= points[index - 1].frequency) throw new Error('Frequencies must be strictly increasing without duplicates.');
  }
  return points;
}

function pair(a: number, b: number, format: string): Complex {
  if (format === 'MA') {
    const angle = b * Math.PI / 180;
    return { re: a * Math.cos(angle), im: a * Math.sin(angle) };
  }
  if (format === 'DB') {
    const magnitude = 10 ** (a / 20);
    const angle = b * Math.PI / 180;
    return { re: magnitude * Math.cos(angle), im: magnitude * Math.sin(angle) };
  }
  return { re: a, im: b };
}

export function parseMeasurementFile(text: string, filename: string): SweepPoint[] {
  if (filename.toLowerCase().endsWith('.csv')) return parseCsv(text);
  return parseTouchstone(text, filename);
}

function parseCsv(text: string): SweepPoint[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.findIndex((line) => line.toLowerCase().startsWith('frequency_hz,'));
  if (header < 0) throw new Error('CSV must use the NanoVNA Web complex export columns.');
  const rows = lines.slice(header + 1).filter((line) => !line.startsWith('#')).map((line) => line.split(',').map(Number));
  if (rows.some((row) => row.length < 9 || !row.every(Number.isFinite))) throw new Error('CSV contains a malformed or incomplete measurement row.');
  const result = rows.map((row) => ({
    frequency: row[0],
    s11: { re: row[1], im: row[2] },
    s21: { re: row[5], im: row[6] },
  }));
  if (!result.length) throw new Error('No valid measurement rows were found in the CSV file.');
  return requireAscending(result);
}

function parseTouchstone(text: string, filename: string): SweepPoint[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/!.*/, '').trim()).filter(Boolean);
  if (lines.some((line) => line.startsWith('['))) throw new Error('Touchstone 2.0 keyword files are not yet supported; export as standard Touchstone 1.x.');
  const option = lines.find((line) => line.startsWith('#'))?.toUpperCase().split(/\s+/) ?? ['#', 'GHZ', 'S', 'MA', 'R', '50'];
  const unit = option[1] ?? 'GHZ';
  const parameter = option[2] ?? 'S';
  const format = option[3] ?? 'MA';
  if (parameter !== 'S') throw new Error('Only Touchstone S-parameter files are supported.');
  if (!['RI', 'MA', 'DB'].includes(format)) throw new Error(`Unsupported Touchstone format: ${format}`);
  const referenceIndex = option.indexOf('R');
  const reference = referenceIndex >= 0 ? Number(option[referenceIndex + 1]) : 50;
  if (!Number.isFinite(reference) || Math.abs(reference - 50) > 1e-9) throw new Error(`Only 50 Ω Touchstone reference impedance is supported; this file declares ${reference} Ω.`);
  const factor = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }[unit as 'HZ' | 'KHZ' | 'MHZ' | 'GHZ'];
  if (!factor) throw new Error(`Unsupported Touchstone frequency unit: ${unit}`);
  const ports = filename.toLowerCase().endsWith('.s2p') ? 2 : 1;
  const stride = ports === 2 ? 9 : 3;
  const tokens = lines.filter((line) => !line.startsWith('#')).flatMap((line) => line.split(/\s+/));
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Touchstone data contain a non-numeric or unsupported token.');
  if (values.length % stride !== 0) throw new Error(`Touchstone data end with an incomplete ${ports}-port record.`);
  const rows = Array.from({ length: Math.floor(values.length / stride) }, (_, index) => values.slice(index * stride, (index + 1) * stride));
  const result = rows.map((row) => ({
    frequency: row[0] * factor,
    s11: pair(row[1], row[2], format),
    s21: row.length >= 5 ? pair(row[3], row[4], format) : { re: Number.NaN, im: Number.NaN },
  }));
  if (!result.length) throw new Error('No valid S-parameter rows were found in the Touchstone file.');
  return requireAscending(result);
}
