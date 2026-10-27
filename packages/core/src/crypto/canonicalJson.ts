/**
 * Canonical JSON (RFC 8785 subset): recursive key sort, no whitespace, nothing dropped.
 *
 * A digest is only meaningful when every party serialises the same bytes. This is the ONE
 * canonicaliser in TerraNova; packs, audit entries, and signed envelopes all go through it.
 * Non-JSON values (functions, symbols, undefined at the top level, NaN) are refused rather than
 * coerced, because an entry that cannot round-trip can never re-verify.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError(`non-finite number ${value}`);
      return JSON.stringify(value);
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      throw new CanonicalizationError(`${typeof value} is not JSON`);
    case 'object':
      break;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}
