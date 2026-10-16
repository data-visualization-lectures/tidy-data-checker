import type { Check, Finding, Table, CheckContext, Fix, CellRange, MergedCell } from '../types';

interface HeaderAnalysis {
  headerRowCount: number;
  hasMultiRowHeader: boolean;
  hasMergedHeaders: boolean;
  mergedHeaderCells: MergedCell[];
  headerRows: number[];
}

function isLikelyHeaderRow(row: string[], rowIndex: number, table: Table): boolean {
  const nonEmptyCells = row.filter(cell => cell.trim() !== '');
  if (nonEmptyCells.length === 0) return false;

  const hasNumbers = row.some(cell => /^\d+([,，]\d{3})*(\.\d+)?$/.test(cell.trim()));
  if (hasNumbers && rowIndex > 0) return false;

  const nextRow = table[rowIndex + 1];
  if (nextRow) {
    const nextHasNumbers = nextRow.some(cell => /^\d+([,，]\d{3})*(\.\d+)?$/.test(cell.trim()));
    if (nextHasNumbers) return true;
  }

  return rowIndex === 0;
}

function analyzeHeaders(table: Table, mergedCells: MergedCell[] = []): HeaderAnalysis {
  const headerRows: number[] = [];

  for (let i = 0; i < Math.min(5, table.length); i++) {
    if (isLikelyHeaderRow(table[i], i, table)) {
      headerRows.push(i);
    } else if (headerRows.length > 0) {
      break;
    }
  }

  const mergedHeaderCells = mergedCells.filter(mc =>
    headerRows.some(hr => mc.startRow <= hr && mc.endRow >= hr)
  );

  const hasMultiRowHeader = headerRows.length > 1 ||
    mergedCells.some(mc => mc.startRow < headerRows.length && mc.endRow > mc.startRow);

  return {
    headerRowCount: Math.max(1, headerRows.length),
    hasMultiRowHeader,
    hasMergedHeaders: mergedHeaderCells.length > 0,
    mergedHeaderCells,
    headerRows: headerRows.length > 0 ? headerRows : [0],
  };
}

function detectBlankFilledHeaders(table: Table, headerRows: number[]): number[] {
  if (headerRows.length === 0) return [];

  const blankFilledCols: number[] = [];
  const firstHeaderRow = headerRows[0];
  const maxCols = Math.max(0, ...table.map(r => r.length));

  for (let col = 0; col < maxCols; col++) {
    const firstHeaderCell = table[firstHeaderRow]?.[col]?.trim() || '';
    if (firstHeaderCell === '') continue;

    let hasBlankBelow = false;
    for (let i = 1; i < headerRows.length; i++) {
      const cell = table[headerRows[i]]?.[col]?.trim() || '';
      if (cell === '' || cell === firstHeaderCell) {
        hasBlankBelow = true;
      }
    }

    if (hasBlankBelow && headerRows.length > 1) {
      blankFilledCols.push(col);
    }
  }

  return blankFilledCols;
}

function flattenHeaders(table: Table, headerRowCount: number): string[] {
  if (headerRowCount <= 0 || table.length === 0) return [];

  const maxCols = Math.max(0, ...table.map(r => r.length));
  const flatHeaders: string[] = [];

  for (let col = 0; col < maxCols; col++) {
    const parts: string[] = [];

    for (let row = 0; row < headerRowCount; row++) {
      const cell = table[row]?.[col]?.trim() || '';
      if (cell && !parts.includes(cell)) {
        parts.push(cell);
      }
    }

    flatHeaders.push(parts.join('_') || `列${col + 1}`);
  }

  return flatHeaders;
}

function createFlattenHeadersFix(headerRowCount: number): Fix {
  return {
    description: `${headerRowCount}行のヘッダーを1行に統合（例: "人口_男"）`,
    apply: (table: Table): Table => {
      if (table.length <= headerRowCount) return table;

      const flatHeaders = flattenHeaders(table, headerRowCount);
      const dataRows = table.slice(headerRowCount);

      return [flatHeaders, ...dataRows];
    },
  };
}

function createFillDownMergedFix(mergedCells: MergedCell[]): Fix {
  return {
    description: '結合セルの値を下方向に展開',
    apply: (table: Table): Table => {
      const newTable = table.map(row => [...row]);

      for (const mc of mergedCells) {
        const value = newTable[mc.startRow]?.[mc.startCol] || '';
        for (let r = mc.startRow; r <= mc.endRow && r < newTable.length; r++) {
          for (let c = mc.startCol; c <= mc.endCol; c++) {
            if (!newTable[r]) newTable[r] = [];
            if (newTable[r][c] === undefined || newTable[r][c] === '') {
              newTable[r][c] = value;
            }
          }
        }
      }

      return newTable;
    },
  };
}

export const multiHeaderCheck: Check = {
  id: 'multi-header',
  title: '多段ヘッダー・セル結合',
  description: '複数行にまたがるヘッダーやセル結合を検出します。',

  detect: (table: Table, ctx: CheckContext): Finding[] => {
    const findings: Finding[] = [];
    const maxCols = Math.max(0, ...table.map(row => row.length));
    const mergedCells = ctx.mergedCells || [];

    const analysis = analyzeHeaders(table, mergedCells);

    if (analysis.hasMultiRowHeader) {
      const ranges: CellRange[] = analysis.headerRows.map(row => ({
        startRow: row,
        startCol: 0,
        endRow: row,
        endCol: Math.max(0, maxCols - 1),
      }));

      const exampleHeaders = flattenHeaders(table, analysis.headerRowCount).slice(0, 3);
      const example = exampleHeaders.length > 0 ? `（例: ${exampleHeaders.join(', ')}...）` : '';

      findings.push({
        checkId: 'multi-header',
        severity: 'warning',
        ranges,
        message: `${analysis.headerRowCount}行の多段ヘッダーを検出しました。1行に統合することで分析しやすくなります。${example}`,
        fix: createFlattenHeadersFix(analysis.headerRowCount),
      });
    }

    const blankFilledCols = detectBlankFilledHeaders(table, analysis.headerRows);
    if (blankFilledCols.length > 0 && !analysis.hasMultiRowHeader) {
      findings.push({
        checkId: 'multi-header',
        severity: 'info',
        ranges: [],
        message: `空白で埋められたヘッダーセルが ${blankFilledCols.length} 列で検出されました。`,
      });
    }

    const bodyMergedCells = mergedCells.filter(mc =>
      mc.startRow >= analysis.headerRowCount
    );

    if (bodyMergedCells.length > 0) {
      const ranges: CellRange[] = bodyMergedCells.map(mc => ({
        startRow: mc.startRow,
        startCol: mc.startCol,
        endRow: mc.endRow,
        endCol: mc.endCol,
      }));

      findings.push({
        checkId: 'multi-header',
        severity: 'warning',
        ranges,
        message: `データ領域に ${bodyMergedCells.length} 個のセル結合があります。結合セルの値を下方向に展開できます。`,
        fix: createFillDownMergedFix(bodyMergedCells),
      });
    }

    if (!analysis.hasMultiRowHeader && bodyMergedCells.length === 0 && analysis.mergedHeaderCells.length === 0) {
      findings.push({
        checkId: 'multi-header',
        severity: 'info',
        ranges: [],
        message: '多段ヘッダー・セル結合は検出されませんでした。',
      });
    }

    return findings;
  },
};
