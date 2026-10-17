export type EraName = '明治' | '大正' | '昭和' | '平成' | '令和';
export type DateNotation = 'kanji' | 'abbr-kanji' | 'alpha' | 'western';

export interface ParsedDate {
  year: number;
  month?: number;
  day?: number;
  fiscal: boolean;           // 「年度」
  era: EraName | null;       // null なら西暦の表記
  notation: DateNotation;    // 令和 / 令 / R / 2023
  outOfRange: boolean;       // 平成32年 のように元号の最終年を超える
  crossesBoundary: boolean;  // 平成31年5月1日、令和元年4月1日 のように改元日をまたぐ
}

export type DateParseResult =
  | { ok: true; value: ParsedDate }
  | { ok: false; reason: 'invalid-date' | 'mismatch' }   // 日付らしいが変換できない
  | null;                                                // 日付ではない

interface EraInfo {
  name: EraName;
  year: number;
  month: number;
  day: number;
  lastYear: number | null;
}

const ERAS: EraInfo[] = [
  { name: '明治', year: 1868, month: 1, day: 1, lastYear: 45 },
  { name: '大正', year: 1912, month: 7, day: 30, lastYear: 15 },
  { name: '昭和', year: 1926, month: 12, day: 25, lastYear: 64 },
  { name: '平成', year: 1989, month: 1, day: 8, lastYear: 31 },
  { name: '令和', year: 2019, month: 5, day: 1, lastYear: null },
];

const ERA_INDEX: Record<string, number> = {
  明治: 0, M: 0,
  大正: 1, T: 1,
  昭和: 2, 昭: 2, S: 2,
  平成: 3, 平: 3, H: 3,
  令和: 4, 令: 4, R: 4,
};

const ERA_DATE_RE = /^(明治|大正|昭和|平成|令和|[昭平令]|[MTSHR])\.?(元|\d{1,2})(?:(年度?|[./-])(?:(\d{1,2})(月|[./-])?(?:(\d{1,2})(日)?)?)?)?$/i;
const WEST_RE = /^(\d{4})(?:(年度?|[./-])(?:(\d{1,2})(月|[./-])?(?:(\d{1,2})(日)?)?)?)?$/;
const DUAL_RE = /^(.+?)\((.+?)\)(年度?)?$/;
const PAIR_SPLIT = /[・/]/;
const TRAILING_PAREN_RE = /^(.+?)(\s*[(（][^()（）]*[)）]\s*)$/;

const WEST_MIN_YEAR = 1868;
const WEST_MAX_YEAR = 2100;

/** 判定専用：NFKC 正規化し、すべての空白を除く */
function compact(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

function invalidDate(): DateParseResult {
  return { ok: false, reason: 'invalid-date' };
}

/**
 * 区切りの組み合わせを確かめる。「年」の後の月には「月」が必要、
 * 「.」「/」「-」は同じ記号で年・月・日を区切る。「年度」に月は付けない。
 * 区切りのない数字の連続（R5-001）は日付とみなさない。
 */
function hasValidShape(
  sep: string | undefined,
  month: string | undefined,
  monthSep: string | undefined,
  day: string | undefined,
  dayMark: string | undefined
): boolean {
  if (sep === undefined) return true;
  if (sep === '年度') return month === undefined;
  if (sep === '年') return month === undefined || monthSep === '月';
  if (month === undefined) return false;
  if (day === undefined) return monthSep === undefined;
  return monthSep === sep && dayMark === undefined;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

function crossesEraBoundary(index: number, year: number, month: number, day: number | undefined): boolean {
  const era = ERAS[index];
  const next = index + 1 < ERAS.length ? ERAS[index + 1] : null;
  const first = ymd(year, month, day ?? 1);
  const last = ymd(year, month, day ?? daysInMonth(year, month));
  const beforeStart = last < ymd(era.year, era.month, era.day);
  const afterEnd = next !== null && first >= ymd(next.year, next.month, next.day);
  return beforeStart || afterEnd;
}

function buildDate(
  year: number,
  sep: string | undefined,
  monthStr: string | undefined,
  dayStr: string | undefined,
  era: { index: number; eraYear: number; notation: DateNotation } | null
): DateParseResult {
  const month = monthStr === undefined ? undefined : Number(monthStr);
  const day = dayStr === undefined ? undefined : Number(dayStr);
  if (month !== undefined && (month < 1 || month > 12)) return invalidDate();
  if (month !== undefined && day !== undefined && !isRealDate(year, month, day)) return invalidDate();

  let outOfRange = false;
  let crossesBoundary = false;
  if (era !== null) {
    const lastYear = ERAS[era.index].lastYear;
    outOfRange = lastYear !== null && era.eraYear > lastYear;
    crossesBoundary = !outOfRange && month !== undefined && crossesEraBoundary(era.index, year, month, day);
  }

  const value: ParsedDate = {
    year,
    fiscal: sep === '年度',
    era: era === null ? null : ERAS[era.index].name,
    notation: era === null ? 'western' : era.notation,
    outOfRange,
    crossesBoundary,
  };
  if (month !== undefined) value.month = month;
  if (day !== undefined) value.day = day;
  return { ok: true, value };
}

function parseSingle(s: string): DateParseResult {
  const e = ERA_DATE_RE.exec(s);
  if (e) {
    if (!hasValidShape(e[3], e[4], e[5], e[6], e[7])) return null;
    const token = e[1].toUpperCase();
    const index = ERA_INDEX[token];
    const eraYear = e[2] === '元' ? 1 : Number(e[2]);
    if (eraYear < 1) return invalidDate();
    const notation: DateNotation = token.length === 2 ? 'kanji' : /^[昭平令]$/.test(token) ? 'abbr-kanji' : 'alpha';
    return buildDate(ERAS[index].year + eraYear - 1, e[3], e[4], e[6], { index, eraYear, notation });
  }

  const w = WEST_RE.exec(s);
  if (w) {
    if (!hasValidShape(w[2], w[3], w[4], w[5], w[6])) return null;
    const year = Number(w[1]);
    if (year < WEST_MIN_YEAR || year > WEST_MAX_YEAR) return null;
    return buildDate(year, w[2], w[3], w[5], null);
  }

  return null;
}

function agrees(a: ParsedDate, b: ParsedDate): boolean {
  if (a.year !== b.year) return false;
  if (a.month !== undefined && b.month !== undefined && a.month !== b.month) return false;
  if (a.day !== undefined && b.day !== undefined && a.day !== b.day) return false;
  return true;
}

function sameDate(a: ParsedDate, b: ParsedDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.fiscal === b.fiscal;
}

/** 令和5年(2023年)、2023年(令和5年)、令和5(2023)年 */
function parseDual(s: string): DateParseResult {
  const m = DUAL_RE.exec(s);
  if (!m) return null;
  const suffix = m[3] ?? '';
  const a = parseSingle(m[1] + suffix);
  const b = parseSingle(m[2] + suffix);
  if (a === null || b === null) return null;
  if (!a.ok) return a;
  if (!b.ok) return b;
  if (!agrees(a.value, b.value)) return { ok: false, reason: 'mismatch' };
  return a.value.era === null && b.value.era !== null ? b : a;
}

/** 平成31年・令和元年、平成31年/令和元年 */
function parsePair(s: string): DateParseResult {
  const parts = s.split(PAIR_SPLIT);
  if (parts.length !== 2 || !parts.every(p => p.includes('年'))) return null;
  const a = parseSingle(parts[0]);
  const b = parseSingle(parts[1]);
  if (a?.ok && b?.ok && sameDate(a.value, b.value)) return b;
  return null;
}

export function parseJapaneseDate(raw: string): DateParseResult {
  const s = compact(raw);
  if (s === '') return null;
  return parseDual(s) ?? parsePair(s) ?? parseSingle(s);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(d: ParsedDate): string {
  if (d.month === undefined) return d.fiscal ? `${d.year}年度` : String(d.year);
  if (d.day === undefined) return `${d.year}-${pad2(d.month)}`;
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

function formatIfAllowed(d: ParsedDate, allowAbbr: boolean): string | null {
  if (!allowAbbr && (d.notation === 'abbr-kanji' || d.notation === 'alpha')) return null;
  return formatDate(d);
}

function convertLabelPart(part: string, allowAbbr: boolean): string | null {
  const whole = parseJapaneseDate(part);
  if (whole !== null) return whole.ok ? formatIfAllowed(whole.value, allowAbbr) : null;

  const m = TRAILING_PAREN_RE.exec(part);
  if (!m) return null;
  const base = parseJapaneseDate(m[1]);
  if (!base?.ok) return null;
  const formatted = formatIfAllowed(base.value, allowAbbr);
  return formatted === null ? null : formatted + m[2];
}

/** 見出し用：「_」区切りの各部分と末尾の（…）を考慮して変換する。変換できなければ null */
export function convertDateLabel(raw: string, allowAbbr: boolean): string | null {
  let found = false;
  const parts: string[] = [];
  for (const part of raw.split('_')) {
    const converted = convertLabelPart(part, allowAbbr);
    if (converted === null) {
      parts.push(part);
    } else {
      found = true;
      parts.push(converted);
    }
  }
  return found ? parts.join('_') : null;
}
