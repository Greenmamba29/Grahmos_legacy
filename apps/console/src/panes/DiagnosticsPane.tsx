import { useEffect, useState } from 'react';
import type { OutboxEnvelope, RouteSummary } from '@terranova/core';
import { useRuntime, useRuntimeState } from '../app/store';
import { BUNDLED_PACKS } from '../data/packs';
import { buildEvidence, downloadJson, RELEASE } from '../app/evidence';

export function DiagnosticsPane({ lastRoute }: { lastRoute: RouteSummary | null }) {
  const rt = useRuntime();
  const s = useRuntimeState();
  const [envelopes, setEnvelopes] = useState<OutboxEnvelope[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; count: number; reason?: string } | null>(null);
  const [name, setName] = useState(s.identity?.name ?? '');
  const [role, setRole] = useState(s.identity?.role ?? 'operator');

  useEffect(() => {
    void rt.pendingEnvelopes().then(setEnvelopes);
  }, [rt, s.pendingCount, s.lastFlushAt]);
  useEffect(() => {
    if (s.identity) {
      setName(s.identity.name);
      setRole(s.identity.role);
    }
  }, [s.identity]);

  const exportEvidence = async (): Promise<void> => {
    const links = await rt.service.eventLog.load();
    const pkg = buildEvidence({
      deviceId: s.identity?.deviceId ?? 'unknown',
      name: s.identity?.name ?? 'unknown',
      readiness: s.readiness,
      connectivity: s.connectivity,
      pack: s.pack,
      chain: links,
      outbox: await rt.pendingEnvelopes(),
      lastRoute,
    });
    downloadJson(`terranova-evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, pkg);
  };

  return (
    <div className="pane">
      <h2>Diagnostics</h2>
      <section className="card">
        <h3>
          Offline readiness:{' '}
          <span className={`pill lvl-${s.readiness?.level ?? 'ERROR'}`}>
            {s.readiness?.level ?? '…'}
          </span>
        </h3>
        <ul className="small list">
          {s.readiness?.components.map((c) => (
            <li key={c.component} className={`comp-${c.state}`}>
              <code>{c.component}</code> {c.state}
              {c.reason ? ` — ${c.reason}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>
          Connectivity:{' '}
          <span className={`pill band-${s.connectivity.band}`}>{s.connectivity.band}</span>
        </h3>
        <p className="small">
          confidence {(s.connectivity.score * 100).toFixed(0)}% · {s.connectivity.reason}
          {s.connectivity.pending ? ` · pending upgrade to ${s.connectivity.pending.band}` : ''}
        </p>
        <label className="row">
          <input
            type="checkbox"
            checked={s.connectivity.forcedOffline}
            onChange={(e) => rt.setForcedOffline(e.target.checked)}
          />{' '}
          Simulate offline (operator override)
        </label>
        <button onClick={() => void rt.probe()}>Probe now</button>
      </section>

      <section className="card">
        <h3>Venue pack</h3>
        {s.pack ? (
          <>
            <p>
              <strong>{s.pack.pack.manifest.venue_name}</strong> v{s.pack.pack.manifest.version} ·{' '}
              {s.pack.pack.manifest.provenance.validation}
              {s.pack.pack.signedBy ? ` · signed by ${s.pack.pack.signedBy}` : ' · UNSIGNED'}
            </p>
            <ul className="small list">
              {s.pack.pack.checks.map((c) => (
                <li key={c}>✓ {c}</li>
              ))}
            </ul>
            {s.pack.pack.manifest.provenance.limitations?.map((l) => (
              <p key={l} className="warn small">
                {l}
              </p>
            ))}
          </>
        ) : (
          <p className="error">
            No pack installed
            {s.packFailure ? ` — ${s.packFailure.stage}: ${s.packFailure.message}` : ''}.
          </p>
        )}
        {s.packFailure && s.pack && (
          <p className="error small">
            Last install attempt rejected at {s.packFailure.stage}: {s.packFailure.message}
          </p>
        )}
        <div className="row">
          {BUNDLED_PACKS.map((b) => (
            <button
              key={b.slug}
              disabled={s.packBusy || s.pack?.pack.manifest.venue_slug === b.slug}
              onClick={() => void rt.switchBundledPack(b.slug)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <label>
          Install a signed pack file
          <input
            type="file"
            accept=".zip"
            onChange={(e) => e.target.files?.[0] && void rt.installFromFile(e.target.files[0])}
          />
        </label>
      </section>

      <section className="card">
        <h3>Outbox inspector ({envelopes.length})</h3>
        {envelopes.length === 0 && <p className="muted small">Nothing pending.</p>}
        <ul className="small list mono">
          {envelopes.map((e) => (
            <li key={e.id}>
              {e.kind} · {new Date(e.createdAt).toLocaleTimeString()} · attempts {e.attempts}
              {e.lastError ? ` · ${e.lastError}` : ''} · {e.payloadHash.slice(0, 12)}…
            </li>
          ))}
        </ul>
        {s.lastFlush && (
          <p className="muted small">
            Last flush via {s.lastFlush.transport}: {s.lastFlush.delivered.length} delivered,{' '}
            {s.lastFlush.retried.length} retried, {s.lastFlush.rejected.length} rejected
          </p>
        )}
      </section>

      <section className="card">
        <h3>Evidence</h3>
        <div className="row">
          <button
            onClick={() =>
              void rt.service.eventLog
                .verify()
                .then((v) =>
                  setChain(
                    v.ok
                      ? { ok: true, count: v.count }
                      : { ok: false, count: v.count, reason: `${v.reason} at #${v.brokenAt}` },
                  ),
                )
            }
          >
            Verify event chain
          </button>
          <button className="primary" onClick={() => void exportEvidence()}>
            Export evidence package
          </button>
        </div>
        {chain && (
          <p className={chain.ok ? 'ok small' : 'error small'}>
            {chain.ok
              ? `Chain intact: ${chain.count} sealed events.`
              : `CHAIN BROKEN: ${chain.reason}`}
          </p>
        )}
        <p className="muted small">
          Release {RELEASE.version} · {RELEASE.commit} · built {RELEASE.builtAt} · {RELEASE.mode}
        </p>
      </section>

      <section className="card">
        <h3>This device</h3>
        <p className="small mono">{s.identity?.deviceId}</p>
        <label>
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="operator">operator</option>
            <option value="responder">responder</option>
            <option value="occupant">occupant</option>
          </select>
        </label>
        <button
          disabled={!s.identity || !name.trim()}
          onClick={() =>
            s.identity && void rt.setIdentity({ ...s.identity, name: name.trim(), role })
          }
        >
          Save identity
        </button>
      </section>
    </div>
  );
}
