import type { MergedCell } from '../types';

export function adjustMergedCellsForDeletedRows(
  mergedCells: MergedCell[],
  deletedRows: number[]
): MergedCell[] {
  if (!mergedCells || mergedCells.length === 0 || deletedRows.length === 0) {
    return mergedCells;
  }

  const sortedDeletedRows = [...deletedRows].sort((a, b) => a - b);
  const deletedSet = new Set(sortedDeletedRows);

  return mergedCells
    .map(mc => {
      for (let r = mc.startRow; r <= mc.endRow; r++) {
        if (deletedSet.has(r)) {
          return null;
        }
      }

      let rowOffset = 0;
      for (const deletedRow of sortedDeletedRows) {
        if (deletedRow < mc.startRow) {
          rowOffset++;
        }
      }

      return {
        ...mc,
        startRow: mc.startRow - rowOffset,
        endRow: mc.endRow - rowOffset,
      };
    })
    .filter((mc): mc is MergedCell => mc !== null);
}

export function adjustMergedCellsForDeletedCols(
  mergedCells: MergedCell[],
  deletedCols: number[]
): MergedCell[] {
  if (!mergedCells || mergedCells.length === 0 || deletedCols.length === 0) {
    return mergedCells;
  }

  const sortedDeletedCols = [...deletedCols].sort((a, b) => a - b);
  const deletedSet = new Set(sortedDeletedCols);

  return mergedCells
    .map(mc => {
      for (let c = mc.startCol; c <= mc.endCol; c++) {
        if (deletedSet.has(c)) {
          return null;
        }
      }

      let colOffset = 0;
      for (const deletedCol of sortedDeletedCols) {
        if (deletedCol < mc.startCol) {
          colOffset++;
        }
      }

      return {
        ...mc,
        startCol: mc.startCol - colOffset,
        endCol: mc.endCol - colOffset,
      };
    })
    .filter((mc): mc is MergedCell => mc !== null);
}
