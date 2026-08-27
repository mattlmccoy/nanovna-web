import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, createStoredZip } from './zip.ts';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('creates a ZIP containing every named entry', () => {
  const zip = createStoredZip([
    { name: 'session.json', data: new TextEncoder().encode('{}') },
    { name: 'media/capture.webm', data: new Uint8Array([1, 2, 3]) },
  ], new Date('2026-08-27T12:00:00'));
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  const decoded = new TextDecoder().decode(zip);
  assert.match(decoded, /session\.json/);
  assert.match(decoded, /media\/capture\.webm/);
});
