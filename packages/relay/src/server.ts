/**
 * HTTP front for RelayCore. Dependency-free (node:http) so it runs on any facility box or laptop.
 * CORS is open on purpose: the console is served from a different origin on the same LAN, and the
 * security boundary is the envelope signature, not the browser origin.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  MemoryDeviceKeyStore,
  MemoryRelayLogStore,
  RELAY_PATHS,
  RelayCore,
  type DeviceKeyStore,
  type Envelope,
  type RelayHealth,
  type RelayLogStore,
} from '@terranova/core';

export interface RelayServerOptions {
  relayId?: string;
  log?: RelayLogStore;
  keys?: DeviceKeyStore;
  /** Max accepted body size in bytes. */
  maxBodyBytes?: number;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createRelay(opts: RelayServerOptions = {}): { server: Server; core: RelayCore } {
  const core = new RelayCore(
    opts.relayId ?? `relay-${Math.random().toString(36).slice(2, 8)}`,
    opts.log ?? new MemoryRelayLogStore(),
    opts.keys ?? new MemoryDeviceKeyStore(),
  );
  const max = opts.maxBodyBytes ?? 256 * 1024;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://relay');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === RELAY_PATHS.health) {
        await core.load();
        const h: RelayHealth = {
          ok: true,
          relayId: core.relayId,
          cursor: core.head,
          count: core.count,
        };
        json(res, 200, h);
        return;
      }
      if (req.method === 'POST' && url.pathname === RELAY_PATHS.envelopes) {
        let env: Envelope;
        try {
          env = JSON.parse(await readBody(req, max)) as Envelope;
        } catch (e) {
          json(res, 400, { reason: `bad body: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
        const r = await core.accept(env);
        if (r.status === 'rejected') json(res, 422, { reason: r.verdict.reason });
        else json(res, r.status === 'duplicate' ? 409 : 202, r.result);
        return;
      }
      if (req.method === 'GET' && url.pathname === RELAY_PATHS.envelopes) {
        const since = Number(url.searchParams.get('since') ?? '0');
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? '200')));
        json(
          res,
          200,
          await core.pull(url.searchParams.get('venue'), Number.isFinite(since) ? since : 0, limit),
        );
        return;
      }
      json(res, 404, { reason: 'not found' });
    } catch (e) {
      json(res, 500, { reason: e instanceof Error ? e.message : String(e) });
    }
  });
  return { server, core };
}
