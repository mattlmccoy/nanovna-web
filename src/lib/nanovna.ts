import type { Complex, SweepPoint } from './rf';

interface SerialReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}

interface SerialWriter {
  write(value: Uint8Array): Promise<void>;
  releaseLock(): void;
}

interface SerialPortLike {
  readable: { getReader(): SerialReader } | null;
  writable: { getWriter(): SerialWriter } | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialNavigator extends Navigator {
  serial?: {
    requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPortLike>;
  };
}

function parseComplex(line: string): Complex | null {
  const values = line.trim().split(/\s+/).map(Number);
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return null;
  return { re: values[0], im: values[1] };
}

function versionTuple(version: string): number[] {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function atLeast(version: string, expected: [number, number, number]): boolean {
  const current = versionTuple(version);
  for (let index = 0; index < expected.length; index += 1) {
    if (current[index] > expected[index]) return true;
    if (current[index] < expected[index]) return false;
  }
  return true;
}

export class NanoVNAConnection {
  private port: SerialPortLike | null = null;
  private reader: SerialReader | null = null;
  private writer: SerialWriter | null = null;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  version = 'Unknown firmware';
  supportsScanMask = false;

  static supported(): boolean {
    return Boolean((navigator as SerialNavigator).serial);
  }

  async connect(): Promise<string> {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) throw new Error('Web Serial is unavailable. Use desktop Chrome or Edge.');
    this.port = await serial.requestPort();
    await this.port.open({ baudRate: 115200, bufferSize: 65536 });
    if (!this.port.readable || !this.port.writable) throw new Error('The selected serial port is not readable and writable.');
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    await this.write('\r');
    await this.readUntilPrompt(3000).catch(() => []);
    const versionLines = await this.command('version');
    this.version = versionLines[0] || 'Unknown firmware';
    const help = (await this.command('help')).join(' ').toLowerCase();
    this.supportsScanMask = help.includes('scan') && atLeast(this.version, [0, 7, 1]);
    return this.version;
  }

  async disconnect(): Promise<void> {
    try { await this.reader?.cancel(); } catch { /* port may already be gone */ }
    try { this.reader?.releaseLock(); } catch { /* lock may already be released */ }
    try { this.writer?.releaseLock(); } catch { /* lock may already be released */ }
    this.reader = null;
    this.writer = null;
    try { await this.port?.close(); } catch { /* port may already be closed */ }
    this.port = null;
  }

  async sweep(start: number, stop: number, points: number, segments = 1, onProgress?: (value: number) => void): Promise<SweepPoint[]> {
    const result: SweepPoint[] = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const segmentStart = Math.round(start + (stop - start) * segment / segments);
      const segmentStop = Math.round(start + (stop - start) * (segment + 1) / segments);
      const values = await this.readSegment(segmentStart, segmentStop, points);
      result.push(...(segment === 0 ? values : values.slice(1)));
      onProgress?.((segment + 1) / segments);
    }
    return result;
  }

  private async readSegment(start: number, stop: number, points: number): Promise<SweepPoint[]> {
    if (this.supportsScanMask) {
      const frequencies = (await this.command(`scan ${start} ${stop} ${points} 0b001`, 15000))
        .map(Number).filter(Number.isFinite);
      const rows = await this.command(`scan ${start} ${stop} ${points} 0b110`, 15000);
      const values = rows.map((line) => line.trim().split(/\s+/).map(Number)).filter((row) => row.length >= 4 && row.every(Number.isFinite));
      if (frequencies.length !== values.length) throw new Error(`Device returned ${frequencies.length} frequencies and ${values.length} data rows.`);
      return frequencies.map((frequency, index) => ({
        frequency,
        s11: { re: values[index][0], im: values[index][1] },
        s21: { re: values[index][2], im: values[index][3] },
      }));
    }

    await this.command(`sweep ${start} ${stop} ${points}`, 15000);
    const frequencies = (await this.command('frequencies', 15000)).map(Number).filter(Number.isFinite);
    const s11 = (await this.command('data 0', 15000)).map(parseComplex).filter((value): value is Complex => value !== null);
    const s21 = (await this.command('data 1', 15000)).map(parseComplex).filter((value): value is Complex => value !== null);
    if (frequencies.length !== s11.length || s11.length !== s21.length) throw new Error(`Incomplete sweep: ${frequencies.length} frequencies, ${s11.length} S11 rows, ${s21.length} S21 rows.`);
    return frequencies.map((frequency, index) => ({ frequency, s11: s11[index], s21: s21[index] }));
  }

  private async command(command: string, timeout = 8000): Promise<string[]> {
    if (!this.writer || !this.reader) throw new Error('NanoVNA is not connected.');
    await this.write(`${command}\r`);
    const lines = await this.readUntilPrompt(timeout);
    return lines.filter((line) => line !== command && !line.startsWith('ch>'));
  }

  private async write(value: string): Promise<void> {
    if (!this.writer) throw new Error('Serial writer is unavailable.');
    await this.writer.write(this.encoder.encode(value));
  }

  private async readUntilPrompt(timeout: number): Promise<string[]> {
    if (!this.reader) throw new Error('Serial reader is unavailable.');
    const deadline = Date.now() + timeout;
    let text = '';
    while (!text.includes('ch>')) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('NanoVNA did not respond before the command timed out.');
      const read = this.reader.read();
      const result = await Promise.race([
        read,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('NanoVNA command timed out.')), remaining)),
      ]);
      if (result.done) throw new Error('The serial connection closed unexpectedly.');
      if (result.value) text += this.decoder.decode(result.value, { stream: true });
    }
    return text.replace(/ch>[\s\S]*$/, '').split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
  }
}
