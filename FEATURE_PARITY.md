# NanoVNA Saver parity ledger

NanoVNA Saver commit `3445a0a` is the behavioral reference used for this audit. “Parity” means equivalent measurement capability, not identical desktop widgets. NanoVNA Web keeps its browser-only comparison, draggable-marker, interpretation, and metadata features.

NanoVNA Web also includes a separate impedance-sonification instrument mode. It is not an upstream Saver feature and does not count toward parity.

## Acquisition and device control

- Implemented: Web Serial connection, firmware command detection, current-buffer following, strict grid validation, linear and logarithmic segmented sweeps, continuous sweeps, stop between device responses, single/truncated complex averaging, partial-sweep retention, device calibration state and slots, and firmware-advertised bandwidth control for direct-Hz and Dislord command families.
- Remaining: supported-device power/attenuator controls, device screenshots, network serial, broader model-specific command adapters, replay fixtures for each firmware family.

## Calibration

- Implemented: device-managed OPEN/SHORT/LOAD/ISOLATION/THRU workflow and calibration-slot controls when advertised.
- Remaining: NanoVNA Saver’s separate application-side calibration engine, characterized standard coefficients, standard Touchstone files, electrical delay, calibration-file import/export, and physical residual validation.

## Plots and markers

- Implemented: Smith, polar, S11/S21 log and linear magnitude, gain, phase, VSWR, impedance/admittance, real/imaginary, group delay, Q, series C/L, series/shunt S21 fixture models, arbitrary draggable markers, marker colors, delta/reference markers, per-plot live readouts, plot PNG reports, reference sweep, bandpass TDR, strict measured-DC low-pass TDR response modes, frequency bands, VSWR limit lines, and persistent point/line/marker/trace display controls.
- Remaining: permeability/core-parameter plots, signal-analyzer mode, user-defined axis limits, font controls, chart popouts and saved layouts.

## Quantitative analysis

- Implemented: automatically updating overview, VSWR regions, S11 phase-crossing resonance analysis, unsmoothed peak search, and low/high/band-pass/band-stop cutoff analysis.
- Remaining: EFHW comparison history, magnetic-loop auto-zoom workflow, full upstream peak-prominence controls, analysis CSV reports, user-saved analysis presets.

## Files and reporting

- Implemented: strict CSV/S1P/S2P import, S1P export, complex S11/S21 CSV, reference import through the normal file path, multi-file comparison, exact-grid complex deltas, PNG measurement metadata.
- Remaining: dedicated reference-file picker, Touchstone 2.0, calibration-file formats, full workspace/session save and restore.
- Deliberate deviation: NanoVNA Web does not create an S2P file by filling unmeasured S12 and S22 with zero. That would be a syntactically valid file containing fabricated measurements.

## Validation gates

- Protocol parsing and operation serialization must pass transcript tests.
- Processing OFF must preserve device complex values and grid positions.
- Hardware comparison against NanoVNA Saver must be evaluated relative to repeated-sweep instrument noise on the same grid and calibration plane.
- RF formulas use analytical vectors; filter and TDR analyses use synthetic responses with known answers.
- Nonuniform TDR grids, unsupported Touchstone data, incomplete rows, and fabricated two-port data fail explicitly.
