import { useCallback, useState, useRef } from 'react';

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export function FileDropZone({ onFileSelect, disabled }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelect(files[0]);
    }
  }, [disabled, onFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
  }, [onFileSelect]);

  return (
    <div
      className={`file-drop-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.tsv"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <div className="drop-zone-content">
        <div className="drop-zone-icon">📁</div>
        <div className="drop-zone-text">
          CSVファイルをドラッグ＆ドロップ
          <br />
          またはクリックして選択
        </div>
        <div className="drop-zone-hint">
          対応形式: CSV, TSV（Shift_JIS / UTF-8）
        </div>
      </div>
    </div>
  );
}
