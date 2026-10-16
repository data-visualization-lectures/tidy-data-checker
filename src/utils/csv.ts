import Papa from 'papaparse';
import type { Table } from '../types';

export function parseCSV(text: string): Table {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
  });

  return result.data;
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
