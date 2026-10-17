import { describe, it, expect } from 'vitest';
import { deriveCheckpointStatus, deriveAllCheckpointStates, getStatusLabel, buildFixHistory } from '../utils/checkpointStatus';
import type { Finding } from '../types';

describe('deriveCheckpointStatus', () => {
  it('should return unimplemented for checks not implemented', () => {
    const status = deriveCheckpointStatus('totals', [], false);
    expect(status).toEqual({ type: 'unimplemented' });
  });

  it('should return ok with hasInfo false when no findings', () => {
    const status = deriveCheckpointStatus('encoding', [], true);
    expect(status).toEqual({ type: 'ok', hasInfo: false });
  });

  it('should return ok with hasInfo true when only info findings exist', () => {
    const findings: Finding[] = [
      {
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: 'エンコーディング: UTF-8',
      },
    ];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status).toEqual({ type: 'ok', hasInfo: true });
  });

  it('should return found with count when actionable problems exist', () => {
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

  it('should not count warnings without fix as actionable', () => {
    const findings: Finding[] = [
      {
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: 'エンコーディング: UTF-8',
      },
      {
        checkId: 'encoding',
        severity: 'warning',
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        message: '文字化けを検出',
      },
    ];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status).toEqual({ type: 'ok', hasInfo: true });
  });

  it('should count warnings with fix as actionable', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [],
        message: '空行',
        fix: { description: '削除', apply: t => t },
      },
    ];

    const status = deriveCheckpointStatus('empty', findings, true);
    expect(status).toEqual({ type: 'found', count: 1 });
  });

  it('should return fixed when had fixable findings but now none', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'info',
        ranges: [],
        message: '空行・空列は見つかりませんでした',
      },
    ];

    const fixHistory = { empty: 2 };

    const status = deriveCheckpointStatus('empty', findings, true, fixHistory);
    expect(status).toEqual({ type: 'fixed' });
  });

  it('should return ok when checkpoint has no findings', () => {
    const findings: Finding[] = [
      {
        checkId: 'other-check',
        severity: 'warning',
        ranges: [],
        message: 'Other issue',
        fix: { description: 'Fix', apply: t => t },
      },
    ];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status).toEqual({ type: 'ok', hasInfo: false });
  });
});

describe('deriveAllCheckpointStates', () => {
  it('should return states for all 11 checkpoints', () => {
    const states = deriveAllCheckpointStates([]);
    expect(states).toHaveLength(11);
  });

  it('should mark unimplemented checkpoints correctly', () => {
    const states = deriveAllCheckpointStates([]);
    
    const wideToLong = states.find(s => s.id === 'wide-to-long');
    expect(wideToLong?.implemented).toBe(false);
    expect(wideToLong?.status.type).toBe('unimplemented');

    const totals = states.find(s => s.id === 'totals');
    expect(totals?.implemented).toBe(true);
    expect(totals?.status).toEqual({ type: 'ok', hasInfo: false });

    const wareki = states.find(s => s.id === 'wareki');
    expect(wareki?.implemented).toBe(true);
    expect(wareki?.status).toEqual({ type: 'ok', hasInfo: false });

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
    
    expect(empty?.actionableCount).toBe(1);
    expect(empty?.infoCount).toBe(1);
  });

  it('should show fixed status when fix history exists but no current actionable', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'info',
        ranges: [],
        message: '空行・空列は見つかりませんでした',
      },
    ];

    const fixHistory = { empty: 1 };
    const states = deriveAllCheckpointStates(findings, fixHistory);
    const empty = states.find(s => s.id === 'empty');
    
    expect(empty?.status.type).toBe('fixed');
  });
});

describe('buildFixHistory', () => {
  it('should count actionable findings per checkpoint', () => {
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
        severity: 'warning',
        ranges: [],
        message: '空列',
        fix: { description: '削除', apply: t => t },
      },
      {
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: 'UTF-8',
      },
    ];

    const history = buildFixHistory(findings);
    
    expect(history['empty']).toBe(2);
    expect(history['encoding']).toBeUndefined();
  });
});

describe('getStatusLabel', () => {
  it('should return ○ for ok without info', () => {
    expect(getStatusLabel({ type: 'ok', hasInfo: false })).toBe('○');
  });

  it('should return ○ 情報 for ok with info', () => {
    expect(getStatusLabel({ type: 'ok', hasInfo: true })).toBe('○ 情報');
  });

  it('should return count with 件 for found', () => {
    expect(getStatusLabel({ type: 'found', count: 3 })).toBe('3件');
    expect(getStatusLabel({ type: 'found', count: 1 })).toBe('1件');
  });

  it('should return count with scope for found with rows', () => {
    expect(getStatusLabel({ type: 'found', count: 1, scope: { rows: 4 } })).toBe('1件（4行）');
  });

  it('should return count with scope for found with cols', () => {
    expect(getStatusLabel({ type: 'found', count: 1, scope: { cols: 2 } })).toBe('1件（2列）');
  });

  it('should return count with scope for found with rows and cols', () => {
    expect(getStatusLabel({ type: 'found', count: 1, scope: { rows: 3, cols: 2 } })).toBe('1件（3行・2列）');
  });

  it('should return 修正済み for fixed', () => {
    expect(getStatusLabel({ type: 'fixed' })).toBe('修正済み');
  });

  it('should return 未実装 for unimplemented', () => {
    expect(getStatusLabel({ type: 'unimplemented' })).toBe('未実装');
  });
});

describe('deriveCheckpointStatus scope calculation', () => {
  it('should include row scope when findings cover multiple rows', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [
          { startRow: 2, startCol: 0, endRow: 2, endCol: 3 },
          { startRow: 5, startCol: 0, endRow: 5, endCol: 3 },
          { startRow: 8, startCol: 0, endRow: 8, endCol: 3 },
          { startRow: 9, startCol: 0, endRow: 9, endCol: 3 },
        ],
        message: '4個の空行',
        fix: { description: '削除', apply: t => t },
      },
    ];

    const status = deriveCheckpointStatus('empty', findings, true);
    expect(status.type).toBe('found');
    if (status.type === 'found') {
      expect(status.count).toBe(1);
      expect(status.scope).toEqual({ rows: 4 });
    }
  });

  it('should not include scope when rows equals findings count', () => {
    const findings: Finding[] = [
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [{ startRow: 2, startCol: 0, endRow: 2, endCol: 3 }],
        message: '空行1',
        fix: { description: '削除', apply: t => t },
      },
      {
        checkId: 'empty',
        severity: 'warning',
        ranges: [{ startRow: 5, startCol: 0, endRow: 5, endCol: 3 }],
        message: '空行2',
        fix: { description: '削除', apply: t => t },
      },
    ];

    const status = deriveCheckpointStatus('empty', findings, true);
    expect(status.type).toBe('found');
    if (status.type === 'found') {
      expect(status.count).toBe(2);
      expect(status.scope).toBeUndefined();
    }
  });
});
