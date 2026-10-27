import { CATALOGUES, LANGS, type Lang } from './catalogues.js';
import type { IncidentType } from '../comms/types.js';

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && (LANGS as readonly string[]).includes(x);
}

/** Translate; falls back to English, then to the key itself (visible, never silent). */
export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = CATALOGUES[lang].strings[key] ?? CATALOGUES.en.strings[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Instruction lines are stored pipe-separated so a catalogue stays flat. */
export function tList(lang: Lang, key: string): string[] {
  return t(lang, key)
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function dirFor(lang: Lang): 'ltr' | 'rtl' {
  return CATALOGUES[lang].dir;
}

export interface LocalisedPlaybook {
  label: string;
  banner: string;
  instructions: Record<'occupant' | 'responder' | 'operator', string[]>;
  defaultAlert: { title: string; body: string };
}

const BANNER_KEY: Record<IncidentType, string> = {
  fire: 'route.evacuate',
  hazmat: 'route.hazmat',
  medical: 'route.medical',
  lockdown: 'route.lockdown',
  outage: 'route.outage',
  severe_weather: 'route.severe_weather',
  other: 'route.other',
};

export function localisedPlaybook(lang: Lang, type: IncidentType): LocalisedPlaybook {
  return {
    label: t(lang, `type.${type}`),
    banner: t(lang, BANNER_KEY[type]),
    instructions: {
      occupant: tList(lang, `instr.${type}.occupant`),
      responder: tList(lang, `instr.${type}.responder`),
      operator: tList(lang, `instr.${type}.operator`),
    },
    defaultAlert: { title: t(lang, `alert.${type}.title`), body: t(lang, `alert.${type}.body`) },
  };
}

/** Parity report: keys present in English but missing or empty elsewhere, and placeholder drift. */
export function catalogueParity(): Array<{ lang: Lang; key: string; problem: string }> {
  const out: Array<{ lang: Lang; key: string; problem: string }> = [];
  const enKeys = Object.keys(CATALOGUES.en.strings);
  const placeholders = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const lang of LANGS) {
    if (lang === 'en') continue;
    const c = CATALOGUES[lang].strings;
    for (const k of enKeys) {
      if (!(k in c)) out.push({ lang, key: k, problem: 'missing' });
      else if (!c[k]!.trim()) out.push({ lang, key: k, problem: 'empty' });
      else if (placeholders(c[k]!) !== placeholders(CATALOGUES.en.strings[k]!)) out.push({ lang, key: k, problem: 'placeholder mismatch' });
      else if (k.startsWith('instr.') && c[k]!.split('|').length !== CATALOGUES.en.strings[k]!.split('|').length) out.push({ lang, key: k, problem: 'instruction count differs' });
    }
    for (const k of Object.keys(c)) if (!(k in CATALOGUES.en.strings)) out.push({ lang, key: k, problem: 'not in English source' });
  }
  return out;
}
