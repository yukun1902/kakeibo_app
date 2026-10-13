-- 家計簿アプリ（kakeibo_app）のテーブル定義
-- 実行方法:
--   psql -U postgres -c "CREATE DATABASE kakeibo_app;"
--   psql -U postgres -d kakeibo_app -f db/schema.sql

-- カテゴリー
CREATE TABLE categories (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

-- 支出
CREATE TABLE expenses (
    id          SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories (id),
    amount      INTEGER NOT NULL,
    date        DATE NOT NULL,
    memo        TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
