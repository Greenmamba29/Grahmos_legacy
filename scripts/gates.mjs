#!/usr/bin/env node
/**
 * Release gates. Each gate is a claim the product makes, checked mechanically:
 *   offline      no third-party runtime host in the console shell (Tier 0 depends on nothing remote)
 *   secrets      no private keys or tokens in the tree
 *   fixtures     bundled packs are labelled as fixtures, never as validated venues
 *   packs        bundled packs verify against the pinned keys
 *   determinism  rebuilding the fixture packs produces byte-identical output
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const failures = [];
const fail = (gate, msg) => failures.push(`[${gate}] ${msg}`);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dev-dist', '.git', 'coverage'].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(root);
const text = (p) => readFileSync(p, 'utf8');

// offline: the console must not reference third-party runtime hosts.
const consoleSrc = files.filter(
  (f) => f.includes('/apps/console/src/') && /\.(ts|tsx|css)$/.test(f),
);
const hostRe = /https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+\.[a-z]{2,}/gi;
for (const f of consoleSrc) {
  const hits = text(f).match(hostRe) ?? [];
  const bad = hits.filter((h) => !/w3\.org|github\.com|example\.com/.test(h));
  if (bad.length) fail('offline', `${relative(root, f)} references ${bad.join(', ')}`);
}

// secrets: private keys / tokens.
const secretRe =
  /(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/;
for (const f of files.filter(
  (f) => /\.(ts|tsx|js|mjs|json|md|yml|yaml|env)$/.test(f) && !f.endsWith('package-lock.json'),
)) {
  if (secretRe.test(text(f)))
    fail('secrets', `${relative(root, f)} looks like it contains a credential`);
}
const seedRe = /PACK_SIGNING_SEED\s*=\s*[0-9a-f]{64}/i;
for (const f of files.filter((f) => /\.(env|yml|yaml|json)$/.test(f)))
  if (seedRe.test(text(f))) fail('secrets', `${relative(root, f)} contains a signing seed`);

// packs + fixtures + determinism, via the built core.
let core;
try {
  core = await import(new URL('../packages/core/dist/index.js', import.meta.url));
} catch {
  fail('packs', 'core is not built (run npm run build -w @terranova/core first)');
}
if (core) {
  const packDir = join(root, 'apps/console/public/packs');
  for (const name of readdirSync(packDir).filter((n) => n.endsWith('.zip'))) {
    const bytes = new Uint8Array(readFileSync(join(packDir, name)));
    try {
      const v = core.verifyPack(bytes, { pinnedKeys: core.PINNED_PACK_SIGNING_KEYS });
      if (v.manifest.provenance.validation !== 'fixture')
        fail(
          'fixtures',
          `${name} claims "${v.manifest.provenance.validation}" but ships as a bundled demo pack`,
        );
      if (!/fixture/i.test(v.manifest.venue_name))
        fail('fixtures', `${name} venue_name must say "fixture"`);
    } catch (e) {
      fail('packs', `${name}: ${e.message}`);
    }
  }
  try {
    const cli = join(root, 'packages/cli/dist/main.js');
    const tmp = join(root, 'node_modules/.cache');
    execFileSync('node', [cli, 'pack', 'fixture', join(tmp, 'det-a.zip')], { stdio: 'ignore' });
    execFileSync('node', [cli, 'pack', 'fixture', join(tmp, 'det-b.zip')], { stdio: 'ignore' });
    const a = readFileSync(join(tmp, 'det-a.zip'));
    const b = readFileSync(join(tmp, 'det-b.zip'));
    const shipped = readFileSync(join(packDir, 'city-center-stadium.zip'));
    if (!a.equals(b)) fail('determinism', 'two fixture builds differ');
    if (!a.equals(shipped))
      fail('determinism', 'shipped city-center-stadium.zip is stale; run npm run packs');
  } catch (e) {
    fail('determinism', e.message);
  }
}
void require;

if (failures.length) {
  console.error('GATES FAILED');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('gates: offline ✓  secrets ✓  fixtures ✓  packs ✓  determinism ✓');
