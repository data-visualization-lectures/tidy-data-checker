export type Table = string[][];

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Fix {
  description: string;
  apply: (table: Table) => Table;
}

export interface Finding {
  checkId: string;
  severity: Severity;
  ranges: CellRange[];
  message: string;
  fix?: Fix;
}

export interface CheckContext {
  fileName: string;
  encoding: string;
  hasBom: boolean;
  rawBytes?: Uint8Array;
}

export interface Check {
  id: string;
  title: string;
  description: string;
  detect: (table: Table, ctx: CheckContext) => Finding[];
}

export interface HistoryEntry {
  table: Table;
  appliedFix: {
    checkId: string;
    fixDescription: string;
    timestamp: number;
  };
}

export interface AppState {
  fileName: string | null;
  encoding: string;
  hasBom: boolean;
  table: Table | null;
  history: HistoryEntry[];
  findings: Finding[];
  selectedFinding: Finding | null;
  pendingFix: {
    finding: Finding;
    previewTable: Table;
  } | null;
}
