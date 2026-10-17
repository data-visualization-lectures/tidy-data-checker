import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { warekiCheck } from '../checks/wareki';
import { parseCSVWithMeta } from '../utils/csv';
import { classifyColumns } from '../utils/values';
import { getDataRegion } from '../utils/dataRegion';
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
  return warekiCheck.detect(table, ctx);
}

function byKind(findings: Finding[], kind: string): Finding | undefined {
  return findings.find(f => f.metadata?.kind === kind);
}

function warnings(findings: Finding[]): Finding[] {
  return findings.filter(f => f.severity === 'warning');
}

function applyKind(table: Table, kind: string): Table {
  const finding = byKind(detect(table), kind);
  expect(finding?.fix).toBeDefined();
  return finding!.fix!.apply(table);
}

function applyWarnings(table: Table): Table {
  return warnings(detect(table)).reduce(
    (current, finding) => finding.fix?.apply(current) ?? current,
    table,
  );
}

function loadFixture(name: string): Table {
  const text = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  const { table } = parseCSVWithMeta(text);
  return table.filter(row => row.some(cell => cell.trim() !== ''));
}

describe('warekiCheck', () => {
  it('1. 見出し「年」の列で漢字の和暦と R2 を変換し、with-wareki.csv は和暦 7・書式 3 になる', () => {
    const table = loadFixture('with-wareki.csv');
    const findings = detect(table);
    const era = byKind(findings, 'era-cells');
    const format = byKind(findings, 'date-format');

    expect(era?.severity).toBe('warning');
    expect(era?.message).toBe(
      '7 個のセルに和暦の日付があります（例: 「平成29年」→「2017」）。西暦にそろえると、並べ替えやグラフの時間軸が正しく扱えます。',
    );
    expect(era?.fix?.description).toBe('和暦を西暦に変換（7 セル）');
    expect(era?.metadata).toMatchObject({
      kind: 'era-cells',
      mapping: [
        { from: '平成29年', to: '2017' },
        { from: 'H29.4.1', to: '2017-04-01' },
        { from: '平成30年', to: '2018' },
        { from: '平成30年4月1日', to: '2018-04-01' },
        { from: '令和元年', to: '2019' },
        { from: 'R1.5.1', to: '2019-05-01' },
        { from: 'R2', to: '2020' },
      ],
    });
    expect(era?.ranges).toEqual([
      { startRow: 1, startCol: 0, endRow: 4, endCol: 0 },
      { startRow: 1, startCol: 1, endRow: 3, endCol: 1 },
    ]);

    expect(format?.severity).toBe('warning');
    expect(format?.message).toBe(
      '日付の書き方がそろっていません（例: 「2020/5/1」→「2020-05-01」）。',
    );
    expect(format?.fix?.description).toBe('日付を「2020-05-01」の形にそろえる（3 セル）');
    expect(format?.metadata).toMatchObject({
      kind: 'date-format',
      mapping: [
        { from: '2020/5/1', to: '2020-05-01' },
        { from: '2021年', to: '2021' },
        { from: '2021年5月1日', to: '2021-05-01' },
      ],
    });

    expect(applyWarnings(table)).toEqual([
      ['年', '調査日', '件数'],
      ['2017', '2017-04-01', '5'],
      ['2018', '2018-04-01', '7'],
      ['2019', '2019-05-01', '8'],
      ['2020', '2020-05-01', '9'],
      ['2021', '2021-05-01', '10'],
    ]);
  });

  it('2. 見出し「サイズ」の M3 M4 は変換せず、unit4-guards.csv は手順9が何も出さない', () => {
    const inline: Table = [
      ['サイズ'],
      ['M3'],
      ['M4'],
    ];
    const inlineFindings = detect(inline);
    expect(warnings(inlineFindings)).toEqual([]);
    expect(inlineFindings).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: '和暦・日付の表記ゆれは見つかりませんでした。',
      }),
    ]);
    expect(inlineFindings.some(f => f.fix)).toBe(false);

    const table = loadFixture('unit4-guards.csv');
    const findings = detect(table);
    expect(warnings(findings)).toEqual([]);
    expect(findings.map(f => f.metadata?.kind)).toEqual([undefined]);
    expect(findings[0]?.message).toBe('和暦・日付の表記ゆれは見つかりませんでした。');
    expect(applyWarnings(table)).toEqual(table);
    expect(table.map(row => row[2])).toEqual(['サイズ', 'M3', 'M4', 'M5']);
  });

  it('3. 見出しが日付でなくても、同じ列に漢字の和暦があれば H30 を変換する', () => {
    const table: Table = [
      ['備考'],
      ['平成30年'],
      ['H30'],
      ['平30'],
    ];

    const findings = detect(table);
    const era = byKind(findings, 'era-cells');
    expect(byKind(findings, 'date-format')).toBeUndefined();
    expect(era?.metadata).toMatchObject({
      kind: 'era-cells',
      mapping: [
        { from: '平成30年', to: '2018' },
        { from: 'H30', to: '2018' },
        { from: '平30', to: '2018' },
      ],
    });
    expect(era?.fix?.apply(table)).toEqual([
      ['備考'],
      ['2018'],
      ['2018'],
      ['2018'],
    ]);

    const bare: Table = [
      ['備考'],
      ['H30'],
      ['R2'],
    ];
    expect(warnings(detect(bare))).toEqual([]);
    expect(applyWarnings(bare)).toEqual(bare);
  });

  it('4. M / T の略記は、見出しが日付のときだけ変換する', () => {
    const table: Table = [
      ['年', 'サイズ'],
      ['M3', 'M3'],
      ['T5', 'T5'],
      ['明治3年', 'm45'],
    ];

    const era = byKind(detect(table), 'era-cells');
    expect(era?.metadata).toMatchObject({
      mapping: [
        { from: 'M3', to: '1870' },
        { from: 'T5', to: '1916' },
        { from: '明治3年', to: '1870' },
      ],
    });
    expect(era?.fix?.apply(table)).toEqual([
      ['年', 'サイズ'],
      ['1870', 'M3'],
      ['1916', 'T5'],
      ['1870', 'm45'],
    ]);
  });

  it('5. 文字の列にある「令和5年」は変換し、「平成30年の調査」は変換しない', () => {
    const table: Table = [
      ['メモ', '説明'],
      ['令和5年', '平成30年の調査'],
      ['そのまま', '対象外'],
    ];

    const findings = detect(table);
    const era = byKind(findings, 'era-cells');
    expect(warnings(findings).map(f => f.metadata?.kind)).toEqual(['era-cells']);
    expect(byKind(findings, 'unparsed')).toBeUndefined();
    expect(era?.message).toContain('「令和5年」→「2023」');
    expect(era?.fix?.apply(table)).toEqual([
      ['メモ', '説明'],
      ['2023', '平成30年の調査'],
      ['そのまま', '対象外'],
    ]);
  });

  it('6. 横持ちの見出しは 2018年度 になり、多段見出しの上の段と単位付き見出しも変換する', () => {
    const wide = loadFixture('wareki-wide.csv');
    // 年度見出しは main の classifyColumns のまま数値列。見出し変換は列の種類を見ない。
    expect(classifyColumns(wide, getDataRegion(wide))).toEqual([
      'text', 'numeric', 'numeric', 'numeric', 'numeric',
    ]);

    const wideFindings = detect(wide);
    const headers = byKind(wideFindings, 'era-headers');
    expect(warnings(wideFindings).map(f => f.metadata?.kind)).toEqual(['era-headers']);
    expect(headers?.message).toBe(
      '見出しに和暦が 3 個あります（例: 「平成30年度」→「2018年度」）。横持ち→縦持ち（手順10）のあと、年の列として使えるようになります。',
    );
    expect(headers?.fix?.description).toBe('見出しの和暦を西暦に変換（3 列）');
    expect(headers?.fix?.apply(wide)).toEqual([
      ['都道府県', '2018年度', '2019年度', '2020年度', '合計'],
      ['北海道', '100', '110', '120', '330'],
      ['青森県', '50', '55', '60', '165'],
    ]);

    const stacked: Table = [
      ['地域', '平成30年', '令和元年', '2021年'],
      ['', '男', '女', '計'],
      ['北海道', '1', '2', '3'],
    ];
    const stackedFindings = detect(stacked);
    expect(byKind(stackedFindings, 'era-headers')?.fix?.apply(stacked)[0]).toEqual([
      '地域', '2018', '2019', '2021年',
    ]);
    // 同じ見出し行に和暦があるので、西暦の「2020年」もそろえる。上の段だけが対象。
    const mixed: Table = [
      ['都道府県', '平成30年度', '2020年', '合計'],
      ['北海道', '100', '120', '220'],
    ];
    const mixedFindings = detect(mixed);
    expect(byKind(mixedFindings, 'era-headers')?.fix?.description).toBe('見出しの和暦を西暦に変換（1 列）');
    expect(byKind(mixedFindings, 'date-format')?.metadata).toMatchObject({
      mapping: [{ from: '2020年', to: '2020' }],
    });
    expect(applyWarnings(mixed)[0]).toEqual(['都道府県', '2018年度', '2020', '合計']);

    const labeled: Table = [
      ['人口_平成30年', '平成30年（人）'],
    ];
    expect(byKind(detect(labeled), 'era-headers')?.fix?.apply(labeled)).toEqual([
      ['人口_2018', '2018（人）'],
    ]);
  });

  it('7. 西暦の書式統一は日付の列だけ。見出しが日付でない numeric 列の 2023.5 は変えない', () => {
    const table: Table = [
      ['調査日', '重量'],
      ['2020/5/1', '2023.5'],
      ['2021年5月1日', '2024.5'],
      ['2023', '1.5'],
      ['2023-04-01', '2'],
    ];

    expect(classifyColumns(table, getDataRegion(table))).toEqual(['date', 'numeric']);

    const findings = detect(table);
    const format = byKind(findings, 'date-format');
    expect(warnings(findings).map(f => f.metadata?.kind)).toEqual(['date-format']);
    expect(format?.metadata).toMatchObject({
      kind: 'date-format',
      mapping: [
        { from: '2020/5/1', to: '2020-05-01' },
        { from: '2021年5月1日', to: '2021-05-01' },
      ],
    });
    expect(format?.fix?.apply(table)).toEqual([
      ['調査日', '重量'],
      ['2020-05-01', '2023.5'],
      ['2021-05-01', '2024.5'],
      ['2023', '1.5'],
      ['2023-04-01', '2'],
    ]);
  });

  it('8. 改元日をまたぐ表記・最終年超えは変換したうえで info が出る', () => {
    // 2列だと「平成…年」の行が既存のタイトル判定でデータ領域の外になるため、メモ列を足す。
    const table: Table = [
      ['調査日', '件数', 'メモ'],
      ['平成31年4月30日', '7', 'a'],
      ['平成31年5月1日', '8', 'b'],
      ['平成32年', '9', 'c'],
    ];

    const findings = detect(table);
    const era = byKind(findings, 'era-cells');
    const boundary = byKind(findings, 'boundary');

    expect(era?.fix?.apply(table)).toEqual([
      ['調査日', '件数', 'メモ'],
      ['2019-04-30', '7', 'a'],
      ['2019-05-01', '8', 'b'],
      ['2020', '9', 'c'],
    ]);
    expect(boundary?.severity).toBe('info');
    expect(boundary?.fix).toBeUndefined();
    expect(boundary?.message).toBe(
      '元号の切り替えをまたぐ表記があります（例: 「平成31年5月1日」）。西暦では正しく変換されますが、元の資料を確認しておくと安心です。',
    );
    expect(boundary?.metadata).toEqual({
      kind: 'boundary',
      examples: ['平成31年5月1日', '平成32年'],
    });
  });

  it('9. 変換できない表記は info が出て、表は変わらない', () => {
    // 2列で「2022年」を含む行は既存のタイトル判定に吸われるため、列を足す。
    const table: Table = [
      ['調査日', 'メモ', '区分'],
      ['令和5年2月30日', 'そのまま', 'a'],
      ['令和5年1～3月期', 'x', 'b'],
      ['令和5年(2022年)', 'y', 'c'],
    ];
    const snapshot = table.map(row => row.slice());

    const findings = detect(table);
    const unparsed = byKind(findings, 'unparsed');

    expect(warnings(findings)).toEqual([]);
    expect(unparsed?.severity).toBe('info');
    expect(unparsed?.fix).toBeUndefined();
    expect(unparsed?.message).toBe(
      '変換できない日付の表記が 3 個あります（例: 「令和5年2月30日」「令和5年1～3月期」）。',
    );
    expect(unparsed?.metadata).toEqual({
      kind: 'unparsed',
      examples: ['令和5年2月30日', '令和5年1～3月期', '令和5年(2022年)'],
    });
    expect(table).toEqual(snapshot);
    expect(applyWarnings(table)).toEqual(snapshot);
  });

  it('10. 検出は元の表を書き換えず、適用後に同じ警告は再検出しない', () => {
    const table = loadFixture('with-wareki.csv');
    const snapshot = table.map(row => row.slice());
    const rowRefs = table.map(row => row);

    const findings = detect(table);
    expect(table).toEqual(snapshot);
    expect(table.map(row => row)).toEqual(rowRefs);

    let current = table;
    for (const finding of findings) {
      if (!finding.fix) continue;
      const once = finding.fix.apply(current);
      expect(table).toEqual(snapshot);
      expect(finding.fix.apply(once)).toEqual(once);
      current = once;
    }

    expect(current).toEqual([
      ['年', '調査日', '件数'],
      ['2017', '2017-04-01', '5'],
      ['2018', '2018-04-01', '7'],
      ['2019', '2019-05-01', '8'],
      ['2020', '2020-05-01', '9'],
      ['2021', '2021-05-01', '10'],
    ]);

    const again = detect(current);
    expect(warnings(again)).toEqual([]);
    expect(again[0]?.message).toBe('和暦・日付の表記ゆれは見つかりませんでした。');
    expect(applyKind(table, 'era-cells')).not.toBe(table);

    const eraFirst = applyKind(table, 'era-cells');
    const formatAfter = byKind(detect(eraFirst), 'date-format');
    expect(formatAfter?.fix?.apply(eraFirst)).toEqual(current);
    expect(byKind(detect(eraFirst), 'era-cells')).toBeUndefined();

    const formatFirst = applyKind(table, 'date-format');
    expect(byKind(detect(formatFirst), 'date-format')).toBeUndefined();
    expect(byKind(detect(formatFirst), 'era-cells')?.fix?.apply(formatFirst)).toEqual(current);
  });
});
