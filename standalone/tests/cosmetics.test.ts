import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, FURS, HATS, sanitizeLook, SKINS, TRAILS } from '../src/cosmetics';

describe('cosmetics', () => {
  it('keeps valid looks', () => {
    const look = { skin: SKINS.length - 1, hat: 2, fur: FURS.length - 1, trail: TRAILS.length - 1 };
    expect(sanitizeLook(look)).toEqual(look);
  });

  it('replaces anything out of range or malformed with defaults', () => {
    expect(sanitizeLook({ skin: 999, hat: -1, fur: 1.5, trail: '2' })).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook('crown')).toEqual(DEFAULT_LOOK);
  });

  it('catalog ids are unique (items are referenced by index, so only append)', () => {
    for (const list of [SKINS, HATS, FURS, TRAILS]) {
      expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
    }
  });
});
