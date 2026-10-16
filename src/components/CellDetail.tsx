import { toA1 } from '../utils/cellRef';

interface CellDetailProps {
  row: number;
  col: number;
  value: string;
  onClose: () => void;
}

export function CellDetail({ row, col, value, onClose }: CellDetailProps) {
  const cellRef = toA1(row, col);

  return (
    <div className="cell-detail">
      <div className="cell-detail-header">
        <span className="cell-detail-ref">{cellRef}</span>
        <button className="cell-detail-close" onClick={onClose}>×</button>
      </div>
      <div className="cell-detail-content">
        {value || <span className="cell-detail-empty">（空）</span>}
      </div>
    </div>
  );
}
