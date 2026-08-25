# NanoVNA Web

Browser interface for NanoVNA devices.

## Current functionality

- Direct USB serial connection at 115200 baud in desktop Chrome and Edge
- Firmware capability detection and device-reported calibration-state readout when supported
- NanoVNA shell support for `version`, `help`, `sweep`, `scan`, `frequencies`, `data 0`, and `data 1`
- Multi-segment S11/S21 sweeps
- Single and continuous sweep modes with live plot updates after every completed segment, partial-sweep labeling, and segment-boundary stop handling
- Guided device-managed OPEN/SHORT/LOAD and ISOLATION/THRU calibration, correction enable/disable, and common calibration-slot 0–4 save/recall when advertised by firmware
- Raw device samples with no smoothing, curve fitting, or hidden resampling
- Addable/removable markers with selectable colors, real-time plot dragging, and frequency, impedance, admittance, S11, reflected-power, S21, phase, and VSWR readouts
- Plot-local live marker strips with diagnostic-specific quantities and units
- Deterministic suggested-view guidance derived from the loaded samples with an explicit target-pane selector
- Beginner measurement guide and contextual interpretation notes for every diagnostic view
- Capturable reference sweep overlaid as a dashed trace
- Four configurable diagnostic panes
- Persistent light/dark mode with system preference detection
- Smith, polar, log magnitude, phase, VSWR, impedance, admittance, S-parameter component, group-delay, Q, capacitance, inductance, and S21 series/shunt views
- Per-plot PNG reports with source, sweep, device/calibration, reference, and plot-specific marker metadata; raw S11/S21 CSV export; and S11 Touchstone `.s1p` export
- File loading for NanoVNA Web CSV and 50 Ω Touchstone 1.x `.s1p`/`.s2p` in RI, magnitude-angle, or dB-angle format
- Multi-file comparison workspace with raw-grid overlays, draggable multi-file markers, per-file colors and visibility, common-span reporting, analysis table, pointwise raw-complex validation, and PNG export

## Run locally

```bash
npm install
npm run dev
```

Use desktop Chrome or Edge. Web Serial is not available in Safari or Firefox.

## Verify

```bash
npm test
npm run build
```

## Data handling

Plots connect the samples returned by the NanoVNA with straight line segments. Pointwise views use the complex S-parameters without browser-side smoothing. Group delay uses a centered finite difference over adjacent phase samples after phase unwrapping. Segmented sweeps use NanoVNA Saver's nonoverlapping `points × segments` frequency-grid convention. "Unsmoothed" does not describe the instrument's internal filtering or calibration state.

S21-derived series and shunt impedance views assume an ideal series or shunt fixture topology. They are model-based interpretations, not direct impedance measurements.

## Hardware validation

Behavior must still be checked against the target device and firmware. Unit tests verify browser-side protocol selection, sweep segmentation, parsers, RF calculations, and validation arithmetic; they cannot prove that a physical device accepts every advertised command or returns correct measurements.

For the hardware gate, capture the same DUT with identical settings in NanoVNA Web and NanoVNA Saver. Add the current web sweep to the comparison workspace, then import the Saver Touchstone file. The pointwise validation section calculates raw complex deltas only when the frequency arrays match exactly and deliberately does not invent a pass/fail tolerance.

The guided workflow controls calibration stored and applied by compatible NanoVNA firmware. NanoVNA Saver also supports a separate application-side calibration model with characterized non-ideal standards; that model has not been reproduced here.

## Acknowledgment

The device protocol, sweep behavior, and feature set were studied against the original [NanoVNA Saver](https://github.com/NanoVNA-Saver/nanovna-saver) project created by Rune B. Broberg and maintained by its open-source contributors. NanoVNA Saver is distributed under [GPL-3.0-or-later](https://github.com/NanoVNA-Saver/nanovna-saver/blob/master/licenses/LICENSE.txt).

NanoVNA Web is a separate TypeScript/browser implementation. It does not include NanoVNA Saver source files. Its protocol behavior and feature design were informed by NanoVNA Saver. See [NOTICE.md](NOTICE.md).
