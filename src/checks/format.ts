import type { Check, Finding, Table, CheckContext } from '../types';

export const formatCheck: Check = {
  id: 'format',
  title: '形式とシート',
  description: 'ファイル形式、区切り文字、シート情報を確認します。',

  detect: (_table: Table, ctx: CheckContext): Finding[] => {
    const findings: Finding[] = [];

    if (ctx.sheets && ctx.sheets.length > 1) {
      findings.push({
        checkId: 'format',
        severity: 'info',
        ranges: [],
        message: `Excelファイル: ${ctx.sheets.length} シート検出。現在「${ctx.sheetName}」を表示中。`,
        metadata: { sheets: ctx.sheets, currentSheet: ctx.sheetName },
      });
    } else if (ctx.sheetName) {
      findings.push({
        checkId: 'format',
        severity: 'info',
        ranges: [],
        message: `Excelファイル: シート「${ctx.sheetName}」を表示中。`,
      });
    }

    if (ctx.delimiter) {
      findings.push({
        checkId: 'format',
        severity: 'info',
        ranges: [],
        message: `区切り文字: ${ctx.delimiter}`,
      });
    }

    if (ctx.mergedCells && ctx.mergedCells.length > 0) {
      findings.push({
        checkId: 'format',
        severity: 'warning',
        ranges: ctx.mergedCells.map(mc => ({
          startRow: mc.startRow,
          startCol: mc.startCol,
          endRow: mc.endRow,
          endCol: mc.endCol,
        })),
        message: `${ctx.mergedCells.length} 個のセル結合が検出されました。`,
      });
    }

    if (findings.length === 0) {
      findings.push({
        checkId: 'format',
        severity: 'info',
        ranges: [],
        message: 'CSVファイル（カンマ区切り）',
      });
    }

    return findings;
  },
};
