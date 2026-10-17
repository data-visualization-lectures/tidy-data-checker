import type { Check, Finding, Table, CheckContext, Fix, CellRange } from '../types';
import { getColumnLabel, getDataRegion, isDataRow, type DataRegion } from '../utils/dataRegion';
import { formatColList, formatRowList, toColLetter } from '../utils/cellRef';
import { classifyColumns, nfkcCompact, parseNumericCell, type ColumnKind } from '../utils/values';

export type TotalKind = 'grand' | 'subtotal' | 'restated';

const GRAND_RE = /^(?:総合計|合計|総計|総数|総額|計|全体|全国|全国計|総平均|全国平均|平均|平均値)$/;
const EN_GRAND_RE = /^(?:grandtotal|total|all|overall)$/i;
const SUB_RE = /^(?:小計|中計)(?:[(:：].*)?$|^.{1,10}(?:小計|合計|計)$|^計\(.+\)$/u;
const EN_SUB_RE = /^subtotal$/i;
const RESTATED_RE = /^\(?再掲\)?|^\(?うち[、,]?(?=[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9(])/u;
const DENY_WORD_RE = /^(?:会計|統計|設計|時計|家計|生計|推計|集計|主計|余計|早計|奇計)$/;
const DENY_SUFFIX_RE = /(?:温度|体温|血圧|湿度|速度|流量|雨量|歩数|万歩|圧力|水位|電力|照度|騒音|線量|回転|積算|距離|体重|風速|気圧|露出|酸素|放射線|ガス|水道|電気|電流|電圧|会|統|推|集)計$/;
const LEADING_MARK_RE = /^[・○◎●■□◇◆]+/;
const TRAILING_WRAPPER_RE = /(?:\([^()]*\)|（[^（）]*）|\[[^\]]*\]|【[^】]*】|〔[^〕]*〕|<[^>]*>|「[^」]*」)$/;

const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'],
  ['[', ']'],
  ['【', '】'],
  ['〔', '〕'],
  ['<', '>'],
  ['「', '」'],
];

interface TotalRowCandidate {
  row: number;
  col: number;
  label: string;
  kind: TotalKind;
}

interface TotalColCandidate {
  col: number;
  label: string;
}

function unwrapLabel(s: string): string {
  for (const [open, close] of WRAPPERS) {
    if (s.startsWith(open) && s.endsWith(close) && s.length > open.length + close.length) {
      const inner = s.slice(open.length, s.length - close.length);
      if (inner === '再掲') return s;
      return inner;
    }
  }
  return s;
}

/**
 * 英語併記を外す。設計の `/^([^\x00-\x7F]+?)([A-Za-z][A-Za-z.]*)$/` と同じ
 * （`計 Total` の空白除去後 `計Total` → `計`）。ASCII を含む前半は対象外。
 */
function stripEnglishGloss(s: string): string {
  const matched = /^(.*?)([A-Za-z][A-Za-z.]*)$/.exec(s);
  if (!matched || matched[1] === '') return s;
  for (let i = 0; i < matched[1].length; i++) {
    if (matched[1].charCodeAt(i) <= 0x7f) return s;
  }
  return matched[1];
}

/** 行ラベル用。空白除去・先頭記号・全体を囲む括弧・英語併記まで */
function normalizeRowLabel(raw: string): string {
  const compact = nfkcCompact(raw).replace(LEADING_MARK_RE, '');
  return stripEnglishGloss(unwrapLabel(compact));
}

/** 見出し用。行ラベルの正規化に加え、末尾の単位括弧と "_" の最後の部分を使う */
function normalizeHeaderLabel(label: string): string {
  let s = stripEnglishGloss(unwrapLabel(nfkcCompact(label).replace(LEADING_MARK_RE, '')));
  s = s.replace(TRAILING_WRAPPER_RE, '');
  const underscore = s.lastIndexOf('_');
  if (underscore >= 0) s = s.slice(underscore + 1);
  s = stripEnglishGloss(s.replace(TRAILING_WRAPPER_RE, ''));
  return s;
}

function classifyNormalized(s: string): TotalKind | null {
  if (s === '') return null;
  if (RESTATED_RE.test(s)) return 'restated';
  if (GRAND_RE.test(s) || EN_GRAND_RE.test(s)) return 'grand';
  if (DENY_WORD_RE.test(s) || DENY_SUFFIX_RE.test(s)) return null;
  if (SUB_RE.test(s) || EN_SUB_RE.test(s)) return 'subtotal';
  return null;
}

/** セル1つ分のラベルを判定する（テスト用に export） */
export function classifyTotalLabel(raw: string): TotalKind | null {
  return classifyNormalized(normalizeRowLabel(raw));
}

function classifyHeaderLabel(label: string): TotalKind | null {
  const kind = classifyNormalized(normalizeHeaderLabel(label));
  if (kind === 'grand' || kind === 'subtotal') return kind;
  return null;
}

function dataRowIndices(table: Table, region: DataRegion): number[] {
  const rows: number[] = [];
  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (isDataRow(table, row, region)) rows.push(row);
  }
  return rows;
}

function findLabelCols(kinds: ColumnKind[]): number[] {
  const cols: number[] = [];
  if (kinds.length > 0) cols.push(0);
  for (let col = 1; col <= 2 && col < kinds.length; col++) {
    const kind = kinds[col];
    if (kind === 'text' || kind === 'code' || kind === 'date') cols.push(col);
  }
  return cols;
}

function isRestatedHeading(
  table: Table,
  row: number,
  labelCols: number[],
  maxCols: number,
): boolean {
  const labels = new Set(labelCols);
  for (let col = 0; col < maxCols; col++) {
    if (labels.has(col)) continue;
    if ((table[row]?.[col] ?? '').trim() !== '') return false;
  }
  return true;
}

function findTotalRows(
  table: Table,
  region: DataRegion,
  labelCols: number[],
): { rows: TotalRowCandidate[]; headings: TotalRowCandidate[] } {
  const dataRows = dataRowIndices(table, region);
  const seen = new Set<number>();
  const rows: TotalRowCandidate[] = [];
  const headings: TotalRowCandidate[] = [];

  for (const col of labelCols) {
    const matches: TotalRowCandidate[] = [];
    let nonEmpty = 0;
    const normalized = new Set<string>();

    for (const row of dataRows) {
      const raw = table[row]?.[col] ?? '';
      if (raw.trim() === '') continue;
      nonEmpty++;
      const kind = classifyTotalLabel(raw);
      if (kind === null) continue;
      const label = raw.trim();
      normalized.add(normalizeRowLabel(raw));
      matches.push({ row, col, label, kind });
    }

    // 空でない値がすべて同じ集計ラベル（全国時系列など）なら、その列は対象外
    if (nonEmpty > 0 && matches.length === nonEmpty && normalized.size === 1) continue;
    // 集計ラベルがデータ行の半数を超える列は、区分そのものなので対象外
    if (dataRows.length > 0 && matches.length / dataRows.length > 0.5) continue;

    for (const candidate of matches) {
      if (seen.has(candidate.row)) continue;
      seen.add(candidate.row);
      if (
        candidate.kind === 'restated' &&
        isRestatedHeading(table, candidate.row, labelCols, region.maxCols)
      ) {
        headings.push(candidate);
      } else {
        rows.push(candidate);
      }
    }
  }

  return { rows, headings };
}

function findTotalCols(
  table: Table,
  region: DataRegion,
  kinds: ColumnKind[],
): TotalColCandidate[] {
  const numericCols: number[] = [];
  for (let col = 0; col < kinds.length; col++) {
    if (kinds[col] === 'numeric') numericCols.push(col);
  }

  const found: TotalColCandidate[] = [];
  for (const col of numericCols) {
    if (numericCols.length - 1 < 2) continue;
    const label = getColumnLabel(table, col, region);
    if (classifyHeaderLabel(label) === null) continue;
    found.push({ col, label });
  }
  return found;
}

const MULTIPLIER: Record<string, { factor: number; exponent: number }> = {
  '': { factor: 1, exponent: 0 },
  千: { factor: 1e3, exponent: 3 },
  万: { factor: 1e4, exponent: 4 },
  億: { factor: 1e8, exponent: 8 },
  兆: { factor: 1e12, exponent: 12 },
};

interface NumericReading {
  value: number;
  decimals: number;
}

/** 検算用。parseNumericCell で読める値だけを、単位の倍率を掛けた数にする */
function readNumber(raw: string): NumericReading | null {
  const parsed = parseNumericCell(raw);
  if (!parsed) return null;
  const magnitude = Number(parsed.digits);
  if (!Number.isFinite(magnitude)) return null;
  const scale = MULTIPLIER[parsed.multiplier] ?? MULTIPLIER[''];
  const dot = parsed.digits.indexOf('.');
  const fractionDigits = dot < 0 ? 0 : parsed.digits.length - dot - 1;
  return {
    value: (parsed.sign === '-' ? -1 : 1) * magnitude * scale.factor,
    decimals: Math.max(0, fractionDigits - scale.exponent),
  };
}

/**
 * |Σ − v| ≤ max(0.5 × n × 10^(−d), 0.001 × |v|)
 * 10進の境界が2進小数でわずかに超えないよう、1e-9 だけ余裕を持たせる。
 */
function withinTolerance(sum: number, value: number, addends: number, decimals: number): boolean {
  const diff = Math.abs(sum - value);
  const rounding = 0.5 * addends * 10 ** -decimals;
  const relative = 0.001 * Math.abs(value);
  return diff <= Math.max(rounding, relative) + 1e-9;
}

function numericColIndexes(kinds: ColumnKind[]): number[] {
  const cols: number[] = [];
  for (let col = 0; col < kinds.length; col++) {
    if (kinds[col] === 'numeric') cols.push(col);
  }
  return cols;
}

interface ColumnRun {
  sums: number[];
  decimals: number[];
  total: number;
}

/** 先頭から読める行だけ累積する。記号・空欄で途切れた列は、それより先の k では比べない */
function buildColumnRuns(
  table: Table,
  totalRow: number,
  partRows: number[],
  cols: number[],
  minK: number,
): ColumnRun[] {
  const runs: ColumnRun[] = [];
  for (const col of cols) {
    const total = readNumber(table[totalRow]?.[col] ?? '');
    if (!total) continue;
    const sums: number[] = [];
    const decimals: number[] = [];
    let sum = 0;
    let decimalsSoFar = total.decimals;
    for (const row of partRows) {
      const part = readNumber(table[row]?.[col] ?? '');
      if (!part) break;
      sum += part.value;
      decimalsSoFar = Math.max(decimalsSoFar, part.decimals);
      sums.push(sum);
      decimals.push(decimalsSoFar);
    }
    if (sums.length >= minK) {
      runs.push({ sums, decimals, total: total.value });
    }
  }
  return runs;
}

/** 一致した列が1つ以上、一致しない列が0なら true。比べられる列がなければ null */
function matchAnyK(runs: ColumnRun[], minK: number, maxK: number): boolean | null {
  if (runs.length === 0 || maxK < minK) return null;
  let sawMismatch = false;
  for (let k = minK; k <= maxK; k++) {
    let matched = 0;
    let mismatched = 0;
    for (const run of runs) {
      if (run.sums.length < k) continue;
      if (withinTolerance(run.sums[k - 1], run.total, k, run.decimals[k - 1])) matched++;
      else mismatched++;
    }
    if (matched >= 1 && mismatched === 0) return true;
    if (mismatched > 0) sawMismatch = true;
  }
  return sawMismatch ? false : null;
}

function verifyGrandRow(
  table: Table,
  region: DataRegion,
  cand: TotalRowCandidate,
  candidateRows: Set<number>,
  kinds: ColumnKind[],
): boolean | null {
  const partRows: number[] = [];
  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (!isDataRow(table, row, region) || candidateRows.has(row)) continue;
    partRows.push(row);
  }
  if (partRows.length === 0) return null;
  const runs = buildColumnRuns(table, cand.row, partRows, numericColIndexes(kinds), partRows.length);
  return matchAnyK(runs, partRows.length, partRows.length);
}

/** 直上（なければ直下）の連続したデータ行について、近い方から k 行（k ≥ 2）の和を見る */
function collectAdjacentRows(
  table: Table,
  region: DataRegion,
  start: number,
  step: number,
  candidateRows: Set<number>,
): number[] {
  const rows: number[] = [];
  for (let row = start; row >= region.firstDataRow && row <= region.lastDataRow; row += step) {
    if (!isDataRow(table, row, region) || candidateRows.has(row)) break;
    rows.push(row);
  }
  return rows;
}

function verifySubtotalRow(
  table: Table,
  region: DataRegion,
  cand: TotalRowCandidate,
  candidateRows: Set<number>,
  kinds: ColumnKind[],
): boolean | null {
  const cols = numericColIndexes(kinds);
  const above = collectAdjacentRows(table, region, cand.row - 1, -1, candidateRows);
  const below = collectAdjacentRows(table, region, cand.row + 1, 1, candidateRows);
  let sawMismatch = false;
  for (const run of [above, below]) {
    const columnRuns = buildColumnRuns(table, cand.row, run, cols, 2);
    const result = matchAnyK(columnRuns, 2, run.length);
    if (result === true) return true;
    if (result === false) sawMismatch = true;
  }
  return sawMismatch ? false : null;
}

function verifyTotalRow(
  table: Table,
  region: DataRegion,
  cand: TotalRowCandidate,
  candidateRows: Set<number>,
  kinds: ColumnKind[],
): boolean | null {
  if (cand.kind === 'grand') return verifyGrandRow(table, region, cand, candidateRows, kinds);
  if (cand.kind === 'subtotal') return verifySubtotalRow(table, region, cand, candidateRows, kinds);
  return null;
}

/** 列名の "_" より前（`人口_総数` → `人口_`）。無ければ null */
function columnPrefix(label: string): string | null {
  const normalized = label.normalize('NFKC');
  const index = normalized.lastIndexOf('_');
  if (index <= 0) return null;
  return normalized.slice(0, index + 1);
}

function columnHasBlockedCell(table: Table, rows: number[], col: number): boolean {
  for (const row of rows) {
    const raw = table[row]?.[col] ?? '';
    if (raw.trim() === '') continue;
    if (readNumber(raw) === null) return true;
  }
  return false;
}

function verifyTotalCol(
  table: Table,
  region: DataRegion,
  cand: TotalColCandidate,
  kinds: ColumnKind[],
  totalCols: Set<number>,
): boolean | null {
  const dataRows: number[] = [];
  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (isDataRow(table, row, region)) dataRows.push(row);
  }
  if (dataRows.length === 0) return null;

  const prefix = columnPrefix(cand.label);
  const partCols: number[] = [];
  for (let col = 0; col < kinds.length; col++) {
    if (kinds[col] !== 'numeric' || col === cand.col || totalCols.has(col)) continue;
    if (prefix !== null && !getColumnLabel(table, col, region).normalize('NFKC').startsWith(prefix)) continue;
    if (columnHasBlockedCell(table, dataRows, col)) continue;
    partCols.push(col);
  }
  if (partCols.length === 0) return null;

  let matched = 0;
  let comparable = 0;
  for (const row of dataRows) {
    const total = readNumber(table[row]?.[cand.col] ?? '');
    if (!total) continue;
    let sum = 0;
    let decimals = total.decimals;
    let readable = true;
    for (const col of partCols) {
      const part = readNumber(table[row]?.[col] ?? '');
      if (!part) {
        readable = false;
        break;
      }
      sum += part.value;
      decimals = Math.max(decimals, part.decimals);
    }
    if (!readable) continue;
    comparable++;
    if (withinTolerance(sum, total.value, partCols.length, decimals)) matched++;
  }
  if (comparable === 0) return null;
  // 80% はデータ行全体に対して見る。読めない行は一致に数えない
  return matched * 5 >= dataRows.length * 4;
}

function createRemoveRowsFix(rows: number[], what: string): Fix {
  const sorted = [...rows].sort((a, b) => a - b);
  const drop = new Set(sorted);
  return {
    description: `${what}を削除（${formatRowList(sorted)}）`,
    apply: (table: Table): Table => table.filter((_, index) => !drop.has(index)),
    deletedRows: sorted,
  };
}

function createRemoveColsFix(cols: number[]): Fix {
  const sorted = [...cols].sort((a, b) => a - b);
  const drop = new Set(sorted);
  return {
    description: `合計列を削除（${formatColList(sorted)}）`,
    apply: (table: Table): Table => table.map(row => row.filter((_, index) => !drop.has(index))),
    deletedCols: sorted,
  };
}

function rowRanges(rows: number[], maxCols: number): CellRange[] {
  const endCol = Math.max(0, maxCols - 1);
  return rows.map(row => ({
    startRow: row,
    startCol: 0,
    endRow: row,
    endCol,
  }));
}

function formatLabeledRows(candidates: TotalRowCandidate[]): string {
  return [...candidates]
    .sort((a, b) => a.row - b.row)
    .map(candidate => `行 ${candidate.row + 1}「${candidate.label}」`)
    .join(', ');
}

const ROW_FINDING_TEXT: Record<TotalKind, { what: string; message: (count: number, labeled: string) => string }> = {
  grand: {
    what: '集計行',
    message: (count, labeled) =>
      `${count} 個の集計行（合計・総数など）が見つかりました（${labeled}）。ほかの行と一緒に集計すると二重に数えてしまうため、分析の前に除くのが基本です。`,
  },
  subtotal: {
    what: '小計行',
    message: (count, labeled) =>
      `${count} 個の小計行が見つかりました（${labeled}）。小計はほかの行から計算できるので、除いておくと二重カウントを防げます。`,
  },
  restated: {
    what: '再掲行',
    message: (count, labeled) =>
      `${count} 個の再掲・内訳（「うち」）の行が見つかりました（${labeled}）。ほかの行の一部をもう一度数えた行なので、合計すると二重に数えてしまいます。`,
  },
};

function rowVerifiedClause(row: number, label: string): string {
  return `行 ${row + 1}「${label}」はほかの行の合計と一致しました。`;
}

function rowFinding(
  kind: TotalKind,
  candidates: TotalRowCandidate[],
  maxCols: number,
  verifiedRows: number[],
): Finding {
  const ordered = [...candidates].sort((a, b) => a.row - b.row);
  const rows = ordered.map(candidate => candidate.row);
  const labels = ordered.map(candidate => candidate.label);
  const verified = new Set(verifiedRows);
  const verifiedOrdered = ordered.filter(candidate => verified.has(candidate.row));
  const text = ROW_FINDING_TEXT[kind];
  const clauses = verifiedOrdered.map(candidate => rowVerifiedClause(candidate.row, candidate.label)).join('');
  return {
    checkId: 'totals',
    severity: 'warning',
    ranges: rowRanges(rows, maxCols),
    message: text.message(ordered.length, formatLabeledRows(ordered)) + clauses,
    fix: createRemoveRowsFix(rows, text.what),
    metadata: {
      kind,
      rows,
      labels,
      verifiedRows: verifiedOrdered.map(candidate => candidate.row),
    },
  };
}

function columnVerifiedClause(col: number, label: string): string {
  return `列 ${toColLetter(col)}「${label}」はほかの列の合計と一致しました。`;
}

function columnFinding(
  candidates: TotalColCandidate[],
  tableLength: number,
  verifiedCols: number[],
): Finding {
  const ordered = [...candidates].sort((a, b) => a.col - b.col);
  const cols = ordered.map(candidate => candidate.col);
  const labels = ordered.map(candidate => candidate.label);
  const verified = new Set(verifiedCols);
  const verifiedOrdered = ordered.filter(candidate => verified.has(candidate.col));
  const labeled = ordered
    .map(candidate => `列 ${toColLetter(candidate.col)}「${candidate.label}」`)
    .join(', ');
  const clauses = verifiedOrdered.map(candidate => columnVerifiedClause(candidate.col, candidate.label)).join('');
  const endRow = Math.max(0, tableLength - 1);
  return {
    checkId: 'totals',
    severity: 'warning',
    ranges: cols.map(col => ({
      startRow: 0,
      startCol: col,
      endRow,
      endCol: col,
    })),
    message: `${ordered.length} 個の合計列が見つかりました（${labeled}）。ほかの列から計算できる値なので、横持ち→縦持ち（手順10）の前に除いておくと安全です。${clauses}`,
    fix: createRemoveColsFix(cols),
    metadata: {
      kind: 'total-column',
      cols,
      labels,
      verifiedCols: verifiedOrdered.map(candidate => candidate.col),
    },
  };
}

function headingFinding(candidates: TotalRowCandidate[], maxCols: number): Finding {
  const ordered = [...candidates].sort((a, b) => a.row - b.row);
  const rows = ordered.map(candidate => candidate.row);
  const where = rows.map(row => `行 ${row + 1}`).join(', ');
  return {
    checkId: 'totals',
    severity: 'info',
    ranges: rowRanges(rows, maxCols),
    message: `「（再掲）」の見出し行があります（${where}）。この下の行はほかの行と重複している可能性があるので、確認してください。`,
  };
}

function notFoundFinding(): Finding {
  return {
    checkId: 'totals',
    severity: 'info',
    ranges: [],
    message: '合計・小計行は見つかりませんでした。',
  };
}

export const totalsCheck: Check = {
  id: 'totals',
  title: '合計・小計行',
  description: '集計行を検出します。分析時に二重カウントを防ぐため除去できます。',

  detect: (table: Table, _ctx: CheckContext): Finding[] => {
    const region = getDataRegion(table);
    const kinds = classifyColumns(table, region);
    const { rows, headings } = findTotalRows(table, region, findLabelCols(kinds));
    const totalCols = findTotalCols(table, region, kinds);
    const candidateRows = new Set<number>();
    for (const candidate of rows) candidateRows.add(candidate.row);
    for (const candidate of headings) candidateRows.add(candidate.row);
    const totalColIndexes = new Set(totalCols.map(candidate => candidate.col));

    const findings: Finding[] = [];
    for (const kind of ['grand', 'subtotal', 'restated'] as const) {
      const matched = rows.filter(candidate => candidate.kind === kind);
      if (matched.length === 0) continue;
      const verifiedRows = kind === 'restated'
        ? []
        : matched
          .filter(candidate => verifyTotalRow(table, region, candidate, candidateRows, kinds) === true)
          .map(candidate => candidate.row);
      findings.push(rowFinding(kind, matched, region.maxCols, verifiedRows));
    }
    if (totalCols.length > 0) {
      const verifiedCols = totalCols
        .filter(candidate => verifyTotalCol(table, region, candidate, kinds, totalColIndexes) === true)
        .map(candidate => candidate.col);
      findings.push(columnFinding(totalCols, table.length, verifiedCols));
    }
    if (headings.length > 0) findings.push(headingFinding(headings, region.maxCols));
    if (findings.length === 0) findings.push(notFoundFinding());
    return findings;
  },
};
