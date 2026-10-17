import type { Check, Finding, Table, CheckContext } from '../types';
import { getDataRegion, getColumnLabel, isDataRow, type DataRegion } from '../utils/dataRegion';
import { cellsToRanges } from '../utils/cellRef';
import { createCellEditFix, type CellEdit } from '../utils/cellEdit';
import {
  convertDateLabel,
  formatDate,
  parseJapaneseDate,
  type ParsedDate,
} from '../utils/japaneseDate';
import { classifyColumns, DATE_HEADER_RE, nfkcCompact, type ColumnKind } from '../utils/values';

const CHECK_ID = 'wareki';
const MAPPING_LIMIT = 50;

/** 日付らしいが全体としては読めない和暦。見出し・日付列だけを見る */
const ERA_HINT_RE = /(明治|大正|昭和|平成|令和)(元|\d)/;

/** japaneseDate.convertDateLabel と同じ、末尾の単位などの（…） */
const TRAILING_PAREN_RE = /^(.+?)(\s*[(（][^()（）]*[)）]\s*)$/;

interface DatedCell {
  row: number;
  col: number;
  from: string;
  to: string;
  crossesBoundary: boolean;
  outOfRange: boolean;
}

interface TextCell {
  row: number;
  col: number;
  text: string;
}

function columnHeader(table: Table, col: number, region: DataRegion): string {
  const label = nfkcCompact(getColumnLabel(table, col, region));
  const splitAt = label.lastIndexOf('_');
  return splitAt === -1 ? label : label.slice(splitAt + 1);
}

function isMtAbbr(date: ParsedDate): boolean {
  return date.notation === 'alpha' && (date.era === '明治' || date.era === '大正');
}

/**
 * 略記を変換してよい列か。
 * 見出しが日付の語、または同じ列のデータに漢字の元号か「年」「月」「/」付きの西暦がある。
 * M / T はここが真でも見出しの条件でしか認めない（呼び出し側）。
 */
function qualifiesForAbbr(table: Table, col: number, region: DataRegion, header: string): boolean {
  if (DATE_HEADER_RE.test(header)) return true;

  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (!isDataRow(table, row, region)) continue;
    const raw = table[row]?.[col] ?? '';
    if (raw.trim() === '') continue;
    const parsed = parseJapaneseDate(raw);
    if (!parsed?.ok) continue;
    if (parsed.value.notation === 'kanji') return true;
    if (parsed.value.notation === 'western' && /[年月/]/.test(nfkcCompact(raw))) return true;
  }

  return false;
}

/**
 * 西暦の書式をそろえてよい列か。
 * 見出しが日付の語、または空でないセルの 80% 以上が日付で、そのうち1つ以上が年・月・日・/ を含む。
 * 「.」「-」は根拠にしない。numeric 列は見出しが日付のときだけ。
 */
function isDateColumn(
  table: Table,
  col: number,
  region: DataRegion,
  header: string,
  kind: ColumnKind,
): boolean {
  const headerIsDate = DATE_HEADER_RE.test(header);
  if (kind === 'numeric' && !headerIsDate) return false;
  if (headerIsDate) return true;

  let nonEmpty = 0;
  let dates = 0;
  let hasMarker = false;

  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (!isDataRow(table, row, region)) continue;
    const raw = table[row]?.[col] ?? '';
    if (raw.trim() === '') continue;
    nonEmpty++;
    const parsed = parseJapaneseDate(raw);
    if (!parsed?.ok) continue;
    dates++;
    if (/[年月日/]/.test(nfkcCompact(raw))) hasMarker = true;
  }

  return nonEmpty > 0 && dates * 5 >= nonEmpty * 4 && hasMarker;
}

function allowsDataEra(date: ParsedDate, header: string, abbrOk: boolean): boolean {
  if (date.era === null) return false;
  if (date.notation === 'kanji') return true;
  if (isMtAbbr(date)) return DATE_HEADER_RE.test(header);
  return abbrOk;
}

function eraAllowedInHeader(date: ParsedDate, allowAbbr: boolean): boolean {
  if (date.era === null) return false;
  if (date.notation === 'kanji') return true;
  if (isMtAbbr(date)) return false;
  return allowAbbr;
}

/** 見出しセルを「_」と末尾の（…）で分け、日付として読める部分を返す */
function parseLabelDates(raw: string): ParsedDate[] {
  const dates: ParsedDate[] = [];

  for (const part of raw.split('_')) {
    const whole = parseJapaneseDate(part);
    if (whole?.ok) {
      dates.push(whole.value);
      continue;
    }
    if (whole && !whole.ok) continue;

    const trailing = TRAILING_PAREN_RE.exec(part);
    if (!trailing) continue;
    const base = parseJapaneseDate(trailing[1]);
    if (base?.ok) dates.push(base.value);
  }

  return dates;
}

function byPosition<T extends { row: number; col: number }>(a: T, b: T): number {
  return a.row - b.row || a.col - b.col;
}

function mappingOf(cells: Array<{ from: string; to: string }>): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const mapping: Array<{ from: string; to: string }> = [];

  for (const cell of cells) {
    const key = `${cell.from}\0${cell.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mapping.push({ from: cell.from, to: cell.to });
    if (mapping.length >= MAPPING_LIMIT) break;
  }

  return mapping;
}

function editsOf(cells: DatedCell[]): CellEdit[] {
  return cells.map(cell => ({ row: cell.row, col: cell.col, value: cell.to }));
}

function uniqueTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const text of texts) {
    if (seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
    if (unique.length >= MAPPING_LIMIT) break;
  }
  return unique;
}

function quotedExamples(texts: string[], max = 2): string {
  return texts.slice(0, max).map(text => `「${text}」`).join('');
}

function eraCellsFinding(cells: DatedCell[]): Finding {
  const sample = cells[0];
  return {
    checkId: CHECK_ID,
    severity: 'warning',
    ranges: cellsToRanges(cells),
    message: `${cells.length} 個のセルに和暦の日付があります（例: 「${sample.from}」→「${sample.to}」）。西暦にそろえると、並べ替えやグラフの時間軸が正しく扱えます。`,
    fix: createCellEditFix(`和暦を西暦に変換（${cells.length} セル）`, editsOf(cells)),
    metadata: { kind: 'era-cells', mapping: mappingOf(cells) },
  };
}

function eraHeadersFinding(cells: DatedCell[]): Finding {
  const sample = cells[0];
  const cols = new Set(cells.map(cell => cell.col)).size;
  return {
    checkId: CHECK_ID,
    severity: 'warning',
    ranges: cellsToRanges(cells),
    message: `見出しに和暦が ${cells.length} 個あります（例: 「${sample.from}」→「${sample.to}」）。横持ち→縦持ち（手順10）のあと、年の列として使えるようになります。`,
    fix: createCellEditFix(`見出しの和暦を西暦に変換（${cols} 列）`, editsOf(cells)),
    metadata: { kind: 'era-headers', mapping: mappingOf(cells) },
  };
}

function dateFormatFinding(cells: DatedCell[]): Finding {
  const sample = cells[0];
  return {
    checkId: CHECK_ID,
    severity: 'warning',
    ranges: cellsToRanges(cells),
    message: `日付の書き方がそろっていません（例: 「${sample.from}」→「${sample.to}」）。`,
    fix: createCellEditFix(`日付を「2020-05-01」の形にそろえる（${cells.length} セル）`, editsOf(cells)),
    metadata: { kind: 'date-format', mapping: mappingOf(cells) },
  };
}

function boundaryFinding(cells: DatedCell[]): Finding {
  const ordered = [
    ...cells.filter(cell => cell.crossesBoundary),
    ...cells.filter(cell => cell.outOfRange && !cell.crossesBoundary),
  ];
  const examples = uniqueTexts(ordered.map(cell => cell.from));
  return {
    checkId: CHECK_ID,
    severity: 'info',
    ranges: cellsToRanges(ordered),
    message: `元号の切り替えをまたぐ表記があります（例: 「${examples[0]}」）。西暦では正しく変換されますが、元の資料を確認しておくと安心です。`,
    metadata: { kind: 'boundary', examples },
  };
}

function unparsedFinding(cells: TextCell[]): Finding {
  const texts = cells.map(cell => cell.text);
  return {
    checkId: CHECK_ID,
    severity: 'info',
    ranges: cellsToRanges(cells),
    message: `変換できない日付の表記が ${cells.length} 個あります（例: ${quotedExamples(texts)}）。`,
    metadata: { kind: 'unparsed', examples: uniqueTexts(texts) },
  };
}

function looksUnparsed(raw: string): boolean {
  const parsed = parseJapaneseDate(raw);
  if (parsed && !parsed.ok) return true;
  return parsed === null && ERA_HINT_RE.test(nfkcCompact(raw));
}

function collectData(
  table: Table,
  region: DataRegion,
  headers: string[],
  abbrOk: boolean[],
  dateColumn: boolean[],
  eraCells: DatedCell[],
  formatCells: DatedCell[],
  unparsed: TextCell[],
): void {
  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (!isDataRow(table, row, region)) continue;

    for (let col = 0; col < region.maxCols; col++) {
      const raw = table[row]?.[col] ?? '';
      if (raw.trim() === '') continue;

      const parsed = parseJapaneseDate(raw);
      if (parsed?.ok) {
        const formatted = formatDate(parsed.value);
        if (parsed.value.era !== null) {
          if (allowsDataEra(parsed.value, headers[col], abbrOk[col]) && formatted !== raw) {
            eraCells.push({
              row,
              col,
              from: raw,
              to: formatted,
              crossesBoundary: parsed.value.crossesBoundary,
              outOfRange: parsed.value.outOfRange,
            });
          }
        } else if (dateColumn[col] && formatted !== raw) {
          formatCells.push({
            row,
            col,
            from: raw,
            to: formatted,
            crossesBoundary: false,
            outOfRange: false,
          });
        }
        continue;
      }

      if (parsed && !parsed.ok) {
        unparsed.push({ row, col, text: raw });
        continue;
      }

      if (dateColumn[col] && ERA_HINT_RE.test(nfkcCompact(raw))) {
        unparsed.push({ row, col, text: raw });
      }
    }
  }
}

function collectHeaders(
  table: Table,
  region: DataRegion,
  eraHeaders: DatedCell[],
  formatCells: DatedCell[],
  unparsed: TextCell[],
): void {
  for (const row of region.headerRows) {
    const cells: string[] = [];
    for (let col = 0; col < region.maxCols; col++) {
      cells.push(table[row]?.[col] ?? '');
    }

    const datesByCol = cells.map(parseLabelDates);
    const readable = datesByCol.filter(dates => dates.length > 0);
    const allowAbbr = readable.length >= 2 && !readable.some(dates => dates.some(isMtAbbr));
    const rowHasWareki = datesByCol.some(dates => dates.some(date => eraAllowedInHeader(date, allowAbbr)));

    for (let col = 0; col < cells.length; col++) {
      const raw = cells[col];
      if (raw.trim() === '') continue;

      const converted = convertDateLabel(raw, allowAbbr);
      const dates = datesByCol[col];
      const hasEra = dates.some(date => eraAllowedInHeader(date, allowAbbr));

      if (converted !== null && converted !== raw && hasEra) {
        eraHeaders.push({
          row,
          col,
          from: raw,
          to: converted,
          crossesBoundary: dates.some(date => date.crossesBoundary),
          outOfRange: dates.some(date => date.outOfRange),
        });
        continue;
      }

      if (converted !== null && converted !== raw && rowHasWareki) {
        formatCells.push({
          row,
          col,
          from: raw,
          to: converted,
          crossesBoundary: false,
          outOfRange: false,
        });
        continue;
      }

      if (looksUnparsed(raw) && (converted === null || converted === raw)) {
        unparsed.push({ row, col, text: raw });
      }
    }
  }
}

export const warekiCheck: Check = {
  id: 'wareki',
  title: '和暦などの日付',
  description: '和暦（令和・平成など）を西暦に変換し、日付形式を統一します。',

  detect(table: Table, _ctx: CheckContext): Finding[] {
    const region = getDataRegion(table);
    const kinds = classifyColumns(table, region);
    const headers: string[] = [];
    const abbrOk: boolean[] = [];
    const dateColumn: boolean[] = [];

    for (let col = 0; col < region.maxCols; col++) {
      const header = columnHeader(table, col, region);
      headers.push(header);
      abbrOk.push(qualifiesForAbbr(table, col, region, header));
      dateColumn.push(isDateColumn(table, col, region, header, kinds[col] ?? 'text'));
    }

    const eraCells: DatedCell[] = [];
    const eraHeaders: DatedCell[] = [];
    const formatCells: DatedCell[] = [];
    const unparsed: TextCell[] = [];

    collectHeaders(table, region, eraHeaders, formatCells, unparsed);
    collectData(table, region, headers, abbrOk, dateColumn, eraCells, formatCells, unparsed);

    eraCells.sort(byPosition);
    eraHeaders.sort(byPosition);
    formatCells.sort(byPosition);
    unparsed.sort(byPosition);

    const findings: Finding[] = [];
    if (eraCells.length > 0) findings.push(eraCellsFinding(eraCells));
    if (eraHeaders.length > 0) findings.push(eraHeadersFinding(eraHeaders));
    if (formatCells.length > 0) findings.push(dateFormatFinding(formatCells));

    const boundaryCells = [...eraCells, ...eraHeaders].filter(cell => cell.crossesBoundary || cell.outOfRange);
    if (boundaryCells.length > 0) findings.push(boundaryFinding(boundaryCells));
    if (unparsed.length > 0) findings.push(unparsedFinding(unparsed));

    if (findings.length === 0) {
      findings.push({
        checkId: CHECK_ID,
        severity: 'info',
        ranges: [],
        message: '和暦・日付の表記ゆれは見つかりませんでした。',
      });
    }

    return findings;
  },
};
