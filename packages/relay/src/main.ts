#!/usr/bin/env node
import { createRelay } from './server.js';
import { FileRelayLogStore } from './fileStore.js';

const port = Number(process.env.RELAY_PORT ?? process.argv[2] ?? 8787);
const host = process.env.RELAY_HOST ?? '0.0.0.0';
const logPath = process.env.RELAY_LOG ?? './relay-log.jsonl';
const { server, core } = createRelay({ relayId: process.env.RELAY_ID ?? 'facility-relay', log: new FileRelayLogStore(logPath) });
await core.load();
server.listen(port, host, () => {
  console.log(`terranova-relay ${core.relayId} listening on http://${host}:${port}  log=${logPath}  cursor=${core.head}`);
  console.log('Consoles on this LAN: set VITE_RELAY_URL to this address at build time, or enter it under Diagnostics → Relay.');
});
