/** Lowercase hex of bytes. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Bytes of a hex string. Throws on odd length or non-hex characters. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error(`hex string has odd length (${clean.length})`);
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error('hex string contains non-hex characters');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
