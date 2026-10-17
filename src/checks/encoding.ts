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
  return encoding === 'UTF-8' && !hasBom;
}

function isExcelFile(encoding: string): boolean {
  return encoding === 'Excel';
}

function getEncodingExplanation(encoding: string, hasBom: boolean): string {
  if (hasBom && encoding === 'UTF-8') {
    return 'このファイルはUTF-8ですが、先頭にBOM（バイトオーダーマーク）が付いています。ExcelでCSVを開くときには便利ですが、PythonやRで読み込むと1行目に余計な文字が入ることがあります。BOMなしのUTF-8にそろえておくと安心です。';
  }
  if (encoding === 'Shift_JIS' || encoding === 'CP932') {
    return 'このファイルはShift_JIS（Windowsの日本語用の文字コード。cp932とも呼ばれます）です。MacやLinux、Python、Rなどで開くと文字化けしやすいので、今の標準であるUTF-8にそろえましょう。';
  }
  if (encoding === 'EUC-JP') {
    return 'このファイルはEUC-JP（古いUnix系の日本語文字コード）です。現在はUTF-8が標準なので、変換しておくと様々なツールで問題なく使えます。';
  }
  return `このファイルは${encoding}です。UTF-8に変換しておくと、Python・R・Excelなど様々なツールで文字化けなく使えます。`;
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

    if (isExcelFile(ctx.encoding)) {
      findings.push({
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: 'Excelファイルは文字コードの問題が起きません（書き出しはUTF-8になります）。',
      });
    } else if (isPlainUTF8(ctx.encoding, ctx.hasBom)) {
      findings.push({
        checkId: 'encoding',
        severity: 'info',
        ranges: [],
        message: '文字コード: UTF-8（問題なし）。このまま様々なツールで使えます。',
      });
    } else {
      const encodingDisplay = ctx.hasBom
        ? `${ctx.encoding}（BOM付き）`
        : ctx.encoding;

      findings.push({
        checkId: 'encoding',
        severity: 'warning',
        ranges: [],
        message: `文字コード: ${encodingDisplay}。${getEncodingExplanation(ctx.encoding, ctx.hasBom)}`,
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
