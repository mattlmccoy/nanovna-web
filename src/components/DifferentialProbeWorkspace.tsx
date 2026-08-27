import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDifferentialBaseline, scoreDifferentialPoint, type DifferentialBaseline, type DifferentialScore } from '../lib/differentialProbe';
import type { SweepPoint } from '../lib/rf';

export interface DifferentialProbeContext { device: string; session: string; calibration: string; processing: string; bandwidthHz: number | null; }
interface AudioNodes { context: AudioContext; oscillator: OscillatorNode; gain: GainNode; limiter: DynamicsCompressorNode; recordingDestination: MediaStreamAudioDestinationNode; }
interface PreparedMedia { stream: MediaStream; microphone: MediaStreamAudioSourceNode; }
interface ActiveMediaRecording { recorder: MediaRecorder; chunks: Blob[]; mimeType: string; startedAt: number; }
interface RecordedFrame { timestamp: string; elapsedMs: number; markerIndex: number; score: DifferentialScore; s11Re: number; s11Im: number; event: boolean; tag: string; trace: SweepPoint[]; }
const MAX_RECORDED_SAMPLES = 100_000;
const MAX_MEDIA_DURATION_MS = 10 * 60 * 1000;

function copySweep(points: SweepPoint[]) { return points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })); }
function formatFrequency(value: number) { return value >= 1e6 ? `${(value / 1e6).toFixed(6)} MHz` : value >= 1e3 ? `${(value / 1e3).toFixed(3)} kHz` : `${value.toFixed(0)} Hz`; }
function download(text: string, type: string, filename: string) { const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function DifferentialProbeWorkspace({ points, markerIndex, context, dataFresh, sourceName, connected, busy, onToggleConnection }: { points: SweepPoint[]; markerIndex: number; context: DifferentialProbeContext; dataFresh: boolean; sourceName: string; connected: boolean; busy: boolean; onToggleConnection: () => Promise<void>; }) {
  const [captureTarget, setCaptureTarget] = useState(50);
  const [diagnosticIndex, setDiagnosticIndex] = useState(markerIndex);
  const [captures, setCaptures] = useState<SweepPoint[][]>([]);
  const [capturing, setCapturing] = useState(false);
  const [baseline, setBaseline] = useState<DifferentialBaseline | null>(null);
  const [baselineError, setBaselineError] = useState('');
  const [toneFrequency, setToneFrequency] = useState(440);
  const [maximumGain, setMaximumGain] = useState(0.035);
  const [playing, setPlaying] = useState(false);
  const [eventActive, setEventActive] = useState(false);
  const [tag, setTag] = useState('unlabeled');
  const [recording, setRecording] = useState(false);
  const [recordedFrameCount, setRecordedFrameCount] = useState(0);
  const [recordingNote, setRecordingNote] = useState('');
  const [recordingStart, setRecordingStart] = useState(0);
  const [automatic, setAutomatic] = useState(false);
  const [automaticPhase, setAutomaticPhase] = useState('Idle');
  const [includeMedia, setIncludeMedia] = useState(true);
  const [mediaRecording, setMediaRecording] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaDownload, setMediaDownload] = useState<{ url: string; filename: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const audioRef = useRef<AudioNodes | null>(null);
  const preparedMediaRef = useRef<PreparedMedia | null>(null);
  const mediaRecordingRef = useRef<ActiveMediaRecording | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const automaticStartedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const recordedFramesRef = useRef<RecordedFrame[]>([]);
  const recordedSampleCountRef = useRef(0);
  const onsetRef = useRef(0);
  const releaseRef = useRef(0);
  const latestCaptureRef = useRef<SweepPoint[] | null>(null);
  const safeIndex = Math.min(diagnosticIndex, Math.max(0, points.length - 1));
  const point = points[safeIndex];
  const score = useMemo(() => baseline && point ? scoreDifferentialPoint(point, baseline, safeIndex) : null, [baseline, point, safeIndex]);

  useEffect(() => {
    if (!capturing || !dataFresh || !points.length || latestCaptureRef.current === points) return;
    latestCaptureRef.current = points;
    setCaptures((current) => {
      const next = [...current, copySweep(points)];
      if (next.length >= captureTarget) {
        setCapturing(false);
        try { setBaseline(buildDifferentialBaseline(next)); setBaselineError(''); }
        catch (error) { setBaseline(null); setBaselineError((error as Error).message); }
      }
      return next;
    });
  }, [captureTarget, capturing, dataFresh, points]);

  useEffect(() => {
    if (!score?.valid || !dataFresh) { onsetRef.current = 0; releaseRef.current = 0; setEventActive(false); return; }
    if (score.distance > score.threshold) {
      onsetRef.current += 1; releaseRef.current = 0;
      if (onsetRef.current >= 2) setEventActive(true);
    } else if (score.distance < score.threshold * 0.8) {
      releaseRef.current += 1; onsetRef.current = 0;
      if (releaseRef.current >= 3) setEventActive(false);
    }
  }, [dataFresh, score]);

  useEffect(() => {
    const nodes = audioRef.current;
    if (!nodes) return;
    const now = nodes.context.currentTime;
    const normalized = score?.valid ? Math.min(1, score.excess / Math.max(score.threshold * 2, 1e-9)) : 0;
    nodes.oscillator.frequency.setTargetAtTime(toneFrequency, now, 0.025);
    nodes.gain.gain.setTargetAtTime(dataFresh && eventActive ? normalized * maximumGain : 0, now, 0.025);
  }, [dataFresh, eventActive, maximumGain, score, toneFrequency]);

  useEffect(() => {
    if (!recording || !score?.valid || !point) return;
    if (recordedSampleCountRef.current + points.length > MAX_RECORDED_SAMPLES) { setRecording(false); stopMediaRecording(); setAutomatic(false); setAutomaticPhase('Stopped at trace memory limit'); setRecordingNote(`Recording stopped at the ${MAX_RECORDED_SAMPLES.toLocaleString()}-sample in-memory safety limit. Download this session before starting another.`); return; }
    recordedFramesRef.current.push({ timestamp: new Date().toISOString(), elapsedMs: performance.now() - recordingStart, markerIndex: safeIndex, score, s11Re: point.s11.re, s11Im: point.s11.im, event: eventActive, tag, trace: copySweep(points) });
    recordedSampleCountRef.current += points.length;
    setRecordedFrameCount(recordedFramesRef.current.length);
  }, [eventActive, point, points, recording, recordingStart, safeIndex, score, tag]);

  useEffect(() => () => { clearTimers(); stopMediaCapture(); stopAudio(); }, []);

  useEffect(() => {
    stopAutomaticRun();
    setCapturing(false);
    setCaptures([]);
    setBaseline(null);
    setBaselineError('');
    setRecording(false);
    recordedFramesRef.current = [];
    recordedSampleCountRef.current = 0;
    setRecordedFrameCount(0);
    setRecordingNote('');
  }, [context.session]);

  useEffect(() => {
    if (!automatic) return;
    if (!connected) { setAutomaticPhase('Choose the VNA in the USB prompt'); return; }
    if (!dataFresh) { setAutomaticPhase('Waiting for a fresh VNA sweep'); return; }
    if (!baseline && !capturing) { setAutomaticPhase('Capturing the measured baseline'); beginBaseline(true); return; }
    if (capturing) { setAutomaticPhase(`Baseline ${captures.length} / ${captureTarget}`); return; }
    if (baseline && !automaticStartedRef.current) {
      automaticStartedRef.current = true;
      setAutomaticPhase('Starting synchronized recording');
      startTraceRecording();
      void (async () => {
        if (includeMedia && preparedMediaRef.current) await startMediaRecording();
        runSyncSequence();
      })();
    }
  }, [automatic, baseline, captureTarget, captures.length, capturing, connected, dataFresh, includeMedia]);

  function clearTimers() { timersRef.current.forEach((timer) => window.clearTimeout(timer)); timersRef.current = []; }
  function beginBaseline(preserveAudio = false) { if (!preserveAudio) stopAudio(); setBaseline(null); setCaptures([]); setBaselineError(''); latestCaptureRef.current = null; setCapturing(true); }
  async function armAudio() {
    if (audioRef.current) return audioRef.current;
    const contextAudio = new AudioContext(); const oscillator = contextAudio.createOscillator(); const gain = contextAudio.createGain(); const limiter = contextAudio.createDynamicsCompressor();
    const recordingDestination = contextAudio.createMediaStreamDestination();
    oscillator.type = 'sine'; oscillator.frequency.value = toneFrequency; gain.gain.value = 0; limiter.threshold.value = -18; limiter.ratio.value = 12; limiter.attack.value = .003; limiter.release.value = .1;
    oscillator.connect(gain).connect(limiter); limiter.connect(contextAudio.destination); limiter.connect(recordingDestination); oscillator.start(); await contextAudio.resume();
    const nodes = { context: contextAudio, oscillator, gain, limiter, recordingDestination }; audioRef.current = nodes; setPlaying(true); return nodes;
  }
  async function startAudio() { if (!baseline || !score?.valid) return; await armAudio(); }
  function stopAudio() { const nodes = audioRef.current; if (!nodes) return; const now = nodes.context.currentTime; nodes.gain.gain.setTargetAtTime(0, now, .01); try { nodes.oscillator.stop(now + .05); } catch { /* already stopped */ } window.setTimeout(() => void nodes.context.close(), 80); audioRef.current = null; setPlaying(false); }
  async function prepareMedia() {
    if (preparedMediaRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Camera/microphone recording is not supported by this browser.');
    const nodes = await armAudio();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const microphone = nodes.context.createMediaStreamSource(stream); microphone.connect(nodes.recordingDestination);
    preparedMediaRef.current = { stream, microphone };
    if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
  }
  function preferredMediaType() { return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''; }
  async function startMediaRecording() {
    if (mediaRecordingRef.current || !preparedMediaRef.current || !audioRef.current) return;
    if (mediaDownload) { URL.revokeObjectURL(mediaDownload.url); setMediaDownload(null); }
    const combined = new MediaStream([...preparedMediaRef.current.stream.getVideoTracks(), ...audioRef.current.recordingDestination.stream.getAudioTracks()]);
    const mimeType = preferredMediaType(); const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined); const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => { const type = recorder.mimeType || mimeType || 'video/webm'; const extension = type.includes('mp4') ? 'mp4' : 'webm'; const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const url = URL.createObjectURL(new Blob(chunks, { type })); setMediaDownload({ url, filename: `nanovna-differential-probe-${stamp}.${extension}` }); setMediaRecording(false); };
    mediaRecordingRef.current = { recorder, chunks, mimeType, startedAt: performance.now() }; recorder.start(1000); setMediaRecording(true);
    const timer = window.setTimeout(() => { stopMediaRecording(); setRecording(false); setRecordingNote('Recording stopped at the 10-minute browser memory safety limit.'); setAutomatic(false); setAutomaticPhase('Stopped at 10-minute limit'); }, MAX_MEDIA_DURATION_MS); timersRef.current.push(timer);
  }
  function stopMediaRecording() { const active = mediaRecordingRef.current; if (!active) return; if (active.recorder.state !== 'inactive') active.recorder.stop(); mediaRecordingRef.current = null; }
  function stopMediaCapture() { stopMediaRecording(); const prepared = preparedMediaRef.current; if (!prepared) return; try { prepared.microphone.disconnect(); } catch { /* already disconnected */ } prepared.stream.getTracks().forEach((track) => track.stop()); if (videoRef.current) videoRef.current.srcObject = null; preparedMediaRef.current = null; }
  function startTraceRecording() { recordedFramesRef.current = []; recordedSampleCountRef.current = 0; setRecordedFrameCount(0); setRecordingNote(''); setRecordingStart(performance.now()); setRecording(true); }
  async function startAutomaticRun() {
    if (automatic) return;
    setMediaError(''); setAutomaticPhase('Preparing'); automaticStartedRef.current = false; await armAudio();
    try { if (includeMedia) await prepareMedia(); } catch (error) { setMediaError(`${(error as Error).message} The VNA trace run will continue without media.`); }
    setAutomatic(true);
    if (!connected) { setAutomaticPhase('Choose the VNA in the USB prompt'); try { await onToggleConnection(); } catch (error) { setMediaError((error as Error).message); setAutomatic(false); setAutomaticPhase('Connection cancelled'); } }
  }
  function stopAutomaticRun() { clearTimers(); setAutomatic(false); automaticStartedRef.current = false; setCapturing(false); setRecording(false); stopMediaCapture(); stopAudio(); setCountdown(null); setSyncFlash(false); setAutomaticPhase('Stopped'); }
  function runSyncSequence() {
    setAutomaticPhase('Sync countdown: keep the setup still, then clap');
    [3, 2, 1].forEach((value, index) => { const timer = window.setTimeout(() => setCountdown(value), index * 1000); timersRef.current.push(timer); });
    const cue = window.setTimeout(() => { setCountdown(null); setSyncFlash(true); addSyncMarker(); setAutomaticPhase('Recording · move the probe and add tags as needed'); const off = window.setTimeout(() => setSyncFlash(false), 300); timersRef.current.push(off); }, 3000); timersRef.current.push(cue);
  }
  function addSyncMarker() {
    if (recording && score?.valid && point && recordedSampleCountRef.current + points.length <= MAX_RECORDED_SAMPLES) { recordedFramesRef.current.push({ timestamp: new Date().toISOString(), elapsedMs: performance.now() - recordingStart, markerIndex: safeIndex, score, s11Re: point.s11.re, s11Im: point.s11.im, event: eventActive, tag: 'SYNC_MARKER', trace: copySweep(points) }); recordedSampleCountRef.current += points.length; setRecordedFrameCount(recordedFramesRef.current.length); }
    const nodes = audioRef.current; if (!nodes) return; const now = nodes.context.currentTime; const normalized = score?.valid ? Math.min(1, score.excess / Math.max(score.threshold * 2, 1e-9)) : 0; nodes.oscillator.frequency.cancelScheduledValues(now); nodes.gain.gain.cancelScheduledValues(now); nodes.oscillator.frequency.setValueAtTime(880, now); nodes.gain.gain.setValueAtTime(.025, now); nodes.gain.gain.exponentialRampToValueAtTime(.0001, now + .12); nodes.oscillator.frequency.setValueAtTime(toneFrequency, now + .13); nodes.gain.gain.setTargetAtTime(dataFresh && eventActive ? normalized * maximumGain : 0, now + .13, .025);
  }
  function exportSession() {
    if (!baseline) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recordedFrames = recordedFramesRef.current;
    const session = { schemaVersion: 1, mode: 'Differential Probe', createdAt: new Date().toISOString(), sourceName, context, selectedFrequencyHz: point?.frequency ?? null, toneMapping: { pitchHz: toneFrequency, loudness: 'normalized Mahalanobis-distance excess above empirical baseline threshold', maximumGain, onsetFrames: 2, releaseFrames: 3, releaseThresholdRatio: .8 }, baseline, frames: recordedFrames };
    download(JSON.stringify(session, null, 2), 'application/json', `nanovna-differential-probe-${stamp}.json`);
    const header = 'timestamp,elapsed_ms,tag,frequency_hz,s11_real,s11_imag,delta_gamma_real,delta_gamma_imag,normalized_distance,threshold,event';
    const csv = [header, ...recordedFrames.map((frame) => [frame.timestamp, frame.elapsedMs, frame.tag, frame.score.frequency, frame.s11Re, frame.s11Im, frame.score.deltaGammaRe, frame.score.deltaGammaIm, frame.score.distance, frame.score.threshold, frame.event].join(','))].join('\n');
    download(csv, 'text/csv', `nanovna-differential-probe-${stamp}.csv`);
  }

  const baselineState = capturing ? `Capturing ${captures.length} of ${captureTarget}` : baseline ? `${baseline.sweepCount} sweeps · threshold ${baseline.threshold.toFixed(2)} σ-equivalent` : 'Not calibrated';
  return <section className="differential-workspace">
    {(countdown !== null || syncFlash) && <div className={`sync-overlay ${syncFlash ? 'flash' : ''}`}><b>{syncFlash ? 'CLAP' : countdown}</b><span>{syncFlash ? 'Sync event recorded' : 'Keep still'}</span></div>}
    <header className="differential-intro"><div><h1>Differential Probe</h1><p>Sonified complex-S11 perturbation relative to a measured baseline. This is a spatial-sensitivity diagnostic, not a calibrated RF-leakage measurement.</p></div><div className="differential-header-actions"><button onClick={() => void onToggleConnection()} disabled={busy}>{busy ? 'Working…' : connected ? 'Disconnect VNA' : 'Connect to VNA'}</button><div className={`differential-event ${eventActive ? 'active' : ''}`}><span>Detector</span><b>{!connected ? 'DISCONNECTED' : !baseline ? 'Uncalibrated' : !dataFresh ? 'Stale' : eventActive ? 'CHANGE' : 'QUIET'}</b></div></div></header>
    <fieldset className="automatic-capture"><legend>Automatic capture</legend><div><p>One run connects the VNA, waits for fresh data, measures the baseline, starts trace and camera/microphone recording, then gives a 3–2–1 clap cue. The generated event tone and room microphone are mixed into the recorded video.</p><label><input type="checkbox" checked={includeMedia} onChange={(event) => setIncludeMedia(event.target.checked)} disabled={automatic} /> Record camera + microphone</label></div><div className="automatic-actions"><button onClick={() => void startAutomaticRun()} disabled={automatic || busy}>Start automatic run</button><button onClick={stopAutomaticRun} disabled={!automatic && !mediaRecording && !recording}>Stop and finalize</button><b>{automaticPhase}</b></div>{includeMedia && <video ref={videoRef} className="media-preview" muted playsInline />}{mediaDownload && <a className="media-download" href={mediaDownload.url} download={mediaDownload.filename}>Download synchronized video + audio</a>}{mediaError && <small className="stale-status">{mediaError}</small>}</fieldset>
    <div className="differential-grid">
      <fieldset><legend>1 · Baseline</legend><label>Repeated sweeps<select value={captureTarget} onChange={(event) => setCaptureTarget(Number(event.target.value))} disabled={capturing}>{[20,30,50,75,100].map((value) => <option key={value}>{value}</option>)}</select></label><button className="wide" onClick={() => beginBaseline()} disabled={!dataFresh || capturing}>{capturing ? 'Keep the setup still…' : 'Capture measured baseline'}</button><div className="instrument-status"><span>Status</span><b>{baselineState}</b><span>Validation false alarms</span><b>{baseline ? `${(baseline.validationFalseAlarmFraction * 100).toFixed(3)}% of held-out frequency samples` : '—'}</b></div>{baselineError && <small className="stale-status">{baselineError}</small>}<small>The first sweeps estimate the complex mean and regularized covariance. Held-out sweeps set the empirical silence threshold. Keep cables, objects, and people still during capture.</small></fieldset>
      <fieldset><legend>2 · Diagnostic channel</legend><label>RF frequency<select value={safeIndex} onChange={(event) => setDiagnosticIndex(Number(event.target.value))}>{points.map((candidate, index) => <option value={index} key={candidate.frequency}>{formatFrequency(candidate.frequency)}</option>)}</select></label><div className="instrument-status"><span>Selected frequency</span><b>{point ? formatFrequency(point.frequency) : '—'}</b><span>ΔΓ</span><b>{score?.valid ? `${score.deltaGammaRe.toExponential(3)} ${score.deltaGammaIm < 0 ? '−' : '+'} j${Math.abs(score.deltaGammaIm).toExponential(3)}` : '—'}</b><span>Normalized distance</span><b>{score?.valid ? score.distance.toFixed(2) : '—'}</b><span>Threshold</span><b>{baseline ? baseline.threshold.toFixed(2) : '—'}</b></div><label>Tone pitch<input type="number" min="80" max="2000" value={toneFrequency} onChange={(event) => setToneFrequency(Number(event.target.value))} /> Hz</label><label>Maximum gain<input type="range" min="0.005" max="0.05" step="0.005" value={maximumGain} onChange={(event) => setMaximumGain(Number(event.target.value))} /></label><div className="instrument-transport"><button onClick={() => void startAudio()} disabled={!baseline || !dataFresh || playing}>Start diagnostic audio</button><button onClick={stopAudio} disabled={!playing}>Stop</button></div><small>Pitch identifies the selected diagnostic channel. Loudness represents only the normalized excess above the measured baseline threshold. Two qualifying frames start an event; three frames below 80% of threshold release it.</small></fieldset>
      <fieldset><legend>3 · Record and annotate</legend><label>Location / action tag<input value={tag} onChange={(event) => setTag(event.target.value)} /></label><div className="instrument-transport"><button onClick={startTraceRecording} disabled={!baseline || recording}>Record trace timeline</button><button onClick={() => { setRecording(false); stopMediaRecording(); }} disabled={!recording && !mediaRecording}>Stop</button><button onClick={runSyncSequence} disabled={!playing && !recording}>Sync countdown</button></div><button className="wide" onClick={exportSession} disabled={!baseline || !recordedFrameCount}>Download JSON + CSV session</button><div className="instrument-status"><span>Trace recording</span><b>{recording ? `${recordedFrameCount} frames` : 'Stopped'}</b><span>Media recording</span><b>{mediaRecording ? 'Camera + mixed audio' : 'Stopped'}</b><span>Source</span><b>{sourceName}</b><span>Calibration</span><b>{context.calibration}</b></div>{recordingNote && <small className="stale-status">{recordingNote}</small>}<small>Each frame contains the complete VNA trace. The sync countdown creates a visible clap cue, an 880 Hz event in the mixed audio, and a SYNC_MARKER in the data log. The clap captured by the room microphone provides an independent alignment check.</small></fieldset>
    </div>
  </section>;
}
