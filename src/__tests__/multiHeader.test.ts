import { describe, it, expect } from 'vitest';
import { multiHeaderCheck } from '../checks/multiHeader';
import type { Table, CheckContext, MergedCell } from '../types';

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    fileName: 'test.xlsx',
    encoding: 'Excel',
    hasBom: false,
    ...overrides,
  };
}

describe('multiHeaderCheck', () => {
  describe('multi-row header detection', () => {
    it('should detect 2-row header', () => {
      const table: Table = [
        ['', '人口', '人口', '世帯数'],
        ['都道府県', '男', '女', ''],
        ['北海道', '2500000', '2640000', '2890000'],
        ['青森県', '560000', '630000', '580000'],
      ];
      const ctx = createContext();

      const findings = multiHeaderCheck.detect(table, ctx);

      const headerFinding = findings.find(f => f.message.includes('多段ヘッダー'));
      expect(headerFinding).toBeDefined();
      expect(headerFinding?.severity).toBe('warning');
      expect(headerFinding?.fix).toBeDefined();
    });

    it('should flatten headers correctly', () => {
      const table: Table = [
        ['', '人口', '人口'],
        ['都道府県', '男', '女'],
        ['北海道', '2500000', '2640000'],
      ];
      const ctx = createContext();

      const findings = multiHeaderCheck.detect(table, ctx);
      const headerFinding = findings.find(f => f.message.includes('多段ヘッダー'));

      expect(headerFinding?.fix).toBeDefined();
      const fixed = headerFinding!.fix!.apply(table);

      expect(fixed.length).toBe(2);
      expect(fixed[0]).toContain('都道府県');
      expect(fixed[0].some(h => h.includes('人口') && h.includes('男'))).toBe(true);
      expect(fixed[0].some(h => h.includes('人口') && h.includes('女'))).toBe(true);
    });
  });

  describe('merged cell detection', () => {
    it('should detect multi-row header with merged cells', () => {
      const table: Table = [
        ['', '人口', '', '世帯数'],
        ['都道府県', '男', '女', ''],
        ['北海道', '2500000', '2640000', '2890000'],
      ];
      const mergedCells: MergedCell[] = [
        { startRow: 0, startCol: 1, endRow: 0, endCol: 2 },
      ];
      const ctx = createContext({ mergedCells });

      const findings = multiHeaderCheck.detect(table, ctx);

      const headerFinding = findings.find(f => f.message.includes('多段ヘッダー'));
      expect(headerFinding).toBeDefined();
      expect(headerFinding?.fix).toBeDefined();
    });

    it('should detect merged cells in body and provide fill-down fix', () => {
      const table: Table = [
        ['地域', '都道府県', '人口'],
        ['北海道', '北海道', '5140000'],
        ['東北', '青森県', '1190000'],
        ['', '岩手県', '1180000'],
        ['', '宮城県', '2290000'],
      ];
      const mergedCells: MergedCell[] = [
        { startRow: 2, startCol: 0, endRow: 4, endCol: 0 },
      ];
      const ctx = createContext({ mergedCells });

      const findings = multiHeaderCheck.detect(table, ctx);

      const bodyMergeFinding = findings.find(f => 
        f.message.includes('データ領域') && f.message.includes('セル結合')
      );
      expect(bodyMergeFinding).toBeDefined();
      expect(bodyMergeFinding?.fix?.description).toContain('展開');
    });

    it('should fill down merged cell values', () => {
      const table: Table = [
        ['地域', '都道府県', '人口'],
        ['東北', '青森県', '1190000'],
        ['', '岩手県', '1180000'],
        ['', '宮城県', '2290000'],
      ];
      const mergedCells: MergedCell[] = [
        { startRow: 1, startCol: 0, endRow: 3, endCol: 0 },
      ];
      const ctx = createContext({ mergedCells });

      const findings = multiHeaderCheck.detect(table, ctx);
      const bodyMergeFinding = findings.find(f => 
        f.message.includes('データ領域') && f.message.includes('セル結合')
      );

      expect(bodyMergeFinding?.fix).toBeDefined();
      const fixed = bodyMergeFinding!.fix!.apply(table);

      expect(fixed[1][0]).toBe('東北');
      expect(fixed[2][0]).toBe('東北');
      expect(fixed[3][0]).toBe('東北');
    });
  });

  describe('no issues', () => {
    it('should report no issues for simple single-row header', () => {
      const table: Table = [
        ['都道府県', '人口', '世帯数'],
        ['北海道', '5140000', '2890000'],
        ['青森県', '1190000', '580000'],
      ];
      const ctx = createContext();

      const findings = multiHeaderCheck.detect(table, ctx);

      const infoFinding = findings.find(f => 
        f.severity === 'info' && f.message.includes('検出されませんでした')
      );
      expect(infoFinding).toBeDefined();
    });
  });

  describe('fix is pure', () => {
    it('should not mutate original table when flattening headers', () => {
      const original: Table = [
        ['', '人口', '人口'],
        ['都道府県', '男', '女'],
        ['北海道', '2500000', '2640000'],
      ];
      const originalCopy = JSON.parse(JSON.stringify(original));
      const ctx = createContext();

      const findings = multiHeaderCheck.detect(original, ctx);
      const headerFinding = findings.find(f => f.message.includes('多段ヘッダー'));
      headerFinding?.fix?.apply(original);

      expect(original).toEqual(originalCopy);
    });
  });
});
