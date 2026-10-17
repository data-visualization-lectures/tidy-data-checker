import { describe, it, expect } from 'vitest';
import {
  parseJapaneseDate,
  formatDate,
  convertDateLabel,
  type ParsedDate,
} from '../utils/japaneseDate';

function parseOk(raw: string): ParsedDate {
  const result = parseJapaneseDate(raw);
  if (!result || !result.ok) {
    throw new Error(`「${raw}」が日付として読めませんでした: ${JSON.stringify(result)}`);
  }
  return result.value;
}

describe('parseJapaneseDate', () => {
  describe('7.2節 確認済みの表', () => {
    const converted: Array<[string, string]> = [
      // 漢字の元号
      ['令和元年', '2019'],
      ['令和5年', '2023'],
      ['平成30年', '2018'],
      ['平成31年', '2019'],
      ['昭和64年', '1989'],
      ['大正15年', '1926'],
      ['明治45年', '1912'],
      // 略記
      ['R5', '2023'],
      ['H30', '2018'],
      ['S64', '1989'],
      ['R元', '2019'],
      ['h30', '2018'],
      ['Ｈ３０', '2018'],
      // 年月日
      ['令和5年4月1日', '2023-04-01'],
      ['R5.4.1', '2023-04-01'],
      ['H30/4/1', '2018-04-01'],
      ['平30.4', '2018-04'],
      ['令和5年4月', '2023-04'],
      // 年度・合字・空白・全角
      ['令和5年度', '2023年度'],
      ['㋿5年', '2023'],
      ['㍻30年', '2018'],
      ['令和 5 年', '2023'],
      ['令和５年', '2023'],
      // 併記
      ['令和5年(2023年)', '2023'],
      ['2023年（令和5年）', '2023'],
      ['平成31年・令和元年', '2019'],
      // 西暦
      ['2023年', '2023'],
      ['2023年4月1日', '2023-04-01'],
      ['2023/4/1', '2023-04-01'],
      ['2023.04', '2023-04'],
      ['2023-04-01', '2023-04-01'],
      ['2023年度', '2023年度'],
      ['2023', '2023'],
    ];

    it.each(converted)('「%s」→「%s」', (input, expected) => {
      const value = parseOk(input);
      expect(formatDate(value)).toBe(expected);
      expect(value.outOfRange).toBe(false);
      expect(value.crossesBoundary).toBe(false);
    });

    it.each([
      ['平成31年5月1日', '2019-05-01'],
      ['令和元年4月1日', '2019-04-01'],
    ])('「%s」→「%s」（改元日をまたぐ印付き）', (input, expected) => {
      const value = parseOk(input);
      expect(formatDate(value)).toBe(expected);
      expect(value.crossesBoundary).toBe(true);
      expect(value.outOfRange).toBe(false);
    });

    it('「平成32年」→「2020」（最終年超えの印付き）', () => {
      const value = parseOk('平成32年');
      expect(formatDate(value)).toBe('2020');
      expect(value.outOfRange).toBe(true);
      expect(value.crossesBoundary).toBe(false);
    });

    it('「令和5年(2022年)」は年が食い違うので変換しない（mismatch）', () => {
      expect(parseJapaneseDate('令和5年(2022年)')).toEqual({ ok: false, reason: 'mismatch' });
    });

    it.each(['令和5年2月30日', '令和5年13月'])('「%s」は実在しない日付なので変換しない（invalid-date）', input => {
      expect(parseJapaneseDate(input)).toEqual({ ok: false, reason: 'invalid-date' });
    });

    it.each(['令和', '平成30年の調査', 'R5-001', 'H30A', '4月', '令和5年1～3月期'])(
      '「%s」は日付ではない（null）',
      input => {
        expect(parseJapaneseDate(input)).toBeNull();
      }
    );
  });

  describe('元号と表記の種類', () => {
    it.each([
      ['令和5年', '令和', 'kanji'],
      ['明治45年', '明治', 'kanji'],
      ['平30.4', '平成', 'abbr-kanji'],
      ['昭64', '昭和', 'abbr-kanji'],
      ['令5', '令和', 'abbr-kanji'],
      ['R5', '令和', 'alpha'],
      ['h30', '平成', 'alpha'],
      ['T5', '大正', 'alpha'],
      ['2023年', null, 'western'],
    ] as const)('「%s」は %s・%s', (input, era, notation) => {
      const value = parseOk(input);
      expect(value.era).toBe(era);
      expect(value.notation).toBe(notation);
    });

    it('年度は fiscal が true、それ以外は false', () => {
      expect(parseOk('令和5年度').fiscal).toBe(true);
      expect(parseOk('2023年度').fiscal).toBe(true);
      expect(parseOk('令和5年').fiscal).toBe(false);
      expect(parseOk('令和5年4月').fiscal).toBe(false);
    });

    it('年・月・日を数値で返し、ない項目は持たない', () => {
      expect(parseOk('令和5年4月1日')).toEqual({
        year: 2023,
        month: 4,
        day: 1,
        fiscal: false,
        era: '令和',
        notation: 'kanji',
        outOfRange: false,
        crossesBoundary: false,
      });
      const yearOnly = parseOk('平成30年');
      expect(yearOnly).not.toHaveProperty('month');
      expect(yearOnly).not.toHaveProperty('day');
    });

    it('M・T の略記も解析上は変換する（M3 → 1870）。止めるのはチェック側', () => {
      expect(formatDate(parseOk('M3'))).toBe('1870');
      expect(formatDate(parseOk('T5'))).toBe('1916');
    });

    it('元号の後ろの「.」を許す', () => {
      expect(formatDate(parseOk('H.30'))).toBe('2018');
      expect(formatDate(parseOk('R.5.4.1'))).toBe('2023-04-01');
    });

    it('年の先頭の 0 を許す', () => {
      expect(formatDate(parseOk('R05.04.01'))).toBe('2023-04-01');
    });
  });

  describe('改元日をまたぐ表記', () => {
    it.each(['平成元年1月7日', '昭和64年1月8日', '令和元年4月', '平成31年5月', '大正元年7月29日', '昭和元年12月24日'])(
      '「%s」は改元日をまたぐ',
      input => {
        expect(parseOk(input).crossesBoundary).toBe(true);
      }
    );

    it.each(['平成元年1月8日', '昭和64年1月7日', '平成31年4月30日', '令和元年5月1日', '令和元年5月', '平成31年4月', '平成元年1月'])(
      '「%s」は改元日をまたがない',
      input => {
        expect(parseOk(input).crossesBoundary).toBe(false);
      }
    );

    it('年だけの表記は対象外（平成31年・令和元年・昭和64年）', () => {
      expect(parseOk('平成31年').crossesBoundary).toBe(false);
      expect(parseOk('令和元年').crossesBoundary).toBe(false);
      expect(parseOk('昭和64年').crossesBoundary).toBe(false);
    });

    it('西暦は対象外', () => {
      expect(parseOk('2019年5月1日').crossesBoundary).toBe(false);
    });
  });

  describe('元号の最終年', () => {
    it.each([
      ['明治46年', '1913'],
      ['大正16年', '1927'],
      ['昭和65年', '1990'],
      ['平成32年4月1日', '2020-04-01'],
    ])('「%s」は計算どおり「%s」に変換し、最終年超えの印が付く', (input, expected) => {
      const value = parseOk(input);
      expect(formatDate(value)).toBe(expected);
      expect(value.outOfRange).toBe(true);
      expect(value.crossesBoundary).toBe(false);
    });

    it('令和には最終年がない', () => {
      const value = parseOk('令和50年');
      expect(formatDate(value)).toBe('2068');
      expect(value.outOfRange).toBe(false);
    });

    it('最終年ちょうどは対象外', () => {
      expect(parseOk('平成31年').outOfRange).toBe(false);
      expect(parseOk('明治45年').outOfRange).toBe(false);
    });
  });

  describe('併記', () => {
    it('令和5(2023)年 のように末尾の「年」を両方に付けて読む', () => {
      expect(formatDate(parseOk('令和5(2023)年'))).toBe('2023');
      expect(formatDate(parseOk('令和5(2023)年度'))).toBe('2023年度');
    });

    it('西暦が先でも元号側を採用する', () => {
      const value = parseOk('2023年（令和5年）');
      expect(value.era).toBe('令和');
      expect(value.notation).toBe('kanji');
    });

    it('括弧の中が年だけでも、年が同じなら元号側の月日を残す', () => {
      expect(formatDate(parseOk('令和5年4月1日（2023年）'))).toBe('2023-04-01');
    });

    it('年が同じでも月が食い違えば mismatch', () => {
      expect(parseJapaneseDate('令和5年4月(2023年5月)')).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('どちらかが実在しない日付なら invalid-date', () => {
      expect(parseJapaneseDate('令和5年2月30日(2023年)')).toEqual({ ok: false, reason: 'invalid-date' });
    });

    it('括弧の中が日付でなければ併記として扱わない', () => {
      expect(parseJapaneseDate('平成30年(速報)')).toBeNull();
    });

    it('「/」区切りの2つの元号も同じ年なら後ろを採用する', () => {
      const value = parseOk('平成31年/令和元年');
      expect(formatDate(value)).toBe('2019');
      expect(value.era).toBe('令和');
    });

    it('2つに分けて年が違えば日付ではない', () => {
      expect(parseJapaneseDate('2019年・2020年')).toBeNull();
    });
  });

  describe('日付の形の確認', () => {
    it.each(['令和5年度4月', 'R5.4.', '2023.4/1', '2023年4.1', '令和5年4', '令和5年41日', 'R5.4月', '2023-'])(
      '「%s」は区切りがそろっていないので日付ではない（null）',
      input => {
        expect(parseJapaneseDate(input)).toBeNull();
      }
    );

    it('「日」を省いた年月日も読む', () => {
      expect(formatDate(parseOk('令和5年4月1'))).toBe('2023-04-01');
    });

    it('元号の0年は実在しない（invalid-date）', () => {
      expect(parseJapaneseDate('令和0年')).toEqual({ ok: false, reason: 'invalid-date' });
    });

    it('うるう年の2月29日を確かめる', () => {
      expect(formatDate(parseOk('令和6年2月29日'))).toBe('2024-02-29');
      expect(parseJapaneseDate('令和5年2月29日')).toEqual({ ok: false, reason: 'invalid-date' });
    });

    it('西暦は1868〜2100年だけ', () => {
      expect(formatDate(parseOk('1868年'))).toBe('1868');
      expect(formatDate(parseOk('2100'))).toBe('2100');
      expect(parseJapaneseDate('1867年')).toBeNull();
      expect(parseJapaneseDate('2101')).toBeNull();
      expect(parseJapaneseDate('1234')).toBeNull();
    });

    it('数値・空欄・文字は日付ではない', () => {
      for (const input of ['', '   ', '123', '1.5', '-1,234', '北海道', '合計']) {
        expect(parseJapaneseDate(input)).toBeNull();
      }
    });
  });
});

describe('formatDate', () => {
  const base: ParsedDate = {
    year: 2018,
    fiscal: false,
    era: '平成',
    notation: 'kanji',
    outOfRange: false,
    crossesBoundary: false,
  };

  it('年だけなら「2018」', () => {
    expect(formatDate(base)).toBe('2018');
  });

  it('年度なら「2018年度」', () => {
    expect(formatDate({ ...base, fiscal: true })).toBe('2018年度');
  });

  it('年月なら「2018-04」', () => {
    expect(formatDate({ ...base, month: 4 })).toBe('2018-04');
  });

  it('年月日なら「2018-04-01」', () => {
    expect(formatDate({ ...base, month: 4, day: 1 })).toBe('2018-04-01');
  });

  it('2桁の月日はそのまま', () => {
    expect(formatDate({ ...base, month: 12, day: 31 })).toBe('2018-12-31');
  });
});

describe('convertDateLabel', () => {
  it('「人口_平成30年」→「人口_2018」', () => {
    expect(convertDateLabel('人口_平成30年', false)).toBe('人口_2018');
  });

  it('「平成30年（人）」→「2018（人）」（末尾の（…）は残す）', () => {
    expect(convertDateLabel('平成30年（人）', false)).toBe('2018（人）');
  });

  it('「令和5年(2023年)」→「2023」（併記として読む）', () => {
    expect(convertDateLabel('令和5年(2023年)', false)).toBe('2023');
  });

  it('年度・多段見出しの各部分を変換する', () => {
    expect(convertDateLabel('令和元年度', false)).toBe('2019年度');
    expect(convertDateLabel('平成30年_男', false)).toBe('2018_男');
    expect(convertDateLabel('人口_平成30年（人）', false)).toBe('人口_2018（人）');
    expect(convertDateLabel('平成30年度（速報）', false)).toBe('2018年度（速報）');
  });

  it('併記と単位の括弧が両方あっても変換する', () => {
    expect(convertDateLabel('平成30年（2018年）（人）', false)).toBe('2018（人）');
  });

  it('西暦の「2020年」は「2020」になる（使うかどうかはチェック側が決める）', () => {
    expect(convertDateLabel('2020年', false)).toBe('2020');
  });

  it('略記は allowAbbr が true のときだけ変換する', () => {
    expect(convertDateLabel('H30', false)).toBeNull();
    expect(convertDateLabel('H30', true)).toBe('2018');
    expect(convertDateLabel('人口_平30', false)).toBeNull();
    expect(convertDateLabel('人口_平30', true)).toBe('人口_2018');
  });

  it('年が食い違う併記や実在しない日付は変換しない', () => {
    expect(convertDateLabel('令和5年(2022年)', true)).toBeNull();
    expect(convertDateLabel('令和5年2月30日', true)).toBeNull();
  });

  it('日付を含まない見出しは null', () => {
    expect(convertDateLabel('都道府県', true)).toBeNull();
    expect(convertDateLabel('人口_総数', true)).toBeNull();
    expect(convertDateLabel('合計（人）', true)).toBeNull();
    expect(convertDateLabel('平成30年の調査', true)).toBeNull();
  });
});
