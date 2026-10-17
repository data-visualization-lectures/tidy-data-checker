# 整頓データチェッカー

CSV / Excel をブラウザ内で点検し、整然データ（UTF-8 CSV）として書き出す加工ツールです。データの道具箱の prep ツールとして公開します。

| 項目 | 値 |
| --- | --- |
| ツール名 | 整頓データチェッカー |
| appName | `tidy-data-checker` |
| scope | `prep` |
| 公開ホスト | https://tidy-data-checker.dataprep.jp |

プロジェクトの保存機能とシェア機能はありません。ファイルの読み込み、チェック、修正、書き出しはすべてブラウザ内で完結し、表データはサーバーへ送られません。

画面上部の共通ヘッダーと認証は、`index.html` から読み込む外部スクリプト（`supabase.v1.js` と `dataviz-auth-client.v1.js`）が担当します。これらのスクリプトは npm では入れず、アプリ本体にもバンドルしません。

## ローカル起動

```bash
npm install && npm run dev
```

認証なしで画面を確認するときは、URL に `?auth_debug` を付けます。

## テストとビルド

```bash
npm test
npm run build
```

## デプロイ

Vercel にデプロイします。`main` へのマージが本番（https://tidy-data-checker.dataprep.jp）です。プルリクエストごとにプレビューが作られます。

## Git

変更はプルリクエスト経由で `main` に取り込みます。
