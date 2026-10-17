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
  history: [],
  findings: [],
  selectedFinding: null,
  selectedCheckpointId: null,
  pendingFix: null,
  tableVersion: 0,
};

export interface SetTableOptions {
  table: Table;
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
    const { table, fileName, encoding, hasBom, sheetName, sheets, mergedCells, delimiter } = options;
    const ctx: CheckContext = { fileName, encoding, hasBom, sheetName, sheets, mergedCells, delimiter };
    const findings = runChecks(table, ctx);

    fixHistoryRef.current = buildFixHistory(findings);

    setState(prev => ({
      fileName,
      encoding,
      hasBom,
      table,
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

    const previewTable = finding.fix.apply(state.table);
    setState(prev => ({
      ...prev,
      pendingFix: { finding, previewTable },
    }));
  }, [state.table]);

  const applyFix = useCallback(() => {
    if (!state.pendingFix || !state.table) return;

    const { finding, previewTable } = state.pendingFix;
    const fix = finding.fix as Fix;

    const historyEntry: HistoryEntry = {
      table: state.table,
      mergedCells: state.mergedCells,
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

    const ctx: CheckContext = {
      fileName: state.fileName || '',
      encoding: state.encoding,
      hasBom: state.hasBom,
      sheetName: state.sheetName,
      sheets: state.sheets,
      mergedCells: updatedMergedCells,
      delimiter: state.delimiter,
    };
    const newFindings = runChecks(previewTable, ctx);

    setState(prev => ({
      ...prev,
      table: previewTable,
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

    const ctx: CheckContext = {
      fileName: state.fileName || '',
      encoding: state.encoding,
      hasBom: state.hasBom,
      sheetName: state.sheetName,
      sheets: state.sheets,
      mergedCells: restoredMergedCells,
      delimiter: state.delimiter,
    };
    const newFindings = runChecks(lastEntry.table, ctx);

    setState(prev => ({
      ...prev,
      table: lastEntry.table,
      history: newHistory,
      findings: newFindings,
      selectedFinding: null,
      pendingFix: null,
      mergedCells: restoredMergedCells,
      tableVersion: prev.tableVersion + 1,
    }));
  }, [state.history, state.fileName, state.encoding, state.hasBom, state.sheetName, state.sheets, state.delimiter, runChecks]);

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
