import type { Finding } from '../types';
import { rangeToA1 } from '../utils/cellRef';

interface FindingItemProps {
  finding: Finding;
  isSelected: boolean;
  onSelect: () => void;
  onPreviewFix?: () => void;
}

const severityLabels: Record<string, string> = {
  error: 'エラー',
  warning: '警告',
  info: '情報',
};

const severityIcons: Record<string, string> = {
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

export function FindingItem({ finding, isSelected, onSelect, onPreviewFix }: FindingItemProps) {
  const cellRefs = finding.ranges.length > 0
    ? finding.ranges.map(r => rangeToA1(r.startRow, r.startCol, r.endRow, r.endCol)).join(', ')
    : null;

  return (
    <div
      className={`finding-item severity-${finding.severity} ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="finding-header">
        <span className="finding-severity">
          {severityIcons[finding.severity]} {severityLabels[finding.severity]}
        </span>
        {cellRefs && (
          <span className="finding-cells">{cellRefs}</span>
        )}
      </div>
      <div className="finding-message">{finding.message}</div>
      {finding.fix && (
        <div className="finding-fix">
          <button
            className="fix-button"
            onClick={(e) => {
              e.stopPropagation();
              onPreviewFix?.();
            }}
          >
            修正をプレビュー: {finding.fix.description}
          </button>
        </div>
      )}
    </div>
  );
}
