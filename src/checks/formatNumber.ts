import type { Check, Finding, Table, CheckContext } from '../types';
import { getColumnLabel, getDataRegion, isDataRow, type DataRegion } from '../utils/dataRegion';
import { cellsToRanges, formatColList, toColLetter } from '../utils/cellRef';
import { createCellEditFix, type CellEdit } from '../utils/cellEdit';
import {
  classifyColumns,
  parseNumericCell,
  shiftDecimal,
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

type ColumnUnitDecision =
  | { mode: 'strip'; unitLabel: string }
  | { mode: 'normalize'; unit: string }
  | { mode: 'mixed'; units: string[] };

const MULTIPLIER_EXPONENT: Record<Exclude<ParsedNumber['multiplier'], ''>, number> = {
  千: 3,
  万: 4,
  億: 8,
  兆: 12,
};

function decideColumnUnit(cells: NumericCell[]): ColumnUnitDecision | null {
  const attached = cells.filter(cell => cell.parsed.multiplier !== '' || cell.parsed.unit !== '');
  if (attached.length === 0) return null;

  const units: string[] = [];
  for (const cell of attached) {
    const unit = cell.parsed.unit;
    if (unit !== '' && !units.includes(unit)) units.push(unit);
  }
  if (units.length >= 2) return { mode: 'mixed', units };

  const unit = units[0] ?? '';
  const labels: string[] = [];
  for (const cell of attached) {
    const label = `${cell.parsed.multiplier}${cell.parsed.unit || unit}`;
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length === 1) return { mode: 'strip', unitLabel: labels[0] };
  return { mode: 'normalize', unit };
}

function headerWithUnit(header: string, unitLabel: string): string {
  if (unitLabel === '') return header;
  const full = `（${unitLabel}）`;
  const half = `(${unitLabel})`;
  if (header.includes(full) || header.includes(half)) return header;
  return `${header}${full}`;
}

function planHeader(
  table: Table,
  col: number,
  region: DataRegion,
  unitLabel: string,
): { row: number; next: string; changed: boolean } {
  let row = region.headerRow;
  let current = table[row]?.[col] ?? '';
  for (let i = region.headerRows.length - 1; i >= 0; i--) {
    const headerRow = region.headerRows[i];
    const cell = table[headerRow]?.[col] ?? '';
    if (cell.trim() !== '') {
      row = headerRow;
      current = cell;
      break;
    }
  }

  const label = getColumnLabel(table, col, region);
  const shown = current.trim() !== '' ? current.trim() : label;
  const full = `（${unitLabel}）`;
  const half = `(${unitLabel})`;
  if (unitLabel === '' || label.includes(full) || label.includes(half)) {
    return { row, next: shown, changed: false };
  }

  const next = headerWithUnit(shown, unitLabel);
  return { row, next, changed: next !== current };
}

function trimEndIndex(value: string, end: number): number {
  while (end > 0 && /\s/.test(value[end - 1])) end--;
  return end;
}

/** 単位と倍率の文字だけ外す。全角と桁区切りは残す（別の修正の担当）。 */
function stripUnitSuffix(raw: string, parsed: ParsedNumber): string {
  const trimmed = raw.trim();
  const half = toHalfWidth(trimmed);
  let end = half.length;

  if (parsed.unit !== '') {
    if (!half.endsWith(parsed.unit)) return trimmed;
    end -= parsed.unit.length;
  }
  end = trimEndIndex(half, end);
  if (parsed.multiplier !== '') {
    const start = end - parsed.multiplier.length;
    if (start < 0 || half.slice(start, end) !== parsed.multiplier) return trimmed;
    end = start;
  }
  end = trimEndIndex(half, end);
  return trimmed.slice(0, end).trim();
}

function normalizedNumber(parsed: ParsedNumber): string {
  const exponent = parsed.multiplier === '' ? 0 : MULTIPLIER_EXPONENT[parsed.multiplier];
  return shiftDecimal(`${parsed.sign}${parsed.digits}`, exponent);
}

function unitDisplayLabel(decision: Exclude<ColumnUnitDecision, { mode: 'mixed' }>): string {
  return decision.mode === 'strip' ? decision.unitLabel : decision.unit;
}

interface PlannedUnitColumn {
  col: number;
  decision: Exclude<ColumnUnitDecision, { mode: 'mixed' }>;
  cells: NumericCell[];
  headerRow: number;
  headerNext: string;
  headerChanged: boolean;
}

function planUnitColumns(
  table: Table,
  region: DataRegion,
  cells: NumericCell[],
  kinds: ColumnKind[],
): { units: PlannedUnitColumn[]; mixed: Array<{ col: number; units: string[]; cells: NumericCell[] }> } {
  const byCol = new Map<number, NumericCell[]>();
  for (const cell of cells) {
    if (kinds[cell.col] !== 'numeric') continue;
    const list = byCol.get(cell.col);
    if (list) list.push(cell);
    else byCol.set(cell.col, [cell]);
  }

  const units: PlannedUnitColumn[] = [];
  const mixed: Array<{ col: number; units: string[]; cells: NumericCell[] }> = [];

  for (const [col, colCells] of byCol) {
    const decision = decideColumnUnit(colCells);
    if (!decision) continue;
    if (decision.mode === 'mixed') {
      const attached = colCells.filter(cell => cell.parsed.multiplier !== '' || cell.parsed.unit !== '');
      mixed.push({ col, units: decision.units, cells: attached });
      continue;
    }
    const attached = colCells.filter(cell => cell.parsed.multiplier !== '' || cell.parsed.unit !== '');
    const header = planHeader(table, col, region, unitDisplayLabel(decision));
    units.push({
      col,
      decision,
      cells: attached,
      headerRow: header.row,
      headerNext: header.next,
      headerChanged: header.changed,
    });
  }

  return { units, mixed };
}

function unitCellValue(cell: NumericCell, decision: Exclude<ColumnUnitDecision, { mode: 'mixed' }>): string {
  if (decision.mode === 'normalize') return normalizedNumber(cell.parsed);
  return stripUnitSuffix(cell.raw, cell.parsed);
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

    const planned = planUnitColumns(table, region, cells, kinds);
    if (planned.units.length > 0) {
      const edits: CellEdit[] = [];
      const rangeCells: Array<{ row: number; col: number }> = [];
      for (const column of planned.units) {
        rangeCells.push({ row: column.headerRow, col: column.col });
        if (column.headerChanged) {
          edits.push({ row: column.headerRow, col: column.col, value: column.headerNext });
        }
        for (const cell of column.cells) {
          rangeCells.push({ row: cell.row, col: cell.col });
          edits.push({ row: cell.row, col: cell.col, value: unitCellValue(cell, column.decision) });
        }
      }
      const quoted = planned.units
        .map(column => `列 ${toColLetter(column.col)}「${unitDisplayLabel(column.decision)}」`)
        .join(', ');
      findings.push({
        checkId: 'format-number',
        severity: 'warning',
        ranges: cellsToRanges(rangeCells),
        message: `${planned.units.length} 個の列で、セルの中に単位が書かれています（${quoted}）。単位を見出しに移すと、値を数値として扱えます。`,
        fix: createCellEditFix(
          `単位を見出しに移す（${formatColList(planned.units.map(column => column.col))}）`,
          edits,
        ),
        metadata: {
          kind: 'unit',
          columns: planned.units.map(column => ({
            col: column.col,
            mode: column.decision.mode,
            unit: unitDisplayLabel(column.decision),
            header: column.headerNext,
          })),
        },
      });
    }

    if (planned.mixed.length > 0) {
      const described = planned.mixed
        .map(column => `列 ${toColLetter(column.col)} は単位がそろっていません（${column.units.join(', ')}）`)
        .join('。');
      findings.push({
        checkId: 'format-number',
        severity: 'info',
        ranges: cellsToRanges(planned.mixed.flatMap(column => column.cells)),
        message: `${described}。意味の違う値（実数と割合など）が1つの列に混ざっている可能性があります。`,
        metadata: {
          kind: 'mixed-unit',
          columns: planned.mixed.map(column => ({ col: column.col, units: column.units })),
        },
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
