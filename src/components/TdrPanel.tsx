import { useEffect, useMemo, useRef, useState } from 'react';
import { computeBandpassTdr, computeLowpassTdr, type LowpassTdrFormat, type TdrWindow } from '../lib/tdr';
import type { SweepPoint } from '../lib/rf';

function number(value: number, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }

export function TdrPanel({ points, sourceName, onClose }: { points: SweepPoint[]; sourceName: string; onClose: () => void }) {
  const [velocity, setVelocity] = useState(0.66);
  const [tdrWindow, setTdrWindow] = useState<TdrWindow>('hann');
  const [format, setFormat] = useState<'bandpass' | LowpassTdrFormat>('bandpass');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const calculation = useMemo(() => {
    try { return { result: format === 'bandpass' ? computeBandpassTdr(points, velocity, tdrWindow) : computeLowpassTdr(points, velocity, tdrWindow, format), error: '' }; }
    catch (error) { return { result: null, error: (error as Error).message }; }
  }, [format, points, velocity, tdrWindow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const result = calculation.result;
    if (!canvas || !result) return;
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const width = bounds.width;
    const height = bounds.height;
    const pad = { left: 48, right: 14, top: 16, bottom: 28 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const dark = document.documentElement.dataset.theme === 'dark';
    ctx.fillStyle = dark ? '#17181a' : '#fbfbf8'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = dark ? '#42454a' : '#d0d0cb'; ctx.fillStyle = dark ? '#c9cac6' : '#50504c'; ctx.font = '9px Arial';
    const finiteValues = result.bins.map((bin) => bin.magnitude).filter(Number.isFinite);
    const min = Math.min(...finiteValues, 0);
    const max = Math.max(...finiteValues, 1e-12);
    const valueSpan = Math.max(max - min, 1e-12);
    for (let tick = 0; tick <= 5; tick += 1) {
      const x = pad.left + plotWidth * tick / 5;
      const y = pad.top + plotHeight * tick / 5;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotHeight); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotWidth, y); ctx.stroke();
      ctx.fillText(`${number(result.unambiguousRangeMeters * tick / 5, 1)} m`, x - 12, height - 8);
      ctx.fillText(number(max - valueSpan * tick / 5, 2), 3, y + 3);
    }
    ctx.strokeStyle = '#a9008b'; ctx.lineWidth = 1.4; ctx.beginPath();
    result.bins.forEach((bin, index) => {
      const x = pad.left + plotWidth * bin.distanceMeters / Math.max(result.unambiguousRangeMeters, 1e-12);
      const y = pad.top + plotHeight * (max - bin.magnitude) / valueSpan;
      if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    const peak = result.bins[result.peakIndex];
    const peakX = pad.left + plotWidth * peak.distanceMeters / Math.max(result.unambiguousRangeMeters, 1e-12);
    const peakY = pad.top + plotHeight * (max - peak.magnitude) / valueSpan;
    ctx.fillStyle = '#173de3'; ctx.beginPath(); ctx.moveTo(peakX, peakY); ctx.lineTo(peakX - 5, peakY - 9); ctx.lineTo(peakX + 5, peakY - 9); ctx.closePath(); ctx.fill();
  }, [calculation]);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="about-dialog tdr-dialog" role="dialog" aria-modal="true" aria-labelledby="tdr-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="about-titlebar"><h2 id="tdr-title">Time Domain Reflectometry</h2><button onClick={onClose}>Close</button></div>
      <div className="tdr-controls">
        <label>Velocity factor<input type="number" min="0.01" max="1" step="0.01" value={velocity} onChange={(event) => setVelocity(Number(event.target.value))} /></label>
        <label>Window<select value={tdrWindow} onChange={(event) => setTdrWindow(event.target.value as TdrWindow)}><option value="rectangular">Rectangular</option><option value="hann">Hann</option><option value="hamming">Hamming</option><option value="blackman">Blackman</option></select></label>
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as 'bandpass' | LowpassTdrFormat)}><option value="bandpass">Reflection magnitude (bandpass)</option><option value="reflection">Reflection impulse (low-pass)</option><option value="impedance">Impedance step (low-pass)</option><option value="s11-db">S11 step (low-pass)</option><option value="vswr">VSWR step (low-pass)</option></select></label>
      </div>
      {calculation.error ? <div className="tdr-error">{calculation.error}</div> : calculation.result && <>
        <canvas className="tdr-canvas" ref={canvasRef} />
        <div className="tdr-summary"><span>Strongest nonzero-delay impulse bin <b>{number(calculation.result.estimatedLengthMeters)} m</b></span><span>Range resolution <b>{number(calculation.result.rangeResolutionMeters)} m</b></span><span>Distance bin <b>{number(calculation.result.distanceBinMeters)} m</b></span><span>Unambiguous range <b>{number(calculation.result.unambiguousRangeMeters)} m</b></span></div>
      </>}
      <p className="tdr-note">Source: {sourceName}. {format === 'bandpass' ? 'Bandpass mode does not invent DC data.' : 'Low-pass modes require a real acquired sample at 0 Hz and construct the negative-frequency half by conjugate symmetry.'} The highlighted bin is simply the largest nonzero-delay impulse magnitude and is not automatically a cable endpoint. Distance assumes a uniform frequency grid and the selected propagation velocity. Windowing intentionally changes sidelobes and peak width.</p>
    </section>
  </div>;
}
