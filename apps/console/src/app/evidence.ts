import {
  verifyChain,
  verifyCheckpoint,
  type Checkpoint,
  type ReadinessReport,
  type ConnectivityState,
  type Sealed,
  type IncidentEvent,
  type OutboxEnvelope,
  type RouteSummary,
} from '@terranova/core';
import type { InstalledPack } from '../data/packs';

export const RELEASE = {
  app: 'terranova-console',
  version: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
  commit: import.meta.env.VITE_GIT_SHA ?? 'dev',
  builtAt: import.meta.env.VITE_BUILD_TIME ?? 'dev',
  mode: import.meta.env.MODE,
} as const;

export interface EvidencePackage {
  schema: 'terranova.evidence.v1';
  exportedAt: string;
  release: typeof RELEASE;
  device: { deviceId: string; name: string; userAgent: string };
  readiness: ReadinessReport | null;
  connectivity: Pick<
    ConnectivityState,
    'band' | 'score' | 'reason' | 'failureStreak' | 'forcedOffline'
  >;
  pack: {
    manifest: InstalledPack['pack']['manifest'];
    checks: string[];
    signedBy: string | null;
    source: string;
    installedAt: string;
  } | null;
  eventLog: {
    count: number;
    headHash: string;
    chain: Array<Sealed<IncidentEvent>>;
    verification: ReturnType<typeof verifyChain>;
  };
  outbox: {
    pending: number;
    oldest: string | null;
    envelopes: Array<
      Pick<OutboxEnvelope, 'id' | 'kind' | 'createdAt' | 'attempts' | 'lastError' | 'payloadHash'>
    >;
  };
  lastRoute: RouteSummary | null;
  checkpoint: (Checkpoint & { verified: boolean; matchesHead: boolean }) | null;
  degradedReasons: string[];
}

export function buildEvidence(input: {
  deviceId: string;
  name: string;
  readiness: ReadinessReport | null;
  connectivity: ConnectivityState;
  pack: InstalledPack | null;
  chain: Array<Sealed<IncidentEvent>>;
  outbox: OutboxEnvelope[];
  lastRoute: RouteSummary | null;
  checkpoint: Checkpoint | null;
}): EvidencePackage {
  const verification = verifyChain(input.chain);
  return {
    schema: 'terranova.evidence.v1',
    exportedAt: new Date().toISOString(),
    release: RELEASE,
    device: { deviceId: input.deviceId, name: input.name, userAgent: navigator.userAgent },
    readiness: input.readiness,
    connectivity: {
      band: input.connectivity.band,
      score: input.connectivity.score,
      reason: input.connectivity.reason,
      failureStreak: input.connectivity.failureStreak,
      forcedOffline: input.connectivity.forcedOffline,
    },
    pack: input.pack
      ? {
          manifest: input.pack.pack.manifest,
          checks: input.pack.pack.checks,
          signedBy: input.pack.pack.signedBy,
          source: input.pack.source,
          installedAt: input.pack.installedAt,
        }
      : null,
    eventLog: {
      count: input.chain.length,
      headHash: input.chain.at(-1)?.hash ?? 'genesis',
      chain: input.chain,
      verification,
    },
    outbox: {
      pending: input.outbox.length,
      oldest: input.outbox[0]?.createdAt ?? null,
      envelopes: input.outbox.map((e) => ({
        id: e.id,
        kind: e.kind,
        createdAt: e.createdAt,
        attempts: e.attempts,
        payloadHash: e.payloadHash,
        ...(e.lastError ? { lastError: e.lastError } : {}),
      })),
    },
    lastRoute: input.lastRoute,
    checkpoint: input.checkpoint
      ? {
          ...input.checkpoint,
          verified: verifyCheckpoint(input.checkpoint).ok,
          matchesHead: input.checkpoint.headHash === (input.chain.at(-1)?.hash ?? 'genesis'),
        }
      : null,
    degradedReasons: input.readiness?.reasons ?? [],
  };
}

export function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
