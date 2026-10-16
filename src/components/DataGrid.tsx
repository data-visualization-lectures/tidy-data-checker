import { useRef, useEffect, useMemo } from 'react';
import type { Table, CellRange } from '../types';
import { toColLetter } from '../utils/cellRef';

interface DataGridProps {
  table: Table;
  highlightRanges?: CellRange[];
  previewTable?: Table | null;
  onCellClick?: (row: number, col: number, value: string) => void;
}

function isCellInRange(row: number, col: number, range: CellRange): boolean {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    col >= range.startCol &&
    col <= range.endCol
  );
}

function isCellHighlighted(row: number, col: number, ranges: CellRange[]): boolean {
  return ranges.some(range => isCellInRange(row, col, range));
}

export function DataGrid({ table, highlightRanges = [], previewTable, onCellClick }: DataGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayTable = previewTable || table;

  const maxCols = useMemo(() => {
    return Math.max(0, ...displayTable.map(row => row.length));
  }, [displayTable]);

  const columnHeaders = useMemo(() => {
    return Array.from({ length: maxCols }, (_, i) => toColLetter(i));
  }, [maxCols]);

  useEffect(() => {
    if (highlightRanges.length > 0 && containerRef.current) {
      const firstRange = highlightRanges[0];
      const cellId = `cell-${firstRange.startRow}-${firstRange.startCol}`;
      const cell = document.getElementById(cellId);
      if (cell) {
        cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }
  }, [highlightRanges]);

  if (displayTable.length === 0) {
    return <div className="data-grid-empty">データがありません</div>;
  }

  return (
    <div className="data-grid-container" ref={containerRef}>
      <table className="data-grid">
        <thead>
          <tr>
            <th className="row-header corner"></th>
            {columnHeaders.map((header, index) => (
              <th key={index} className="col-header">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayTable.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="row-header">{rowIndex + 1}</td>
              {Array.from({ length: maxCols }, (_, colIndex) => {
                const value = row[colIndex] ?? '';
                const isHighlighted = isCellHighlighted(rowIndex, colIndex, highlightRanges);
                const isPreview = previewTable !== null && previewTable !== undefined;

                return (
                  <td
                    key={colIndex}
                    id={`cell-${rowIndex}-${colIndex}`}
                    className={`data-cell ${isHighlighted ? 'highlighted' : ''} ${isPreview ? 'preview' : ''}`}
                    title={value}
                    onClick={() => onCellClick?.(rowIndex, colIndex, value)}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
