import type { CheckpointState, Finding } from '../types';
import { getStatusLabel } from '../utils/checkpointStatus';

interface ChecklistPanelProps {
  checkpoints: CheckpointState[];
  findings: Finding[];
  selectedCheckpointId: string | null;
  encodingFixed: boolean;
  onSelectCheckpoint: (checkpointId: string | null) => void;
}

export function ChecklistPanel({
  checkpoints,
  selectedCheckpointId,
  encodingFixed,
  onSelectCheckpoint,
}: ChecklistPanelProps) {
  return (
    <div className="checklist-panel">
      <h2 className="checklist-title">チェックリスト</h2>
      <p className="checklist-subtitle">整然データ化の11ステップ</p>

      <div className="checklist-items">
        {checkpoints.map((cp, index) => {
          const isEncodingCheck = cp.id === 'encoding';
          const isPendingEncoding = !encodingFixed && !isEncodingCheck;
          
          const displayStatus = isPendingEncoding 
            ? '文字コードの修正後にチェック'
            : getStatusLabel(cp.status);
          
          const isSelected = selectedCheckpointId === cp.id;
          const hasProblems = cp.status.type === 'found';
          const hasInfo = cp.status.type === 'ok' && cp.status.hasInfo;
          const isClickable = !isPendingEncoding && cp.implemented && (cp.actionableCount > 0 || cp.infoCount > 0);

          return (
            <div
              key={cp.id}
              className={`checklist-item ${isPendingEncoding ? 'pending-encoding' : cp.status.type} ${isSelected ? 'selected' : ''} ${isClickable ? 'clickable' : ''}`}
              onClick={() => {
                if (isClickable) {
                  onSelectCheckpoint(isSelected ? null : cp.id);
                }
              }}
            >
              <div className="checklist-item-number">{index + 1}</div>
              <div className="checklist-item-content">
                <div className="checklist-item-header">
                  <span className="checklist-item-name">{cp.name}</span>
                  <span className={`checklist-item-status ${isPendingEncoding ? 'status-pending-encoding' : `status-${cp.status.type}`} ${hasInfo ? 'has-info' : ''}`}>
                    {displayStatus}
                  </span>
                </div>
                <p className="checklist-item-description">{cp.description}</p>
              </div>
              {!isPendingEncoding && (hasProblems || hasInfo) && (
                <div className="checklist-item-indicator">▶</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
