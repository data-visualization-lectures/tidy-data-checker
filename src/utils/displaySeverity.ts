import type { Finding, Severity } from '../types';

export function getDisplaySeverity(finding: Finding): Severity {
  if (finding.severity === 'info') {
    return 'info';
  }
  if (!finding.fix) {
    return 'info';
  }
  return finding.severity;
}
