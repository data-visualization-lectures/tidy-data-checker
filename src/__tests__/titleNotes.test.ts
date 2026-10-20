import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { titleNotesCheck, classifyRow } from '../checks/titleNotes';
import { multiHeaderCheck } from '../checks/multiHeader';
import { parseCSV } from '../utils/csv';
import { parseExcelSheet } from '../utils/excel';
import type { Table, CheckContext } from '../types';

const fixturesDir = join(__dirname, 'fixtures');

const ESTAT_UNIT_CSV = `表1 都道府県別事業所数（平成30年～令和2年）
単位：事業所

都道府県,平成30年,令和元年,令和2年
全国,"１，２３４","1,300",△10
北海道,500,x,…
青森県,734,-,"1,310※"
注：x は秘匿、… は不詳、△ は減少
出典：架空統計
`;

function applyAllStep4Fixes(table: Table, ctx: CheckContext): Table {
  let current = table;
  for (let i = 0; i < 10; i++) {
    const findings = titleNotesCheck.detect(current, ctx);
    const fixable = findings.find(f => f.severity === 'warning' && f.fix);
    if (!fixable?.fix) break;
    current = fixable.fix.apply(current);
  }
  return current;
}

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
      expect(unitFinding?.severity).toBe('warning');
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

  describe('unit row deletion', () => {
    it('should warn about a unit row and remove it when the fix is applied', () => {
      const table: Table = [
        ['表1 事業所数', '', ''],
        ['単位：事業所', '', ''],
        ['都道府県', '平成30年', '令和元年'],
        ['北海道', '500', '600'],
        ['青森県', '734', '800'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);
      const unitFinding = findings.find(f => f.message.includes('単位行'));

      expect(unitFinding).toBeDefined();
      expect(unitFinding?.severity).toBe('warning');
      expect(unitFinding?.fix).toBeDefined();
      expect(unitFinding?.fix?.description).toBe('単位行を削除（行 2、単位「事業所」）');
      expect(unitFinding?.fix?.deletedRows).toEqual([1]);
      expect(unitFinding?.metadata?.units).toContain('事業所');
      expect(ctx.detectedUnit).toBe('事業所');

      const fixed = unitFinding!.fix!.apply(table);
      expect(fixed.some(row => row.some(cell => cell.includes('単位：事業所')))).toBe(false);
      expect(fixed[0][0]).toBe('表1 事業所数');
      expect(fixed[1][0]).toBe('都道府県');
    });

    it('should not delete a row with 3 or more non-empty cells that contains 単位', () => {
      const table: Table = [
        ['単位：人', '', ''],
        ['人口（単位：人）', '世帯数', '面積'],
        ['北海道', '100', '200'],
        ['青森県', '10', '20'],
      ];
      const ctx = createContext();

      const findings = titleNotesCheck.detect(table, ctx);
      const unitFinding = findings.find(f => f.message.includes('単位行'));

      expect(unitFinding?.fix).toBeDefined();
      expect(unitFinding?.fix?.deletedRows).toEqual([0]);

      const fixed = unitFinding!.fix!.apply(table);
      expect(fixed[0][0]).toBe('人口（単位：人）');
      expect(fixed[0][1]).toBe('世帯数');
      expect(fixed.some(row => row.some(cell => cell === '単位：人'))).toBe(false);
    });

    it('should not produce 単位：事業所_都道府県 in step 5 after all step-4 fixes', () => {
      const table = parseCSV(ESTAT_UNIT_CSV);
      const ctx = createContext({ fileName: 'estat-unit4.csv' });
      const fixed = applyAllStep4Fixes(table, ctx);

      expect(fixed.some(row => row.some(cell => cell.includes('単位：事業所')))).toBe(false);

      const headerFindings = multiHeaderCheck.detect(fixed, ctx);
      const messages = headerFindings.map(f => f.message).join('\n');
      expect(messages).not.toContain('単位：事業所_都道府県');
      expect(messages).toContain('検出されませんでした');

      for (const finding of headerFindings) {
        if (!finding.fix) continue;
        const applied = finding.fix.apply(fixed);
        const flat = applied.map(row => row.join(',')).join('\n');
        expect(flat).not.toContain('単位：事業所_都道府県');
      }
    });

    it('should detect the 2-row header on the 人口 sheet after deleting the unit row', () => {
      const bytes = new Uint8Array(readFileSync(join(fixturesDir, 'government-style.xlsx')));
      const parsed = parseExcelSheet(bytes, '人口');
      const ctx = createContext({
        fileName: 'government-style.xlsx',
        encoding: 'Excel',
        mergedCells: parsed.mergedCells,
        sheetName: '人口',
      });

      const titleFix = titleNotesCheck.detect(parsed.table, ctx)
        .find(f => f.message.includes('タイトル行'))?.fix;
      expect(titleFix).toBeDefined();
      const withoutTitle = titleFix!.apply(parsed.table);

      const blocked = multiHeaderCheck.detect(withoutTitle, ctx);
      expect(blocked.some(f => f.message.includes('2行の多段ヘッダー'))).toBe(false);

      const unitFix = titleNotesCheck.detect(withoutTitle, ctx)
        .find(f => f.message.includes('単位行'))?.fix;
      expect(unitFix).toBeDefined();
      expect(unitFix?.description).toContain('単位「人」');
      const withoutUnit = unitFix!.apply(withoutTitle);

      expect(withoutUnit.some(row => row.some(cell => cell.includes('単位：人')))).toBe(false);
      const headers = multiHeaderCheck.detect(withoutUnit, ctx);
      const headerFinding = headers.find(f => f.message.includes('2行の多段ヘッダー'));
      expect(headerFinding).toBeDefined();
      expect(headerFinding?.message).toContain('人口');
    });
  });

  describe('2-column data rows that start with a date (7.4 example 3)', () => {
    const EXAMPLE_3: Table = [
      ['調査日', '件数'],
      ['平成31年4月30日', '7'],
      ['平成31年5月1日', '8'],
    ];

    it('should classify a row with a value cell as data, and a row without values as a title', () => {
      expect(classifyRow(['平成31年4月30日', '7']).type).toBe('data');
      expect(classifyRow(['2023年度', '-']).type).toBe('data');
      expect(classifyRow(['平成30年 事業所調査', '']).type).toBe('title');
      expect(classifyRow(['表1 事業所数', '令和5年']).type).toBe('title');
    });

    it('should not report the data rows as title or note rows', () => {
      const findings = titleNotesCheck.detect(EXAMPLE_3, createContext());

      expect(findings).toEqual([
        expect.objectContaining({ severity: 'info', message: 'タイトル行・注記行は検出されませんでした。' }),
      ]);
    });

    it('should still detect a title row above the table and no note rows', () => {
      const table: Table = [['平成30年 事業所調査', ''], ...EXAMPLE_3];

      const findings = titleNotesCheck.detect(table, createContext());
      const titleFinding = findings.find(f => f.message.includes('タイトル行'));

      expect(findings.some(f => f.message.includes('注記行'))).toBe(false);
      expect(titleFinding?.fix?.deletedRows).toEqual([0]);
      expect(titleFinding?.fix?.apply(table)).toEqual(EXAMPLE_3);
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
