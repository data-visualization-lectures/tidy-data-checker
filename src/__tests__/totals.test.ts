import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { totalsCheck, classifyTotalLabel, type TotalKind } from '../checks/totals';
import { parseCSV } from '../utils/csv';
import type { Finding, Table, CheckContext } from '../types';

const fixturesDir = join(__dirname, 'fixtures');

function createContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    fileName: 'test.csv',
    encoding: 'UTF-8',
    hasBom: false,
    ...overrides,
  };
}

function loadFixture(name: string): Table {
  return parseCSV(readFileSync(join(fixturesDir, name), 'utf8'));
}

function warnings(findings: Finding[], kind?: string): Finding[] {
  return findings.filter(f => {
    if (f.severity !== 'warning') return false;
    if (kind === undefined) return true;
    return f.metadata?.kind === kind;
  });
}

function snapshot(table: Table): Table {
  return table.map(row => [...row]);
}

describe('classifyTotalLabel', () => {
  const cases: Array<[string, TotalKind | null]> = [
    ['合計', 'grand'],
    ['総　数', 'grand'],
    ['（合計）', 'grand'],
    ['計 Total', 'grand'],
    ['総数 Total', 'grand'],
    ['Total', 'grand'],
    ['全国', 'grand'],
    ['◎全国', 'grand'],
    ['計', 'grand'],
    ['総額', 'grand'],
    ['平均', 'grand'],
    ['全国平均', 'grand'],
    ['小計', 'subtotal'],
    ['小計（東北）', 'subtotal'],
    ['東北計', 'subtotal'],
    ['男計', 'subtotal'],
    ['市部計', 'subtotal'],
    ['東北小計', 'subtotal'],
    ['男女計', 'subtotal'],
    ['計（東北）', 'subtotal'],
    ['年計', 'subtotal'],
    ['累計', 'subtotal'],
    ['学生計', 'subtotal'],
    ['農家計', 'subtotal'],
    ['建設業計', 'subtotal'],
    ['株主計', 'subtotal'],
    ['（再掲）政令市', 'restated'],
    ['再掲：65歳以上', 'restated'],
    ['うち女性', 'restated'],
    ['うちわ', null],
    ['温度計', null],
    ['体重計', null],
    ['会計', null],
    ['一般会計', null],
    ['統計', null],
    ['家計', null],
    ['推計', null],
    ['人口推計', null],
    ['集計', null],
    ['計画', null],
    ['設計', null],
    ['時計', null],
    ['北海道', null],
    ['平均気温', null],
  ];

  it.each(cases)('%s → %s', (label, expected) => {
    expect(classifyTotalLabel(label)).toBe(expected);
  });
});

describe('totalsCheck', () => {
  const ctx = createContext();

  it('1. 最終行の合計を検出し、fix で行が消え deletedRows が設定される', () => {
    const table: Table = [
      ['品目', '数量'],
      ['りんご', '10'],
      ['みかん', '20'],
      ['合計', '30'],
    ];
    const original = snapshot(table);

    const finding = warnings(totalsCheck.detect(table, ctx), 'grand')[0];
    expect(finding).toBeDefined();
    expect(finding.metadata).toMatchObject({ kind: 'grand', rows: [3], labels: ['合計'] });
    expect(finding.ranges).toEqual([
      { startRow: 3, startCol: 0, endRow: 3, endCol: 1 },
    ]);
    expect(finding.fix?.description).toBe('集計行を削除（行 4）');
    expect(finding.fix?.deletedRows).toEqual([3]);
    expect(finding.message).toContain('行 4「合計」');
    expect(finding.message).not.toContain('一致しました');

    const applied = finding.fix!.apply(table);
    expect(applied).toEqual([
      ['品目', '数量'],
      ['りんご', '10'],
      ['みかん', '20'],
    ]);
    expect(table).toEqual(original);
  });

  it('2. コード列の右にある全国を検出する', () => {
    const table: Table = [
      ['コード', '都道府県', '人口'],
      ['01000', '全国', '1000'],
      ['01001', '北海道', '500'],
      ['02001', '青森県', '200'],
    ];

    const finding = warnings(totalsCheck.detect(table, ctx), 'grand')[0];
    expect(finding).toBeDefined();
    expect(finding.metadata).toMatchObject({
      kind: 'grand',
      rows: [1],
      labels: ['全国'],
    });
    expect(warnings(totalsCheck.detect(table, ctx), 'total-column')).toHaveLength(0);
  });

  it('3. 東北計は小計として別 Finding になり、その fix は小計行だけを消す', () => {
    const table: Table = [
      ['地域', '人口'],
      ['北海道', '100'],
      ['青森', '80'],
      ['岩手', '70'],
      ['東北計', '250'],
      ['全国', '500'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    const subtotal = warnings(findings, 'subtotal')[0];
    const grand = warnings(findings, 'grand')[0];
    expect(subtotal).toBeDefined();
    expect(grand).toBeDefined();
    expect(subtotal.metadata).toMatchObject({ rows: [4], labels: ['東北計'] });
    expect(subtotal.fix?.description).toBe('小計行を削除（行 5）');

    const applied = subtotal.fix!.apply(table);
    expect(applied.map(row => row[0])).toEqual(['地域', '北海道', '青森', '岩手', '全国']);
    expect(warnings(totalsCheck.detect(applied, ctx), 'subtotal')).toHaveLength(0);
    expect(warnings(totalsCheck.detect(applied, ctx), 'grand')).toHaveLength(1);
  });

  it('4. 総数・（合計）・計 Total・◎全国を集計行として検出する', () => {
    const labels = ['総　数', '（合計）', '計 Total', '◎全国'];
    for (const label of labels) {
      const table: Table = [
        ['項目', '値'],
        [label, '1'],
        ['りんご', '2'],
        ['みかん', '3'],
      ];
      const finding = warnings(totalsCheck.detect(table, ctx), 'grand')[0];
      expect(finding, label).toBeDefined();
      expect(finding.metadata).toMatchObject({ kind: 'grand', rows: [1], labels: [label] });
      expect(finding.message).toContain(`「${label}」`);
    }
  });

  it('5. （再掲）政令市・うち女性を再掲行として検出し、うちわは検出しない', () => {
    const table: Table = [
      ['項目', '数量'],
      ['（再掲）政令市', '10'],
      ['うち女性', '20'],
      ['うちわ', '30'],
      ['りんご', '40'],
      ['みかん', '50'],
    ];

    const finding = warnings(totalsCheck.detect(table, ctx), 'restated')[0];
    expect(finding).toBeDefined();
    expect(finding.metadata).toMatchObject({
      kind: 'restated',
      rows: [1, 2],
      labels: ['（再掲）政令市', 'うち女性'],
    });
    expect(finding.fix?.description).toBe('再掲行を削除（行 2, 3）');
    expect(finding.message).toContain('行 2「（再掲）政令市」');
    expect(finding.message).toContain('行 3「うち女性」');

    const applied = finding.fix!.apply(table);
    expect(applied.map(row => row[0])).toEqual(['項目', 'うちわ', 'りんご', 'みかん']);
    expect(warnings(totalsCheck.detect(table, ctx)).every(f => f.metadata?.kind === 'restated')).toBe(true);
  });

  it('6. 見出し「総数」の列を合計列として検出し、fix で列が消え deletedCols が設定される', () => {
    const table: Table = [
      ['地域', '総数', '男', '女'],
      ['北海道', '100', '40', '60'],
      ['青森', '80', '30', '50'],
      ['秋田', '70', '30', '40'],
    ];
    const original = snapshot(table);

    const finding = warnings(totalsCheck.detect(table, ctx), 'total-column')[0];
    expect(finding).toBeDefined();
    expect(finding.metadata).toMatchObject({
      kind: 'total-column',
      cols: [1],
      labels: ['総数'],
      verifiedCols: [],
    });
    expect(finding.ranges).toEqual([
      { startRow: 0, startCol: 1, endRow: 3, endCol: 1 },
    ]);
    expect(finding.fix?.description).toBe('合計列を削除（列 B）');
    expect(finding.fix?.deletedCols).toEqual([1]);
    expect(finding.message).toContain('列 B「総数」');

    const applied = finding.fix!.apply(table);
    expect(applied).toEqual([
      ['地域', '男', '女'],
      ['北海道', '40', '60'],
      ['青森', '30', '50'],
      ['秋田', '30', '40'],
    ]);
    expect(table).toEqual(original);
  });

  it('7. 人口_総数 と 合計（人）を合計列として検出する', () => {
    const flat: Table = [
      ['地域', '人口_総数', '人口_男', '人口_女'],
      ['北海道', '100', '40', '60'],
      ['青森', '80', '30', '50'],
    ];
    const flatFinding = warnings(totalsCheck.detect(flat, ctx), 'total-column')[0];
    expect(flatFinding).toBeDefined();
    expect(flatFinding.metadata).toMatchObject({ cols: [1], labels: ['人口_総数'] });

    const withUnit: Table = [
      ['品目', '男', '女', '合計（人）'],
      ['りんご', '10', '12', '22'],
      ['みかん', '8', '9', '17'],
    ];
    const unitFinding = warnings(totalsCheck.detect(withUnit, ctx), 'total-column')[0];
    expect(unitFinding).toBeDefined();
    expect(unitFinding.metadata).toMatchObject({ cols: [3], labels: ['合計（人）'] });
    expect(unitFinding.message).toContain('列 D「合計（人）」');
  });

  it('8. 値の列が1つしかない表では合計列を出さない', () => {
    const table: Table = [
      ['品目', '合計'],
      ['りんご', '10'],
      ['みかん', '20'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings, 'total-column')).toHaveLength(0);
    expect(warnings(findings)).toHaveLength(0);
    expect(findings.map(f => f.message)).toContain('合計・小計行は見つかりませんでした。');
  });

  it('9. 温度計などは検出せず、学生計・株主計は小計として検出する', () => {
    const table: Table = [
      ['項目', '金額'],
      ['温度計', '1'],
      ['体重計', '2'],
      ['一般会計', '3'],
      ['家計', '4'],
      ['統計', '5'],
      ['推計', '6'],
      ['計画', '7'],
      ['学生計', '8'],
      ['株主計', '9'],
      ['りんご', '10'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings, 'grand')).toHaveLength(0);
    expect(warnings(findings, 'restated')).toHaveLength(0);
    const subtotal = warnings(findings, 'subtotal')[0];
    expect(subtotal).toBeDefined();
    expect(subtotal.metadata).toMatchObject({
      rows: [8, 9],
      labels: ['学生計', '株主計'],
    });
  });

  it('10. 全行が全国の列では検出しない', () => {
    const table: Table = [
      ['地域', '年', '人口'],
      ['全国', '2020', '100'],
      ['全国', '2021', '110'],
      ['全国', '2022', '120'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings)).toHaveLength(0);
    expect(findings[0]?.message).toBe('合計・小計行は見つかりませんでした。');
  });

  it('11. 縦持ちの性別列にある総数行を検出する', () => {
    const table: Table = [
      ['年', '性別', '人口'],
      ['2020', '総数', '100'],
      ['2020', '男', '48'],
      ['2020', '女', '52'],
      ['2021', '総数', '101'],
      ['2021', '男', '49'],
      ['2021', '女', '52'],
    ];

    const finding = warnings(totalsCheck.detect(table, ctx), 'grand')[0];
    expect(finding).toBeDefined();
    expect(finding.metadata).toMatchObject({
      rows: [1, 4],
      labels: ['総数', '総数'],
    });
    expect(finding.fix?.description).toBe('集計行を削除（行 2, 5）');

    const applied = finding.fix!.apply(table);
    expect(applied.map(row => row[1])).toEqual(['性別', '男', '女', '男', '女']);
  });

  it('13. 見出し行の合計という文字は集計行として扱わない', () => {
    const table: Table = [
      ['合計', '備考'],
      ['りんご', 'あ'],
      ['みかん', 'い'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings)).toHaveLength(0);
    expect(findings.map(f => f.message)).toEqual(['合計・小計行は見つかりませんでした。']);
  });

  it('14. 値のない（再掲）だけの行は削除対象にならず info になる', () => {
    const table: Table = [
      ['地域', '人口'],
      ['北海道', '100'],
      ['青森', '80'],
      ['（再掲）', ''],
      ['東京', '50'],
      ['大阪', '40'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings)).toHaveLength(0);
    expect(findings).toHaveLength(1);
    const info = findings[0];
    expect(info.severity).toBe('info');
    expect(info.fix).toBeUndefined();
    expect(info.message).toBe(
      '「（再掲）」の見出し行があります（行 4）。この下の行はほかの行と重複している可能性があるので、確認してください。',
    );
    expect(info.ranges).toEqual([
      { startRow: 3, startCol: 0, endRow: 3, endCol: 1 },
    ]);
  });

  it('15. 問題がなければ「見つかりませんでした」の info を出す', () => {
    const table: Table = [
      ['品目', '数量'],
      ['りんご', '10'],
      ['みかん', '20'],
    ];

    const findings = totalsCheck.detect(table, ctx);
    expect(findings).toEqual([
      {
        checkId: 'totals',
        severity: 'info',
        ranges: [],
        message: '合計・小計行は見つかりませんでした。',
      },
    ]);
  });

  it('16. fix は元の表を書き換えない', () => {
    const table: Table = [
      ['品目', '数量'],
      ['りんご', '10'],
      ['合計', '10'],
      ['みかん', '20'],
    ];
    const original = snapshot(table);
    const finding = warnings(totalsCheck.detect(table, ctx), 'grand')[0];
    const applied = finding.fix!.apply(table);

    expect(table).toEqual(original);
    expect(applied).not.toBe(table);
    expect(applied).not.toEqual(original);
    expect(table.map(row => row[0])).toEqual(['品目', 'りんご', '合計', 'みかん']);
  });

  it('17. fix 適用後に再検出すると、その種類の warning は 0 件', () => {
    const table: Table = [
      ['地域', '総数', '男', '女'],
      ['全国', '30', '10', '20'],
      ['北海道', '10', '4', '6'],
      ['青森', '8', '3', '5'],
      ['秋田', '7', '3', '4'],
      ['岩手', '6', '2', '4'],
      ['東北計', '21', '8', '13'],
      ['（再掲）政令市', '5', '2', '3'],
    ];

    for (const kind of ['grand', 'subtotal', 'restated', 'total-column'] as const) {
      const finding = warnings(totalsCheck.detect(table, ctx), kind)[0];
      expect(finding, kind).toBeDefined();
      const applied = finding.fix!.apply(snapshot(table));
      expect(warnings(totalsCheck.detect(applied, ctx), kind)).toHaveLength(0);
    }
  });

  it('with-totals.csv は集計行・小計行・再掲行・合計列の4件', () => {
    const table = loadFixture('with-totals.csv');
    expect(table).toEqual([
      ['地域', '都道府県', '総数', '男', '女'],
      ['', '全国', '1500', '720', '780'],
      ['北海道', '北海道', '500', '240', '260'],
      ['東北', '青森県', '300', '140', '160'],
      ['東北', '岩手県', '250', '120', '130'],
      ['東北', '宮城県', '450', '220', '230'],
      ['東北', '東北計', '1000', '480', '520'],
      ['', '（再掲）政令市', '200', '95', '105'],
    ]);

    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings).map(f => f.metadata?.kind)).toEqual([
      'grand',
      'subtotal',
      'restated',
      'total-column',
    ]);
    expect(findings.filter(f => f.severity === 'info')).toHaveLength(0);
    expect(findings.every(f => !f.message.includes('一致しました'))).toBe(true);

    expect(findings[0].metadata).toMatchObject({
      rows: [1],
      labels: ['全国'],
      verifiedRows: [],
    });
    expect(findings[0].message).toContain('行 2「全国」');
    expect(findings[1].metadata).toMatchObject({ rows: [6], labels: ['東北計'] });
    expect(findings[1].message).toContain('行 7「東北計」');
    expect(findings[2].metadata).toMatchObject({ rows: [7], labels: ['（再掲）政令市'] });
    expect(findings[2].message).toContain('行 8「（再掲）政令市」');
    expect(findings[3].metadata).toMatchObject({ cols: [2], labels: ['総数'], verifiedCols: [] });
    expect(findings[3].message).toContain('列 C「総数」');
    expect(findings[3].fix?.description).toBe('合計列を削除（列 C）');

    let current = table;
    for (let i = 0; i < 6; i++) {
      const next = warnings(totalsCheck.detect(current, ctx))[0];
      if (!next?.fix) break;
      current = next.fix.apply(current);
    }
    expect(current).toEqual([
      ['地域', '都道府県', '男', '女'],
      ['北海道', '北海道', '240', '260'],
      ['東北', '青森県', '140', '160'],
      ['東北', '岩手県', '120', '130'],
      ['東北', '宮城県', '220', '230'],
    ]);
    expect(warnings(totalsCheck.detect(current, ctx))).toHaveLength(0);
  });

  it('totals-false-positives.csv は見つかりませんでした', () => {
    const table = loadFixture('totals-false-positives.csv');
    const findings = totalsCheck.detect(table, ctx);
    expect(warnings(findings)).toHaveLength(0);
    expect(findings.map(f => f.message)).toEqual(['合計・小計行は見つかりませんでした。']);
  });
});
