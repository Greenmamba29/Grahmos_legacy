/**
 * SafetyMap floor canvas — renders the floor contract in venue metre-space as SVG.
 *
 * Zero network, zero tiles: the geometry comes from the verified pack and nothing else, so the
 * map is exactly as available as the pack is. Pan with drag, zoom with wheel/buttons, click to set
 * the live origin ("you are here").
 */
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent,
} from 'react';
import type { MapLayers } from './Legend';
import { DEFAULT_LAYERS } from './Legend';
import {
  floorBounds,
  floorDoors,
  floorPois,
  floorUnits,
  compartmentsOf,
  RENDERABLE_AMENITIES,
  HAZARD_RADIUS_M,
  type Floor,
  type Pt,
  type RouteSummary,
  type AmenityCategory,
} from '@terranova/core';

export interface FloorCanvasProps {
  floor: Floor;
  origin: Pt | null;
  /** Position provenance for the dot: accuracy ring + confidence styling. */
  fix?: { accuracyM: number; confident: boolean; source: string } | undefined;
  hazard: Pt | null;
  primary: RouteSummary | null;
  alternate: RouteSummary | null;
  highlightAssets?: AmenityCategory[];
  onSetOrigin?: (p: Pt) => void;
  onSetHazard?: (p: Pt) => void;
  /** 'origin' sets you-are-here on click; 'hazard' places the incident. */
  clickMode: 'origin' | 'hazard' | 'none';
  layers?: MapLayers | undefined;
}

const POI_GLYPH: Record<AmenityCategory, { glyph: string; cls: string; label: string }> = {
  exit: { glyph: 'EXIT', cls: 'poi-exit', label: 'Exit' },
  stairwell: { glyph: 'ST', cls: 'poi-stair', label: 'Stairwell' },
  aed: { glyph: 'AED', cls: 'poi-aed', label: 'AED' },
  first_aid: { glyph: '+', cls: 'poi-firstaid', label: 'First aid' },
  fire_extinguisher: { glyph: 'FX', cls: 'poi-ext', label: 'Extinguisher' },
  assembly: { glyph: 'AP', cls: 'poi-assembly', label: 'Assembly point' },
  refuge: { glyph: 'R', cls: 'poi-refuge', label: 'Area of refuge' },
  checkpoint: { glyph: 'QR', cls: 'poi-checkpoint', label: 'Checkpoint' },
  you_are_here: { glyph: '', cls: '', label: 'You are here' },
  incident: { glyph: '', cls: '', label: 'Incident' },
};

export function FloorCanvas(props: FloorCanvasProps) {
  const { floor, origin, hazard, primary, alternate, clickMode, highlightAssets = [] } = props;
  const layers = props.layers ?? DEFAULT_LAYERS;
  const svgRef = useRef<SVGSVGElement>(null);
  const bounds = useMemo(() => floorBounds(floor), [floor]);
  const units = useMemo(() => floorUnits(floor), [floor]);
  const pois = useMemo(
    () => floorPois(floor, new Set([...RENDERABLE_AMENITIES, 'checkpoint'])),
    [floor],
  );
  const doors = useMemo(() => floorDoors(floor), [floor]);
  const comps = useMemo(() => compartmentsOf(floor), [floor]);

  const pad = 12;
  const base = {
    x: bounds.minX - pad,
    y: -(bounds.maxY + pad),
    w: bounds.maxX - bounds.minX + pad * 2,
    h: bounds.maxY - bounds.minY + pad * 2,
  };
  const [view, setView] = useState({ zoom: 1, dx: 0, dy: 0 });
  const vb = {
    x: base.x + base.w / 2 - base.w / 2 / view.zoom + view.dx,
    y: base.y + base.h / 2 - base.h / 2 / view.zoom + view.dy,
    w: base.w / view.zoom,
    h: base.h / view.zoom,
  };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Metre-space y grows north; SVG y grows down. Render with y negated.
  const P = (p: Pt | [number, number]): string => {
    const x = Array.isArray(p) ? p[0] : p.x;
    const y = Array.isArray(p) ? p[1] : p.y;
    return `${x},${-y}`;
  };
  const toMeters = (e: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = vb.x + ((e.clientX - r.left) / r.width) * vb.w;
    const y = vb.y + ((e.clientY - r.top) / r.height) * vb.h;
    return { x: Math.round(x * 10) / 10, y: Math.round(-y * 10) / 10 };
  };
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>): void => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const ddx = ((e.clientX - d.x) / r.width) * vb.w;
    const ddy = ((e.clientY - d.y) / r.height) * vb.h;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (d.moved) {
      setView((v) => ({ ...v, dx: v.dx - ddx, dy: v.dy - ddy }));
      d.x = e.clientX;
      d.y = e.clientY;
    }
  };
  const onPointerUp = (e: RPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || clickMode === 'none') return;
    const m = toMeters(e);
    if (!m) return;
    if (clickMode === 'origin') props.onSetOrigin?.(m);
    else props.onSetHazard?.(m);
  };
  const onWheel = (e: RWheelEvent<SVGSVGElement>): void => {
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, zoom: Math.min(8, Math.max(0.5, v.zoom * factor)) }));
  };

  const poly = (pts: Pt[]): string => pts.map(P).join(' ');
  const highlighted = new Set(highlightAssets);

  return (
    <div className="floor-canvas-wrap">
      <svg
        ref={svgRef}
        className={`floor-canvas click-${clickMode}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="SafetyMap floor plan"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (drag.current = null)}
        onWheel={onWheel}
      >
        <rect
          x={vb.x - 1000}
          y={vb.y - 1000}
          width={vb.w + 2000}
          height={vb.h + 2000}
          className="floor-bg"
        />
        {layers.compartments &&
          comps.map((c) => (
            <g key={`c-${c.id}`}>
              <polygon points={c.ring.map(P).join(' ')} className="compartment" />
              <text x={c.ring[0]![0] + 2} y={-c.ring[2]![1] + 5} className="compartment-label">
                {c.name}
              </text>
            </g>
          ))}
        {units.map((u) => (
          <g key={`u-${u.id}-${u.name}`}>
            <polygon points={u.ring.map(P).join(' ')} className={`unit unit-${u.category}`} />
            {layers.labels && u.category !== 'walkway' && (
              <text x={u.centroid[0]} y={-u.centroid[1]} className="unit-label" textAnchor="middle">
                {u.name}
              </text>
            )}
          </g>
        ))}
        {layers.doors &&
          doors.map((d) => (
            <circle key={`d-${d.id}`} cx={d.xy[0]} cy={-d.xy[1]} r={1.1} className="door" />
          ))}
        {hazard && (
          <g>
            <circle cx={hazard.x} cy={-hazard.y} r={HAZARD_RADIUS_M} className="hazard-zone" />
            <circle cx={hazard.x} cy={-hazard.y} r={2.2} className="hazard-core" />
            <text
              x={hazard.x}
              y={-hazard.y - HAZARD_RADIUS_M - 1.5}
              textAnchor="middle"
              className="hazard-label"
            >
              HAZARD
            </text>
          </g>
        )}
        {layers.alternate && alternate && (
          <polyline points={poly(alternate.points)} className="route route-alt" />
        )}
        {primary && (
          <polyline
            points={poly(primary.points)}
            className={`route route-primary${primary.throughHazard ? ' route-through-hazard' : ''}`}
          />
        )}
        {layers.pois &&
          pois.map((p) => {
            const g = POI_GLYPH[p.category];
            const hot = highlighted.has(p.category);
            return (
              <g
                key={`p-${p.category}-${p.id}`}
                className={`poi ${g.cls}${hot ? ' poi-hot' : ''}${p.accessible ? '' : ' poi-inaccessible'}`}
              >
                <title>{`${g.label}: ${p.name}${p.accessible ? '' : ' (not step-free)'}`}</title>
                <rect x={p.xy[0] - 3.2} y={-p.xy[1] - 2} width={6.4} height={4} rx={0.8} />
                <text x={p.xy[0]} y={-p.xy[1] + 1.3} textAnchor="middle">
                  {g.glyph}
                </text>
              </g>
            );
          })}
        {origin && (
          <g className={`you-are-here${props.fix && !props.fix.confident ? ' yah-stale' : ''}`}>
            {props.fix && Number.isFinite(props.fix.accuracyM) && props.fix.accuracyM > 0 && (
              <circle
                cx={origin.x}
                cy={-origin.y}
                r={props.fix.accuracyM}
                className="yah-accuracy"
              />
            )}
            <circle cx={origin.x} cy={-origin.y} r={3} className="yah-pulse" />
            <circle cx={origin.x} cy={-origin.y} r={1.6} className="yah-dot" />
          </g>
        )}
      </svg>
      <div className="floor-controls">
        <button
          onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.25) }))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.5, v.zoom / 1.25) }))}
          aria-label="Zoom out"
        >
          −
        </button>
        <button onClick={() => setView({ zoom: 1, dx: 0, dy: 0 })} aria-label="Reset view">
          ⟲
        </button>
      </div>
    </div>
  );
}
