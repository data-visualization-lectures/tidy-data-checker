import { useCallback } from 'react';
import { FileDropZone } from './components/FileDropZone';
import { DataGrid } from './components/DataGrid';
import { CheckPanel } from './components/CheckPanel';
import { ExportPanel } from './components/ExportPanel';
import { FixPreview } from './components/FixPreview';
import { useTableState } from './hooks/useTableState';
import { readFileAsArrayBuffer, detectAndDecode } from './utils/decode';
import { parseCSV } from './utils/csv';
import './App.css';

function App() {
  const {
    fileName,
    encoding,
    hasBom,
    table,
    history,
    findings,
    selectedFinding,
    pendingFix,
    setTable,
    selectFinding,
    previewFix,
    applyFix,
    cancelFix,
    undo,
    reset,
  } = useTableState();

  const handleFileSelect = useCallback(async (file: File) => {
    try {
      const bytes = await readFileAsArrayBuffer(file);
      const { text, encoding: detectedEncoding, hasBom: detectedBom } = detectAndDecode(bytes);
      const parsedTable = parseCSV(text);
      setTable(parsedTable, file.name, detectedEncoding, detectedBom);
    } catch (error) {
      console.error('File read error:', error);
      alert('ファイルの読み込みに失敗しました。');
    }
  }, [setTable]);

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
                <li>CSVファイルをドラッグ＆ドロップまたは選択</li>
                <li>チェック結果を確認し、問題箇所をクリック</li>
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
                </span>
                <span className="file-size">
                  {table.length} 行 × {Math.max(0, ...table.map(r => r.length))} 列
                </span>
              </div>
              <ExportPanel
                table={table}
                fileName={fileName || 'data.csv'}
                historyLength={history.length}
                onUndo={undo}
                onReset={reset}
              />
            </div>

            <div className="editor-body">
              <div className="grid-panel">
                <DataGrid
                  table={table}
                  highlightRanges={highlightRanges}
                  previewTable={pendingFix?.previewTable}
                />
              </div>

              <div className="side-panel">
                <CheckPanel
                  findings={findings}
                  selectedFinding={selectedFinding}
                  onSelectFinding={selectFinding}
                  onPreviewFix={previewFix}
                />
              </div>
            </div>
          </div>
        )}
      </main>

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
