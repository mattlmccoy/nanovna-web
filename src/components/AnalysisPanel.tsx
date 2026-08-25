import { useMemo, useState } from 'react';
import { runAnalysis, type AnalysisMode, type PeakMetric } from '../lib/analysis';
import type { SweepPoint } from '../lib/rf';

const MODE_LABELS: Record<AnalysisMode, string> = {
  overview: 'Sweep overview',
  vswr: 'VSWR analysis',
  resonance: 'Resonance analysis',
  peak: 'Peak search',
  'low-pass': 'Low-pass filter',
  'high-pass': 'High-pass filter',
  'band-pass': 'Band-pass filter',
  'band-stop': 'Band-stop filter',
};

export function AnalysisPanel({ points, live, processing, onMoveMarkers }: { points: SweepPoint[]; live: boolean; processing: string; onMoveMarkers: (indices: number[]) => void }) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<AnalysisMode>('overview');
  const [vswrLimit, setVswrLimit] = useState(1.5);
  const [peakMetric, setPeakMetric] = useState<PeakMetric>('s21-db');
  const [peakDirection, setPeakDirection] = useState<'highest' | 'lowest'>('highest');
  const [peakCount, setPeakCount] = useState(3);
  const result = useMemo(() => runAnalysis(points, mode, { vswrLimit, peakMetric, peakDirection, peakCount }), [mode, peakCount, peakDirection, peakMetric, points, vswrLimit]);

  return <details className="analysis-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>Analysis</span><i className={live ? 'live' : ''}>{live ? 'LIVE' : 'CURRENT DATA'}{processing.includes('complex mean') ? ' · AVERAGED' : ''}</i></summary>
    <div className="analysis-panel-content">
      <label>Analysis type<select value={mode} onChange={(event) => setMode(event.target.value as AnalysisMode)}>{Object.entries(MODE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {mode === 'vswr' && <label>VSWR limit<input type="number" min="1" max="25" step="0.1" value={vswrLimit} onChange={(event) => setVswrLimit(Number(event.target.value))} /></label>}
      {mode === 'peak' && <div className="analysis-options">
        <label>Data<select value={peakMetric} onChange={(event) => setPeakMetric(event.target.value as PeakMetric)}><option value="s21-db">S21 gain</option><option value="s11-db">S11 log magnitude</option><option value="vswr">VSWR</option><option value="resistance">Resistance</option><option value="reactance">Reactance</option></select></label>
        <label>Peak<select value={peakDirection} onChange={(event) => setPeakDirection(event.target.value as 'highest' | 'lowest')}><option value="highest">Highest</option><option value="lowest">Lowest</option></select></label>
        <label>Count<input type="number" min="1" max="10" value={peakCount} onChange={(event) => setPeakCount(Number(event.target.value))} /></label>
      </div>}
      <div className="analysis-result"><b>{result.title}</b><p>{result.summary}</p>
        {result.rows.length > 0 && <dl>{result.rows.map((row, index) => <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
        {result.caution && <small>{result.caution}</small>}
      </div>
      <button className="wide" onClick={() => onMoveMarkers(result.markerIndices)} disabled={!result.markerIndices.length}>Place markers on results</button>
    </div>
  </details>;
}
