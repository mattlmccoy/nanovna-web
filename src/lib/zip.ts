export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(name: string) {
  const normalized = name.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..')) throw new Error(`Unsafe ZIP entry name: ${name}`);
  return normalized;
}

function dosTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function header(length: number) { return new Uint8Array(length); }
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

/** Creates a standards-compliant, uncompressed ZIP without adding a runtime dependency. */
export function createStoredZip(entries: ZipEntry[], timestamp = new Date()) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const stamp = dosTimestamp(timestamp);
  let localOffset = 0;

  for (const entry of entries) {
    const filename = encoder.encode(safeName(entry.name));
    const checksum = crc32(entry.data);
    const local = header(30);
    const localView = view(local);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, filename.length, true);
    localParts.push(local, filename, entry.data);

    const central = header(46);
    const centralView = view(central);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, filename.length, true);
    centralView.setUint32(42, localOffset, true);
    centralParts.push(central, filename);
    localOffset += local.length + filename.length + entry.data.length;
  }

  const centralDirectory = concat(centralParts);
  const end = header(22);
  const endView = view(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  return concat([...localParts, centralDirectory, end]);
}
