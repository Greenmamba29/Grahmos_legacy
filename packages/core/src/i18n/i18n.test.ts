import { describe, expect, it } from 'vitest';
import { catalogueParity, dirFor, localisedPlaybook, t, tList } from './t.js';
import { LANGS } from './catalogues.js';
import { PLAYBOOKS } from '../safetymap/playbooks.js';

describe('i18n', () => {
  it('catalogues are in parity with English (keys, placeholders, instruction counts)', () => {
    expect(catalogueParity()).toEqual([]);
  });
  it('translates with placeholders and falls back visibly', () => {
    expect(t('es', 'outbox.pending', { n: 3 })).toBe('bandeja de salida 3');
    expect(t('ar', 'no.such.key')).toBe('no.such.key');
    expect(tList('ar', 'instr.fire.occupant')).toHaveLength(4);
  });
  it('arabic is rtl; english playbook strings equal the source playbooks', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('es')).toBe('ltr');
    for (const type of Object.keys(PLAYBOOKS) as Array<keyof typeof PLAYBOOKS>) {
      const l = localisedPlaybook('en', type);
      expect(l.banner).toBe(PLAYBOOKS[type].banner);
      expect(l.instructions.occupant).toEqual(PLAYBOOKS[type].instructions.occupant);
      expect(l.defaultAlert.title).toBe(PLAYBOOKS[type].defaultAlert.title);
    }
    for (const lang of LANGS)
      expect(localisedPlaybook(lang, 'fire').banner.length).toBeGreaterThan(10);
  });
});
