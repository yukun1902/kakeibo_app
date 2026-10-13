# おかねノート（フロントエンド / デザイン版）

HTML・CSS・JavaScript だけで作った、支出を記録する家計簿アプリの画面です。
`index.html` をブラウザで直接開けば動きます（サーバー不要）。

## スマートフォン専用

- スマホの画面いっぱいに表示します（ノッチやホームバーの部分も考慮済み）
- PC で開くと「スマートフォン専用です」の案内が出ます。
  「PCでプレビューする」を押すと、スマホの大きさで表示されます（タブを閉じるまで有効）
- 開発中は Chrome / Edge の開発者ツール（F12）→ デバイスツールバー（Ctrl+Shift+M）で
  スマホ表示にして確認するのがおすすめです
- http(s) で配信すると、スマホの「ホーム画面に追加」でアプリのように全画面で開けます
  （`manifest.webmanifest`）。Go のサーバーからこのフォルダを配信すれば使えます

## ファイル構成

```
frontend/
├── index.html           … 入口
├── manifest.webmanifest … ホーム画面に追加したときの設定
├── icon.svg             … アプリのアイコン
├── css/style.css        … 見た目（ライト/ダークテーマ対応）
└── js/
    ├── api.js           … データ層（今は localStorage。後で Go の API に差し替える）
    └── app.js           … 画面の表示と画面遷移
```

## 画面一覧

| # | 画面 | URL |
|---|------|-----|
| ① | ホーム（今月の支出・前月との差・割合） | `#/home` |
| ② | 支出の追加（カテゴリー選択） | `#/add` |
| ③ | 支出の追加（入力） | `#/add/input?cat=1` |
| ④ | 支出一覧 | `#/list` |
| ⑤ | グラフ・分析 | `#/graph` |
| ⑥ | カレンダー | `#/calendar` |
| ⑦ | カテゴリー管理 | `#/categories` |
| ⑧ | 支出の編集 | `#/expenses/{id}/edit` |
| ⑨ | 支出の詳細 | `#/expenses/{id}` |
| ⑩ | 期間フィルター | `#/filter` |
| ⑪ | メニュー（その他） | `#/menu` |

## データベースとの対応

テーブルは `../db/schema.sql`（PostgreSQL / データベース名 `kakeibo_app`）です。
画面で扱うデータの形は、このテーブルの列名に合わせています。

```jsonc
// categories
{ "id": 1, "name": "食費" }

// expenses（memo は空なら null）
{
  "id": 1, "category_id": 1, "amount": 1200,
  "date": "2025-10-24", "memo": "スーパー", "created_at": "2025-10-24T14:35:00Z"
}
```

カテゴリーのアイコンと色は DB に保存せず、画面側（`app.js` の `styleOf`）で決めています。
最初から用意しているカテゴリーは名前で決まり、それ以外は名前の1文字目をアイコンにして、色は ID から選びます。

## Go で作る REST API の案

`js/api.js` の各関数が、以下のエンドポイントに対応する想定です。
API ができたら関数の中身を `fetch()` に置き換えれば、画面側は変更不要です。

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/categories` | カテゴリー一覧 |
| POST | `/categories` | カテゴリー追加 |
| PUT | `/categories/{id}` | カテゴリー名の変更 |
| DELETE | `/categories/{id}` | カテゴリー削除（支出で使用中なら外部キー制約で 409） |
| GET | `/expenses?from=&to=&category_id=1,2` | 支出一覧（期間・カテゴリーで絞り込み） |
| GET | `/expenses/{id}` | 支出の詳細 |
| POST | `/expenses` | 支出の追加 |
| PUT | `/expenses/{id}` | 支出の更新 |
| DELETE | `/expenses/{id}` | 支出の削除 |
| GET | `/summary?from=&to=` | 期間の合計・件数とカテゴリー別の合計 |
| GET | `/summary/monthly?from=2025-05&months=6` | 月ごとの合計（棒グラフ用） |

`/summary` の返り値の例:

```json
{
  "from": "2025-10-01", "to": "2025-10-31", "total": 82350, "count": 24,
  "by_category": [{ "category_id": 1, "name": "食費", "amount": 26400 }]
}
```
