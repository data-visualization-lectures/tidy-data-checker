import type { Finding } from '../types';
import { FindingItem } from './FindingItem';
import { checkpointRegistry } from '../checks';

interface CheckPanelProps {
  findings: Finding[];
  selectedFinding: Finding | null;
  onSelectFinding: (finding: Finding | null) => void;
  onPreviewFix: (finding: Finding) => void;
  filterCheckpointId?: string | null;
}

export function CheckPanel({
  findings,
  selectedFinding,
  onSelectFinding,
  onPreviewFix,
  filterCheckpointId,
}: CheckPanelProps) {
  const implementedCheckpoints = checkpointRegistry.filter(cp => cp.check !== null);

  const filteredCheckpoints = filterCheckpointId
    ? implementedCheckpoints.filter(cp => cp.id === filterCheckpointId)
    : implementedCheckpoints;

  const findingsByCheck = filteredCheckpoints.map(cp => ({
    checkpoint: cp,
    findings: findings.filter(f => f.checkId === cp.id),
  }));

  return (
    <div className="check-panel">
      <h2 className="check-panel-title">
        チェック結果
        {filterCheckpointId && (
          <span className="filter-indicator">（フィルター中）</span>
        )}
      </h2>

      {findingsByCheck.map(({ checkpoint, findings: checkFindings }) => (
        <div key={checkpoint.id} className="check-section">
          <div className="check-header">
            <h3 className="check-title">{checkpoint.name}</h3>
            <p className="check-description">{checkpoint.description}</p>
          </div>

          <div className="findings-list">
            {checkFindings.length === 0 ? (
              <div className="no-findings">検出なし</div>
            ) : (
              checkFindings.map((finding, index) => (
                <FindingItem
                  key={`${finding.checkId}-${index}`}
                  finding={finding}
                  isSelected={selectedFinding === finding}
                  onSelect={() => onSelectFinding(
                    selectedFinding === finding ? null : finding
                  )}
                  onPreviewFix={() => onPreviewFix(finding)}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
