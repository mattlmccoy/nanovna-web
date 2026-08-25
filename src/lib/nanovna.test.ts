import assert from 'node:assert/strict';
import test from 'node:test';
import { atLeastVersion, parseShellCommands, segmentRanges, validateCalibrationSlot } from './nanovna.ts';

test('firmware comparison is lexicographic, not component-wise', () => {
  assert.equal(atLeastVersion('0.7.1', [0, 7, 1]), true);
  assert.equal(atLeastVersion('0.8.0', [0, 7, 1]), true);
  assert.equal(atLeastVersion('1.0.0', [0, 7, 1]), true);
  assert.equal(atLeastVersion('0.6.99', [0, 7, 1]), false);
  assert.equal(atLeastVersion('0.7.0', [0, 7, 1]), false);
});

test('firmware comparison tolerates labels around semantic versions', () => {
  assert.equal(atLeastVersion('NanoVNA-H firmware version 0.7.2', [0, 7, 1]), true);
  assert.equal(atLeastVersion('unknown', [0, 7, 1]), false);
});

test('segmented sweep matches NanoVNA Saver point and step semantics', () => {
  const ranges = segmentRanges(1e6, 51e6, 101, 10);
  assert.equal(ranges.length * 101, 1010);
  assert.deepEqual(ranges[0], { start: 1e6, stop: 5955400 });
  assert.deepEqual(ranges[1], { start: 6004954, stop: 10960354 });
  assert.equal(ranges[1].start - ranges[0].stop, 49554);
});

test('shell capability parsing uses complete command tokens', () => {
  const commands = parseShellCommands(['Commands: scan cal save recall pause resume bandwidth']);
  assert.equal(commands.has('scan'), true);
  assert.equal(commands.has('cal'), true);
  assert.equal(commands.has('calibration'), false);
  assert.equal(commands.has('save'), true);
});

test('calibration slots stay within the five-slot common firmware range', () => {
  assert.equal(validateCalibrationSlot(0), 0);
  assert.equal(validateCalibrationSlot(4), 4);
  assert.throws(() => validateCalibrationSlot(5), /0 through 4/);
  assert.throws(() => validateCalibrationSlot(1.5), /integer/);
});
