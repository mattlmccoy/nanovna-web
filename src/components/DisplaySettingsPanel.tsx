export interface FrequencyBand {
  id: number;
  name: string;
  start: number;
  stop: number;
  color: string;
}

export interface DisplaySettings {
  connectPoints: boolean;
  pointSize: number;
  lineWidth: number;
  markerSize: number;
  showMarkerNumbers: boolean;
  filledMarkers: boolean;
  showBands: boolean;
  bands: FrequencyBand[];
  showVswrLines: boolean;
  vswrLines: number[];
  colors: { magenta: string; yellow: string; cyan: string; red: string; green: string; blue: string };
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  connectPoints: true,
  pointSize: 1,
  lineWidth: 1.45,
  markerSize: 8,
  showMarkerNumbers: true,
  filledMarkers: true,
  showBands: false,
  bands: [],
  showVswrLines: false,
  vswrLines: [1.5, 2, 3],
  colors: { magenta: '#a9008b', yellow: '#e2aa00', cyan: '#009d9a', red: '#d7191c', green: '#20aa35', blue: '#173de3' },
};

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function DisplaySettingsPanel({ settings, onChange, onClose }: { settings: DisplaySettings; onChange: (settings: DisplaySettings) => void; onClose: () => void }) {
  const update = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => onChange({ ...settings, [key]: value });
  const updateBand = (id: number, patch: Partial<FrequencyBand>) => update('bands', settings.bands.map((band) => band.id === id ? { ...band, ...patch } : band));
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="about-dialog display-dialog" role="dialog" aria-modal="true" aria-labelledby="display-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="about-titlebar"><h2 id="display-title">Display settings</h2><button onClick={onClose}>Close</button></div>
      <div className="display-settings-grid">
        <fieldset><legend>Traces and markers</legend>
          <label className="check-row"><input type="checkbox" checked={settings.connectPoints} onChange={(event) => update('connectPoints', event.target.checked)} /> Connect acquired points</label>
          <div className="form-grid"><label>Point size</label><input type="number" min="0" max="8" step="0.5" value={settings.pointSize} onChange={(event) => update('pointSize', Math.max(0, numberValue(event.target.value, 1)))} /><label>Line thickness</label><input type="number" min="0.5" max="6" step="0.25" value={settings.lineWidth} onChange={(event) => update('lineWidth', Math.max(.5, numberValue(event.target.value, 1.45)))} /><label>Marker size</label><input type="number" min="4" max="20" value={settings.markerSize} onChange={(event) => update('markerSize', Math.max(4, numberValue(event.target.value, 8)))} /></div>
          <label className="check-row"><input type="checkbox" checked={settings.showMarkerNumbers} onChange={(event) => update('showMarkerNumbers', event.target.checked)} /> Show marker numbers</label>
          <label className="check-row"><input type="checkbox" checked={settings.filledMarkers} onChange={(event) => update('filledMarkers', event.target.checked)} /> Filled markers</label>
        </fieldset>
        <fieldset><legend>Trace colors</legend>
          <div className="color-settings">{Object.entries(settings.colors).map(([name, color]) => <label key={name}><span>{name === 'magenta' ? 'S11' : name === 'yellow' ? 'S21' : name}</span><input type="color" value={color} onChange={(event) => update('colors', { ...settings.colors, [name]: event.target.value })} /></label>)}</div>
        </fieldset>
        <fieldset className="bands-settings"><legend>Frequency bands</legend>
          <label className="check-row"><input type="checkbox" checked={settings.showBands} onChange={(event) => update('showBands', event.target.checked)} /> Show bands on frequency plots</label>
          {settings.bands.map((band) => <div className="band-row" key={band.id}><input aria-label="Band name" value={band.name} onChange={(event) => updateBand(band.id, { name: event.target.value })} /><input aria-label="Band start in hertz" type="number" value={band.start} onChange={(event) => updateBand(band.id, { start: numberValue(event.target.value, band.start) })} /><input aria-label="Band stop in hertz" type="number" value={band.stop} onChange={(event) => updateBand(band.id, { stop: numberValue(event.target.value, band.stop) })} /><input aria-label="Band color" type="color" value={band.color} onChange={(event) => updateBand(band.id, { color: event.target.value })} /><button onClick={() => update('bands', settings.bands.filter((candidate) => candidate.id !== band.id))}>Remove</button></div>)}
          <button onClick={() => update('bands', [...settings.bands, { id: Date.now(), name: `Band ${settings.bands.length + 1}`, start: 1e6, stop: 2e6, color: '#f1d51c' }])}>Add band</button>
          <small>Band start and stop values are in hertz.</small>
        </fieldset>
        <fieldset><legend>VSWR limit lines</legend>
          <label className="check-row"><input type="checkbox" checked={settings.showVswrLines} onChange={(event) => update('showVswrLines', event.target.checked)} /> Show limits on VSWR plots</label>
          <label>Limits<input value={settings.vswrLines.join(', ')} onChange={(event) => update('vswrLines', event.target.value.split(',').map(Number).filter((value) => Number.isFinite(value) && value > 1))} /></label>
          <small>Comma-separated ratios, for example 1.5, 2, 3.</small>
        </fieldset>
      </div>
      <div className="display-settings-footer"><button onClick={() => onChange(DEFAULT_DISPLAY_SETTINGS)}>Reset defaults</button><button onClick={onClose}>Done</button></div>
    </section>
  </div>;
}
