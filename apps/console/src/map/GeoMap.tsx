/**
 * Site map — the georeferenced view. MapLibre renders:
 *   1. a neutral background that always paints (no tiles needed), then
 *   2. the pack's own `basemap.pmtiles` from MEMORY when it ships one (vector or raster), then
 *   3. the floor contract projected to WGS84 through the signed venue anchor: units, compartments,
 *      hazard disc, routes, POIs and the live origin.
 *
 * No public tile host is ever contacted; `npm run gates` fails the build if one appears here.
 */
import { useEffect, useRef } from 'react';
import maplibregl, {
  type StyleSpecification,
  type LayerSpecification,
  type SourceSpecification,
} from 'maplibre-gl';
import { PMTiles, Protocol, TileType, type RangeResponse, type Source } from 'pmtiles';
import type { FeatureCollection } from 'geojson';
import {
  HAZARD_RADIUS_M,
  hazardPolygon,
  lineFeature,
  metersToLngLat,
  projectToWgs84,
  type Floor,
  type Pt,
  type RouteSummary,
  type VenueAnchor,
} from '@terranova/core';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface GeoMapProps {
  floor: Floor;
  anchor: VenueAnchor;
  basemap: Uint8Array | null;
  basemapKey: string;
  origin: Pt | null;
  hazard: Pt | null;
  primary: RouteSummary | null;
  alternate: RouteSummary | null;
  attribution?: string;
}

/** Serves a PMTiles archive held in memory, so `pmtiles://<key>` resolves with the network dead. */
class BytesSource implements Source {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly key: string,
  ) {}
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.bytes.slice(offset, offset + length);
    return {
      data: slice.buffer.slice(
        slice.byteOffset,
        slice.byteOffset + slice.byteLength,
      ) as ArrayBuffer,
    };
  }
}

let protocol: Protocol | null = null;
function ensureProtocol(): Protocol {
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
  }
  return protocol;
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function floorLayers(): LayerSpecification[] {
  return [
    {
      id: 'compartments',
      type: 'line',
      source: 'floor',
      filter: ['==', ['get', 'feature_type'], 'compartment'],
      paint: { 'line-color': '#5eead4', 'line-width': 1.5, 'line-dasharray': [3, 2] },
    },
    {
      id: 'units',
      type: 'fill',
      source: 'floor',
      filter: [
        'all',
        ['==', ['get', 'feature_type'], 'unit'],
        ['!=', ['get', 'category'], 'walkway'],
      ],
      paint: {
        'fill-color': [
          'match',
          ['get', 'category'],
          'refuge',
          '#10302b',
          'restricted',
          '#2a1a1a',
          '#1b2740',
        ],
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'walkway',
      type: 'fill',
      source: 'floor',
      filter: [
        'all',
        ['==', ['get', 'feature_type'], 'unit'],
        ['==', ['get', 'category'], 'walkway'],
      ],
      paint: { 'fill-color': '#0f1a30', 'fill-opacity': 0.9 },
    },
    {
      id: 'unit-outline',
      type: 'line',
      source: 'floor',
      filter: ['==', ['get', 'feature_type'], 'unit'],
      paint: { 'line-color': '#3b4a6b', 'line-width': 0.8 },
    },
    {
      id: 'unit-labels',
      type: 'symbol',
      source: 'floor',
      filter: [
        'all',
        ['==', ['get', 'feature_type'], 'unit'],
        ['!=', ['get', 'category'], 'walkway'],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#b7c3d9' },
    },
    {
      id: 'hazard-fill',
      type: 'fill',
      source: 'hazard',
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.18 },
    },
    {
      id: 'hazard-line',
      type: 'line',
      source: 'hazard',
      paint: { 'line-color': '#ef4444', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
    },
    {
      id: 'route-alt',
      type: 'line',
      source: 'routes',
      filter: ['==', ['get', 'kind'], 'alternate'],
      paint: { 'line-color': '#a78bfa', 'line-width': 2, 'line-dasharray': [2, 2] },
    },
    {
      id: 'route-primary',
      type: 'line',
      source: 'routes',
      filter: ['==', ['get', 'kind'], 'primary'],
      paint: {
        'line-color': ['case', ['get', 'throughHazard'], '#f59e0b', '#38bdf8'],
        'line-width': 4,
      },
    },
    {
      id: 'pois',
      type: 'circle',
      source: 'floor',
      filter: [
        'all',
        ['==', ['get', 'feature_type'], 'amenity'],
        ['!', ['in', ['get', 'category'], ['literal', ['you_are_here', 'incident']]]],
      ],
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'match',
          ['get', 'category'],
          'exit',
          '#16a34a',
          'aed',
          '#dc2626',
          'first_aid',
          '#e11d48',
          'fire_extinguisher',
          '#b91c1c',
          'stairwell',
          '#64748b',
          '#0891b2',
        ],
        'circle-stroke-color': '#0b1220',
        'circle-stroke-width': 1,
      },
    },
    {
      id: 'poi-labels',
      type: 'symbol',
      source: 'floor',
      filter: [
        'all',
        ['==', ['get', 'feature_type'], 'amenity'],
        ['!', ['in', ['get', 'category'], ['literal', ['you_are_here', 'incident']]]],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#e6edf7', 'text-halo-color': '#0b1220', 'text-halo-width': 1 },
    },
    {
      id: 'origin',
      type: 'circle',
      source: 'origin',
      paint: {
        'circle-radius': 7,
        'circle-color': '#5eead4',
        'circle-stroke-color': '#042f2e',
        'circle-stroke-width': 2,
      },
    },
  ];
}

function basemapLayers(sourceId: string, isVector: boolean): LayerSpecification[] {
  if (!isVector)
    return [
      { id: 'bm-raster', type: 'raster', source: sourceId, paint: { 'raster-opacity': 0.6 } },
    ];
  // Conservative vector style over common OpenMapTiles/Protomaps layer names; unknown layers are simply absent.
  return [
    {
      id: 'bm-water',
      type: 'fill',
      source: sourceId,
      'source-layer': 'water',
      paint: { 'fill-color': '#0c2340' },
    },
    {
      id: 'bm-landuse',
      type: 'fill',
      source: sourceId,
      'source-layer': 'landuse',
      paint: { 'fill-color': '#13203a', 'fill-opacity': 0.6 },
    },
    {
      id: 'bm-buildings',
      type: 'fill',
      source: sourceId,
      'source-layer': 'buildings',
      paint: { 'fill-color': '#1a2742', 'fill-opacity': 0.8 },
    },
    {
      id: 'bm-roads',
      type: 'line',
      source: sourceId,
      'source-layer': 'roads',
      paint: { 'line-color': '#2e3f63', 'line-width': 1.5 },
    },
    {
      id: 'bm-transportation',
      type: 'line',
      source: sourceId,
      'source-layer': 'transportation',
      paint: { 'line-color': '#2e3f63', 'line-width': 1.5 },
    },
  ];
}

export function GeoMap(p: GeoMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);

  // Create the map once per anchor/basemap.
  useEffect(() => {
    if (!el.current) return;
    readyRef.current = false;
    let cancelled = false;
    const sources: Record<string, SourceSpecification> = {
      floor: { type: 'geojson', data: EMPTY },
      hazard: { type: 'geojson', data: EMPTY },
      routes: { type: 'geojson', data: EMPTY },
      origin: { type: 'geojson', data: EMPTY },
    };
    const layers: LayerSpecification[] = [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e1628' } },
    ];

    const build = async (): Promise<void> => {
      let attribution = p.attribution ?? 'Floor data: installed venue pack';
      if (p.basemap) {
        try {
          const proto = ensureProtocol();
          const archive = new PMTiles(new BytesSource(p.basemap, p.basemapKey));
          const header = await archive.getHeader();
          proto.add(archive);
          const isVector = header.tileType === TileType.Mvt;
          const meta = (await archive.getMetadata().catch(() => null)) as {
            attribution?: string;
          } | null;
          if (meta?.attribution) attribution = meta.attribution;
          sources.basemap = isVector
            ? { type: 'vector', url: `pmtiles://${p.basemapKey}`, attribution }
            : { type: 'raster', url: `pmtiles://${p.basemapKey}`, tileSize: 256, attribution };
          layers.push(...basemapLayers('basemap', isVector));
        } catch (e) {
          console.warn('[geomap] pack basemap unreadable; continuing without it', e);
        }
      }
      layers.push(...floorLayers());
      if (cancelled || !el.current) return;
      const style: StyleSpecification = {
        version: 8,
        glyphs: 'fonts/{fontstack}/{range}.pbf',
        sources,
        layers,
      };
      const map = new maplibregl.Map({
        container: el.current,
        style,
        center: [p.anchor.lng, p.anchor.lat],
        zoom: 17.5,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.on('load', () => {
        readyRef.current = true;
        push(map);
      });
      // Names on click (no glyph files are shipped, so text layers would silently fetch nothing).
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        maxWidth: '240px',
      });
      for (const layerId of ['pois', 'units']) {
        map.on('click', layerId, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as Record<string, unknown>;
          const label = `${String(props.name ?? props.id ?? '')}${props.category ? ` · ${String(props.category).replace('_', ' ')}` : ''}${props.accessible === false ? ' · not step-free' : ''}`;
          popup.setLngLat(e.lngLat).setText(label).addTo(map);
        });
        map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
      }
      mapRef.current = map;
    };
    void build();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.anchor.lng, p.anchor.lat, p.anchor.rotationDeg, p.basemap, p.basemapKey]);

  const push = (map: maplibregl.Map): void => {
    const setData = (id: string, data: FeatureCollection): void => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      src?.setData(data);
    };
    setData('floor', projectToWgs84(p.floor, p.anchor));
    setData(
      'hazard',
      p.hazard
        ? {
            type: 'FeatureCollection',
            features: [hazardPolygon(p.anchor, p.hazard, HAZARD_RADIUS_M)],
          }
        : EMPTY,
    );
    const routes: FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (p.alternate)
      routes.features.push(lineFeature(p.anchor, p.alternate.points, { kind: 'alternate' }));
    if (p.primary)
      routes.features.push(
        lineFeature(p.anchor, p.primary.points, {
          kind: 'primary',
          throughHazard: p.primary.throughHazard,
        }),
      );
    setData('routes', routes);
    setData(
      'origin',
      p.origin
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: metersToLngLat(p.anchor, p.origin) },
              },
            ],
          }
        : EMPTY,
    );
  };

  // Push data whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) push(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.floor, p.origin, p.hazard, p.primary, p.alternate]);

  return (
    <div ref={el} className="geo-map" role="img" aria-label="Site map" data-testid="geo-map" />
  );
}
