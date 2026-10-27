/**
 * Offline readiness contract.
 *
 * A device is OFFLINE_READY only when every required Tier-0 asset is present. The UI must expose
 * READY / DEGRADED / ERROR with specific reasons and must never replace a missing capability with
 * mock data. Tier 0 must not depend on a cloud, a public tile host, external AI, or an edge node.
 */
export type ReadinessLevel = 'READY' | 'DEGRADED' | 'ERROR';

export type ComponentState = 'ok' | 'degraded' | 'missing' | 'error' | 'unknown';

export const READINESS_COMPONENTS = [
  'app_shell_cached',
  'local_db_open',
  'venue_pack_installed',
  'venue_pack_verified',
  'floor_geometry_available',
  'routing_engine_ready',
  'outbox_available',
  'evidence_exporter_available',
  'storage_persisted',
] as const;
export type ReadinessComponent = (typeof READINESS_COMPONENTS)[number];

/** Components whose failure makes the device ERROR rather than DEGRADED. */
export const CRITICAL_COMPONENTS: ReadonlySet<ReadinessComponent> = new Set<ReadinessComponent>([
  'app_shell_cached',
  'local_db_open',
  'venue_pack_installed',
  'venue_pack_verified',
  'floor_geometry_available',
  'routing_engine_ready',
]);

export interface ComponentReport {
  component: ReadinessComponent;
  state: ComponentState;
  /** Human reason; required whenever state is not ok. */
  reason?: string;
  checkedAt: string;
}

export interface ReadinessReport {
  level: ReadinessLevel;
  components: ComponentReport[];
  /** Reasons for every non-ok component, critical first. */
  reasons: string[];
  evaluatedAt: string;
}

export function evaluateReadiness(
  components: ComponentReport[],
  now: Date = new Date(),
): ReadinessReport {
  const byName = new Map(components.map((c) => [c.component, c]));
  const reports: ComponentReport[] = READINESS_COMPONENTS.map(
    (name) =>
      byName.get(name) ?? {
        component: name,
        state: 'unknown',
        reason: 'not reported',
        checkedAt: now.toISOString(),
      },
  );
  let level: ReadinessLevel = 'READY';
  const critical: string[] = [];
  const soft: string[] = [];
  for (const c of reports) {
    if (c.state === 'ok') continue;
    const line = `${c.component}: ${c.state}${c.reason ? ` — ${c.reason}` : ''}`;
    if (CRITICAL_COMPONENTS.has(c.component) && (c.state === 'missing' || c.state === 'error')) {
      level = 'ERROR';
      critical.push(line);
    } else {
      if (level === 'READY') level = 'DEGRADED';
      soft.push(line);
    }
  }
  return {
    level,
    components: reports,
    reasons: [...critical, ...soft],
    evaluatedAt: now.toISOString(),
  };
}
