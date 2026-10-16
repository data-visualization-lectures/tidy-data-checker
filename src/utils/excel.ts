import * as XLSX from 'xlsx';
import type { Table, SheetInfo, MergedCell, ParsedFile } from '../types';

export interface ExcelParseResult {
  sheets: SheetInfo[];
  defaultSheet: string;
}

export function getExcelSheets(bytes: Uint8Array): ExcelParseResult {
  const workbook = XLSX.read(bytes, { type: 'array' });

  const sheets: SheetInfo[] = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    return {
      name,
      rowCount: range.e.r - range.s.r + 1,
      colCount: range.e.c - range.s.c + 1,
    };
  });

  return {
    sheets,
    defaultSheet: workbook.SheetNames[0],
  };
}

export function parseExcelSheet(bytes: Uint8Array, sheetName: string): ParsedFile {
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;

  const table: Table = [];
  for (let r = 0; r < rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const cell = sheet[cellAddress];
      row.push(cell ? String(cell.v ?? '') : '');
    }
    table.push(row);
  }

  const mergedCells: MergedCell[] = (sheet['!merges'] || []).map(merge => ({
    startRow: merge.s.r - range.s.r,
    startCol: merge.s.c - range.s.c,
    endRow: merge.e.r - range.s.r,
    endCol: merge.e.c - range.s.c,
  }));

  const sheets: SheetInfo[] = workbook.SheetNames.map(name => {
    const s = workbook.Sheets[name];
    const r = XLSX.utils.decode_range(s['!ref'] || 'A1');
    return {
      name,
      rowCount: r.e.r - r.s.r + 1,
      colCount: r.e.c - r.s.c + 1,
    };
  });

  return {
    table,
    sheetName,
    sheets,
    mergedCells,
  };
}

export function isExcelFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'xlsx' || ext === 'xls';
}
