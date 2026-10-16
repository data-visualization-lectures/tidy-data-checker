import type { Finding } from '../types';
import { FindingItem } from './FindingItem';
import { checks } from '../checks';

interface CheckPanelProps {
  findings: Finding[];
  selectedFinding: Finding | null;
  onSelectFinding: (finding: Finding | null) => void;
  onPreviewFix: (finding: Finding) => void;
}

export function CheckPanel({
  findings,
  selectedFinding,
  onSelectFinding,
  onPreviewFix,
}: CheckPanelProps) {
  const findingsByCheck = checks.map(check => ({
    check,
    findings: findings.filter(f => f.checkId === check.id),
  }));

  return (
    <div className="check-panel">
      <h2 className="check-panel-title">チェック結果</h2>

      {findingsByCheck.map(({ check, findings: checkFindings }) => (
        <div key={check.id} className="check-section">
          <div className="check-header">
            <h3 className="check-title">{check.title}</h3>
            <p className="check-description">{check.description}</p>
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
