import { describe, it, expect } from 'vitest';
import { titleNotesCheck } from '../checks/titleNotes';
import type { Table, CheckContext } from '../types';

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    fileName: 'test.csv',
    encoding: 'UTF-8',
    hasBom: false,
    ...overrides,
  };
}

describe('titleNotesCheck', () => {
  describe('title row detection', () => {
    it('should detect title rows at the top', () => {
      const table: Table = [
        ['表1 都道府県別人口（令和5年）', '', ''],
        ['都道府県', '人口', '世帯数'],
        ['北海道', '5140000', '2890000'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);

      const titleFinding = findings.find(f => f.message.includes('タイトル行'));
      expect(titleFinding).toBeDefined();
      expect(titleFinding?.severity).toBe('warning');
      expect(titleFinding?.ranges[0].startRow).toBe(0);
      expect(titleFinding?.fix).toBeDefined();
    });

    it('should detect title with year pattern', () => {
      const table: Table = [
        ['2023年度 産業別生産額', '', ''],
        ['産業', '生産額', '構成比'],
        ['製造業', '100', '30%'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);

      const titleFinding = findings.find(f => f.message.includes('タイトル行'));
      expect(titleFinding).toBeDefined();
    });
  });

  describe('unit row detection', () => {
    it('should detect unit rows', () => {
      const table: Table = [
        ['都道府県別人口', '', ''],
        ['単位：千人', '', ''],
        ['都道府県', '人口', '世帯数'],
        ['北海道', '5140', '2890'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);

      const unitFinding = findings.find(f => f.message.includes('単位行'));
      expect(unitFinding).toBeDefined();
      expect(unitFinding?.severity).toBe('info');
      expect(unitFinding?.metadata?.units).toContain('千人');
    });

    it('should detect unit in parentheses', () => {
      const table: Table = [
        ['人口推移（単位：万人）', '', ''],
        ['年', '人口', '増減'],
        ['2020', '1260', '+5'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);

      const unitFinding = findings.find(f => f.message.includes('単位行'));
      expect(unitFinding).toBeDefined();
    });
  });

  describe('note row detection', () => {
    it('should detect note rows at the bottom', () => {
      const table: Table = [
        ['都道府県', '人口', '世帯数'],
        ['北海道', '5140000', '2890000'],
        ['青森県', '1190000', '580000'],
        ['注：人口は推計値', '', ''],
        ['出典：総務省統計局', '', ''],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);

      const noteFinding = findings.find(f => f.message.includes('注記行'));
      expect(noteFinding).toBeDefined();
      expect(noteFinding?.severity).toBe('warning');
      expect(noteFinding?.fix).toBeDefined();
    });

    it('should detect various note patterns', () => {
      const patterns = [
        '※ 一部データは暫定値',
        '＊秘匿データを含む',
        '資料：国勢調査',
        '出所：厚生労働省',
        '備考：集計方法変更',
        '（注）小数点以下四捨五入',
      ];

      for (const pattern of patterns) {
        const table: Table = [
          ['A', 'B', 'C'],
          ['1', '2', '3'],
          [pattern, '', ''],
        ];
        const ctx = createContext();

        const findings = titleNotesCheck.detect(table, ctx);
        const noteFinding = findings.find(f => f.message.includes('注記行'));
        expect(noteFinding).toBeDefined();
      }
    });
  });

  describe('fix application', () => {
    it('should remove title rows', () => {
      const table: Table = [
        ['表1 人口統計', '', ''],
        ['都道府県', '人口', '世帯数'],
        ['北海道', '5140000', '2890000'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);
      const titleFinding = findings.find(f => f.message.includes('タイトル行'));
      
      expect(titleFinding?.fix).toBeDefined();
      const fixed = titleFinding!.fix!.apply(table);
      
      expect(fixed.length).toBe(2);
      expect(fixed[0][0]).toBe('都道府県');
    });

    it('should remove note rows', () => {
      const table: Table = [
        ['都道府県', '人口'],
        ['北海道', '5140000'],
        ['注：推計値', ''],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);
      const noteFinding = findings.find(f => f.message.includes('注記行'));
      
      expect(noteFinding?.fix).toBeDefined();
      const fixed = noteFinding!.fix!.apply(table);
      
      expect(fixed.length).toBe(2);
    });
  });

  describe('no issues', () => {
    it('should report no issues for clean data', () => {
      const table: Table = [
        ['都道府県', '人口', '世帯数'],
        ['北海道', '5140000', '2890000'],
        ['青森県', '1190000', '580000'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);

      const infoFinding = findings.find(f => 
        f.severity === 'info' && f.message.includes('検出されませんでした')
      );
      expect(infoFinding).toBeDefined();
    });
  });
});
