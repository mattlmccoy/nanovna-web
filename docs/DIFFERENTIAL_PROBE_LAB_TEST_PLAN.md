# Differential Probe laboratory test plan

## Purpose

Validate NanoVNA Web Differential Probe as a repeatable sonified VNA perturbation and spatial-sensitivity diagnostic. This plan does not establish quantitative RF leakage. Leakage claims require characterized E- or H-field probes, controlled orientation and standoff, and comparison against an appropriate calibrated measurement.

## Primary questions

1. Does the automatic baseline remain quiet when the setup is unchanged?
2. What is the minimum controlled perturbation that can be detected repeatably?
3. Do repeated perturbations at the same location produce consistent VNA and sonic responses?
4. Can the system distinguish localized response changes from cable or fixture motion?
5. Are VNA traces, events, audio, microphone, and video synchronized and complete?
6. Does audio allow an observer to detect the same events identified in the recorded VNA data?

## Equipment

- NanoVNA and USB data cable.
- Computer running current Chrome or Edge and the deployed NanoVNA Web application.
- Stable DUT or passive RF network mounted so it cannot move unintentionally.
- Appropriate NanoVNA calibration standards and adapters.
- Nonconductive fixture, ruler, or depth stop for repeatable probe standoff.
- Dielectric wand and grounded conductor.
- Known capacitors and inductors suitable for the passive DUT.
- Tape or cable clamps for a controlled cable-motion study.
- Enclosure or representative shield seam if available.
- Camera support with an unobstructed view of the DUT and probe.
- Lab notebook and a randomization list.

Optional later equipment:

- Characterized E- and H-field probes.
- Positioning stage or marked XY grid.
- AprilTag attached to the probe and a fixed, calibrated camera.
- Independent VNA or field measurement for cross-validation.

## Safety and measurement boundaries

- Perform initial tests only on passive, unpowered networks.
- Discharge capacitors and verify the DUT is safe before changing components.
- Do not connect the NanoVNA to a powered RF source without appropriate protection and isolation.
- Fix the calibration plane and do not reconnect adapters after baseline capture unless the trial explicitly studies reconnection.
- Treat hand and object measurements as perturbation-sensitivity tests, not field-strength measurements.

## Folder and naming convention

Create one folder per test date:

`YYYY-MM-DD_differential-probe_validation/`

Use this run identifier in the Specimen ID or notes:

`DP-[date]-[test]-[condition]-R[replicate]`

Example:

`DP-20260827-CAP-10PF-R03`

Preserve every JSON, CSV, S1P, and media file. Do not discard null, failed, or interrupted trials. Record the reason when a trial is invalidated.

## Configuration record

Before the first trial, record:

- NanoVNA model, serial identifier if available, and firmware version;
- sweep start, stop, point count, segment count, and measurement bandwidth;
- averaging and calibration-correction settings;
- calibration method, standards, slot, date/time, and physical reference plane;
- DUT description, cable identity, connector torque method, and fixture;
- probe/object identity, geometry, orientation, and nominal standoff;
- computer, browser version, NanoVNA Web commit/version, camera, and microphone;
- ambient conditions when they may influence the DUT.

Photograph the complete setup before testing.

## Phase 0: functional and synchronization checkout

Run once before collecting scientific data.

1. Calibrate the NanoVNA over the intended sweep range.
2. Connect from Differential Probe and confirm fresh traces update continuously.
3. Enter all experimental metadata.
4. Start an automatic run with camera and microphone enabled.
5. Keep the setup motionless during adaptive baseline acquisition.
6. On the displayed clap cue, clap once in view of the camera.
7. Perform three obvious perturbations, separated by at least five seconds of rest.
8. Stop and finalize the run.
9. Download the synchronized media and paper-ready session bundle.
10. Confirm that the bundle contains JSON, frame CSV, event CSV, baseline S1P, and final S1P.
11. Confirm that the visual clap, microphone transient, generated 880 Hz cue, and `SYNC_MARKER` align.

Checkout gates:

- No incomplete or malformed trace warning.
- Media is playable and contains video, room audio, and diagnostic audio.
- All expected files download and use the same run identifier.
- Sync disagreement is no greater than one recorded VNA sweep interval, plus one video frame.

## Phase 1: stationary baseline and false alarms

Purpose: measure baseline convergence, drift, and false-event behavior without an intentional perturbation.

Conditions:

- Ten independent runs of five minutes each.
- Recapture the baseline for every run.
- Do not touch the table, DUT, cable, or computer during recording.
- Randomly distribute runs across at least two times of day if practical.

Record for each run:

- number of sweeps required for convergence;
- drift-to-threshold ratio;
- held-out validation false-alarm fraction;
- detected event count and duration;
- median and maximum sweep interval;
- suspected dropped-trace gaps;
- broadband baseline-validity warnings.

Provisional engineering targets, to be revised from measured data:

- At least 95% of baselines converge before the selected maximum.
- Fewer than one false event per five-minute stationary run.
- At least 99% of expected sweep intervals are below 2.5 times the run median.
- No persistent broadband warning in at least 90% of stationary runs.

These targets are development gates, not publication results.

## Phase 2: known lumped perturbations

Purpose: establish detection sensitivity and repeatability using known circuit changes.

Select at least four levels plus a zero-change control. Example capacitor levels are 0, 1, 2.2, 4.7, 10, and 22 pF; choose values appropriate for the DUT and frequency range. Repeat separately with inductors if appropriate.

For each component family:

1. Randomize condition order within each block.
2. Collect at least ten replicates per condition.
3. Begin each replicate from the same verified reference state.
4. Capture a new baseline when the reference network is physically reassembled.
5. Record at least five seconds before the change, ten seconds in the changed state, and five seconds after returning to reference.
6. Add a location/action tag before each condition.

Outcomes:

- probability of event detection by perturbation level;
- peak and RMS normalized residual;
- affected-frequency fraction and bands;
- resonance displacement;
- event onset latency and duration;
- return-to-baseline error;
- within-condition and between-run variation.

Estimate the minimum detectable perturbation as the lowest level meeting a prespecified detection probability, such as 90%, while controlling the stationary false-alarm rate.

## Phase 3: controlled spatial-distance sweep

Purpose: test whether response magnitude changes monotonically and repeatably with object or probe position.

Test separately with:

- dielectric wand;
- grounded conductor;
- bare hand, labeled explicitly as an uncharacterized perturbing object;
- characterized E- or H-field probe when available.

Procedure:

1. Mark one fixed XY location near a sensitive network feature.
2. Use a mechanical stop or ruler for standoffs such as 50, 30, 20, 10, 5, and 2 mm.
3. Include a no-object control.
4. Randomize distance order.
5. Collect ten replicates per distance and object type.
6. Hold orientation constant and record it in metadata.
7. Pause at least five seconds at every position.

Outcomes:

- normalized residual versus distance;
- event-detection probability versus distance;
- resonance shift versus distance;
- repeatability at each position;
- ordering consistency across repeated randomized blocks.

Do not interpret the distance curve as field strength unless using a characterized probe and controlled measurement geometry.

## Phase 4: spatial localization consistency

Create a labeled grid over the DUT or enclosure. Start with 3 × 3 or 4 × 4 cells.

1. Choose one repeatable probe and standoff.
2. Randomize grid-cell order rather than scanning in a fixed sequence.
3. Record five replicates per cell.
4. Repeat the full grid after removing and reinstalling the DUT fixture.
5. Repeat on a second day without changing analysis parameters.

Outcomes:

- heat map of peak normalized residual;
- affected band and resonance-shift map;
- rank correlation of cell responses across repetitions and days;
- distance between the peak-response cell in repeated maps;
- within-cell versus between-cell variation.

Localization consistency should be reported in physical distance or grid-cell units, not only as a percentage.

## Phase 5: cable, connector, and fixture controls

Purpose: characterize nuisance responses and test the broadband warning.

Conditions:

- no motion control;
- repeatable cable displacement at one marked point;
- connector touch without intentional rotation;
- controlled connector loosen/tighten cycle, followed by recalibration as required;
- table tap away from the DUT;
- DUT fixture displacement;
- local dielectric or conductor perturbation for comparison.

Collect at least ten randomized replicates per condition.

Evaluate:

- broadband-warning sensitivity and specificity;
- affected-frequency fraction;
- persistence after the action ends;
- similarity among repeated cable-motion traces;
- false classification of genuine localized perturbations as broadband motion.

Until validated, report the warning as “persistent broadband change; check fixture” rather than automatic cable-motion identification.

## Phase 6: shield-seam study

If a representative enclosure is available, test closed, partially open, and open seam states using controlled gap dimensions. Randomize the order and collect at least ten replicates per state.

Measure perturbation sensitivity near the seam using the same object, position, orientation, and standoff. If making leakage claims later, repeat with characterized E- and H-field probes and an independent reference measurement.

## Phase 7: audio-versus-visual detection study

Purpose: determine whether the sonification improves human event detection or interpretation.

Build a replay dataset from prior phases containing balanced event and no-event intervals. Preserve raw traces and predefine the evaluated audio mapping.

Within-subject conditions:

- visual plots only;
- audio only;
- combined audio and visual plots.

For each condition, ask observers to indicate:

- whether an event occurred;
- event onset time;
- localized, multi-region, or broadband response class;
- confidence;
- optional estimated position for spatial trials.

Randomize trial and interface-condition order. Do not let participants see condition labels or ground truth. Record accuracy, sensitivity, specificity, response time, confidence calibration, and localization error. A later powered sample-size calculation should use pilot effect sizes rather than an arbitrary participant count.

## Data-quality review after every run

Before changing the setup:

- verify the run identifier and metadata;
- confirm baseline convergence or record why it reached the maximum;
- check for baseline-validity and dropped-trace warnings;
- verify event tags and condition labels;
- stop and finalize media;
- download all data files;
- open the media file and verify audio/video playback;
- verify JSON and CSV files are nonempty;
- copy the data to the experiment folder and backup location;
- record any deviation from the plan.

## Analysis principles

- Define exclusion rules before inspecting condition outcomes.
- Preserve and report failed baselines, dropped traces, and excluded trials.
- Analyze replicates rather than treating every frequency sample as an independent experiment.
- Report confidence intervals and effect sizes, not only significance tests.
- Evaluate thresholds on held-out runs, not the same data used to tune them.
- Keep the raw complex traces as the authoritative record.
- Compare sonic detection with visual and algorithmic detection using the same underlying time intervals.
- Separate exploratory mapping development from confirmatory validation data.

## Minimum pilot dataset

The first useful pilot should contain:

- ten stationary five-minute runs;
- one lumped-component family with at least five levels and ten replicates per level;
- one object type at six distances plus control with ten replicates per position;
- nine grid locations with five replicates per location;
- cable-motion, fixture-motion, and localized-perturbation controls with ten replicates each;
- synchronized media for every run used in the audio study.

Use the pilot to estimate variance, false-alarm rate, detection effect size, and realistic acquisition time before freezing the confirmatory paper protocol.
