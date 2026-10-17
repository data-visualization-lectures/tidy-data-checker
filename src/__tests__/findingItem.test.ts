import { describe, it, expect } from 'vitest';
import { getDisplaySeverity } from '../utils/displaySeverity';
import type { Finding } from '../types';

describe('getDisplaySeverity', () => {
  it('should return info for info severity findings', () => {
    const finding: Finding = {
      checkId: 'encoding',
      severity: 'info',
      ranges: [],
      message: 'UTF-8',
    };

    expect(getDisplaySeverity(finding)).toBe('info');
  });

  it('should return info for warning findings without fix', () => {
    const finding: Finding = {
      checkId: 'multi-header',
      severity: 'warning',
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 4 }],
      message: 'セル結合を検出',
    };

    expect(getDisplaySeverity(finding)).toBe('info');
  });

  it('should return info for error findings without fix', () => {
    const finding: Finding = {
      checkId: 'encoding',
      severity: 'error',
      ranges: [],
      message: 'エンコーディングエラー',
    };

    expect(getDisplaySeverity(finding)).toBe('info');
  });

  it('should return warning for warning findings with fix', () => {
    const finding: Finding = {
      checkId: 'empty',
      severity: 'warning',
      ranges: [{ startRow: 2, startCol: 0, endRow: 2, endCol: 3 }],
      message: '空行が見つかりました',
      fix: { description: '削除', apply: t => t },
    };

    expect(getDisplaySeverity(finding)).toBe('warning');
  });

  it('should return error for error findings with fix', () => {
    const finding: Finding = {
      checkId: 'encoding',
      severity: 'error',
      ranges: [],
      message: 'エンコーディングエラー',
      fix: { description: '変換', apply: t => t },
    };

    expect(getDisplaySeverity(finding)).toBe('error');
  });
});
