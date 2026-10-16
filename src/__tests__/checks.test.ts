import { describe, it, expect } from 'vitest';
import { encodingCheck } from '../checks/encoding';
import { emptyCheck } from '../checks/empty';
import type { Table, CheckContext } from '../types';

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    fileName: 'test.csv',
    encoding: 'UTF-8',
    hasBom: false,
    ...overrides,
  };
}

describe('encodingCheck', () => {
  it('should report detected encoding as info', () => {
    const table: Table = [['header'], ['value']];
    const ctx = createContext({ encoding: 'Shift_JIS' });

    const findings = encodingCheck.detect(table, ctx);

    const infoFinding = findings.find(f => f.severity === 'info');
    expect(infoFinding).toBeDefined();
    expect(infoFinding?.message).toContain('Shift_JIS');
  });

  it('should report BOM in encoding info', () => {
    const table: Table = [['header'], ['value']];
    const ctx = createContext({ encoding: 'UTF-8', hasBom: true });

    const findings = encodingCheck.detect(table, ctx);

    const infoFinding = findings.find(f => f.severity === 'info');
    expect(infoFinding?.message).toContain('BOM付き');
  });

  it('should detect U+FFFD replacement character as mojibake', () => {
    const table: Table = [['header', '文字化け\uFFFDテスト']];
    const ctx = createContext();

    const findings = encodingCheck.detect(table, ctx);

    const errorFinding = findings.find(f => f.severity === 'error');
    expect(errorFinding).toBeDefined();
    expect(errorFinding?.message).toContain('文字化け');
    expect(errorFinding?.ranges.length).toBe(1);
    expect(errorFinding?.ranges[0]).toEqual({
      startRow: 0,
      startCol: 1,
      endRow: 0,
      endCol: 1,
    });
  });

  it('should not report error for clean Japanese text', () => {
    const table: Table = [
      ['都道府県', '人口'],
      ['北海道', '5140000'],
      ['青森県', '1190000'],
    ];
    const ctx = createContext({ encoding: 'UTF-8' });

    const findings = encodingCheck.detect(table, ctx);

    const errorFinding = findings.find(f => f.severity === 'error');
    expect(errorFinding).toBeUndefined();
  });
});

describe('emptyCheck', () => {
  describe('empty rows', () => {
    it('should detect empty rows', () => {
      const table: Table = [
        ['A', 'B', 'C'],
        ['', '', ''],
        ['1', '2', '3'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);

      const rowFinding = findings.find(f => f.message.includes('空行'));
      expect(rowFinding).toBeDefined();
      expect(rowFinding?.severity).toBe('warning');
      expect(rowFinding?.ranges[0].startRow).toBe(1);
    });

    it('should detect multiple empty rows', () => {
      const table: Table = [
        ['header'],
        ['', ''],
        ['data'],
        [''],
        ['more data'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);

      const rowFinding = findings.find(f => f.message.includes('空行'));
      expect(rowFinding?.message).toContain('2 個の空行');
    });

    it('should provide fix for empty rows', () => {
      const table: Table = [
        ['A', 'B'],
        ['', ''],
        ['1', '2'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);
      const rowFinding = findings.find(f => f.message.includes('空行'));

      expect(rowFinding?.fix).toBeDefined();
      expect(rowFinding?.fix?.description).toContain('削除');

      const fixedTable = rowFinding?.fix?.apply(table);
      expect(fixedTable).toEqual([
        ['A', 'B'],
        ['1', '2'],
      ]);
    });
  });

  describe('empty columns', () => {
    it('should detect empty columns', () => {
      const table: Table = [
        ['A', '', 'C'],
        ['1', '', '3'],
        ['2', '', '4'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);

      const colFinding = findings.find(f => f.message.includes('空列'));
      expect(colFinding).toBeDefined();
      expect(colFinding?.severity).toBe('warning');
    });

    it('should provide fix for empty columns', () => {
      const table: Table = [
        ['A', '', 'C'],
        ['1', '', '3'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);
      const colFinding = findings.find(f => f.message.includes('空列'));

      expect(colFinding?.fix).toBeDefined();

      const fixedTable = colFinding?.fix?.apply(table);
      expect(fixedTable).toEqual([
        ['A', 'C'],
        ['1', '3'],
      ]);
    });
  });

  describe('no empty rows or columns', () => {
    it('should report info when no empty rows or columns found', () => {
      const table: Table = [
        ['A', 'B', 'C'],
        ['1', '2', '3'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);

      const infoFinding = findings.find(f => f.severity === 'info');
      expect(infoFinding).toBeDefined();
      expect(infoFinding?.message).toContain('見つかりませんでした');
    });
  });

  describe('whitespace handling', () => {
    it('should treat whitespace-only cells as empty', () => {
      const table: Table = [
        ['A', 'B'],
        ['  ', '\t'],
        ['1', '2'],
      ];
      const ctx = createContext();

      const findings = emptyCheck.detect(table, ctx);

      const rowFinding = findings.find(f => f.message.includes('空行'));
      expect(rowFinding).toBeDefined();
    });
  });
});

describe('fix apply is pure', () => {
  it('should not mutate original table when applying empty row fix', () => {
    const original: Table = [
      ['A', 'B'],
      ['', ''],
      ['1', '2'],
    ];
    const originalCopy = JSON.parse(JSON.stringify(original));
    const ctx = createContext();

    const findings = emptyCheck.detect(original, ctx);
    const rowFinding = findings.find(f => f.message.includes('空行'));
    rowFinding?.fix?.apply(original);

    expect(original).toEqual(originalCopy);
  });

  it('should not mutate original table when applying empty column fix', () => {
    const original: Table = [
      ['A', '', 'C'],
      ['1', '', '3'],
    ];
    const originalCopy = JSON.parse(JSON.stringify(original));
    const ctx = createContext();

    const findings = emptyCheck.detect(original, ctx);
    const colFinding = findings.find(f => f.message.includes('空列'));
    colFinding?.fix?.apply(original);

    expect(original).toEqual(originalCopy);
  });
});
