import type { Table } from '../types';
import { getColumnLabel, isDataRow, type DataRegion } from './dataRegion';
import { matchSymbol, nfkcCompact, parseNumericCell } from './cellValue';

export {
  toHalfWidth,
  nfkcCompact,
  parseNumericCell,
  matchSymbol,
  type ParsedNumber,
  type SymbolKind,
  type SymbolMatch,
} from './cellValue';

export type ColumnKind = 'numeric' | 'code' | 'date' | 'text' | 'empty';

export const CODE_HEADER_RE = /(?:コード|code|番号|識別|郵便|〒|電話|品番|型番)|^(?:no\.?|id|tel)$/i;

const DATE_HEADER_EXACT_SOURCE =
  String.raw`^(?:年|年度|年次|年月|年月日|日付|日時|時点|期間|時期|調査年|調査年度|調査日|調査時点|西暦|西暦年|和暦|元号|date|year|period|fy|month)$`;
const DATE_HEADER_SUFFIX_SOURCE = String.raw`(?:年次|年度|年月日|年月|日付|時点)$`;

/** 見出し全体が日付の語、または末尾が「年度」「年月日」など */
export const DATE_HEADER_RE = new RegExp(
  `${DATE_HEADER_EXACT_SOURCE}|${DATE_HEADER_SUFFIX_SOURCE}`,
  'i',
);

/** 見出し全体が「年」「調査年度」などの日付の語 */
const DATE_HEADER_EXACT_RE = new RegExp(DATE_HEADER_EXACT_SOURCE, 'i');

/** 平成30年度・令和元年度のように、特定の年を名指ししている */
const SPECIFIC_YEAR_RE = /[0-9０-９]|明治|大正|昭和|平成|令和/;

const ALL_DIGITS_RE = /^[0-9０-９]+$/;
const LEADING_ZERO_CODE_RE = /^[0０][0-9０-９]/;
const NOTE_COLUMN_SUFFIX = '_注記';

type ColumnVerdict = ColumnKind | 'all-missing';

interface ColumnStats {
  numberLike: number;
  symbols: number;
  missingOrDash: number;
}

function columnStats(cells: string[]): ColumnStats {
  let numberLike = 0;
  let symbols = 0;
  let missingOrDash = 0;
  for (const cell of cells) {
    if (parseNumericCell(cell)) {
      numberLike++;
      continue;
    }
    const symbol = matchSymbol(cell);
    if (!symbol) continue;
    if (symbol.kind === 'negative' || symbol.kind === 'marker') {
      numberLike++;
    } else {
      symbols++;
      if (symbol.kind !== 'unknown') missingOrDash++;
    }
  }
  return { numberLike, symbols, missingOrDash };
}

function classifyColumn(cells: string[], header: string): ColumnVerdict {
  if (cells.length === 0) return 'empty';
  if (CODE_HEADER_RE.test(header)) return 'code';

  const trimmed = cells.map(cell => cell.trim());
  if (trimmed.every(cell => ALL_DIGITS_RE.test(cell)) && trimmed.some(cell => LEADING_ZERO_CODE_RE.test(cell))) {
    return 'code';
  }

  const stats = columnStats(cells);
  const mostlyNumeric = stats.numberLike > 0 && (stats.numberLike + stats.symbols) * 5 >= cells.length * 4;
  const allMissing = stats.missingOrDash === cells.length;

  if (DATE_HEADER_RE.test(header)) {
    // 横持ちの「平成30年度」は末尾の「年度」だけで日付列になる。
    // 値が数値や記号なら見出しではなく値で数値列と決める。
    // 「年」「調査年度」のように見出し全体が日付の語なら、値が 2018 でも日付列のまま。
    const wideYearMeasure =
      !DATE_HEADER_EXACT_RE.test(header) &&
      SPECIFIC_YEAR_RE.test(header) &&
      (mostlyNumeric || allMissing);
    if (!wideYearMeasure) return 'date';
  }

  if (mostlyNumeric) return 'numeric';
  if (allMissing) return 'all-missing';
  return 'text';
}

export function classifyColumns(table: Table, region: DataRegion): ColumnKind[] {
  const dataRows: number[] = [];
  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (isDataRow(table, row, region)) dataRows.push(row);
  }

  const verdicts: ColumnVerdict[] = [];
  for (let col = 0; col < region.maxCols; col++) {
    const label = nfkcCompact(getColumnLabel(table, col, region));
    if (label.endsWith(NOTE_COLUMN_SUFFIX)) {
      verdicts.push('text');
      continue;
    }
    const header = label.slice(label.lastIndexOf('_') + 1);
    const cells: string[] = [];
    for (const row of dataRows) {
      const cell = table[row][col] ?? '';
      if (cell.trim() !== '') cells.push(cell);
    }
    verdicts.push(classifyColumn(cells, header));
  }

  const hasNumeric = verdicts.includes('numeric');
  return verdicts.map((verdict, col) => {
    if (verdict !== 'all-missing') return verdict;
    return hasNumeric && col !== 0 ? 'numeric' : 'text';
  });
}

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** 小数の文字列を 10^exponent 倍する（浮動小数点を使わない）。例 ("1.2", 4) → "12000" */
export function shiftDecimal(digits: string, exponent: number): string {
  const m = DECIMAL_RE.exec(digits);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return digits;

  const sign = m[1];
  const intPart = m[2];
  const allDigits = intPart + (m[3] ?? '');
  const point = intPart.length + exponent;

  let integer: string;
  let fraction: string;
  if (point <= 0) {
    integer = '0';
    fraction = '0'.repeat(-point) + allDigits;
  } else if (point >= allDigits.length) {
    integer = allDigits + '0'.repeat(point - allDigits.length);
    fraction = '';
  } else {
    integer = allDigits.slice(0, point);
    fraction = allDigits.slice(point);
  }

  integer = integer.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  const result = fraction ? `${integer}.${fraction}` : integer;
  return sign === '-' && /[1-9]/.test(result) ? `-${result}` : result;
}
