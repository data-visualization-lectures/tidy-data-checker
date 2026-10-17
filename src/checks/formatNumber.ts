import type { Check, Finding, Table, CheckContext } from '../types';
import { getDataRegion, isDataRow, type DataRegion } from '../utils/dataRegion';
import { cellsToRanges } from '../utils/cellRef';
import { createCellEditFix, type CellEdit } from '../utils/cellEdit';
import {
  classifyColumns,
  parseNumericCell,
  toHalfWidth,
  type ColumnKind,
  type ParsedNumber,
} from '../utils/values';

interface NumericCell {
  row: number;
  col: number;
  raw: string;
  parsed: ParsedNumber;
}

// カンマの直後に数字が3つあるところだけ消す。単位や全角はそのまま残る。
const THOUSANDS_SEPARATOR_RE = /[,，](?=[0-9０-９]{3})/g;

function collectNumericCells(table: Table, region: DataRegion, kinds: ColumnKind[]): NumericCell[] {
  const cells: NumericCell[] = [];

  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (!isDataRow(table, row, region)) continue;
    const rowCells = table[row];
    for (let col = 0; col < region.maxCols; col++) {
      const kind = kinds[col];
      if (kind !== 'numeric' && kind !== 'code') continue;
      const raw = rowCells?.[col] ?? '';
      if (raw.trim() === '') continue;
      const parsed = parseNumericCell(raw);
      if (!parsed) continue;
      cells.push({ row, col, raw, parsed });
    }
  }

  return cells;
}

function uniqueCols(cells: Array<{ col: number }>): number[] {
  return Array.from(new Set(cells.map(cell => cell.col))).sort((a, b) => a - b);
}

function stripThousandsSeparators(raw: string): string {
  return raw.replace(THOUSANDS_SEPARATOR_RE, '');
}

export const formatNumberCheck: Check = {
  id: 'format-number',
  title: '全角数字・桁区切り・単位',
  description: '全角数字→半角、桁区切り除去、単位分離で数値として扱えるようにします。',

  detect: (table: Table, _ctx: CheckContext): Finding[] => {
    const region = getDataRegion(table);
    const kinds = classifyColumns(table, region);
    const cells = collectNumericCells(table, region, kinds);
    const findings: Finding[] = [];

    // 単位（見出しへの移動・倍率の統一・混在の info）は U4-08。
    const fullwidth = cells.filter(cell => cell.parsed.hasFullWidth || cell.parsed.hasPadding);
    if (fullwidth.length > 0) {
      const edits: CellEdit[] = fullwidth.map(cell => ({
        row: cell.row,
        col: cell.col,
        value: toHalfWidth(cell.raw.trim()),
      }));
      findings.push({
        checkId: 'format-number',
        severity: 'warning',
        ranges: cellsToRanges(fullwidth),
        message: `${fullwidth.length} 個のセルに全角の数字や前後の空白があります（例: 「${fullwidth[0].raw}」）。半角にそろえると数値として読み込めます。`,
        fix: createCellEditFix(`全角数字を半角にする（${fullwidth.length} セル）`, edits),
        metadata: { kind: 'fullwidth', count: fullwidth.length, cols: uniqueCols(fullwidth) },
      });
    }

    const separators = cells.filter(cell => kinds[cell.col] === 'numeric' && cell.parsed.hasSeparator);
    if (separators.length > 0) {
      const edits: CellEdit[] = separators.map(cell => ({
        row: cell.row,
        col: cell.col,
        value: stripThousandsSeparators(cell.raw),
      }));
      findings.push({
        checkId: 'format-number',
        severity: 'warning',
        ranges: cellsToRanges(separators),
        message: `${separators.length} 個のセルに桁区切りのカンマがあります（例: 「${separators[0].raw}」）。CSV ではカンマが区切り文字と紛らわしく、数値ではなく文字として読まれる原因になります。`,
        fix: createCellEditFix(`桁区切りを除去（${separators.length} セル）`, edits),
        metadata: { kind: 'separator', count: separators.length, cols: uniqueCols(separators) },
      });
    }

    if (findings.length === 0) {
      findings.push({
        checkId: 'format-number',
        severity: 'info',
        ranges: [],
        message: '全角数字・桁区切り・単位の問題は見つかりませんでした。',
      });
    }

    return findings;
  },
};
