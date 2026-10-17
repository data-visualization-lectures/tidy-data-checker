import { describe, it, expect } from 'vitest';
import { applyCellEdits, createCellEditFix } from '../utils/cellEdit';
import type { Table } from '../types';

describe('applyCellEdits', () => {
  it('should write values into the given cells', () => {
    const table: Table = [
      ['品目', '前年差'],
      ['米', '△1.5'],
      ['麦', '▲１，２３４'],
    ];

    expect(applyCellEdits(table, [
      { row: 1, col: 1, value: '-1.5' },
      { row: 2, col: 1, value: '-１，２３４' },
    ])).toEqual([
      ['品目', '前年差'],
      ['米', '-1.5'],
      ['麦', '-１，２３４'],
    ]);
  });

  it('should not mutate the original table', () => {
    const table: Table = [
      ['都道府県', '従業者数'],
      ['北海道', 'x'],
      ['青森県', '…'],
    ];
    const originalCopy = JSON.parse(JSON.stringify(table));

    applyCellEdits(table, [
      { row: 1, col: 1, value: '' },
      { row: 2, col: 1, value: '' },
      { row: 0, col: 2, value: '従業者数_注記' },
    ]);

    expect(table).toEqual(originalCopy);
  });

  it('should copy only the edited rows', () => {
    const table: Table = [
      ['都道府県', '従業者数'],
      ['北海道', 'x'],
      ['青森県', '8901'],
    ];

    const result = applyCellEdits(table, [
      { row: 1, col: 0, value: '北海道庁' },
      { row: 1, col: 1, value: '' },
    ]);

    expect(result).not.toBe(table);
    expect(result[0]).toBe(table[0]);
    expect(result[1]).not.toBe(table[1]);
    expect(result[1]).toEqual(['北海道庁', '']);
    expect(result[2]).toBe(table[2]);
  });

  it('should pad short rows with empty strings', () => {
    const table: Table = [
      ['都道府県', '従業者数'],
      ['北海道'],
      ['青森県', '8901'],
    ];

    const result = applyCellEdits(table, [
      { row: 0, col: 2, value: '従業者数_注記' },
      { row: 1, col: 3, value: 'x' },
    ]);

    expect(result[0]).toEqual(['都道府県', '従業者数', '従業者数_注記']);
    expect(result[1]).toEqual(['北海道', '', '', 'x']);
    expect(result[2]).toEqual(['青森県', '8901']);
  });

  it('should ignore edits outside the table rows', () => {
    const table: Table = [['A', 'B'], ['1', '2']];

    const result = applyCellEdits(table, [
      { row: 5, col: 0, value: 'x' },
      { row: -1, col: 0, value: 'x' },
      { row: 1, col: -1, value: 'x' },
    ]);

    expect(result).toEqual([['A', 'B'], ['1', '2']]);
  });

  it('should return an equal table for no edits', () => {
    const table: Table = [['A'], ['1']];
    expect(applyCellEdits(table, [])).toEqual(table);
  });
});

describe('createCellEditFix', () => {
  it('should create a fix that applies the edits without deleting rows or columns', () => {
    const table: Table = [
      ['都道府県', '事業所数'],
      ['青森県', '-'],
      ['岩手県', '567'],
    ];

    const fix = createCellEditFix('「-」を 0 にする（1 セル）', [{ row: 1, col: 1, value: '0' }]);

    expect(fix.description).toBe('「-」を 0 にする（1 セル）');
    expect(fix.deletedRows).toBeUndefined();
    expect(fix.deletedCols).toBeUndefined();
    expect(fix.apply(table)).toEqual([
      ['都道府県', '事業所数'],
      ['青森県', '0'],
      ['岩手県', '567'],
    ]);
  });

  it('should be pure and give the same result when applied again', () => {
    const table: Table = [
      ['都道府県', '従業者数'],
      ['北海道', 'x'],
    ];
    const originalCopy = JSON.parse(JSON.stringify(table));
    const fix = createCellEditFix('記号を空欄にする（1 セル）', [{ row: 1, col: 1, value: '' }]);

    const once = fix.apply(table);
    const twice = fix.apply(once);

    expect(table).toEqual(originalCopy);
    expect(twice).toEqual(once);
  });
});
