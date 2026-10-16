import Papa from 'papaparse';
import type { Table, ParsedFile } from '../types';

export interface DelimiterDetectionResult {
  delimiter: string;
  delimiterName: string;
}

const DELIMITERS = [
  { char: ',', name: 'カンマ (,)' },
  { char: '\t', name: 'タブ' },
  { char: ';', name: 'セミコロン (;)' },
  { char: '|', name: 'パイプ (|)' },
];

export function detectDelimiter(text: string): DelimiterDetectionResult {
  const lines = text.split(/\r?\n/).slice(0, 10).filter(line => line.trim());
  if (lines.length === 0) {
    return { delimiter: ',', delimiterName: 'カンマ (,)' };
  }

  let bestDelimiter = ',';
  let bestScore = 0;
  let bestName = 'カンマ (,)';

  for (const { char, name } of DELIMITERS) {
    const counts = lines.map(line => {
      let count = 0;
      let inQuotes = false;
      for (const c of line) {
        if (c === '"') inQuotes = !inQuotes;
        else if (c === char && !inQuotes) count++;
      }
      return count;
    });

    if (counts.every(c => c === 0)) continue;

    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const consistency = minCount === maxCount ? 1 : minCount / maxCount;
    const score = (minCount + 1) * consistency;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = char;
      bestName = name;
    }
  }

  return { delimiter: bestDelimiter, delimiterName: bestName };
}

export function parseCSV(text: string, delimiter?: string): Table {
  const actualDelimiter = delimiter ?? detectDelimiter(text).delimiter;

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimiter: actualDelimiter,
  });

  return result.data;
}

export function parseCSVWithMeta(text: string): ParsedFile {
  const { delimiter, delimiterName } = detectDelimiter(text);

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimiter,
  });

  return {
    table: result.data,
    delimiter: delimiterName,
  };
}

export function tableToCSV(table: Table, withBom: boolean = false): string {
  const csv = Papa.unparse(table, {
    header: false,
    newline: '\n',
  });

  return withBom ? '\uFEFF' + csv : csv;
}

export function downloadCSV(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
