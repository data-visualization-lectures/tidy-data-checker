export type Table = string[][];

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface MergedCell {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
}

export interface ParsedFile {
  table: Table;
  sheetName?: string;
  sheets?: SheetInfo[];
  mergedCells?: MergedCell[];
  delimiter?: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Fix {
  description: string;
  apply: (table: Table) => Table;
  deletedRows?: number[];
  deletedCols?: number[];
}

export interface Finding {
  checkId: string;
  severity: Severity;
  ranges: CellRange[];
  message: string;
  fix?: Fix;
  metadata?: Record<string, unknown>;
}

export interface CheckContext {
  fileName: string;
  encoding: string;
  hasBom: boolean;
  rawBytes?: Uint8Array;
  sheetName?: string;
  sheets?: SheetInfo[];
  mergedCells?: MergedCell[];
  delimiter?: string;
  detectedUnit?: string;
}

export interface Check {
  id: string;
  title: string;
  description: string;
  detect: (table: Table, ctx: CheckContext) => Finding[];
}

export interface HistoryEntry {
  table: Table;
  mergedCells?: MergedCell[];
  appliedFix: {
    checkId: string;
    fixDescription: string;
    timestamp: number;
  };
}

export type CheckpointStatus = 
  | { type: 'ok'; hasInfo: boolean }
  | { type: 'found'; count: number; scope?: { rows?: number; cols?: number } }
  | { type: 'fixed' }
  | { type: 'unimplemented' };

export interface CheckpointState {
  id: string;
  name: string;
  description: string;
  status: CheckpointStatus;
  actionableCount: number;
  infoCount: number;
  implemented: boolean;
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
