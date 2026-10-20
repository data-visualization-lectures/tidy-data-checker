import { describe, it, expect } from 'vitest';
import {
  toHalfWidth,
  nfkcCompact,
  parseNumericCell,
  matchSymbol,
  classifyColumns,
  shiftDecimal,
  CODE_HEADER_RE,
  DATE_HEADER_RE,
  type ParsedNumber,
} from '../utils/values';
import { isValueCell } from '../utils/cellValue';
import { getDataRegion } from '../utils/dataRegion';
import type { Table } from '../types';

function parsed(overrides: Partial<ParsedNumber>): ParsedNumber {
  return {
    sign: '',
    digits: '',
    multiplier: '',
    unit: '',
    hasFullWidth: false,
    hasPadding: false,
    hasSeparator: false,
    ...overrides,
  };
}

function kindsOf(table: Table) {
  return classifyColumns(table, getDataRegion(table));
}

describe('toHalfWidth', () => {
  it('should convert full-width ASCII (U+FF01-U+FF5E) to half-width', () => {
    expect(toHalfWidth('１，２３４')).toBe('1,234');
    expect(toHalfWidth('ＡＢＣ％（注１）')).toBe('ABC%(注1)');
    expect(toHalfWidth('！～')).toBe('!~');
  });

  it('should convert U+3000 to a space and U+2212 / U+2010 to "-"', () => {
    expect(toHalfWidth('1\u30002')).toBe('1 2');
    expect(toHalfWidth('\u2212１２')).toBe('-12');
    expect(toHalfWidth('\u2010５')).toBe('-5');
  });

  it('should replace one character with one character', () => {
    const input = '　▲１，２３４人※　';
    expect(toHalfWidth(input).length).toBe(input.length);
  });

  it('should not touch superscripts, unit symbols or other dashes (no NFKC)', () => {
    expect(toHalfWidth('1121.26km²')).toBe('1121.26km²');
    expect(toHalfWidth('1,234¹')).toBe('1,234¹');
    expect(toHalfWidth('25℃ 10㎡')).toBe('25℃ 10㎡');
    expect(toHalfWidth('―ー')).toBe('―ー');
  });
});

describe('nfkcCompact', () => {
  it('should normalize ligatures and full-width characters', () => {
    expect(nfkcCompact('㍻30年')).toBe('平成30年');
    expect(nfkcCompact('㋿5年')).toBe('令和5年');
    expect(nfkcCompact('令和５年')).toBe('令和5年');
  });

  it('should remove all whitespace including U+3000', () => {
    expect(nfkcCompact('総　数')).toBe('総数');
    expect(nfkcCompact(' 令和 5 年 ')).toBe('令和5年');
  });
});

describe('parseNumericCell', () => {
  describe('3.3 table rows', () => {
    it('1,234 → digits 1234, with separator', () => {
      expect(parseNumericCell('1,234')).toEqual(parsed({ digits: '1234', hasSeparator: true }));
    });

    it('１，２３４ → digits 1234, full-width and separator', () => {
      expect(parseNumericCell('１，２３４')).toEqual(
        parsed({ digits: '1234', hasFullWidth: true, hasSeparator: true })
      );
    });

    it('"  123 " → digits 123, with padding', () => {
      expect(parseNumericCell('  123 ')).toEqual(parsed({ digits: '123', hasPadding: true }));
    });

    it('−１２ → sign -, digits 12, full-width', () => {
      expect(parseNumericCell('−１２')).toEqual(parsed({ sign: '-', digits: '12', hasFullWidth: true }));
    });

    it('２４８，９８９人 → digits 248989, unit 人, full-width and separator', () => {
      expect(parseNumericCell('２４８，９８９人')).toEqual(
        parsed({ digits: '248989', unit: '人', hasFullWidth: true, hasSeparator: true })
      );
    });

    it('1121.26km² → digits 1121.26, unit km²', () => {
      expect(parseNumericCell('1121.26km²')).toEqual(parsed({ digits: '1121.26', unit: 'km²' }));
    });

    it('1.2万人 → digits 1.2, multiplier 万, unit 人', () => {
      expect(parseNumericCell('1.2万人')).toEqual(parsed({ digits: '1.2', multiplier: '万', unit: '人' }));
    });

    it('０１ → digits 01 (leading zero kept)', () => {
      expect(parseNumericCell('０１')).toEqual(parsed({ digits: '01', hasFullWidth: true }));
    });

    it.each(['1,2', '12,34', '20～24歳', '65歳以上', '2020年', '第１位', '1.5e3'])(
      '%s → null',
      raw => {
        expect(parseNumericCell(raw)).toBeNull();
      }
    );
  });

  it('should accept only strict 3-digit separators', () => {
    expect(parseNumericCell('100,200')?.digits).toBe('100200');
    expect(parseNumericCell('1,234,567.89')?.digits).toBe('1234567.89');
    expect(parseNumericCell('1234,567')).toBeNull();
    expect(parseNumericCell('1,2345')).toBeNull();
  });

  it('should read signs, decimals and full-width padding', () => {
    expect(parseNumericCell('-1,234')).toEqual(parsed({ sign: '-', digits: '1234', hasSeparator: true }));
    expect(parseNumericCell('+5')).toEqual(parsed({ sign: '+', digits: '5' }));
    expect(parseNumericCell('１．５')).toEqual(parsed({ digits: '1.5', hasFullWidth: true }));
    expect(parseNumericCell('.5')?.digits).toBe('.5');
    expect(parseNumericCell('　123')).toEqual(parsed({ digits: '123', hasPadding: true }));
  });

  it('should read units and multipliers', () => {
    expect(parseNumericCell('11.6%')).toEqual(parsed({ digits: '11.6', unit: '%' }));
    expect(parseNumericCell('１２％')).toEqual(parsed({ digits: '12', unit: '%', hasFullWidth: true }));
    expect(parseNumericCell('8,000 人')).toEqual(parsed({ digits: '8000', unit: '人', hasSeparator: true }));
    expect(parseNumericCell('3億円')).toEqual(parsed({ digits: '3', multiplier: '億', unit: '円' }));
    expect(parseNumericCell('5万')).toEqual(parsed({ digits: '5', multiplier: '万' }));
    expect(parseNumericCell('120人/km²')?.unit).toBe('人/km²');
  });

  it.each(['4月', '2020年度', '1位', '15～64歳', '0〜14歳', '20歳未満', '', '   ', 'abc', '1 234'])(
    'should not treat %s as a number',
    raw => {
      expect(parseNumericCell(raw)).toBeNull();
    }
  );
});

describe('matchSymbol', () => {
  describe('3.3 table row: x X ｘ × 秘匿 秘 → missing', () => {
    it.each(['x', 'X', 'ｘ', '×', '秘匿', '秘'])('%s', raw => {
      expect(matchSymbol(raw)).toEqual({ kind: 'missing', replacement: '' });
    });
  });

  describe('3.3 table row: … ‥ ・・・ ... ・ *** * 不詳 → missing', () => {
    it.each(['…', '‥', '・・・', '...', '・', '***', '*', '不詳'])('%s', raw => {
      expect(matchSymbol(raw)).toEqual({ kind: 'missing', replacement: '' });
    });
  });

  describe('3.3 table row: - － ― — ー − -- → dash', () => {
    it.each(['-', '－', '―', '—', 'ー', '−', '--'])('%s', raw => {
      expect(matchSymbol(raw)).toEqual({ kind: 'dash', replacement: '' });
    });
  });

  describe('3.3 table row: △1.5 ▲１，２３４ △ 10 → negative', () => {
    it.each([
      ['△1.5', '-1.5'],
      ['▲１，２３４', '-１，２３４'],
      ['△ 10', '-10'],
    ])('%s → %s', (raw, replacement) => {
      expect(matchSymbol(raw)).toEqual({ kind: 'negative', replacement });
    });
  });

  describe('3.3 table row: 1,234※ ※1,234 123p 456r 789* 1,234¹ 1,234（注１） ＊１２３ → marker', () => {
    it.each([
      ['1,234※', '1,234'],
      ['※1,234', '1,234'],
      ['123p', '123'],
      ['456r', '456'],
      ['789*', '789'],
      ['1,234¹', '1,234'],
      ['1,234（注１）', '1,234'],
      ['＊１２３', '１２３'],
    ])('%s → %s', (raw, replacement) => {
      expect(matchSymbol(raw)).toEqual({ kind: 'marker', replacement });
    });
  });

  describe('3.3 table row: <0.5 約100 (123) 100以上 △ → unknown', () => {
    it.each(['<0.5', '約100', '(123)', '100以上', '△'])('%s', raw => {
      expect(matchSymbol(raw)).toEqual({ kind: 'unknown', replacement: raw });
    });
  });

  describe('3.3 table row: -1,234 0 1234 2.0 ※在庫限り → not a symbol', () => {
    it.each(['-1,234', '0', '1234', '2.0', '※在庫限り'])('%s', raw => {
      expect(matchSymbol(raw)).toBeNull();
    });
  });

  it('should keep the unit and drop only the mark (1,234人※ → 1,234人)', () => {
    expect(matchSymbol('1,234人※')).toEqual({ kind: 'marker', replacement: '1,234人' });
  });

  it('should keep every digit after a ※ prefix', () => {
    expect(matchSymbol('※1100')).toEqual({ kind: 'marker', replacement: '1100' });
    expect(matchSymbol('※11,234')).toEqual({ kind: 'marker', replacement: '11,234' });
    expect(matchSymbol('※1 1,234')).toEqual({ kind: 'marker', replacement: '1,234' });
  });

  it('should not treat superscripts of a unit (km², m³) as marks', () => {
    expect(matchSymbol('1121.26km²')).toBeNull();
    expect(matchSymbol('5m³')).toBeNull();
  });

  it('should treat p / r as marks only right after a digit', () => {
    expect(matchSymbol('123 (p)')).toEqual({ kind: 'marker', replacement: '123' });
    expect(matchSymbol('3hr')).toBeNull();
  });

  it('should return null for empty cells and plain values', () => {
    expect(matchSymbol('')).toBeNull();
    expect(matchSymbol('　')).toBeNull();
    expect(matchSymbol('２４８，９８９人')).toBeNull();
    expect(matchSymbol('北海道')).toBeNull();
  });
});

describe('isValueCell', () => {
  it.each(['7', '1,234', '１２３', '-1.5', '-', '－', 'x', '…', '***', '△1.5', '1,234※', '123p'])(
    '%s は値',
    raw => {
      expect(isValueCell(raw)).toBe(true);
    },
  );

  it.each(['', '　', '北海道', '男', '1人世帯', '15歳', '1.2万', '2020年', '(人)', '65歳以上', '<5', '△'])(
    '%s は値ではない',
    raw => {
      expect(isValueCell(raw)).toBe(false);
    },
  );
});

describe('classifyColumns', () => {
  it('should classify the with-symbols example (5.4 example 1)', () => {
    const table: Table = [
      ['都道府県', '事業所数', '従業者数', '前年比', '備考'],
      ['北海道', '1234', 'x', '△1.5', ''],
      ['青森県', '-', '…', '2.0', '-'],
      ['岩手県', '567※', '8901', '▲0.3', '※速報'],
      ['宮城県', '890', '***', '-', ''],
      ['秋田県', '<5', '1200p', '0.0', ''],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'numeric', 'numeric', 'text']);
  });

  it('should classify the number-format example (6.4 example 1)', () => {
    const table: Table = [
      ['コード', '市区町村', '人口', '面積', '人口密度'],
      ['01', '札幌市', '1,973,395人', '1121.26km²', '1,760'],
      ['02', '函館市', '２４８，９８９人', '677.87km²', '３６７'],
      ['03', '小樽市', '111,299人', '243.83km²', '456.5'],
    ];
    expect(kindsOf(table)).toEqual(['code', 'text', 'numeric', 'numeric', 'numeric']);
  });

  it('should classify the wareki example (7.4 example 1)', () => {
    const table: Table = [
      ['年', '調査日', '件数'],
      ['平成29年', 'H29.4.1', '5'],
      ['平成30年', '平成30年4月1日', '7'],
      ['令和元年', 'R1.5.1', '8'],
      ['R2', '2020/5/1', '9'],
      ['2021年', '2021年5月1日', '10'],
    ];
    expect(kindsOf(table)).toEqual(['date', 'date', 'numeric']);
  });

  it('should classify the guard example (7.4 example 4)', () => {
    const table: Table = [
      ['商品コード', '商品名', 'サイズ', '価格', '備考'],
      ['001', 'ねじ', 'M3', '1,980', '-'],
      ['002', 'ボルト', 'M4', '500', '※在庫限り'],
      ['010', 'ナット', 'M5', '300', '約10日'],
    ];
    expect(kindsOf(table)).toEqual(['code', 'text', 'text', 'numeric', 'text']);
  });

  it('should treat age-category labels as text and percentages as numeric (6.4 example 3)', () => {
    const table: Table = [
      ['年齢区分', '割合'],
      ['0〜14歳', '11.6%'],
      ['15〜64歳', '59.4%'],
      ['65歳以上', '29.0%'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric']);
  });

  it('rule 1: a column without non-empty data cells is empty', () => {
    const table: Table = [
      ['地域', 'メモ', '人口'],
      ['A市', '', '100'],
      ['B町', '　', '200'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'empty', 'numeric']);
  });

  it('rule 2: a code-like header makes the column code', () => {
    const table: Table = [
      ['ID', 'No.', '郵便番号', '都道府県コード', '値'],
      ['1', '1', '0600000', '1', '10'],
      ['2', '2', '0300000', '2', '20'],
    ];
    expect(kindsOf(table)).toEqual(['code', 'code', 'code', 'code', 'numeric']);
  });

  it('rule 3: all-digit cells with a leading zero make the column code', () => {
    const table: Table = [
      ['地域', '区分', '件数'],
      ['A市', '01', '1'],
      ['B町', '１２', '2'],
      ['C村', '00000', '3'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'code', 'numeric']);
  });

  it('rule 3: a lone "0" is not a code', () => {
    const table: Table = [
      ['地域', '件数'],
      ['A市', '0'],
      ['B町', '12'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric']);
  });

  it('rule 4: a date-like header makes the column date', () => {
    const table: Table = [
      ['年', '調査年度', '年月日', '値'],
      ['2018', '2018', '2018-04-01', '1'],
      ['2019', '2019', '2019-04-01', '2'],
    ];
    expect(kindsOf(table)).toEqual(['date', 'date', 'date', 'numeric']);
  });

  it('rule 4: a wide-table fiscal-year header is numeric when values are numbers or symbols', () => {
    const table: Table = [
      ['都道府県', '平成30年度', '令和元年度'],
      ['北海道', '1234', '100'],
      ['青森県', 'x', '△10'],
      ['秋田県', '500', '…'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'numeric']);
  });

  it('rule 4: an all-symbol fiscal-year column is numeric when another column is numeric', () => {
    const table: Table = [
      ['都道府県', '平成30年度', '令和元年度'],
      ['北海道', 'x', '100'],
      ['青森県', '-', '200'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'numeric']);
  });

  it('rule 4: a specific year header stays date when the values are dates', () => {
    const table: Table = [
      ['地域', '平成30年度', 'メモ'],
      ['A市', '2018-04-01', 'a'],
      ['B町', '2019-04-01', 'b'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'date', 'text']);
  });

  it('rule 4: a generic date header stays date even when the suffix matches and values are years', () => {
    const table: Table = [
      ['地域', '実施年月日', '基準日付'],
      ['A市', '2018', '2018-04-01'],
      ['B町', '2019', '2019-04-01'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'date', 'date']);
  });

  it('rule 4: "年" inside a word (青年, 少年) does not make the column date', () => {
    const table: Table = [
      ['地域', '青年', '少年'],
      ['A市', '10', '5'],
      ['B町', '20', '6'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'numeric']);
  });

  it('rule 5: numeric when number-like + symbol cells are at least 80%', () => {
    const table: Table = [
      ['地域', '80%', '60%'],
      ['A市', '1', '1'],
      ['B町', '2', '2'],
      ['C村', '-', '3'],
      ['D郡', '約4', '不明です'],
      ['E区', '不明です', '不明です'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'text']);
  });

  it('rule 5: symbols alone never make a column numeric', () => {
    const table: Table = [
      ['地域', '備考'],
      ['A市', '<5'],
      ['B町', '約10'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'text']);
  });

  it('rule 6: an all-missing column is numeric when another column is numeric', () => {
    const table: Table = [
      ['地域', '人口', '秘匿列'],
      ['A市', '100', 'x'],
      ['B町', '200', '-'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'numeric']);
  });

  it('rule 6: an all-missing column stays text without another numeric column', () => {
    const table: Table = [
      ['地域', '秘匿列'],
      ['A市', 'x'],
      ['B町', '…'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'text']);
  });

  it('rule 6: an all-missing column 0 stays text', () => {
    const table: Table = [
      ['秘匿列', '人口'],
      ['x', '100'],
      ['x', '200'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric']);
  });

  it('should always treat a column whose header ends with _注記 as text', () => {
    const table: Table = [
      ['都道府県', '従業者数', '従業者数_注記'],
      ['北海道', '', 'x'],
      ['青森県', '', '…'],
      ['岩手県', '8901', 'p'],
      ['宮城県', '100', ''],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'text']);
  });

  it('should use the last "_" part of a flattened header', () => {
    const table: Table = [
      ['地域', '人口_年度', '人口_総数'],
      ['A市', '2018', '100'],
      ['B町', '2019', '200'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'date', 'numeric']);
  });

  it('should look only at data rows (not titles, headers or notes)', () => {
    const table: Table = [
      ['表1 都道府県別事業所数（平成30年～令和2年）'],
      ['単位：事業所'],
      [''],
      ['都道府県', '平成30年', '令和元年', '令和2年'],
      ['全国', '１，２３４', '1,300', '△10'],
      ['北海道', '500', 'x', '…'],
      ['青森県', '734', '-', '1,310※'],
      ['注：x は秘匿、… は不詳、△ は減少'],
      ['出典：架空統計'],
    ];
    expect(kindsOf(table)).toEqual(['text', 'numeric', 'numeric', 'numeric']);
  });
});

describe('shiftDecimal', () => {
  it.each([
    ['1.2', 4, '12000'],
    ['1.23456', 4, '12345.6'],
    ['3', 8, '300000000'],
    ['0.5', 4, '5000'],
    ['-1.2', 4, '-12000'],
  ])('6.2 example: (%s, %i) → %s', (digits, exponent, expected) => {
    expect(shiftDecimal(digits, exponent)).toBe(expected);
  });

  it('should not lose precision for large exponents (兆)', () => {
    expect(shiftDecimal('1.2', 12)).toBe('1200000000000');
    expect(shiftDecimal('123456789.123456789', 12)).toBe('123456789123456789000');
  });

  it('should handle leading dots, exponent 0 and negative exponents', () => {
    expect(shiftDecimal('.5', 4)).toBe('5000');
    expect(shiftDecimal('12', 0)).toBe('12');
    expect(shiftDecimal('0.0001', 4)).toBe('1');
    expect(shiftDecimal('5', -1)).toBe('0.5');
    expect(shiftDecimal('1234', -6)).toBe('0.001234');
  });

  it('should drop "+" and never return "-0"', () => {
    expect(shiftDecimal('+1.5', 3)).toBe('1500');
    expect(shiftDecimal('-0', 4)).toBe('0');
  });

  it('should return non-decimal input unchanged', () => {
    expect(shiftDecimal('abc', 4)).toBe('abc');
    expect(shiftDecimal('', 4)).toBe('');
    expect(shiftDecimal('1,234', 4)).toBe('1,234');
  });
});

describe('header patterns', () => {
  it('CODE_HEADER_RE should match code-like headers only', () => {
    for (const header of ['コード', '都道府県コード', 'code', '番号', '郵便番号', '〒', '電話', '品番', '型番', 'No', 'no.', 'ID', 'tel']) {
      expect(CODE_HEADER_RE.test(header)).toBe(true);
    }
    for (const header of ['人口', 'Nov', 'idea', 'notice', '都道府県']) {
      expect(CODE_HEADER_RE.test(header)).toBe(false);
    }
  });

  it('DATE_HEADER_RE should match "年" only as a whole word', () => {
    for (const header of ['年', '年度', '調査日', '時点', 'Year', 'FY', '調査年度', '実施年月日', '基準日付']) {
      expect(DATE_HEADER_RE.test(header)).toBe(true);
    }
    for (const header of ['青年', '少年', '平成30年', '令和元年', '年齢', '人口']) {
      expect(DATE_HEADER_RE.test(header)).toBe(false);
    }
    // 末尾の「年度」には一致する。列の種類は値を見て classifyColumns が決める。
    expect(DATE_HEADER_RE.test('平成30年度')).toBe(true);
    expect(DATE_HEADER_RE.test('令和元年度')).toBe(true);
  });
});
