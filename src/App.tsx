import { useEffect, useMemo, useRef, useState } from 'react';
import { NanoVNAConnection } from './lib/nanovna';
import { parseMeasurementFile } from './lib/files';
import { bandwidth, db, demoSweep, impedance, magnitude, markerIndex, phase, reflectedPowerPercent, type Complex, type SweepPoint, vswr } from './lib/rf';

type ViewMode = 'smith' | 'return-loss' | 's21-polar' | 'resistance-reactance' | 'admittance' | 'phase' | 'vswr' | 's21-gain' | 's11-magnitude' | 's11-z-magnitude' | 's11-components' | 's21-components' | 's11-group-delay' | 's21-group-delay' | 'q-factor' | 'capacitance' | 'inductance' | 's21-series-z' | 's21-shunt-z';
type Marker = { id: number; index: number; color: string };

const VIEW_LABELS: Record<ViewMode, string> = {
  smith: 'S11 Smith Chart',
  'return-loss': 'S11 / S21 Log Magnitude (dB)',
  's21-polar': 'S21 Polar Plot',
  'resistance-reactance': 'S11 Resistance + Reactance (Ω)',
  admittance: 'S11 Admittance G + jB (mS)',
  phase: 'S11 / S21 Phase (°)',
  vswr: 'S11 VSWR (ratio)',
  's21-gain': 'S21 Gain (dB)',
  's11-magnitude': 'S11 Magnitude |Γ| (ratio)',
  's11-z-magnitude': 'S11 Impedance |Z| (Ω)',
  's11-components': 'S11 Real + Imaginary (ratio)',
  's21-components': 'S21 Real + Imaginary (ratio)',
  's11-group-delay': 'S11 Group Delay (ns)',
  's21-group-delay': 'S21 Group Delay (ns)',
  'q-factor': 'S11 Quality Factor Q (ratio)',
  capacitance: 'S11 Series Capacitance (pF)',
  inductance: 'S11 Series Inductance (nH)',
  's21-series-z': 'S21 Series-model R + jX (Ω)',
  's21-shunt-z': 'S21 Shunt-model R + jX (Ω)',
};

const TRACE = { magenta: '#a9008b', yellow: '#e2aa00', cyan: '#009d9a', red: '#d7191c', green: '#20aa35', blue: '#173de3' };
const DEFAULT_MARKER_COLORS = [TRACE.blue, TRACE.red, TRACE.green, TRACE.magenta, TRACE.yellow, TRACE.cyan];

function parseFrequency(value: string): number {
  const match = value.trim().match(/^([0-9]*\.?[0-9]+)\s*([kKmMgG]?)\s*(?:[hH][zZ])?$/);
  if (!match) throw new Error(`Invalid frequency: ${value}`);
  const factor = { '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 }[match[2]] ?? 1;
  return Number(match[1]) * factor;
}

function formatFrequency(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(6)} GHz`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(6)} MHz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(3)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function formatAxisFrequency(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GHz`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} MHz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function admittance(gamma: Complex): Complex {
  const z = impedance(gamma);
  const divisor = z.re ** 2 + z.im ** 2;
  return { re: z.re / divisor, im: -z.im / divisor };
}

function s21Impedance(value: Complex, shunt: boolean, z0 = 50): Complex {
  const oneMinus = { re: 1 - value.re, im: -value.im };
  const divide = (a: Complex, b: Complex): Complex => {
    const denominator = b.re ** 2 + b.im ** 2;
    return { re: (a.re * b.re + a.im * b.im) / denominator, im: (a.im * b.re - a.re * b.im) / denominator };
  };
  const result = shunt ? divide(value, oneMinus) : divide(oneMinus, value);
  const factor = shunt ? z0 / 2 : z0 * 2;
  return { re: result.re * factor, im: result.im * factor };
}

function groupDelay(points: SweepPoint[], channel: 's11' | 's21'): number[] {
  const angles = points.map((point) => Math.atan2(point[channel].im, point[channel].re));
  for (let index = 1; index < angles.length; index += 1) {
    while (angles[index] - angles[index - 1] > Math.PI) angles[index] -= Math.PI * 2;
    while (angles[index] - angles[index - 1] < -Math.PI) angles[index] += Math.PI * 2;
  }
  return angles.map((_, index) => {
    const left = Math.max(0, index - 1);
    const right = Math.min(points.length - 1, index + 1);
    const deltaOmega = 2 * Math.PI * (points[right].frequency - points[left].frequency);
    return deltaOmega ? -(angles[right] - angles[left]) / deltaOmega * 1e9 : 0;
  });
}

function signedValue(value: number, digits: number, unit = ''): string {
  if (!Number.isFinite(value)) return `—${unit ? ` ${unit}` : ''}`;
  return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function chartMarkerValue(mode: ViewMode, point: SweepPoint, index: number, delayValues: number[] | null): string {
  const z = impedance(point.s11);
  const y = admittance(point.s11);
  if (mode === 'smith') return `Z ${formatNumber(z.re, 2)} ${signedValue(z.im, 2).replace(/^[+−]/, (sign) => `${sign} j`)} Ω`;
  if (mode === 'return-loss') return `S11 ${formatNumber(db(point.s11), 2)} dB · S21 ${formatNumber(db(point.s21), 2)} dB`;
  if (mode === 's21-polar') return `|S21| ${formatNumber(magnitude(point.s21), 3)} ratio · ∠ ${formatNumber(phase(point.s21), 1)}°`;
  if (mode === 'resistance-reactance') return `R ${formatNumber(z.re, 2)} Ω · X ${signedValue(z.im, 2, 'Ω')}`;
  if (mode === 'admittance') return `G ${formatNumber(y.re * 1000, 2)} mS · B ${signedValue(y.im * 1000, 2, 'mS')}`;
  if (mode === 'phase') return `S11 ${formatNumber(phase(point.s11), 1)}° · S21 ${formatNumber(phase(point.s21), 1)}°`;
  if (mode === 'vswr') return `VSWR ${Number.isFinite(vswr(point.s11)) ? `${formatNumber(vswr(point.s11), 3)}:1` : '∞:1'}`;
  if (mode === 's21-gain') return `S21 ${formatNumber(db(point.s21), 2)} dB`;
  if (mode === 's11-magnitude') return `|Γ| ${formatNumber(magnitude(point.s11), 4)} ratio`;
  if (mode === 's11-z-magnitude') return `|Z| ${formatNumber(magnitude(z), 2)} Ω`;
  if (mode === 's11-components') return `Re ${signedValue(point.s11.re, 4)} · Im ${signedValue(point.s11.im, 4)} ratio`;
  if (mode === 's21-components') return `Re ${signedValue(point.s21.re, 4)} · Im ${signedValue(point.s21.im, 4)} ratio`;
  if (mode === 's11-group-delay' || mode === 's21-group-delay') return `Delay ${formatNumber(delayValues?.[index] ?? Number.NaN, 3)} ns`;
  if (mode === 'q-factor') return `Q ${z.re === 0 ? '—' : formatNumber(Math.abs(z.im / z.re), 3)} dimensionless`;
  if (mode === 'capacitance') return `C ${z.im < 0 ? formatNumber(-1 / (2 * Math.PI * point.frequency * z.im) * 1e12, 3) : '—'} pF`;
  if (mode === 'inductance') return `L ${z.im > 0 ? formatNumber(z.im / (2 * Math.PI * point.frequency) * 1e9, 3) : '—'} nH`;
  const model = s21Impedance(point.s21, mode === 's21-shunt-z');
  return `R ${formatNumber(model.re, 2)} Ω · X ${signedValue(model.im, 2, 'Ω')}`;
}

function drawCanvasMarker(ctx: CanvasRenderingContext2D, position: { x: number; y: number }, color: string, label: number, dark: boolean, active: boolean) {
  if (active) {
    ctx.strokeStyle = dark ? '#f4e65d' : '#6f6300';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(position.x, position.y - 4, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(position.x, position.y);
  ctx.lineTo(position.x - 5, position.y - 9);
  ctx.lineTo(position.x + 5, position.y - 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dark ? '#f1f1ed' : '#111';
  ctx.font = `${active ? 'bold ' : ''}10px Arial, sans-serif`;
  ctx.fillText(`M${label + 1}`, position.x + 6, position.y - 4);
}

function primaryTrace(mode: ViewMode, points: SweepPoint[]): number[] {
  if (mode === 'return-loss') return points.map((point) => db(point.s11));
  if (mode === 's21-gain') return points.map((point) => db(point.s21));
  if (mode === 'phase') return points.map((point) => phase(point.s11));
  if (mode === 'vswr') return points.map((point) => vswr(point.s11)).map((value) => Number.isFinite(value) ? value : Number.NaN);
  if (mode === 'resistance-reactance') return points.map((point) => impedance(point.s11).re);
  if (mode === 'admittance') return points.map((point) => admittance(point.s11).re * 1000);
  if (mode === 's11-magnitude') return points.map((point) => magnitude(point.s11));
  if (mode === 's11-z-magnitude') return points.map((point) => magnitude(impedance(point.s11)));
  if (mode === 's11-components') return points.map((point) => point.s11.re);
  if (mode === 's21-components') return points.map((point) => point.s21.re);
  if (mode === 's11-group-delay') return groupDelay(points, 's11');
  if (mode === 's21-group-delay') return groupDelay(points, 's21');
  if (mode === 'q-factor') return points.map((point) => { const z = impedance(point.s11); return z.re === 0 ? Number.NaN : Math.abs(z.im / z.re); });
  if (mode === 'capacitance') return points.map((point) => { const x = impedance(point.s11).im; return x < 0 ? -1 / (2 * Math.PI * point.frequency * x) * 1e12 : Number.NaN; });
  if (mode === 'inductance') return points.map((point) => { const x = impedance(point.s11).im; return x > 0 ? x / (2 * Math.PI * point.frequency) * 1e9 : Number.NaN; });
  if (mode === 's21-series-z' || mode === 's21-shunt-z') return points.map((point) => s21Impedance(point.s21, mode === 's21-shunt-z').re);
  return [];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Chart({ mode, points, reference, markers, activeMarker, theme, onMarkerChange, onActiveMarkerChange, onModeChange }: {
  mode: ViewMode;
  points: SweepPoint[];
  reference: SweepPoint[] | null;
  markers: Marker[];
  activeMarker: number;
  theme: 'light' | 'dark';
  onMarkerChange: (marker: number, index: number) => void;
  onActiveMarkerChange: (marker: number) => void;
  onModeChange: (mode: ViewMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<{ x: number; y: number; w: number; h: number; smith: boolean }>({ x: 0, y: 0, w: 0, h: 0, smith: false });
  const pointPositionsRef = useRef<Array<{ x: number; y: number }>>([]);
  const draggingMarkerRef = useRef<number | null>(null);
  const [resizeVersion, setResizeVersion] = useState(0);
  const delayValues = useMemo(() => {
    if (mode === 's11-group-delay') return groupDelay(points, 's11');
    if (mode === 's21-group-delay') return groupDelay(points, 's21');
    return null;
  }, [mode, points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setResizeVersion((version) => version + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.floor(bounds.width * ratio);
    canvas.height = Math.floor(bounds.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const width = bounds.width;
    const height = bounds.height;
    const dark = theme === 'dark';
    const canvasGrid = dark ? '#4a4c50' : '#c8c8c8';
    const canvasText = dark ? '#d9d9d5' : '#333333';
    ctx.fillStyle = dark ? '#17181a' : '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.font = '10px Arial, sans-serif';
    ctx.lineWidth = 1;
    const pad = { left: 43, right: 16, top: 16, bottom: 30 };
    const area = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
    geometryRef.current = { ...area, smith: mode === 'smith' || mode === 's21-polar' };

    const line = (values: Array<{ x: number; y: number }>, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      let drawing = false;
      values.forEach((point) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { drawing = false; return; }
        if (drawing) ctx.lineTo(point.x, point.y);
        else { ctx.moveTo(point.x, point.y); drawing = true; }
      });
      ctx.stroke();
    };

    if (mode === 'smith' || mode === 's21-polar') {
      const radius = Math.min(area.w, area.h) * 0.46;
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      ctx.strokeStyle = dark ? '#5f6268' : '#a7a7a7';
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
      if (mode === 'smith') {
        [0.2, 0.5, 1, 2, 5].forEach((r) => {
          const center = cx + radius * r / (1 + r);
          const circleRadius = radius / (1 + r);
          ctx.beginPath(); ctx.arc(center, cy, circleRadius, 0, Math.PI * 2); ctx.stroke();
        });
        [0.2, 0.5, 1, 2, 5].forEach((x) => {
          const circleRadius = radius / x;
          [1, -1].forEach((sign) => {
            ctx.save(); ctx.beginPath(); ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2); ctx.clip();
            ctx.beginPath(); ctx.arc(cx + radius, cy + sign * circleRadius, circleRadius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
          });
        });
      } else {
        [0.25, 0.5, 0.75].forEach((r) => { ctx.beginPath(); ctx.arc(cx, cy, radius * r, 0, Math.PI * 2); ctx.stroke(); });
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); ctx.stroke(); }
      }
      const channel = mode === 'smith' ? 's11' : 's21';
      const positions = points.map((point) => ({ x: cx + point[channel].re * radius, y: cy - point[channel].im * radius }));
      if (reference?.length) {
        const referencePositions = reference.map((point) => ({ x: cx + point[channel].re * radius, y: cy - point[channel].im * radius }));
        ctx.setLineDash([4, 3]); line(referencePositions, dark ? '#b0b0aa' : '#777777'); ctx.setLineDash([]);
      }
      line(positions, mode === 'smith' ? TRACE.magenta : TRACE.yellow);
      pointPositionsRef.current = positions;
      return;
    }

    let min = -50;
    let max = 0;
    let series: Array<{ values: number[]; color: string; label: string; unit: string }> = [];
    if (mode === 'return-loss') series = [
      { values: points.map((point) => db(point.s11)), color: TRACE.magenta, label: 'S11', unit: 'dB' },
      { values: points.map((point) => db(point.s21)), color: TRACE.yellow, label: 'S21', unit: 'dB' },
    ];
    if (mode === 's21-gain') series = [{ values: points.map((point) => db(point.s21)), color: TRACE.yellow, label: 'S21', unit: 'dB' }];
    if (mode === 'phase') { min = -180; max = 180; series = [
      { values: points.map((point) => phase(point.s11)), color: TRACE.magenta, label: 'S11', unit: '°' },
      { values: points.map((point) => phase(point.s21)), color: TRACE.yellow, label: 'S21', unit: '°' },
    ]; }
    if (mode === 'vswr') { const values = points.map((point) => vswr(point.s11)).map((value) => Number.isFinite(value) ? value : Number.NaN); min = 1; max = Math.min(20, Math.max(3, ...values.filter(Number.isFinite))); series = [{ values, color: TRACE.blue, label: 'VSWR', unit: 'ratio' }]; }
    if (mode === 'resistance-reactance') {
      const z = points.map((point) => impedance(point.s11));
      const extent = Math.max(100, ...z.flatMap((value) => [Math.abs(value.re), Math.abs(value.im)]).filter((value) => Number.isFinite(value)));
      min = -extent; max = extent;
      series = [{ values: z.map((value) => value.re), color: TRACE.cyan, label: 'R', unit: 'Ω' }, { values: z.map((value) => value.im), color: TRACE.red, label: 'X', unit: 'Ω' }];
    }
    if (mode === 'admittance') {
      const y = points.map((point) => admittance(point.s11));
      const extent = Math.max(20, ...y.flatMap((value) => [Math.abs(value.re * 1000), Math.abs(value.im * 1000)]).filter((value) => Number.isFinite(value)));
      min = -extent; max = extent;
      series = [{ values: y.map((value) => value.re * 1000), color: TRACE.green, label: 'G', unit: 'mS' }, { values: y.map((value) => value.im * 1000), color: TRACE.red, label: 'B', unit: 'mS' }];
    }
    if (mode === 's11-magnitude') { min = 0; max = Math.max(1, ...points.map((point) => magnitude(point.s11))); series = [{ values: points.map((point) => magnitude(point.s11)), color: TRACE.magenta, label: '|Γ|', unit: 'ratio' }]; }
    if (mode === 's11-z-magnitude') { const values = points.map((point) => magnitude(impedance(point.s11))); min = 0; max = Math.max(100, ...values.filter(Number.isFinite)); series = [{ values, color: TRACE.cyan, label: '|Z|', unit: 'Ω' }]; }
    if (mode === 's11-components' || mode === 's21-components') { const channel = mode === 's11-components' ? 's11' : 's21'; min = -1; max = 1; series = [{ values: points.map((point) => point[channel].re), color: TRACE.cyan, label: 'Real', unit: 'ratio' }, { values: points.map((point) => point[channel].im), color: TRACE.red, label: 'Imag', unit: 'ratio' }]; }
    if (mode === 's11-group-delay' || mode === 's21-group-delay') { const channel = mode === 's11-group-delay' ? 's11' : 's21'; const values = groupDelay(points, channel); const extent = Math.max(1, ...values.map(Math.abs).filter(Number.isFinite)); min = -extent; max = extent; series = [{ values, color: channel === 's11' ? TRACE.magenta : TRACE.yellow, label: 'Delay', unit: 'ns' }]; }
    if (mode === 'q-factor') { const values = points.map((point) => { const z = impedance(point.s11); return z.re === 0 ? Number.NaN : Math.abs(z.im / z.re); }); min = 0; max = Math.max(5, ...values.filter(Number.isFinite)); series = [{ values, color: TRACE.blue, label: 'Q', unit: 'ratio' }]; }
    if (mode === 'capacitance') { const values = points.map((point) => { const x = impedance(point.s11).im; return x < 0 ? -1 / (2 * Math.PI * point.frequency * x) * 1e12 : Number.NaN; }); min = 0; max = Math.max(100, ...values.filter(Number.isFinite)); series = [{ values, color: TRACE.green, label: 'C', unit: 'pF' }]; }
    if (mode === 'inductance') { const values = points.map((point) => { const x = impedance(point.s11).im; return x > 0 ? x / (2 * Math.PI * point.frequency) * 1e9 : Number.NaN; }); min = 0; max = Math.max(100, ...values.filter(Number.isFinite)); series = [{ values, color: TRACE.yellow, label: 'L', unit: 'nH' }]; }
    if (mode === 's21-series-z' || mode === 's21-shunt-z') { const z = points.map((point) => s21Impedance(point.s21, mode === 's21-shunt-z')); const extent = Math.max(100, ...z.flatMap((value) => [Math.abs(value.re), Math.abs(value.im)]).filter(Number.isFinite)); min = -extent; max = extent; series = [{ values: z.map((value) => value.re), color: TRACE.cyan, label: 'R', unit: 'Ω' }, { values: z.map((value) => value.im), color: TRACE.red, label: 'X', unit: 'Ω' }]; }

    ctx.strokeStyle = canvasGrid;
    ctx.fillStyle = canvasText;
    for (let i = 0; i <= 5; i += 1) {
      const y = area.y + area.h * i / 5;
      ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
      const value = max - (max - min) * i / 5;
      ctx.fillText(formatNumber(value, Math.abs(value) < 10 ? 1 : 0), 3, y + 3);
    }
    for (let i = 0; i <= 5; i += 1) {
      const x = area.x + area.w * i / 5;
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      const frequency = points[0].frequency + (points.at(-1)!.frequency - points[0].frequency) * i / 5;
      ctx.fillText(formatAxisFrequency(frequency), Math.min(width - 58, x - 18), height - 8);
    }
    const positionsBySeries = series.map(({ values, color }) => {
      const positions = values.map((value, index) => ({
        x: area.x + area.w * (points[index].frequency - points[0].frequency) / Math.max(1, points.at(-1)!.frequency - points[0].frequency),
        y: area.y + area.h * (max - Math.max(min, Math.min(max, value))) / (max - min),
      }));
      line(positions, color);
      return positions;
    });
    if (reference?.length) {
      const values = primaryTrace(mode, reference);
      const positions = values.map((value, index) => ({
        x: area.x + area.w * (reference[index].frequency - points[0].frequency) / Math.max(1, points.at(-1)!.frequency - points[0].frequency),
        y: area.y + area.h * (max - Math.max(min, Math.min(max, value))) / (max - min),
      }));
      ctx.setLineDash([4, 3]); line(positions, dark ? '#b0b0aa' : '#777777'); ctx.setLineDash([]);
      ctx.fillStyle = dark ? '#c7c7c2' : '#555'; ctx.fillText('Ref', area.x + area.w - 24, 6);
    }
    pointPositionsRef.current = positionsBySeries[0] ?? [];
    series.forEach((item, index) => {
      ctx.fillStyle = item.color;
      ctx.fillRect(area.x + index * 86, 2, 12, 2);
      ctx.fillStyle = dark ? '#deded9' : '#222';
      ctx.fillText(`${item.label} (${item.unit})`, area.x + 16 + index * 86, 6);
    });
  }, [mode, points, reference, resizeVersion, theme]);

  useEffect(() => {
    const base = canvasRef.current;
    const overlay = markerCanvasRef.current;
    if (!base || !overlay) return;
    const ratio = window.devicePixelRatio || 1;
    const bounds = base.getBoundingClientRect();
    overlay.width = Math.floor(bounds.width * ratio);
    overlay.height = Math.floor(bounds.height * ratio);
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const dark = theme === 'dark';
    markers.forEach((marker, index) => {
      const position = pointPositionsRef.current[marker.index];
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) drawCanvasMarker(ctx, position, marker.color, index, dark, activeMarker === index);
    });
  }, [activeMarker, markers, mode, points, resizeVersion, theme]);

  function moveMarkerToPointer(marker: number, clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const area = geometryRef.current;
    if (!area.smith) {
      const frequency = points[0].frequency + (x - area.x) / area.w * (points.at(-1)!.frequency - points[0].frequency);
      const index = points.reduce((best, point, candidate) => Math.abs(point.frequency - frequency) < Math.abs(points[best].frequency - frequency) ? candidate : best, 0);
      onMarkerChange(marker, index);
      return;
    }
    const radius = Math.min(area.w, area.h) * 0.46;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const channel = mode === 'smith' ? 's11' : 's21';
    const index = points.reduce((best, point, candidate) => {
      const px = cx + point[channel].re * radius;
      const py = cy - point[channel].im * radius;
      const distance = (px - x) ** 2 + (py - y) ** 2;
      const current = points[best][channel];
      const bx = cx + current.re * radius;
      const by = cy - current.im * radius;
      return distance < (bx - x) ** 2 + (by - y) ** 2 ? candidate : best;
    }, 0);
    onMarkerChange(marker, index);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const closest = markers.reduce((best, marker, index) => {
      const position = pointPositionsRef.current[marker.index];
      if (!position) return best;
      const distance = Math.hypot(position.x - x, position.y - y);
      return distance < best.distance ? { index, distance } : best;
    }, { index: activeMarker, distance: Number.POSITIVE_INFINITY });
    const marker = closest.distance <= 20 ? closest.index : activeMarker;
    draggingMarkerRef.current = marker;
    onActiveMarkerChange(marker);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveMarkerToPointer(marker, event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (draggingMarkerRef.current === null) return;
    moveMarkerToPointer(draggingMarkerRef.current, event.clientX, event.clientY);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingMarkerRef.current = null;
  }

  function savePng() {
    const base = canvasRef.current;
    const overlay = markerCanvasRef.current;
    if (!base || !overlay) return;
    const composite = document.createElement('canvas');
    composite.width = base.width;
    composite.height = base.height;
    const ctx = composite.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    composite.toBlob((blob) => blob && downloadBlob(blob, `${mode}-${Date.now()}.png`), 'image/png');
  }

  return (
    <section className="chart-panel">
      <div className="chart-titlebar">
        <select value={mode} onChange={(event) => onModeChange(event.target.value as ViewMode)} aria-label="Diagnostic view">
          {Object.entries(VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button onClick={savePng}>Save PNG</button>
      </div>
      <div className="chart-plot">
        <canvas className="trace-canvas" ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} aria-label={VIEW_LABELS[mode]} />
        <canvas className="marker-canvas" ref={markerCanvasRef} aria-hidden="true" />
        <div className="chart-trackers" aria-label={`${VIEW_LABELS[mode]} marker readouts`}>
          {markers.map((marker, index) => {
            const point = points[marker.index];
            return <button className={`chart-tracker ${activeMarker === index ? 'active' : ''}`} style={{ borderLeftColor: marker.color }} onClick={() => onActiveMarkerChange(index)} key={marker.id}>
              <b style={{ color: marker.color }}>M{index + 1}</b>
              <span>{formatFrequency(point.frequency)}</span>
              <span>{chartMarkerValue(mode, point, marker.index, delayValues)}</span>
            </button>;
          })}
        </div>
      </div>
    </section>
  );
}

function MarkerReadout({ point, number }: { point: SweepPoint; number: number }) {
  const z = impedance(point.s11);
  const y = admittance(point.s11);
  return (
    <fieldset className="marker-readout">
      <legend>Marker {number}</legend>
      <div><span>Frequency:</span><b>{formatFrequency(point.frequency)}</b></div>
      <div><span>S11 log mag:</span><b>{formatNumber(db(point.s11))} dB</b></div>
      <div><span>Est. reflected power:</span><b>{formatNumber(reflectedPowerPercent(point.s11), reflectedPowerPercent(point.s11) < 0.1 ? 4 : 2)} % incident</b></div>
      <div><span>S11 phase:</span><b>{formatNumber(phase(point.s11), 1)}°</b></div>
      <div><span>VSWR:</span><b>{Number.isFinite(vswr(point.s11)) ? `${formatNumber(vswr(point.s11))}:1` : '∞:1'}</b></div>
      <div><span>Impedance:</span><b>{formatNumber(z.re)} {z.im < 0 ? '−' : '+'} j{formatNumber(Math.abs(z.im))} Ω</b></div>
      <div><span>Admittance:</span><b>{formatNumber(y.re * 1000)} {y.im < 0 ? '−' : '+'} j{formatNumber(Math.abs(y.im * 1000))} mS</b></div>
      <div><span>S21 gain:</span><b>{formatNumber(db(point.s21))} dB</b></div>
      <div><span>S21 phase:</span><b>{formatNumber(phase(point.s21), 1)}°</b></div>
    </fieldset>
  );
}

export default function App() {
  const connectionRef = useRef<NanoVNAConnection | null>(null);
  const stopRequestedRef = useRef(false);
  const markerIdRef = useRef(4);
  const [points, setPoints] = useState(() => demoSweep(1e6, 51e6, 1001));
  const pointsRef = useRef(points);
  const [reference, setReference] = useState<SweepPoint[] | null>(null);
  const [start, setStart] = useState('1M');
  const [stop, setStop] = useState('51M');
  const [pointCount, setPointCount] = useState(101);
  const [segments, setSegments] = useState(10);
  const [connected, setConnected] = useState(false);
  const [firmware, setFirmware] = useState('No device');
  const [calibrationState, setCalibrationState] = useState('Unknown');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [continuous, setContinuous] = useState(false);
  const [message, setMessage] = useState('Demo data shown. Browser smoothing OFF. Device calibration state unknown.');
  const initial = markerIndex(points);
  const [markers, setMarkers] = useState<Marker[]>([
    { id: 1, index: initial, color: TRACE.blue },
    { id: 2, index: Math.round(points.length * 0.28), color: TRACE.red },
    { id: 3, index: Math.round(points.length * 0.84), color: TRACE.green },
  ]);
  const [activeMarker, setActiveMarker] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [views, setViews] = useState<ViewMode[]>(['smith', 'return-loss', 's21-polar', 'resistance-reactance']);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const bw = useMemo(() => bandwidth(points), [points]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('nanovna-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1d1e20' : '#cfcfcd');
  }, [theme]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!aboutOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAboutOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [aboutOpen]);

  function updateMarker(marker: number, index: number) {
    setMarkers((current) => current.map((item, candidate) => candidate === marker ? { ...item, index } : item));
  }

  function setMarkerFrequency(marker: number, value: string) {
    try {
      const frequency = parseFrequency(value);
      const index = points.reduce((best, point, candidate) => Math.abs(point.frequency - frequency) < Math.abs(points[best].frequency - frequency) ? candidate : best, 0);
      updateMarker(marker, index);
    } catch (error) { setMessage((error as Error).message); }
  }

  function addMarker() {
    const id = markerIdRef.current++;
    const index = markers[activeMarker]?.index ?? markerIndex(points);
    setMarkers((current) => [...current, { id, index, color: DEFAULT_MARKER_COLORS[current.length % DEFAULT_MARKER_COLORS.length] }]);
    setActiveMarker(markers.length);
  }

  function removeMarker(marker: number) {
    if (markers.length <= 1) return;
    setMarkers((current) => current.filter((_, index) => index !== marker));
    setActiveMarker((current) => Math.max(0, Math.min(current > marker ? current - 1 : current, markers.length - 2)));
  }

  function setMarkerColor(marker: number, color: string) {
    setMarkers((current) => current.map((item, index) => index === marker ? { ...item, color } : item));
  }

  function remapMarkersToFrequencies(data: SweepPoint[]) {
    const sourcePoints = pointsRef.current;
    setMarkers((current) => current.map((marker) => {
      const frequency = sourcePoints[Math.min(marker.index, sourcePoints.length - 1)].frequency;
      const index = data.reduce((best, point, candidate) => Math.abs(point.frequency - frequency) < Math.abs(data[best].frequency - frequency) ? candidate : best, 0);
      return { ...marker, index };
    }));
    pointsRef.current = data;
  }

  async function toggleConnection() {
    if (connected) {
      await connectionRef.current?.disconnect();
      connectionRef.current = null;
      setConnected(false);
      setFirmware('No device');
      setCalibrationState('Unknown');
      setMessage('Disconnected. Existing measurement remains displayed.');
      return;
    }
    if (!NanoVNAConnection.supported()) {
      setMessage('Web Serial is not available. Use desktop Google Chrome or Microsoft Edge over HTTPS.');
      return;
    }
    setBusy(true);
    setMessage('Waiting for serial-port selection…');
    try {
      const connection = new NanoVNAConnection();
      const version = await connection.connect();
      connectionRef.current = connection;
      setConnected(true);
      setFirmware(version);
      setCalibrationState(connection.calibration);
      setMessage(`Connected at 115200 baud · ${version}`);
    } catch (error) { setMessage(`Connection failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  async function runSweep() {
    if (!connectionRef.current || !connected) { setMessage('Connect a NanoVNA before starting a live sweep.'); return; }
    setBusy(true); setProgress(0); stopRequestedRef.current = false;
    try {
      do {
        setProgress(0);
        const data = await connectionRef.current.sweep(parseFrequency(start), parseFrequency(stop), pointCount, segments, setProgress, () => stopRequestedRef.current);
        if (data.length) {
          setPoints(data);
          remapMarkersToFrequencies(data);
          setMessage(`Sweep complete · ${data.length} samples · browser smoothing OFF · device calibration: ${calibrationState}.`);
        }
      } while (continuous && !stopRequestedRef.current);
    } catch (error) { setMessage(`Sweep failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  function stopSweep() {
    stopRequestedRef.current = true;
    setMessage('Stopping after the current device response…');
  }

  function exportCsv() {
    const rows = ['frequency_hz,s11_real,s11_imag,s11_db,s11_phase_deg,s21_real,s21_imag,s21_db,s21_phase_deg'];
    points.forEach((point) => rows.push([point.frequency, point.s11.re, point.s11.im, db(point.s11), phase(point.s11), point.s21.re, point.s21.im, db(point.s21), phase(point.s21)].join(',')));
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), `nanovna-sweep-${Date.now()}.csv`);
  }

  function exportTouchstone() {
    const rows = [
      '! NanoVNA Web raw complex sweep',
      '! No smoothing or resampling applied',
      '# Hz S RI R 50',
    ];
    points.forEach((point) => {
      rows.push([point.frequency, point.s11.re, point.s11.im].join(' '));
    });
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/plain' }), `nanovna-sweep-${Date.now()}.s1p`);
  }

  async function loadMeasurement(file: File) {
    try {
      const data = parseMeasurementFile(await file.text(), file.name);
      setPoints(data);
      remapMarkersToFrequencies(data);
      setMessage(`Loaded ${file.name} · ${data.length} samples.`);
    } catch (error) { setMessage(`File load failed: ${(error as Error).message}`); }
  }

  return (
    <main className="application">
      <div className="window-title"><span>NanoVNA Web — {connected ? firmware : 'offline'} — {points.length} raw points</span><button className="theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? 'Dark' : 'Light'}</button></div>
      <div className="main-grid">
        <aside className="controls-column">
          <fieldset><legend>Sweep control</legend>
            <div className="form-grid"><label>Start</label><input value={start} onChange={(e) => setStart(e.target.value)} /><label>Stop</label><input value={stop} onChange={(e) => setStop(e.target.value)} /><label>Points / segment</label><select value={pointCount} onChange={(e) => setPointCount(Number(e.target.value))}>{[11, 51, 101, 201, 301, 401, 801].map((value) => <option key={value}>{value}</option>)}</select><label>Segments</label><input type="number" min="1" max="100" value={segments} onChange={(e) => setSegments(Number(e.target.value))} /></div>
            <label className="check-row"><input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /> Continuous sweep</label>
            <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
            <div className="sweep-buttons"><button onClick={runSweep} disabled={busy || !connected}>Sweep</button><button onClick={stopSweep} disabled={!busy}>Stop</button></div>
          </fieldset>
          <fieldset><legend>Markers</legend>
            {markers.map((marker, index) => <div className="marker-control" key={marker.id}>
              <label>Marker {index + 1}</label>
              <input defaultValue={formatFrequency(points[marker.index].frequency).replace(' ', '')} key={`${marker.id}-${marker.index}`} onBlur={(event) => setMarkerFrequency(index, event.target.value)} />
              <input className="marker-color" type="color" value={marker.color} onChange={(event) => setMarkerColor(index, event.target.value)} aria-label={`Marker ${index + 1} color`} />
              <input type="radio" name="marker" checked={activeMarker === index} onChange={() => setActiveMarker(index)} aria-label={`Select marker ${index + 1}`} />
              <button className="marker-remove" onClick={() => removeMarker(index)} disabled={markers.length <= 1} aria-label={`Remove marker ${index + 1}`}>−</button>
            </div>)}
            <div className="marker-actions"><button onClick={addMarker}>Add marker</button><button onClick={() => removeMarker(activeMarker)} disabled={markers.length <= 1}>Remove selected</button></div>
            <small>Drag a marker on any plot, or enter its frequency.</small>
          </fieldset>
          <fieldset><legend>Measurement summary</legend>
            <div className="summary"><span>Samples:</span><b>{points.length} points</b><span>Frequency step:</span><b>{formatFrequency((points.at(-1)!.frequency - points[0].frequency) / Math.max(1, points.length - 1))}</b><span>−10 dB bandwidth:</span><b>{bw === null ? 'Not found' : formatFrequency(bw)}</b><span>Browser smoothing:</span><b>OFF</b><span>Device calibration:</span><b title={calibrationState}>{calibrationState}</b></div>
          </fieldset>
          <fieldset><legend>Reference sweep</legend><button className="wide" onClick={() => setReference(points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })))}>Set current as reference</button><button className="wide" onClick={() => setReference(null)} disabled={!reference}>Clear reference</button><small>{reference ? `${reference.length} reference points · dashed gray trace` : 'No reference trace loaded'}</small></fieldset>
          <fieldset><legend>Serial port control</legend>
            <div className={`serial-status ${connected ? 'online' : ''}`}>{connected ? `Connected · 115200 baud` : 'No serial port connected'}</div>
            <button className="wide" onClick={toggleConnection} disabled={busy}>{connected ? 'Disconnect' : 'Connect to NanoVNA'}</button>
          </fieldset>
          <fieldset><legend>Files</legend><div className="file-buttons"><label className="file-picker">Load CSV / Touchstone…<input type="file" accept=".csv,.s1p,.s2p" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadMeasurement(file); event.target.value = ''; }} /></label><button onClick={exportCsv}>Raw S11/S21 CSV…</button><button onClick={exportTouchstone}>S11 Touchstone .s1p…</button></div><small>S21 remains in CSV because the NanoVNA does not measure the S12/S22 values required for a complete .s2p file. Each plot saves directly to PNG.</small></fieldset>
        </aside>

        <section className="readouts-column">
          {markers.map((marker, index) => <MarkerReadout key={marker.id} point={points[marker.index]} number={index + 1} />)}
          <fieldset><legend>Trace colors</legend><div className="trace-key"><span style={{ color: TRACE.magenta }}>━ S11</span><span style={{ color: TRACE.yellow }}>━ S21</span><span style={{ color: TRACE.cyan }}>━ Resistance / conductance</span><span style={{ color: TRACE.red }}>━ Reactance / susceptance</span></div></fieldset>
        </section>

        <section className="charts-grid">
          {views.map((view, index) => <Chart key={index} mode={view} points={points} reference={reference} markers={markers} activeMarker={activeMarker} theme={theme} onMarkerChange={updateMarker} onActiveMarkerChange={setActiveMarker} onModeChange={(mode) => setViews((current) => current.map((item, candidate) => candidate === index ? mode : item))} />)}
        </section>
      </div>
      <div className="statusbar"><span>{message}</span><span className="status-actions"><a href="https://github.com/NanoVNA-Saver/nanovna-saver" target="_blank" rel="noreferrer">NanoVNA Saver</a><button onClick={() => setAboutOpen(true)}>About</button></span></div>
      {aboutOpen && <div className="modal-backdrop" onMouseDown={() => setAboutOpen(false)}>
        <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="about-titlebar"><h2 id="about-title">NanoVNA Web</h2><button onClick={() => setAboutOpen(false)}>Close</button></div>
          <div className="about-content">
            <h3>Connection and data</h3>
            <p>Device communication uses Web Serial in this browser. Measurement data remains on this computer unless it is exported.</p>
            <h3>Measurement scope</h3>
            <p>Browser smoothing is off. Derived views are calculated from the complex S11 and S21 samples. Measurement accuracy depends on the NanoVNA calibration state and firmware.</p>
            <h3>Credits</h3>
            <p>This is a separate browser implementation. Its protocol behavior and feature design were informed by <a href="https://github.com/NanoVNA-Saver/nanovna-saver" target="_blank" rel="noreferrer">NanoVNA Saver</a>, created by Rune B. Broberg and maintained by its contributors.</p>
            <p><a href="https://github.com/mattlmccoy/nanovna-web" target="_blank" rel="noreferrer">Source and notices</a></p>
          </div>
        </section>
      </div>}
    </main>
  );
}
