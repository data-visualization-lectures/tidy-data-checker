import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatNumberCheck } from '../checks/formatNumber';
import { parseCSVWithMeta } from '../utils/csv';
import type { Finding, Table, CheckContext } from '../types';

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    fileName: 'test.csv',
    encoding: 'UTF-8',
    hasBom: false,
    ...overrides,
  };
}

const ctx = createContext();

function detect(table: Table): Finding[] {
  return formatNumberCheck.detect(table, ctx);
}

function byKind(findings: Finding[], kind: string): Finding | undefined {
  return findings.find(f => f.metadata?.kind === kind);
}

function applyKind(table: Table, kind: string): Table {
  const finding = byKind(detect(table), kind);
  expect(finding?.fix).toBeDefined();
  return finding!.fix!.apply(table);
}

function applyBoth(table: Table, first: 'fullwidth' | 'separator'): Table {
  const second = first === 'fullwidth' ? 'separator' : 'fullwidth';
  return applyKind(applyKind(table, first), second);
}

describe('formatNumberCheck', () => {
  it('1. １，２３４ は全角のあと桁区切り、逆順でも 1234 になる', () => {
    const table: Table = [
      ['値'],
      ['１，２３４'],
    ];

    const findings = detect(table);
    const fullwidth = byKind(findings, 'fullwidth');
    const separator = byKind(findings, 'separator');

    expect(fullwidth?.severity).toBe('warning');
    expect(fullwidth?.message).toBe(
      '1 個のセルに全角の数字や前後の空白があります（例: 「１，２３４」）。半角にそろえると数値として読み込めます。'
    );
    expect(fullwidth?.fix?.description).toBe('全角数字を半角にする（1 セル）');
    expect(fullwidth?.fix?.apply(table)).toEqual([['値'], ['1,234']]);

    expect(separator?.severity).toBe('warning');
    expect(separator?.message).toBe(
      '1 個のセルに桁区切りのカンマがあります（例: 「１，２３４」）。CSV ではカンマが区切り文字と紛らわしく、数値ではなく文字として読まれる原因になります。'
    );
    expect(separator?.fix?.description).toBe('桁区切りを除去（1 セル）');
    expect(separator?.fix?.apply(table)).toEqual([['値'], ['１２３４']]);

    expect(applyBoth(table, 'fullwidth')).toEqual([['値'], ['1234']]);
    expect(applyBoth(table, 'separator')).toEqual([['値'], ['1234']]);
  });

  it('2. コード列の 01 と 02 は出ず、０１ は全角の修正だけで 01 になる', () => {
    const untouched: Table = [
      ['コード', '数量'],
      ['01', '10'],
      ['02', '20'],
    ];
    const untouchedFindings = detect(untouched);
    expect(untouchedFindings).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: '全角数字・桁区切り・単位の問題は見つかりませんでした。',
      }),
    ]);
    expect(untouchedFindings.some(f => f.fix)).toBe(false);

    const table: Table = [
      ['コード', '数量'],
      ['01', '10'],
      ['02', '20'],
      ['０１', '30'],
    ];
    const findings = detect(table);
    expect(byKind(findings, 'separator')).toBeUndefined();

    const fullwidth = byKind(findings, 'fullwidth');
    expect(fullwidth?.metadata).toMatchObject({ kind: 'fullwidth', count: 1, cols: [0] });
    expect(fullwidth?.fix?.apply(table)).toEqual([
      ['コード', '数量'],
      ['01', '10'],
      ['02', '20'],
      ['01', '30'],
    ]);
  });

  it('3. 1,2 と 12,34 は触らず、100,200 は 100200 になる', () => {
    const table: Table = [
      ['項目', '数量'],
      ['a', '10'],
      ['b', '20'],
      ['c', '30'],
      ['d', '40'],
      ['e', '1,2'],
      ['f', '12,34'],
      ['g', '100,200'],
      ['h', '50'],
      ['i', '60'],
      ['j', '70'],
    ];

    const findings = detect(table);
    expect(byKind(findings, 'fullwidth')).toBeUndefined();
    const separator = byKind(findings, 'separator');
    expect(separator?.metadata).toMatchObject({ kind: 'separator', count: 1, cols: [1] });
    expect(separator?.ranges).toEqual([
      { startRow: 7, startCol: 1, endRow: 7, endCol: 1 },
    ]);

    const fixed = separator!.fix!.apply(table);
    expect(fixed.map(row => row[1])).toEqual([
      '数量', '10', '20', '30', '40', '1,2', '12,34', '100200', '50', '60', '70',
    ]);
  });

  it('4. 小数・全角小数・負数・全角マイナスを半角の桁区切りなしにする', () => {
    const table: Table = [
      ['値'],
      ['1,234.5'],
      ['１．５'],
      ['-1,234'],
      ['−１２'],
    ];

    const fullwidthOnly = byKind(detect(table), 'fullwidth')!.fix!.apply(table);
    expect(fullwidthOnly).toEqual([
      ['値'],
      ['1,234.5'],
      ['1.5'],
      ['-1,234'],
      ['-12'],
    ]);

    const separatorOnly = byKind(detect(table), 'separator')!.fix!.apply(table);
    expect(separatorOnly).toEqual([
      ['値'],
      ['1234.5'],
      ['１．５'],
      ['-1234'],
      ['−１２'],
    ]);

    const expected: Table = [
      ['値'],
      ['1234.5'],
      ['1.5'],
      ['-1234'],
      ['-12'],
    ];
    expect(applyBoth(table, 'fullwidth')).toEqual(expected);
    expect(applyBoth(table, 'separator')).toEqual(expected);
  });

  it('5. 前後の空白を除いて 123 にする', () => {
    const table: Table = [
      ['値'],
      ['  123 '],
    ];

    const findings = detect(table);
    const fullwidth = byKind(findings, 'fullwidth');
    expect(byKind(findings, 'separator')).toBeUndefined();
    expect(fullwidth?.message).toContain('（例: 「  123 」）');
    expect(fullwidth?.fix?.apply(table)).toEqual([['値'], ['123']]);
  });

  it('12. 文字の列の 第１位 は変わらない', () => {
    const table: Table = [
      ['順位', '点数'],
      ['第１位', '100'],
      ['第２位', '１００'],
    ];

    const fixed = byKind(detect(table), 'fullwidth')!.fix!.apply(table);
    expect(fixed).toEqual([
      ['順位', '点数'],
      ['第１位', '100'],
      ['第２位', '100'],
    ]);
  });

  it('見出し 平成30年度 の数値は全角と桁区切りとして検出される', () => {
    const table: Table = [
      ['都道府県', '平成30年度', '令和元年度', '合計'],
      ['北海道', '1,100', '１２０', '330'],
      ['青森県', '50', '55', '165'],
    ];

    const findings = detect(table);
    const fullwidth = byKind(findings, 'fullwidth');
    const separator = byKind(findings, 'separator');

    expect(fullwidth?.metadata).toMatchObject({ kind: 'fullwidth', count: 1, cols: [2] });
    expect(fullwidth?.message).toContain('「１２０」');
    expect(separator?.metadata).toMatchObject({ kind: 'separator', count: 1, cols: [1] });
    expect(separator?.message).toContain('「1,100」');

    expect(applyBoth(table, 'fullwidth')).toEqual([
      ['都道府県', '平成30年度', '令和元年度', '合計'],
      ['北海道', '1100', '120', '330'],
      ['青森県', '50', '55', '165'],
    ]);
  });

  it('13. 見出しが 年 の date 列の ２０１８ は手順8では出ない', () => {
    const table: Table = [
      ['年', '件数'],
      ['２０１８', '5'],
      ['２０１９', '6'],
    ];

    const findings = detect(table);
    expect(findings.filter(f => f.severity === 'warning')).toEqual([]);
    expect(findings[0]?.message).toBe('全角数字・桁区切り・単位の問題は見つかりませんでした。');
    expect(table[1][0]).toBe('２０１８');
    expect(table[2][0]).toBe('２０１９');
  });

  it('14. km² の ² は 2 にならない', () => {
    const table: Table = [
      ['地域', '面積'],
      ['A市', '１，２３４km²'],
      ['B町', '1121.26km²'],
    ];

    const fixed = applyBoth(table, 'fullwidth');
    expect(fixed).toEqual([
      ['地域', '面積'],
      ['A市', '1234km²'],
      ['B町', '1121.26km²'],
    ]);
    expect(fixed[1][1]).toContain('²');
    expect(fixed[1][1]).not.toContain('km2');
    expect(fixed[2][1]).toBe('1121.26km²');
  });

  it('15. 修正は元の表を書き換えず、適用後に同じ種類は再検出しない', () => {
    const table: Table = [
      ['項目', '値'],
      ['A', '1'],
      ['B', '１，２３４'],
      ['C', '  56 '],
    ];
    const snapshot = table.map(row => row.slice());
    const rowRefs = table.map(row => row);

    const findings = detect(table);
    const fullwidth = byKind(findings, 'fullwidth')!;
    const separator = byKind(findings, 'separator')!;

    const half = fullwidth.fix!.apply(table);
    expect(table).toEqual(snapshot);
    expect(table.map(row => row)).toEqual(rowRefs);

    const halfFindings = detect(half);
    expect(byKind(halfFindings, 'fullwidth')).toBeUndefined();
    expect(byKind(halfFindings, 'separator')?.fix?.apply(half)).toEqual([
      ['項目', '値'],
      ['A', '1'],
      ['B', '1234'],
      ['C', '56'],
    ]);
    expect(fullwidth.fix!.apply(half)).toEqual(half);

    const commas = separator.fix!.apply(table);
    expect(table).toEqual(snapshot);
    const commaFindings = detect(commas);
    expect(byKind(commaFindings, 'separator')).toBeUndefined();
    expect(byKind(commaFindings, 'fullwidth')).toBeDefined();
    expect(separator.fix!.apply(commas)).toEqual(commas);

    const done = applyBoth(table, 'separator');
    const doneFindings = detect(done);
    expect(doneFindings.filter(f => f.severity === 'warning')).toEqual([]);
    expect(doneFindings[0]?.severity).toBe('info');
    expect(detect(done)[0]?.fix).toBeUndefined();
  });

  it('with-number-formats.csv は全角と桁区切りの2件で、適用後もコード列の先頭 0 が残る', () => {
    const text = readFileSync(join(__dirname, 'fixtures/with-number-formats.csv'), 'utf8');
    const { table } = parseCSVWithMeta(text);
    const body = table.filter(row => row.some(cell => cell.trim() !== ''));

    const findings = detect(body);
    const warnings = findings.filter(f => f.severity === 'warning');
    expect(warnings.map(f => f.metadata?.kind)).toEqual(['fullwidth', 'separator']);

    const fullwidth = byKind(findings, 'fullwidth')!;
    const separator = byKind(findings, 'separator')!;
    expect(fullwidth.metadata).toMatchObject({ count: 2, cols: [2, 4] });
    expect(fullwidth.message).toContain('「２４８，９８９人」');
    expect(separator.metadata).toMatchObject({ count: 4, cols: [2, 4] });
    expect(separator.message).toContain('「1,973,395人」');

    const fixed = applyBoth(body, 'fullwidth');
    expect(applyBoth(body, 'separator')).toEqual(fixed);
    expect(fixed).toEqual([
      ['コード', '市区町村', '人口', '面積', '人口密度'],
      ['01', '札幌市', '1973395人', '1121.26km²', '1760'],
      ['02', '函館市', '248989人', '677.87km²', '367'],
      ['03', '小樽市', '111299人', '243.83km²', '456.5'],
    ]);
    expect(fixed.slice(1).map(row => row[0])).toEqual(['01', '02', '03']);
    expect(fixed[1][3]).toBe('1121.26km²');
  });
});
