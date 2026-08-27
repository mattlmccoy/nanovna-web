import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeDifferentialSweep, assessBaselineStability, buildDifferentialBaseline, recommendDifferentialAudioMapping, scoreDifferentialPoint, type BaselineStability, type DifferentialBaseline, type DifferentialScore, type DifferentialSweepAnalysis } from '../lib/differentialProbe';
import { buildGuidedProtocol, type GuidedProtocolStep } from '../lib/guidedProtocol';
import type { SweepPoint } from '../lib/rf';
import { createStoredZip, type ZipEntry } from '../lib/zip';

export interface DifferentialProbeContext { device: string; session: string; calibration: string; processing: string; bandwidthHz: number | null; }
interface AudioNodes { context: AudioContext; oscillator: OscillatorNode; gain: GainNode; limiter: DynamicsCompressorNode; recordingDestination: MediaStreamAudioDestinationNode; }
interface PreparedMedia { stream: MediaStream; microphone: MediaStreamAudioSourceNode; }
interface ActiveMediaRecording { recorder: MediaRecorder; chunks: Blob[]; mimeType: string; startedAt: number; }
interface RecordedFrame { timestamp: string; elapsedMs: number; markerIndex: number; score: DifferentialScore; analysis: DifferentialSweepAnalysis; s11Re: number; s11Im: number; event: boolean; tag: string; trace: SweepPoint[]; }
interface DetectedEvent { id: number; startTimestamp: string; startElapsedMs: number; endTimestamp: string | null; endElapsedMs: number | null; tag: string; classification: DifferentialSweepAnalysis['classification']; peakDistance: number; maximumAffectedFraction: number; resonanceShiftHz: number; bands: DifferentialSweepAnalysis['bands']; }
interface ProtocolCue { timestamp: string; elapsedMs: number | null; stepIndex: number; component: string; repetition: number; action: string; tag: string; }
const MAX_RECORDED_SAMPLES = 500_000;
const MAX_MEDIA_DURATION_MS = 10 * 60 * 1000;
const COMPONENT_OPTIONS = ['Series capacitor bank', 'Shunt capacitor bank', 'Transformer', 'Electrode plates', 'Wiring / interconnects', 'Inductor / inductor bank', 'Connectors', 'Enclosure / shield seam'];

function copySweep(points: SweepPoint[]) { return points.map((point) => ({ ...point, s11: { ...point.s11 }, s21: { ...point.s21 } })); }
function formatFrequency(value: number) { return value >= 1e6 ? `${(value / 1e6).toFixed(6)} MHz` : value >= 1e3 ? `${(value / 1e3).toFixed(3)} kHz` : `${value.toFixed(0)} Hz`; }
function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function touchstone(points: SweepPoint[], header: string) { return [`! ${header}`, '# Hz S RI R 50', ...points.map((point) => `${point.frequency} ${point.s11.re} ${point.s11.im}`)].join('\n'); }

export function DifferentialProbeWorkspace({ points, markerIndex, context, dataFresh, sourceName, connected, busy, onToggleConnection, onStartSweeping, onStopSweeping }: { points: SweepPoint[]; markerIndex: number; context: DifferentialProbeContext; dataFresh: boolean; sourceName: string; connected: boolean; busy: boolean; onToggleConnection: () => Promise<void>; onStartSweeping: () => void; onStopSweeping: () => void; }) {
  const [captureTarget, setCaptureTarget] = useState(50);
  const [diagnosticIndex, setDiagnosticIndex] = useState(markerIndex);
  const [captures, setCaptures] = useState<SweepPoint[][]>([]);
  const [capturing, setCapturing] = useState(false);
  const [baseline, setBaseline] = useState<DifferentialBaseline | null>(null);
  const [baselineError, setBaselineError] = useState('');
  const [baselineStability, setBaselineStability] = useState<BaselineStability | null>(null);
  const [baselineWarning, setBaselineWarning] = useState('');
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
  const [, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaDownload, setMediaDownload] = useState<{ url: string; filename: string; blob: Blob } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const [specimenId, setSpecimenId] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [probeType, setProbeType] = useState('hand / uncharacterized perturbing object');
  const [probeStandoff, setProbeStandoff] = useState('');
  const [experimentNotes, setExperimentNotes] = useState('');
  const [detectedEvents, setDetectedEvents] = useState<DetectedEvent[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [otherComponent, setOtherComponent] = useState('');
  const [guideRepetitions, setGuideRepetitions] = useState(1);
  const [guidedPlan, setGuidedPlan] = useState<GuidedProtocolStep[]>([]);
  const [guideStepIndex, setGuideStepIndex] = useState(-1);
  const [guideStep, setGuideStep] = useState<GuidedProtocolStep | null>(null);
  const [guideSeconds, setGuideSeconds] = useState(0);
  const audioRef = useRef<AudioNodes | null>(null);
  const preparedMediaRef = useRef<PreparedMedia | null>(null);
  const mediaRecordingRef = useRef<ActiveMediaRecording | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const automaticStartedRef = useRef(false);
  const acquisitionStartedRef = useRef(false);
  const previousSessionRef = useRef(context.session);
  const protocolCuesRef = useRef<ProtocolCue[]>([]);
  const timersRef = useRef<number[]>([]);
  const recordedFramesRef = useRef<RecordedFrame[]>([]);
  const recordedSampleCountRef = useRef(0);
  const onsetRef = useRef(0);
  const releaseRef = useRef(0);
  const broadChangeRef = useRef(0);
  const activeEventRef = useRef<DetectedEvent | null>(null);
  const latestCaptureRef = useRef<SweepPoint[] | null>(null);
  const safeIndex = Math.min(diagnosticIndex, Math.max(0, points.length - 1));
  const point = points[safeIndex];
  const score = useMemo(() => baseline && point ? scoreDifferentialPoint(point, baseline, safeIndex) : null, [baseline, point, safeIndex]);
  const sweepAnalysis = useMemo(() => baseline && points.length ? analyzeDifferentialSweep(points, baseline) : null, [baseline, points]);
  const mappingRecommendation = useMemo(() => recommendDifferentialAudioMapping(sweepAnalysis), [sweepAnalysis]);

  useEffect(() => {
    if (!capturing || !dataFresh || !points.length || latestCaptureRef.current === points) return;
    latestCaptureRef.current = points;
    setCaptures((current) => {
      const next = [...current, copySweep(points)];
      const stability = next.length >= 20 ? assessBaselineStability(next) : null;
      setBaselineStability(stability);
      if (next.length >= captureTarget || stability?.ready) {
        setCapturing(false);
        try { setBaseline(buildDifferentialBaseline(next)); setBaselineError(''); }
        catch (error) { setBaseline(null); setBaselineError((error as Error).message); }
      }
      return next;
    });
  }, [captureTarget, capturing, dataFresh, points]);

  useEffect(() => {
    if (!sweepAnalysis?.valid || !dataFresh || !baseline) { onsetRef.current = 0; releaseRef.current = 0; setEventActive(false); return; }
    const changed = sweepAnalysis.affectedPointCount > 0;
    if (changed) {
      onsetRef.current += 1; releaseRef.current = 0;
      if (onsetRef.current >= 2) setEventActive(true);
    } else {
      releaseRef.current += 1; onsetRef.current = 0;
      if (releaseRef.current >= 3) setEventActive(false);
    }
    broadChangeRef.current = sweepAnalysis.affectedFraction >= 0.5 ? broadChangeRef.current + 1 : 0;
    setBaselineWarning(broadChangeRef.current >= 8 ? 'Persistent broadband change. Check cable, connector, fixture, and baseline validity before interpreting this as a local perturbation.' : '');
  }, [baseline, dataFresh, sweepAnalysis]);

  useEffect(() => {
    if (!sweepAnalysis?.valid || !recording) return;
    if (eventActive && !activeEventRef.current) {
      activeEventRef.current = { id: detectedEvents.length + 1, startTimestamp: new Date().toISOString(), startElapsedMs: performance.now() - recordingStart, endTimestamp: null, endElapsedMs: null, tag, classification: sweepAnalysis.classification, peakDistance: sweepAnalysis.maximumDistance, maximumAffectedFraction: sweepAnalysis.affectedFraction, resonanceShiftHz: sweepAnalysis.resonanceShiftHz, bands: sweepAnalysis.bands };
    } else if (eventActive && activeEventRef.current) {
      const event = activeEventRef.current; event.peakDistance = Math.max(event.peakDistance, sweepAnalysis.maximumDistance); event.maximumAffectedFraction = Math.max(event.maximumAffectedFraction, sweepAnalysis.affectedFraction); if (Math.abs(sweepAnalysis.resonanceShiftHz) > Math.abs(event.resonanceShiftHz)) event.resonanceShiftHz = sweepAnalysis.resonanceShiftHz; if (sweepAnalysis.bands.length) event.bands = sweepAnalysis.bands;
    } else if (!eventActive && activeEventRef.current) {
      const completed = { ...activeEventRef.current, endTimestamp: new Date().toISOString(), endElapsedMs: performance.now() - recordingStart }; activeEventRef.current = null; setDetectedEvents((events) => [...events, completed]);
    }
  }, [detectedEvents.length, eventActive, recording, recordingStart, sweepAnalysis, tag]);

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
    if (!sweepAnalysis?.valid) return;
    recordedFramesRef.current.push({ timestamp: new Date().toISOString(), elapsedMs: performance.now() - recordingStart, markerIndex: safeIndex, score, analysis: sweepAnalysis, s11Re: point.s11.re, s11Im: point.s11.im, event: eventActive, tag, trace: copySweep(points) });
    recordedSampleCountRef.current += points.length;
    setRecordedFrameCount(recordedFramesRef.current.length);
  }, [eventActive, point, points, recording, recordingStart, safeIndex, score, sweepAnalysis, tag]);

  useEffect(() => () => { clearTimers(); stopMediaCapture(); stopAudio(); }, []);

  useEffect(() => {
    if (previousSessionRef.current === context.session) return;
    previousSessionRef.current = context.session;
    if (!automatic) {
      stopAutomaticRun();
      protocolCuesRef.current = [];
      setGuidedPlan([]); setGuideStep(null); setGuideStepIndex(-1); setGuideSeconds(0);
    } else {
      acquisitionStartedRef.current = false;
      automaticStartedRef.current = false;
      setAutomaticPhase('VNA connected · starting acquisition');
    }
    setCapturing(false);
    setCaptures([]);
    setBaseline(null);
    setBaselineError('');
    setBaselineStability(null);
    setBaselineWarning('');
    setRecording(false);
    recordedFramesRef.current = [];
    recordedSampleCountRef.current = 0;
    setRecordedFrameCount(0);
    setRecordingNote('');
    setDetectedEvents([]);
    activeEventRef.current = null;
  }, [context.session]);

  useEffect(() => {
    if (!automatic) return;
    if (!connected) { setAutomaticPhase('Choose the VNA in the USB prompt'); return; }
    if (!acquisitionStartedRef.current) { acquisitionStartedRef.current = true; setAutomaticPhase('Starting continuous VNA sweeps'); onStartSweeping(); return; }
    if (!dataFresh) { setAutomaticPhase('Waiting for a fresh VNA sweep'); return; }
    if (!baseline && !capturing) { setAutomaticPhase('Capturing the measured baseline'); beginBaseline(true); return; }
    if (capturing) { setAutomaticPhase(`Baseline ${captures.length} / ${captureTarget}`); return; }
    if (baseline && !automaticStartedRef.current) {
      automaticStartedRef.current = true;
      setAutomaticPhase('Starting synchronized recording');
      startTraceRecording();
      void (async () => {
        if (includeMedia && preparedMediaRef.current) await startMediaRecording();
        runSyncSequence(true);
      })();
    }
  }, [automatic, baseline, captureTarget, captures.length, capturing, connected, dataFresh, includeMedia, onStartSweeping]);

  function clearTimers() { timersRef.current.forEach((timer) => window.clearTimeout(timer)); timersRef.current = []; }
  function beginBaseline(preserveAudio = false) { if (!preserveAudio) stopAudio(); setBaseline(null); setCaptures([]); setBaselineError(''); setBaselineStability(null); setBaselineWarning(''); broadChangeRef.current = 0; latestCaptureRef.current = null; setCapturing(true); }
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
    setMediaReady(true);
    if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
  }
  function preferredMediaType() { return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''; }
  async function startMediaRecording() {
    if (mediaRecordingRef.current || !preparedMediaRef.current || !audioRef.current) return;
    if (mediaDownload) { URL.revokeObjectURL(mediaDownload.url); setMediaDownload(null); }
    const combined = new MediaStream([...preparedMediaRef.current.stream.getVideoTracks(), ...audioRef.current.recordingDestination.stream.getAudioTracks()]);
    const mimeType = preferredMediaType(); const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined); const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => { const type = recorder.mimeType || mimeType || 'video/webm'; const extension = type.includes('mp4') ? 'mp4' : 'webm'; const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const blob = new Blob(chunks, { type }); const url = URL.createObjectURL(blob); setMediaDownload({ url, filename: `nanovna-differential-probe-${stamp}.${extension}`, blob }); setMediaRecording(false); };
    mediaRecordingRef.current = { recorder, chunks, mimeType, startedAt: performance.now() }; recorder.start(1000); setMediaRecording(true);
    const timer = window.setTimeout(() => { stopMediaRecording(); setRecording(false); setRecordingNote('Recording stopped at the 10-minute browser memory safety limit.'); setAutomatic(false); setAutomaticPhase('Stopped at 10-minute limit'); }, MAX_MEDIA_DURATION_MS); timersRef.current.push(timer);
  }
  function stopMediaRecording() { const active = mediaRecordingRef.current; if (!active) return; if (active.recorder.state !== 'inactive') active.recorder.stop(); mediaRecordingRef.current = null; }
  function stopMediaCapture() { stopMediaRecording(); const prepared = preparedMediaRef.current; if (!prepared) { setMediaReady(false); return; } try { prepared.microphone.disconnect(); } catch { /* already disconnected */ } prepared.stream.getTracks().forEach((track) => track.stop()); if (videoRef.current) videoRef.current.srcObject = null; preparedMediaRef.current = null; setMediaReady(false); }
  function startTraceRecording() { recordedFramesRef.current = []; recordedSampleCountRef.current = 0; setRecordedFrameCount(0); setRecordingNote(''); setDetectedEvents([]); activeEventRef.current = null; setRecordingStart(performance.now()); setRecording(true); }
  function configuredComponents() { return [...selectedComponents, ...(otherComponent.trim() ? [otherComponent.trim()] : [])]; }
  function toggleComponent(component: string) { setSelectedComponents((current) => current.includes(component) ? current.filter((item) => item !== component) : [...current, component]); }
  async function startAutomaticRun() {
    if (automatic) return;
    const plan = buildGuidedProtocol(configuredComponents(), guideRepetitions);
    if (!plan.length) { setMediaError('Select at least one network component before starting the guided run.'); return; }
    if (plan.reduce((sum, step) => sum + step.durationSeconds, 0) > 480) { setMediaError('This guided plan exceeds eight minutes. Reduce the repetitions or split the components across two runs so recording can finalize safely.'); return; }
    setGuidedPlan(plan); setGuideStep(null); setGuideStepIndex(-1); setGuideSeconds(0); protocolCuesRef.current = [];
    setMediaError(''); setAutomaticPhase('Preparing'); automaticStartedRef.current = false; await armAudio();
    try { if (includeMedia) await prepareMedia(); } catch (error) { setMediaError(`${(error as Error).message} The VNA trace run will continue without media.`); }
    setAutomatic(true);
    if (!connected) { setAutomaticPhase('Choose the VNA in the USB prompt'); try { await onToggleConnection(); } catch (error) { setMediaError((error as Error).message); setAutomatic(false); setAutomaticPhase('Connection cancelled'); } }
  }
  function stopAutomaticRun() { clearTimers(); setAutomatic(false); automaticStartedRef.current = false; acquisitionStartedRef.current = false; setCapturing(false); setRecording(false); setGuideStep(null); setGuideStepIndex(-1); setGuideSeconds(0); onStopSweeping(); stopMediaCapture(); stopAudio(); setCountdown(null); setSyncFlash(false); setAutomaticPhase('Stopped'); }
  function runSyncSequence(startGuideInput: unknown = false) {
    const startGuide = startGuideInput === true;
    setAutomaticPhase('Sync countdown: keep the setup still, then clap');
    [3, 2, 1].forEach((value, index) => { const timer = window.setTimeout(() => setCountdown(value), index * 1000); timersRef.current.push(timer); });
    const cue = window.setTimeout(() => { setCountdown(null); setSyncFlash(true); addSyncMarker(); setAutomaticPhase(startGuide ? 'Sync complete · guided test begins next' : 'Recording · manual probing'); const off = window.setTimeout(() => { setSyncFlash(false); if (startGuide) beginGuidedStep(0); }, 700); timersRef.current.push(off); }, 3000); timersRef.current.push(cue);
  }
  function beginGuidedStep(index: number) {
    const step = guidedPlan[index];
    if (!step) { finishGuidedRun(); return; }
    setGuideStepIndex(index); setGuideStep(step); setGuideSeconds(step.durationSeconds); setTag(step.tag); setAutomaticPhase(`${index + 1} / ${guidedPlan.length} · ${step.title}`);
    protocolCuesRef.current.push({ timestamp: new Date().toISOString(), elapsedMs: recording ? performance.now() - recordingStart : null, stepIndex: index, component: step.component, repetition: step.repetition, action: step.action, tag: step.tag });
    let remaining = step.durationSeconds;
    const tick = () => { remaining -= 1; setGuideSeconds(Math.max(0, remaining)); if (remaining <= 0) beginGuidedStep(index + 1); else { const timer = window.setTimeout(tick, 1000); timersRef.current.push(timer); } };
    const timer = window.setTimeout(tick, 1000); timersRef.current.push(timer);
  }
  function finishGuidedRun() { clearTimers(); setGuideStep(null); setGuideSeconds(0); setRecording(false); stopMediaCapture(); stopAudio(); onStopSweeping(); acquisitionStartedRef.current = false; automaticStartedRef.current = false; setAutomatic(false); setAutomaticPhase('Guided run complete · download the media and paper-ready bundle'); }
  async function enableManualMedia() { setMediaError(''); setIncludeMedia(true); try { await prepareMedia(); } catch (error) { setMediaError((error as Error).message); } }
  async function startManualMedia() { setMediaError(''); setIncludeMedia(true); try { await prepareMedia(); if (baseline && !recording) startTraceRecording(); await startMediaRecording(); } catch (error) { setMediaError((error as Error).message); } }
  function addSyncMarker() {
    if (recording && score?.valid && sweepAnalysis?.valid && point && recordedSampleCountRef.current + points.length <= MAX_RECORDED_SAMPLES) { recordedFramesRef.current.push({ timestamp: new Date().toISOString(), elapsedMs: performance.now() - recordingStart, markerIndex: safeIndex, score, analysis: sweepAnalysis, s11Re: point.s11.re, s11Im: point.s11.im, event: eventActive, tag: 'SYNC_MARKER', trace: copySweep(points) }); recordedSampleCountRef.current += points.length; setRecordedFrameCount(recordedFramesRef.current.length); }
    const nodes = audioRef.current; if (!nodes) return; const now = nodes.context.currentTime; const normalized = score?.valid ? Math.min(1, score.excess / Math.max(score.threshold * 2, 1e-9)) : 0; nodes.oscillator.frequency.cancelScheduledValues(now); nodes.gain.gain.cancelScheduledValues(now); nodes.oscillator.frequency.setValueAtTime(880, now); nodes.gain.gain.setValueAtTime(.025, now); nodes.gain.gain.exponentialRampToValueAtTime(.0001, now + .12); nodes.oscillator.frequency.setValueAtTime(toneFrequency, now + .13); nodes.gain.gain.setTargetAtTime(dataFresh && eventActive ? normalized * maximumGain : 0, now + .13, .025);
  }
  async function exportSession() {
    if (!baseline) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recordedFrames = recordedFramesRef.current;
    const completedEvents = activeEventRef.current ? [...detectedEvents, { ...activeEventRef.current, endTimestamp: null, endElapsedMs: null }] : detectedEvents;
    const intervals = recordedFrames.slice(1).map((frame, index) => frame.elapsedMs - recordedFrames[index].elapsedMs).filter((value) => value > 0); const sortedIntervals = intervals.slice().sort((a, b) => a - b); const medianIntervalMs = sortedIntervals.length ? sortedIntervals[Math.floor(sortedIntervals.length / 2)] : null;
    const acquisitionQuality = { frameCount: recordedFrames.length, frequencySamples: recordedSampleCountRef.current, medianIntervalMs, maximumIntervalMs: intervals.length ? Math.max(...intervals) : null, suspectedDroppedTraceGaps: medianIntervalMs ? intervals.filter((value) => value > medianIntervalMs * 2.5).length : 0, baselineValidityWarning: baselineWarning || null };
    const metadata = { specimenId, operator: operatorName, probeType, probeStandoff, networkComponents: configuredComponents(), guidedRepetitions: guideRepetitions, notes: experimentNotes };
    const baselineSweeps = captures.map((sweep) => copySweep(sweep));
    const session = { schemaVersion: 3, mode: 'Differential Probe', createdAt: new Date().toISOString(), sourceName, context, metadata, guidedProtocol: { plan: guidedPlan, cues: protocolCuesRef.current }, selectedFrequencyHz: point?.frequency ?? null, toneMapping: { pitchHz: toneFrequency, pitchMeaning: 'fixed identity of the selected RF channel', loudness: 'normalized Mahalanobis-distance excess above empirical baseline threshold', maximumGain, onsetFrames: 2, releaseFrames: 3 }, recommendedMapping: mappingRecommendation, baseline, baselineStability, baselineSweeps, acquisitionQuality, events: completedEvents, frames: recordedFrames };
    const textEntries: Array<{ name: string; content: string }> = [{ name: `nanovna-differential-probe-${stamp}.json`, content: JSON.stringify(session, null, 2) }];
    const header = 'timestamp,elapsed_ms,tag,frequency_hz,s11_real,s11_imag,delta_gamma_real,delta_gamma_imag,normalized_distance,threshold,event,classification,affected_fraction,resonance_shift_hz';
    const csv = [header, ...recordedFrames.map((frame) => [frame.timestamp, frame.elapsedMs, JSON.stringify(frame.tag), frame.score.frequency, frame.s11Re, frame.s11Im, frame.score.deltaGammaRe, frame.score.deltaGammaIm, frame.score.distance, frame.score.threshold, frame.event, frame.analysis.classification, frame.analysis.affectedFraction, frame.analysis.resonanceShiftHz].join(','))].join('\n');
    textEntries.push({ name: `nanovna-differential-probe-${stamp}.csv`, content: csv });
    const eventHeader = 'event_id,start_timestamp,start_elapsed_ms,end_timestamp,end_elapsed_ms,tag,classification,peak_distance,maximum_affected_fraction,resonance_shift_hz,affected_bands_json';
    textEntries.push({ name: `nanovna-differential-events-${stamp}.csv`, content: [eventHeader, ...completedEvents.map((event) => [event.id, event.startTimestamp, event.startElapsedMs, event.endTimestamp ?? '', event.endElapsedMs ?? '', JSON.stringify(event.tag), event.classification, event.peakDistance, event.maximumAffectedFraction, event.resonanceShiftHz, JSON.stringify(JSON.stringify(event.bands))].join(','))].join('\n') });
    const baselinePoints = baseline.frequencies.map((model) => ({ frequency: model.frequency, s11: { re: model.meanRe, im: model.meanIm }, s21: { re: 0, im: 0 } }));
    textEntries.push({ name: `nanovna-differential-baseline-${stamp}.s1p`, content: touchstone(baselinePoints, `Differential Probe baseline mean; specimen=${specimenId || 'unspecified'}; calibration=${context.calibration}`) });
    if (recordedFrames.length) textEntries.push({ name: `nanovna-differential-final-${stamp}.s1p`, content: touchstone(recordedFrames[recordedFrames.length - 1].trace, `Differential Probe final recorded trace; specimen=${specimenId || 'unspecified'}; calibration=${context.calibration}`) });
    const readme = [`NanoVNA Differential Probe session`, `Created: ${session.createdAt}`, `Specimen: ${specimenId || 'unspecified'}`, `Source: ${sourceName}`, `Calibration: ${context.calibration}`, `Frames: ${recordedFrames.length}`, `Events: ${completedEvents.length}`, `Synchronized media: ${mediaDownload ? mediaDownload.filename : 'not recorded'}`, '', 'The JSON is the lossless analysis record. CSV files contain frame and detected-event tables. S1P files contain the measured baseline mean and final trace.'].join('\n');
    textEntries.push({ name: 'README.txt', content: readme });
    const zipEntries: ZipEntry[] = textEntries.map((entry) => ({ name: entry.name, data: new TextEncoder().encode(entry.content) }));
    if (mediaDownload) zipEntries.push({ name: mediaDownload.filename, data: new Uint8Array(await mediaDownload.blob.arrayBuffer()) });
    const zip = createStoredZip(zipEntries);
    downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `nanovna-differential-session-${stamp}.zip`);
  }

  const baselineState = capturing ? `Capturing ${captures.length} · maximum ${captureTarget}` : baseline ? `${baseline.sweepCount} sweeps · threshold ${baseline.threshold.toFixed(2)} σ-equivalent` : 'Not calibrated';
  return <section className="differential-workspace">
    {(countdown !== null || syncFlash) && <div className={`sync-overlay ${syncFlash ? 'flash' : ''}`}><b>{syncFlash ? 'CLAP' : countdown}</b><span>{syncFlash ? 'Sync event recorded' : 'Keep still'}</span></div>}
    {guideStep && <div className={`guided-cue ${guideStep.action}`}><span>{guideStepIndex + 1} / {guidedPlan.length} · {guideStep.component} · repetition {guideStep.repetition}</span><b>{guideStep.title}</b><p>{guideStep.instruction}</p><strong>{guideSeconds}s</strong></div>}
    <header className="differential-intro"><div><h1>Differential Probe</h1><p>Sonified complex-S11 perturbation relative to a measured baseline. This is a spatial-sensitivity diagnostic, not a calibrated RF-leakage measurement.</p></div><div className="differential-header-actions"><button onClick={() => void onToggleConnection()} disabled={busy}>{busy ? 'Working…' : connected ? 'Disconnect VNA' : 'Connect to VNA'}</button><div className={`differential-event ${eventActive ? 'active' : ''}`}><span>Detector</span><b>{!connected ? 'DISCONNECTED' : !baseline ? 'Uncalibrated' : !dataFresh ? 'Stale' : eventActive ? 'CHANGE' : 'QUIET'}</b></div></div></header>
    <fieldset className="network-setup"><legend>Before starting · describe the network</legend><p>Select every component or region the guided test should approach. The runner creates labeled prepare, approach, hold, withdraw, and recovery intervals for each selection.</p><div className="component-picker">{COMPONENT_OPTIONS.map((component) => <label key={component}><input type="checkbox" checked={selectedComponents.includes(component)} onChange={() => toggleComponent(component)} disabled={automatic} /> {component}</label>)}</div><div className="network-custom"><label>Other component / region<input value={otherComponent} onChange={(event) => setOtherComponent(event.target.value)} disabled={automatic} placeholder="e.g. matching inductor L2" /></label><label>Repetitions<select value={guideRepetitions} onChange={(event) => setGuideRepetitions(Number(event.target.value))} disabled={automatic}>{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label></div><small>{configuredComponents().length ? `${configuredComponents().length} component${configuredComponents().length === 1 ? '' : 's'} selected · ${buildGuidedProtocol(configuredComponents(), guideRepetitions).length} timed steps` : 'Select at least one component to enable the guided automatic run.'}</small></fieldset>
    <fieldset className="automatic-capture"><legend>Automatic guided capture</legend><div><p>Connects the VNA, starts complete repeated sweeps, measures the baseline, enables synchronized media, gives the clap cue, then guides every selected approach and recovery action. At the end it stops and finalizes the recording.</p><label><input type="checkbox" checked={includeMedia} onChange={(event) => setIncludeMedia(event.target.checked)} disabled={automatic} /> Record camera + microphone</label><div className="manual-media-actions"><button onClick={() => void enableManualMedia()} disabled={automatic || Boolean(preparedMediaRef.current)}>Enable camera + microphone</button><button onClick={() => void startManualMedia()} disabled={automatic || mediaRecording}>Start manual media recording</button><button onClick={stopMediaRecording} disabled={!mediaRecording}>Finalize media</button></div></div><div className="automatic-actions"><button onClick={() => void startAutomaticRun()} disabled={automatic || busy || !configuredComponents().length}>Start guided run</button><button onClick={stopAutomaticRun} disabled={!automatic && !mediaRecording && !recording}>Stop and finalize</button><button onClick={onStartSweeping} disabled={!connected || busy}>Start VNA stream</button><b>{automaticPhase}</b></div>{includeMedia && <video ref={videoRef} className="media-preview" muted playsInline />}{mediaDownload && <a className="media-download" href={mediaDownload.url} download={mediaDownload.filename}>Download synchronized video + audio</a>}{mediaError && <small className="stale-status">{mediaError}</small>}</fieldset>
    {baseline && recordedFrameCount > 0 && !recording && !mediaRecording && <div className="download-ready-panel"><div><b>Run complete · files ready</b><span>{mediaDownload ? 'One ZIP contains the measurements, event table, Touchstone files, session metadata, and synchronized media.' : 'One ZIP contains the measurements, event table, Touchstone files, and session metadata. No media was recorded.'}</span></div><button onClick={() => void exportSession()}>Download complete ZIP</button></div>}
    <div className="mapping-recommendation"><span>Suggested mapping</span><b>{mappingRecommendation.mode}</b><span>{mappingRecommendation.reason}</span><small>Pitch: {mappingRecommendation.pitchMeaning} · Loudness: {mappingRecommendation.loudnessMeaning} · Secondary: {mappingRecommendation.secondaryMeaning}</small></div>
    <div className="differential-grid">
      <fieldset><legend>1 · Baseline</legend><label>Maximum sweeps<select value={captureTarget} onChange={(event) => setCaptureTarget(Number(event.target.value))} disabled={capturing}>{[30,50,75,100].map((value) => <option key={value}>{value}</option>)}</select></label><button className="wide" onClick={() => beginBaseline()} disabled={!dataFresh || capturing}>{capturing ? 'Keep the setup still…' : 'Capture measured baseline'}</button><div className="instrument-status"><span>Status</span><b>{baselineState}</b><span>Convergence</span><b>{baselineStability ? `${baselineStability.ready ? 'Ready' : 'Waiting'} · drift/threshold ${Number.isFinite(baselineStability.driftToThresholdRatio) ? baselineStability.driftToThresholdRatio.toFixed(3) : '—'}` : '—'}</b><span>Validation false alarms</span><b>{baseline ? `${(baseline.validationFalseAlarmFraction * 100).toFixed(3)}% of held-out frequency samples` : '—'}</b></div>{baselineStability && <small>{baselineStability.reason}</small>}{baselineError && <small className="stale-status">{baselineError}</small>}<small>Capture stops early after at least 25 sweeps when the baseline mean converges relative to its measured silence threshold. Otherwise it continues to the selected maximum.</small></fieldset>
      <fieldset><legend>2 · Diagnostic channel</legend><label>RF frequency<select value={safeIndex} onChange={(event) => setDiagnosticIndex(Number(event.target.value))}>{points.map((candidate, index) => <option value={index} key={candidate.frequency}>{formatFrequency(candidate.frequency)}</option>)}</select></label><div className="instrument-status"><span>Selected frequency</span><b>{point ? formatFrequency(point.frequency) : '—'}</b><span>ΔΓ</span><b>{score?.valid ? `${score.deltaGammaRe.toExponential(3)} ${score.deltaGammaIm < 0 ? '−' : '+'} j${Math.abs(score.deltaGammaIm).toExponential(3)}` : '—'}</b><span>Normalized distance</span><b>{score?.valid ? score.distance.toFixed(2) : '—'}</b><span>Sweep response</span><b>{sweepAnalysis?.valid ? `${sweepAnalysis.classification} · ${(sweepAnalysis.affectedFraction * 100).toFixed(1)}% affected` : '—'}</b><span>Affected regions</span><b>{sweepAnalysis?.valid ? sweepAnalysis.bands.length : '—'}</b><span>Resonance shift</span><b>{sweepAnalysis?.valid ? `${sweepAnalysis.resonanceShiftHz >= 0 ? '+' : ''}${formatFrequency(sweepAnalysis.resonanceShiftHz)}` : '—'}</b></div>{baselineWarning && <small className="stale-status">{baselineWarning}</small>}<label>Tone pitch<input type="number" min="80" max="2000" value={toneFrequency} onChange={(event) => setToneFrequency(Number(event.target.value))} /> Hz</label><label>Maximum gain<input type="range" min="0.005" max="0.05" step="0.005" value={maximumGain} onChange={(event) => setMaximumGain(Number(event.target.value))} /></label><div className="instrument-transport"><button onClick={() => void startAudio()} disabled={!baseline || !dataFresh || playing}>Start diagnostic audio</button><button onClick={stopAudio} disabled={!playing}>Stop</button></div><small>Classification describes the measured trace shape only. Persistent broadband changes trigger a fixture and baseline-validity warning.</small></fieldset>
      <fieldset><legend>3 · Record and annotate</legend><div className="experiment-metadata"><label>Specimen ID<input value={specimenId} onChange={(event) => setSpecimenId(event.target.value)} /></label><label>Operator<input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} /></label><label>Probe / object<input value={probeType} onChange={(event) => setProbeType(event.target.value)} /></label><label>Standoff / geometry<input value={probeStandoff} onChange={(event) => setProbeStandoff(event.target.value)} placeholder="e.g. 10 mm" /></label><label>Location / action tag<input value={tag} onChange={(event) => setTag(event.target.value)} /></label><label>Experiment notes<textarea value={experimentNotes} onChange={(event) => setExperimentNotes(event.target.value)} rows={2} /></label></div><div className="instrument-transport"><button onClick={startTraceRecording} disabled={!baseline || recording}>Record trace timeline</button><button onClick={() => { setRecording(false); stopMediaRecording(); }} disabled={!recording && !mediaRecording}>Stop</button><button onClick={runSyncSequence} disabled={!playing && !recording}>Sync countdown</button></div><button className={`wide bundle-download ${baseline && recordedFrameCount && !recording && !mediaRecording ? 'ready' : ''}`} onClick={() => void exportSession()} disabled={!baseline || !recordedFrameCount}>Download complete ZIP bundle</button><div className="instrument-status"><span>Trace recording</span><b>{recording ? `${recordedFrameCount} frames` : 'Stopped'}</b><span>Detected events</span><b>{detectedEvents.length + (activeEventRef.current ? 1 : 0)}</b><span>Media recording</span><b>{mediaRecording ? 'Camera + mixed audio' : 'Stopped'}</b><span>Source</span><b>{sourceName}</b><span>Calibration</span><b>{context.calibration}</b></div>{recordingNote && <small className="stale-status">{recordingNote}</small>}<small>The ZIP contains JSON with every complex trace and raw baseline sweep, frame and event CSV tables, baseline/final S1P files, a manifest, and synchronized media when recorded.</small></fieldset>
    </div>
  </section>;
}
