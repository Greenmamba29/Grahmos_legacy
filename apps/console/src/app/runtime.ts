/**
 * Runtime — wires the pure core to the browser. One instance per page. Everything here is
 * observable through `subscribe`; React reads it with useSyncExternalStore.
 */
import {
  CommsService,
  EventLog,
  Outbox,
  evaluateReadiness,
  initialConnectivityState,
  reduceConnectivity,
  heartbeatIntervalFor,
  HEARTBEAT,
  type ComponentReport,
  type ConnectivityState,
  type Incident,
  type ReadinessReport,
  type FlushReport,
  type OutboxEnvelope,
} from '@terranova/core';
import { db, getSetting, setSetting, type TerraNovaDB } from '../data/db';
import { DexieEventLogStore, DexieOutboxStore } from '../data/stores';
import { loadIdentity, saveIdentity, type DeviceIdentity } from '../data/identity';
import {
  BUNDLED_PACKS,
  describeFailure,
  fetchAndInstall,
  installPackBytes,
  openInstalledPack,
  type InstalledPack,
  type PackFailure,
} from '../data/packs';
import { configuredTransport, SYNC_URL } from '../data/transport';
import { loadDeviceKey, rotateDeviceKey, seedBytes, type DeviceKey } from '../data/deviceKey';
import { DexieDeviceKeyStore, loadRelayUrl, makeRelayClient, saveRelayUrl } from '../data/relay';
import type { Transport } from '@terranova/core';
import { dirFor, isLang, PackVerifyError, type Lang } from '@terranova/core';
import { signCheckpoint, type Checkpoint } from '@terranova/core';
import { LocalSearch, buildCorpus } from '@terranova/core';

export interface RuntimeState {
  booted: boolean;
  bootError: string | null;
  identity: DeviceIdentity | null;
  deviceKey: DeviceKey | null;
  search: LocalSearch | null;
  lastCheckpoint: Checkpoint | null;
  language: Lang;
  relayUrl: string | null;
  relayCursor: number;
  relayLastPullAt: string | null;
  relayLastError: string | null;
  relayIngested: number;
  relayRejected: number;
  pack: InstalledPack | null;
  packFailure: PackFailure | null;
  packBusy: boolean;
  incidents: Map<string, Incident>;
  connectivity: ConnectivityState;
  readiness: ReadinessReport | null;
  pendingCount: number;
  lastFlush: FlushReport | null;
  lastFlushAt: string | null;
  shellCached: boolean | null;
  storagePersisted: boolean | null;
  swUpdateReady: boolean;
}

type Listener = () => void;

export class Runtime {
  private state: RuntimeState;
  private listeners = new Set<Listener>();
  private comms: CommsService | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private readonly d: TerraNovaDB;

  constructor(d: TerraNovaDB = db()) {
    this.d = d;
    this.state = {
      booted: false,
      bootError: null,
      identity: null,
      deviceKey: null,
      search: null,
      lastCheckpoint: null,
      language: 'en',
      relayUrl: null,
      relayCursor: 0,
      relayLastPullAt: null,
      relayLastError: null,
      relayIngested: 0,
      relayRejected: 0,
      pack: null,
      packFailure: null,
      packBusy: false,
      incidents: new Map(),
      connectivity: initialConnectivityState(
        typeof navigator === 'undefined' ? true : navigator.onLine,
        Date.now(),
      ),
      readiness: null,
      pendingCount: 0,
      lastFlush: null,
      lastFlushAt: null,
      shellCached: null,
      storagePersisted: null,
      swUpdateReady: false,
    };
  }

  getState = (): RuntimeState => this.state;
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(patch: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get service(): CommsService {
    if (!this.comms) throw new Error('runtime not booted');
    return this.comms;
  }

  async boot(): Promise<void> {
    try {
      const identity = await loadIdentity(this.d);
      const deviceKey = await loadDeviceKey(this.d);
      const relayUrl = await loadRelayUrl(this.d);
      const storedLang = await getSetting<string>('language', 'en', this.d);
      const language: Lang = isLang(storedLang) ? storedLang : 'en';
      this.applyLanguage(language);
      const seq = await getSetting<number>('seq', 0, this.d);
      const comms = new CommsService({
        log: new EventLog(new DexieEventLogStore(this.d)),
        outbox: new Outbox(new DexieOutboxStore(this.d)),
        actor: () => {
          const id = this.state.identity ?? identity;
          return { deviceId: id.deviceId, name: id.name, role: id.role };
        },
        seq,
        onSeq: (n) => void setSetting('seq', n, this.d),
      });
      this.comms = comms;
      comms.subscribe((incidents) => {
        this.set({ incidents });
        this.rebuildSearch();
        void this.refreshPending();
      });
      await comms.init();
      this.set({ identity, deviceKey, relayUrl, language });

      // Pack: local first, bundled fixture only when nothing is installed yet.
      let pack: InstalledPack | null = null;
      let packFailure: PackFailure | null = null;
      try {
        pack = await openInstalledPack(this.d);
      } catch (e) {
        packFailure = describeFailure(e);
      }
      if (!pack && !packFailure) {
        try {
          pack = await fetchAndInstall(this.d, BUNDLED_PACKS[0].url, 'bundled');
        } catch (e) {
          packFailure = describeFailure(e);
        }
      }
      this.set({ pack, packFailure, booted: true });
      this.rebuildSearch();

      void this.probeStorage();
      void this.probeShellCache();
      this.startHeartbeat();
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () =>
          this.dispatch({ type: 'browser_online', at: Date.now(), online: true }),
        );
        window.addEventListener('offline', () =>
          this.dispatch({ type: 'browser_online', at: Date.now(), online: false }),
        );
      }
      this.recomputeReadiness();
    } catch (e) {
      this.set({ bootError: e instanceof Error ? e.message : String(e), booted: true });
    }
  }

  // ------------------------------------------------------------------ packs
  async switchBundledPack(slug: string): Promise<void> {
    const entry = BUNDLED_PACKS.find((p) => p.slug === slug);
    if (!entry) return;
    this.set({ packBusy: true });
    try {
      const row = await this.d.packs.get(slug);
      let pack: InstalledPack;
      if (row) {
        await setSetting('activePack', slug, this.d);
        pack = (await openInstalledPack(this.d))!;
      } else pack = await fetchAndInstall(this.d, entry.url, 'bundled');
      this.set({ pack, packFailure: null });
      this.rebuildSearch();
    } catch (e) {
      this.set({ packFailure: describeFailure(e) });
    } finally {
      this.set({ packBusy: false });
      this.recomputeReadiness();
    }
  }

  async installFromFile(file: File): Promise<void> {
    this.set({ packBusy: true });
    try {
      const pack = await installPackBytes(this.d, new Uint8Array(await file.arrayBuffer()), 'file');
      this.set({ pack, packFailure: null });
      this.rebuildSearch();
    } catch (e) {
      this.set({ packFailure: describeFailure(e) });
    } finally {
      this.set({ packBusy: false });
      this.recomputeReadiness();
    }
  }

  // ------------------------------------------------------------------ search
  private rebuildSearch(): void {
    const pack = this.state.pack?.pack;
    const search = new LocalSearch(
      buildCorpus({
        procedures: pack?.procedures ?? null,
        floors: pack?.floors ?? {},
        incidents: this.state.incidents.values(),
      }),
    );
    this.set({ search });
  }

  // ------------------------------------------------------------------ trust
  /** Sign the current chain head with the device key. */
  async signCheckpointNow(): Promise<Checkpoint | null> {
    const key = this.state.deviceKey;
    const id = this.state.identity;
    if (!key || !id || !this.comms) return null;
    const links = await this.comms.eventLog.load();
    const head = links.at(-1)?.hash ?? 'genesis';
    const cp = signCheckpoint(
      { deviceId: id.deviceId, headHash: head, count: links.length, at: new Date().toISOString() },
      seedBytes(key),
    );
    await setSetting('lastCheckpoint', cp, this.d);
    this.set({ lastCheckpoint: cp });
    return cp;
  }

  async rotateKey(): Promise<void> {
    const deviceKey = await rotateDeviceKey(this.d);
    this.set({ deviceKey, lastCheckpoint: null });
  }

  // ------------------------------------------------------------------ identity
  async setIdentity(id: DeviceIdentity): Promise<void> {
    await saveIdentity(this.d, id);
    this.set({ identity: id });
  }

  // ------------------------------------------------------------------ connectivity
  private dispatch(ev: Parameters<typeof reduceConnectivity>[1]): void {
    this.set({ connectivity: reduceConnectivity(this.state.connectivity, ev) });
  }

  setForcedOffline(forced: boolean): void {
    this.dispatch({ type: 'forced_offline', at: Date.now(), forced });
    this.recomputeReadiness();
  }

  /** Same-origin HEAD probe. GET would be answered by the service worker and prove nothing. */
  async probe(): Promise<void> {
    if (this.state.connectivity.forcedOffline) {
      this.dispatch({ type: 'tick', at: Date.now() });
      return;
    }
    const started = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), HEARTBEAT.TIMEOUT_MS);
    try {
      const res = await fetch(`favicon.svg?_hb=${started}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: ctl.signal,
      });
      if (res.ok) this.dispatch({ type: 'probe_ok', at: Date.now(), rttMs: Date.now() - started });
      else this.dispatch({ type: 'probe_fail', at: Date.now() });
    } catch {
      this.dispatch({ type: 'probe_fail', at: Date.now() });
    } finally {
      clearTimeout(t);
    }
    if (this.state.connectivity.band !== 'local') {
      void this.flush().then(() => this.pullRelay());
    }
  }

  private startHeartbeat(): void {
    const loop = async (): Promise<void> => {
      await this.probe();
      if (!this.state.shellCached) await this.probeShellCache();
      this.heartbeat = setTimeout(loop, heartbeatIntervalFor(this.state.connectivity.band));
    };
    void loop();
  }

  stop(): void {
    if (this.heartbeat) clearTimeout(this.heartbeat);
  }

  // ------------------------------------------------------------------ outbox
  private async refreshPending(): Promise<void> {
    if (!this.comms) return;
    this.set({ pendingCount: await this.comms.pendingCount() });
    this.recomputeReadiness();
  }

  async pendingEnvelopes(): Promise<OutboxEnvelope[]> {
    return this.comms ? this.comms.queue.pending() : [];
  }

  /** Relay (LAN) wins over a generic HTTP uplink when both are configured. */
  private transport(): Transport | null {
    const s = this.state;
    if (s.relayUrl && s.identity && s.deviceKey && s.pack) {
      return makeRelayClient(
        s.relayUrl,
        s.pack.pack.manifest.venue_slug,
        s.identity.deviceId,
        seedBytes(s.deviceKey),
      );
    }
    return configuredTransport();
  }

  async flush(): Promise<FlushReport | null> {
    const transport = this.transport();
    if (!this.comms || !transport) return null;
    if (this.state.connectivity.band === 'local') return null;
    const report = await this.comms.flush(transport);
    this.set({ lastFlush: report, lastFlushAt: new Date().toISOString() });
    await this.refreshPending();
    return report;
  }

  /** Pull envelopes from the relay since our cursor, verify, and fold them in. */
  async pullRelay(): Promise<void> {
    const s = this.state;
    if (!this.comms || !s.relayUrl || !s.identity || !s.deviceKey || !s.pack) return;
    if (s.connectivity.band === 'local') return;
    const venue = s.pack.pack.manifest.venue_slug;
    const client = makeRelayClient(s.relayUrl, venue, s.identity.deviceId, seedBytes(s.deviceKey));
    const cursorKey = `relayCursor:${s.relayUrl}:${venue}`;
    try {
      const since = await getSetting<number>(cursorKey, 0, this.d);
      const p = await client.pull(since, new DexieDeviceKeyStore(this.d));
      const added = await this.comms.ingestRemote(p.events);
      await setSetting(cursorKey, p.cursor, this.d);
      this.set({
        relayCursor: p.cursor,
        relayLastPullAt: new Date().toISOString(),
        relayLastError: null,
        relayIngested: s.relayIngested + added,
        relayRejected: s.relayRejected + p.rejected.length,
      });
      if (p.rejected.length) console.warn('[relay] rejected envelopes', p.rejected);
    } catch (e) {
      this.set({
        relayLastError: e instanceof Error ? e.message : String(e),
        relayLastPullAt: new Date().toISOString(),
      });
    }
  }

  /** Language is part of the degradation contract: static catalogues, applied without a network. */
  async setLanguage(language: Lang): Promise<void> {
    await setSetting('language', language, this.d);
    this.applyLanguage(language);
    this.set({ language });
  }

  private applyLanguage(language: Lang): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
    document.documentElement.dir = dirFor(language);
  }

  /** Tier 2: packs published on the facility relay. Listing only; install re-verifies on device. */
  async listRelayPacks(): Promise<
    Array<{
      slug: string;
      version: string;
      venue_name: string;
      validation: string;
      signedBy: string | null;
    }>
  > {
    if (!this.state.relayUrl) return [];
    const res = await fetch(`${this.state.relayUrl.replace(/\/$/, '')}/v1/packs`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`relay packs HTTP ${res.status}`);
    return (await res.json()) as Array<{
      slug: string;
      version: string;
      venue_name: string;
      validation: string;
      signedBy: string | null;
    }>;
  }

  async installFromRelay(slug: string): Promise<void> {
    if (!this.state.relayUrl) return;
    this.set({ packBusy: true });
    try {
      const res = await fetch(
        `${this.state.relayUrl.replace(/\/$/, '')}/v1/packs/${encodeURIComponent(slug)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new PackVerifyError('format', `relay pack HTTP ${res.status}`);
      const pack = await installPackBytes(this.d, new Uint8Array(await res.arrayBuffer()), 'url');
      this.set({ pack, packFailure: null });
      this.rebuildSearch();
    } catch (e) {
      this.set({ packFailure: describeFailure(e) });
    } finally {
      this.set({ packBusy: false });
      this.recomputeReadiness();
    }
  }

  async setRelayUrl(url: string | null): Promise<void> {
    const clean = url?.trim() ? url.trim() : null;
    await saveRelayUrl(this.d, clean);
    this.set({ relayUrl: clean, relayLastError: null });
    if (clean) {
      await this.flush();
      await this.pullRelay();
    }
  }

  get uplinkConfigured(): boolean {
    return SYNC_URL !== null || this.state.relayUrl !== null;
  }

  // ------------------------------------------------------------------ readiness
  private async probeStorage(): Promise<void> {
    try {
      if (navigator.storage?.persist) {
        const persisted =
          (await navigator.storage.persisted()) || (await navigator.storage.persist());
        this.set({ storagePersisted: persisted });
      } else this.set({ storagePersisted: false });
    } catch {
      this.set({ storagePersisted: false });
    }
    this.recomputeReadiness();
  }

  private async probeShellCache(): Promise<void> {
    try {
      if (!('caches' in window)) {
        this.set({ shellCached: false });
      } else {
        const keys = await caches.keys();
        let hit = false;
        for (const k of keys) {
          const c = await caches.open(k);
          // Workbox keys precache entries with a `__WB_REVISION__` query; ignore it when matching.
          const opts = { ignoreSearch: true };
          if (
            (await c.match(new URL('index.html', location.href).href, opts)) ||
            (await c.match(new URL('./', location.href).href, opts))
          )
            hit = true;
        }
        this.set({ shellCached: hit });
      }
    } catch {
      this.set({ shellCached: false });
    }
    this.recomputeReadiness();
  }

  recheckShell(): void {
    void this.probeShellCache();
  }

  setSwUpdateReady(ready: boolean): void {
    this.set({ swUpdateReady: ready });
  }

  recomputeReadiness(): void {
    const now = new Date().toISOString();
    const s = this.state;
    const c = (
      component: ComponentReport['component'],
      state: ComponentReport['state'],
      reason?: string,
    ): ComponentReport =>
      reason ? { component, state, reason, checkedAt: now } : { component, state, checkedAt: now };
    const pack = s.pack;
    const reports: ComponentReport[] = [
      s.shellCached === null
        ? c('app_shell_cached', 'unknown', 'checking cache')
        : s.shellCached
          ? c('app_shell_cached', 'ok')
          : c(
              'app_shell_cached',
              'missing',
              'service worker has not precached the shell yet (first visit or dev server)',
            ),
      c('local_db_open', s.bootError ? 'error' : 'ok', s.bootError ?? undefined),
      pack
        ? c('venue_pack_installed', 'ok')
        : c(
            'venue_pack_installed',
            'missing',
            s.packFailure
              ? `${s.packFailure.stage}: ${s.packFailure.message}`
              : 'no pack installed',
          ),
      pack
        ? pack.pack.signedBy
          ? c('venue_pack_verified', 'ok')
          : c('venue_pack_verified', 'degraded', 'pack accepted UNSIGNED by engineering override')
        : c('venue_pack_verified', 'missing', 'no pack to verify'),
      pack && Object.keys(pack.pack.floors).length
        ? c('floor_geometry_available', 'ok')
        : c('floor_geometry_available', 'missing', 'no floors'),
      pack
        ? c('routing_engine_ready', 'ok')
        : c('routing_engine_ready', 'missing', 'routing needs a floor'),
      c(
        'outbox_available',
        this.comms ? 'ok' : 'error',
        this.comms ? undefined : 'comms service failed',
      ),
      c('evidence_exporter_available', 'ok'),
      s.storagePersisted === null
        ? c('storage_persisted', 'unknown', 'checking')
        : s.storagePersisted
          ? c('storage_persisted', 'ok')
          : c(
              'storage_persisted',
              'degraded',
              'browser declined persistent storage; data may be evicted under pressure',
            ),
    ];
    this.set({ readiness: evaluateReadiness(reports) });
  }
}

let runtime: Runtime | null = null;
export function getRuntime(): Runtime {
  if (!runtime) runtime = new Runtime();
  return runtime;
}
