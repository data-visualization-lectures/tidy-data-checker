import type { Check, Finding, Table, CheckContext } from '../types';

const MOJIBAKE_PATTERNS = [
  /\ufffd/,
  /縺[ぁ-ん]/,
  /繧[ぁ-ん]/,
  /繝[ぁ-ん]/,
  /譁[ぁ-ん]/,
  /蟄[ぁ-ん]/,
  /ﾃ[ぁ-ん]/,
  /ﾂ[ぁ-ん]/,
  /[\x80-\x9f][\x80-\xbf]/,
];

function detectMojibake(text: string): boolean {
  return MOJIBAKE_PATTERNS.some(pattern => pattern.test(text));
}

export const encodingCheck: Check = {
  id: 'encoding',
  title: '文字コード',
  description: 'ファイルの文字コードを検出し、文字化けがないか確認します。',

  detect: (table: Table, ctx: CheckContext): Finding[] => {
    const findings: Finding[] = [];

    const encodingInfo = ctx.hasBom
      ? `${ctx.encoding}（BOM付き）`
      : ctx.encoding;

    findings.push({
      checkId: 'encoding',
      severity: 'info',
      ranges: [],
      message: `検出された文字コード: ${encodingInfo}`,
    });

    const mojibakeCells: { row: number; col: number; value: string }[] = [];

    for (let row = 0; row < table.length; row++) {
      for (let col = 0; col < table[row].length; col++) {
        const cell = table[row][col];
        if (cell && detectMojibake(cell)) {
          mojibakeCells.push({ row, col, value: cell });
        }
      }
    }

    if (mojibakeCells.length > 0) {
      const ranges = mojibakeCells.map(({ row, col }) => ({
        startRow: row,
        startCol: col,
        endRow: row,
        endCol: col,
      }));

      findings.push({
        checkId: 'encoding',
        severity: 'error',
        ranges,
        message: `文字化けの可能性があるセルが ${mojibakeCells.length} 個見つかりました。ファイルの文字コードが正しく判定されていない可能性があります。`,
      });
    }

    return findings;
  },
};
