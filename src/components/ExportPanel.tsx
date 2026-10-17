import { useState } from 'react';
import type { Table } from '../types';
import { exportAsUTF8CSV } from '../utils/export';

interface ExportPanelProps {
  table: Table;
  fileName: string;
  historyLength: number;
  encoding: string;
  hasBom: boolean;
  encodingFixed: boolean;
  onUndo: () => void;
  onReset: () => void;
}

function getEncodingDisplayName(encoding: string, hasBom: boolean): string {
  if (hasBom) return `${encoding}（BOM付き）`;
  return encoding;
}

export function ExportPanel({ table, fileName, historyLength, encoding, hasBom, encodingFixed, onUndo, onReset }: ExportPanelProps) {
  const [withBom, setWithBom] = useState(false);
  const [showEncodingBlockedNotice, setShowEncodingBlockedNotice] = useState(false);
  
  const canExport = encodingFixed;

  const handleExportClick = () => {
    if (!canExport) {
      setShowEncodingBlockedNotice(true);
    } else {
      exportAsUTF8CSV(table, fileName, withBom);
    }
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
          className={`export-button ${!canExport ? 'encoding-blocked' : ''}`}
          onClick={handleExportClick}
          title={!canExport ? `文字コードの修正が必要です` : ''}
        >
          📥 UTF-8 CSVをエクスポート
        </button>
      </div>

      {showEncodingBlockedNotice && (
        <div className="encoding-notice-overlay">
          <div className="encoding-notice-modal">
            <h3>エクスポートできません</h3>
            <p>
              現在のデータは <strong>文字化け</strong> した状態で表示されています。
            </p>
            <p>
              文字化けを解消するには、手順1「文字コード」の修正を先に適用してください。
            </p>
            <p className="encoding-notice-hint">
              💡 元ファイルは <strong>{getEncodingDisplayName(encoding, hasBom)}</strong> です。
              チェックリストの「文字コード」をクリックして、UTF-8への変換を適用してください。
            </p>
            <div className="encoding-notice-actions">
              <button 
                className="encoding-notice-primary"
                onClick={() => setShowEncodingBlockedNotice(false)}
              >
                手順1へ戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
