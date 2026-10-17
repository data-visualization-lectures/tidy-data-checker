import { useState, useCallback, useMemo, useRef } from 'react';
import type { Table, Finding, HistoryEntry, CheckContext, Fix, SheetInfo, MergedCell, CheckpointState } from '../types';
import { checks } from '../checks';
import { deriveAllCheckpointStates, buildFixHistory, type FixHistory } from '../utils/checkpointStatus';
import { adjustMergedCellsForDeletedRows, adjustMergedCellsForDeletedCols } from '../utils/mergedCells';

interface TableState {
  fileName: string | null;
  encoding: string;
  hasBom: boolean;
  table: Table | null;
  correctTable: Table | null;
  encodingFixed: boolean;
  history: HistoryEntry[];
  findings: Finding[];
  selectedFinding: Finding | null;
  selectedCheckpointId: string | null;
  pendingFix: {
    finding: Finding;
    previewTable: Table;
  } | null;
  sheetName?: string;
  sheets?: SheetInfo[];
  mergedCells?: MergedCell[];
  delimiter?: string;
  tableVersion: number;
}

const initialState: TableState = {
  fileName: null,
  encoding: '',
  hasBom: false,
  table: null,
  correctTable: null,
  encodingFixed: false,
  history: [],
  findings: [],
  selectedFinding: null,
  selectedCheckpointId: null,
  pendingFix: null,
  tableVersion: 0,
};

export interface SetTableOptions {
  table: Table;
  garbledTable?: Table;
  fileName: string;
  encoding: string;
  hasBom: boolean;
  sheetName?: string;
  sheets?: SheetInfo[];
  mergedCells?: MergedCell[];
  delimiter?: string;
}

export function useTableState() {
  const [state, setState] = useState<TableState>(initialState);
  const fixHistoryRef = useRef<FixHistory>({});

  const runChecks = useCallback((table: Table, ctx: CheckContext): Finding[] => {
    const allFindings: Finding[] = [];
    for (const check of checks) {
      const findings = check.detect(table, ctx);
      allFindings.push(...findings);
    }
    return allFindings;
  }, []);

  const checkpointStates = useMemo((): CheckpointState[] => {
    return deriveAllCheckpointStates(state.findings, fixHistoryRef.current);
  }, [state.findings]);

  const filteredFindings = useMemo((): Finding[] => {
    if (!state.selectedCheckpointId) {
      return state.findings;
    }
    return state.findings.filter(f => f.checkId === state.selectedCheckpointId);
  }, [state.findings, state.selectedCheckpointId]);

  const setTable = useCallback((options: SetTableOptions) => {
    const { table, garbledTable, fileName, encoding, hasBom, sheetName, sheets, mergedCells, delimiter } = options;
    
    const needsEncodingFix = !!(garbledTable && garbledTable !== table);
    const displayTable = needsEncodingFix ? garbledTable : table;
    
    const ctx: CheckContext = { fileName, encoding, hasBom, sheetName, sheets, mergedCells, delimiter };
    const findings = runChecks(table, ctx);

    fixHistoryRef.current = buildFixHistory(findings);

    setState(prev => ({
      fileName,
      encoding,
      hasBom,
      table: displayTable,
      correctTable: needsEncodingFix ? table : null,
      encodingFixed: !needsEncodingFix,
      history: [],
      findings,
      selectedFinding: null,
      selectedCheckpointId: null,
      pendingFix: null,
      sheetName,
      sheets,
      mergedCells,
      delimiter,
      tableVersion: prev.tableVersion + 1,
    }));
  }, [runChecks]);

  const selectFinding = useCallback((finding: Finding | null) => {
    setState(prev => ({ ...prev, selectedFinding: finding, pendingFix: null }));
  }, []);

  const selectCheckpoint = useCallback((checkpointId: string | null) => {
    setState(prev => ({ 
      ...prev, 
      selectedCheckpointId: checkpointId,
      selectedFinding: null,
      pendingFix: null,
    }));
  }, []);

  const previewFix = useCallback((finding: Finding) => {
    if (!finding.fix || !state.table) return;
    if (!state.encodingFixed && finding.checkId !== 'encoding') return;

    let previewTable: Table;
    if (finding.fix.encodingConversion && state.correctTable) {
      previewTable = state.correctTable;
    } else {
      previewTable = finding.fix.apply(state.table);
    }
    
    setState(prev => ({
      ...prev,
      pendingFix: { finding, previewTable },
    }));
  }, [state.table, state.correctTable, state.encodingFixed]);

  const applyFix = useCallback(() => {
    if (!state.pendingFix || !state.table) return;

    const { finding, previewTable } = state.pendingFix;
    const fix = finding.fix as Fix;

    const historyEntry: HistoryEntry = {
      table: state.table,
      mergedCells: state.mergedCells,
      encoding: state.encoding,
      hasBom: state.hasBom,
      correctTable: state.correctTable,
      encodingFixed: state.encodingFixed,
      appliedFix: {
        checkId: finding.checkId,
        fixDescription: fix.description,
        timestamp: Date.now(),
      },
    };

    let updatedMergedCells = state.mergedCells;
    if (fix.deletedRows && fix.deletedRows.length > 0 && updatedMergedCells) {
      updatedMergedCells = adjustMergedCellsForDeletedRows(updatedMergedCells, fix.deletedRows);
    }
    if (fix.deletedCols && fix.deletedCols.length > 0 && updatedMergedCells) {
      updatedMergedCells = adjustMergedCellsForDeletedCols(updatedMergedCells, fix.deletedCols);
    }

    let updatedEncoding = state.encoding;
    let updatedHasBom = state.hasBom;
    let updatedEncodingFixed = state.encodingFixed;
    let updatedCorrectTable = state.correctTable;
    
    if (fix.encodingConversion) {
      updatedEncoding = 'UTF-8';
      updatedHasBom = false;
      updatedEncodingFixed = true;
      updatedCorrectTable = null;
    }

    const ctx: CheckContext = {
      fileName: state.fileName || '',
      encoding: updatedEncoding,
      hasBom: updatedHasBom,
      sheetName: state.sheetName,
      sheets: state.sheets,
      mergedCells: updatedMergedCells,
      delimiter: state.delimiter,
    };
    const newFindings = runChecks(previewTable, ctx);

    setState(prev => ({
      ...prev,
      table: previewTable,
      correctTable: updatedCorrectTable,
      encodingFixed: updatedEncodingFixed,
      encoding: updatedEncoding,
      hasBom: updatedHasBom,
      history: [...prev.history, historyEntry],
      findings: newFindings,
      selectedFinding: null,
      pendingFix: null,
      mergedCells: updatedMergedCells,
      tableVersion: prev.tableVersion + 1,
    }));
  }, [state, runChecks]);

  const cancelFix = useCallback(() => {
    setState(prev => ({ ...prev, pendingFix: null }));
  }, []);

  const undo = useCallback(() => {
    if (state.history.length === 0) return;

    const newHistory = [...state.history];
    const lastEntry = newHistory.pop()!;

    const restoredMergedCells = lastEntry.mergedCells;
    const restoredEncoding = lastEntry.encoding ?? state.encoding;
    const restoredHasBom = lastEntry.hasBom ?? state.hasBom;
    const restoredCorrectTable = lastEntry.correctTable ?? state.correctTable;
    const restoredEncodingFixed = lastEntry.encodingFixed ?? state.encodingFixed;

    const ctx: CheckContext = {
      fileName: state.fileName || '',
      encoding: restoredEncoding,
      hasBom: restoredHasBom,
      sheetName: state.sheetName,
      sheets: state.sheets,
      mergedCells: restoredMergedCells,
      delimiter: state.delimiter,
    };
    const newFindings = runChecks(restoredCorrectTable ?? lastEntry.table, ctx);

    setState(prev => ({
      ...prev,
      table: lastEntry.table,
      correctTable: restoredCorrectTable,
      encodingFixed: restoredEncodingFixed,
      encoding: restoredEncoding,
      hasBom: restoredHasBom,
      history: newHistory,
      findings: newFindings,
      selectedFinding: null,
      pendingFix: null,
      mergedCells: restoredMergedCells,
      tableVersion: prev.tableVersion + 1,
    }));
  }, [state.history, state.fileName, state.encoding, state.hasBom, state.correctTable, state.encodingFixed, state.sheetName, state.sheets, state.delimiter, runChecks]);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    ...state,
    checkpointStates,
    filteredFindings,
    setTable,
    selectFinding,
    selectCheckpoint,
    previewFix,
    applyFix,
    cancelFix,
    undo,
    reset,
  };
}

export type { FixHistory };
