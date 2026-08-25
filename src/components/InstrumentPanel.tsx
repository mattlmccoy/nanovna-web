import { useEffect, useMemo, useRef, useState } from 'react';
import type { SweepPoint } from '../lib/rf';
import { computeSonificationTarget, gridsMatch } from '../lib/sonification';

type OscillatorShape = OscillatorType;

export interface InstrumentContext { device: string; session: string; calibration: string; processing: string; }
export interface InstrumentReference extends InstrumentContext { points: SweepPoint[]; }
interface AudioNodes { context: AudioContext; oscillator: OscillatorNode; gain: GainNode; limiter: DynamicsCompressorNode; }

function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function formatNumber(value: number, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function formatFrequency(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(6)} GHz`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(6)} MHz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(3)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

export function InstrumentPanel({ points, markerIndex, reference, currentContext, dataFresh, onCaptureReference, onClose }: {
  points: SweepPoint[];
  markerIndex: number;
  reference: InstrumentReference | null;
  currentContext: InstrumentContext;
  dataFresh: boolean;
  onCaptureReference: () => void;
  onClose: () => void;
}) {
  const audioRef = useRef<AudioNodes | null>(null);
  const startingRef = useRef(false);
  const startTokenRef = useRef(0);
  const readyRef = useRef(false);
  const lastUpdateRef = useRef(Date.now());
  const [watchdogFresh, setWatchdogFresh] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [baseFrequency, setBaseFrequency] = useState(220);
  const [reactancePerOctave, setReactancePerOctave] = useState(75);
  const [fullVolumeChange, setFullVolumeChange] = useState(40);
  const [deadband, setDeadband] = useState(1);
  const [volume, setVolume] = useState(.03);
  const [shape, setShape] = useState<OscillatorShape>('sine');
  const smoothingSeconds = .035;
  const safeIndex = Math.min(markerIndex, Math.max(0, points.length - 1));
  const point = points[safeIndex];
  const metadataCompatible = Boolean(reference && reference.device === currentContext.device && reference.session === currentContext.session && reference.calibration === currentContext.calibration && reference.processing === currentContext.processing);
  const gridCompatible = Boolean(reference && gridsMatch(points, reference.points));
  const compatible = metadataCompatible && gridCompatible;
  const referencePoint = compatible && reference ? reference.points[safeIndex] : null;
  const response = useMemo(() => point && referencePoint ? computeSonificationTarget(point, referencePoint, { baseFrequency, reactancePerOctave, fullVolumeChange, deadband, maxGain: volume }) : null, [baseFrequency, deadband, fullVolumeChange, point, reactancePerOctave, referencePoint, volume]);
  const ready = Boolean(response?.valid && dataFresh && watchdogFresh && visible && compatible);
  readyRef.current = ready;

  useEffect(() => { lastUpdateRef.current = Date.now(); setWatchdogFresh(true); }, [points]);

  useEffect(() => {
    const timer = window.setInterval(() => setWatchdogFresh(Date.now() - lastUpdateRef.current < 1500), 250);
    const visibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    const nodes = audioRef.current;
    if (!nodes) return;
    const now = nodes.context.currentTime;
    nodes.oscillator.type = shape;
    nodes.oscillator.frequency.cancelScheduledValues(now);
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.oscillator.frequency.setTargetAtTime(response?.frequency ?? baseFrequency, now, .025);
    nodes.gain.gain.setTargetAtTime(ready && response ? response.gain : 0, now, smoothingSeconds);
  }, [baseFrequency, playing, ready, response, shape]);

  function beginShutdown(nodes: AudioNodes) {
    const now = nodes.context.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setTargetAtTime(0, now, .012);
    try { nodes.oscillator.stop(now + .05); } catch { /* already stopped */ }
    window.setTimeout(() => {
      try { nodes.oscillator.disconnect(); nodes.gain.disconnect(); nodes.limiter.disconnect(); } catch { /* already disconnected */ }
      void nodes.context.close();
    }, 70);
  }

  useEffect(() => () => { startTokenRef.current += 1; startingRef.current = false; const nodes = audioRef.current; if (nodes) beginShutdown(nodes); audioRef.current = null; }, []);

  async function startAudio() {
    if (!ready || audioRef.current || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const token = ++startTokenRef.current;
    let nodes: AudioNodes | null = null;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      nodes = { context, oscillator, gain, limiter };
      audioRef.current = nodes;
      oscillator.type = shape;
      oscillator.frequency.value = response?.frequency ?? baseFrequency;
      gain.gain.value = 0;
      limiter.threshold.value = -18; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = .003; limiter.release.value = .1;
      oscillator.connect(gain).connect(limiter).connect(context.destination);
      oscillator.start();
      await context.resume();
      if (token !== startTokenRef.current || audioRef.current !== nodes || !readyRef.current) {
        if (audioRef.current === nodes) { audioRef.current = null; beginShutdown(nodes); }
        return;
      }
      setAudioError('');
      setPlaying(true);
    } catch (error) {
      if (audioRef.current === nodes) audioRef.current = null;
      if (nodes) beginShutdown(nodes);
      setAudioError((error as Error).message || 'Audio could not be started.');
    } finally {
      if (token === startTokenRef.current) { startingRef.current = false; setStarting(false); }
    }
  }

  function stopAudio() { startTokenRef.current += 1; startingRef.current = false; setStarting(false); const nodes = audioRef.current; if (nodes) beginShutdown(nodes); audioRef.current = null; setPlaying(false); }
  function captureReference() {
    const nodes = audioRef.current;
    if (nodes) { const now = nodes.context.currentTime; nodes.gain.gain.cancelScheduledValues(now); nodes.gain.gain.setTargetAtTime(0, now, .012); }
    onCaptureReference();
  }
  function hide() { stopAudio(); onClose(); }

  const referenceState = !reference ? 'Missing' : !metadataCompatible ? 'Incompatible device, calibration, or processing' : !gridCompatible ? 'Incompatible frequency grid' : 'Ready';
  const dataState = !dataFresh ? 'Unavailable or partial' : !watchdogFresh ? 'Stale' : !visible ? 'Page hidden' : 'Fresh';
  const audioState = !playing ? 'Disarmed' : ready ? 'Armed' : 'Muted';

  return <fieldset className="instrument-panel"><legend>Instrument mode</legend>
    <div className="instrument-heading"><b>Impedance sonification</b><button onClick={hide}>Hide</button></div>
    <button className="wide" onClick={captureReference} disabled={!dataFresh || !watchdogFresh}>Capture fresh sweep as silence</button>
    <div className="instrument-status"><span>Tracking</span><b>Marker at {point ? formatFrequency(point.frequency) : '—'}</b><span>Reference</span><b>{referenceState}</b><span>Data</span><b>{dataState}</b><span>Audio</span><b>{audioState}</b></div>
    <div className="form-grid instrument-settings">
      <label>Waveform</label><select value={shape} onChange={(event) => setShape(event.target.value as OscillatorShape)}><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="sawtooth">Sawtooth</option><option value="square">Square</option></select>
      <label>Base pitch (Hz)</label><input type="number" min="80" max="2000" value={baseFrequency} onChange={(event) => setBaseFrequency(clamp(Number(event.target.value) || 220, 80, 2000))} />
      <label>Reactance Ω/octave</label><input type="number" min="1" max="1000" value={reactancePerOctave} onChange={(event) => setReactancePerOctave(clamp(Number(event.target.value) || 75, 1, 1000))} />
      <label>Full volume |ΔZ| (Ω)</label><input type="number" min="1" max="1000" value={fullVolumeChange} onChange={(event) => setFullVolumeChange(clamp(Number(event.target.value) || 40, 1, 1000))} />
      <label>Silent deadband (Ω)</label><input type="number" min="0" max="100" step="0.1" value={deadband} onChange={(event) => setDeadband(clamp(Number(event.target.value) || 0, 0, 100))} />
      <label>Maximum gain</label><input type="range" min="0.005" max="0.05" step="0.005" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
    </div>
    {response && <div className="instrument-status"><span>Reference frequency</span><b>{formatFrequency(referencePoint!.frequency)}</b><span>Resistance Δ</span><b>{formatNumber(response.resistanceDelta)} Ω</b><span>Reactance Δ</span><b>{formatNumber(response.reactanceDelta)} Ω</b><span>|ΔZ|</span><b>{formatNumber(response.totalChange)} Ω</b><span>Tone target</span><b>{formatNumber(response.frequency, 1)} Hz</b><span>Gain target</span><b>{formatNumber(response.gain, 3)}</b></div>}
    <div className="instrument-transport"><button onClick={() => void startAudio()} disabled={playing || starting || !ready}>{starting ? 'Starting…' : 'Start audio'}</button><button onClick={stopAudio} disabled={!playing && !starting}>Stop audio</button></div>
    {audioError && <small className="stale-status">Audio error: {audioError}</small>}
    <small>Signed reactance change controls pitch. Total impedance change outside the selected deadband controls loudness. Targets are limited to 80–2000 Hz and 0.05 gain with 35 ms audio smoothing. This is a sonification mapping, not an acoustic property of the DUT. Start with speaker volume low.</small>
  </fieldset>;
}
