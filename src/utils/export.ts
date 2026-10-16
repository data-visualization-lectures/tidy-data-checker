import type { Table } from '../types';
import { tableToCSV, downloadCSV } from './csv';

export function exportAsUTF8CSV(table: Table, fileName: string, withBom: boolean): void {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const exportFileName = `${baseName}_tidy.csv`;
  const content = tableToCSV(table, withBom);
  downloadCSV(content, exportFileName);
}
