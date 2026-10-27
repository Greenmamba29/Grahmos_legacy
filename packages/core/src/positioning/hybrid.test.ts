import { describe, expect, it } from 'vitest';
import { hybridPosition, POSITIONING } from './hybrid.js';

const now = 1_000_000_000;
const cp = { id: 'cp-204', xy: { x: 1, y: 10 }, at: now - 10_000 };

describe('hybridPosition', () => {
  it('fresh checkpoint wins over GNSS', () => {
    const f = hybridPosition({ checkpoint: cp, gnss: { xy: { x: 50, y: 50 }, accuracyM: 3, at: now }, now });
    expect(f.source).toBe('checkpoint');
    expect(f.confident).toBe(true);
    expect(f.xy).toEqual(cp.xy);
  });
  it('a tight recent GNSS fix beats a stale checkpoint; a coarse one does not', () => {
    const stale = { ...cp, at: now - POSITIONING.CHECKPOINT_FRESH_MS - 1 };
    const tight = hybridPosition({ checkpoint: stale, gnss: { xy: { x: 5, y: 5 }, accuracyM: 6, at: now }, now });
    expect(tight.source).toBe('gnss');
    const coarse = hybridPosition({ checkpoint: stale, gnss: { xy: { x: 5, y: 5 }, accuracyM: 40, at: now }, now });
    expect(coarse.source).toBe('checkpoint-stale');
    expect(coarse.confident).toBe(false);
  });
  it('indoor GNSS is distrusted harder than outdoor', () => {
    const g = { xy: { x: 0, y: 0 }, accuracyM: 12, at: now };
    expect(hybridPosition({ gnss: { ...g, outdoors: true }, now }).source).toBe('gnss');
    expect(hybridPosition({ gnss: { ...g, outdoors: false }, now }).source).toBe('none');
  });
  it('nothing usable → no dot, with a reason', () => {
    const f = hybridPosition({ now });
    expect(f.xy).toBeNull();
    expect(f.reason).toMatch(/no checkpoint/);
  });
});
