import type { Finding, CheckpointStatus, CheckpointState } from '../types';
import { checkpointRegistry } from '../checks/registry';

export interface FixHistory {
  [checkpointId: string]: number;
}

function calculateScope(findings: Finding[]): { rows?: number; cols?: number } | undefined {
  const affectedRows = new Set<number>();
  const affectedCols = new Set<number>();
  let hasRowScope = false;
  let hasColScope = false;

  for (const finding of findings) {
    for (const range of finding.ranges) {
      const isFullRow = range.startCol === 0 && range.endCol >= 0;
      const isFullCol = range.startRow === 0 && range.endRow >= 0;
      
      if (isFullRow || range.startRow === range.endRow) {
        for (let r = range.startRow; r <= range.endRow; r++) {
          affectedRows.add(r);
        }
        hasRowScope = true;
      }
      
      if (isFullCol && range.startCol === range.endCol) {
        for (let c = range.startCol; c <= range.endCol; c++) {
          affectedCols.add(c);
        }
        hasColScope = true;
      }
    }
  }

  if (!hasRowScope && !hasColScope) {
    return undefined;
  }

  const scope: { rows?: number; cols?: number } = {};
  if (hasRowScope && affectedRows.size > findings.length) {
    scope.rows = affectedRows.size;
  }
  if (hasColScope && affectedCols.size > findings.length) {
    scope.cols = affectedCols.size;
  }

  return Object.keys(scope).length > 0 ? scope : undefined;
}

export function deriveCheckpointStatus(
  checkpointId: string,
  findings: Finding[],
  isImplemented: boolean,
  fixHistory: FixHistory = {}
): CheckpointStatus {
  if (!isImplemented) {
    return { type: 'unimplemented' };
  }

  const checkFindings = findings.filter(f => f.checkId === checkpointId);
  
  const actionableFindings = checkFindings.filter(
    f => (f.severity === 'error' || f.severity === 'warning') && f.fix !== undefined
  );
  
  const infoFindings = checkFindings.filter(f => f.severity === 'info');
  const hasInfo = infoFindings.length > 0;

  if (actionableFindings.length === 0) {
    const hadFixableFindings = (fixHistory[checkpointId] || 0) > 0;
    if (hadFixableFindings) {
      return { type: 'fixed' };
    }
    return { type: 'ok', hasInfo };
  }

  const scope = calculateScope(actionableFindings);
  return { type: 'found', count: actionableFindings.length, scope };
}

export function deriveAllCheckpointStates(
  findings: Finding[],
  fixHistory: FixHistory = {}
): CheckpointState[] {
  return checkpointRegistry.map(cp => {
    const isImplemented = cp.check !== null;
    const status = deriveCheckpointStatus(cp.id, findings, isImplemented, fixHistory);
    
    const checkFindings = findings.filter(f => f.checkId === cp.id);
    const actionableFindings = checkFindings.filter(
      f => (f.severity === 'error' || f.severity === 'warning') && f.fix !== undefined
    );
    const infoFindings = checkFindings.filter(f => f.severity === 'info');

    return {
      id: cp.id,
      name: cp.name,
      description: cp.description,
      status,
      actionableCount: actionableFindings.length,
      infoCount: infoFindings.length,
      implemented: isImplemented,
    };
  });
}

export function getStatusLabel(status: CheckpointStatus): string {
  switch (status.type) {
    case 'ok':
      return status.hasInfo ? '○ 情報' : '○';
    case 'found': {
      let label = `${status.count}件`;
      if (status.scope) {
        const parts: string[] = [];
        if (status.scope.rows) {
          parts.push(`${status.scope.rows}行`);
        }
        if (status.scope.cols) {
          parts.push(`${status.scope.cols}列`);
        }
        if (parts.length > 0) {
          label += `（${parts.join('・')}）`;
        }
      }
      return label;
    }
    case 'fixed':
      return '修正済み';
    case 'unimplemented':
      return '未実装';
    case 'pending-encoding':
      return status.message;
  }
}

export function buildFixHistory(findings: Finding[]): FixHistory {
  const history: FixHistory = {};
  for (const finding of findings) {
    if ((finding.severity === 'error' || finding.severity === 'warning') && finding.fix) {
      history[finding.checkId] = (history[finding.checkId] || 0) + 1;
    }
  }
  return history;
}
