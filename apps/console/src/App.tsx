import { useEffect, useMemo, useState } from 'react';
import {
  activeIncidents,
  nearestAsset,
  planRoutes,
  playbookFor,
  type AmenityCategory,
  type Pt,
  type RouteMode,
  type RoutePlan,
} from '@terranova/core';
import { useRuntime, useRuntimeState } from './app/store';
import { FloorCanvas } from './map/FloorCanvas';
import { GeoMap } from './map/GeoMap';
import { usePosition } from './map/usePosition';
import { LANGS, CATALOGUES, localisedPlaybook, t } from '@terranova/core';
import { PaneBoundary } from './ui/PaneBoundary';
import { IncidentPane } from './panes/IncidentPane';
import { CommsPane } from './panes/CommsPane';
import { RoutingPane } from './panes/RoutingPane';
import { DiagnosticsPane } from './panes/DiagnosticsPane';
import { SearchPane } from './panes/SearchPane';

type Module = 'incidents' | 'comms' | 'routing' | 'search' | 'diagnostics';

export default function App() {
  const rt = useRuntime();
  const s = useRuntimeState();
  const [module, setModule] = useState<Module>('incidents');
  const [levelName, setLevelName] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Pt | null>(null); // operator-set or derived from the position fix
  const [pendingHazard, setPendingHazard] = useState<Pt | null>(null);
  const [clickMode, setClickMode] = useState<'origin' | 'hazard' | 'none'>('none');
  const [mode, setMode] = useState<RouteMode>('occupant');
  const [destination, setDestination] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(0);
  const [view, setView] = useState<'floor' | 'site'>('floor');

  useEffect(() => {
    void rt.boot();
    return () => rt.stop();
  }, [rt]);

  const pack = s.pack?.pack ?? null;
  const levels = pack?.levels ?? [];
  const activeLevel = levels.find((l) => l.name === levelName) ?? levels[0] ?? null;
  const floor = activeLevel && pack ? (pack.floors[activeLevel.name] ?? null) : null;
  const venueSlug = pack?.manifest.venue_slug ?? 'unknown';
  const position = usePosition(pack?.manifest.anchor, activeLevel?.isOutdoor ?? false);
  const fixXY = position.fix.xy;
  const fixConfident = position.fix.confident;
  useEffect(() => {
    setOrigin(
      fixXY && fixConfident
        ? { x: fixXY.x, y: fixXY.y }
        : fixXY
          ? { x: fixXY.x, y: fixXY.y }
          : null,
    );
  }, [fixXY, fixConfident]);

  // Reset per-floor state when the pack or level changes.
  const clearScan = position.clearScan;
  useEffect(() => {
    setOrigin(null);
    setPendingHazard(null);
    clearScan();
  }, [venueSlug, activeLevel?.name, clearScan]);
  useEffect(() => {
    setDestination(null);
  }, [venueSlug]);

  const incidents = useMemo(
    () =>
      [...s.incidents.values()]
        .filter((i) => i.venueSlug === venueSlug)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [s.incidents, venueSlug],
  );
  const live = useMemo(
    () => activeIncidents(s.incidents).filter((i) => i.venueSlug === venueSlug),
    [s.incidents, venueSlug],
  );
  const selected = incidents.find((i) => i.id === selectedId) ?? live[0] ?? null;
  const hazardOnFloor =
    selected &&
    selected.status !== 'resolved' &&
    selected.level === activeLevel?.name &&
    selected.hazardXY
      ? { x: selected.hazardXY[0], y: selected.hazardXY[1] }
      : null;
  const hazard = pendingHazard ?? hazardOnFloor;

  // Playbook drives the default profile when an incident is live on this floor.
  useEffect(() => {
    if (!selected || selected.status === 'resolved') return;
    const auto = playbookFor(selected.type).autoRoute;
    if (auto.kind === 'evacuate') setMode(auto.mode);
  }, [selected?.id, selected?.status, selected?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only a confident fix (or an explicit operator click, which is a fresh manual checkpoint)
  // drives routing; a stale fix is drawn faded and routes start from the floor default.
  const routeOrigin = position.fix.confident ? origin : null;
  const plan: RoutePlan | null = useMemo(
    () =>
      floor
        ? planRoutes({
            floor,
            mode,
            originXY: routeOrigin,
            hazardXY: hazard,
            destinationNodeId: destination,
          })
        : null,
    [floor, mode, routeOrigin, hazard, destination],
  );
  const playbook = selected && selected.status !== 'resolved' ? playbookFor(selected.type) : null;
  const lang = s.language;
  const banner = selected && playbook ? localisedPlaybook(lang, selected.type).banner : null;
  const assetRoute = useMemo(
    () =>
      floor && playbook?.autoRoute.kind === 'asset'
        ? nearestAsset(floor, playbook.autoRoute.asset, routeOrigin, hazard)
        : null,
    [floor, playbook, routeOrigin, hazard],
  );
  const highlight: AmenityCategory[] =
    playbook?.autoRoute.kind === 'asset'
      ? [playbook.autoRoute.asset, 'first_aid']
      : playbook?.autoRoute.kind === 'shelter'
        ? ['refuge', 'assembly']
        : playbook
          ? ['exit']
          : [];

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <strong>TerraNova</strong>
          <span className="muted">SafetyMap console</span>
        </div>
        <div className="status">
          <span
            className={`pill lvl-${s.readiness?.level ?? 'ERROR'}`}
            title={s.readiness?.reasons.join('\n') || 'All Tier-0 components present'}
          >
            {s.readiness ? t(lang, `status.${s.readiness.level.toLowerCase()}`) : 'BOOT'}
          </span>
          <span className={`pill band-${s.connectivity.band}`} title={s.connectivity.reason}>
            {t(lang, `band.${s.connectivity.band}`)}
          </span>
          <span className="pill" title="Writes pending on this device">
            {t(lang, 'outbox.pending', { n: s.pendingCount })}
          </span>
          <select
            aria-label="Language"
            className="lang"
            value={lang}
            onChange={(e) => void rt.setLanguage(e.target.value as (typeof LANGS)[number])}
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {CATALOGUES[l].name}
              </option>
            ))}
          </select>
          {s.swUpdateReady && (
            <button className="small" onClick={() => location.reload()}>
              Update ready — reload
            </button>
          )}
        </div>
      </header>

      {playbook && (
        <div className={`banner sev-${selected?.severity ?? 'high'}`} role="alert">
          <strong>{selected?.title}</strong> — {banner}
        </div>
      )}

      <nav className="rail" aria-label="Console modules">
        {(['incidents', 'comms', 'routing', 'search', 'diagnostics'] as Module[]).map((m) => (
          <button key={m} className={m === module ? 'on' : ''} onClick={() => setModule(m)}>
            {m}
            {m === 'incidents' && live.length > 0 && <span className="badge">{live.length}</span>}
          </button>
        ))}
      </nav>

      <main className="map-area">
        <div className="map-toolbar">
          <span className="venue">
            {pack?.manifest.venue_name ?? (s.booted ? 'No venue pack' : 'Booting…')}
          </span>
          <div className="seg">
            {levels.map((l) => (
              <button
                key={l.id}
                className={l.name === activeLevel?.name ? 'on' : ''}
                onClick={() => setLevelName(l.name)}
              >
                {l.name}
              </button>
            ))}
          </div>
          {pack?.manifest.anchor && (
            <div className="seg" role="tablist" aria-label="Map view">
              <button className={view === 'floor' ? 'on' : ''} onClick={() => setView('floor')}>
                Floor plan
              </button>
              <button className={view === 'site' ? 'on' : ''} onClick={() => setView('site')}>
                Site map
              </button>
            </div>
          )}
          {pack?.manifest.provenance.validation === 'fixture' && (
            <span className="pill warn">{t(lang, 'fixture.badge')}</span>
          )}
        </div>
        <PaneBoundary
          name="SafetyMap"
          recoveryKey={`${venueSlug}:${activeLevel?.name}:${recovery}`}
        >
          {floor && view === 'site' && pack?.manifest.anchor ? (
            <GeoMap
              floor={floor}
              anchor={pack.manifest.anchor}
              basemap={pack.basemap}
              basemapKey={`${venueSlug}@${pack.manifest.version}`}
              origin={origin}
              hazard={hazard}
              primary={plan?.primary ?? assetRoute}
              alternate={plan?.alternate ?? null}
            />
          ) : floor ? (
            <FloorCanvas
              floor={floor}
              origin={origin}
              fix={position.fix}
              hazard={hazard}
              primary={plan?.primary ?? assetRoute}
              alternate={plan?.alternate ?? null}
              highlightAssets={highlight}
              clickMode={clickMode}
              onSetOrigin={(p) => {
                position.setManual(p);
                setClickMode('none');
              }}
              onSetHazard={(p) => {
                setPendingHazard(p);
                setClickMode('none');
              }}
            />
          ) : (
            <div className="map-empty">
              {s.packFailure ? (
                <>
                  <h3>Venue pack rejected</h3>
                  <p className="error">
                    {s.packFailure.stage}: {s.packFailure.message}
                  </p>
                  <p className="muted">
                    A pack that fails integrity or signature checks is never rendered. Install a
                    signed pack from Diagnostics.
                  </p>
                </>
              ) : (
                <p className="muted">
                  {s.booted ? 'Install a venue pack to see the map.' : 'Opening local data…'}
                </p>
              )}
            </div>
          )}
        </PaneBoundary>
        {assetRoute && playbook?.autoRoute.kind === 'asset' && (
          <div className="asset-card">
            Nearest {playbook.autoRoute.asset.replace('_', ' ').toUpperCase()}:{' '}
            <strong>{assetRoute.destination}</strong> · {assetRoute.distanceFt} ft ·{' '}
            {assetRoute.etaSeconds}s
          </div>
        )}
      </main>

      <aside className="side">
        <PaneBoundary name="Pane" recoveryKey={`${module}:${recovery}`}>
          {module === 'incidents' && floor && activeLevel && (
            <IncidentPane
              venueSlug={venueSlug}
              levelName={activeLevel.name}
              floor={floor}
              incidents={incidents}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              pendingHazard={pendingHazard}
              onRequestHazardPlacement={() => setClickMode('hazard')}
              onClearPendingHazard={() => setPendingHazard(null)}
            />
          )}
          {module === 'incidents' && !floor && (
            <div className="pane muted">Incidents need an installed floor.</div>
          )}
          {module === 'comms' && <CommsPane incident={selected} />}
          {module === 'routing' && floor && plan && (
            <RoutingPane
              floor={floor}
              mode={mode}
              onMode={setMode}
              destination={destination}
              onDestination={setDestination}
              origin={origin}
              hazard={hazard}
              plan={plan}
              clickMode={clickMode}
              onClickMode={setClickMode}
              onClearOrigin={() => position.clearScan()}
              position={position}
            />
          )}
          {module === 'search' && (
            <SearchPane
              onFocus={(hit) => {
                if (hit.level) setLevelName(hit.level);
                if (hit.source === 'poi' && hit.nodeId) {
                  setDestination(hit.nodeId);
                  setModule('routing');
                } else if (hit.xy) {
                  setOrigin({ x: hit.xy[0], y: hit.xy[1] });
                }
              }}
            />
          )}
          {module === 'diagnostics' && <DiagnosticsPane lastRoute={plan?.primary ?? null} />}
        </PaneBoundary>
        <button className="ghost tiny" onClick={() => setRecovery((n) => n + 1)}>
          reset panes
        </button>
      </aside>
    </div>
  );
}
