import type { Check, Finding, Table, CheckContext, Fix } from '../types';
import { matchSymbol, classifyColumns, type SymbolKind, type ColumnKind } from '../utils/values';
import { createCellEditFix, type CellEdit } from '../utils/cellEdit';
import { getDataRegion, isDataRow, getColumnLabel, type DataRegion } from '../utils/dataRegion';
import { cellsToRanges } from '../utils/cellRef';

interface SymbolCell {
  row: number;
  col: number;
  raw: string;
  kind: SymbolKind;
  replacement: string;
}

const KIND_ORDER: SymbolKind[] = ['missing', 'dash', 'negative', 'marker', 'unknown'];

/** 注記列の代替案を出す列数の上限（これを超える横持ち表では出さない） */
const NOTE_COLUMN_LIMIT = 5;

function collectSymbolCells(table: Table, region: DataRegion, kinds: ColumnKind[]): SymbolCell[] {
  const cells: SymbolCell[] = [];
  for (let row = region.firstDataRow; row <= region.lastDataRow; row++) {
    if (!isDataRow(table, row, region)) continue;
    const rowCells = table[row];
    for (let col = 0; col < region.maxCols; col++) {
      if (kinds[col] !== 'numeric') continue;
      const raw = rowCells?.[col] ?? '';
      if (raw.trim() === '') continue;
      const match = matchSymbol(raw);
      if (!match) continue;
      cells.push({
        row,
        col,
        raw,
        kind: match.kind,
        replacement: match.replacement,
      });
    }
  }
  return cells;
}

function symbolLabel(cell: SymbolCell): string {
  const trimmed = cell.raw.trim();
  if (cell.kind === 'negative') {
    return /[△▲▼]/.exec(trimmed)?.[0] ?? trimmed;
  }
  if (cell.kind === 'marker') {
    const at = trimmed.indexOf(cell.replacement);
    if (at < 0 || cell.replacement === '') return trimmed;
    return `${trimmed.slice(0, at)}${trimmed.slice(at + cell.replacement.length)}`.trim();
  }
  return trimmed;
}

function countLabels(cells: SymbolCell[]): { counts: Record<string, number>; order: string[] } {
  const counts: Record<string, number> = {};
  const order: string[] = [];
  for (const cell of cells) {
    const label = symbolLabel(cell);
    if (counts[label] === undefined) {
      counts[label] = 0;
      order.push(label);
    }
    counts[label] += 1;
  }
  return { counts, order };
}

function messageFor(kind: SymbolKind, count: number, order: string[], counts: Record<string, number>): string {
  switch (kind) {
    case 'missing': {
      const detail = order.map(label => `${label}: ${counts[label]}`).join(', ');
      return `欠損・秘匿を表す記号が ${count} 個見つかりました（${detail}）。数値の列に文字が混ざっていると、表計算ソフトや Python で数値として扱えません。空欄にすると「値なし」として読み込めます。`;
    }
    case 'dash':
      return `「-」などのダッシュが ${count} 個見つかりました。統計表では「該当する数字がない」を表すことが多い記号です。`;
    case 'negative':
      return `△・▲ の付いた数値が ${count} 個見つかりました。日本の統計ではマイナス（減少）を表します。`;
    case 'marker':
      return `注記マーク（※・*・p など）の付いた数値が ${count} 個見つかりました。マークを外すと数値として扱えます。`;
    case 'unknown': {
      const examples = order.slice(0, 2).map(label => `「${label}」`).join('');
      return `数値の列に、自動では判断できない記号が ${count} 個あります（例: ${examples}）。意味が変わるおそれがあるので、必要なら元の資料で確認してください。`;
    }
  }
}

function fixDescription(kind: SymbolKind, count: number): string | null {
  switch (kind) {
    case 'missing':
      return `記号を空欄にする（${count} セル）`;
    case 'dash':
      return `「-」を空欄にする（${count} セル）`;
    case 'negative':
      return `△・▲ をマイナス記号に置き換える（${count} セル）`;
    case 'marker':
      return `注記マークを外す（${count} セル）`;
    case 'unknown':
      return null;
  }
}

function noteValue(cell: SymbolCell): string {
  if (cell.kind !== 'marker') return cell.raw;
  const mark = symbolLabel(cell);
  return mark === '' ? cell.raw : mark;
}

function createDashToZeroFix(cells: SymbolCell[]): Fix {
  return createCellEditFix(
    `「-」を 0 にする（${cells.length} セル）`,
    cells.map(cell => ({ row: cell.row, col: cell.col, value: '0' })),
  );
}

function dashToZeroFinding(cells: SymbolCell[]): Finding {
  const { counts } = countLabels(cells);
  const cols = [...new Set(cells.map(cell => cell.col))].sort((a, b) => a - b);
  return {
    checkId: 'symbols',
    severity: 'info',
    ranges: cellsToRanges(cells),
    message: '別の方法：「-」を 0 にすることもできます。「該当なし＝0」とみなせる資料のときに使います。',
    metadata: { kind: 'dash-to-zero', counts, cols },
    fix: createDashToZeroFix(cells),
  };
}

function createFlagColumnsFix(table: Table, region: DataRegion, cells: SymbolCell[]): Fix {
  const sourceCols = [...new Set(cells.map(cell => cell.col))].sort((a, b) => a - b);
  const baseCol = region.maxCols;
  const edits: CellEdit[] = [];

  sourceCols.forEach((srcCol, index) => {
    const destCol = baseCol + index;
    const header = `${getColumnLabel(table, srcCol, region)}_注記`;
    for (let row = 0; row < table.length; row++) {
      edits.push({
        row,
        col: destCol,
        value: row === region.headerRow ? header : '',
      });
    }
  });

  for (const cell of cells) {
    const destCol = baseCol + sourceCols.indexOf(cell.col);
    edits.push({ row: cell.row, col: destCol, value: noteValue(cell) });
    edits.push({ row: cell.row, col: cell.col, value: cell.replacement });
  }

  return createCellEditFix(`記号を注記列に移す（${sourceCols.length} 列追加）`, edits);
}

function flagColumnsFinding(table: Table, region: DataRegion, cells: SymbolCell[]): Finding {
  const { counts } = countLabels(cells);
  const cols = [...new Set(cells.map(cell => cell.col))].sort((a, b) => a - b);
  return {
    checkId: 'symbols',
    severity: 'info',
    ranges: cellsToRanges(cells),
    message: `別の方法：消す前に、元の記号を「従業者数_注記」などの列に残せます（${cols.length} 列追加）。秘匿と不詳を区別したいときに使います。`,
    metadata: { kind: 'flag-columns', counts, cols },
    fix: createFlagColumnsFix(table, region, cells),
  };
}

function appendAlternatives(findings: Finding[], table: Table, region: DataRegion, cells: SymbolCell[]): void {
  const dashCells = cells.filter(cell => cell.kind === 'dash');
  if (dashCells.length > 0) findings.push(dashToZeroFinding(dashCells));

  const flagCells = cells.filter(cell => cell.kind === 'missing' || cell.kind === 'dash' || cell.kind === 'marker');
  const columnCount = new Set(flagCells.map(cell => cell.col)).size;
  if (columnCount > 0 && columnCount <= NOTE_COLUMN_LIMIT) {
    findings.push(flagColumnsFinding(table, region, flagCells));
  }
}

function findingFor(kind: SymbolKind, cells: SymbolCell[]): Finding {
  const { counts, order } = countLabels(cells);
  const description = fixDescription(kind, cells.length);
  const cols = [...new Set(cells.map(cell => cell.col))].sort((a, b) => a - b);
  const finding: Finding = {
    checkId: 'symbols',
    severity: kind === 'unknown' ? 'info' : 'warning',
    ranges: cellsToRanges(cells),
    message: messageFor(kind, cells.length, order, counts),
    metadata: { kind, counts, cols },
  };
  if (description) {
    finding.fix = createCellEditFix(
      description,
      cells.map(cell => ({ row: cell.row, col: cell.col, value: cell.replacement })),
    );
  }
  return finding;
}

export const symbolsCheck: Check = {
  id: 'symbols',
  title: '値の中の記号',
  description: '※、-、…、x、秘匿などの記号を検出し、欠損値として処理できます。',

  detect(table: Table, _ctx: CheckContext): Finding[] {
    const region = getDataRegion(table);
    const kinds = classifyColumns(table, region);
    const cells = collectSymbolCells(table, region, kinds);

    const findings: Finding[] = [];
    for (const kind of KIND_ORDER) {
      if (kind === 'unknown') appendAlternatives(findings, table, region, cells);
      const group = cells.filter(cell => cell.kind === kind);
      if (group.length > 0) findings.push(findingFor(kind, group));
    }
    if (findings.length > 0) return findings;

    return [{
      checkId: 'symbols',
      severity: 'info',
      ranges: [],
      message: '値の中の記号は見つかりませんでした。',
    }];
  },
};
