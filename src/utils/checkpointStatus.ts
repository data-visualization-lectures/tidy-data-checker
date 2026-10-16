import type { Finding, CheckpointStatus, CheckpointState } from '../types';
import { checkpointRegistry } from '../checks/registry';

export function deriveCheckpointStatus(
  checkpointId: string,
  findings: Finding[],
  isImplemented: boolean
): CheckpointStatus {
  if (!isImplemented) {
    return { type: 'unimplemented' };
  }

  const checkFindings = findings.filter(f => f.checkId === checkpointId);
  
  const problemFindings = checkFindings.filter(
    f => f.severity === 'error' || f.severity === 'warning'
  );
  
  const fixableFindings = problemFindings.filter(f => f.fix !== undefined);

  if (problemFindings.length === 0) {
    return { type: 'ok' };
  }

  if (fixableFindings.length === 0 && problemFindings.length > 0) {
    return { type: 'found', count: problemFindings.length };
  }

  return { type: 'found', count: problemFindings.length };
}

export function deriveAllCheckpointStates(findings: Finding[]): CheckpointState[] {
  return checkpointRegistry.map(cp => {
    const isImplemented = cp.check !== null;
    const status = deriveCheckpointStatus(cp.id, findings, isImplemented);
    
    const checkFindings = findings.filter(f => f.checkId === cp.id);
    const problemFindings = checkFindings.filter(
      f => f.severity === 'error' || f.severity === 'warning'
    );
    const fixableFindings = problemFindings.filter(f => f.fix !== undefined);

    return {
      id: cp.id,
      name: cp.name,
      description: cp.description,
      status,
      findingCount: problemFindings.length,
      fixableCount: fixableFindings.length,
      implemented: isImplemented,
    };
  });
}

export function getStatusLabel(status: CheckpointStatus): string {
  switch (status.type) {
    case 'ok':
      return '○';
    case 'found':
      return `${status.count}件`;
    case 'fixed':
      return '修正済み';
    case 'unimplemented':
      return '未実装';
  }
}
