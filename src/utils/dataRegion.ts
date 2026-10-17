import type { Table } from '../types';
import { findDataStartRow, findDataEndRow } from '../checks/titleNotes';
import { analyzeHeaders } from '../checks/multiHeader';

export interface DataRegion {
  headerRows: number[];  // 見出し行（多段なら上から順に。必ず1行以上）
  headerRow: number;     // 見出しの最下段（列名として扱う行）
  firstDataRow: number;  // 最初のデータ行
  lastDataRow: number;   // 最後のデータ行（この行を含む）。データがなければ firstDataRow - 1
  maxCols: number;
}

export function getDataRegion(table: Table): DataRegion {
  const start = findDataStartRow(table);
  const count = Math.max(1, analyzeHeaders(table.slice(start)).headerRows.length);
  const headerRows = Array.from({ length: count }, (_, i) => start + i);
  const headerRow = start + count - 1;

  return {
    headerRows,
    headerRow,
    firstDataRow: headerRow + 1,
    lastDataRow: Math.max(findDataEndRow(table), headerRow),
    maxCols: table.reduce((max, row) => Math.max(max, row.length), 0),
  };
}

/** firstDataRow〜lastDataRow の範囲にあり、空行でない行 */
export function isDataRow(table: Table, row: number, region: DataRegion): boolean {
  if (row < region.firstDataRow || row > region.lastDataRow) return false;
  const cells = table[row];
  return cells !== undefined && cells.some(cell => cell.trim() !== '');
}

/** 見出しの各段を上から "_" でつないだ列名（multiHeader の flattenHeaders と同じ規則。空なら `列${col + 1}`） */
export function getColumnLabel(table: Table, col: number, region: DataRegion): string {
  const parts: string[] = [];
  for (const row of region.headerRows) {
    const cell = table[row]?.[col]?.trim() || '';
    if (cell && !parts.includes(cell)) {
      parts.push(cell);
    }
  }
  return parts.join('_') || `列${col + 1}`;
}
