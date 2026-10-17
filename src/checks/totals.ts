import type { Check, Finding, Table, CheckContext, Fix, CellRange } from '../types';
import { getColumnLabel, getDataRegion, isDataRow, type DataRegion } from '../utils/dataRegion';
import { formatColList, formatRowList, toColLetter } from '../utils/cellRef';
import { classifyColumns, nfkcCompact, type ColumnKind } from '../utils/values';

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

function rowFinding(kind: TotalKind, candidates: TotalRowCandidate[], maxCols: number): Finding {
  const ordered = [...candidates].sort((a, b) => a.row - b.row);
  const rows = ordered.map(candidate => candidate.row);
  const labels = ordered.map(candidate => candidate.label);
  const text = ROW_FINDING_TEXT[kind];
  return {
    checkId: 'totals',
    severity: 'warning',
    ranges: rowRanges(rows, maxCols),
    message: text.message(ordered.length, formatLabeledRows(ordered)),
    fix: createRemoveRowsFix(rows, text.what),
    metadata: {
      kind,
      rows,
      labels,
      verifiedRows: [],
    },
  };
}

function columnFinding(candidates: TotalColCandidate[], tableLength: number): Finding {
  const ordered = [...candidates].sort((a, b) => a.col - b.col);
  const cols = ordered.map(candidate => candidate.col);
  const labels = ordered.map(candidate => candidate.label);
  const labeled = ordered
    .map(candidate => `列 ${toColLetter(candidate.col)}「${candidate.label}」`)
    .join(', ');
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
    message: `${ordered.length} 個の合計列が見つかりました（${labeled}）。ほかの列から計算できる値なので、横持ち→縦持ち（手順10）の前に除いておくと安全です。`,
    fix: createRemoveColsFix(cols),
    metadata: {
      kind: 'total-column',
      cols,
      labels,
      verifiedCols: [],
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

    const findings: Finding[] = [];
    for (const kind of ['grand', 'subtotal', 'restated'] as const) {
      const matched = rows.filter(candidate => candidate.kind === kind);
      if (matched.length > 0) findings.push(rowFinding(kind, matched, region.maxCols));
    }
    if (totalCols.length > 0) findings.push(columnFinding(totalCols, table.length));
    if (headings.length > 0) findings.push(headingFinding(headings, region.maxCols));
    if (findings.length === 0) findings.push(notFoundFinding());
    return findings;
  },
};
