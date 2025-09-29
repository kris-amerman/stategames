import { describe, expect, it } from 'vitest';
import { CANTON_FALLBACK_PREFIX } from './mapColors';
import { deriveCantonLabel } from './cantonLabels';

describe('deriveCantonLabel', () => {
  it('marks capital cantons with a crown when meta indicates capital', () => {
    const result = deriveCantonLabel({
      nationId: 'alpha',
      nationName: 'Aurora Dominion',
      cantonId: 'c1',
      cantonOrder: ['c1', 'c2'],
      cantonMeta: {
        c1: { capital: true },
        c2: { capital: false },
      },
    });

    expect(result).toEqual({
      label: '👑 Aurora Dominion Canton 1/2',
      index: 1,
      total: 2,
      isCapital: true,
    });
  });

  it('falls back to order-based capital when meta is missing', () => {
    const result = deriveCantonLabel({
      nationId: 'beta',
      nationName: 'Silverhaven',
      cantonId: 'c2',
      cantonOrder: ['c1', 'c2', 'c3'],
    });

    expect(result).toEqual({
      label: 'Silverhaven Canton 2/3',
      index: 2,
      total: 3,
      isCapital: false,
    });
  });

  it('adds missing cantons deterministically', () => {
    const result = deriveCantonLabel({
      nationId: 'gamma',
      nationName: 'Stormfall Republic',
      cantonId: 'c4',
      cantonOrder: ['c2', 'c3'],
      cantonMeta: {
        c2: { capital: true },
        c4: { capital: false },
      },
    });

    expect(result).toEqual({
      label: 'Stormfall Republic Canton 3/3',
      index: 3,
      total: 3,
      isCapital: false,
    });
  });

  it('ignores fallback canton IDs and leaves real totals unchanged', () => {
    const cantonOrder = ['c1', 'c2'];
    const fallbackId = `${CANTON_FALLBACK_PREFIX}alpha`;

    const fallbackResult = deriveCantonLabel({
      nationId: 'alpha',
      nationName: 'Coastwatch Alliance',
      cantonId: fallbackId,
      cantonOrder,
      cantonMeta: {
        c1: { capital: true },
        c2: { capital: false },
      },
    });

    expect(fallbackResult).toBeNull();

    const realResult = deriveCantonLabel({
      nationId: 'alpha',
      nationName: 'Coastwatch Alliance',
      cantonId: 'c2',
      cantonOrder,
      cantonMeta: {
        c1: { capital: true },
        c2: { capital: false },
      },
    });

    expect(realResult).toEqual({
      label: 'Coastwatch Alliance Canton 2/2',
      index: 2,
      total: 2,
      isCapital: false,
    });
  });

  it('falls back to nation id when name is empty', () => {
    const result = deriveCantonLabel({
      nationId: 'delta',
      nationName: '   ',
      cantonId: 'c1',
      cantonOrder: ['c1'],
      cantonMeta: { c1: { capital: true } },
    });

    expect(result).toEqual({
      label: '👑 delta Canton 1/1',
      index: 1,
      total: 1,
      isCapital: true,
    });
  });
});
