import { describe, it, expect } from 'vitest';
import { deriveCheckpointStatus, deriveAllCheckpointStates, getStatusLabel } from '../utils/checkpointStatus';
import type { Finding } from '../types';

describe('deriveCheckpointStatus', () => {
  it('should return unimplemented for checks not implemented', () => {
    const status = deriveCheckpointStatus('totals', [], false);
    expect(status).toEqual({ type: 'unimplemented' });
  });

  it('should return ok when no problems found', () => {
    const findings: Finding[] = [
      {
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: 'エンコーディング: UTF-8',
      },
    ];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status).toEqual({ type: 'ok' });
  });

  it('should return found with count when problems exist', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 2 }],
        message: '空行が見つかりました',
        fix: { description: '削除', apply: t => t },
      },
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [{ startRow: 3, startCol: 0, endRow: 3, endCol: 2 }],
        message: '空行が見つかりました',
        fix: { description: '削除', apply: t => t },
      },
    ];

    const status = deriveCheckpointStatus('empty', findings, true);
    expect(status).toEqual({ type: 'found', count: 2 });
  });

  it('should count only warnings and errors as problems', () => {
    const findings: Finding[] = [
      {
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: 'エンコーディング: UTF-8',
      },
      {
        checkId: 'encoding',
        severity: 'error',
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        message: '文字化けを検出',
      },
    ];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status).toEqual({ type: 'found', count: 1 });
  });

  it('should return ok when checkpoint has no findings', () => {
    const findings: Finding[] = [
      {
        checkId: 'other-check',
        severity: 'warning',
        ranges: [],
        message: 'Other issue',
      },
    ];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status).toEqual({ type: 'ok' });
  });
});

describe('deriveAllCheckpointStates', () => {
  it('should return states for all 11 checkpoints', () => {
    const states = deriveAllCheckpointStates([]);
    expect(states).toHaveLength(11);
  });

  it('should mark unimplemented checkpoints correctly', () => {
    const states = deriveAllCheckpointStates([]);
    
    const totals = states.find(s => s.id === 'totals');
    expect(totals?.implemented).toBe(false);
    expect(totals?.status.type).toBe('unimplemented');

    const encoding = states.find(s => s.id === 'encoding');
    expect(encoding?.implemented).toBe(true);
  });

  it('should calculate finding counts correctly', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [],
        message: '空行',
        fix: { description: '削除', apply: t => t },
      },
      {
        checkId: 'empty',
        severity: 'info',
        ranges: [],
        message: '情報',
      },
    ];

    const states = deriveAllCheckpointStates(findings);
    const empty = states.find(s => s.id === 'empty');
    
    expect(empty?.findingCount).toBe(1);
    expect(empty?.fixableCount).toBe(1);
  });
});

describe('getStatusLabel', () => {
  it('should return ○ for ok', () => {
    expect(getStatusLabel({ type: 'ok' })).toBe('○');
  });

  it('should return count with 件 for found', () => {
    expect(getStatusLabel({ type: 'found', count: 3 })).toBe('3件');
    expect(getStatusLabel({ type: 'found', count: 1 })).toBe('1件');
  });

  it('should return 修正済み for fixed', () => {
    expect(getStatusLabel({ type: 'fixed' })).toBe('修正済み');
  });

  it('should return 未実装 for unimplemented', () => {
    expect(getStatusLabel({ type: 'unimplemented' })).toBe('未実装');
  });
});
