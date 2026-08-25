import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { parseMeasurementFile } from '../lib/files';
import { analyzeSweep, commonFrequencySpan, comparePointwise } from '../lib/comparison';
import { db, impedance, magnitude, phase, vswr, type SweepPoint } from '../lib/rf';

export interface ComparisonDataset {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  points: SweepPoint[];
}

type ComparisonView = 's11-db' | 's21-db' | 'smith' | 'vswr' | 's11-phase' | 's21-phase' | 'resistance' | 'reactance';
type ComparisonMarker = { id: number; frequency: number; color: string };

const COLORS = ['#a9008b', '#e2aa00', '#009d9a', '#d7191c', '#20aa35', '#173de3', '#e76f00', '#6b3fa0'];
const VIEW_LABELS: Record<ComparisonView, string> = {
  's11-db': 'S11 Log Magnitude (dB)',
  's21-db': 'S21 Gain / Loss (dB)',
  smith: 'S11 Smith Chart',
  vswr: 'S11 VSWR (ratio)',
  's11-phase': 'S11 Phase (°)',
  's21-phase': 'S21 Phase (°)',
  resistance: 'S11 Resistance (Ω)',
  reactance: 'S11 Reactance (Ω)',
};

function formatFrequency(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(6)} GHz`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(6)} MHz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(3)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function compactFrequency(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GHz`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} MHz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function parseFrequencyInput(value: string): number {
  const match = value.trim().toLowerCase().replace(/hz$/, '').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([kmg]?)$/);
  if (!match) throw new Error(`Invalid marker frequency: ${value}`);
  const multiplier = match[2] === 'g' ? 1e9 : match[2] === 'm' ? 1e6 : match[2] === 'k' ? 1e3 : 1;
  return Number(match[1]) * multiplier;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function valuesForView(view: ComparisonView, points: SweepPoint[]): number[] {
  if (view === 's11-db') return points.map((point) => db(point.s11));
  if (view === 's21-db') return points.map((point) => db(point.s21));
  if (view === 'vswr') return points.map((point) => vswr(point.s11));
  if (view === 's11-phase') return points.map((point) => phase(point.s11));
  if (view === 's21-phase') return points.map((point) => phase(point.s21));
  if (view === 'resistance') return points.map((point) => impedance(point.s11).re);
  if (view === 'reactance') return points.map((point) => impedance(point.s11).im);
  return [];
}

function nearestPoint(points: SweepPoint[], frequency: number): SweepPoint {
  return points.reduce((closest, point) => Math.abs(point.frequency - frequency) < Math.abs(closest.frequency - frequency) ? point : closest, points[0]);
}

function markerValue(view: ComparisonView, point: SweepPoint): string {
  if (view === 's11-db') return `${formatNumber(db(point.s11))} dB`;
  if (view === 's21-db') return `${formatNumber(db(point.s21))} dB`;
  if (view === 'vswr') return Number.isFinite(vswr(point.s11)) ? `${formatNumber(vswr(point.s11))}:1` : '∞:1';
  if (view === 's11-phase') return `${formatNumber(phase(point.s11), 1)}°`;
  if (view === 's21-phase') return `${formatNumber(phase(point.s21), 1)}°`;
  const z = impedance(point.s11);
  if (view === 'resistance') return `${formatNumber(z.re)} Ω`;
  if (view === 'reactance') return `${formatNumber(z.im)} Ω`;
  return `${formatNumber(z.re)} ${z.im < 0 ? '−' : '+'} j${formatNumber(Math.abs(z.im))} Ω`;
}

function safeFilename(value: string): string {
  return (value.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'comparison').slice(0, 120);
}

function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maximumWidth: number) {
  if (ctx.measureText(text).width <= maximumWidth) { ctx.fillText(text, x, y); return; }
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maximumWidth) shortened = shortened.slice(0, -1);
  ctx.fillText(`${shortened}…`, x, y);
}

function finiteRange(values: number[]): { minimum: number; maximum: number } | null {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return finite.reduce(
    (range, value) => ({ minimum: Math.min(range.minimum, value), maximum: Math.max(range.maximum, value) }),
    { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
  );
}

function exportSummary(dataset: ComparisonDataset, view: ComparisonView): string {
  const analysis = analyzeSweep(dataset.points);
  const impedanceText = `Z ${formatNumber(analysis.resistanceAtMinimum)} ${analysis.reactanceAtMinimum < 0 ? '−' : '+'} j${formatNumber(Math.abs(analysis.reactanceAtMinimum))} Ω`;
  const minimumText = `min S11 ${formatNumber(analysis.minimumS11Db)} dB @ ${formatFrequency(analysis.minimumS11Frequency)}`;
  if (view === 's21-db') return analysis.minimumS21Db === null
    ? 'S21 unavailable'
    : `S21 range ${formatNumber(analysis.minimumS21Db)} to ${formatNumber(analysis.maximumS21Db!)} dB`;
  if (view === 's21-phase') {
    const range = finiteRange(dataset.points.map((point) => phase(point.s21)));
    return range ? `S21 phase range ${formatNumber(range.minimum, 1)}° to ${formatNumber(range.maximum, 1)}°` : 'S21 phase unavailable';
  }
  if (view === 's11-phase') {
    const range = finiteRange(dataset.points.map((point) => phase(point.s11)));
    return range ? `S11 phase range ${formatNumber(range.minimum, 1)}° to ${formatNumber(range.maximum, 1)}° · ${minimumText}` : `S11 phase unavailable · ${minimumText}`;
  }
  if (view === 's11-db') return `${minimumText} · contiguous −10 dB span ${analysis.bandwidth10Db === null ? 'not found' : formatFrequency(analysis.bandwidth10Db)}`;
  if (view === 'vswr') return `minimum VSWR ${Number.isFinite(analysis.minimumVswr) ? `${formatNumber(analysis.minimumVswr)}:1` : '∞:1'} @ ${formatFrequency(analysis.minimumS11Frequency)} · ${minimumText}`;
  if (view === 'resistance') return `${minimumText} · resistance there ${formatNumber(analysis.resistanceAtMinimum)} Ω`;
  if (view === 'reactance') return `${minimumText} · reactance there ${formatNumber(analysis.reactanceAtMinimum)} Ω`;
  return `${minimumText} · ${impedanceText}`;
}

function downloadComparisonReport(canvas: HTMLCanvasElement, datasets: ComparisonDataset[], markers: ComparisonMarker[], view: ComparisonView, theme: 'light' | 'dark', commonSpan: { start: number; stop: number } | null) {
  const ratio = window.devicePixelRatio || 1;
  const reportWidth = Math.max(canvas.width, Math.round(1100 * ratio));
  const plotHeight = Math.round(canvas.height * reportWidth / canvas.width);
  const footerHeight = Math.round((82 + datasets.length * 22 + markers.length * 18) * ratio);
  const report = document.createElement('canvas');
  report.width = reportWidth;
  report.height = plotHeight + footerHeight;
  const ctx = report.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(canvas, 0, 0, reportWidth, plotHeight);
  ctx.save();
  ctx.scale(ratio, ratio);
  const width = reportWidth / ratio;
  const top = plotHeight / ratio;
  const dark = theme === 'dark';
  ctx.fillStyle = dark ? '#232427' : '#f1f1ed';
  ctx.fillRect(0, top, width, footerHeight / ratio);
  ctx.fillStyle = '#f1d51c';
  ctx.fillRect(0, top, width, 3);
  ctx.fillStyle = dark ? '#f0f0eb' : '#242421';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText(`Measurement comparison · ${VIEW_LABELS[view]}`, 14, top + 20);
  ctx.font = '10px Arial, sans-serif';
  drawFittedText(ctx, `Exported: ${new Date().toISOString()} · ${datasets.length} visible file${datasets.length === 1 ? '' : 's'} · original sample grids, no interpolation`, 14, top + 37, width - 28);
  drawFittedText(ctx, `Common frequency span: ${commonSpan ? `${formatFrequency(commonSpan.start)} – ${formatFrequency(commonSpan.stop)}` : datasets.length > 1 ? 'none' : 'not applicable'}`, 14, top + 53, width - 28);
  drawFittedText(ctx, 'Summary values below cover each file’s full listed span; contiguous −10 dB span is centered on that file’s lowest S11 sample.', 14, top + 69, width - 28);
  datasets.forEach((dataset, index) => {
    const analysis = analyzeSweep(dataset.points);
    const analysisText = exportSummary(dataset, view);
    const y = top + 91 + index * 22;
    ctx.fillStyle = dataset.color;
    ctx.fillRect(14, y - 10, 10, 10);
    ctx.fillStyle = dark ? '#f0f0eb' : '#242421';
    drawFittedText(ctx, `${dataset.name} · ${analysis.pointCount} points · ${formatFrequency(analysis.startFrequency)} – ${formatFrequency(analysis.stopFrequency)} · ${analysisText}`, 31, y, width - 45);
  });
  markers.forEach((marker, markerIndex) => {
    const y = top + 91 + datasets.length * 22 + markerIndex * 18;
    const values = datasets.map((dataset) => {
      const point = nearestPoint(dataset.points, marker.frequency);
      return `${dataset.name}: ${formatFrequency(point.frequency)}, ${markerValue(view, point)}`;
    }).join(' · ');
    ctx.fillStyle = marker.color;
    ctx.fillRect(14, y - 9, 9, 9);
    ctx.fillStyle = dark ? '#f0f0eb' : '#242421';
    drawFittedText(ctx, `M${markerIndex + 1} · ${values}`, 30, y, width - 44);
  });
  ctx.restore();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  report.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFilename(datasets.map((dataset) => dataset.name).join('-vs-'))}-${view}-${timestamp}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function ComparisonChart({ datasets, markers, activeMarker, view, theme, onMarkerChange, onActiveMarkerChange }: {
  datasets: ComparisonDataset[];
  markers: ComparisonMarker[];
  activeMarker: number;
  view: ComparisonView;
  theme: 'light' | 'dark';
  onMarkerChange: (index: number, frequency: number) => void;
  onActiveMarkerChange: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<number | null>(null);
  const geometryRef = useRef({ start: 0, stop: 1, area: { x: 0, y: 0, w: 1, h: 1 }, smith: false, cx: 0, cy: 0, radius: 1 });
  const [resizeVersion, setResizeVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setResizeVersion((version) => version + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !datasets.length) return;
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
    const grid = dark ? '#494b4f' : '#d0d0cc';
    const text = dark ? '#deded9' : '#353532';
    ctx.fillStyle = dark ? '#17181a' : '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.font = '10px Arial, sans-serif';

    const drawLine = (positions: Array<{ x: number; y: number; breakBefore?: boolean }>, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let started = false;
      positions.forEach((position) => {
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) { started = false; return; }
        if (position.breakBefore) started = false;
        if (started) ctx.lineTo(position.x, position.y);
        else { ctx.moveTo(position.x, position.y); started = true; }
      });
      ctx.stroke();
    };

    const drawMarker = (x: number, y: number, marker: ComparisonMarker, index: number, datasetColor?: string) => {
      ctx.fillStyle = marker.color;
      ctx.strokeStyle = datasetColor ?? (dark ? '#f0f0eb' : '#242421');
      ctx.lineWidth = index === activeMarker ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y - 10);
      ctx.lineTo(x + 6, y - 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = dark ? '#f0f0eb' : '#242421';
      ctx.fillText(`M${index + 1}`, x + 7, y - 3);
    };

    if (view === 'smith') {
      const radius = Math.min(width, height) * 0.43;
      const cx = width / 2;
      const cy = height / 2;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
      [0.2, 0.5, 1, 2, 5].forEach((r) => {
        ctx.beginPath(); ctx.arc(cx + radius * r / (1 + r), cy, radius / (1 + r), 0, Math.PI * 2); ctx.stroke();
      });
      [0.2, 0.5, 1, 2, 5].forEach((x) => {
        const circleRadius = radius / x;
        [1, -1].forEach((sign) => { ctx.beginPath(); ctx.arc(cx + radius, cy + sign * circleRadius, circleRadius, 0, Math.PI * 2); ctx.stroke(); });
      });
      ctx.restore();
      datasets.forEach((dataset) => drawLine(dataset.points.map((point) => ({ x: cx + point.s11.re * radius, y: cy - point.s11.im * radius })), dataset.color));
      geometryRef.current = { start: 0, stop: 1, area: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, smith: true, cx, cy, radius };
      markers.forEach((marker, markerIndex) => datasets.forEach((dataset) => {
        const point = nearestPoint(dataset.points, marker.frequency);
        drawMarker(cx + point.s11.re * radius, cy - point.s11.im * radius, marker, markerIndex, dataset.color);
      }));
      return;
    }

    const pad = { left: 58, right: 18, top: 20, bottom: 34 };
    const area = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
    const start = Math.min(...datasets.map((dataset) => dataset.points[0].frequency));
    const stop = Math.max(...datasets.map((dataset) => dataset.points.at(-1)!.frequency));
    geometryRef.current = { start, stop, area, smith: false, cx: 0, cy: 0, radius: 1 };
    const allValues = datasets.flatMap((dataset) => valuesForView(view, dataset.points)).filter(Number.isFinite);
    if (!allValues.length) {
      ctx.fillStyle = text;
      ctx.textAlign = 'center';
      ctx.fillText('No finite data are available for this diagnostic.', width / 2, height / 2);
      ctx.textAlign = 'left';
      return;
    }
    const dataRange = allValues.reduce((range, value) => ({ minimum: Math.min(range.minimum, value), maximum: Math.max(range.maximum, value) }), { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY });
    let minimum = view === 's11-phase' || view === 's21-phase' ? -180 : dataRange.minimum;
    let maximum = view === 's11-phase' || view === 's21-phase' ? 180 : dataRange.maximum;
    if (minimum === maximum) { minimum -= 1; maximum += 1; }
    const padding = (maximum - minimum) * 0.06;
    if (view !== 's11-phase' && view !== 's21-phase') { minimum -= padding; maximum += padding; }

    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    for (let tick = 0; tick <= 5; tick += 1) {
      const y = area.y + area.h * tick / 5;
      ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
      ctx.fillText(formatNumber(maximum - (maximum - minimum) * tick / 5, Math.abs(maximum - minimum) < 20 ? 2 : 1), 5, y + 3);
      const x = area.x + area.w * tick / 5;
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      ctx.fillText(compactFrequency(start + (stop - start) * tick / 5), Math.min(width - 65, x - 23), height - 9);
    }
    datasets.forEach((dataset) => {
      const values = valuesForView(view, dataset.points);
      drawLine(values.map((value, index) => ({
        x: area.x + area.w * (dataset.points[index].frequency - start) / Math.max(1, stop - start),
        y: area.y + area.h * (maximum - value) / (maximum - minimum),
        breakBefore: (view === 's11-phase' || view === 's21-phase') && index > 0 && Math.abs(value - values[index - 1]) > 180,
      })), dataset.color);
    });
    markers.forEach((marker, markerIndex) => {
      const x = area.x + area.w * (marker.frequency - start) / Math.max(1, stop - start);
      ctx.save();
      ctx.strokeStyle = marker.color;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      ctx.restore();
      datasets.forEach((dataset) => {
        const point = nearestPoint(dataset.points, marker.frequency);
        const value = valuesForView(view, [point])[0];
        if (!Number.isFinite(value)) return;
        const sampleX = area.x + area.w * (point.frequency - start) / Math.max(1, stop - start);
        drawMarker(sampleX, area.y + area.h * (maximum - value) / (maximum - minimum), marker, markerIndex, dataset.color);
      });
    });
  }, [activeMarker, datasets, markers, resizeVersion, theme, view]);

  function moveMarker(index: number, clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const geometry = geometryRef.current;
    if (!geometry.smith) {
      const fraction = Math.max(0, Math.min(1, (x - geometry.area.x) / geometry.area.w));
      onMarkerChange(index, geometry.start + fraction * (geometry.stop - geometry.start));
      return;
    }
    const candidate = datasets.flatMap((dataset) => dataset.points.map((point) => ({
      point,
      distance: Math.hypot(geometry.cx + point.s11.re * geometry.radius - x, geometry.cy - point.s11.im * geometry.radius - y),
    }))).reduce((closest, item) => item.distance < closest.distance ? item : closest);
    onMarkerChange(index, candidate.point.frequency);
  }

  function markerDistance(marker: ComparisonMarker, x: number, y: number): number {
    const geometry = geometryRef.current;
    if (!geometry.smith) {
      const markerX = geometry.area.x + geometry.area.w * (marker.frequency - geometry.start) / Math.max(1, geometry.stop - geometry.start);
      return Math.abs(markerX - x);
    }
    return datasets.reduce((closest, dataset) => {
      const point = nearestPoint(dataset.points, marker.frequency);
      return Math.min(closest, Math.hypot(geometry.cx + point.s11.re * geometry.radius - x, geometry.cy - point.s11.im * geometry.radius - y));
    }, Number.POSITIVE_INFINITY);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const closest = markers.map((marker, index) => ({ index, distance: markerDistance(marker, x, y) }))
      .reduce((best, item) => item.distance < best.distance ? item : best, { index: activeMarker, distance: Number.POSITIVE_INFINITY });
    const index = closest.distance <= 20 ? closest.index : activeMarker;
    draggingRef.current = index;
    onActiveMarkerChange(index);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveMarker(index, event.clientX, event.clientY);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (draggingRef.current !== null) moveMarker(draggingRef.current, event.clientX, event.clientY);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingRef.current = null;
  }

  return <canvas className="comparison-canvas" ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} aria-label={`Comparison ${VIEW_LABELS[view]} with draggable markers`} />;
}

export function ComparisonMode({ open, onClose, datasets, setDatasets, theme }: {
  open: boolean;
  onClose: () => void;
  datasets: ComparisonDataset[];
  setDatasets: Dispatch<SetStateAction<ComparisonDataset[]>>;
  theme: 'light' | 'dark';
}) {
  const [view, setView] = useState<ComparisonView>('s11-db');
  const [error, setError] = useState('');
  const markerIdRef = useRef(4);
  const [markers, setMarkers] = useState<ComparisonMarker[]>([]);
  const [activeMarker, setActiveMarker] = useState(0);
  const visible = datasets.filter((dataset) => dataset.visible);
  const analyses = useMemo(() => datasets.map((dataset) => ({ dataset, analysis: analyzeSweep(dataset.points) })), [datasets]);
  const pointwise = useMemo(() => datasets.length > 1 ? datasets.slice(1).map((dataset) => ({
    dataset,
    reference: datasets[0],
    result: comparePointwise(datasets[0].points, dataset.points),
  })) : [], [datasets]);
  const commonSpan = useMemo(() => commonFrequencySpan(visible.map((dataset) => dataset.points)), [visible]);
  const overallSpan = useMemo(() => visible.length ? {
    start: Math.min(...visible.map((dataset) => dataset.points[0].frequency)),
    stop: Math.max(...visible.map((dataset) => dataset.points.at(-1)!.frequency)),
  } : null, [visible]);

  useEffect(() => {
    if (!overallSpan || markers.length) return;
    const width = overallSpan.stop - overallSpan.start;
    setMarkers([
      { id: 1, frequency: overallSpan.start + width * 0.25, color: '#173de3' },
      { id: 2, frequency: overallSpan.start + width * 0.5, color: '#d7191c' },
      { id: 3, frequency: overallSpan.start + width * 0.75, color: '#20aa35' },
    ]);
  }, [markers.length, overallSpan]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, open]);

  async function addFiles(files: File[]) {
    const loaded: ComparisonDataset[] = [];
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        loaded.push({
          id: `${Date.now()}-${index}-${file.name}`,
          name: file.name,
          color: COLORS[(datasets.length + index) % COLORS.length],
          visible: true,
          points: parseMeasurementFile(await file.text(), file.name),
        });
      } catch (fileError) { failures.push(`${file.name}: ${(fileError as Error).message}`); }
    }
    if (loaded.length) setDatasets((current) => [...current, ...loaded]);
    setError(failures.join(' '));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files).filter((file) => /\.(s1p|s2p|csv)$/i.test(file.name)));
  }

  function updateMarker(index: number, frequency: number) {
    if (!overallSpan || !Number.isFinite(frequency)) return;
    const clamped = Math.max(overallSpan.start, Math.min(overallSpan.stop, frequency));
    setMarkers((current) => current.map((marker, candidate) => candidate === index ? { ...marker, frequency: clamped } : marker));
  }

  function addMarker() {
    if (!overallSpan) return;
    const id = markerIdRef.current++;
    const frequency = markers[activeMarker]?.frequency ?? (overallSpan.start + overallSpan.stop) / 2;
    setMarkers((current) => [...current, { id, frequency, color: COLORS[current.length % COLORS.length] }]);
    setActiveMarker(markers.length);
  }

  function removeMarker(index: number) {
    if (markers.length <= 1) return;
    setMarkers((current) => current.filter((_, candidate) => candidate !== index));
    setActiveMarker((current) => Math.max(0, Math.min(current > index ? current - 1 : current, markers.length - 2)));
  }

  if (!open) return null;
  return <div className="comparison-backdrop" role="dialog" aria-modal="true" aria-labelledby="comparison-title">
    <section className="comparison-workspace">
      <header className="comparison-header">
        <div><h2 id="comparison-title">Measurement comparison</h2><span>{datasets.length} file{datasets.length === 1 ? '' : 's'} loaded</span></div>
        <div className="comparison-header-actions">
          <label className="file-picker">Add files…<input type="file" multiple accept=".s1p,.s2p,.csv" onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /></label>
          <button onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="comparison-body">
        <aside className="comparison-sidebar">
          <div className="comparison-sidebar-title">Files</div>
          {datasets.map((dataset) => <div className="comparison-file" key={dataset.id}>
            <input type="checkbox" checked={dataset.visible} onChange={(event) => setDatasets((current) => current.map((item) => item.id === dataset.id ? { ...item, visible: event.target.checked } : item))} aria-label={`Show ${dataset.name}`} />
            <input type="color" value={dataset.color} onChange={(event) => setDatasets((current) => current.map((item) => item.id === dataset.id ? { ...item, color: event.target.value } : item))} aria-label={`${dataset.name} color`} />
            <span title={dataset.name}>{dataset.name}</span>
            <button onClick={() => setDatasets((current) => current.filter((item) => item.id !== dataset.id))} aria-label={`Remove ${dataset.name}`}>−</button>
          </div>)}
          <div className="comparison-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>Drop S1P, S2P, or raw CSV files here</div>
          {error && <p className="comparison-error">{error}</p>}
          {visible.length > 1 && <div className="comparison-span"><b>Common frequency span</b><span>{commonSpan ? `${formatFrequency(commonSpan.start)} – ${formatFrequency(commonSpan.stop)}` : 'No overlap'}</span></div>}
          {markers.length > 0 && <div className="comparison-markers"><div className="comparison-sidebar-title">Markers</div>
            {markers.map((marker, index) => <div className={`comparison-marker-control ${activeMarker === index ? 'active' : ''}`} key={marker.id}>
              <input type="radio" name="comparison-marker" checked={activeMarker === index} onChange={() => setActiveMarker(index)} aria-label={`Select comparison marker ${index + 1}`} />
              <input type="color" value={marker.color} onChange={(event) => setMarkers((current) => current.map((item, candidate) => candidate === index ? { ...item, color: event.target.value } : item))} aria-label={`Comparison marker ${index + 1} color`} />
              <input defaultValue={formatFrequency(marker.frequency).replace(' ', '')} key={`${marker.id}-${Math.round(marker.frequency)}`} onBlur={(event) => { try { updateMarker(index, parseFrequencyInput(event.target.value)); } catch (markerError) { setError((markerError as Error).message); } }} aria-label={`Comparison marker ${index + 1} frequency`} />
              <button onClick={() => removeMarker(index)} disabled={markers.length <= 1} aria-label={`Remove comparison marker ${index + 1}`}>−</button>
            </div>)}
            <button className="wide" onClick={addMarker}>Add marker</button>
            <small>Drag the selected marker on the plot. Every file snaps to its nearest acquired frequency.</small>
          </div>}
        </aside>
        <main className="comparison-main">
          <div className="comparison-toolbar">
            <select value={view} onChange={(event) => setView(event.target.value as ComparisonView)} aria-label="Comparison diagnostic">
              {Object.entries(VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={() => { const canvas = document.querySelector<HTMLCanvasElement>('.comparison-canvas'); if (canvas) downloadComparisonReport(canvas, visible, markers, view, theme, commonSpan); }} disabled={!visible.length}>Save PNG</button>
          </div>
          <div className="comparison-chart-wrap">
            {visible.length ? <><ComparisonChart datasets={visible} markers={markers} activeMarker={activeMarker} view={view} theme={theme} onMarkerChange={updateMarker} onActiveMarkerChange={setActiveMarker} />
              <div className="comparison-marker-readouts">{markers.map((marker, markerIndex) => <button className={activeMarker === markerIndex ? 'active' : ''} style={{ borderLeftColor: marker.color }} onClick={() => setActiveMarker(markerIndex)} key={marker.id}>
                <b style={{ color: marker.color }}>M{markerIndex + 1}</b>
                {visible.map((dataset) => { const point = nearestPoint(dataset.points, marker.frequency); return <span key={dataset.id}><i style={{ background: dataset.color }} />{dataset.name}: {compactFrequency(point.frequency)} · {markerValue(view, point)}</span>; })}
              </button>)}</div>
            </> : <div className="comparison-empty">Add files and enable at least one trace.</div>}
          </div>
          {analyses.length > 0 && <div className="comparison-analysis">
            <h3>Measured summary</h3>
            <div className="comparison-table-wrap"><table>
              <thead><tr><th>File</th><th>Points</th><th>Span</th><th>Minimum S11</th><th>VSWR there</th><th>Derived Z there</th><th>Contiguous −10 dB span</th><th>S21 range</th></tr></thead>
              <tbody>{analyses.map(({ dataset, analysis }) => <tr key={dataset.id}>
                <td><i style={{ background: dataset.color }} />{dataset.name}</td>
                <td>{analysis.pointCount}</td>
                <td>{compactFrequency(analysis.startFrequency)} – {compactFrequency(analysis.stopFrequency)}</td>
                <td>{formatNumber(analysis.minimumS11Db)} dB @ {compactFrequency(analysis.minimumS11Frequency)}</td>
                <td>{Number.isFinite(analysis.minimumVswr) ? `${formatNumber(analysis.minimumVswr)}:1` : '∞:1'}</td>
                <td>{formatNumber(analysis.resistanceAtMinimum)} {analysis.reactanceAtMinimum < 0 ? '−' : '+'} j{formatNumber(Math.abs(analysis.reactanceAtMinimum))} Ω</td>
                <td>{analysis.bandwidth10Db === null ? 'Not found' : compactFrequency(analysis.bandwidth10Db)}</td>
                <td>{analysis.minimumS21Db === null ? 'Unavailable' : `${formatNumber(analysis.minimumS21Db)} to ${formatNumber(analysis.maximumS21Db!)} dB`}</td>
              </tr>)}</tbody>
            </table></div>
            <p>Each trace uses its original frequency samples. Lines connect adjacent samples; files are not interpolated onto a shared grid. Summary values cover each file’s full listed span, which may differ between files. The −10 dB result is the contiguous below-threshold region around that file’s lowest S11 sample, not a universal acceptance criterion.</p>
            {pointwise.length > 0 && <div className="pointwise-validation"><h3>Pointwise validation</h3><p>The first loaded file is the reference. Deltas are calculated only when frequency arrays match exactly; no resampling or pass/fail threshold is applied.</p>
              {pointwise.map(({ dataset, reference, result }) => <div className={result.aligned ? 'aligned' : 'unaligned'} key={dataset.id}>
                <b>{dataset.name} versus {reference.name}</b>
                {result.aligned ? <span>{result.pointCount} aligned points · max Δf {formatNumber(result.maximumFrequencyDeltaHz!, 0)} Hz · S11 complex Δ RMS {formatNumber(result.rmsS11ComplexDelta!, 6)}, max {formatNumber(result.maximumS11ComplexDelta!, 6)} · {result.rmsS21ComplexDelta === null ? 'S21 unavailable' : `S21 complex Δ over ${result.s21PointCount} points: RMS ${formatNumber(result.rmsS21ComplexDelta, 6)}, max ${formatNumber(result.maximumS21ComplexDelta!, 6)}`}</span> : <span>Not pointwise-comparable · {result.reason}{result.maximumFrequencyDeltaHz === null ? '' : ` Maximum Δf ${formatNumber(result.maximumFrequencyDeltaHz, 0)} Hz.`}</span>}
              </div>)}
            </div>}
          </div>}
        </main>
      </div>
    </section>
  </div>;
}
