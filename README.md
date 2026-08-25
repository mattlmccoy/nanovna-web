# NanoVNA Web

Browser interface for NanoVNA devices.

## Current functionality

- Direct USB serial connection at 115200 baud in desktop Chrome and Edge
- Firmware and device-reported calibration-state readout when supported
- NanoVNA shell support for `version`, `help`, `sweep`, `scan`, `frequencies`, `data 0`, and `data 1`
- Multi-segment S11/S21 sweeps
- Single and continuous sweep modes with segment-boundary stop handling
- Raw device samples with no smoothing, curve fitting, or hidden resampling
- Three movable markers with frequency, impedance, admittance, S11, S21, phase, and VSWR readouts
- Capturable reference sweep overlaid as a dashed trace
- Four configurable diagnostic panes
- Smith, polar, log magnitude, phase, VSWR, impedance, admittance, S-parameter component, group-delay, Q, capacitance, inductance, and S21 series/shunt views
- Per-plot PNG export, raw S11/S21 CSV export, and S11 Touchstone `.s1p` export
- File loading for NanoVNA Web CSV and Touchstone `.s1p`/`.s2p` in RI, magnitude-angle, or dB-angle format

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

Behavior must be checked against the target device and firmware. Compare a calibrated device and identical sweep settings against NanoVNA Saver, including the frequency and complex S11/S21 arrays point by point.

## Acknowledgment

The device protocol and feature set were studied against [NanoVNA Saver](https://github.com/NanoVNA-Saver/nanovna-saver). This project does not bundle its Python or Qt code.
