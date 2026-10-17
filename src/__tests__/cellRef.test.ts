import { describe, it, expect } from 'vitest';
import {
  toColLetter,
  toA1,
  rangeToA1,
  formatRowList,
  formatColList,
  cellsToRanges,
} from '../utils/cellRef';

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

describe('formatRowList', () => {
  it('should convert 0-based rows to 1-based row numbers', () => {
    expect(formatRowList([1, 6, 7])).toBe('行 2, 7, 8');
    expect(formatRowList([0])).toBe('行 1');
  });

  it('should summarize rows beyond max', () => {
    const rows = [1, 6, 7, ...Array.from({ length: 12 }, (_, i) => 20 + i)];
    expect(formatRowList(rows, 3)).toBe('行 2, 7, 8 ほか 12 行');
  });

  it('should show up to 10 rows by default', () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(formatRowList(ten)).toBe('行 1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
    expect(formatRowList([...ten, 10])).toBe('行 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ほか 1 行');
  });

  it('should sort and deduplicate rows', () => {
    expect(formatRowList([7, 1, 6, 1])).toBe('行 2, 7, 8');
  });

  it('should return an empty string for no rows', () => {
    expect(formatRowList([])).toBe('');
  });
});

describe('formatColList', () => {
  it('should convert 0-based columns to letters', () => {
    expect(formatColList([1, 3])).toBe('列 B, D');
    expect(formatColList([26, 0])).toBe('列 A, AA');
  });

  it('should summarize columns beyond max', () => {
    expect(formatColList([0, 1, 2, 3, 4], 2)).toBe('列 A, B ほか 3 列');
    const eleven = Array.from({ length: 11 }, (_, i) => i);
    expect(formatColList(eleven)).toBe('列 A, B, C, D, E, F, G, H, I, J ほか 1 列');
  });

  it('should return an empty string for no columns', () => {
    expect(formatColList([])).toBe('');
  });
});

describe('cellsToRanges', () => {
  it('should merge vertically consecutive cells in the same column', () => {
    expect(cellsToRanges([
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 3, col: 2 },
    ])).toEqual([{ startRow: 1, startCol: 2, endRow: 3, endCol: 2 }]);
  });

  it('should split at gaps and keep columns separate', () => {
    expect(cellsToRanges([
      { row: 1, col: 1 },
      { row: 2, col: 1 },
      { row: 4, col: 1 },
      { row: 1, col: 2 },
    ])).toEqual([
      { startRow: 1, startCol: 1, endRow: 2, endCol: 1 },
      { startRow: 1, startCol: 2, endRow: 1, endCol: 2 },
      { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
    ]);
  });

  it('should not merge horizontally adjacent cells', () => {
    expect(cellsToRanges([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ])).toEqual([
      { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
      { startRow: 1, startCol: 2, endRow: 1, endCol: 2 },
    ]);
  });

  it('should accept unsorted and duplicated cells and put the top-left range first', () => {
    expect(cellsToRanges([
      { row: 5, col: 2 },
      { row: 3, col: 0 },
      { row: 4, col: 2 },
      { row: 5, col: 2 },
      { row: 2, col: 3 },
    ])).toEqual([
      { startRow: 2, startCol: 3, endRow: 2, endCol: 3 },
      { startRow: 3, startCol: 0, endRow: 3, endCol: 0 },
      { startRow: 4, startCol: 2, endRow: 5, endCol: 2 },
    ]);
  });

  it('should return no ranges for no cells', () => {
    expect(cellsToRanges([])).toEqual([]);
  });
});
