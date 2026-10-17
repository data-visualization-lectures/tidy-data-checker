import type { Check } from '../types';
import { encodingCheck } from './encoding';
import { formatCheck } from './format';
import { emptyCheck } from './empty';
import { titleNotesCheck } from './titleNotes';
import { multiHeaderCheck } from './multiHeader';
import { totalsCheck } from './totals';
import { symbolsCheck } from './symbols';

export interface CheckpointDefinition {
  id: string;
  name: string;
  description: string;
  check: Check | null;
}

export const checkpointRegistry: CheckpointDefinition[] = [
  {
    id: 'encoding',
    name: '文字コード',
    description: 'Shift_JIS/UTF-8などの文字コードを判定し、文字化けを検出します。',
    check: encodingCheck,
  },
  {
    id: 'format',
    name: '形式とシート選択',
    description: '区切り文字の検出、Excelの複数シート選択、セル結合情報を取得します。',
    check: formatCheck,
  },
  {
    id: 'empty',
    name: '空行・空列',
    description: '意味のない空行や空列を検出します。削除すると分析しやすくなります。',
    check: emptyCheck,
  },
  {
    id: 'title-notes',
    name: '表の上下（タイトル・注記行）',
    description: 'タイトル行、単位行、注記行を検出します。データ本体と分離できます。',
    check: titleNotesCheck,
  },
  {
    id: 'multi-header',
    name: '多段ヘッダー・セル結合',
    description: '複数行ヘッダーやセル結合を検出し、1行ヘッダーに統合できます。',
    check: multiHeaderCheck,
  },
  {
    id: 'totals',
    name: '合計・小計行',
    description: '集計行を検出します。分析時に二重カウントを防ぐため除去できます。',
    check: totalsCheck,
  },
  {
    id: 'symbols',
    name: '値の中の記号',
    description: '※、-、…、x、秘匿などの記号を検出し、欠損値として処理できます。',
    check: symbolsCheck,
  },
  {
    id: 'format-number',
    name: '全角数字・桁区切り・単位',
    description: '全角数字→半角、桁区切り除去、単位分離で数値として扱えるようにします。',
    check: null,
  },
  {
    id: 'wareki',
    name: '和暦などの日付',
    description: '和暦（令和・平成など）を西暦に変換し、日付形式を統一します。',
    check: null,
  },
  {
    id: 'wide-to-long',
    name: '横持ち→縦持ち',
    description: '横に広がったデータを縦長に変換します（tidy data化の要）。',
    check: null,
  },
  {
    id: 'final',
    name: '型のばらつき最終確認',
    description: '列ごとの型（数値・文字列・日付）の整合性を確認します。',
    check: null,
  },
];

export function getImplementedChecks(): Check[] {
  return checkpointRegistry
    .filter((cp): cp is CheckpointDefinition & { check: Check } => cp.check !== null)
    .map(cp => cp.check);
}

export function getCheckpointById(id: string): CheckpointDefinition | undefined {
  return checkpointRegistry.find(cp => cp.id === id);
}
