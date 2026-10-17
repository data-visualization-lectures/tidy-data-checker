import { useCallback, useState, useEffect } from 'react';
import { FileDropZone } from './components/FileDropZone';
import { DataGrid } from './components/DataGrid';
import { CheckPanel } from './components/CheckPanel';
import { ChecklistPanel } from './components/ChecklistPanel';
import { ExportPanel } from './components/ExportPanel';
import { FixPreview } from './components/FixPreview';
import { SheetSelector } from './components/SheetSelector';
import { CellDetail } from './components/CellDetail';
import { useTableState } from './hooks/useTableState';
import { readFileAsArrayBuffer, detectAndDecode } from './utils/decode';
import { parseCSVWithMeta } from './utils/csv';
import { isExcelFile, getExcelSheets, parseExcelSheet } from './utils/excel';
import type { SheetInfo } from './types';
import './App.css';

function App() {
  const {
    fileName,
    encoding,
    hasBom,
    table,
    encodingFixed,
    history,
    findings,
    filteredFindings,
    checkpointStates,
    selectedFinding,
    selectedCheckpointId,
    pendingFix,
    sheetName,
    sheets,
    tableVersion,
    setTable,
    selectFinding,
    selectCheckpoint,
    previewFix,
    applyFix,
    cancelFix,
    undo,
    reset,
  } = useTableState();

  const [pendingSheetSelection, setPendingSheetSelection] = useState<{
    bytes: Uint8Array;
    fileName: string;
    sheets: SheetInfo[];
  } | null>(null);

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number; value: string } | null>(null);

  useEffect(() => {
    setSelectedCell(null);
  }, [tableVersion]);

  const handleFileSelect = useCallback(async (file: File) => {
    try {
      const bytes = await readFileAsArrayBuffer(file);

      if (isExcelFile(file.name)) {
        const { sheets: excelSheets, defaultSheet } = getExcelSheets(bytes);
        
        if (excelSheets.length > 1) {
          setPendingSheetSelection({ bytes, fileName: file.name, sheets: excelSheets });
          return;
        }

        const parsed = parseExcelSheet(bytes, defaultSheet);
        setTable({
          table: parsed.table,
          fileName: file.name,
          encoding: 'Excel',
          hasBom: false,
          sheetName: parsed.sheetName,
          sheets: parsed.sheets,
          mergedCells: parsed.mergedCells,
        });
      } else {
        const { text, encoding: detectedEncoding, hasBom: detectedBom, garbledText } = detectAndDecode(bytes);
        const parsed = parseCSVWithMeta(text);
        const garbledParsed = garbledText ? parseCSVWithMeta(garbledText) : null;
        setTable({
          table: parsed.table,
          garbledTable: garbledParsed?.table,
          fileName: file.name,
          encoding: detectedEncoding,
          hasBom: detectedBom,
          delimiter: parsed.delimiter,
        });
      }
    } catch (error) {
      console.error('File read error:', error);
      alert('ファイルの読み込みに失敗しました。');
    }
  }, [setTable]);

  const handleSheetSelect = useCallback((sheetName: string) => {
    if (!pendingSheetSelection) return;

    const parsed = parseExcelSheet(pendingSheetSelection.bytes, sheetName);
    setTable({
      table: parsed.table,
      fileName: pendingSheetSelection.fileName,
      encoding: 'Excel',
      hasBom: false,
      sheetName: parsed.sheetName,
      sheets: parsed.sheets,
      mergedCells: parsed.mergedCells,
    });
    setPendingSheetSelection(null);
  }, [pendingSheetSelection, setTable]);

  const handleCellClick = useCallback((row: number, col: number, value: string) => {
    setSelectedCell({ row, col, value });
  }, []);

  const highlightRanges = selectedFinding?.ranges ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>Tidy Data Checker</h1>
        <p className="app-subtitle">CSV/Excel整然データ変換ツール</p>
      </header>

      <main className="app-main">
        {!table ? (
          <div className="welcome-screen">
            <FileDropZone onFileSelect={handleFileSelect} />
            <div className="welcome-info">
              <h2>使い方</h2>
              <ol>
                <li>CSV/Excelファイルをドラッグ＆ドロップまたは選択</li>
                <li>チェックリストで問題を確認</li>
                <li>修正をプレビューして適用</li>
                <li>UTF-8 CSVとしてエクスポート</li>
              </ol>
              <p className="privacy-note">
                ⚠️ すべての処理はブラウザ内で完結します。データは一切アップロードされません。
              </p>
            </div>
          </div>
        ) : (
          <div className="editor-screen">
            <div className="editor-header">
              <div className="file-info">
                <span className="file-name">{fileName}</span>
                <span className="file-encoding">
                  {encoding}{hasBom ? '（BOM付き）' : ''}
                  {sheetName && ` / シート: ${sheetName}`}
                </span>
                <span className="file-size">
                  {table.length} 行 × {Math.max(0, ...table.map(r => r.length))} 列
                </span>
                {sheets && sheets.length > 1 && (
                  <span className="sheet-count">{sheets.length} シート</span>
                )}
              </div>
              <ExportPanel
                table={table}
                fileName={fileName || 'data.csv'}
                historyLength={history.length}
                encoding={encoding}
                hasBom={hasBom}
                encodingFixed={encodingFixed}
                onUndo={undo}
                onReset={reset}
              />
            </div>

            <div className="editor-body">
              <div className="checklist-sidebar">
                <ChecklistPanel
                  checkpoints={checkpointStates}
                  findings={findings}
                  selectedCheckpointId={selectedCheckpointId}
                  encodingFixed={encodingFixed}
                  onSelectCheckpoint={selectCheckpoint}
                />
              </div>

              <div className="main-content">
                <div className="grid-panel">
                  {!encodingFixed && encoding !== 'UTF-8' && encoding !== 'Excel' && (
                    <div className="mojibake-notice">
                      <span className="mojibake-icon">⚠️</span>
                      <span className="mojibake-text">
                        文字化けしています。UTF-8だと思って読むとこうなります。手順1で変換しましょう。
                      </span>
                    </div>
                  )}
                  <DataGrid
                    table={table}
                    highlightRanges={highlightRanges}
                    onCellClick={handleCellClick}
                  />
                  {selectedCell && (
                    <CellDetail
                      row={selectedCell.row}
                      col={selectedCell.col}
                      value={selectedCell.value}
                      onClose={() => setSelectedCell(null)}
                    />
                  )}
                </div>
              </div>

              <div className="side-panel">
                <CheckPanel
                  findings={filteredFindings}
                  selectedFinding={selectedFinding}
                  onSelectFinding={selectFinding}
                  onPreviewFix={previewFix}
                  filterCheckpointId={selectedCheckpointId}
                  encodingFixed={encodingFixed}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {pendingSheetSelection && (
        <SheetSelector
          sheets={pendingSheetSelection.sheets}
          onSelect={handleSheetSelect}
          onCancel={() => setPendingSheetSelection(null)}
        />
      )}

      {pendingFix && table && (
        <FixPreview
          finding={pendingFix.finding}
          currentTable={table}
          previewTable={pendingFix.previewTable}
          onApply={applyFix}
          onCancel={cancelFix}
        />
      )}
    </div>
  );
}

export default App;
