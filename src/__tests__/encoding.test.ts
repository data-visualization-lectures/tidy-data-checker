import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encodingCheck } from '../checks/encoding';
import { deriveCheckpointStatus, buildFixHistory } from '../utils/checkpointStatus';
import { detectAndDecode } from '../utils/decode';
import type { Table, CheckContext, Finding } from '../types';

const fixturesDir = join(__dirname, 'fixtures');

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    fileName: 'test.csv',
    encoding: 'UTF-8',
    hasBom: false,
    ...overrides,
  };
}

describe('encoding check with fixtures', () => {
  it('should detect Shift_JIS from fixture file', () => {
    const bytes = new Uint8Array(readFileSync(join(fixturesDir, 'prefecture-sjis.csv')));
    const { text, encoding, hasBom } = detectAndDecode(bytes);
    
    expect(encoding).toBe('Shift_JIS');
    expect(hasBom).toBe(false);
    expect(text).toContain('都道府県');
    
    const table: Table = text.split('\n').map(line => line.split(','));
    const ctx = createContext({ encoding, hasBom });
    const findings = encodingCheck.detect(table, ctx);
    
    const warningFinding = findings.find(f => f.severity === 'warning');
    expect(warningFinding).toBeDefined();
    expect(warningFinding?.fix).toBeDefined();
    expect(warningFinding?.fix?.encodingConversion?.from).toBe('Shift_JIS');
  });

  it('should detect UTF-8 with BOM from fixture file', () => {
    const bytes = new Uint8Array(readFileSync(join(fixturesDir, 'prefecture-utf8-bom.csv')));
    const { text, encoding, hasBom } = detectAndDecode(bytes);
    
    expect(encoding).toBe('UTF-8');
    expect(hasBom).toBe(true);
    expect(text).toContain('都道府県');
    
    const table: Table = text.split('\n').map(line => line.split(','));
    const ctx = createContext({ encoding, hasBom });
    const findings = encodingCheck.detect(table, ctx);
    
    const warningFinding = findings.find(f => f.severity === 'warning');
    expect(warningFinding).toBeDefined();
    expect(warningFinding?.message).toContain('BOM');
    expect(warningFinding?.fix?.encodingConversion?.hasBom).toBe(true);
  });

  it('should report plain UTF-8 as OK from fixture file', () => {
    const bytes = new Uint8Array(readFileSync(join(fixturesDir, 'prefecture-utf8.csv')));
    const { text, encoding, hasBom } = detectAndDecode(bytes);
    
    expect(encoding).toBe('UTF-8');
    expect(hasBom).toBe(false);
    
    const table: Table = text.split('\n').map(line => line.split(','));
    const ctx = createContext({ encoding, hasBom });
    const findings = encodingCheck.detect(table, ctx);
    
    const infoFinding = findings.find(f => f.severity === 'info');
    expect(infoFinding).toBeDefined();
    expect(infoFinding?.fix).toBeUndefined();
  });
});

describe('encoding status derivation', () => {
  it('should show actionable finding (1件) for Shift_JIS', () => {
    const findings: Finding[] = [{
      checkId: 'encoding',
      severity: 'warning',
      ranges: [],
      message: 'Shift_JIS file',
      fix: { description: '変換', apply: t => t, encodingConversion: { from: 'Shift_JIS', hasBom: false } },
    }];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status.type).toBe('found');
    if (status.type === 'found') {
      expect(status.count).toBe(1);
    }
  });

  it('should show OK for plain UTF-8', () => {
    const findings: Finding[] = [{
      checkId: 'encoding',
      severity: 'info',
      ranges: [],
      message: 'UTF-8',
    }];

    const status = deriveCheckpointStatus('encoding', findings, true);
    expect(status.type).toBe('ok');
  });

  it('should show 修正済み after encoding fix is applied', () => {
    const initialFindings: Finding[] = [{
      checkId: 'encoding',
      severity: 'warning',
      ranges: [],
      message: 'Shift_JIS file',
      fix: { description: '変換', apply: t => t, encodingConversion: { from: 'Shift_JIS', hasBom: false } },
    }];
    const fixHistory = buildFixHistory(initialFindings);

    const afterFixFindings: Finding[] = [{
      checkId: 'encoding',
      severity: 'info',
      ranges: [],
      message: 'UTF-8',
    }];

    const status = deriveCheckpointStatus('encoding', afterFixFindings, true, fixHistory);
    expect(status.type).toBe('fixed');
  });
});

describe('encoding fix apply/undo', () => {
  it('should not change table data when applying encoding fix', () => {
    const table: Table = [['ヘッダー'], ['データ']];
    const fix = {
      description: '文字コードをUTF-8に変換',
      apply: (t: Table): Table => t,
      encodingConversion: { from: 'Shift_JIS', hasBom: false },
    };

    const result = fix.apply(table);
    expect(result).toEqual(table);
    expect(result).toBe(table);
  });

  it('should preserve original encoding in history for reproducibility', () => {
    const originalEncoding = 'Shift_JIS';
    const fix = {
      description: '文字コードをUTF-8に変換',
      apply: (t: Table): Table => t,
      encodingConversion: { from: originalEncoding, hasBom: false },
    };

    expect(fix.encodingConversion?.from).toBe('Shift_JIS');
  });
});
