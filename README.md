# NanoVNA Web

Browser interface for NanoVNA devices.

## Current functionality

- Direct USB serial connection at 115200 baud in desktop Chrome and Edge
- NanoVNA shell support for `version`, `help`, `sweep`, `scan`, `frequencies`, `data 0`, and `data 1`
- Multi-segment S11/S21 sweeps
- Raw device samples with no smoothing, curve fitting, or hidden resampling
- Three movable markers with frequency, impedance, admittance, S11, S21, phase, and VSWR readouts
- Four configurable diagnostic panes
- Smith, polar, log magnitude, phase, VSWR, impedance, admittance, S-parameter component, group-delay, Q, capacitance, inductance, and S21 series/shunt views
- Per-plot PNG export, raw CSV export, S11 Touchstone `.s1p`, and labeled partial `.s2p` export

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

Plots connect the samples returned by the NanoVNA with straight line segments. Pointwise views use the raw complex S-parameters. Group delay uses a centered finite difference over adjacent raw phase samples after phase unwrapping. Multi-segment sweeps remove the duplicate shared endpoint between adjacent segments.

## Hardware validation

Behavior must be checked against the target device and firmware. Compare a calibrated device and identical sweep settings against NanoVNA Saver, including the frequency and complex S11/S21 arrays point by point.

## Acknowledgment

The device protocol and feature set were studied against [NanoVNA Saver](https://github.com/NanoVNA-Saver/nanovna-saver). This project does not bundle its Python or Qt code.
