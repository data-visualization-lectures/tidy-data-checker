import { describe, it, expect } from 'vitest';
import { toColLetter, toA1, rangeToA1 } from '../utils/cellRef';

describe('toColLetter', () => {
  it('should convert single digit columns', () => {
    expect(toColLetter(0)).toBe('A');
    expect(toColLetter(1)).toBe('B');
    expect(toColLetter(25)).toBe('Z');
  });

  it('should convert double letter columns', () => {
    expect(toColLetter(26)).toBe('AA');
    expect(toColLetter(27)).toBe('AB');
    expect(toColLetter(51)).toBe('AZ');
    expect(toColLetter(52)).toBe('BA');
  });

  it('should convert triple letter columns', () => {
    expect(toColLetter(702)).toBe('AAA');
  });
});

describe('toA1', () => {
  it('should convert to A1 notation', () => {
    expect(toA1(0, 0)).toBe('A1');
    expect(toA1(0, 1)).toBe('B1');
    expect(toA1(1, 0)).toBe('A2');
    expect(toA1(9, 25)).toBe('Z10');
  });

  it('should handle large indices', () => {
    expect(toA1(99, 26)).toBe('AA100');
  });
});

describe('rangeToA1', () => {
  it('should format single cell range', () => {
    expect(rangeToA1(0, 0, 0, 0)).toBe('A1');
    expect(rangeToA1(5, 3, 5, 3)).toBe('D6');
  });

  it('should format multi-cell range', () => {
    expect(rangeToA1(0, 0, 0, 2)).toBe('A1:C1');
    expect(rangeToA1(0, 0, 5, 0)).toBe('A1:A6');
    expect(rangeToA1(1, 1, 5, 5)).toBe('B2:F6');
  });
});
