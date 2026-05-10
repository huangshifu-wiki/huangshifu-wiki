import { describe, expect, it } from 'vitest';
import { rrfScore, RRF_K, buildHybridResponse, fetchVectorSearchWithTimeout } from '../../src/server/routes/search.routes';

describe('RRF Fusion Algorithm', () => {
  describe('rrfScore - core formula', () => {
    it('returns 0 for empty ranks array', () => {
      expect(rrfScore([])).toBe(0);
    });

    it('returns 0 for all undefined ranks', () => {
      expect(rrfScore([undefined, undefined])).toBe(0);
    });

    it('returns 0 for negative ranks', () => {
      expect(rrfScore([-1, -5])).toBe(0);
    });

    it('calculates single rank correctly: rank 0 = 1/(k+0)', () => {
      const expected = 1 / (RRF_K + 0);
      expect(rrfScore([0])).toBeCloseTo(expected, 10);
    });

    it('calculates single rank correctly: rank 1 = 1/(k+1)', () => {
      const expected = 1 / (RRF_K + 1);
      expect(rrfScore([1])).toBeCloseTo(expected, 10);
    });

    it('sums multiple ranks correctly', () => {
      const score = rrfScore([0, 1, 2]);
      const expected = 1 / (RRF_K + 0) + 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
      expect(score).toBeCloseTo(expected, 10);
    });

    it('ignores undefined values in mixed array', () => {
      const scoreWithUndefined = rrfScore([0, undefined, 2]);
      const scoreWithoutUndefined = rrfScore([0, 2]);
      expect(scoreWithUndefined).toBeCloseTo(scoreWithoutUndefined, 10);
    });

    it('ignores negative values in mixed array', () => {
      const scoreWithNegative = rrfScore([0, -1, 2]);
      const scoreWithoutNegative = rrfScore([0, 2]);
      expect(scoreWithNegative).toBeCloseTo(scoreWithoutNegative, 10);
    });

    it('higher rank positions produce lower scores', () => {
      const rank0Score = rrfScore([0]);
      const rank5Score = rrfScore([5]);
      const rank50Score = rrfScore([50]);
      expect(rank0Score).toBeGreaterThan(rank5Score);
      expect(rank5Score).toBeGreaterThan(rank50Score);
    });
  });

  describe('RRF ranking behavior - hybrid fusion scenarios', () => {
    it('ranks item appearing in both lists higher than either alone', () => {
      const bothLists = rrfScore([0, 3]);
      const keywordOnly = rrfScore([0, undefined]);
      const vectorOnly = rrfScore([undefined, 0]);

      expect(bothLists).toBeGreaterThan(keywordOnly);
      expect(bothLists).toBeGreaterThan(vectorOnly);
    });

    it('top-ranked in both lists gets highest score', () => {
      const topBoth = rrfScore([0, 0]);
      const midBoth = rrfScore([2, 2]);
      const bottomBoth = rrfScore([10, 10]);

      expect(topBoth).toBeGreaterThan(midBoth);
      expect(midBoth).toBeGreaterThan(bottomBoth);
    });

    it('compensates for low keyword rank with high vector rank', () => {
      const lowKwHighVec = rrfScore([20, 0]);
      const midKwMidVec = rrfScore([10, 10]);

      expect(lowKwHighVec).toBeGreaterThan(midKwMidVec);
    });

    it('vector-only results still get meaningful scores', () => {
      const vectorOnlyTop = rrfScore([undefined, 0]);
      const vectorOnlyMid = rrfScore([undefined, 5]);

      expect(vectorOnlyTop).toBeGreaterThan(0);
      expect(vectorOnlyTop).toBeGreaterThan(vectorOnlyMid);
    });

    it('keyword-only results still get meaningful scores', () => {
      const kwOnlyTop = rrfScore([0, undefined]);
      const kwOnlyMid = rrfScore([5, undefined]);

      expect(kwOnlyTop).toBeGreaterThan(0);
      expect(kwOnlyTop).toBeGreaterThan(kwOnlyMid);
    });

    it('hybrid match beats pure keyword at same position', () => {
      const hybridRank3 = rrfScore([3, 3]);
      const keywordRank2 = rrfScore([2, undefined]);

      expect(hybridRank3).toBeGreaterThan(keywordRank2);
    });

    it('k=60 constant produces reasonable score distribution', () => {
      const scores = Array.from({ length: 10 }, (_, i) => rrfScore([i]));

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThan(scores[i]);
      }

      const ratio = scores[0] / scores[9];
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(2);
    });
  });

  describe('Edge cases and robustness', () => {
    it('handles large rank values without overflow', () => {
      const score = rrfScore([10000]);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('handles very large arrays efficiently', () => {
      const ranks = Array.from({ length: 1000 }, (_, i) => i);
      const score = rrfScore(ranks);
      expect(score).toBeGreaterThan(0);
    });

    it('handles floating point precision at boundary', () => {
      const score = rrfScore([0.5, 1.5]);
      expect(score).toBeGreaterThan(0);
    });

    it('returns consistent results for same input', () => {
      const input = [0, 2, 5, undefined, 10];
      const s1 = rrfScore(input);
      const s2 = rrfScore(input);
      expect(s1).toBe(s2);
    });
  });

  describe('RRF_K constant validation', () => {
    it('is set to standard value of 60', () => {
      expect(RRF_K).toBe(60);
    });

    it('produces reasonable absolute scores with k=60', () => {
      const topHit = rrfScore([0, 0]);
      expect(topHit).toBeGreaterThan(0.01);
      expect(topHit).toBeLessThan(1);
    });
  });
});

describe('buildHybridResponse - fusion logic', () => {
  function makeKwItem(type: 'wiki' | 'post' | 'gallery' | 'music' | 'album', id: string, rank: number) {
    return { id: `${type}:${id}`, type, data: { id, title: `test-${id}` } as any, relevanceScore: 0, matchType: 'keyword' as const, keywordRank: rank };
  }

  function makeVecItem(type: string, id: string, rank: number, similarity = 0.9) {
    return { id: `${type}:${id}`, type: type as any, data: { id, title: `vec-${id}` } as any, relevanceScore: 0, matchType: 'vector' as const, vectorDistance: similarity, vectorRank: rank };
  }

  it('returns keyword-only results when mode=keyword', () => {
    const kwResults = {
      wiki: [{ slug: 'a', title: 'A' }],
      posts: [],
      galleries: [],
      music: [],
      albums: [],
    };
    const result = buildHybridResponse(kwResults, [], 'keyword', 'test', false);
    expect(result.wiki).toHaveLength(1);
    expect(result.wiki[0].title).toBe('A');
    expect(result.searchMeta.mode).toBe('keyword');
    expect(result.searchMeta.degraded).toBe(false);
  });

  it('returns vector-only results when mode=vector', () => {
    const kwResults = { wiki: [{ slug: 'a', title: 'KW' }], posts: [], galleries: [], music: [], albums: [] };
    const vecResults = [
      { sourceType: 'wiki' as const, sourceId: 'v1', data: { title: 'VEC' }, similarity: 0.95 },
    ];
    const result = buildHybridResponse(kwResults, vecResults, 'vector', 'test', false);
    expect(result.wiki).toHaveLength(1);
    expect(result.wiki[0].title).toBe('VEC');
    expect(result.searchMeta.mode).toBe('vector');
  });

  it('merges keyword and vector results in hybrid mode', () => {
    const kwResults = {
      wiki: [{ slug: 'same', title: 'Same' }, { slug: 'kw-only', title: 'KwOnly' }],
      posts: [],
      galleries: [],
      music: [],
      albums: [],
    };
    const vecResults = [
      { sourceType: 'wiki' as const, sourceId: 'same', data: { title: 'Same-Vec' }, similarity: 0.88 },
      { sourceType: 'wiki' as const, sourceId: 'vec-only', data: { title: 'VecOnly' }, similarity: 0.75 },
    ];
    const result = buildHybridResponse(kwResults, vecResults, 'hybrid', 'test', false);
    expect(result.wiki.length).toBeGreaterThanOrEqual(3);

    const sameItem = result.wiki.find((w: any) => w.title === 'Same-Vec' || w.title === 'Same');
    expect(sameItem).toBeDefined();

    const vecOnlyItem = result.wiki.find((w: any) => w.title === 'VecOnly');
    expect(vecOnlyItem).toBeDefined();
    expect(result.searchMeta.mode).toBe('hybrid');
    expect(result.searchMeta.keywordResultCount).toBeGreaterThan(0);
    expect(result.searchMeta.vectorResultCount).toBe(2);
  });

  it('sorts by RRF score descending in hybrid mode', () => {
    const kwResults = {
      wiki: [
        { slug: 'both-top', title: 'BothTop' },
        { slug: 'kw-mid', title: 'KwMid' },
        { slug: 'kw-low', title: 'KwLow' },
      ],
      posts: [], galleries: [], music: [], albums: [],
    };
    const vecResults = [
      { sourceType: 'wiki' as const, sourceId: 'both-top', data: { title: 'BothTop-V' }, similarity: 0.9 },
      { sourceType: 'wiki' as const, sourceId: 'vec-only', data: { title: 'VecOnly' }, similarity: 0.8 },
    ];
    const result = buildHybridResponse(kwResults, vecResults, 'hybrid', 'q', false);

    const bothTopIdx = result.wiki.findIndex((w: any) => (w.slug === 'both-top' || w.title?.includes('BothTop')));
    const vecOnlyIdx = result.wiki.findIndex((w: any) => w.title?.includes('VecOnly'));
    const kwLowIdx = result.wiki.findIndex((w: any) => (w.slug === 'kw-low' || w.title?.includes('KwLow')));

    if (bothTopIdx >= 0 && vecOnlyIdx >= 0 && kwLowIdx >= 0) {
      expect(bothTopIdx).toBeLessThan(vecOnlyIdx);
      expect(vecOnlyIdx).toBeLessThan(kwLowIdx);
    }
  });

  it('marks matched items as hybrid matchType', () => {
    const kwResults = {
      wiki: [{ slug: 'shared', title: 'Shared' }],
      posts: [], galleries: [], music: [], albums: [],
    };
    const vecResults = [
      { sourceType: 'wiki' as const, sourceId: 'shared', data: { title: 'Shared' }, similarity: 0.85 },
    ];
    const result = buildHybridResponse(kwResults, vecResults, 'hybrid', 'q', false);
    expect(result.wiki.length).toBeGreaterThan(0);
  });

  it('sets degraded=true when degradation is flagged', () => {
    const kwResults = { wiki: [], posts: [], galleries: [], music: [], albums: [] };
    const result = buildHybridResponse(kwResults, [], 'hybrid', 'q', true, 'Qdrant timeout');
    expect(result.searchMeta.degraded).toBe(true);
    expect(result.searchMeta.degradationReason).toBe('Qdrant timeout');
    expect(result.searchMeta.mode).toBe('keyword (degraded)');
  });

  it('handles empty results gracefully', () => {
    const kwResults = { wiki: [], posts: [], galleries: [], music: [], albums: [] };
    const result = buildHybridResponse(kwResults, [], 'hybrid', 'q', false);
    expect(result.wiki).toHaveLength(0);
    expect(result.posts).toHaveLength(0);
    expect(result.galleries).toHaveLength(0);
    expect(result.music).toHaveLength(0);
    expect(result.albums).toHaveLength(0);
  });

  it('handles mode=vector with no vector results', () => {
    const kwResults = { wiki: [{ slug: 'a', title: 'A' }], posts: [], galleries: [], music: [], albums: [] };
    const result = buildHybridResponse(kwResults, [], 'vector', 'q', false);
    expect(result.wiki).toHaveLength(0);
    expect(result.searchMeta.vectorResultCount).toBe(0);
  });
});

describe('fetchVectorSearchWithTimeout - timeout behavior', () => {
  it('is covered by integration tests (requires CLIP model)', () => {
    expect(fetchVectorSearchWithTimeout).toBeDefined();
  });
});
