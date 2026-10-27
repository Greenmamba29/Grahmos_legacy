#!/usr/bin/env node
/* global caches */
/**
 * Installed-device offline drill, automated.
 *
 * 1. Serve the production build. 2. Provision: open the console once online so the service worker
 * precaches the shell and the fixture pack is verified into IndexedDB. 3. Declare an incident,
 * confirm a hazard-aware route renders. 4. Cut the network (context offline) and HARD RELOAD.
 * 5. The console must come back with the map, the incident, and the route — with no origin.
 *
 * Requires Playwright + Chromium: `npx playwright install chromium` (or a preinstalled browser).
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not installed; skipping e2e drill');
  process.exit(process.env.E2E_REQUIRED ? 1 : 0);
}

const PORT = 4173;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../apps/console', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stop);
await sleep(2500);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const step = (s) => console.log(`  • ${s}`);
page.setDefaultTimeout(15000);

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('.floor-canvas', { timeout: 15000 });
  step('online: console booted and rendered the verified fixture pack');
  // Provisioning: wait until the service worker controls the page and has precached the shell.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    async () => (await caches.keys()).some((k) => k.includes('precache')),
    null,
    { timeout: 20000 },
  );
  await page.waitForSelector('.pill.lvl-READY, .pill.lvl-DEGRADED', { timeout: 20000 });
  step(
    `service worker controls the page; readiness: ${(await page.textContent('.status .pill'))?.trim()}`,
  );

  // Declare a fire in Concourse 204 on Level 2.
  await page.getByRole('button', { name: 'Level 2' }).click();
  await page.getByRole('button', { name: /^incidents/ }).click();
  await page.selectOption('select >> nth=0', 'fire');
  await page.selectOption('select >> nth=1', '204');
  await page.getByRole('button', { name: /^Declare fire/ }).click();
  await page.waitForSelector('.banner');
  await page.waitForSelector('.hazard-zone');
  await page.waitForSelector('.route-primary');
  step('incident declared: banner, hazard zone and hazard-aware route rendered');
  await page.getByRole('button', { name: /^comms/ }).click();
  await page.getByRole('button', { name: /Send playbook alert/ }).click();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await page.waitForSelector('text=1 ack');
  step('alert broadcast and acknowledged locally');
  const pending = await page.textContent('.pill[title="Writes pending on this device"]');
  if (!/outbox 3/.test(pending ?? ''))
    throw new Error(`expected 3 pending writes, saw "${pending}"`);
  step('outbox holds 3 durable writes');

  // Cut the network and hard reload: the origin is gone.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.floor-canvas', { timeout: 15000 });
  await page.waitForSelector('.banner', { timeout: 15000 });
  await page.waitForSelector('.route-primary', { timeout: 15000 });
  const band = await page.textContent('.pill[class*="band-"]');
  step(
    `OFFLINE reload: map, incident and route restored from the device (connectivity band: ${band?.trim()})`,
  );
  await page.getByRole('button', { name: /^routing/ }).click();
  await page.waitForSelector('.board tbody tr');
  const rows = await page.$$eval('.board tbody tr', (trs) => trs.map((t) => t.textContent));
  step(`exit board offline: ${rows.length} exits ranked`);
  await page.getByRole('button', { name: /^diagnostics/ }).click();
  await page.getByRole('button', { name: 'Verify event chain' }).click();
  await page.waitForSelector('text=Chain intact');
  step('event chain verified offline');
  const fatal = errors.filter(
    (e) => !/favicon|Failed to fetch|net::ERR|ERR_INTERNET_DISCONNECTED|_hb=/.test(e),
  );
  if (fatal.length) throw new Error(`page errors: ${fatal.join(' | ')}`);
  console.log('OFFLINE DRILL PASSED');
} catch (e) {
  console.error('OFFLINE DRILL FAILED:', e.message);
  await page.screenshot({ path: 'offline-drill-failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  stop();
  process.exit(process.exitCode ?? 0);
}
