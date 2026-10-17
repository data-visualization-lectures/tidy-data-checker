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

  it('with-number-formats.csv の全角と桁区切りを適用してもコード列の先頭 0 が残る', () => {
    const text = readFileSync(join(__dirname, 'fixtures/with-number-formats.csv'), 'utf8');
    const { table } = parseCSVWithMeta(text);
    const body = table.filter(row => row.some(cell => cell.trim() !== ''));

    const findings = detect(body);
    const warnings = findings.filter(f => f.severity === 'warning');
    expect(warnings.map(f => f.metadata?.kind)).toEqual(['fullwidth', 'separator', 'unit']);

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

  it('6. 同じ単位はセルから外れ、見出しが 人口（人） になる。既にある単位は見出しを変えない', () => {
    const table: Table = [
      ['人口'],
      ['100人'],
      ['200人'],
    ];
    const findings = detect(table);
    const unit = byKind(findings, 'unit');
    expect(unit?.severity).toBe('warning');
    expect(unit?.message).toBe(
      '1 個の列で、セルの中に単位が書かれています（列 A「人」）。単位を見出しに移すと、値を数値として扱えます。'
    );
    expect(unit?.fix?.description).toBe('単位を見出しに移す（列 A）');
    expect(unit?.metadata).toEqual({
      kind: 'unit',
      columns: [{ col: 0, mode: 'strip', unit: '人', header: '人口（人）' }],
    });
    expect(unit?.ranges).toEqual([
      { startRow: 0, startCol: 0, endRow: 2, endCol: 0 },
    ]);
    expect(findings.some(f => f.message === '全角数字・桁区切り・単位の問題は見つかりませんでした。')).toBe(false);

    const snapshot = table.map(row => row.slice());
    const fixed = unit!.fix!.apply(table);
    expect(table).toEqual(snapshot);
    expect(fixed).toEqual([
      ['人口（人）'],
      ['100'],
      ['200'],
    ]);
    expect(byKind(detect(fixed), 'unit')).toBeUndefined();
    expect(unit!.fix!.apply(fixed)).toEqual(fixed);

    const already: Table = [
      ['人口（人）'],
      ['100人'],
      ['200人'],
    ];
    const alreadyFixed = byKind(detect(already), 'unit')!.fix!.apply(already);
    expect(alreadyFixed).toEqual([
      ['人口（人）'],
      ['100'],
      ['200'],
    ]);

    const halfParen: Table = [
      ['人口(人)'],
      ['100人'],
      ['200人'],
    ];
    expect(byKind(detect(halfParen), 'unit')!.fix!.apply(halfParen)[0][0]).toBe('人口(人)');

    const emptyHeader: Table = [
      ['コード', '名前', ''],
      ['01', 'A', '5人'],
      ['02', 'B', '6人'],
    ];
    expect(applyKind(emptyHeader, 'unit')).toEqual([
      ['コード', '名前', '列3（人）'],
      ['01', 'A', '5'],
      ['02', 'B', '6'],
    ]);
  });

  it('7. % の列は見出しが 割合（%） になり、値は 11.6 のまま', () => {
    const table: Table = [
      ['年齢区分', '割合'],
      ['0〜14歳', '11.6%'],
      ['15〜64歳', '59.4%'],
      ['65歳以上', '29.0%'],
    ];

    const unit = byKind(detect(table), 'unit');
    expect(unit?.metadata).toEqual({
      kind: 'unit',
      columns: [{ col: 1, mode: 'strip', unit: '%', header: '割合（%）' }],
    });
    expect(unit?.fix?.apply(table)).toEqual([
      ['年齢区分', '割合（%）'],
      ['0〜14歳', '11.6'],
      ['15〜64歳', '59.4'],
      ['65歳以上', '29.0'],
    ]);
    expect(unit?.fix?.apply(table)[1][1]).toBe('11.6');
  });

  it('8. 倍率の混在は基本単位にそろえ、見出しは （人）', () => {
    const table: Table = [
      ['地域', '人口'],
      ['A市', '1.2万人'],
      ['B町', '8,000人'],
      ['C村', '950人'],
    ];

    const findings = detect(table);
    const unit = byKind(findings, 'unit');
    expect(unit?.metadata).toEqual({
      kind: 'unit',
      columns: [{ col: 1, mode: 'normalize', unit: '人', header: '人口（人）' }],
    });
    expect(byKind(findings, 'separator')?.metadata).toMatchObject({ count: 1, cols: [1] });

    const expected: Table = [
      ['地域', '人口（人）'],
      ['A市', '12000'],
      ['B町', '8000'],
      ['C村', '950'],
    ];
    expect(unit?.fix?.apply(table)).toEqual(expected);
    expect(applyKind(applyKind(table, 'separator'), 'unit')).toEqual(expected);
    const afterUnit = applyKind(table, 'unit');
    expect(byKind(detect(afterUnit), 'separator')).toBeUndefined();
    expect(afterUnit).toEqual(expected);

    const withPlain: Table = [
      ['地域', '人口'],
      ['A市', '8000'],
      ['B町', '1.2万人'],
      ['C村', '950人'],
    ];
    expect(applyKind(withPlain, 'unit')).toEqual([
      ['地域', '人口（人）'],
      ['A市', '8000'],
      ['B町', '12000'],
      ['C村', '950'],
    ]);
  });

  it('9. すべて 万人 の列は数値を変えず、見出しが （万人）', () => {
    const table: Table = [
      ['地域', '人口'],
      ['A市', '1.2万人'],
      ['B町', '0.8万人'],
    ];

    const unit = byKind(detect(table), 'unit');
    expect(unit?.metadata).toMatchObject({
      columns: [{ col: 1, mode: 'strip', unit: '万人', header: '人口（万人）' }],
    });
    expect(unit?.fix?.apply(table)).toEqual([
      ['地域', '人口（万人）'],
      ['A市', '1.2'],
      ['B町', '0.8'],
    ]);
  });

  it('10. 単位そのものが違う列は直さず info を出す', () => {
    const table: Table = [
      ['項目', '値'],
      ['人口', '1,234人'],
      ['構成比', '12.5%'],
    ];

    const findings = detect(table);
    expect(byKind(findings, 'unit')).toBeUndefined();
    const mixed = byKind(findings, 'mixed-unit');
    expect(mixed?.severity).toBe('info');
    expect(mixed?.fix).toBeUndefined();
    expect(mixed?.message).toBe(
      '列 B は単位がそろっていません（人, %）。意味の違う値（実数と割合など）が1つの列に混ざっている可能性があります。'
    );
    expect(mixed?.metadata).toEqual({
      kind: 'mixed-unit',
      columns: [{ col: 1, units: ['人', '%'] }],
    });

    const separator = byKind(findings, 'separator');
    expect(separator?.ranges).toEqual([
      { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
    ]);
    const commasRemoved = separator!.fix!.apply(table);
    expect(commasRemoved[1][1]).toBe('1234人');
    expect(commasRemoved[2][1]).toBe('12.5%');
    const again = detect(commasRemoved);
    expect(byKind(again, 'unit')).toBeUndefined();
    expect(byKind(again, 'mixed-unit')?.message).toContain('人, %');
  });

  it('11. 20～24歳、65歳以上、2020年、4月 は単位付き数値として扱わない', () => {
    const table: Table = [
      ['区分', '人数'],
      ['20～24歳', '15人'],
      ['65歳以上', '40人'],
      ['2020年', '3人'],
      ['4月', '1人'],
    ];

    const findings = detect(table);
    expect(byKind(findings, 'mixed-unit')).toBeUndefined();
    const unit = byKind(findings, 'unit');
    expect(unit?.metadata).toMatchObject({
      columns: [{ col: 1, mode: 'strip', unit: '人', header: '人数（人）' }],
    });
    expect(unit?.fix?.apply(table)).toEqual([
      ['区分', '人数（人）'],
      ['20～24歳', '15'],
      ['65歳以上', '40'],
      ['2020年', '3'],
      ['4月', '1'],
    ]);

    const asValues: Table = [
      ['項目', '内容'],
      ['年齢', '20～24歳'],
      ['高齢者', '65歳以上'],
      ['年', '2020年'],
      ['月', '4月'],
    ];
    const valueFindings = detect(asValues);
    expect(valueFindings.filter(f => f.metadata?.kind === 'unit' || f.metadata?.kind === 'mixed-unit')).toEqual([]);
    expect(valueFindings[0]?.message).toBe('全角数字・桁区切り・単位の問題は見つかりませんでした。');
    expect(asValues.map(row => row[1])).toEqual(['内容', '20～24歳', '65歳以上', '2020年', '4月']);
  });

  it('1.23456万 は shiftDecimal で 12345.6 になる', () => {
    const table: Table = [
      ['項目', '数量'],
      ['A', '1.23456万'],
      ['B', '3億'],
      ['C', '-1.2万'],
    ];

    const unit = byKind(detect(table), 'unit');
    expect(unit?.metadata).toMatchObject({
      columns: [{ col: 1, mode: 'normalize', unit: '', header: '数量' }],
    });
    expect(unit?.fix?.apply(table)).toEqual([
      ['項目', '数量'],
      ['A', '12345.6'],
      ['B', '300000000'],
      ['C', '-12000'],
    ]);
    expect(unit?.fix?.apply(table)[1][1]).toBe('12345.6');
  });

  it('with-number-formats.csv の3つの修正は順番を変えても 6.4節例1 の最終形になる', () => {
    const text = readFileSync(join(__dirname, 'fixtures/with-number-formats.csv'), 'utf8');
    const { table } = parseCSVWithMeta(text);
    const body = table.filter(row => row.some(cell => cell.trim() !== ''));

    const expected: Table = [
      ['コード', '市区町村', '人口（人）', '面積（km²）', '人口密度'],
      ['01', '札幌市', '1973395', '1121.26', '1760'],
      ['02', '函館市', '248989', '677.87', '367'],
      ['03', '小樽市', '111299', '243.83', '456.5'],
    ];

    const unit = byKind(detect(body), 'unit');
    expect(unit?.message).toBe(
      '2 個の列で、セルの中に単位が書かれています（列 C「人」, 列 D「km²」）。単位を見出しに移すと、値を数値として扱えます。'
    );
    expect(unit?.fix?.description).toBe('単位を見出しに移す（列 C, D）');
    expect(unit?.metadata).toEqual({
      kind: 'unit',
      columns: [
        { col: 2, mode: 'strip', unit: '人', header: '人口（人）' },
        { col: 3, mode: 'strip', unit: 'km²', header: '面積（km²）' },
      ],
    });

    const unitOnly = applyKind(body, 'unit');
    expect(unitOnly).toEqual([
      ['コード', '市区町村', '人口（人）', '面積（km²）', '人口密度'],
      ['01', '札幌市', '1,973,395', '1121.26', '1,760'],
      ['02', '函館市', '２４８，９８９', '677.87', '３６７'],
      ['03', '小樽市', '111,299', '243.83', '456.5'],
    ]);
    expect(unitOnly[1][3]).toBe('1121.26');
    expect(unitOnly[0][3]).toBe('面積（km²）');
    expect(unitOnly[0][3]).toContain('²');
    expect(unitOnly[0][3]).not.toContain('km2');

    const kinds = ['fullwidth', 'separator', 'unit'] as const;
    const orders = kinds.flatMap((first, i) =>
      kinds.filter((_, j) => j !== i).flatMap((second, k, rest) => {
        const third = rest[k === 0 ? 1 : 0];
        return [[first, second, third] as const];
      })
    );
    expect(orders).toHaveLength(6);

    for (const order of orders) {
      let current = body;
      for (const kind of order) {
        current = applyKind(current, kind);
      }
      expect(current).toEqual(expected);
      const after = detect(current);
      expect(after.filter(f => f.severity === 'warning')).toEqual([]);
      expect(after[0]?.message).toBe('全角数字・桁区切り・単位の問題は見つかりませんでした。');
      expect(current.slice(1).map(row => row[0])).toEqual(['01', '02', '03']);
    }
  });
});
