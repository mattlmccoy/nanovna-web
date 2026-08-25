import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { parseMeasurementFile } from '../lib/files';
import { analyzeSweep, commonFrequencySpan } from '../lib/comparison';
import { db, impedance, magnitude, phase, vswr, type SweepPoint } from '../lib/rf';

export interface ComparisonDataset {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  points: SweepPoint[];
}

type ComparisonView = 's11-db' | 's21-db' | 'smith' | 'vswr' | 's11-phase' | 's21-phase' | 'resistance' | 'reactance';

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

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function ComparisonChart({ datasets, view, theme }: { datasets: ComparisonDataset[]; view: ComparisonView; theme: 'light' | 'dark' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      return;
    }

    const pad = { left: 58, right: 18, top: 20, bottom: 34 };
    const area = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
    const start = Math.min(...datasets.map((dataset) => dataset.points[0].frequency));
    const stop = Math.max(...datasets.map((dataset) => dataset.points.at(-1)!.frequency));
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
  }, [datasets, resizeVersion, theme, view]);

  return <canvas className="comparison-canvas" ref={canvasRef} aria-label={`Comparison ${VIEW_LABELS[view]}`} />;
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
  const visible = datasets.filter((dataset) => dataset.visible);
  const analyses = useMemo(() => datasets.map((dataset) => ({ dataset, analysis: analyzeSweep(dataset.points) })), [datasets]);
  const commonSpan = useMemo(() => commonFrequencySpan(visible.map((dataset) => dataset.points)), [visible]);

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
        </aside>
        <main className="comparison-main">
          <div className="comparison-toolbar">
            <select value={view} onChange={(event) => setView(event.target.value as ComparisonView)} aria-label="Comparison diagnostic">
              {Object.entries(VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={() => { const canvas = document.querySelector<HTMLCanvasElement>('.comparison-canvas'); if (canvas) downloadCanvas(canvas, `comparison-${view}-${Date.now()}.png`); }} disabled={!visible.length}>Save PNG</button>
          </div>
          <div className="comparison-chart-wrap">
            {visible.length ? <ComparisonChart datasets={visible} view={view} theme={theme} /> : <div className="comparison-empty">Add files and enable at least one trace.</div>}
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
          </div>}
        </main>
      </div>
    </section>
  </div>;
}
