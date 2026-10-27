#!/usr/bin/env node
/* global document */
/**
 * Two-device relay drill (V2a acceptance in a browser).
 *
 * Starts a facility relay and the production console, opens two isolated browser contexts
 * (two devices), points both at the relay, declares a fire on A, broadcasts an alert, and
 * asserts B sees it, B acknowledges, and A sees B's acknowledgement. The console's origin and
 * the relay are both on localhost: no WAN is involved at any step.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not installed; skipping relay drill');
  process.exit(process.env.E2E_REQUIRED ? 1 : 0);
}
const PORT = 4181;
const RELAY = 8791;
const root = new URL('..', import.meta.url).pathname;
const relay = spawn('node', [join(root, 'packages/relay/dist/main.js')], {
  env: {
    ...process.env,
    RELAY_PORT: String(RELAY),
    RELAY_HOST: '127.0.0.1',
    RELAY_LOG: join(mkdtempSync(join(tmpdir(), 'tn-relay-')), 'log.jsonl'),
  },
  stdio: 'ignore',
  detached: true,
});
const web = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: join(root, 'apps/console'),
  stdio: 'ignore',
  detached: true,
});
const stop = () => {
  for (const p of [relay, web]) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
};
await sleep(2500);
const step = (s) => console.log(`  • ${s}`);
const browser = await chromium.launch();
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('.floor-canvas');
  await page.getByRole('button', { name: /^diagnostics/ }).click();
  await page.getByPlaceholder('http://192.168.1.10:8787').fill(`http://127.0.0.1:${RELAY}`);
  await page.getByRole('button', { name: 'Save & sync' }).click();
  await page.waitForSelector('text=/cursor \\d+/');
  step(`${name}: console up, relay attached`);
  return page;
}
try {
  const A = await device('Device A');
  const B = await device('Device B');

  await A.getByRole('button', { name: 'Level 2', exact: true }).click();
  await A.getByRole('button', { name: /^incidents/ }).click();
  await A.selectOption('.pane select >> nth=0', 'fire');
  await A.selectOption('.pane select >> nth=1', '204');
  await A.getByRole('button', { name: /^Declare fire/ }).click();
  await A.waitForSelector('.banner');
  await A.getByRole('button', { name: /^comms/ }).click();
  await A.getByRole('button', { name: /Send playbook alert/ }).click();
  await A.getByRole('button', { name: /^diagnostics/ }).click();
  await A.getByRole('button', { name: 'Sync now' }).first().click();
  await A.waitForFunction(
    () =>
      /outbox 0/i.test(
        document.querySelector('.pill[title="Writes pending on this device"]')?.textContent ?? '',
      ),
    null,
    { timeout: 15000 },
  );
  step('A: fire declared + alert broadcast; outbox flushed to the relay');

  await B.getByRole('button', { name: 'Sync now' }).first().click();
  await B.waitForSelector('.banner', { timeout: 15000 });
  await B.getByRole('button', { name: /^comms/ }).click();
  await B.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await B.waitForSelector('text=1 ack');
  await B.getByRole('button', { name: /^diagnostics/ }).click();
  await B.getByRole('button', { name: 'Sync now' }).first().click();
  await B.waitForFunction(
    () =>
      /outbox 0/i.test(
        document.querySelector('.pill[title="Writes pending on this device"]')?.textContent ?? '',
      ),
    null,
    { timeout: 15000 },
  );
  step("B: received A's incident and alert via the relay, acknowledged, flushed");

  await A.getByRole('button', { name: 'Sync now' }).first().click();
  await A.getByRole('button', { name: /^comms/ }).click();
  await A.waitForSelector('text=1 ack', { timeout: 15000 });
  step("A: received B's acknowledgement (the receipt)");
  console.log('RELAY DRILL PASSED');
} catch (e) {
  console.error('RELAY DRILL FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  stop();
  process.exit(process.exitCode ?? 0);
}
