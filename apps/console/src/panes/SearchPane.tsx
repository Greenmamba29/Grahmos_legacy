import { useMemo, useState } from 'react';
import type { SearchHit, SearchSource } from '@terranova/core';
import { useRuntimeState } from '../app/store';

export interface SearchPaneProps {
  onFocus: (hit: SearchHit) => void;
}

const SOURCES: SearchSource[] = ['procedure', 'poi', 'room', 'playbook', 'incident'];

export function SearchPane({ onFocus }: SearchPaneProps) {
  const s = useRuntimeState();
  const [q, setQ] = useState('');
  const [sources, setSources] = useState<SearchSource[]>(SOURCES);
  const hits = useMemo(() => s.search?.query(q, 20, sources) ?? [], [s.search, q, sources]);
  const suggestions = useMemo(
    () => (q.length >= 2 && hits.length === 0 ? (s.search?.suggest(q) ?? []) : []),
    [s.search, q, hits.length],
  );

  return (
    <div className="pane">
      <h2>Search</h2>
      <section className="card">
        <input
          autoFocus
          placeholder="exit, AED, lockdown, communications loss…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search installed content"
        />
        <div className="row small">
          {SOURCES.map((src) => (
            <label key={src} className="row">
              <input
                type="checkbox"
                checked={sources.includes(src)}
                onChange={(e) =>
                  setSources(
                    e.target.checked ? [...sources, src] : sources.filter((x) => x !== src),
                  )
                }
              />{' '}
              {src}
            </label>
          ))}
        </div>
        <p className="muted small">
          Lexical search over the installed pack, floor features, playbooks and this device's
          incident log. Index: {s.search?.size ?? 0} documents. No remote call is made.
        </p>
      </section>
      {suggestions.length > 0 && (
        <p className="muted small">
          Did you mean:{' '}
          {suggestions.map((sg) => (
            <button
              key={sg}
              className="linkish small"
              style={{ display: 'inline', width: 'auto' }}
              onClick={() => setQ(sg)}
            >
              {sg}
            </button>
          ))}
        </p>
      )}
      <ul className="list">
        {hits.map((h) => (
          <li key={h.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{h.title}</strong>
              <span className="pill">{h.source}</span>
            </div>
            <p className="small">{h.body.length > 220 ? `${h.body.slice(0, 220)}…` : h.body}</p>
            {h.xy && (
              <button className="small" onClick={() => onFocus(h)}>
                Show on {h.level ?? 'map'}
              </button>
            )}
          </li>
        ))}
        {q.trim() && hits.length === 0 && (
          <li className="muted">No local match. Nothing was fetched from outside the device.</li>
        )}
      </ul>
    </div>
  );
}
