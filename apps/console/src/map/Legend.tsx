export interface MapLayers {
  pois: boolean;
  doors: boolean;
  labels: boolean;
  alternate: boolean;
  compartments: boolean;
}
export const DEFAULT_LAYERS: MapLayers = {
  pois: true,
  doors: true,
  labels: true,
  alternate: true,
  compartments: true,
};

const LEGEND: Array<{ cls: string; glyph: string; label: string }> = [
  { cls: 'poi-exit', glyph: 'EXIT', label: 'Exit (amber ring = not step-free)' },
  { cls: 'poi-stair', glyph: 'ST', label: 'Stairwell' },
  { cls: 'poi-aed', glyph: 'AED', label: 'Defibrillator' },
  { cls: 'poi-firstaid', glyph: '+', label: 'First aid' },
  { cls: 'poi-ext', glyph: 'FX', label: 'Fire extinguisher' },
  { cls: 'poi-assembly', glyph: 'AP', label: 'Assembly point / area of refuge' },
  { cls: 'poi-checkpoint', glyph: 'QR', label: 'Surveyed positioning checkpoint' },
];

export function Legend({
  layers,
  onLayers,
  onClose,
}: {
  layers: MapLayers;
  onLayers: (l: MapLayers) => void;
  onClose: () => void;
}) {
  const toggle = (k: keyof MapLayers): void => onLayers({ ...layers, [k]: !layers[k] });
  return (
    <div className="legend" role="dialog" aria-label="Map legend and layers">
      <div className="legend-head">
        <strong>Legend</strong>
        <button className="ghost small" onClick={onClose} aria-label="Close legend">
          ✕
        </button>
      </div>
      <ul className="legend-list">
        {LEGEND.map((l) => (
          <li key={l.cls}>
            <svg width="26" height="16" viewBox="0 0 26 16" className={`poi ${l.cls}`} aria-hidden>
              <rect x="1" y="2" width="24" height="12" rx="3" />
              <text x="13" y="11.5" textAnchor="middle" style={{ fontSize: 8 }}>
                {l.glyph}
              </text>
            </svg>
            <span>{l.label}</span>
          </li>
        ))}
        <li>
          <svg width="26" height="16" aria-hidden>
            <line
              x1="1"
              y1="8"
              x2="25"
              y2="8"
              className="route route-primary"
              style={{ strokeWidth: 3 }}
            />
          </svg>
          <span>Primary route (amber dashed = passes hazard)</span>
        </li>
        <li>
          <svg width="26" height="16" aria-hidden>
            <line
              x1="1"
              y1="8"
              x2="25"
              y2="8"
              className="route route-alt"
              style={{ strokeWidth: 2 }}
            />
          </svg>
          <span>Alternate route</span>
        </li>
        <li>
          <svg width="26" height="16" aria-hidden>
            <circle cx="13" cy="8" r="7" className="hazard-zone" />
          </svg>
          <span>Hazard zone (16 m)</span>
        </li>
        <li>
          <svg width="26" height="16" aria-hidden>
            <circle cx="13" cy="8" r="5" className="yah-dot" />
          </svg>
          <span>You are here (grey = stale fix)</span>
        </li>
      </ul>
      <div className="legend-head">
        <strong>Layers</strong>
      </div>
      <ul className="legend-toggles">
        {(
          [
            ['pois', 'Safety assets'],
            ['doors', 'Doors'],
            ['labels', 'Room labels'],
            ['alternate', 'Alternate route'],
            ['compartments', 'Smoke compartments'],
          ] as Array<[keyof MapLayers, string]>
        ).map(([k, label]) => (
          <li key={k}>
            <label className="row">
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {label}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
