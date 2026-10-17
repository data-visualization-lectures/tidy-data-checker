import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDataRegion, isDataRow, getColumnLabel } from '../utils/dataRegion';
import { parseExcelSheet } from '../utils/excel';
import { parseCSVWithMeta } from '../utils/csv';
import { multiHeaderCheck } from '../checks/multiHeader';
import { classifyRow } from '../checks/titleNotes';
import type { Table, CheckContext } from '../types';

const fixturesDir = join(__dirname, 'fixtures');

const ESTAT_STYLE_CSV = `表1 都道府県別事業所数（平成30年～令和2年）
単位：事業所

都道府県,平成30年,令和元年,令和2年
全国,"１，２３４","1,300",△10
北海道,500,x,…
青森県,734,-,"1,310※"
注：x は秘匿、… は不詳、△ は減少
出典：架空統計
`;

function dataRowsOf(table: Table): number[] {
  const region = getDataRegion(table);
  return table.map((_, row) => row).filter(row => isDataRow(table, row, region));
}

describe('getDataRegion', () => {
  it('should find a 2-row header in the 人口 sheet of government-style.xlsx even with title and unit rows', () => {
    const bytes = new Uint8Array(readFileSync(join(fixturesDir, 'government-style.xlsx')));
    const { table } = parseExcelSheet(bytes, '人口');

    expect(getDataRegion(table)).toEqual({
      headerRows: [2, 3],
      headerRow: 3,
      firstDataRow: 4,
      lastDataRow: 7,
      maxCols: 5,
    });
    expect(dataRowsOf(table)).toEqual([4, 5, 6, 7]);
  });

  it('should skip title, unit, blank and note rows in the section 1.2 CSV', () => {
    const { table } = parseCSVWithMeta(ESTAT_STYLE_CSV);

    expect(getDataRegion(table)).toEqual({
      headerRows: [3],
      headerRow: 3,
      firstDataRow: 4,
      lastDataRow: 6,
      maxCols: 4,
    });
    expect(dataRowsOf(table)).toEqual([4, 5, 6]);
  });

  it('should use row 0 as the header of a clean table', () => {
    const table: Table = [
      ['都道府県', '人口', '世帯数'],
      ['北海道', '5140000', '2890000'],
      ['青森県', '1190000', '580000'],
    ];

    expect(getDataRegion(table)).toEqual({
      headerRows: [0],
      headerRow: 0,
      firstDataRow: 1,
      lastDataRow: 2,
      maxCols: 3,
    });
  });

  it('should detect a multi-row header without title rows', () => {
    const table: Table = [
      ['', '人口', '人口', '世帯数'],
      ['都道府県', '男', '女', ''],
      ['北海道', '2500000', '2640000', '2890000'],
      ['青森県', '560000', '630000', '580000'],
    ];
    const region = getDataRegion(table);

    expect(region.headerRows).toEqual([0, 1]);
    expect(region.headerRow).toBe(1);
    expect(region.firstDataRow).toBe(2);
    expect(region.lastDataRow).toBe(3);
  });

  it('should not re-classify rows inside the region (a row like ["2023年度", "120"] stays a data row)', () => {
    const table: Table = [
      ['年度', '件数', '備考'],
      ['2022年度', '100', '速報'],
      ['2023年度', '120', ''],
      ['2024年度', '130', '確定'],
    ];

    expect(classifyRow(table[2]).type).toBe('title');
    expect(dataRowsOf(table)).toEqual([1, 2, 3]);
  });

  it('should exclude blank rows inside the region', () => {
    const table: Table = [
      ['商品コード', '商品名', '価格'],
      ['A001', 'りんご', '150'],
      ['', '', ''],
      ['A002', 'みかん', '100'],
    ];
    const region = getDataRegion(table);

    expect(region.firstDataRow).toBe(1);
    expect(region.lastDataRow).toBe(3);
    expect(dataRowsOf(table)).toEqual([1, 3]);
  });

  it('should report no data rows for a table without data', () => {
    expect(getDataRegion([])).toEqual({
      headerRows: [0],
      headerRow: 0,
      firstDataRow: 1,
      lastDataRow: 0,
      maxCols: 0,
    });
    expect(dataRowsOf([['都道府県', '人口']])).toEqual([]);
  });

  it('should not depend on merged cell information', () => {
    const table: Table = [
      ['地域', '都道府県', '人口'],
      ['東北', '青森県', '1190000'],
      ['', '岩手県', '1180000'],
    ];

    expect(getDataRegion(table).headerRows).toEqual([0]);
    expect(dataRowsOf(table)).toEqual([1, 2]);
  });
});

describe('isDataRow', () => {
  it('should be false for rows outside the region and for missing rows', () => {
    const { table } = parseCSVWithMeta(ESTAT_STYLE_CSV);
    const region = getDataRegion(table);

    expect(isDataRow(table, 0, region)).toBe(false);
    expect(isDataRow(table, 3, region)).toBe(false);
    expect(isDataRow(table, 7, region)).toBe(false);
    expect(isDataRow(table, 100, region)).toBe(false);
  });
});

describe('getColumnLabel', () => {
  it('should join header rows with "_" from top to bottom', () => {
    const bytes = new Uint8Array(readFileSync(join(fixturesDir, 'government-style.xlsx')));
    const { table } = parseExcelSheet(bytes, '人口');
    const region = getDataRegion(table);

    expect([0, 1, 2, 3, 4].map(col => getColumnLabel(table, col, region))).toEqual([
      '都道府県コード',
      '都道府県',
      '人口_男',
      '女',
      '世帯数',
    ]);
  });

  it('should match the header produced by the multi-header flatten fix', () => {
    const table: Table = [
      ['', '人口', '人口', '世帯数', ''],
      ['都道府県', '男', '女', '', ''],
      ['北海道', '2500000', '2640000', '2890000', '1'],
      ['青森県', '560000', '630000', '580000', '2'],
    ];
    const ctx: CheckContext = { fileName: 'test.csv', encoding: 'UTF-8', hasBom: false };
    const flattenFinding = multiHeaderCheck
      .detect(table, ctx)
      .find(f => f.message.includes('多段ヘッダー'));
    const flattened = flattenFinding!.fix!.apply(table)[0];
    const region = getDataRegion(table);

    expect(flattened).toEqual(['都道府県', '人口_男', '人口_女', '世帯数', '列5']);
    expect([0, 1, 2, 3, 4].map(col => getColumnLabel(table, col, region))).toEqual(flattened);
  });

  it('should use the header row of the region, not row 0', () => {
    const { table } = parseCSVWithMeta(ESTAT_STYLE_CSV);
    const region = getDataRegion(table);

    expect(getColumnLabel(table, 1, region)).toBe('平成30年');
    expect(getColumnLabel(table, 4, region)).toBe('列5');
  });
});
