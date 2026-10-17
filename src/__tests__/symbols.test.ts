import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { symbolsCheck } from '../checks/symbols';
import { parseCSV } from '../utils/csv';
import { deriveCheckpointStatus } from '../utils/checkpointStatus';
import type { Finding, Table, CheckContext } from '../types';

function ctx(): CheckContext {
  return { fileName: 'test.csv', encoding: 'UTF-8', hasBom: false };
}

function byKind(findings: Finding[], kind: string): Finding {
  const finding = findings.find(f => f.metadata?.kind === kind);
  if (!finding) throw new Error(`missing finding: ${kind}`);
  return finding;
}

function applyWarnings(table: Table, findings: Finding[]): Table {
  return findings.reduce((current, finding) => {
    if (finding.severity !== 'warning' || !finding.fix) return current;
    return finding.fix.apply(current);
  }, table);
}

function loadSymbolsFixture(): Table {
  const text = readFileSync(join(__dirname, 'fixtures/with-symbols.csv'), 'utf8');
  const table = parseCSV(text);
  while (table.length > 0 && table[table.length - 1].every(cell => cell.trim() === '')) {
    table.pop();
  }
  return table;
}

const EXPECTED_AFTER_MAIN_FIXES: Table = [
  ['都道府県', '事業所数', '従業者数', '前年比', '備考'],
  ['北海道', '1234', '', '-1.5', ''],
  ['青森県', '', '', '2.0', '-'],
  ['岩手県', '567', '8901', '-0.3', '※速報'],
  ['宮城県', '890', '', '', ''],
  ['秋田県', '<5', '1200', '0.0', ''],
];

describe('symbolsCheck', () => {
  it('1. detects x, X, ｘ, 秘匿 as missing and clears them', () => {
    const table: Table = [
      ['地域', '人口'],
      ['A', 'x'],
      ['B', 'X'],
      ['C', 'ｘ'],
      ['D', '秘匿'],
      ['E', '100'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const missing = byKind(findings, 'missing');

    expect(findings.filter(f => f.severity === 'warning')).toHaveLength(1);
    expect(missing.severity).toBe('warning');
    expect(missing.message).toBe(
      '欠損・秘匿を表す記号が 4 個見つかりました（x: 1, X: 1, ｘ: 1, 秘匿: 1）。数値の列に文字が混ざっていると、表計算ソフトや Python で数値として扱えません。空欄にすると「値なし」として読み込めます。',
    );
    expect(missing.fix?.description).toBe('記号を空欄にする（4 セル）');
    expect(missing.fix?.apply(table)).toEqual([
      ['地域', '人口'],
      ['A', ''],
      ['B', ''],
      ['C', ''],
      ['D', ''],
      ['E', '100'],
    ]);
  });

  it('2. detects ellipsis and stars as missing', () => {
    const table: Table = [
      ['地域', '値'],
      ['A', '…'],
      ['B', '・・・'],
      ['C', '...'],
      ['D', '‥'],
      ['E', '***'],
      ['F', '10'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const missing = byKind(findings, 'missing');

    expect(missing.metadata?.counts).toEqual({
      '…': 1,
      '・・・': 1,
      '...': 1,
      '‥': 1,
      '***': 1,
    });
    expect(missing.fix?.apply(table).slice(1).map(row => row[1])).toEqual(['', '', '', '', '', '10']);
  });

  it('3. detects dash-only cells and clears them', () => {
    const table: Table = [
      ['地域', '値'],
      ['A', '-'],
      ['B', '－'],
      ['C', '―'],
      ['D', '—'],
      ['E', 'ー'],
      ['F', '10'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const dash = byKind(findings, 'dash');

    expect(findings.filter(f => f.severity === 'warning')).toEqual([dash]);
    expect(dash.message).toBe(
      '「-」などのダッシュが 5 個見つかりました。統計表では「該当する数字がない」を表すことが多い記号です。',
    );
    expect(dash.fix?.description).toBe('「-」を空欄にする（5 セル）');
    expect(dash.fix?.apply(table).slice(1).map(row => row[1])).toEqual(['', '', '', '', '', '10']);
  });

  it('4. replaces △ and ▲ with a minus sign and keeps full-width digits', () => {
    const table: Table = [
      ['品目', '前年差'],
      ['米', '△1.5'],
      ['麦', '▲１，２３４'],
      ['豆', '2.0'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const negative = byKind(findings, 'negative');

    expect(negative.message).toBe(
      '△・▲ の付いた数値が 2 個見つかりました。日本の統計ではマイナス（減少）を表します。',
    );
    expect(negative.fix?.description).toBe('△・▲ をマイナス記号に置き換える（2 セル）');
    expect(negative.fix?.apply(table)).toEqual([
      ['品目', '前年差'],
      ['米', '-1.5'],
      ['麦', '-１，２３４'],
      ['豆', '2.0'],
    ]);
  });

  it('5. drops only the note mark and keeps the number', () => {
    const table: Table = [
      ['品目', '数量'],
      ['A', '1,234※'],
      ['B', '※1,234'],
      ['C', '123p'],
      ['D', '456r'],
      ['E', '789*'],
      ['F', '1,234¹'],
      ['G', '1,234（注１）'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const marker = byKind(findings, 'marker');

    expect(marker.message).toBe(
      '注記マーク（※・*・p など）の付いた数値が 7 個見つかりました。マークを外すと数値として扱えます。',
    );
    expect(marker.fix?.description).toBe('注記マークを外す（7 セル）');
    expect(marker.fix?.apply(table).slice(1).map(row => row[1])).toEqual([
      '1,234',
      '1,234',
      '123',
      '456',
      '789',
      '1,234',
      '1,234',
    ]);
  });

  it('6. does not treat a negative number as a dash or a triangle', () => {
    const table: Table = [
      ['品目', '差'],
      ['A', '-1,234'],
      ['B', '0'],
      ['C', '1234'],
      ['D', '2.0'],
    ];

    const findings = symbolsCheck.detect(table, ctx());

    expect(findings.map(f => f.metadata?.kind)).toEqual([undefined]);
    expect(findings[0].message).toBe('値の中の記号は見つかりませんでした。');
    expect(findings[0].severity).toBe('info');
  });

  it('7. ignores dashes and notes in a text column', () => {
    const table: Table = [
      ['都道府県', '事業所数', '備考'],
      ['北海道', '100', 'メモ'],
      ['青森県', '-', '-'],
      ['岩手県', '200', '※速報'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const dash = byKind(findings, 'dash');

    expect(dash.metadata?.cols).toEqual([1]);
    expect(dash.ranges.every(range => range.startCol === 1 && range.endCol === 1)).toBe(true);
    expect(dash.fix?.apply(table)).toEqual([
      ['都道府県', '事業所数', '備考'],
      ['北海道', '100', 'メモ'],
      ['青森県', '', '-'],
      ['岩手県', '200', '※速報'],
    ]);
  });

  it('8. ignores the header row and a note row below the data', () => {
    const table: Table = [
      ['都道府県', 'x'],
      ['北海道', '100'],
      ['青森県', '…'],
      ['※ 一部推計'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const missing = byKind(findings, 'missing');

    expect(missing.ranges).toEqual([
      { startRow: 2, startCol: 1, endRow: 2, endCol: 1 },
    ]);
    expect(missing.fix?.apply(table)[0]).toEqual(['都道府県', 'x']);
    expect(missing.fix?.apply(table)[3]).toEqual(['※ 一部推計']);
    expect(missing.fix?.apply(table)[2][1]).toBe('');
  });

  it('9. ignores a code column', () => {
    const table: Table = [
      ['コード', '価格'],
      ['02', '100'],
      ['x', '△5'],
      ['01', '-'],
    ];

    const findings = symbolsCheck.detect(table, ctx());

    expect(findings.map(f => f.metadata?.kind)).toEqual(['dash', 'negative']);
    for (const finding of findings) {
      expect(finding.ranges.every(range => range.startCol === 1)).toBe(true);
    }
    expect(applyWarnings(table, findings)).toEqual([
      ['コード', '価格'],
      ['02', '100'],
      ['x', '-5'],
      ['01', ''],
    ]);
  });

  it('10. detects a column of only x when another column is numeric', () => {
    const table: Table = [
      ['地域', '人口', '秘匿列'],
      ['A市', '100', 'x'],
      ['B町', '200', 'x'],
      ['C村', '300', 'x'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    const missing = byKind(findings, 'missing');

    expect(missing.metadata).toMatchObject({ kind: 'missing', counts: { x: 3 }, cols: [2] });
    expect(missing.fix?.apply(table).map(row => row[2])).toEqual(['秘匿列', '', '', '']);
  });

  it('11. reports unknown symbols as info and does not change the table', () => {
    const table: Table = [
      ['地域', '値'],
      ['A', '<0.5'],
      ['B', '約100'],
      ['C', '(123)'],
      ['D', '100以上'],
      ['E', '△'],
      ['F', '50'],
    ];
    const snapshot = JSON.parse(JSON.stringify(table)) as Table;

    const findings = symbolsCheck.detect(table, ctx());
    const unknown = byKind(findings, 'unknown');

    expect(findings.filter(f => f.severity === 'warning')).toHaveLength(0);
    expect(unknown.severity).toBe('info');
    expect(unknown.fix).toBeUndefined();
    expect(unknown.message).toBe(
      '数値の列に、自動では判断できない記号が 5 個あります（例: 「<0.5」「約100」）。意味が変わるおそれがあるので、必要なら元の資料で確認してください。',
    );
    expect(unknown.metadata?.counts).toEqual({
      '<0.5': 1,
      '約100': 1,
      '(123)': 1,
      '100以上': 1,
      '△': 1,
    });
    expect(table).toEqual(snapshot);
  });

  it('16. does not mutate the table, and applying a fix twice changes nothing more', () => {
    const table = loadSymbolsFixture();
    const snapshot = JSON.parse(JSON.stringify(table)) as Table;
    const findings = symbolsCheck.detect(table, ctx());

    expect(table).toEqual(snapshot);

    for (const finding of findings) {
      if (!finding.fix) continue;
      const once = finding.fix.apply(snapshot);
      const twice = finding.fix.apply(once);
      expect(snapshot).toEqual(table);
      expect(twice).toEqual(once);
    }

    const fixed = applyWarnings(table, findings);
    expect(fixed).toEqual(EXPECTED_AFTER_MAIN_FIXES);
    expect(symbolsCheck.detect(fixed, ctx()).filter(f => f.severity === 'warning')).toEqual([]);

    const again = applyWarnings(fixed, symbolsCheck.detect(fixed, ctx()));
    expect(again).toEqual(fixed);
  });

  it('does not offer the alternative fixes', () => {
    const findings = symbolsCheck.detect(loadSymbolsFixture(), ctx());
    expect(findings.some(f => f.message.includes('別の方法'))).toBe(false);
    expect(findings.some(f => f.metadata?.kind === 'dash-to-zero' || f.metadata?.kind === 'flag-columns')).toBe(false);
  });

  it('ignores a column whose header ends with _注記', () => {
    const table: Table = [
      ['都道府県', '従業者数', '従業者数_注記'],
      ['北海道', '100', 'x'],
      ['青森県', '200', '…'],
    ];

    const findings = symbolsCheck.detect(table, ctx());
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: '値の中の記号は見つかりませんでした。',
      }),
    ]);
  });

  describe('with-symbols.csv', () => {
    it('reports 4 warnings and an info for <5, and the main fixes match example 1', () => {
      const table = loadSymbolsFixture();
      const findings = symbolsCheck.detect(table, ctx());

      expect(findings.map(f => f.metadata?.kind)).toEqual([
        'missing',
        'dash',
        'negative',
        'marker',
        'unknown',
      ]);

      const missing = byKind(findings, 'missing');
      const dash = byKind(findings, 'dash');
      const negative = byKind(findings, 'negative');
      const marker = byKind(findings, 'marker');
      const unknown = byKind(findings, 'unknown');

      expect(missing.message).toContain('x: 1, …: 1, ***: 1');
      expect(missing.metadata).toMatchObject({ counts: { x: 1, '…': 1, '***': 1 }, cols: [2] });
      expect(missing.ranges).toEqual([
        { startRow: 1, startCol: 2, endRow: 2, endCol: 2 },
        { startRow: 4, startCol: 2, endRow: 4, endCol: 2 },
      ]);

      expect(dash.metadata).toMatchObject({ counts: { '-': 2 }, cols: [1, 3] });
      expect(dash.fix?.description).toBe('「-」を空欄にする（2 セル）');

      expect(negative.metadata).toMatchObject({ counts: { '△': 1, '▲': 1 }, cols: [3] });
      expect(negative.fix?.description).toBe('△・▲ をマイナス記号に置き換える（2 セル）');

      expect(marker.metadata).toMatchObject({ counts: { '※': 1, p: 1 }, cols: [1, 2] });
      expect(marker.fix?.description).toBe('注記マークを外す（2 セル）');

      expect(unknown.severity).toBe('info');
      expect(unknown.fix).toBeUndefined();
      expect(unknown.message).toContain('「<5」');
      expect(unknown.ranges).toEqual([
        { startRow: 5, startCol: 1, endRow: 5, endCol: 1 },
      ]);

      const status = deriveCheckpointStatus('symbols', findings, true);
      expect(status).toMatchObject({ type: 'found', count: 4 });

      expect(applyWarnings(table, findings)).toEqual(EXPECTED_AFTER_MAIN_FIXES);

      const after = symbolsCheck.detect(EXPECTED_AFTER_MAIN_FIXES, ctx());
      expect(after.filter(f => f.severity === 'warning')).toHaveLength(0);
      expect(after[0].message).toContain('「<5」');
    });
  });

  describe('wide fiscal-year headers', () => {
    it('detects symbols in 平成30年度 / 令和元年度 columns', () => {
      const table: Table = [
        ['都道府県', '平成30年度', '令和元年度'],
        ['北海道', '1234', '100'],
        ['青森県', 'x', '△10'],
        ['秋田県', '500', '…'],
      ];

      const findings = symbolsCheck.detect(table, ctx());
      const missing = byKind(findings, 'missing');
      const negative = byKind(findings, 'negative');

      expect(missing.metadata?.cols).toEqual([1, 2]);
      expect(negative.metadata?.cols).toEqual([2]);
      expect(negative.fix?.apply(table)[2][2]).toBe('-10');
      expect(missing.fix?.apply(table)[2][1]).toBe('');
      expect(missing.fix?.apply(table)[3][2]).toBe('');
    });
  });
});
