import type { Table, Fix } from '../types';

export interface CellEdit { row: number; col: number; value: string }

/** 純粋関数。編集する行だけコピーし、列が足りない行は '' で埋める（表にない行への編集は無視する） */
export function applyCellEdits(table: Table, edits: CellEdit[]): Table {
  const result = table.slice();
  const copiedRows = new Set<number>();

  for (const { row, col, value } of edits) {
    if (row < 0 || row >= result.length || col < 0) continue;
    if (!copiedRows.has(row)) {
      result[row] = result[row].slice();
      copiedRows.add(row);
    }
    const cells = result[row];
    while (cells.length < col) {
      cells.push('');
    }
    cells[col] = value;
  }

  return result;
}

export function createCellEditFix(description: string, edits: CellEdit[]): Fix {
  return {
    description,
    apply: (table: Table): Table => applyCellEdits(table, edits),
  };
}
