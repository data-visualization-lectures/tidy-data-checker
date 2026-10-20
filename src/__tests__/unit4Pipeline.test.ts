import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCSVWithMeta } from '../utils/csv';
import { getImplementedChecks } from '../checks/registry';
import type { Check, CheckContext, Finding, Fix, Table } from '../types';

const MAX_ITERATIONS = 50;

/** 手順6〜9。並べ替えはこの4つの中だけで行う。 */
const LATE_STEP_IDS = ['totals', 'symbols', 'format-number', 'wareki'] as const;

/**
 * 8.3節の期待表。
 * このCSVの「-」は空欄。見出しは「年」なので 2018（「年度」ではない）。
 * 「単位：事業所」は単位行であり、セルの中の単位ではない。
 */
const SECTION_83: Table = [
  ['都道府県', '2018', '2019', '2020'],
  ['北海道', '500', '', ''],
  ['青森県', '734', '', '1310'],
];

const PERMUTATIONS: ReadonlyArray<{ label: string; late: readonly string[] }> = [
  { label: '6789', late: ['totals', 'symbols', 'format-number', 'wareki'] },
  { label: '9876', late: ['wareki', 'format-number', 'symbols', 'totals'] },
  { label: '8796', late: ['format-number', 'wareki', 'symbols', 'totals'] },
  { label: '7968', late: ['symbols', 'wareki', 'totals', 'format-number'] },
];

interface PipelineResult {
  table: Table;
  converged: boolean;
  iterations: number;
}

function loadEstat(): { table: Table; ctx: CheckContext } {
  const text = readFileSync(join(__dirname, 'fixtures', 'estat-unit4.csv'), 'utf8');
  const parsed = parseCSVWithMeta(text);
  return {
    table: parsed.table,
    ctx: {
      fileName: 'estat-unit4.csv',
      encoding: 'UTF-8',
      hasBom: false,
      delimiter: parsed.delimiter,
    },
  };
}

function isWarningFix(finding: Finding): finding is Finding & { fix: Fix } {
  return finding.severity === 'warning' && finding.fix !== undefined;
}

function runAllChecks(table: Table, ctx: CheckContext, checks: Check[]): Finding[] {
  const findings: Finding[] = [];
  for (const check of checks) {
    findings.push(...check.detect(table, ctx));
  }
  return findings;
}

/**
 * 指定順で「その手順の warning の fix を1つ適用 → 全チェックを再実行」を繰り返す。
 * info の代替案は適用しない。
 */
function converge(table: Table, ctx: CheckContext, order: readonly string[]): PipelineResult {
  const checks = getImplementedChecks();
  const rank = new Map(order.map((id, index) => [id, index]));
  let current = table;
  let iterations = 0;
  let converged = false;

  while (iterations <= MAX_ITERATIONS) {
    const findings = runAllChecks(current, ctx, checks);
    const warnings = findings.filter(finding => finding.severity === 'warning');
    const next = findings
      .filter(isWarningFix)
      .filter(finding => rank.has(finding.checkId))
      .sort((a, b) => rank.get(a.checkId)! - rank.get(b.checkId)!)[0];

    if (!next) {
      converged = warnings.length === 0;
      break;
    }
    if (iterations === MAX_ITERATIONS) break;

    current = next.fix.apply(current);
    iterations += 1;
  }

  return { table: current, converged, iterations };
}

function registryOrder(): string[] {
  return getImplementedChecks().map(check => check.id);
}

/** 手順1〜5（手順6より前）を registry 順のまま先に置き、その後ろに手順6〜9を続ける。 */
function orderWithLateSteps(late: readonly string[]): string[] {
  const ids = registryOrder();
  const totalsIndex = ids.indexOf('totals');
  return [...ids.slice(0, totalsIndex), ...late];
}

function expectSection83(order: readonly string[]): void {
  const { table, ctx } = loadEstat();
  const result = converge(table, ctx, order);
  expect(result.converged).toBe(true);
  expect(result.iterations).toBeLessThanOrEqual(MAX_ITERATIONS);
  expect(result.table).toEqual(SECTION_83);
}

function syntheticTable(rowCount: number, colCount: number): Table {
  const header: string[] = [];
  for (let col = 0; col < colCount; col++) {
    header.push(`列${col + 1}`);
  }
  const table: Table = [header];
  for (let row = 1; row < rowCount; row++) {
    const cells: string[] = [];
    for (let col = 0; col < colCount; col++) {
      cells.push(col === 0 ? `地域${row % 47}` : String((row * 10 + col) % 10000));
    }
    table.push(cells);
  }
  return table;
}

describe('U4-12 統合', () => {
  it('registry 順に warning の主修正を繰り返すと 8.3節の表になる', () => {
    expectSection83(registryOrder());
  });

  describe('手順6〜9の順番', () => {
    for (const permutation of PERMUTATIONS) {
      it(`${permutation.label} でも 8.3節の表になる`, () => {
        expectSection83(orderWithLateSteps(permutation.late));
      });
    }
  });

  it('手順6〜9の detect は 2万行×10列で合計 3 秒未満', () => {
    const table = syntheticTable(20_000, 10);
    expect(table).toHaveLength(20_000);
    expect(table[0]).toHaveLength(10);

    const ctx: CheckContext = {
      fileName: 'synthetic.csv',
      encoding: 'UTF-8',
      hasBom: false,
    };
    const late = new Set<string>(LATE_STEP_IDS);
    const checks = getImplementedChecks().filter(check => late.has(check.id));
    expect(checks.map(check => check.id)).toEqual([...LATE_STEP_IDS]);

    const start = performance.now();
    for (const check of checks) {
      check.detect(table, ctx);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3_000);
  });
});
