# おかねノート（家計簿アプリ）

Go（net/http + database/sql + lib/pq）で作った、支出を記録する家計簿アプリの REST API です。
画面は `frontend/` にあります（詳しくは [frontend/README.md](frontend/README.md)）。

しくみを初心者向けに説明した解説は [docs/解説.md](docs/解説.md) にあります。

## 確認用アカウント

| メールアドレス | パスワード |
|---|---|
| `demo@example.com` | `password123` |

- ログイン画面の「確認用アカウント」の「入力する」ボタンを押すと、自動で入力されます
- サンプルの支出（直近2か月半ぶん）が入っているので、ログインしてすぐにホーム・一覧・グラフ・カレンダーの動きを確認できます
- 新規登録から自分のアカウントを作って試すこともできます（新しいアカウントの支出は0件から始まります）

### 確認の手順

1. 下の「起動方法」でサーバーを起動する
2. ブラウザで http://localhost:8080 を開く（PC では「PCでプレビューする」を押す）
3. 確認用アカウントでログインする
4. 「＋」ボタンから支出を追加し、一覧・グラフ・カレンダーに反映されることを確認する
5. メニュー（右上の歯車）から「ログアウト」し、ログインしないと中に入れないことを確認する

## 構成

```
kakeibo_app/
├── main.go        … APIのコード（共通の部品・カテゴリー・支出・集計・サーバーの起動）
├── db/schema.sql  … テーブル定義（PostgreSQL）
├── db/add_users.sql … 会員テーブルの追加と、支出に user_id を足す変更
├── db/seed.sql    … 最初に入れるデータ（カテゴリー・確認用アカウント・サンプルの支出）
├── .env           … 接続情報（gitには含めない）
├── .env.example   … .env の見本
├── frontend/      … 画面（HTML/CSS/JS）
└── docs/解説.md   … 初心者向けの解説
```

## 起動方法

1. PostgreSQL にデータベースとテーブルを作り、最初のデータを入れる（初回のみ。この順番で実行する）
   ```
   psql -U postgres -c "CREATE DATABASE kakeibo_app;"
   psql -U postgres -d kakeibo_app -f db/schema.sql
   psql -U postgres -d kakeibo_app -f db/add_users.sql
   psql -U postgres -d kakeibo_app -f db/seed.sql
   ```
   `seed.sql` は何度実行しても、同じデータが重なって入ることはありません。
2. `.env.example` をコピーして `.env` を作り、接続情報（`DATABASE_URL`）と署名鍵（`JWT_SECRET`、32文字以上）を書く（作成済みなら不要）
3. サーバーを起動する
   ```
   go run .
   ```
   `サーバーを起動しました: http://localhost:8080` と出れば成功です。

## ログイン認証（JWT）

1. `POST /api/register` で会員登録する（メールアドレスとパスワード）。パスワードは bcrypt でハッシュ化して保存する
2. `POST /api/login` でログインすると、`token`（JWT、24時間有効）が返る
3. それ以外の API は、ヘッダーに `Authorization: Bearer <token>` を付けて呼ぶ。付いていない・期限切れ・改ざんされている場合は 401
4. 支出は会員ごとに分かれていて、自分の支出しか見たり変えたりできない（他人の支出は 404）。カテゴリーは全員で共通

## API 一覧

🔓 はログインなしで使える API、それ以外はログインが必要です。

| メソッド | パス | 用途 | 成功時 |
|---------|------|------|--------|
| POST | `/api/register` 🔓 | 会員登録 `{"email": "taro@example.com", "password": "password123"}` | 201 |
| POST | `/api/login` 🔓 | ログイン（`token` を返す） | 200 |
| GET | `/api/me` | ログイン中の会員の情報 | 200 |
| GET | `/api/categories` | カテゴリー一覧 | 200 |
| POST | `/api/categories` | カテゴリー追加 `{"name": "食費"}` | 201 |
| PUT | `/api/categories/{id}` | カテゴリー名の変更 `{"name": "外食"}` | 200 |
| DELETE | `/api/categories/{id}` | カテゴリー削除 | 204 |
| GET | `/api/expenses?from=&to=&category_id=1,2` | 支出一覧（新しい順・絞り込み可） | 200 |
| GET | `/api/expenses/{id}` | 支出の詳細 | 200 |
| POST | `/api/expenses` | 支出の追加 | 201 |
| PUT | `/api/expenses/{id}` | 支出の更新 | 200 |
| DELETE | `/api/expenses/{id}` | 支出の削除 | 204 |
| GET | `/api/summary?from=&to=` | 期間の合計・件数・カテゴリー別の合計 | 200 |
| GET | `/api/summary/monthly?from=2026-05&months=6` | 月ごとの合計（支出がない月は0） | 200 |

支出の追加・更新のリクエスト例:

```json
{ "category_id": 1, "amount": 1200, "date": "2026-10-14", "memo": "スーパー" }
```

### エラー

エラーのときは `{"error": "メッセージ"}` の形で返します。

| ステータス | どんなとき |
|-----------|-----------|
| 400 | 入力が正しくない（必須項目がない、金額が1未満、日付の形が違う、存在しないカテゴリーID、メールの形が違う、パスワードが8文字未満など） |
| 401 | ログインしていない・トークンが正しくない／ログインのメールアドレスかパスワードが違う |
| 404 | 指定したIDのデータがない（他の会員の支出も含む） |
| 409 | 同じメールアドレスが登録済み／同じ名前のカテゴリーがある／支出で使われているカテゴリーを削除しようとした |
| 500 | サーバーやデータベースのエラー |

### curl での確認例

```
curl -X POST -H "Content-Type: application/json" -d "{\"email\":\"taro@example.com\",\"password\":\"password123\"}" http://localhost:8080/api/register
curl -X POST -H "Content-Type: application/json" -d "{\"email\":\"taro@example.com\",\"password\":\"password123\"}" http://localhost:8080/api/login
（返ってきた token を下の <token> に入れる）
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/categories
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d "{\"category_id\":1,\"amount\":1200,\"date\":\"2026-10-14\"}" http://localhost:8080/api/expenses
```
