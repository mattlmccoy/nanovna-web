import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { NanoVNAConnection, type CalibrationStep, type NanoVNACapabilities } from './lib/nanovna';
import { parseMeasurementFile } from './lib/files';
import { bandwidth, db, demoSweep, impedance, magnitude, markerIndex, nearestPointByFrequency, phase, reflectedPowerPercent, type Complex, type SweepPoint, vswr } from './lib/rf';
import { ComparisonMode, type ComparisonDataset } from './components/ComparisonMode';
import { AnalysisPanel } from './components/AnalysisPanel';
import { TdrPanel } from './components/TdrPanel';
import { DEFAULT_DISPLAY_SETTINGS, DisplaySettingsPanel, type DisplaySettings } from './components/DisplaySettingsPanel';
import { InstrumentPanel, type InstrumentReference } from './components/InstrumentPanel';
import { DraftNumberInput } from './components/DraftNumberInput';

type ViewMode = 'smith' | 'return-loss' | 's21-polar' | 'resistance-reactance' | 'admittance' | 'phase' | 'vswr' | 's21-gain' | 's21-magnitude' | 's11-magnitude' | 's11-z-magnitude' | 's11-components' | 's21-components' | 's11-group-delay' | 's21-group-delay' | 'q-factor' | 'capacitance' | 'inductance' | 's21-series-z' | 's21-shunt-z';
type Marker = { id: number; index: number; color: string };
type PlotExportContext = { sourceName: string; sourceKind: 'demo' | 'file' | 'device'; device: string; calibration: string; processing?: string };

const VIEW_LABELS: Record<ViewMode, string> = {
  smith: 'S11 Smith Chart',
  'return-loss': 'S11 / S21 Log Magnitude (dB)',
  's21-polar': 'S21 Polar Plot',
  'resistance-reactance': 'S11 Resistance + Reactance (Ω)',
  admittance: 'S11 Admittance G + jB (mS)',
  phase: 'S11 / S21 Phase (°)',
  vswr: 'S11 VSWR (ratio)',
  's21-gain': 'S21 Gain (dB)',
  's21-magnitude': 'S21 Magnitude (ratio)',
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

const VIEW_HELP: Record<ViewMode, { what: string; interpret: string }> = {
  smith: { what: 'Maps complex S11 to normalized impedance. The center is a 50 Ω match; the upper half is inductive and the lower half is capacitive.', interpret: 'Watch how the trace moves around the center. A marker near the center has low reflection, while its direction shows the kind of mismatch.' },
  'return-loss': { what: 'Shows S11 and S21 log magnitude. More-negative S11 means less reflected signal; S21 shows transmitted gain or loss.', interpret: 'Start here to find matched bands, transmission features, insertion loss, and unexpected ripple. A dip alone does not prove resonance; corroborate it with impedance and phase behavior. This plot uses negative S11 log magnitude, not positive return-loss convention.' },
  's21-polar': { what: 'Shows complex S21 as magnitude and phase on a polar plane.', interpret: 'Useful when transmission phase matters as much as amplitude. Loops and sharp turns indicate rapid phase or magnitude change.' },
  'resistance-reactance': { what: 'Converts S11 into series-equivalent resistance R and reactance X at a 50 Ω reference impedance.', interpret: 'Near 50 Ω resistance and 0 Ω reactance indicates a match. Positive X is inductive; negative X is capacitive.' },
  admittance: { what: 'Converts S11 into conductance G and susceptance B.', interpret: 'This is often easier than impedance for shunt networks. Positive B is capacitive; negative B is inductive.' },
  phase: { what: 'Shows the phase angle of S11 and S21 in degrees.', interpret: 'Sharp phase rotation often accompanies a resonance. Phase becomes unreliable where the corresponding magnitude approaches zero.' },
  vswr: { what: 'Expresses S11 mismatch as voltage standing-wave ratio.', interpret: '1:1 is ideal. Lower is better; common acceptance limits depend on the device and application.' },
  's21-gain': { what: 'Shows transmitted S21 magnitude in decibels.', interpret: 'For a passive two-port, values below 0 dB indicate insertion loss. Ripple or narrow dips can reveal resonances or fixture effects.' },
  's21-magnitude': { what: 'Shows the linear magnitude of complex S21.', interpret: 'A value of 1 is unity transmission and 0 is no measured transmission. This is the same acquired S21 data without decibel conversion.' },
  's11-magnitude': { what: 'Shows the magnitude of the reflection coefficient |Γ| as a dimensionless ratio.', interpret: '0 is a perfect match and 1 is complete reflection. Reflected power fraction is |Γ|².' },
  's11-z-magnitude': { what: 'Shows the magnitude of the impedance derived from S11.', interpret: 'Useful for overall scale, but it hides whether the impedance is resistive, inductive, or capacitive.' },
  's11-components': { what: 'Shows the real and imaginary components of complex S11.', interpret: 'Use this when validating raw complex reflection data or comparing against another instrument or model.' },
  's21-components': { what: 'Shows the real and imaginary components of complex S21.', interpret: 'Use this for raw complex transmission comparisons and calculations that need Cartesian data.' },
  's11-group-delay': { what: 'Estimates S11 group delay from the frequency derivative of unwrapped reflection phase.', interpret: 'Large features can indicate stored energy or resonances, but results are unstable near deep S11 magnitude nulls.' },
  's21-group-delay': { what: 'Estimates S21 group delay from the frequency derivative of unwrapped transmission phase.', interpret: 'Flat delay suggests more uniform phase response. Spikes may be real dispersion, a resonance, noise, or phase uncertainty near a transmission null.' },
  'q-factor': { what: 'Calculates |X/R| from the impedance derived from S11.', interpret: 'This is a pointwise impedance ratio, not automatically the loaded or unloaded Q of a resonator.' },
  capacitance: { what: 'Converts negative series reactance into an equivalent capacitance.', interpret: 'Values appear only where reactance is capacitive. The result assumes a series-equivalent model at each frequency.' },
  inductance: { what: 'Converts positive series reactance into an equivalent inductance.', interpret: 'Values appear only where reactance is inductive. The result assumes a series-equivalent model at each frequency.' },
  's21-series-z': { what: 'Estimates a series impedance from S21 using an ideal matched series-fixture model.', interpret: 'Use only when the DUT and fixture match that topology. It is not a general direct impedance measurement.' },
  's21-shunt-z': { what: 'Estimates a shunt impedance from S21 using an ideal matched shunt-fixture model.', interpret: 'Use only when the DUT and fixture match that topology. Fixture parasitics can dominate at frequency extremes.' },
};

type PlotSuggestion = { mode: ViewMode; title: string; reason: string };

const TRACE = { magenta: '#a9008b', yellow: '#e2aa00', cyan: '#009d9a', red: '#d7191c', green: '#20aa35', blue: '#173de3' };
const DEFAULT_MARKER_COLORS = [TRACE.blue, TRACE.red, TRACE.green, TRACE.magenta, TRACE.yellow, TRACE.cyan];
const EMPTY_CAPABILITIES: NanoVNACapabilities = { scan: false, scanMask: false, currentData: false, calibration: false, calibrationSlots: false, pauseResume: false, bandwidth: false };
const CALIBRATION_STEPS: Array<{ key: CalibrationStep; title: string; instruction: string; requiredFor: 'one-port' | 'two-port' }> = [
  { key: 'open', title: 'OPEN', instruction: 'Connect the OPEN standard to port 1 at the intended reference plane.', requiredFor: 'one-port' },
  { key: 'short', title: 'SHORT', instruction: 'Connect the SHORT standard to port 1 at the same reference plane.', requiredFor: 'one-port' },
  { key: 'load', title: 'LOAD', instruction: 'Connect the 50 Ω LOAD standard to port 1 at the same reference plane.', requiredFor: 'one-port' },
  { key: 'isoln', title: 'ISOLATION', instruction: 'Terminate both ports in 50 Ω loads for the isolation measurement.', requiredFor: 'two-port' },
  { key: 'thru', title: 'THRU', instruction: 'Connect the THRU standard directly between ports 1 and 2.', requiredFor: 'two-port' },
];

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

function formatFrequencyDelta(value: number): string {
  const sign = value < 0 ? '−' : '';
  return `${sign}${formatFrequency(Math.abs(value))}`;
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

function safeFilename(value: string): string {
  return (value.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'measurement').slice(0, 120);
}

function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maximumWidth: number) {
  if (ctx.measureText(text).width <= maximumWidth) { ctx.fillText(text, x, y); return; }
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maximumWidth) shortened = shortened.slice(0, -1);
  ctx.fillText(`${shortened}…`, x, y);
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
  if (mode === 's21-magnitude') return `|S21| ${formatNumber(magnitude(point.s21), 4)} ratio`;
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

function drawCanvasMarker(ctx: CanvasRenderingContext2D, position: { x: number; y: number }, color: string, label: number, dark: boolean, active: boolean, settings: DisplaySettings) {
  const half = settings.markerSize * .625;
  const height = settings.markerSize * 1.125;
  if (active) {
    ctx.strokeStyle = dark ? '#f4e65d' : '#6f6300';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(position.x, position.y - height / 2, settings.markerSize, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = settings.filledMarkers ? color : (dark ? '#17181a' : '#fff');
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(position.x, position.y);
  ctx.lineTo(position.x - half, position.y - height);
  ctx.lineTo(position.x + half, position.y - height);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (!settings.showMarkerNumbers) return;
  ctx.fillStyle = dark ? '#f1f1ed' : '#111';
  ctx.font = `${active ? 'bold ' : ''}10px Arial, sans-serif`;
  ctx.fillText(`M${label + 1}`, position.x + 6, position.y - 4);
}

function primaryTrace(mode: ViewMode, points: SweepPoint[]): number[] {
  if (mode === 'return-loss') return points.map((point) => db(point.s11));
  if (mode === 's21-gain') return points.map((point) => db(point.s21));
  if (mode === 's21-magnitude') return points.map((point) => magnitude(point.s21));
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

function suggestPlots(points: SweepPoint[]): PlotSuggestion[] {
  const suggestions: PlotSuggestion[] = [];
  const validS11 = points.map((point, index) => ({ index, value: db(point.s11) })).filter((candidate) => Number.isFinite(candidate.value));
  if (validS11.length) {
    const bestCandidate = validS11.reduce((best, candidate) => candidate.value < best.value ? candidate : best);
    const best = points[bestCandidate.index];
    const z = impedance(best.s11);
    const bestVswr = vswr(best.s11);
    suggestions.push(
      {
        mode: 'return-loss',
        title: 'S11 / S21 log magnitude',
        reason: `The lowest measured S11 is ${formatNumber(bestCandidate.value, 2)} dB at ${formatFrequency(best.frequency)}. Start here to inspect the match and choose an application-appropriate bandwidth threshold.`,
      },
      {
        mode: 'smith',
        title: 'Smith chart',
        reason: `At that frequency, the derived impedance is ${formatNumber(z.re, 1)} ${z.im < 0 ? '−' : '+'} j${formatNumber(Math.abs(z.im), 1)} Ω. Use the Smith chart to see the mismatch direction.`,
      },
      {
        mode: 'vswr',
        title: 'VSWR',
        reason: `The best measured VSWR is ${Number.isFinite(bestVswr) ? `${formatNumber(bestVswr, 2)}:1` : 'infinite or non-passive'}. Infinite can mean complete reflection; |S11| above 1 can indicate an active DUT or a calibration error.`,
      },
    );
  }
  const s21Values = points.map((point) => db(point.s21)).filter(Number.isFinite);
  if (s21Values.length) {
    const { minimum, maximum } = s21Values.reduce((range, value) => ({ minimum: Math.min(range.minimum, value), maximum: Math.max(range.maximum, value) }), { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY });
    suggestions.push({
      mode: 's21-gain',
      title: 'S21 gain / loss',
      reason: `S21 spans ${formatNumber(minimum, 2)} to ${formatNumber(maximum, 2)} dB across this sweep. Check transmission loss, gain, and ripple here.`,
    });
  }
  return suggestions;
}

function Chart({ mode, points, reference, markers, activeMarker, theme, exportContext, displaySettings, onMarkerChange, onActiveMarkerChange, onModeChange }: {
  mode: ViewMode;
  points: SweepPoint[];
  reference: SweepPoint[] | null;
  markers: Marker[];
  activeMarker: number;
  theme: 'light' | 'dark';
  exportContext: PlotExportContext;
  displaySettings: DisplaySettings;
  onMarkerChange: (marker: number, index: number) => void;
  onActiveMarkerChange: (marker: number) => void;
  onModeChange: (mode: ViewMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<{ x: number; y: number; w: number; h: number; smith: boolean }>({ x: 0, y: 0, w: 0, h: 0, smith: false });
  const pointPositionsRef = useRef<Array<{ x: number; y: number }>>([]);
  const draggingMarkerRef = useRef<number | null>(null);
  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [resizeVersion, setResizeVersion] = useState(0);
  const [panelHeight, setPanelHeight] = useState(360);
  const [viewHelpOpen, setViewHelpOpen] = useState(false);
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
      ctx.lineWidth = displaySettings.lineWidth;
      if (displaySettings.connectPoints) {
        ctx.beginPath();
        let drawing = false;
        values.forEach((point) => {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { drawing = false; return; }
          if (drawing) ctx.lineTo(point.x, point.y);
          else { ctx.moveTo(point.x, point.y); drawing = true; }
        });
        ctx.stroke();
      }
      if (displaySettings.pointSize > 0) {
        ctx.fillStyle = color;
        values.forEach((point) => {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
          ctx.beginPath(); ctx.arc(point.x, point.y, displaySettings.pointSize, 0, Math.PI * 2); ctx.fill();
        });
      }
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
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
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
        ctx.restore();
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
      line(positions, mode === 'smith' ? displaySettings.colors.magenta : displaySettings.colors.yellow);
      pointPositionsRef.current = positions;
      return;
    }

    let min = -50;
    let max = 0;
    let series: Array<{ values: number[]; color: string; label: string; unit: string }> = [];
    if (mode === 'return-loss') series = [
      { values: points.map((point) => db(point.s11)), color: displaySettings.colors.magenta, label: 'S11', unit: 'dB' },
      { values: points.map((point) => db(point.s21)), color: displaySettings.colors.yellow, label: 'S21', unit: 'dB' },
    ];
    if (mode === 's21-gain') series = [{ values: points.map((point) => db(point.s21)), color: displaySettings.colors.yellow, label: 'S21', unit: 'dB' }];
    if (mode === 's21-magnitude') { const values = points.map((point) => magnitude(point.s21)); min = 0; max = Math.max(1, ...values.filter(Number.isFinite)); series = [{ values, color: displaySettings.colors.yellow, label: '|S21|', unit: 'ratio' }]; }
    if (mode === 'phase') { min = -180; max = 180; series = [
      { values: points.map((point) => phase(point.s11)), color: displaySettings.colors.magenta, label: 'S11', unit: '°' },
      { values: points.map((point) => phase(point.s21)), color: displaySettings.colors.yellow, label: 'S21', unit: '°' },
    ]; }
    if (mode === 'vswr') { const values = points.map((point) => vswr(point.s11)).map((value) => Number.isFinite(value) ? value : Number.NaN); min = 1; max = Math.min(20, Math.max(3, ...values.filter(Number.isFinite))); series = [{ values, color: displaySettings.colors.blue, label: 'VSWR', unit: 'ratio' }]; }
    if (mode === 'resistance-reactance') {
      const z = points.map((point) => impedance(point.s11));
      const extent = Math.max(100, ...z.flatMap((value) => [Math.abs(value.re), Math.abs(value.im)]).filter((value) => Number.isFinite(value)));
      min = -extent; max = extent;
      series = [{ values: z.map((value) => value.re), color: displaySettings.colors.cyan, label: 'R', unit: 'Ω' }, { values: z.map((value) => value.im), color: displaySettings.colors.red, label: 'X', unit: 'Ω' }];
    }
    if (mode === 'admittance') {
      const y = points.map((point) => admittance(point.s11));
      const extent = Math.max(20, ...y.flatMap((value) => [Math.abs(value.re * 1000), Math.abs(value.im * 1000)]).filter((value) => Number.isFinite(value)));
      min = -extent; max = extent;
      series = [{ values: y.map((value) => value.re * 1000), color: displaySettings.colors.green, label: 'G', unit: 'mS' }, { values: y.map((value) => value.im * 1000), color: displaySettings.colors.red, label: 'B', unit: 'mS' }];
    }
    if (mode === 's11-magnitude') { min = 0; max = Math.max(1, ...points.map((point) => magnitude(point.s11))); series = [{ values: points.map((point) => magnitude(point.s11)), color: displaySettings.colors.magenta, label: '|Γ|', unit: 'ratio' }]; }
    if (mode === 's11-z-magnitude') { const values = points.map((point) => magnitude(impedance(point.s11))); min = 0; max = Math.max(100, ...values.filter(Number.isFinite)); series = [{ values, color: displaySettings.colors.cyan, label: '|Z|', unit: 'Ω' }]; }
    if (mode === 's11-components' || mode === 's21-components') { const channel = mode === 's11-components' ? 's11' : 's21'; min = -1; max = 1; series = [{ values: points.map((point) => point[channel].re), color: displaySettings.colors.cyan, label: 'Real', unit: 'ratio' }, { values: points.map((point) => point[channel].im), color: displaySettings.colors.red, label: 'Imag', unit: 'ratio' }]; }
    if (mode === 's11-group-delay' || mode === 's21-group-delay') { const channel = mode === 's11-group-delay' ? 's11' : 's21'; const values = groupDelay(points, channel); const extent = Math.max(1, ...values.map(Math.abs).filter(Number.isFinite)); min = -extent; max = extent; series = [{ values, color: channel === 's11' ? displaySettings.colors.magenta : displaySettings.colors.yellow, label: 'Delay', unit: 'ns' }]; }
    if (mode === 'q-factor') { const values = points.map((point) => { const z = impedance(point.s11); return z.re === 0 ? Number.NaN : Math.abs(z.im / z.re); }); min = 0; max = Math.max(5, ...values.filter(Number.isFinite)); series = [{ values, color: displaySettings.colors.blue, label: 'Q', unit: 'ratio' }]; }
    if (mode === 'capacitance') { const values = points.map((point) => { const x = impedance(point.s11).im; return x < 0 ? -1 / (2 * Math.PI * point.frequency * x) * 1e12 : Number.NaN; }); min = 0; max = Math.max(100, ...values.filter(Number.isFinite)); series = [{ values, color: displaySettings.colors.green, label: 'C', unit: 'pF' }]; }
    if (mode === 'inductance') { const values = points.map((point) => { const x = impedance(point.s11).im; return x > 0 ? x / (2 * Math.PI * point.frequency) * 1e9 : Number.NaN; }); min = 0; max = Math.max(100, ...values.filter(Number.isFinite)); series = [{ values, color: displaySettings.colors.yellow, label: 'L', unit: 'nH' }]; }
    if (mode === 's21-series-z' || mode === 's21-shunt-z') { const z = points.map((point) => s21Impedance(point.s21, mode === 's21-shunt-z')); const extent = Math.max(100, ...z.flatMap((value) => [Math.abs(value.re), Math.abs(value.im)]).filter(Number.isFinite)); min = -extent; max = extent; series = [{ values: z.map((value) => value.re), color: displaySettings.colors.cyan, label: 'R', unit: 'Ω' }, { values: z.map((value) => value.im), color: displaySettings.colors.red, label: 'X', unit: 'Ω' }]; }

    if (displaySettings.showBands) {
      const sweepStart = points[0].frequency;
      const sweepStop = points.at(-1)!.frequency;
      displaySettings.bands.forEach((band) => {
        const start = Math.max(sweepStart, Math.min(band.start, band.stop));
        const stop = Math.min(sweepStop, Math.max(band.start, band.stop));
        if (stop <= start) return;
        const x = area.x + area.w * (start - sweepStart) / Math.max(1, sweepStop - sweepStart);
        const bandWidth = area.w * (stop - start) / Math.max(1, sweepStop - sweepStart);
        ctx.fillStyle = `${band.color}2b`;
        ctx.fillRect(x, area.y, bandWidth, area.h);
        ctx.fillStyle = canvasText;
        ctx.fillText(band.name, x + 3, area.y + 11);
      });
    }

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
    if (mode === 'vswr' && displaySettings.showVswrLines) {
      ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = dark ? '#a4a59f' : '#686963'; ctx.fillStyle = canvasText;
      displaySettings.vswrLines.forEach((limit) => {
        if (limit <= min || limit >= max) return;
        const y = area.y + area.h * (max - limit) / (max - min);
        ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
        ctx.fillText(`${limit}:1`, area.x + 3, y - 2);
      });
      ctx.restore();
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
  }, [displaySettings, mode, points, reference, resizeVersion, theme]);

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
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) drawCanvasMarker(ctx, position, marker.color, index, dark, activeMarker === index, displaySettings);
    });
  }, [activeMarker, displaySettings, markers, mode, points, resizeVersion, theme]);

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

  function setClampedPanelHeight(height: number) {
    setPanelHeight(Math.max(300, Math.min(800, Math.round(height))));
  }

  function beginPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeDragRef.current = { startY: event.clientY, startHeight: panelHeight };
  }

  function continuePanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag) return;
    setClampedPanelHeight(drag.startHeight + event.clientY - drag.startY);
  }

  function finishPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    resizeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizePanelFromKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    const increment = event.shiftKey ? 60 : 20;
    if (event.key === 'ArrowUp') { event.preventDefault(); setClampedPanelHeight(panelHeight - increment); }
    if (event.key === 'ArrowDown') { event.preventDefault(); setClampedPanelHeight(panelHeight + increment); }
    if (event.key === 'Home') { event.preventDefault(); setPanelHeight(360); }
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
    const ratio = window.devicePixelRatio || 1;
    const reportWidth = Math.max(base.width, Math.round(900 * ratio));
    const plotHeight = Math.round(base.height * reportWidth / base.width);
    const footerHeight = Math.round((76 + markers.length * 18) * ratio);
    const composite = document.createElement('canvas');
    composite.width = reportWidth;
    composite.height = plotHeight + footerHeight;
    const ctx = composite.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base, 0, 0, reportWidth, plotHeight);
    ctx.drawImage(overlay, 0, 0, reportWidth, plotHeight);
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
    drawFittedText(ctx, VIEW_LABELS[mode], 14, top + 20, width - 28);
    ctx.font = '10px Arial, sans-serif';
    const sourceLabel = exportContext.sourceKind === 'file' ? `Source file: ${exportContext.sourceName}` : `Source: ${exportContext.sourceName}`;
    drawFittedText(ctx, `${sourceLabel} · Exported: ${new Date().toISOString()}`, 14, top + 36, width - 28);
    const averageStep = (points.at(-1)!.frequency - points[0].frequency) / Math.max(1, points.length - 1);
    const uniform = points.length < 3 || points.slice(1).every((point, index) => Math.abs((point.frequency - points[index].frequency) - averageStep) <= Math.max(1e-6 * Math.abs(averageStep), 1e-6));
    const gridLabel = uniform ? `uniform step ${formatFrequency(averageStep)}` : `nonuniform grid · average interval ${formatFrequency(averageStep)}`;
    drawFittedText(ctx, `Sweep: ${formatFrequency(points[0].frequency)} – ${formatFrequency(points.at(-1)!.frequency)} · ${points.length} samples · ${gridLabel} · reference ${reference ? 'shown' : 'none'}`, 14, top + 51, width - 28);
    drawFittedText(ctx, `Device: ${exportContext.device} · device-reported calibration state: ${exportContext.calibration} · processing: ${exportContext.processing ?? 'original sample grid, no browser smoothing'}`, 14, top + 66, width - 28);
    markers.forEach((marker, index) => {
      const point = points[marker.index];
      const y = top + 84 + index * 18;
      ctx.fillStyle = marker.color;
      ctx.fillRect(14, y - 9, 9, 9);
      ctx.fillStyle = dark ? '#f0f0eb' : '#242421';
      drawFittedText(ctx, `M${index + 1} · ${formatFrequency(point.frequency)} · ${chartMarkerValue(mode, point, marker.index, delayValues)}`, 30, y, width - 44);
    });
    ctx.restore();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    composite.toBlob((blob) => blob && downloadBlob(blob, `${safeFilename(exportContext.sourceName)}-${mode}-${timestamp}.png`), 'image/png');
  }

  return (
    <section className="chart-panel" style={{ '--chart-height': `${panelHeight}px` } as React.CSSProperties}>
      <div className="chart-titlebar">
        <select value={mode} onChange={(event) => onModeChange(event.target.value as ViewMode)} aria-label="Diagnostic view">
          {Object.entries(VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className={`chart-help-button ${viewHelpOpen ? 'active' : ''}`} onClick={() => setViewHelpOpen((open) => !open)} aria-label={`Explain ${VIEW_LABELS[mode]}`} aria-expanded={viewHelpOpen}>?</button>
        <button onClick={savePng}>Save PNG</button>
      </div>
      <div className="chart-plot">
        <canvas className="trace-canvas" ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} aria-label={VIEW_LABELS[mode]} />
        <canvas className="marker-canvas" ref={markerCanvasRef} aria-hidden="true" />
        {viewHelpOpen && <aside className="chart-help-card">
          <b>{VIEW_LABELS[mode]}</b>
          <p>{VIEW_HELP[mode].what}</p>
          <p>{VIEW_HELP[mode].interpret}</p>
        </aside>}
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
      <div className="chart-resizebar">
        <button onClick={() => setClampedPanelHeight(panelHeight - 60)} disabled={panelHeight <= 300} aria-label={`Reduce ${VIEW_LABELS[mode]} height`}>−</button>
        <div className="chart-resize-handle" role="separator" aria-label={`Resize ${VIEW_LABELS[mode]} vertically`} aria-orientation="horizontal" aria-valuemin={300} aria-valuemax={800} aria-valuenow={panelHeight} tabIndex={0} onPointerDown={beginPanelResize} onPointerMove={continuePanelResize} onPointerUp={finishPanelResize} onPointerCancel={finishPanelResize} onKeyDown={resizePanelFromKeyboard}><span /></div>
        <button onClick={() => setClampedPanelHeight(panelHeight + 60)} disabled={panelHeight >= 800} aria-label={`Increase ${VIEW_LABELS[mode]} height`}>+</button>
        <button onClick={() => setPanelHeight(360)} disabled={panelHeight === 360}>Reset</button>
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

function MarkerFrequencyInput({ frequency, onCommit }: { frequency: number; onCommit: (value: string) => number | null }) {
  const formatted = formatFrequency(frequency).replace(' ', '');
  const [draft, setDraft] = useState(formatted);
  const editingRef = useRef(false);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(formatted);
  }, [formatted]);

  function commit() {
    const acceptedFrequency = onCommit(draft);
    if (acceptedFrequency === null) { setDraft(formatted); return; }
    setDraft(formatFrequency(acceptedFrequency).replace(' ', ''));
  }

  return <input
    value={draft}
    onFocus={() => { editingRef.current = true; }}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      editingRef.current = false;
      if (skipBlurCommitRef.current) skipBlurCommitRef.current = false;
      else commit();
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      else if (event.key === 'Escape') { event.preventDefault(); skipBlurCommitRef.current = true; setDraft(formatted); event.currentTarget.blur(); }
    }}
  />;
}

function DeltaMarkerReadout({ first, second, referenceMode }: { first: SweepPoint; second: SweepPoint; referenceMode: boolean }) {
  const firstZ = impedance(first.s11);
  const secondZ = impedance(second.s11);
  return <fieldset className="marker-readout delta-readout">
    <legend>Delta marker · {referenceMode ? 'M1 − reference' : 'M1 − M2'}</legend>
    <div><span>Frequency Δ:</span><b>{formatFrequencyDelta(first.frequency - second.frequency)}</b></div>
    <div><span>S11 log mag Δ:</span><b>{formatNumber(db(first.s11) - db(second.s11))} dB</b></div>
    <div><span>S11 phase Δ:</span><b>{formatNumber(phase(first.s11) - phase(second.s11), 1)}°</b></div>
    <div><span>Resistance Δ:</span><b>{formatNumber(firstZ.re - secondZ.re)} Ω</b></div>
    <div><span>Reactance Δ:</span><b>{formatNumber(firstZ.im - secondZ.im)} Ω</b></div>
    <div><span>S21 gain Δ:</span><b>{formatNumber(db(first.s21) - db(second.s21))} dB</b></div>
  </fieldset>;
}

export default function App() {
  const connectionRef = useRef<NanoVNAConnection | null>(null);
  const stopRequestedRef = useRef(false);
  const markerIdRef = useRef(4);
  const lastFollowUpdateRef = useRef<number | null>(null);
  const followIntervalsRef = useRef<number[]>([]);
  const [points, setPoints] = useState(() => demoSweep(1e6, 51e6, 1001));
  const pointsRef = useRef(points);
  const [reference, setReference] = useState<SweepPoint[] | null>(null);
  const [start, setStart] = useState('1M');
  const [stop, setStop] = useState('51M');
  const [pointCount, setPointCount] = useState(101);
  const [segments, setSegments] = useState(10);
  const [averages, setAverages] = useState(1);
  const [truncateCount, setTruncateCount] = useState(0);
  const [logarithmicSweep, setLogarithmicSweep] = useState(false);
  const [connected, setConnected] = useState(false);
  const [firmware, setFirmware] = useState('No device');
  const [connectionSession, setConnectionSession] = useState('offline');
  const [calibrationState, setCalibrationState] = useState('Unknown');
  const [capabilities, setCapabilities] = useState<NanoVNACapabilities>(EMPTY_CAPABILITIES);
  const [bandwidthOptions, setBandwidthOptions] = useState<number[]>([]);
  const [deviceBandwidth, setDeviceBandwidthState] = useState<number | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const [calibrationCompleted, setCalibrationCompleted] = useState<CalibrationStep[]>([]);
  const [calibrationSlot, setCalibrationSlot] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [continuous, setContinuous] = useState(false);
  const [followDevice, setFollowDevice] = useState(false);
  const [followStatus, setFollowStatus] = useState('Inactive');
  const [message, setMessage] = useState('Demo data shown. Browser smoothing OFF. Device calibration state unknown.');
  const [sourceInfo, setSourceInfo] = useState<PlotExportContext>({ sourceName: 'Demo sweep', sourceKind: 'demo', device: 'Offline demo', calibration: 'Not applicable' });
  const initial = markerIndex(points);
  const [markers, setMarkers] = useState<Marker[]>([
    { id: 1, index: initial, color: TRACE.blue },
    { id: 2, index: Math.round(points.length * 0.28), color: TRACE.red },
    { id: 3, index: Math.round(points.length * 0.84), color: TRACE.green },
  ]);
  const [activeMarker, setActiveMarker] = useState(0);
  const [deltaMarker, setDeltaMarker] = useState(false);
  const [deltaReference, setDeltaReference] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [tdrOpen, setTdrOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [instrumentReference, setInstrumentReference] = useState<InstrumentReference | null>(null);
  const [thereminRecording, setThereminRecording] = useState(false);
  const [comparisonDatasets, setComparisonDatasets] = useState<ComparisonDataset[]>([]);
  const [views, setViews] = useState<ViewMode[]>(['smith', 'return-loss', 's21-polar', 'resistance-reactance']);
  const [suggestedPane, setSuggestedPane] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nanovna-display-settings') ?? '{}') as Partial<DisplaySettings>;
      return { ...DEFAULT_DISPLAY_SETTINGS, ...saved, colors: { ...DEFAULT_DISPLAY_SETTINGS.colors, ...(saved.colors ?? {}) }, bands: Array.isArray(saved.bands) ? saved.bands : [] };
    } catch { return DEFAULT_DISPLAY_SETTINGS; }
  });
  const bw = useMemo(() => bandwidth(points), [points]);
  const plotSuggestions = useMemo(() => suggestPlots(points), [points]);
  const deltaReferencePoint = useMemo(() => {
    if (!reference?.length || !markers[0] || !points[markers[0].index]) return null;
    return nearestPointByFrequency(reference, points[markers[0].index].frequency);
  }, [markers, points, reference]);
  const processingLabel = sourceInfo.processing ?? 'original sample grid, no browser smoothing';
  const samplesLabel = processingLabel.includes('complex mean') ? 'averaged points' : 'acquired points';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('nanovna-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1d1e20' : '#cfcfcd');
  }, [theme]);

  useEffect(() => { localStorage.setItem('nanovna-display-settings', JSON.stringify(displaySettings)); }, [displaySettings]);

  useEffect(() => {
    const toggleInstrument = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyM') {
        const target = event.target as HTMLElement | null;
        if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        if (thereminRecording) { setMessage('Stop the Theremin test recording before hiding Theremin mode.'); return; }
        setInstrumentOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', toggleInstrument);
    return () => window.removeEventListener('keydown', toggleInstrument);
  }, [thereminRecording]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!connected || !followDevice || busy || !capabilities.currentData || !connectionRef.current) return;
    const connection = connectionRef.current;
    let cancelled = false;
    lastFollowUpdateRef.current = null;
    followIntervalsRef.current = [];
    const wait = () => new Promise<void>((resolve) => { setTimeout(resolve, 200); });
    const follow = async () => {
      while (!cancelled) {
        try {
          const data = await connection.readCurrentSweep();
          if (cancelled) break;
          setPoints(data);
          remapMarkersToFrequencies(data);
          setSourceInfo({ sourceName: `${firmware} current device buffers`, sourceKind: 'device', device: firmware, calibration: calibrationState });
          setProgress(1);
          const now = performance.now();
          const previous = lastFollowUpdateRef.current;
          lastFollowUpdateRef.current = now;
          if (previous !== null) {
            followIntervalsRef.current.push(now - previous);
            if (followIntervalsRef.current.length > 20) followIntervalsRef.current.shift();
          }
          const intervals = followIntervalsRef.current;
          const medianInterval = intervals.length ? [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : null;
          const updateRate = medianInterval ? `${(1000 / medianInterval).toFixed(1)} buffer reads/s` : 'measuring buffer read rate';
          setFollowStatus(`${data.length} samples · ${formatFrequency(data[0].frequency)} – ${formatFrequency(data.at(-1)!.frequency)} · ${updateRate} · updated ${new Date().toLocaleTimeString()}`);
        } catch (error) {
          if (cancelled) break;
          const detail = (error as Error).message;
          setFollowStatus(`Stale · ${detail}`);
          setSourceInfo((current) => ({
            ...current,
            sourceName: current.sourceKind !== 'device' || current.sourceName.endsWith(' (stale)') ? current.sourceName : `${current.sourceName} (stale)`,
          }));
          if (/malformed|nonfinite|frequency grid changed|not strictly increasing|incomplete current display/i.test(detail)) {
            setMessage(`A device-buffer snapshot was rejected; the last valid plot is marked stale while acquisition retries. ${detail}`);
            await wait();
            continue;
          }
          setFollowDevice(false);
          setMessage(`Device-buffer following stopped; the last valid plot is marked stale. ${detail}`);
          break;
        }
        await wait();
      }
    };
    void follow();
    return () => { cancelled = true; };
  }, [busy, calibrationState, capabilities.currentData, connected, firmware, followDevice]);

  useEffect(() => {
    if (!aboutOpen && !helpOpen && !calibrationOpen && !tdrOpen && !displayOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAboutOpen(false);
      setHelpOpen(false);
      setTdrOpen(false);
      setDisplayOpen(false);
      if (!busy) setCalibrationOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [aboutOpen, busy, calibrationOpen, displayOpen, helpOpen, tdrOpen]);

  function updateMarker(marker: number, index: number) {
    setMarkers((current) => current.map((item, candidate) => candidate === marker ? { ...item, index } : item));
  }

  function setMarkerFrequency(marker: number, value: string) {
    try {
      const frequency = parseFrequency(value);
      const index = points.reduce((best, point, candidate) => Math.abs(point.frequency - frequency) < Math.abs(points[best].frequency - frequency) ? candidate : best, 0);
      updateMarker(marker, index);
      return index;
    } catch (error) { setMessage((error as Error).message); return null; }
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

  function placeMarkers(indices: number[]) {
    if (!indices.length) return;
    setMarkers((current) => {
      const next = current.map((marker, index) => index < indices.length ? { ...marker, index: indices[index] } : marker);
      for (let index = next.length; index < indices.length; index += 1) {
        next.push({ id: markerIdRef.current++, index: indices[index], color: DEFAULT_MARKER_COLORS[index % DEFAULT_MARKER_COLORS.length] });
      }
      return next;
    });
    setActiveMarker(0);
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

  function showSuggestedPlot(mode: ViewMode, pane: number) {
    setViews((current) => current.map((view, index) => index === pane ? mode : view));
  }

  async function toggleConnection() {
    if (connected) {
      setFollowDevice(false);
      setFollowStatus('Inactive');
      await connectionRef.current?.disconnect();
      connectionRef.current = null;
      setConnected(false);
      setFirmware('No device');
      setConnectionSession('offline');
      setCalibrationState('Unknown');
      setCapabilities(EMPTY_CAPABILITIES);
      setInstrumentReference(null);
      setBandwidthOptions([]);
      setDeviceBandwidthState(null);
      setCalibrationOpen(false);
      setCalibrationStarted(false);
      setCalibrationCompleted([]);
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
      setConnectionSession(crypto.randomUUID());
      setCalibrationState(connection.calibration);
      setCapabilities(connection.capabilities);
      setFollowDevice(connection.capabilities.currentData);
      setFollowStatus(connection.capabilities.currentData ? 'Starting…' : 'Current device-buffer commands not advertised');
      setCalibrationStarted(false);
      setCalibrationCompleted([]);
      setInstrumentReference(null);
      let bandwidthDetail = '';
      if (connection.capabilities.bandwidth) {
        try {
          const options = await connection.getBandwidths();
          setBandwidthOptions(options);
          bandwidthDetail = ` · bandwidth choices detected: ${options.map(formatFrequency).join(', ')}`;
        } catch (error) {
          bandwidthDetail = ` · bandwidth query failed: ${(error as Error).message}`;
        }
      }
      setMessage(`Connected at 115200 baud · ${version} · ${connection.capabilities.calibration ? 'device calibration controls available' : 'calibration commands not advertised'}${bandwidthDetail}.`);
    } catch (error) { setMessage(`Connection failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  async function runSweep() {
    if (!connectionRef.current || !connected) { setMessage('Connect a NanoVNA before starting a live sweep.'); return; }
    setFollowDevice(false);
    setFollowStatus('Inactive while NanoVNA Web controls the sweep');
    setBusy(true); setProgress(0); stopRequestedRef.current = false;
    let retainedPartial: SweepPoint[] = [];
    let retainedSegments = 0;
    const averagingProcessing = averages > 1 ? `${averages}-measurement complex mean${truncateCount ? `, ${truncateCount} farthest sample${truncateCount === 1 ? '' : 's'} discarded per frequency` : ''}` : 'unaveraged complex samples';
    const processing = `${averagingProcessing}; ${logarithmicSweep ? 'logarithmic segment spacing with shared boundaries retained once' : 'linear segment spacing'}; no smoothing`;
    const sweepLabel = averages > 1 ? `${firmware} averaged live sweep (${averages}/${truncateCount})` : `${firmware} live sweep`;
    try {
      do {
        retainedPartial = [];
        retainedSegments = 0;
        setProgress(0);
        const calibrationAtAcquisition = calibrationState;
        const result = await connectionRef.current.sweep(parseFrequency(start), parseFrequency(stop), pointCount, segments, averages, truncateCount, logarithmicSweep, (update) => {
          retainedPartial = update.points;
          retainedSegments = update.completedSegments;
          setProgress(update.progress);
          setPoints(update.points);
          remapMarkersToFrequencies(update.points);
          setSourceInfo({ sourceName: sweepLabel, sourceKind: 'device', device: firmware, calibration: calibrationAtAcquisition, processing });
          setMessage(`${averages > 1 ? 'Averaged' : 'Live'} sweep · segment ${update.completedSegments} of ${update.totalSegments} · ${update.points.length} samples displayed.`);
        }, () => stopRequestedRef.current);
        if (result.points.length) {
          setMessage(result.complete
            ? `Sweep complete · ${result.points.length} samples · browser smoothing OFF · device calibration: ${calibrationAtAcquisition}.`
            : `Partial sweep stopped · ${result.completedSegments} of ${result.totalSegments} segments · ${result.points.length} samples retained and labeled partial.`);
          setSourceInfo({ sourceName: result.complete ? sweepLabel : `${sweepLabel} partial`, sourceKind: 'device', device: firmware, calibration: calibrationAtAcquisition, processing });
        } else if (result.cancelled) {
          setMessage('Sweep stopped before the first segment completed. Existing measurement remains displayed.');
        }
      } while (continuous && !stopRequestedRef.current);
    } catch (error) {
      const detail = (error as Error).message;
      if (retainedPartial.length) {
        setSourceInfo({ sourceName: `${sweepLabel} incomplete`, sourceKind: 'device', device: firmware, calibration: calibrationState, processing });
        setMessage(`Sweep failed after ${retainedSegments} segment${retainedSegments === 1 ? '' : 's'}; ${retainedPartial.length} retained samples are incomplete. ${detail}`);
      } else setMessage(`Sweep failed: ${detail}`);
      if (/serial|connection|closed|timed out|not connected/i.test(detail)) {
        await connectionRef.current?.disconnect();
        connectionRef.current = null;
        setConnected(false);
        setFirmware('No device');
        setCapabilities(EMPTY_CAPABILITIES);
        setFollowDevice(false);
        setFollowStatus('Inactive');
        setCalibrationState('Unknown');
        setCalibrationOpen(false);
        setCalibrationStarted(false);
        setCalibrationCompleted([]);
      }
    }
    finally { setBusy(false); }
  }

  function stopSweep() {
    stopRequestedRef.current = true;
    setMessage('Stopping after the current device response…');
  }

  async function beginCalibration() {
    if (!connectionRef.current || !window.confirm('Reset the active in-memory device calibration? This cannot be undone unless it was already saved to a NanoVNA slot. Save the current calibration first if you may need it.')) return;
    setFollowDevice(false);
    setFollowStatus('Inactive during guided calibration');
    setBusy(true);
    try {
      const state = await connectionRef.current.resetCalibration();
      setCalibrationState(state);
      setCalibrationStarted(true);
      setCalibrationCompleted([]);
      setMessage('Device calibration reset. Measure OPEN, SHORT, and LOAD before applying correction.');
    } catch (error) { setMessage(`Calibration reset failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  async function measureCalibrationStep(step: CalibrationStep) {
    if (!connectionRef.current) return;
    setBusy(true);
    const label = CALIBRATION_STEPS.find((item) => item.key === step)?.title ?? step.toUpperCase();
    setMessage(`Measuring ${label} across ${start} to ${stop}…`);
    try {
      const result = await connectionRef.current.collectCalibration(step, parseFrequency(start), parseFrequency(stop), pointCount);
      setPoints(result.points);
      remapMarkersToFrequencies(result.points);
      setCalibrationState(result.state);
      setCalibrationCompleted((current) => current.includes(step) ? current : [...current, step]);
      setSourceInfo({ sourceName: `${label} calibration standard`, sourceKind: 'device', device: firmware, calibration: result.state });
      setMessage(`${label} collected · ${result.points.length} samples · device state: ${result.state}.`);
    } catch (error) { setMessage(`${label} measurement failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  async function finishCalibration(twoPort: boolean) {
    if (!connectionRef.current) return;
    const required: CalibrationStep[] = twoPort ? ['open', 'short', 'load', 'isoln', 'thru'] : ['open', 'short', 'load'];
    const missing = required.filter((step) => !calibrationCompleted.includes(step));
    if (missing.length) { setMessage(`Calibration cannot be applied: measure ${missing.join(', ').toUpperCase()} first.`); return; }
    setBusy(true);
    try {
      const state = await connectionRef.current.finishCalibration();
      setCalibrationState(state);
      setCalibrationOpen(false);
      setCalibrationStarted(false);
      setCalibrationCompleted([]);
      setMessage(`${twoPort ? 'Two-port' : 'One-port'} device calibration applied. Save it to a slot if you want it retained on the NanoVNA.`);
    } catch (error) { setMessage(`Calibration apply failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  async function setDeviceCalibrationEnabled(enabled: boolean) {
    if (!connectionRef.current) return;
    const resumeFollow = followDevice;
    setFollowDevice(false);
    setBusy(true);
    try {
      const state = await connectionRef.current.setCalibrationEnabled(enabled);
      setCalibrationState(state);
      setMessage(`Device calibration correction ${enabled ? 'enabled' : 'disabled'} · ${state}.`);
    } catch (error) { setMessage(`Calibration command failed: ${(error as Error).message}`); }
    finally { setBusy(false); if (resumeFollow) setFollowDevice(true); }
  }

  async function changeDeviceBandwidth(value: number) {
    if (!connectionRef.current || !connected) return;
    const resumeFollow = followDevice;
    setFollowDevice(false);
    setBusy(true);
    try {
      await connectionRef.current.setBandwidth(value);
      setDeviceBandwidthState(value);
      setMessage(`Device measurement bandwidth set to ${formatFrequency(value)}. Narrower bandwidth generally lowers noise but increases acquisition time.`);
    } catch (error) { setMessage(`Could not set device bandwidth: ${(error as Error).message}`); }
    finally { setBusy(false); if (resumeFollow) setFollowDevice(true); }
  }

  async function saveCalibrationSlot() {
    if (!connectionRef.current || !window.confirm(`Overwrite NanoVNA calibration slot ${calibrationSlot}?`)) return;
    const resumeFollow = followDevice;
    setFollowDevice(false);
    setBusy(true);
    try {
      const state = await connectionRef.current.saveCalibrationSlot(calibrationSlot);
      setCalibrationState(state);
      setMessage(`Device calibration saved to slot ${calibrationSlot} · ${state}.`);
    } catch (error) { setMessage(`Calibration save failed: ${(error as Error).message}`); }
    finally { setBusy(false); if (resumeFollow) setFollowDevice(true); }
  }

  async function recallCalibrationSlot() {
    if (!connectionRef.current || !window.confirm(`Recall NanoVNA calibration slot ${calibrationSlot}? This replaces the active in-memory calibration and may also change the device sweep settings.`)) return;
    const resumeFollow = followDevice;
    setFollowDevice(false);
    setBusy(true);
    try {
      const state = await connectionRef.current.recallCalibrationSlot(calibrationSlot);
      setCalibrationState(state);
      setMessage(`Device calibration slot ${calibrationSlot} recalled · ${state}. Confirm the recalled frequency range and reference plane before measuring.`);
    } catch (error) { setMessage(`Calibration recall failed: ${(error as Error).message}`); }
    finally { setBusy(false); if (resumeFollow) setFollowDevice(true); }
  }

  function exportCsv() {
    const rows = [
      `# Source: ${sourceInfo.sourceName.replace(/[\r\n]/g, ' ')}`,
      `# Processing: ${processingLabel}`,
      `# Device: ${sourceInfo.device.replace(/[\r\n]/g, ' ')}`,
      `# Calibration: ${sourceInfo.calibration.replace(/[\r\n]/g, ' ')}`,
      'frequency_hz,s11_real,s11_imag,s11_db,s11_phase_deg,s21_real,s21_imag,s21_db,s21_phase_deg',
    ];
    points.forEach((point) => rows.push([point.frequency, point.s11.re, point.s11.im, db(point.s11), phase(point.s11), point.s21.re, point.s21.im, db(point.s21), phase(point.s21)].join(',')));
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), `nanovna-sweep-${Date.now()}.csv`);
  }

  function exportTouchstone() {
    const rows = [
      '! NanoVNA Web complex sweep',
      `! Processing: ${sourceInfo.processing ?? 'original sample grid, no browser smoothing'}`,
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
      setSourceInfo({ sourceName: file.name, sourceKind: 'file', device: 'Imported file', calibration: 'Not provided by source' });
      setMessage(`Loaded ${file.name} · ${data.length} samples.`);
    } catch (error) { setMessage(`File load failed: ${(error as Error).message}`); }
  }

  function compareCurrentMeasurement() {
    const id = `current-${Date.now()}`;
    setComparisonDatasets((current) => [...current, {
      id,
      name: sourceInfo.sourceName,
      color: DEFAULT_MARKER_COLORS[current.length % DEFAULT_MARKER_COLORS.length],
      visible: true,
      points: points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })),
    }]);
    setComparisonOpen(true);
  }

  return (
    <main className="application">
      <div className="window-title"><span>NanoVNA Web — {connected ? firmware : 'offline'} — {points.length} {samplesLabel}</span><div className="window-actions"><button onClick={() => setDisplayOpen(true)}>Display</button><button onClick={() => setHelpOpen(true)}>Help</button><button className="theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? 'Dark' : 'Light'}</button></div></div>
      <div className="main-grid">
        <aside className="controls-column">
          <fieldset><legend>Sweep control</legend>
            <div className="form-grid"><label>Start</label><input value={start} onChange={(e) => setStart(e.target.value)} /><label>Stop</label><input value={stop} onChange={(e) => setStop(e.target.value)} /><label>Points / segment</label><select value={pointCount} onChange={(e) => setPointCount(Number(e.target.value))}>{[11, 51, 101, 201, 301, 401, 801].map((value) => <option key={value}>{value}</option>)}</select><label>Segments</label><DraftNumberInput min="1" max="100" step="1" value={segments} onCommit={setSegments} /></div>
            <label className="check-row"><input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /> Continuous sweep</label>
            <label className="check-row"><input type="checkbox" checked={logarithmicSweep} onChange={(event) => setLogarithmicSweep(event.target.checked)} /> Logarithmic segment spacing</label>
            <details className="sweep-processing"><summary>Averaging</summary><div className="form-grid"><label>Measurements</label><DraftNumberInput min="1" max="99" step="1" value={averages} onCommit={(value) => { setAverages(value); setTruncateCount((current) => Math.min(current, value - 1)); }} /><label>Discard outliers</label><DraftNumberInput min="0" max={Math.max(0, averages - 1)} step="1" value={truncateCount} onCommit={setTruncateCount} /></div><small>Averaging is OFF at 1. Higher values alter the data and are labeled in plot exports.</small></details>
            <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
            <div className="sweep-buttons"><button onClick={runSweep} disabled={busy || !connected}>Sweep</button><button onClick={stopSweep} disabled={!busy}>Stop</button></div>
          </fieldset>
          <fieldset><legend>Markers</legend>
            {markers.map((marker, index) => <div className="marker-control" key={marker.id}>
              <label>Marker {index + 1}</label>
              <MarkerFrequencyInput frequency={points[marker.index].frequency} onCommit={(value) => { const accepted = setMarkerFrequency(index, value); return accepted === null ? null : points[accepted].frequency; }} />
              <input className="marker-color" type="color" value={marker.color} onChange={(event) => setMarkerColor(index, event.target.value)} aria-label={`Marker ${index + 1} color`} />
              <input type="radio" name="marker" checked={activeMarker === index} onChange={() => setActiveMarker(index)} aria-label={`Select marker ${index + 1}`} />
              <button className="marker-remove" onClick={() => removeMarker(index)} disabled={markers.length <= 1} aria-label={`Remove marker ${index + 1}`}>−</button>
            </div>)}
            <div className="marker-actions"><button onClick={addMarker}>Add marker</button><button onClick={() => removeMarker(activeMarker)} disabled={markers.length <= 1}>Remove selected</button></div>
            <label className="check-row"><input type="checkbox" checked={deltaMarker} onChange={(event) => setDeltaMarker(event.target.checked)} disabled={markers.length < 2 && !reference} /> Delta marker</label>
            {deltaMarker && <label className="check-row"><input type="checkbox" checked={deltaReference} onChange={(event) => setDeltaReference(event.target.checked)} disabled={!reference} /> Compare M1 with reference sweep</label>}
            <small>Drag a marker on any plot, or enter its frequency.</small>
          </fieldset>
          <fieldset><legend>Measurement summary</legend>
            <div className="summary"><span>Samples:</span><b>{points.length} {samplesLabel}</b><span>Frequency step:</span><b>{formatFrequency((points.at(-1)!.frequency - points[0].frequency) / Math.max(1, points.length - 1))}</b><span>−10 dB bandwidth:</span><b>{bw === null ? 'Not found' : formatFrequency(bw)}</b><span>Browser smoothing:</span><b>OFF</b><span>Processing:</span><b title={processingLabel}>{processingLabel}</b><span>Device calibration:</span><b title={calibrationState}>{calibrationState}</b></div>
            <button className="wide" onClick={() => setTdrOpen(true)}>Time Domain Reflectometry…</button>
          </fieldset>
          <fieldset><legend>Reference sweep</legend><button className="wide" onClick={() => setReference(points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })))}>Set current as reference</button><button className="wide" onClick={() => setReference(null)} disabled={!reference}>Clear reference</button><small>{reference ? `${reference.length} reference points · dashed gray trace` : 'No reference trace loaded'}</small></fieldset>
          {instrumentOpen && <InstrumentPanel points={points} markerIndex={markers[activeMarker]?.index ?? 0} reference={instrumentReference} currentContext={{ device: firmware, session: connectionSession, calibration: calibrationState, processing: processingLabel }} dataFresh={connected && !busy && sourceInfo.sourceKind === 'device' && !followStatus.startsWith('Stale')} onCaptureReference={() => { setInstrumentReference({ points: points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })), device: firmware, session: connectionSession, calibration: calibrationState, processing: processingLabel }); setMessage('Theremin silence reference captured from a fresh complete sweep. Start audio, then move or touch the sensing plate.'); }} onRecordingChange={setThereminRecording} onClose={() => setInstrumentOpen(false)} />}
          <fieldset><legend>Serial port control</legend>
            <div className={`serial-status ${connected ? 'online' : ''}`}>{connected ? `Connected · 115200 baud` : 'No serial port connected'}</div>
            <label className="check-row"><input type="checkbox" checked={followDevice} onChange={(event) => { setFollowDevice(event.target.checked); setFollowStatus(event.target.checked ? 'Starting…' : 'Inactive'); }} disabled={!connected || busy || !capabilities.currentData} /> Follow current device buffers</label>
            <small className={followStatus.startsWith('Stale') ? 'stale-status' : ''}>{followStatus}</small>
            <button className="wide" onClick={toggleConnection} disabled={busy}>{connected ? 'Disconnect' : 'Connect to NanoVNA'}</button>
          </fieldset>
          <fieldset><legend>Device settings</legend>
            <label className="device-select">Measurement bandwidth
              <select value={deviceBandwidth ?? ''} onChange={(event) => void changeDeviceBandwidth(Number(event.target.value))} disabled={!connected || busy || !capabilities.bandwidth || bandwidthOptions.length === 0}>
                <option value="">Select…</option>
                {bandwidthOptions.map((value) => <option key={value} value={value}>{formatFrequency(value)}</option>)}
              </select>
            </label>
            <small>{!connected ? 'Connect a device to detect supported settings.' : !capabilities.bandwidth ? 'This firmware did not advertise bandwidth control.' : bandwidthOptions.length ? `Supported choices: ${bandwidthOptions.map(formatFrequency).join(', ')}.` : 'The firmware advertised bandwidth control but did not return usable choices.'}</small>
          </fieldset>
          <fieldset><legend>Device calibration</legend>
            <div className="calibration-state"><span>Status</span><b title={calibrationState}>{calibrationState}</b></div>
            <button className="wide" onClick={() => setCalibrationOpen(true)} disabled={!connected || busy || !capabilities.calibration}>Guided OPEN / SHORT / LOAD / THRU…</button>
            <div className="calibration-toggle"><button onClick={() => setDeviceCalibrationEnabled(true)} disabled={!connected || busy || !capabilities.calibration}>Correction on</button><button onClick={() => setDeviceCalibrationEnabled(false)} disabled={!connected || busy || !capabilities.calibration}>Correction off</button></div>
            <div className="calibration-slots"><label>Slot<select value={calibrationSlot} onChange={(event) => setCalibrationSlot(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((slot) => <option key={slot}>{slot}</option>)}</select></label><button onClick={recallCalibrationSlot} disabled={!connected || busy || !capabilities.calibrationSlots}>Recall</button><button onClick={saveCalibrationSlot} disabled={!connected || busy || !capabilities.calibrationSlots}>Save</button></div>
            <small>{!connected ? 'Connect a device to detect calibration support.' : !capabilities.calibration ? 'This firmware did not advertise the cal command.' : capabilities.calibrationSlots ? 'Slots 0–4 are the common range across supported NanoVNA firmware.' : 'Calibration is available, but save/recall commands were not advertised.'}</small>
          </fieldset>
          <fieldset><legend>Files</legend><div className="file-buttons"><label className="file-picker">Load CSV / Touchstone…<input type="file" accept=".csv,.s1p,.s2p" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadMeasurement(file); event.target.value = ''; }} /></label><button onClick={compareCurrentMeasurement}>Compare current measurement…</button><button onClick={() => setComparisonOpen(true)}>Open comparison workspace…</button><button onClick={exportCsv}>Complex S11/S21 CSV…</button><button onClick={exportTouchstone}>S11 Touchstone .s1p…</button></div><small>S21 remains in CSV because the NanoVNA does not measure the S12/S22 values required for a complete .s2p file. Each plot saves directly to PNG.</small></fieldset>
        </aside>

        <section className="readouts-column">
          <AnalysisPanel points={points} live={connected && followDevice && !followStatus.startsWith('Stale')} processing={processingLabel} onMoveMarkers={placeMarkers} />
          {markers.map((marker, index) => <MarkerReadout key={marker.id} point={points[marker.index]} number={index + 1} />)}
          {deltaMarker && markers[0] && (deltaReference ? deltaReferencePoint : markers[1] && points[markers[1].index]) && <DeltaMarkerReadout first={points[markers[0].index]} second={deltaReference ? deltaReferencePoint! : points[markers[1].index]} referenceMode={deltaReference} />}
          <fieldset><legend>Trace colors</legend><div className="trace-key"><span style={{ color: displaySettings.colors.magenta }}>━ S11</span><span style={{ color: displaySettings.colors.yellow }}>━ S21</span><span style={{ color: displaySettings.colors.cyan }}>━ Resistance / conductance</span><span style={{ color: displaySettings.colors.red }}>━ Reactance / susceptance</span></div><button className="wide" onClick={() => setDisplayOpen(true)}>Display settings…</button></fieldset>
          <details className="analysis-guide">
            <summary>Suggested views</summary>
            <div className="analysis-guide-content">
            <label className="suggestion-target">Apply to
              <select value={suggestedPane} onChange={(event) => setSuggestedPane(Number(event.target.value))}>
                {views.map((view, index) => <option value={index} key={index}>Pane {index + 1}: {VIEW_LABELS[view]}</option>)}
              </select>
            </label>
            {plotSuggestions.map((suggestion) => <article className="plot-suggestion" key={suggestion.mode}>
              <div><b>{suggestion.title}</b><p>{suggestion.reason}</p></div>
              <button onClick={() => showSuggestedPlot(suggestion.mode, suggestedPane)} disabled={views[suggestedPane] === suggestion.mode}>{views[suggestedPane] === suggestion.mode ? `In pane ${suggestedPane + 1}` : `Set pane ${suggestedPane + 1}`}</button>
            </article>)}
            <small>These are descriptive checks from the loaded samples, not pass/fail judgments.</small>
            </div>
          </details>
        </section>

        <section className="charts-grid">
          {views.map((view, index) => <Chart key={index} mode={view} points={points} reference={reference} markers={markers} activeMarker={activeMarker} theme={theme} exportContext={sourceInfo} displaySettings={displaySettings} onMarkerChange={updateMarker} onActiveMarkerChange={setActiveMarker} onModeChange={(mode) => setViews((current) => current.map((item, candidate) => candidate === index ? mode : item))} />)}
        </section>
      </div>
      <div className="statusbar"><span>{message}</span><span className="status-actions"><a href="https://github.com/NanoVNA-Saver/nanovna-saver" target="_blank" rel="noreferrer">NanoVNA Saver</a><button onClick={() => setAboutOpen(true)}>About</button></span></div>
      {helpOpen && <div className="modal-backdrop" onMouseDown={() => setHelpOpen(false)}>
        <section className="about-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="about-titlebar"><h2 id="help-title">Measurement guide</h2><button onClick={() => setHelpOpen(false)}>Close</button></div>
          <div className="about-content help-content">
            <section><h3>First measurement</h3><p>Connect the NanoVNA and set the intended sweep range. Calibrate with the appropriate standards at the reference plane, including the cables and adapters that will remain in the setup. Then connect the DUT and run the sweep.</p></section>
            <section><h3>S11 and S21</h3><p><b>S11</b> describes reflection at port 1. A more-negative S11 log magnitude generally means a better match. <b>S21</b> describes transmission from port 1 to port 2 and is meaningful for two-port or through measurements.</p></section>
            <section><h3>Where to start</h3><p>Use log magnitude to locate matching and transmission features, VSWR for a simple mismatch reading, and the Smith chart or R/X plot to understand what kind of impedance correction may be needed. Confirm a suspected resonance with impedance and phase behavior.</p></section>
            <section><h3>Markers and references</h3><p>Drag markers directly on any plot. Marker frequency snaps to an acquired sample; most readouts are calculated from that sample, while group delay uses neighboring phase samples. A reference sweep helps compare a later measurement against a baseline; it does not calibrate the instrument.</p></section>
            <section><h3>Derived views</h3><p>Impedance, admittance, equivalent component values, and group delay are calculated from S-parameters. They depend on calibration and model assumptions. Group delay uses neighboring phase samples and can become unstable near a deep magnitude null.</p></section>
            <section><h3>Hardware validation</h3><p>Measure the same DUT with identical settings in NanoVNA Web and NanoVNA Saver. Use “Compare current measurement” and import the Saver Touchstone file. Pointwise validation runs only on identical frequency arrays and reports raw complex deltas without an invented pass/fail threshold.</p></section>
          </div>
        </section>
      </div>}
      {calibrationOpen && <div className="modal-backdrop" onMouseDown={() => !busy && setCalibrationOpen(false)}>
        <section className="about-dialog calibration-dialog" role="dialog" aria-modal="true" aria-labelledby="calibration-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="about-titlebar"><h2 id="calibration-title">Device calibration</h2><button onClick={() => setCalibrationOpen(false)} disabled={busy}>Close</button></div>
          <div className="calibration-content">
            <p>This runs the calibration implemented by the connected NanoVNA firmware over the current <b>{start}–{stop}</b> span with <b>{pointCount} points</b>. Keep every cable and adapter that defines the reference plane in place.</p>
            <div className="calibration-reset"><button onClick={beginCalibration} disabled={busy}>{calibrationStarted ? 'Reset and restart calibration' : 'Reset device calibration and begin'}</button><span>{calibrationStarted ? 'Ready to collect standards' : 'No changes are made until this button is pressed'}</span></div>
            <ol className="calibration-steps">
              {CALIBRATION_STEPS.map((step) => <li className={calibrationCompleted.includes(step.key) ? 'complete' : ''} key={step.key}>
                <div><b>{step.title}</b><span>{step.instruction}</span><small>{step.requiredFor === 'one-port' ? 'Required for one-port calibration' : 'Required for two-port calibration'}</small></div>
                <button onClick={() => measureCalibrationStep(step.key)} disabled={!calibrationStarted || busy}>{calibrationCompleted.includes(step.key) ? 'Measure again' : `Measure ${step.title}`}</button>
              </li>)}
            </ol>
            <div className="calibration-apply"><button onClick={() => finishCalibration(false)} disabled={!calibrationStarted || busy || !['open', 'short', 'load'].every((step) => calibrationCompleted.includes(step as CalibrationStep))}>Apply one-port</button><button onClick={() => finishCalibration(true)} disabled={!calibrationStarted || busy || !['open', 'short', 'load', 'isoln', 'thru'].every((step) => calibrationCompleted.includes(step as CalibrationStep))}>Apply two-port</button></div>
            <p className="calibration-caution">Applying calibration does not save it to flash. After it is applied, use the calibration-slot controls if you want to retain it on the device. Recalling a slot may also restore its sweep settings; verify the displayed range before measuring.</p>
          </div>
        </section>
      </div>}
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
            <p><button onClick={() => { setInstrumentOpen(true); setAboutOpen(false); }}>Theremin mode</button> <small>Shortcut: Option/Alt + Shift + M</small></p>
          </div>
        </section>
      </div>}
      <ComparisonMode open={comparisonOpen} onClose={() => setComparisonOpen(false)} datasets={comparisonDatasets} setDatasets={setComparisonDatasets} theme={theme} />
      {tdrOpen && <TdrPanel points={points} sourceName={sourceInfo.sourceName} onClose={() => setTdrOpen(false)} />}
      {displayOpen && <DisplaySettingsPanel settings={displaySettings} onChange={setDisplaySettings} onClose={() => setDisplayOpen(false)} />}
    </main>
  );
}
