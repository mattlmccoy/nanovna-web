# Differential Probe data record

Differential Probe exports retain raw complex VNA measurements so detection and sonification can be recalculated without repeating the experiment. Derived classifications are measurements of trace behavior, not claims about a physical defect or RF leakage.

## Session bundle

One download action produces:

- `nanovna-differential-probe-*.json`: complete session, including raw baseline sweeps, the fitted complex baseline model, every recorded trace, event records, acquisition-quality statistics, instrument context, experimental metadata, and audio mappings.
- `nanovna-differential-probe-*.csv`: one row per recorded sweep with the selected-channel residual and whole-sweep features.
- `nanovna-differential-events-*.csv`: one row per automatically segmented event.
- `nanovna-differential-baseline-*.s1p`: complex S11 mean of the measured baseline in Touchstone RI format at 50 ohms.
- `nanovna-differential-final-*.s1p`: final recorded complex S11 trace in Touchstone RI format at 50 ohms.
- A separate WebM or MP4 media file when camera and microphone recording is enabled.

The JSON file is authoritative. CSV and Touchstone files are convenient analysis views derived from the same session.

## Reproducibility fields

Record at least:

- specimen identifier;
- operator;
- perturbing object or characterized probe;
- standoff distance and geometry;
- named location or grid coordinate;
- calibration plane and calibration state;
- sweep range, point count, measurement bandwidth, averaging, and firmware/device identity;
- controlled action and relevant environmental notes.

The synchronized `SYNC_MARKER` exists in the VNA timeline, generated audio, microphone recording, and video. A visible and audible clap provides an independent alignment transient.

## Primary quantitative outcomes

The current implementation records quantities suitable for evaluating:

- baseline convergence and drift-to-threshold ratio;
- held-out baseline false-alarm fraction;
- normalized complex residual distance;
- affected-frequency fraction and contiguous affected bands;
- peak and RMS normalized distance;
- resonance displacement based on the raw sampled S11 minimum;
- event duration, peak response, and repeatability;
- sweep interval, maximum gap, and suspected dropped-trace gaps.

No smoothing or frequency resampling is used by these Differential Probe feature calculations.

## Suggested validation dataset

Use repeated randomized trials containing baseline-only controls and known perturbations. Suitable initial factors include added capacitance or inductance, cable displacement, probe distance, shield-seam state, probe identity, position, and orientation. Preserve unsuccessful and null trials. These are necessary for estimating false-alarm rate, minimum detectable perturbation, repeatability, localization consistency, and agreement between visual and sonic detection.
