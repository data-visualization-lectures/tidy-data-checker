import { useState } from 'react';
import type { Table } from '../types';
import { exportAsUTF8CSV } from '../utils/export';

interface ExportPanelProps {
  table: Table;
  fileName: string;
  historyLength: number;
  encoding: string;
  hasBom: boolean;
  onUndo: () => void;
  onReset: () => void;
}

function isEncodingReady(encoding: string, hasBom: boolean): boolean {
  if (encoding === 'Excel') {
    return true;
  }
  return encoding === 'UTF-8' && !hasBom;
}

export function ExportPanel({ table, fileName, historyLength, encoding, hasBom, onUndo, onReset }: ExportPanelProps) {
  const [withBom, setWithBom] = useState(false);
  const encodingReady = isEncodingReady(encoding, hasBom);

  const handleExport = () => {
    if (!encodingReady) {
      const proceed = window.confirm(
        `元ファイルは${encoding}${hasBom ? '（BOM付き）' : ''}です。\n` +
        'UTF-8への変換修正が未適用です。このままエクスポートしますか？\n\n' +
        '（チェックリストの「文字コード」から変換できます）'
      );
      if (!proceed) return;
    }
    exportAsUTF8CSV(table, fileName, withBom);
  };

  return (
    <div className="export-panel">
      <div className="export-actions">
        <button
          className="undo-button"
          onClick={onUndo}
          disabled={historyLength === 0}
        >
          ↩️ 元に戻す
          {historyLength > 0 && <span className="history-count">({historyLength})</span>}
        </button>

        <button className="reset-button" onClick={onReset}>
          🔄 新しいファイル
        </button>
      </div>

      <div className="export-options">
        <label className="bom-option">
          <input
            type="checkbox"
            checked={withBom}
            onChange={(e) => setWithBom(e.target.checked)}
          />
          BOM付き（Excel用）
        </label>

        <button 
          className={`export-button ${!encodingReady ? 'encoding-warning' : ''}`}
          onClick={handleExport}
          title={!encodingReady ? `元ファイル: ${encoding}${hasBom ? '（BOM付き）' : ''} - UTF-8変換を推奨` : ''}
        >
          📥 UTF-8 CSVをエクスポート
        </button>
      </div>
    </div>
  );
}
