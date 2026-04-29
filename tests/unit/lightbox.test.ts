import { describe, it, expect } from 'vitest';
import { getFitScale, computeNextScale } from '../../src/utils/lightbox';

describe('lightbox utils', () => {
  describe('getFitScale', () => {
    it('returns 1 when dimensions are zero', () => {
      expect(getFitScale(0, 100, 1920, 1080)).toBe(1);
      expect(getFitScale(100, 0, 1920, 1080)).toBe(1);
      expect(getFitScale(0, 0, 1920, 1080)).toBe(1);
    });

    it('scales to fit width when image is wider than viewport', () => {
      expect(getFitScale(4000, 1000, 1920, 1080)).toBe(1920 / 4000);
    });

    it('scales to fit height when image is taller than viewport', () => {
      expect(getFitScale(1000, 4000, 1920, 1080)).toBe(1080 / 4000);
    });

    it('scales up when image is smaller than viewport', () => {
      // viewport height is the limiting dimension here
      expect(getFitScale(500, 500, 1920, 1080)).toBe(1080 / 500);
    });
  });

  describe('computeNextScale', () => {
    it('zooms in', () => {
      expect(computeNextScale(1, true, 0.1, 0.05, 5)).toBeCloseTo(1.1, 5);
    });

    it('zooms out', () => {
      expect(computeNextScale(1, false, 0.1, 0.05, 5)).toBeCloseTo(0.9, 5);
    });

    it('respects max bound', () => {
      expect(computeNextScale(4.9, true, 0.1, 0.05, 5)).toBe(5);
      expect(computeNextScale(5, true, 0.1, 0.05, 5)).toBe(5);
    });

    it('respects min bound', () => {
      expect(computeNextScale(0.05, false, 0.1, 0.05, 5)).toBe(0.05);
      expect(computeNextScale(0.04, false, 0.1, 0.05, 5)).toBe(0.05);
    });

    it('handles multiple consecutive zooms', () => {
      let scale = 1;
      scale = computeNextScale(scale, true, 0.1, 0.05, 5);
      scale = computeNextScale(scale, true, 0.1, 0.05, 5);
      expect(scale).toBeCloseTo(1.21, 5);
    });
  });
});
