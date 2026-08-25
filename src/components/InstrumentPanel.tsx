import { useEffect, useMemo, useRef, useState } from 'react';
import type { SweepPoint } from '../lib/rf';
import { computeSonificationTarget, gridsMatch } from '../lib/sonification';

type OscillatorShape = OscillatorType;

export interface InstrumentContext { device: string; session: string; calibration: string; processing: string; }
export interface InstrumentReference extends InstrumentContext { points: SweepPoint[]; }
interface AudioNodes { context: AudioContext; oscillator: OscillatorNode; gain: GainNode; limiter: DynamicsCompressorNode; recordingDestination: MediaStreamAudioDestinationNode; }
interface RecordingSession { recorder: MediaRecorder; chunks: Blob[]; telemetry: string[]; startedAt: number; startedPerformance: number; startedAudioTime: number; mimeType: string; cancelled: boolean; }

function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function formatNumber(value: number, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function formatFrequency(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(6)} GHz`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(6)} MHz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(3)} kHz`;
  return `${value.toFixed(0)} Hz`;
}
function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function InstrumentPanel({ points, markerIndex, reference, currentContext, dataFresh, onCaptureReference, onRecordingChange, onClose }: {
  points: SweepPoint[];
  markerIndex: number;
  reference: InstrumentReference | null;
  currentContext: InstrumentContext;
  dataFresh: boolean;
  onCaptureReference: () => void;
  onRecordingChange: (recording: boolean) => void;
  onClose: () => void;
}) {
  const audioRef = useRef<AudioNodes | null>(null);
  const mountedRef = useRef(true);
  const recordingRef = useRef<RecordingSession | null>(null);
  const startingRef = useRef(false);
  const startTokenRef = useRef(0);
  const readyRef = useRef(false);
  const lastUpdateRef = useRef(Date.now());
  const [watchdogFresh, setWatchdogFresh] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [testStep, setTestStep] = useState('baseline');
  const [recordingNote, setRecordingNote] = useState('');
  const [completedRecording, setCompletedRecording] = useState<{ audioUrl: string; csvUrl: string; audioName: string; csvName: string } | null>(null);
  const [audioError, setAudioError] = useState('');
  const [baseFrequency, setBaseFrequency] = useState(220);
  const [reactancePerOctave, setReactancePerOctave] = useState(75);
  const [pitchDirection, setPitchDirection] = useState<1 | -1>(-1);
  const [fullVolumeChange, setFullVolumeChange] = useState(100);
  const [deadband, setDeadband] = useState(.25);
  const [volume, setVolume] = useState(.03);
  const [smoothingMs, setSmoothingMs] = useState(80);
  const [shape, setShape] = useState<OscillatorShape>('sine');
  const smoothingSeconds = smoothingMs / 1000;
  const safeIndex = Math.min(markerIndex, Math.max(0, points.length - 1));
  const point = points[safeIndex];
  const metadataCompatible = Boolean(reference && reference.device === currentContext.device && reference.session === currentContext.session && reference.calibration === currentContext.calibration && reference.processing === currentContext.processing);
  const gridCompatible = Boolean(reference && gridsMatch(points, reference.points));
  const compatible = metadataCompatible && gridCompatible;
  const referencePoint = compatible && reference ? reference.points[safeIndex] : null;
  const response = useMemo(() => point && referencePoint ? computeSonificationTarget(point, referencePoint, { baseFrequency, reactancePerOctave, pitchDirection, fullVolumeChange, deadband, maxGain: volume }) : null, [baseFrequency, deadband, fullVolumeChange, pitchDirection, point, reactancePerOctave, referencePoint, volume]);
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
    if (!recording) return;
    const timer = window.setInterval(() => {
      const session = recordingRef.current;
      if (!session) return;
      const elapsed = (performance.now() - session.startedPerformance) / 1000;
      setRecordingElapsed(elapsed);
      if (elapsed >= 120 && session.recorder.state !== 'inactive') session.recorder.stop();
    }, 200);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    const nodes = audioRef.current;
    if (!nodes) return;
    const now = nodes.context.currentTime;
    nodes.oscillator.type = shape;
    nodes.oscillator.frequency.cancelScheduledValues(now);
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.oscillator.frequency.setTargetAtTime(response?.frequency ?? baseFrequency, now, smoothingSeconds);
    nodes.gain.gain.setTargetAtTime(ready && response ? response.gain : 0, now, smoothingSeconds);
  }, [baseFrequency, playing, ready, response, shape]);

  function beginShutdown(nodes: AudioNodes) {
    const now = nodes.context.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setTargetAtTime(0, now, .012);
    try { nodes.oscillator.stop(now + .05); } catch { /* already stopped */ }
    window.setTimeout(() => {
      try { nodes.oscillator.disconnect(); nodes.gain.disconnect(); nodes.limiter.disconnect(); nodes.recordingDestination.disconnect(); nodes.recordingDestination.stream.getTracks().forEach((track) => track.stop()); } catch { /* already disconnected */ }
      void nodes.context.close();
    }, 70);
  }

  useEffect(() => () => {
    mountedRef.current = false;
    startTokenRef.current += 1; startingRef.current = false;
    const recordingSession = recordingRef.current;
    if (recordingSession && recordingSession.recorder.state !== 'inactive') { recordingSession.cancelled = true; recordingSession.recorder.stop(); onRecordingChange(false); }
    const nodes = audioRef.current; if (nodes) beginShutdown(nodes); audioRef.current = null;
  }, [onRecordingChange]);

  useEffect(() => () => {
    if (completedRecording) { URL.revokeObjectURL(completedRecording.audioUrl); URL.revokeObjectURL(completedRecording.csvUrl); }
  }, [completedRecording]);

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
      const recordingDestination = context.createMediaStreamDestination();
      nodes = { context, oscillator, gain, limiter, recordingDestination };
      audioRef.current = nodes;
      oscillator.type = shape;
      oscillator.frequency.value = response?.frequency ?? baseFrequency;
      gain.gain.value = 0;
      limiter.threshold.value = -18; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = .003; limiter.release.value = .1;
      oscillator.connect(gain).connect(limiter);
      limiter.connect(context.destination);
      limiter.connect(recordingDestination);
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

  function startRecording() {
    const nodes = audioRef.current;
    if (!nodes || !playing || recordingRef.current || typeof MediaRecorder === 'undefined') {
      if (typeof MediaRecorder === 'undefined') setAudioError('This browser does not support generated-audio recording.');
      return;
    }
    const choices = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = choices.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(nodes.recordingDestination.stream, mimeType ? { mimeType } : undefined); }
    catch (error) { setAudioError(`Recording is unavailable: ${(error as Error).message}`); return; }
    const session: RecordingSession = { recorder, chunks: [], telemetry: [], startedAt: Date.now(), startedPerformance: performance.now(), startedAudioTime: nodes.context.currentTime, mimeType: recorder.mimeType || mimeType || 'audio/webm', cancelled: false };
    recorder.ondataavailable = (event) => { if (event.data.size) session.chunks.push(event.data); };
    recorder.onerror = () => setAudioError('The browser stopped the Theremin recording unexpectedly.');
    recorder.onstop = () => {
      if (session.cancelled) {
        recordingRef.current = null;
        if (mountedRef.current) { setRecording(false); setRecordingElapsed(0); }
        onRecordingChange(false);
        return;
      }
      const stamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, '-');
      const extension = session.mimeType.includes('mp4') ? 'm4a' : 'webm';
      const audioName = `nanovna-theremin-${stamp}.${extension}`;
      const csvName = `nanovna-theremin-${stamp}.csv`;
      const audioUrl = URL.createObjectURL(new Blob(session.chunks, { type: session.mimeType }));
      const csv = [
        '# NanoVNA Web Theremin test telemetry',
        '# Audio/telemetry alignment is approximate because the audio uses browser MediaRecorder encoding.',
        `# Device: ${currentContext.device}`,
        `# Connection session: ${currentContext.session}`,
        `# Calibration: ${currentContext.calibration}`,
        `# Processing: ${currentContext.processing}`,
        '# Impedance model: S11-derived impedance with Z0 = 50 ohms',
        `# Waveform: ${shape}`,
        `# Base pitch Hz: ${baseFrequency}`,
        `# Reactance ohms per octave: ${reactancePerOctave}`,
        `# Pitch direction: ${pitchDirection === -1 ? 'negative delta X raises pitch' : 'positive delta X raises pitch'}`,
        `# Full-volume delta Z ohms: ${fullVolumeChange}`,
        `# Silent deadband ohms: ${deadband}`,
        `# Maximum gain: ${volume}`,
        `# Audio smoothing ms: ${smoothingSeconds * 1000}`,
        'browser_elapsed_ms,audio_context_time_s,action_tag,marker_frequency_hz,reference_frequency_hz,delta_r_ohm,delta_x_ohm,delta_z_magnitude_ohm,target_pitch_hz,target_gain,data_state,reference_state,audio_state',
        ...session.telemetry,
      ].join('\n');
      const csvUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      setCompletedRecording({ audioUrl, csvUrl, audioName, csvName });
      recordingRef.current = null;
      setRecording(false);
      onRecordingChange(false);
    };
    recordingRef.current = session;
    setCompletedRecording(null);
    setRecordingNote('');
    setRecordingElapsed(0);
    setRecording(true);
    onRecordingChange(true);
    try { recorder.start(250); }
    catch (error) { recordingRef.current = null; setRecording(false); onRecordingChange(false); setAudioError(`Recording could not start: ${(error as Error).message}`); }
  }

  function stopRecording() {
    const session = recordingRef.current;
    if (session && session.recorder.state !== 'inactive') session.recorder.stop();
  }
  function cancelRecording() {
    const session = recordingRef.current;
    if (!session) return;
    session.cancelled = true;
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  }

  function stopAudio() { if (recordingRef.current) stopRecording(); startTokenRef.current += 1; startingRef.current = false; setStarting(false); const nodes = audioRef.current; if (nodes) beginShutdown(nodes); audioRef.current = null; setPlaying(false); }
  function captureReference() {
    const nodes = audioRef.current;
    if (nodes) { const now = nodes.context.currentTime; nodes.gain.gain.cancelScheduledValues(now); nodes.gain.gain.setTargetAtTime(0, now, .012); }
    onCaptureReference();
  }
  function hide() { stopAudio(); onClose(); }

  const referenceState = !reference ? 'Missing' : !metadataCompatible ? 'Incompatible device, calibration, or processing' : !gridCompatible ? 'Incompatible frequency grid' : 'Ready';
  const dataState = !dataFresh ? 'Unavailable or partial' : !watchdogFresh ? 'Stale' : !visible ? 'Page hidden' : 'Fresh';
  const audioState = !playing ? 'Disarmed' : ready ? 'Armed' : 'Muted';

  useEffect(() => {
    const session = recordingRef.current;
    if (!session || !point) return;
    session.telemetry.push([
      performance.now() - session.startedPerformance,
      audioRef.current?.context.currentTime ?? session.startedAudioTime,
      testStep,
      point.frequency,
      referencePoint?.frequency ?? '',
      response?.resistanceDelta ?? '',
      response?.reactanceDelta ?? '',
      response?.totalChange ?? '',
      response?.frequency ?? '',
      ready && response ? response.gain : 0,
      dataState,
      referenceState,
      audioState,
    ].map(csvCell).join(','));
  }, [audioState, dataState, point, ready, referencePoint, referenceState, response, testStep]);

  useEffect(() => {
    if (!recording || ready) return;
    setRecordingNote(`Recording finalized automatically because the measurement became ${dataState.toLowerCase()} or the reference became incompatible.`);
    stopRecording();
  }, [dataState, ready, recording]);

  return <fieldset className="instrument-panel"><legend>Theremin mode</legend>
    <div className="instrument-heading"><b>Impedance sonification</b><button onClick={hide} disabled={recording || starting}>Hide</button></div>
    <button className="wide" onClick={captureReference} disabled={!dataFresh || !watchdogFresh}>Capture fresh sweep as silence</button>
    <div className="instrument-status"><span>Tracking</span><b>Marker at {point ? formatFrequency(point.frequency) : '—'}</b><span>Reference</span><b>{referenceState}</b><span>Data</span><b>{dataState}</b><span>Audio</span><b>{audioState}</b></div>
    <div className="form-grid instrument-settings">
      <label>Waveform</label><select value={shape} onChange={(event) => setShape(event.target.value as OscillatorShape)}><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="sawtooth">Sawtooth</option><option value="square">Square</option></select>
      <label>Base pitch (Hz)</label><input type="number" min="80" max="2000" value={baseFrequency} onChange={(event) => setBaseFrequency(clamp(Number(event.target.value) || 220, 80, 2000))} />
      <label>Reactance Ω/octave</label><input type="number" min="1" max="1000" value={reactancePerOctave} onChange={(event) => setReactancePerOctave(clamp(Number(event.target.value) || 75, 1, 1000))} />
      <label>Pitch direction</label><select value={pitchDirection} onChange={(event) => setPitchDirection(Number(event.target.value) as 1 | -1)}><option value={-1}>Negative ΔX raises pitch</option><option value={1}>Positive ΔX raises pitch</option></select>
      <label>Full volume |ΔZ| (Ω)</label><input type="number" min="1" max="1000" value={fullVolumeChange} onChange={(event) => setFullVolumeChange(clamp(Number(event.target.value) || 100, 1, 1000))} />
      <label>Silent deadband (Ω)</label><input type="number" min="0" max="100" step="0.05" value={deadband} onChange={(event) => setDeadband(clamp(Number(event.target.value) || 0, 0, 100))} />
      <label>Glide (ms)</label><input type="number" min="10" max="500" step="5" value={smoothingMs} onChange={(event) => setSmoothingMs(clamp(Number(event.target.value) || 80, 10, 500))} />
      <label>Maximum gain</label><input type="range" min="0.005" max="0.05" step="0.005" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
    </div>
    {response && <div className="instrument-status"><span>Reference frequency</span><b>{formatFrequency(referencePoint!.frequency)}</b><span>Resistance Δ</span><b>{formatNumber(response.resistanceDelta)} Ω</b><span>Reactance Δ</span><b>{formatNumber(response.reactanceDelta)} Ω</b><span>|ΔZ|</span><b>{formatNumber(response.totalChange)} Ω</b><span>Tone target</span><b>{formatNumber(response.frequency, 1)} Hz</b><span>Gain target</span><b>{formatNumber(response.gain, 3)}</b></div>}
    <div className="instrument-transport"><button onClick={() => void startAudio()} disabled={playing || starting || !ready}>{starting ? 'Starting…' : 'Start audio'}</button><button onClick={stopAudio} disabled={!playing && !starting}>Stop audio</button></div>
    <details className="theremin-test"><summary>Guided tuning test</summary><ol><li>Select <b>Baseline</b> and remain still for 5 seconds.</li><li>Select <b>Approach / recede</b>, approach the sensing plate slowly, pause, then recede.</li><li>Select <b>Touch / release</b> and touch and release the plate five times.</li><li>Select <b>Lateral / distance</b> and move your hand laterally and at several distances for 10 seconds.</li><li>Stop the recording and download both files.</li></ol><label className="test-step">Action tag<select value={testStep} onChange={(event) => setTestStep(event.target.value)}><option value="baseline">Baseline</option><option value="approach-recede">Approach / recede</option><option value="touch-release">Touch / release</option><option value="lateral-distance">Lateral / distance</option><option value="free-play">Free play</option></select></label><div className="instrument-transport"><button onClick={startRecording} disabled={!playing || recording || !ready}>Record test</button><button onClick={stopRecording} disabled={!recording}>Stop</button><button onClick={cancelRecording} disabled={!recording}>Cancel</button></div>{recording && <b className="recording-status">Recording {recordingElapsed.toFixed(1)} s · {testStep}</b>}{recordingNote && <small className="stale-status">{recordingNote}</small>}{completedRecording && <div className="recording-downloads"><a href={completedRecording.audioUrl} download={completedRecording.audioName}>Download audio</a><a href={completedRecording.csvUrl} download={completedRecording.csvName}>Download telemetry CSV</a></div>}<small>The two-minute recorder captures only generated post-limiter Theremin audio and control telemetry. It never uses the microphone or uploads anything. It finalizes automatically if measurement compatibility or freshness is lost. Audio/CSV timing is approximate, and action tags are labels you choose—not detected motion or distance.</small></details>
    {audioError && <small className="stale-status">Audio error: {audioError}</small>}
    <small>Signed reactance change controls pitch in the selected direction. Total impedance change outside the selected deadband controls loudness. Targets are limited to 80–2000 Hz and 0.05 gain. The glide setting smooths changes between VNA updates. This is a sonification mapping, not an acoustic property of the DUT. Start with speaker volume low.</small>
  </fieldset>;
}
