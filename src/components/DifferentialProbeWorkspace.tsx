import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDifferentialBaseline, scoreDifferentialPoint, type DifferentialBaseline, type DifferentialScore } from '../lib/differentialProbe';
import type { SweepPoint } from '../lib/rf';

export interface DifferentialProbeContext { device: string; session: string; calibration: string; processing: string; bandwidthHz: number | null; }
interface AudioNodes { context: AudioContext; oscillator: OscillatorNode; gain: GainNode; limiter: DynamicsCompressorNode; }
interface RecordedFrame { timestamp: string; elapsedMs: number; markerIndex: number; score: DifferentialScore; s11Re: number; s11Im: number; event: boolean; tag: string; trace: SweepPoint[]; }
const MAX_RECORDED_SAMPLES = 100_000;

function copySweep(points: SweepPoint[]) { return points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })); }
function formatFrequency(value: number) { return value >= 1e6 ? `${(value / 1e6).toFixed(6)} MHz` : value >= 1e3 ? `${(value / 1e3).toFixed(3)} kHz` : `${value.toFixed(0)} Hz`; }
function download(text: string, type: string, filename: string) { const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function DifferentialProbeWorkspace({ points, markerIndex, context, dataFresh, sourceName }: { points: SweepPoint[]; markerIndex: number; context: DifferentialProbeContext; dataFresh: boolean; sourceName: string; }) {
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
  const audioRef = useRef<AudioNodes | null>(null);
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
    if (recordedSampleCountRef.current + points.length > MAX_RECORDED_SAMPLES) { setRecording(false); setRecordingNote(`Recording stopped at the ${MAX_RECORDED_SAMPLES.toLocaleString()}-sample in-memory safety limit. Download this session before starting another.`); return; }
    recordedFramesRef.current.push({ timestamp: new Date().toISOString(), elapsedMs: performance.now() - recordingStart, markerIndex: safeIndex, score, s11Re: point.s11.re, s11Im: point.s11.im, event: eventActive, tag, trace: copySweep(points) });
    recordedSampleCountRef.current += points.length;
    setRecordedFrameCount(recordedFramesRef.current.length);
  }, [eventActive, point, points, recording, recordingStart, safeIndex, score, tag]);

  useEffect(() => () => stopAudio(), []);

  function beginBaseline() { stopAudio(); setBaseline(null); setCaptures([]); setBaselineError(''); latestCaptureRef.current = null; setCapturing(true); }
  async function startAudio() {
    if (!baseline || !score?.valid || audioRef.current) return;
    const contextAudio = new AudioContext(); const oscillator = contextAudio.createOscillator(); const gain = contextAudio.createGain(); const limiter = contextAudio.createDynamicsCompressor();
    oscillator.type = 'sine'; oscillator.frequency.value = toneFrequency; gain.gain.value = 0; limiter.threshold.value = -18; limiter.ratio.value = 12; limiter.attack.value = .003; limiter.release.value = .1;
    oscillator.connect(gain).connect(limiter).connect(contextAudio.destination); oscillator.start(); await contextAudio.resume(); audioRef.current = { context: contextAudio, oscillator, gain, limiter }; setPlaying(true);
  }
  function stopAudio() { const nodes = audioRef.current; if (!nodes) return; const now = nodes.context.currentTime; nodes.gain.gain.setTargetAtTime(0, now, .01); try { nodes.oscillator.stop(now + .05); } catch { /* already stopped */ } window.setTimeout(() => void nodes.context.close(), 80); audioRef.current = null; setPlaying(false); }
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
    <header className="differential-intro"><div><h1>Differential Probe</h1><p>Sonified complex-S11 perturbation relative to a measured baseline. This is a spatial-sensitivity diagnostic, not a calibrated RF-leakage measurement.</p></div><div className={`differential-event ${eventActive ? 'active' : ''}`}><span>Detector</span><b>{!baseline ? 'Uncalibrated' : !dataFresh ? 'Stale' : eventActive ? 'CHANGE' : 'QUIET'}</b></div></header>
    <div className="differential-grid">
      <fieldset><legend>1 · Baseline</legend><label>Repeated sweeps<select value={captureTarget} onChange={(event) => setCaptureTarget(Number(event.target.value))} disabled={capturing}>{[20,30,50,75,100].map((value) => <option key={value}>{value}</option>)}</select></label><button className="wide" onClick={beginBaseline} disabled={!dataFresh || capturing}>{capturing ? 'Keep the setup still…' : 'Capture measured baseline'}</button><div className="instrument-status"><span>Status</span><b>{baselineState}</b><span>Validation false alarms</span><b>{baseline ? `${(baseline.validationFalseAlarmFraction * 100).toFixed(3)}% of held-out frequency samples` : '—'}</b></div>{baselineError && <small className="stale-status">{baselineError}</small>}<small>The first sweeps estimate the complex mean and regularized covariance. Held-out sweeps set the empirical silence threshold. Keep cables, objects, and people still during capture.</small></fieldset>
      <fieldset><legend>2 · Diagnostic channel</legend><label>RF frequency<select value={safeIndex} onChange={(event) => setDiagnosticIndex(Number(event.target.value))}>{points.map((candidate, index) => <option value={index} key={candidate.frequency}>{formatFrequency(candidate.frequency)}</option>)}</select></label><div className="instrument-status"><span>Selected frequency</span><b>{point ? formatFrequency(point.frequency) : '—'}</b><span>ΔΓ</span><b>{score?.valid ? `${score.deltaGammaRe.toExponential(3)} ${score.deltaGammaIm < 0 ? '−' : '+'} j${Math.abs(score.deltaGammaIm).toExponential(3)}` : '—'}</b><span>Normalized distance</span><b>{score?.valid ? score.distance.toFixed(2) : '—'}</b><span>Threshold</span><b>{baseline ? baseline.threshold.toFixed(2) : '—'}</b></div><label>Tone pitch<input type="number" min="80" max="2000" value={toneFrequency} onChange={(event) => setToneFrequency(Number(event.target.value))} /> Hz</label><label>Maximum gain<input type="range" min="0.005" max="0.05" step="0.005" value={maximumGain} onChange={(event) => setMaximumGain(Number(event.target.value))} /></label><div className="instrument-transport"><button onClick={() => void startAudio()} disabled={!baseline || !dataFresh || playing}>Start diagnostic audio</button><button onClick={stopAudio} disabled={!playing}>Stop</button></div><small>Pitch identifies the selected diagnostic channel. Loudness represents only the normalized excess above the measured baseline threshold. Two qualifying frames start an event; three frames below 80% of threshold release it.</small></fieldset>
      <fieldset><legend>3 · Record and annotate</legend><label>Location / action tag<input value={tag} onChange={(event) => setTag(event.target.value)} /></label><div className="instrument-transport"><button onClick={() => { recordedFramesRef.current = []; recordedSampleCountRef.current = 0; setRecordedFrameCount(0); setRecordingNote(''); setRecordingStart(performance.now()); setRecording(true); }} disabled={!baseline || recording}>Record trace timeline</button><button onClick={() => setRecording(false)} disabled={!recording}>Stop</button><button onClick={addSyncMarker} disabled={!playing && !recording}>Sync marker</button></div><button className="wide" onClick={exportSession} disabled={!baseline || !recordedFrameCount}>Download JSON + CSV session</button><div className="instrument-status"><span>Recording</span><b>{recording ? `${recordedFrameCount} frames` : 'Stopped'}</b><span>Source</span><b>{sourceName}</b><span>Calibration</span><b>{context.calibration}</b></div>{recordingNote && <small className="stale-status">{recordingNote}</small>}<small>Each recorded frame contains the complete acquired VNA trace. Recording stops automatically before exceeding 100,000 stored frequency samples. The sync marker creates a short 880 Hz cue and a timestamped event. A later capture increment will mix microphone/camera media with this event audio; a visible clap can provide an independent video alignment transient.</small></fieldset>
    </div>
  </section>;
}
