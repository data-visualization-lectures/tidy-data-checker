import type { Table, Finding } from '../types';
import { DataGrid } from './DataGrid';

interface FixPreviewProps {
  finding: Finding;
  currentTable: Table;
  previewTable: Table;
  onApply: () => void;
  onCancel: () => void;
}

export function FixPreview({
  finding,
  currentTable,
  previewTable,
  onApply,
  onCancel,
}: FixPreviewProps) {
  const rowDiff = currentTable.length - previewTable.length;
  const currentMaxCols = Math.max(0, ...currentTable.map(r => r.length));
  const previewMaxCols = Math.max(0, ...previewTable.map(r => r.length));
  const colDiff = currentMaxCols - previewMaxCols;

  return (
    <div className="fix-preview-overlay">
      <div className="fix-preview-modal">
        <div className="fix-preview-header">
          <h3>修正のプレビュー</h3>
          <p className="fix-description">{finding.fix?.description}</p>
        </div>

        <div className="fix-preview-comparison">
          <div className="fix-preview-before">
            <h4>修正前</h4>
            <div className="fix-preview-stats">
              {currentTable.length} 行 × {currentMaxCols} 列
            </div>
            <DataGrid table={currentTable} highlightRanges={finding.ranges} />
          </div>

          <div className="fix-preview-arrow">→</div>

          <div className="fix-preview-after">
            <h4>修正後</h4>
            <div className="fix-preview-stats">
              {previewTable.length} 行 × {previewMaxCols} 列
              {rowDiff !== 0 && (
                <span className="fix-diff">
                  {rowDiff > 0 ? `（${rowDiff} 行削除）` : `（${-rowDiff} 行追加）`}
                </span>
              )}
              {colDiff !== 0 && (
                <span className="fix-diff">
                  {colDiff > 0 ? `（${colDiff} 列削除）` : `（${-colDiff} 列追加）`}
                </span>
              )}
            </div>
            <DataGrid table={previewTable} previewTable={previewTable} />
          </div>
        </div>

        <div className="fix-preview-actions">
          <button className="cancel-button" onClick={onCancel}>
            キャンセル
          </button>
          <button className="apply-button" onClick={onApply}>
            この修正を適用
          </button>
        </div>
      </div>
    </div>
  );
}
