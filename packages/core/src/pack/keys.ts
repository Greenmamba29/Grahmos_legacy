/**
 * PINNED pack-signing public keys. Pinned, not discovered: a key fetched at runtime would let
 * whoever controls the network decide what counts as an authentic venue pack.
 *
 * ROTATION: add the new key beside the old one and ship; packs signed by either verify. Remove the
 * old entry only when no supported pack still uses it — removal is revocation.
 *
 * The 'terranova-fixture-2026-10' key is for ENGINEERING FIXTURE packs. Its seed is public (see
 * packages/cli) so anyone can rebuild the fixture pack; it must never sign a real venue. Production
 * keys are added here by the Security / Trust Lead with the private seed held only in the release
 * environment.
 */
export const PINNED_PACK_SIGNING_KEYS: Record<string, string> = {
  'terranova-fixture-2026-10': 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
};

export const FIXTURE_SIGNING_KEY_ID = 'terranova-fixture-2026-10';
/** PUBLIC seed for the fixture key (RFC 8032 test vector 1). Fixture packs only. */
export const FIXTURE_SIGNING_SEED_HEX =
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
