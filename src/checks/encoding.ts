import type { Check, Finding, Table, CheckContext, Fix } from '../types';

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

function isPlainUTF8(encoding: string, hasBom: boolean): boolean {
  if (encoding === 'Excel') {
    return true;
  }
  return encoding === 'UTF-8' && !hasBom;
}

function getEncodingExplanation(encoding: string, hasBom: boolean): string {
  if (hasBom && encoding === 'UTF-8') {
    return 'UTF-8 BOM付きファイルです。BOMはExcel連携では便利ですが、Python/Rでは予期しない問題を起こすことがあります。BOMなしUTF-8への変換を推奨します。';
  }
  if (encoding === 'Shift_JIS' || encoding === 'CP932') {
    return `${encoding}（Windows日本語）ファイルです。Python（encoding='cp932'）やR（fileEncoding='CP932'）で読み込めますが、UTF-8に変換するとツール間の互換性が向上します。`;
  }
  if (encoding === 'EUC-JP') {
    return 'EUC-JP（Unix日本語）ファイルです。UTF-8に変換するとツール間の互換性が向上します。';
  }
  return `${encoding}ファイルです。UTF-8に変換するとPython/R/Excelなど多くのツールで問題なく読み込めます。`;
}

function createEncodingFix(fromEncoding: string, hasBom: boolean): Fix {
  return {
    description: '文字コードをUTF-8に変換',
    apply: (table: Table): Table => table,
    encodingConversion: {
      from: fromEncoding,
      hasBom,
    },
  };
}

export const encodingCheck: Check = {
  id: 'encoding',
  title: '文字コード',
  description: 'Shift_JIS/UTF-8などの文字コードを判定し、文字化けを検出します。',

  detect: (table: Table, ctx: CheckContext): Finding[] => {
    const findings: Finding[] = [];

    if (isPlainUTF8(ctx.encoding, ctx.hasBom)) {
      findings.push({
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: '検出された文字コード: UTF-8',
      });
    } else {
      const encodingDisplay = ctx.hasBom
        ? `${ctx.encoding}（BOM付き）`
        : ctx.encoding;

      findings.push({
        checkId: 'encoding',
        severity: 'warning',
        ranges: [],
        message: `検出された文字コード: ${encodingDisplay}。${getEncodingExplanation(ctx.encoding, ctx.hasBom)}`,
        fix: createEncodingFix(ctx.encoding, ctx.hasBom),
      });
    }

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
