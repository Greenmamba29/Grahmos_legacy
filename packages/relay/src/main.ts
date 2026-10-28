#!/usr/bin/env node
import { createRelay } from './server.js';
import { FileRelayLogStore } from './fileStore.js';
import { FilePackRegistryStore } from './packStore.js';

const port = Number(process.env.RELAY_PORT ?? process.argv[2] ?? 8787);
const host = process.env.RELAY_HOST ?? '0.0.0.0';
const logPath = process.env.RELAY_LOG ?? './relay-log.jsonl';
const packDir = process.env.RELAY_PACKS ?? './relay-packs';
const { server, core, registry } = createRelay({
  relayId: process.env.RELAY_ID ?? 'facility-relay',
  log: new FileRelayLogStore(logPath),
  packs: new FilePackRegistryStore(packDir),
});
await core.load();
await registry.load();
server.listen(port, host, () => {
  console.log(
    `terranova-relay ${core.relayId} listening on http://${host}:${port}  log=${logPath}  packs=${packDir}  cursor=${core.head}`,
  );
  console.log(
    'Consoles on this LAN: set VITE_RELAY_URL to this address at build time, or enter it under Diagnostics → Relay.',
  );
});
