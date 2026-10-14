-- 会員登録・ログイン機能の追加（schema.sql の後に実行する）
-- 実行方法: psql -U postgres -d kakeibo_app -f db/add_users.sql

-- 会員
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,  -- 小文字にそろえて保存する
    password_hash VARCHAR(255) NOT NULL,         -- bcrypt でハッシュ化したパスワード
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 支出を会員ごとに分けるため、誰の支出かを表す列を追加する
-- （NOT NULL なので、支出が0件のときに実行すること）
ALTER TABLE expenses
    ADD COLUMN user_id INTEGER NOT NULL REFERENCES users (id);
