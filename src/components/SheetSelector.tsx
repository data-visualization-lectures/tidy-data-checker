import type { SheetInfo } from '../types';

interface SheetSelectorProps {
  sheets: SheetInfo[];
  onSelect: (sheetName: string) => void;
  onCancel: () => void;
}

export function SheetSelector({ sheets, onSelect, onCancel }: SheetSelectorProps) {
  return (
    <div className="sheet-selector-overlay">
      <div className="sheet-selector-modal">
        <div className="sheet-selector-header">
          <h3>シートを選択</h3>
          <p>複数のシートが見つかりました。表示するシートを選んでください。</p>
        </div>

        <div className="sheet-list">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              className="sheet-item"
              onClick={() => onSelect(sheet.name)}
            >
              <span className="sheet-index">{index + 1}</span>
              <span className="sheet-name">{sheet.name}</span>
              <span className="sheet-size">
                {sheet.rowCount} 行 × {sheet.colCount} 列
              </span>
            </button>
          ))}
        </div>

        <div className="sheet-selector-actions">
          <button className="cancel-button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
