import type { Check, Finding, Table, CheckContext } from '../types';
import { matchSymbol, classifyColumns, type SymbolKind, type ColumnKind } from '../utils/values';
import { createCellEditFix } from '../utils/cellEdit';
import { getDataRegion, isDataRow, type DataRegion } from '../utils/dataRegion';
import { cellsToRanges } from '../utils/cellRef';

interface SymbolCell {
  row: number;
  col: number;
  raw: string;
  kind: SymbolKind;
  replacement: string;
}

const KIND_ORDER: SymbolKind[] = ['missing', 'dash', 'negative', 'marker', 'unknown'];

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
