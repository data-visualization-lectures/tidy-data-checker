import type { Table } from '../types';
import { getColumnLabel, isDataRow, type DataRegion } from './dataRegion';

const HALF_WIDTH_SOURCE_RE = /[\uFF01-\uFF5E\u3000\u2212\u2010]/g;

/** 全角 ASCII（U+FF01〜U+FF5E）→半角、U+3000→空白、U+2212/U+2010→'-'。1文字→1文字の置換 */
export function toHalfWidth(s: string): string {
  return s.replace(HALF_WIDTH_SOURCE_RE, ch => {
    const code = ch.charCodeAt(0);
    if (code === 0x3000) return ' ';
    if (code === 0x2212 || code === 0x2010) return '-';
    return String.fromCharCode(code - 0xfee0);
  });
}

/** 判定専用：NFKC 正規化し、すべての空白を除く */
export function nfkcCompact(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

const NUM_CORE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+`;
const NUM_RE = new RegExp(String.raw`^([+-]?)(${NUM_CORE})\s*(千|万|億|兆)?\s*(.*)$`);
const UNIT_RE = /^(?:%|‰|[A-Za-zµμ°℃/²³㎡㎞㎏]{1,6}|[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー]{1,4}(?:\/[\p{Script=Han}A-Za-z²³]{1,4})?)$/u;
const NOT_UNIT_RE = /^(?:年|年度|年次|月|月分|位)$|(?:以上|以下|未満|超|前後|程度|頃|ほど|台)$|[～〜~]/u;

export interface ParsedNumber {
  sign: '' | '+' | '-';
  digits: string;            // 半角・桁区切りなし。例 "1234.5"
  multiplier: '' | '千' | '万' | '億' | '兆';
  unit: string;              // toHalfWidth 後の表記（NFKC はかけない）。例 "人", "km²", "%"
  hasFullWidth: boolean;     // 全角の数字・記号を含む
  hasPadding: boolean;       // 前後に空白がある
  hasSeparator: boolean;     // 正しい3桁区切りのカンマを含む
}

export function parseNumericCell(raw: string): ParsedNumber | null {
  const trimmed = raw.trim();
  const half = toHalfWidth(trimmed);
  const m = NUM_RE.exec(half);
  if (!m) return null;

  const unit = m[4];
  if (unit !== '' && (!UNIT_RE.test(unit) || NOT_UNIT_RE.test(unit))) return null;

  return {
    sign: m[1] as ParsedNumber['sign'],
    digits: m[2].replace(/,/g, ''),
    multiplier: (m[3] ?? '') as ParsedNumber['multiplier'],
    unit,
    hasFullWidth: half !== trimmed,
    hasPadding: trimmed !== raw,
    hasSeparator: m[2].includes(','),
  };
}

export type SymbolKind = 'missing' | 'dash' | 'negative' | 'marker' | 'unknown';
export interface SymbolMatch {
  kind: SymbolKind;
  replacement: string;       // 主修正を適用した後の値（unknown は raw のまま）
}

const DASH_RE = /^[-‐‑‒–—―−ー─━]+$/;
const MISSING_RE = /^(?:[xX×]{1,3}|秘匿?|秘匿値|\.{2,}|・+|不詳|不明|非公表|非公開|未調査|未集計|NA|N\/A|n\/a|n\.a\.|NaN|#N\/A|\*+|[?？]+)$/;
const NEG_RE = new RegExp(String.raw`^([△▲▼]\s*)(${NUM_CORE})\s*(.*)$`);
// ※ の直後の数字は最短で取る（最長だと「※1100」の値が「0」になる）
const MARK_PREFIX = String.raw`(?:※\d*?|\*+|†|‡|#)`;
// 英字の直後の上付き数字は km²・m³ などの単位の一部なので注記マークにしない
const MARK_SUFFIX = String.raw`(?:※\d*|\*+|†|‡|#|\(注\d*\)|注\d*|(?<=\d\s*)\(?[pPrR]\)?|(?<![A-Za-zµμ])[¹²³⁴⁵⁶⁷⁸⁹⁰]+)`;
// 単位部分を省略可能なグループで囲むと「123p」の p が単位側に取られるので、囲まずに {0,6}? で書く
const MARKER_RE = new RegExp(String.raw`^(${MARK_PREFIX})?\s*([+-]?(?:${NUM_CORE})\s*[^\d\s※*†‡#(¹²³⁴⁵⁶⁷⁸⁹⁰]{0,6}?)\s*(${MARK_SUFFIX})?$`);
const UNKNOWN_RE = /^(?:[<>≦≧≤≥]|約|概ね|およそ)|(?:以上|以下|未満|超|程度|前後)$|^\(.*\)$|^[△▲▼]$/;

export function matchSymbol(raw: string): SymbolMatch | null {
  const compact = nfkcCompact(raw);
  if (compact === '') return null;
  if (DASH_RE.test(compact)) return { kind: 'dash', replacement: '' };
  if (MISSING_RE.test(compact)) return { kind: 'missing', replacement: '' };

  // toHalfWidth は1文字→1文字なので、half で見つけた位置で trimmed を切り出せる
  const trimmed = raw.trim();
  const half = toHalfWidth(trimmed);

  const negative = NEG_RE.exec(half);
  if (negative) {
    return { kind: 'negative', replacement: '-' + trimmed.slice(negative[1].length) };
  }

  const marker = MARKER_RE.exec(half);
  if (marker && (marker[1] !== undefined || marker[3] !== undefined)) {
    const start = half.indexOf(marker[2], marker[1]?.length ?? 0);
    return { kind: 'marker', replacement: trimmed.slice(start, start + marker[2].length).trim() };
  }

  if (UNKNOWN_RE.test(half)) return { kind: 'unknown', replacement: raw };
  return null;
}

export type ColumnKind = 'numeric' | 'code' | 'date' | 'text' | 'empty';

export const CODE_HEADER_RE = /(?:コード|code|番号|識別|郵便|〒|電話|品番|型番)|^(?:no\.?|id|tel)$/i;
export const DATE_HEADER_RE = /^(?:年|年度|年次|年月|年月日|日付|日時|時点|期間|時期|調査年|調査年度|調査日|調査時点|西暦|西暦年|和暦|元号|date|year|period|fy|month)$|(?:年次|年度|年月日|年月|日付|時点)$/i;

const ALL_DIGITS_RE = /^[0-9０-９]+$/;
const LEADING_ZERO_CODE_RE = /^[0０][0-9０-９]/;
const NOTE_COLUMN_SUFFIX = '_注記';

type ColumnVerdict = ColumnKind | 'all-missing';

function classifyColumn(cells: string[], header: string): ColumnVerdict {
  if (cells.length === 0) return 'empty';
  if (CODE_HEADER_RE.test(header)) return 'code';

  const trimmed = cells.map(cell => cell.trim());
  if (trimmed.every(cell => ALL_DIGITS_RE.test(cell)) && trimmed.some(cell => LEADING_ZERO_CODE_RE.test(cell))) {
    return 'code';
  }
  if (DATE_HEADER_RE.test(header)) return 'date';

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

  if (numberLike > 0 && (numberLike + symbols) * 5 >= cells.length * 4) return 'numeric';
  if (missingOrDash === cells.length) return 'all-missing';
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
