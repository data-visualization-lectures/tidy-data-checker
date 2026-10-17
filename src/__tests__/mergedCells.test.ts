import { describe, it, expect } from 'vitest';
import { adjustMergedCellsForDeletedRows, adjustMergedCellsForDeletedCols } from '../utils/mergedCells';
import type { MergedCell } from '../types';

describe('adjustMergedCellsForDeletedRows', () => {
  it('should return same cells when no deletions', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 0, startCol: 0, endRow: 0, endCol: 4 },
      { startRow: 5, startCol: 2, endRow: 7, endCol: 3 },
    ];

    const result = adjustMergedCellsForDeletedRows(mergedCells, []);
    expect(result).toEqual(mergedCells);
  });

  it('should return empty array when no merged cells', () => {
    const result = adjustMergedCellsForDeletedRows([], [1, 2, 3]);
    expect(result).toEqual([]);
  });

  it('should remove cells that are entirely within deleted rows', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 2, startCol: 0, endRow: 2, endCol: 4 },
      { startRow: 5, startCol: 0, endRow: 5, endCol: 4 },
    ];

    const result = adjustMergedCellsForDeletedRows(mergedCells, [2, 5]);
    expect(result).toEqual([]);
  });

  it('should remove cells that partially overlap deleted rows', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 2, startCol: 0, endRow: 4, endCol: 4 },
    ];

    const result = adjustMergedCellsForDeletedRows(mergedCells, [3]);
    expect(result).toEqual([]);
  });

  it('should adjust row indices for cells after deleted rows', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 0, startCol: 0, endRow: 0, endCol: 4 },
      { startRow: 10, startCol: 2, endRow: 10, endCol: 3 },
    ];

    const result = adjustMergedCellsForDeletedRows(mergedCells, [2, 5, 8]);
    expect(result).toEqual([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 4 },
      { startRow: 7, startCol: 2, endRow: 7, endCol: 3 },
    ]);
  });

  it('should handle multi-row merged cells that survive deletion', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 5, startCol: 0, endRow: 7, endCol: 2 },
    ];

    const result = adjustMergedCellsForDeletedRows(mergedCells, [0, 1, 2]);
    expect(result).toEqual([
      { startRow: 2, startCol: 0, endRow: 4, endCol: 2 },
    ]);
  });

  it('should handle unsorted deleted rows', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 10, startCol: 0, endRow: 10, endCol: 4 },
    ];

    const result = adjustMergedCellsForDeletedRows(mergedCells, [5, 2, 8]);
    expect(result).toEqual([
      { startRow: 7, startCol: 0, endRow: 7, endCol: 4 },
    ]);
  });
});

describe('adjustMergedCellsForDeletedCols', () => {
  it('should return same cells when no deletions', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 0, startCol: 0, endRow: 0, endCol: 4 },
      { startRow: 5, startCol: 2, endRow: 7, endCol: 3 },
    ];

    const result = adjustMergedCellsForDeletedCols(mergedCells, []);
    expect(result).toEqual(mergedCells);
  });

  it('should remove cells that are entirely within deleted cols', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 0, startCol: 2, endRow: 5, endCol: 2 },
      { startRow: 0, startCol: 5, endRow: 5, endCol: 5 },
    ];

    const result = adjustMergedCellsForDeletedCols(mergedCells, [2, 5]);
    expect(result).toEqual([]);
  });

  it('should adjust col indices for cells after deleted cols', () => {
    const mergedCells: MergedCell[] = [
      { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
      { startRow: 0, startCol: 5, endRow: 5, endCol: 6 },
    ];

    const result = adjustMergedCellsForDeletedCols(mergedCells, [2, 3]);
    expect(result).toEqual([
      { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
      { startRow: 0, startCol: 3, endRow: 5, endCol: 4 },
    ]);
  });
});
