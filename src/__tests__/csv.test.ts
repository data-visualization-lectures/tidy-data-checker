import { describe, it, expect } from 'vitest';
import { parseCSV, tableToCSV } from '../utils/csv';
import type { Table } from '../types';

describe('parseCSV', () => {
  it('should parse simple CSV', () => {
    const text = 'a,b,c\n1,2,3';

    const result = parseCSV(text);

    expect(result).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('should handle Japanese text', () => {
    const text = '都道府県,人口\n北海道,5140000';

    const result = parseCSV(text);

    expect(result).toEqual([
      ['都道府県', '人口'],
      ['北海道', '5140000'],
    ]);
  });

  it('should preserve empty rows', () => {
    const text = 'a,b\n\nc,d';

    const result = parseCSV(text);

    expect(result.length).toBe(3);
    expect(result[1]).toEqual(['']);
  });

  it('should handle quoted values with commas', () => {
    const text = 'name,description\n"田中, 太郎","東京都, 港区"\n';

    const result = parseCSV(text);

    expect(result[1][0]).toBe('田中, 太郎');
    expect(result[1][1]).toBe('東京都, 港区');
  });

  it('should handle values with quotes inside', () => {
    const text = 'text\n"""引用""テスト"\n';

    const result = parseCSV(text);

    expect(result[1][0]).toBe('"引用"テスト');
  });
});

describe('tableToCSV', () => {
  it('should convert table to CSV string', () => {
    const table: Table = [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ];

    const result = tableToCSV(table);

    expect(result).toBe('a,b,c\n1,2,3');
  });

  it('should handle Japanese text', () => {
    const table: Table = [
      ['都道府県', '人口'],
      ['北海道', '5140000'],
    ];

    const result = tableToCSV(table);

    expect(result).toContain('都道府県');
    expect(result).toContain('北海道');
  });

  it('should add BOM when requested', () => {
    const table: Table = [['a', 'b']];

    const result = tableToCSV(table, true);

    expect(result.charCodeAt(0)).toBe(0xFEFF);
  });

  it('should not add BOM by default', () => {
    const table: Table = [['a', 'b']];

    const result = tableToCSV(table, false);

    expect(result.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('should quote values with commas', () => {
    const table: Table = [['田中, 太郎', 'value']];

    const result = tableToCSV(table);

    expect(result).toContain('"田中, 太郎"');
  });
});
