# Tidy Data Checker 設計書

## 概要

日本の行政・業界団体サイト（e-Stat、各省庁、自治体等）からダウンロードした乱雑なCSV/Excelファイルを、ブラウザ内で点検・修正し、整然データ（tidy data）としてエクスポートするツール。

**対象ユーザー**: 日本の美術系学生・データ可視化学習者

**特徴**:
- ブラウザ完結（データは一切アップロードしない）
- 順序立てたチェックポイントで問題箇所を可視化
- 自動修正なし：すべての修正はユーザーが確認してから適用
- 元に戻す（Undo）対応
- UTF-8 CSVエクスポート

## 技術スタック

- **ビルド**: Vite
- **UI**: React + TypeScript
- **テスト**: Vitest
- **文字コード変換**: encoding-japanese（Shift_JIS/CP932対応）
- **CSVパース**: Papa Parse
- **デプロイ**: Vercel（静的サイト）

依存関係は最小限に保つ。状態管理ライブラリ、ルーター、UIキットは必要性が明確になるまで使用しない。

## コアモデル

### Table（テーブル）

```typescript
type Table = string[][];  // 2D配列、各セルは文字列
```

デコード後の生データを保持。0-based インデックスだが、UIでは行番号（1始まり）と列文字（A, B, C...）で表示。

### Check（チェック）

```typescript
interface Check {
  id: string;
  title: string;        // 日本語タイトル
  description: string;  // 日本語説明
  detect: (table: Table, ctx: CheckContext) => Finding[];
}

interface CheckContext {
  fileName: string;
  encoding: string;
  hasBom: boolean;
}
```

### Finding（検出結果）

```typescript
interface Finding {
  checkId: string;
  severity: 'error' | 'warning' | 'info';
  ranges: CellRange[];  // 該当セル範囲
  message: string;      // 問題の説明（日本語）
  fix?: Fix;            // 修正候補（オプション）
}

interface CellRange {
  startRow: number;  // 0-based
  startCol: number;  // 0-based
  endRow: number;
  endCol: number;
}
```

### Fix（修正）

```typescript
interface Fix {
  description: string;  // 修正内容の説明（日本語）
  apply: (table: Table) => Table;  // 純粋関数
}
```

### History（履歴）

```typescript
interface HistoryEntry {
  table: Table;
  appliedFix: {
    checkId: string;
    fixDescription: string;
    timestamp: number;
  };
}
```

Undo対応と、将来の「Python/pandasコードとしてエクスポート」機能のために履歴を保持。

## チェックポイント順序

| # | ID | タイトル | 説明 |
|---|---|---|---|
| 1 | encoding | 文字コード | Shift_JIS/CP932、UTF-8 BOM、文字化け検出 |
| 2 | format | 形式とシート選択 | 区切り文字の検出、Excel複数シート選択 |
| 3 | empty | 空行・空列 | 意味のない空行・空列の検出と削除 |
| 4 | header-footer | 表の上下 | タイトル行、注記行の検出と除去 |
| 5 | multi-header | 多段ヘッダー | 複数行にまたがるヘッダー、セル結合の検出 |
| 6 | totals | 合計・小計行 | 集計行の検出と除去オプション |
| 7 | symbols | 値の中の記号 | ※、-、…、x、秘匿 等の検出と処理 |
| 8 | format-number | 全角数字・桁区切り・単位 | 全角数字→半角、桁区切り除去、単位分離 |
| 9 | wareki | 和暦などの日付 | 和暦→西暦変換、日付フォーマット統一 |
| 10 | wide-to-long | 横持ち→縦持ち | ユーザーが残す列を選択してunpivot |
| 11 | final | 型のばらつき最終確認 | 列ごとの型整合性チェック |

**順序の理由**: Wide-to-long（横持ち→縦持ち）は後半に配置。ヘッダーがクリーンな状態でないと正しく変換できないため。

## 実装ユニット

### Unit 1: 基盤とデコード・表示
- Viteプロジェクトの構築
- ファイルドロップ/選択UI
- 文字コード自動判定とデコード（Shift_JIS/CP932、UTF-8 ± BOM）
- グリッド表示（行番号、列文字）

### Unit 2: Check/Finding/Fixフレームワーク
- Check/Finding/Fixの型とインターフェース
- ステップバイステップパネルUI
- セルハイライトと検出結果へのスクロール
- 文字コードチェック（encoding）
  - 検出されたエンコーディングとBOMの報告
  - 文字化けの検出（U+FFFD、典型的な文字化けパターン）
- 空行・空列チェック（empty）
  - 空行・空列の検出
  - 削除Fixの提供
- 修正の確認/適用/Undo
- UTF-8 CSVエクスポート（BOMあり/なしオプション）

### Unit 3: Excelと構造検出
- Excel（.xlsx）ファイル対応
- 複数シート選択
- セル結合の検出
- タイトル/注記行の検出
- 多段ヘッダーの検出

### Unit 4: 値のクリーニング
- 合計・小計行の検出
- 記号（※、-、…、x、秘匿等）の処理
- 全角数字→半角変換
- 桁区切り除去
- 単位の分離
- 和暦→西暦変換

### Unit 5: 横持ち→縦持ち
- 列選択UI
- Unpivot変換
- プレビュー

### Unit 6: コードエクスポート
- 適用した修正履歴をPython/pandasコードとして出力

## UIコンポーネント構成

```
App
├── FileDropZone         # ファイル選択/ドロップ
├── DataGrid             # テーブル表示（セルハイライト対応）
├── CheckPanel           # チェック一覧とステップナビゲーション
│   └── CheckItem        # 各チェックの結果表示
│       └── FindingItem  # 各検出結果（クリックでセルにジャンプ）
│           └── FixPreview  # 修正プレビュー（適用/キャンセル）
├── ExportPanel          # エクスポートオプション
└── UndoButton           # 元に戻すボタン
```

## セル参照の表示形式

- 内部: 0-based インデックス (row, col)
- UI表示: スプレッドシート形式 (A1, B2, ...)
  - 列: A, B, ..., Z, AA, AB, ...
  - 行: 1, 2, 3, ...

```typescript
function toA1(row: number, col: number): string {
  const colStr = toColLetter(col);
  return `${colStr}${row + 1}`;
}

function toColLetter(col: number): string {
  let s = '';
  col++;
  while (col > 0) {
    col--;
    s = String.fromCharCode(65 + (col % 26)) + s;
    col = Math.floor(col / 26);
  }
  return s;
}
```

## 文字化け検出パターン

1. **U+FFFD（REPLACEMENT CHARACTER）**: デコード失敗の明示的マーカー
2. **典型的な文字化けシーケンス**:
   - `�` (U+FFFD)
   - `縺` `繧` `繝` (Shift_JIS→UTF-8誤変換)
   - `譁` `蟄` (同上)
   - `ﾃ` `ﾂ` (同上)

## エクスポート仕様

- **形式**: CSV
- **エンコーディング**: UTF-8
- **BOMオプション**: 
  - BOMなし（標準）
  - BOM付き（Excel用）: `\uFEFF`を先頭に付加
- **改行コード**: `\n`（LF）
- **引用**: 必要に応じてダブルクォートでエスケープ

## ファイル構成（予定）

```
src/
├── main.tsx
├── App.tsx
├── components/
│   ├── FileDropZone.tsx
│   ├── DataGrid.tsx
│   ├── CheckPanel.tsx
│   ├── FindingItem.tsx
│   ├── FixPreview.tsx
│   └── ExportPanel.tsx
├── checks/
│   ├── index.ts          # チェック一覧
│   ├── encoding.ts       # 文字コードチェック
│   ├── empty.ts          # 空行・空列チェック
│   └── ...
├── utils/
│   ├── decode.ts         # 文字コード判定・デコード
│   ├── csv.ts            # CSV関連ユーティリティ
│   ├── cellRef.ts        # セル参照変換
│   └── export.ts         # エクスポート処理
├── types/
│   └── index.ts          # 共通型定義
└── hooks/
    └── useTableState.ts  # テーブル状態管理
```

## テスト方針

- **単体テスト**: 各チェックの`detect`関数、各Fixの`apply`関数
- **統合テスト**: デコード→表示→チェック→修正→エクスポートのフロー
- **テストフィクスチャ**: 実際の行政データに近い形式のCSV
  - Shift_JIS エンコード
  - UTF-8 BOM付き
  - 空行・空列を含むデータ
  - 文字化けを含むデータ
