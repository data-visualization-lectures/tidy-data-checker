import { describe, it, expect } from 'vitest';
import { detectAndDecode } from '../utils/decode';
import Encoding from 'encoding-japanese';

function createShiftJISBytes(text: string): Uint8Array {
  const unicodeArray = Encoding.stringToCode(text);
  const sjisArray = Encoding.convert(unicodeArray, {
    to: 'SJIS',
    from: 'UNICODE',
  });
  return new Uint8Array(sjisArray);
}

function createUTF8BOMBytes(text: string): Uint8Array {
  const utf8Bytes = new TextEncoder().encode(text);
  const result = new Uint8Array(3 + utf8Bytes.length);
  result[0] = 0xEF;
  result[1] = 0xBB;
  result[2] = 0xBF;
  result.set(utf8Bytes, 3);
  return result;
}

function createUTF8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('detectAndDecode', () => {
  describe('UTF-8 with BOM', () => {
    it('should detect UTF-8 BOM and decode correctly', () => {
      const text = '都道府県,人口\n北海道,5140000\n';
      const bytes = createUTF8BOMBytes(text);

      const result = detectAndDecode(bytes);

      expect(result.encoding).toBe('UTF-8');
      expect(result.hasBom).toBe(true);
      expect(result.text).toBe(text);
    });

    it('should handle Japanese prefecture names correctly', () => {
      const text = '東京都,神奈川県,大阪府,京都府';
      const bytes = createUTF8BOMBytes(text);

      const result = detectAndDecode(bytes);

      expect(result.text).toContain('東京都');
      expect(result.text).toContain('神奈川県');
      expect(result.text).toContain('大阪府');
      expect(result.text).toContain('京都府');
    });
  });

  describe('UTF-8 without BOM', () => {
    it('should detect UTF-8 and decode correctly', () => {
      const text = '都道府県,人口\n北海道,5140000\n';
      const bytes = createUTF8Bytes(text);

      const result = detectAndDecode(bytes);

      expect(result.encoding).toBe('UTF-8');
      expect(result.hasBom).toBe(false);
      expect(result.text).toBe(text);
    });
  });

  describe('Shift_JIS / CP932', () => {
    it('should detect Shift_JIS and decode correctly', () => {
      const text = '都道府県,人口\n北海道,5140000\n';
      const bytes = createShiftJISBytes(text);

      const result = detectAndDecode(bytes);

      expect(result.encoding).toBe('Shift_JIS');
      expect(result.hasBom).toBe(false);
      expect(result.text).toBe(text);
    });

    it('should handle special kanji correctly', () => {
      const text = '髙橋,﨑田,鷗外,①②③';
      const bytes = createShiftJISBytes(text);

      const result = detectAndDecode(bytes);

      expect(result.text).toContain('髙橋');
    });

    it('should decode real government-style data', () => {
      const data = `都道府県別人口（令和5年）

都道府県,人口（人）,世帯数
北海道,5140000,2890000
青森県,1190000,580000

出典：総務省統計局
`;
      const bytes = createShiftJISBytes(data);

      const result = detectAndDecode(bytes);

      expect(result.encoding).toBe('Shift_JIS');
      expect(result.text).toContain('都道府県別人口');
      expect(result.text).toContain('令和5年');
      expect(result.text).toContain('北海道');
      expect(result.text).toContain('総務省統計局');
    });
  });

  describe('ASCII only', () => {
    it('should handle ASCII as UTF-8', () => {
      const text = 'id,name,value\n1,test,100\n';
      const bytes = createUTF8Bytes(text);

      const result = detectAndDecode(bytes);

      expect(result.encoding).toBe('UTF-8');
      expect(result.hasBom).toBe(false);
      expect(result.text).toBe(text);
    });
  });
});
