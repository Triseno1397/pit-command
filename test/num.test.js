import { describe, it, expect } from 'vitest';
import { num, f1, f2, avgTemp } from '../src/num.js';

describe('num() — what a crew actually writes on a tire sheet', () => {
  it('reads plain decimals and integers', () => {
    expect(num('88')).toBe(88);
    expect(num('88.25')).toBe(88.25);
    expect(num('12.5')).toBe(12.5);
    expect(num(' 24 ')).toBe(24);
    expect(num(88.25)).toBe(88.25);
  });

  it('reads space-separated mixed fractions', () => {
    expect(num('88 1/4')).toBe(88.25);
    expect(num('87 1/2')).toBe(87.5);
    expect(num('88 3/4')).toBe(88.75);
    expect(num('88  1 / 4')).toBe(88.25);
  });

  it('reads hyphenated mixed fractions', () => {
    expect(num('88-1/4')).toBe(88.25);
    expect(num('87-1/2')).toBe(87.5);
  });

  it('reads a bare fraction', () => {
    expect(num('1/2')).toBe(0.5);
    expect(num('3/4')).toBe(0.75);
  });

  it('handles negatives', () => {
    expect(num('-2')).toBe(-2);
    expect(num('-1 1/2')).toBe(-1.5);
  });

  it('returns null for empty / non-numeric input rather than NaN', () => {
    expect(num('')).toBeNull();
    expect(num('   ')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('abc')).toBeNull();
  });

  it('does not divide by zero', () => {
    expect(num('88 1/0')).toBe(88);
  });

  it('falls back to parseFloat for values the fraction pattern rejects', () => {
    expect(num('88psi')).toBe(88);
  });
});

describe('formatters', () => {
  it('f1 rounds to one decimal and shows an em dash for null', () => {
    expect(f1(12.34)).toBe('12.3');
    expect(f1(12)).toBe('12');
    expect(f1(null)).toBe('—');
  });
  it('f2 rounds to two decimals', () => {
    expect(f2(1.239)).toBe('1.24');
    expect(f2(null)).toBe('—');
  });
});

describe('avgTemp', () => {
  it('averages the readings that are present', () => {
    expect(avgTemp({ ti: '200', tm: '210', to: '220' })).toBe(210);
    expect(avgTemp({ ti: '200', tm: '', to: '220' })).toBe(210);
  });
  it('is null when nothing was recorded', () => {
    expect(avgTemp({ ti: '', tm: '', to: '' })).toBeNull();
  });
  it('honours fractions in temps', () => {
    expect(avgTemp({ ti: '200 1/2', tm: '', to: '' })).toBe(200.5);
  });
});
