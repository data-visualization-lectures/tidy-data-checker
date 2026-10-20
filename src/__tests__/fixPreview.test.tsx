import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixPreview } from '../components/FixPreview';
import type { Finding, Table } from '../types';

function findingFor(ranges: Finding['ranges'], fix: Finding['fix']): Finding {
  return {
    checkId: 'symbols',
    severity: 'warning',
    ranges,
    message: '記号',
    fix,
  };
}

describe('FixPreview highlight on the after grid', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderPreview(finding: Finding, currentTable: Table, previewTable: Table) {
    act(() => {
      root.render(
        <FixPreview
          finding={finding}
          currentTable={currentTable}
          previewTable={previewTable}
          onApply={() => {}}
          onCancel={() => {}}
        />,
      );
    });
  }

  function highlightedCells(side: 'before' | 'after'): string[] {
    const pane = container.querySelector(`.fix-preview-${side}`);
    return Array.from(pane?.querySelectorAll('td.highlighted') ?? []).map(cell => cell.textContent ?? '');
  }

  it('手順7のように値が変わる修正では、修正後の変わったセルも強調する', () => {
    const current: Table = [
      ['都道府県', '事業所数'],
      ['北海道', 'x'],
      ['青森県', '-'],
    ];
    const preview: Table = [
      ['都道府県', '事業所数'],
      ['北海道', ''],
      ['青森県', ''],
    ];
    const finding = findingFor(
      [
        { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
        { startRow: 2, startCol: 1, endRow: 2, endCol: 1 },
      ],
      { description: '記号を空欄にする（2 セル）', apply: () => preview },
    );

    renderPreview(finding, current, preview);

    expect(highlightedCells('before')).toEqual(['x', '-']);
    expect(highlightedCells('after')).toEqual(['', '']);
  });

  it('行が減る修正では、修正後の側を強調しない', () => {
    const current: Table = [
      ['地域', '都道府県', '総数'],
      ['', '全国', '1500'],
      ['北海道', '北海道', '500'],
    ];
    const preview: Table = [
      ['地域', '都道府県', '総数'],
      ['北海道', '北海道', '500'],
    ];
    const finding = findingFor(
      [{ startRow: 1, startCol: 0, endRow: 1, endCol: 2 }],
      {
        description: '集計行を削除（行 2）',
        apply: () => preview,
        deletedRows: [1],
      },
    );

    renderPreview(finding, current, preview);

    expect(highlightedCells('before')).toEqual(['', '全国', '1500']);
    expect(highlightedCells('after')).toEqual([]);
  });

  it('fix.deletedCols がある修正では、行数が同じでも修正後の側を強調しない', () => {
    const current: Table = [
      ['地域', '総数', '男'],
      ['北海道', '500', '240'],
    ];
    const preview: Table = [
      ['地域', '男'],
      ['北海道', '240'],
    ];
    const finding = findingFor(
      [{ startRow: 0, startCol: 1, endRow: 1, endCol: 1 }],
      {
        description: '合計列を削除（B）',
        apply: () => preview,
        deletedCols: [1],
      },
    );

    renderPreview(finding, current, preview);

    expect(highlightedCells('before')).toEqual(['総数', '500']);
    expect(highlightedCells('after')).toEqual([]);
  });
});
