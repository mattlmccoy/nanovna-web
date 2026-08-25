import type { Complex, SweepPoint } from './rf';

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
  return parseTouchstone(text);
}

function parseCsv(text: string): SweepPoint[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines[0]?.toLowerCase().startsWith('frequency_hz,')) throw new Error('CSV must use the NanoVNA Web raw export columns.');
  const result = lines.slice(1).map((line) => line.split(',').map(Number)).filter((row) => row.length >= 9 && row.every(Number.isFinite)).map((row) => ({
    frequency: row[0],
    s11: { re: row[1], im: row[2] },
    s21: { re: row[5], im: row[6] },
  }));
  if (!result.length) throw new Error('No valid measurement rows were found in the CSV file.');
  return result;
}

function parseTouchstone(text: string): SweepPoint[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/!.*/, '').trim()).filter(Boolean);
  const option = lines.find((line) => line.startsWith('#'))?.toUpperCase().split(/\s+/) ?? ['#', 'GHZ', 'S', 'MA', 'R', '50'];
  const unit = option[1] ?? 'GHZ';
  const parameter = option[2] ?? 'S';
  const format = option[3] ?? 'MA';
  if (parameter !== 'S') throw new Error('Only Touchstone S-parameter files are supported.');
  if (!['RI', 'MA', 'DB'].includes(format)) throw new Error(`Unsupported Touchstone format: ${format}`);
  const factor = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }[unit as 'HZ' | 'KHZ' | 'MHZ' | 'GHZ'];
  if (!factor) throw new Error(`Unsupported Touchstone frequency unit: ${unit}`);
  const rows = lines.filter((line) => !line.startsWith('#')).map((line) => line.split(/\s+/).map(Number)).filter((row) => row.length >= 3 && row.every(Number.isFinite));
  const result = rows.map((row) => ({
    frequency: row[0] * factor,
    s11: pair(row[1], row[2], format),
    s21: row.length >= 5 ? pair(row[3], row[4], format) : { re: Number.NaN, im: Number.NaN },
  }));
  if (!result.length) throw new Error('No valid S-parameter rows were found in the Touchstone file.');
  return result;
}
