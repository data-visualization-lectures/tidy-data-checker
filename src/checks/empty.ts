import type { Check, Finding, Table, CheckContext, CellRange, Fix } from '../types';

function isRowEmpty(row: string[]): boolean {
  return row.every(cell => cell.trim() === '');
}

function isColEmpty(table: Table, colIndex: number): boolean {
  return table.every(row => {
    const cell = row[colIndex];
    return cell === undefined || cell.trim() === '';
  });
}

function getMaxCols(table: Table): number {
  return Math.max(0, ...table.map(row => row.length));
}

function createRemoveRowsFix(emptyRowIndices: number[]): Fix {
  const sorted = [...emptyRowIndices].sort((a, b) => a - b);
  const description = sorted.length === 1
    ? `行 ${sorted[0] + 1} を削除`
    : `${sorted.length} 個の空行を削除（行 ${sorted.map(i => i + 1).join(', ')}）`;

  return {
    description,
    apply: (table: Table): Table => {
      const indexSet = new Set(emptyRowIndices);
      return table.filter((_, index) => !indexSet.has(index));
    },
    deletedRows: sorted,
  };
}

function createRemoveColsFix(emptyColIndices: number[], maxCols: number): Fix {
  const sorted = [...emptyColIndices].sort((a, b) => a - b);
  const colLetters = sorted.map(i => String.fromCharCode(65 + (i % 26)));
  const description = sorted.length === 1
    ? `列 ${colLetters[0]} を削除`
    : `${sorted.length} 個の空列を削除（列 ${colLetters.join(', ')}）`;

  return {
    description,
    apply: (table: Table): Table => {
      const indexSet = new Set(emptyColIndices);
      return table.map(row => {
        const newRow: string[] = [];
        for (let col = 0; col < maxCols; col++) {
          if (!indexSet.has(col)) {
            newRow.push(row[col] ?? '');
          }
        }
        return newRow;
      });
    },
    deletedCols: sorted,
  };
}

export const emptyCheck: Check = {
  id: 'empty',
  title: '空行・空列',
  description: '意味のない空行や空列を検出します。',

  detect: (table: Table, _ctx: CheckContext): Finding[] => {
    const findings: Finding[] = [];
    const maxCols = getMaxCols(table);

    const emptyRowIndices: number[] = [];
    for (let row = 0; row < table.length; row++) {
      if (isRowEmpty(table[row])) {
        emptyRowIndices.push(row);
      }
    }

    if (emptyRowIndices.length > 0) {
      const ranges: CellRange[] = emptyRowIndices.map(row => ({
        startRow: row,
        startCol: 0,
        endRow: row,
        endCol: Math.max(0, maxCols - 1),
      }));

      findings.push({
        checkId: 'empty',
        severity: 'warning',
        ranges,
        message: `${emptyRowIndices.length} 個の空行が見つかりました。`,
        fix: createRemoveRowsFix(emptyRowIndices),
      });
    }

    const emptyColIndices: number[] = [];
    for (let col = 0; col < maxCols; col++) {
      if (isColEmpty(table, col)) {
        emptyColIndices.push(col);
      }
    }

    if (emptyColIndices.length > 0) {
      const ranges: CellRange[] = emptyColIndices.map(col => ({
        startRow: 0,
        startCol: col,
        endRow: Math.max(0, table.length - 1),
        endCol: col,
      }));

      findings.push({
        checkId: 'empty',
        severity: 'warning',
        ranges,
        message: `${emptyColIndices.length} 個の空列が見つかりました。`,
        fix: createRemoveColsFix(emptyColIndices, maxCols),
      });
    }

    if (emptyRowIndices.length === 0 && emptyColIndices.length === 0) {
      findings.push({
        checkId: 'empty',
        severity: 'info',
        ranges: [],
        message: '空行・空列は見つかりませんでした。',
      });
    }

    return findings;
  },
};
