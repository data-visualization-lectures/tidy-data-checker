import { useState } from 'react';
import type { Table } from '../types';
import { exportAsUTF8CSV } from '../utils/export';

interface ExportPanelProps {
  table: Table;
  fileName: string;
  historyLength: number;
  onUndo: () => void;
  onReset: () => void;
}

export function ExportPanel({ table, fileName, historyLength, onUndo, onReset }: ExportPanelProps) {
  const [withBom, setWithBom] = useState(false);

  const handleExport = () => {
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

        <button className="export-button" onClick={handleExport}>
          📥 UTF-8 CSVをエクスポート
        </button>
      </div>
    </div>
  );
}
