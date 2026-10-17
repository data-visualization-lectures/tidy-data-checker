import type { CellRange } from '../types';

export function toColLetter(col: number): string {
  let s = '';
  let c = col + 1;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

export function toA1(row: number, col: number): string {
  return `${toColLetter(col)}${row + 1}`;
}

export function rangeToA1(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): string {
  const start = toA1(startRow, startCol);
  const end = toA1(endRow, endCol);
  if (start === end) {
    return start;
  }
  return `${start}:${end}`;
}

function formatIndexList(
  unit: string,
  indices: number[],
  max: number,
  label: (index: number) => string
): string {
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const shown = sorted.slice(0, max).map(label).join(', ');
  const rest = sorted.length - max;
  return rest > 0 ? `${unit} ${shown} ほか ${rest} ${unit}` : `${unit} ${shown}`;
}

/** 0始まりの行番号 → "行 2, 7, 8"。max 件を超えたら "行 2, 7, 8 ほか 12 行" */
export function formatRowList(rows: number[], max: number = 10): string {
  return formatIndexList('行', rows, max, row => String(row + 1));
}

/** 0始まりの列番号 → "列 B, D"（toColLetter を使う） */
export function formatColList(cols: number[], max: number = 10): string {
  return formatIndexList('列', cols, max, toColLetter);
}

/** 同じ列で縦に連続するセルを1つの CellRange にまとめる */
export function cellsToRanges(cells: Array<{ row: number; col: number }>): CellRange[] {
  const sorted = [...cells].sort((a, b) => a.col - b.col || a.row - b.row);
  const ranges: CellRange[] = [];
  let current: CellRange | null = null;

  for (const { row, col } of sorted) {
    if (current && current.startCol === col && row <= current.endRow + 1) {
      current.endRow = Math.max(current.endRow, row);
      continue;
    }
    current = { startRow: row, startCol: col, endRow: row, endCol: col };
    ranges.push(current);
  }

  // DataGrid は ranges[0] へスクロールするので、左上の範囲を先頭にする
  return ranges.sort((a, b) => a.startRow - b.startRow || a.startCol - b.startCol);
}
