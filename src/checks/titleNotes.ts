import type { Check, Finding, Table, CheckContext, Fix, CellRange } from '../types';

const TITLE_PATTERNS = [
  /^[　\s]*表\d+/,
  /^[　\s]*第\d+表/,
  /^[　\s]*図表/,
  /^[　\s]*統計表/,
  /別表/,
  /一覧表/,
  /（令和|平成|昭和）.*年/,
  /\d{4}年度?/,
];

const NOTE_PATTERNS = [
  /^[　\s]*注[：:）)]/,
  /^[　\s]*注[0-9０-９]*[：:）)]/,
  /^[　\s]*※/,
  /^[　\s]*＊/,
  /^[　\s]*\*/,
  /^[　\s]*資料[：:）)]/,
  /^[　\s]*出典[：:）)]/,
  /^[　\s]*出所[：:）)]/,
  /^[　\s]*備考[：:）)]/,
  /^[　\s]*（注）/,
  /^[　\s]*\(注\)/,
];

const UNIT_PATTERNS = [
  /単位[：:]\s*(.+)/,
  /（単位[：:]?\s*(.+?)）/,
  /\(単位[：:]?\s*(.+?)\)/,
  /単位\s*[：:]\s*(.+)/,
];

interface RowClassification {
  type: 'title' | 'note' | 'unit' | 'data';
  content: string;
  unitValue?: string;
}

function classifyRow(row: string[]): RowClassification {
  const nonEmptyCells = row.filter(cell => cell.trim() !== '');
  if (nonEmptyCells.length === 0) {
    return { type: 'data', content: '' };
  }

  const firstCell = row[0]?.trim() || '';
  const fullRow = row.join(' ').trim();

  for (const pattern of UNIT_PATTERNS) {
    const match = fullRow.match(pattern);
    if (match) {
      return { type: 'unit', content: fullRow, unitValue: match[1]?.trim() };
    }
  }

  if (nonEmptyCells.length <= 2) {
    for (const pattern of TITLE_PATTERNS) {
      if (pattern.test(firstCell) || pattern.test(fullRow)) {
        return { type: 'title', content: fullRow };
      }
    }
  }

  for (const pattern of NOTE_PATTERNS) {
    if (pattern.test(firstCell) || pattern.test(fullRow)) {
      return { type: 'note', content: fullRow };
    }
  }

  return { type: 'data', content: fullRow };
}

function findDataStartRow(table: Table): number {
  let consecutiveDataRows = 0;
  for (let i = 0; i < table.length; i++) {
    const classification = classifyRow(table[i]);
    if (classification.type === 'data') {
      const nonEmpty = table[i].filter(c => c.trim()).length;
      if (nonEmpty >= 2) {
        consecutiveDataRows++;
        if (consecutiveDataRows >= 2) {
          return i - 1;
        }
      }
    } else {
      consecutiveDataRows = 0;
    }
  }
  return 0;
}

function findDataEndRow(table: Table): number {
  for (let i = table.length - 1; i >= 0; i--) {
    const classification = classifyRow(table[i]);
    if (classification.type === 'data') {
      const nonEmpty = table[i].filter(c => c.trim()).length;
      if (nonEmpty >= 2) {
        return i;
      }
    }
  }
  return table.length - 1;
}

function createRemoveTitleRowsFix(rowIndices: number[]): Fix {
  const sorted = [...rowIndices].sort((a, b) => a - b);
  return {
    description: `タイトル行を削除（行 ${sorted.map(i => i + 1).join(', ')}）`,
    apply: (table: Table): Table => {
      const indexSet = new Set(rowIndices);
      return table.filter((_, index) => !indexSet.has(index));
    },
  };
}

function createRemoveNoteRowsFix(rowIndices: number[]): Fix {
  const sorted = [...rowIndices].sort((a, b) => a - b);
  return {
    description: `注記行を削除（行 ${sorted.map(i => i + 1).join(', ')}）`,
    apply: (table: Table): Table => {
      const indexSet = new Set(rowIndices);
      return table.filter((_, index) => !indexSet.has(index));
    },
  };
}

export const titleNotesCheck: Check = {
  id: 'title-notes',
  title: '表の上下（タイトル・注記行）',
  description: 'データ表の前後にあるタイトル行、単位行、注記行を検出します。',

  detect: (table: Table, ctx: CheckContext): Finding[] => {
    const findings: Finding[] = [];
    const maxCols = Math.max(0, ...table.map(row => row.length));

    const dataStartRow = findDataStartRow(table);
    const dataEndRow = findDataEndRow(table);

    const titleRows: number[] = [];
    const unitRows: { row: number; unit: string }[] = [];

    for (let i = 0; i < dataStartRow; i++) {
      const classification = classifyRow(table[i]);
      if (classification.type === 'title') {
        titleRows.push(i);
      } else if (classification.type === 'unit' && classification.unitValue) {
        unitRows.push({ row: i, unit: classification.unitValue });
      }
    }

    const noteRows: number[] = [];
    for (let i = dataEndRow + 1; i < table.length; i++) {
      const classification = classifyRow(table[i]);
      if (classification.type === 'note' || classification.type === 'title') {
        noteRows.push(i);
      } else if (classification.type === 'unit' && classification.unitValue) {
        unitRows.push({ row: i, unit: classification.unitValue });
      }
    }

    if (titleRows.length > 0) {
      const ranges: CellRange[] = titleRows.map(row => ({
        startRow: row,
        startCol: 0,
        endRow: row,
        endCol: Math.max(0, maxCols - 1),
      }));

      findings.push({
        checkId: 'title-notes',
        severity: 'warning',
        ranges,
        message: `${titleRows.length} 個のタイトル行が検出されました（行 ${titleRows.map(i => i + 1).join(', ')}）。データ分析には不要な場合が多いです。`,
        fix: createRemoveTitleRowsFix(titleRows),
      });
    }

    if (unitRows.length > 0) {
      const unitValues = unitRows.map(u => u.unit).join(', ');
      const ranges: CellRange[] = unitRows.map(u => ({
        startRow: u.row,
        startCol: 0,
        endRow: u.row,
        endCol: Math.max(0, maxCols - 1),
      }));

      findings.push({
        checkId: 'title-notes',
        severity: 'info',
        ranges,
        message: `単位行を検出: ${unitValues}（後のステップで値変換に使用できます）`,
        metadata: { units: unitRows.map(u => u.unit), detectedUnit: unitRows[0]?.unit },
      });

      if (ctx.detectedUnit === undefined && unitRows.length > 0) {
        ctx.detectedUnit = unitRows[0].unit;
      }
    }

    if (noteRows.length > 0) {
      const ranges: CellRange[] = noteRows.map(row => ({
        startRow: row,
        startCol: 0,
        endRow: row,
        endCol: Math.max(0, maxCols - 1),
      }));

      findings.push({
        checkId: 'title-notes',
        severity: 'warning',
        ranges,
        message: `${noteRows.length} 個の注記行が検出されました（行 ${noteRows.map(i => i + 1).join(', ')}）。出典や注釈を含んでいます。`,
        fix: createRemoveNoteRowsFix(noteRows),
      });
    }

    if (titleRows.length === 0 && noteRows.length === 0 && unitRows.length === 0) {
      findings.push({
        checkId: 'title-notes',
        severity: 'info',
        ranges: [],
        message: 'タイトル行・注記行は検出されませんでした。',
      });
    }

    return findings;
  },
};
