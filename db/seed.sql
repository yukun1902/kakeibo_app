-- 最初に入れておくデータ（カテゴリー・確認用アカウント・サンプルの支出）
-- schema.sql → add_users.sql の後に実行する
-- 実行方法: psql -U postgres -d kakeibo_app -f db/seed.sql
--
-- 何度実行しても、同じデータが重なって入らないようにしてある。

-- 日本語を正しく読み込むため、このファイルの文字コード（UTF-8）を伝える
SET client_encoding = 'UTF8';

-- ------------------------------------------------------------
-- カテゴリー（まだ無いものだけ追加する）
-- ------------------------------------------------------------
INSERT INTO categories (name)
SELECT v.name
FROM (VALUES
    (1, '食費'), (2, '住居'), (3, '交通費'), (4, '娯楽'),
    (5, '日用品'), (6, '美容・健康'), (7, '交際費'), (8, 'その他')
) AS v(ord, name)
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = v.name)
ORDER BY v.ord;

-- ------------------------------------------------------------
-- 確認用アカウント
--   メールアドレス: demo@example.com
--   パスワード    : password123
-- password_hash は「password123」を bcrypt でハッシュ化したもの（パスワードそのものは保存しない）
-- ------------------------------------------------------------
INSERT INTO users (email, password_hash)
VALUES ('demo@example.com', '$2a$10$wFpkRwgFF13p7TnKhbBTU.Lcl6NPS7Y3cGAcCmo09waY8BSLBJ/ae')
ON CONFLICT (email) DO NOTHING;

-- ------------------------------------------------------------
-- 確認用アカウントのサンプルの支出（直近2か月半ぶん）
-- 日付は「今日から何日前か」で入れているので、いつ実行しても最近の支出になる
-- 確認用アカウントの支出が1件も無いときだけ追加する
-- ------------------------------------------------------------
INSERT INTO expenses (user_id, category_id, amount, date, memo)
SELECT u.id, c.id, v.amount, CURRENT_DATE - v.days_ago, v.memo
FROM (VALUES
    ('食費',       1200,  0, 'スーパー'),
    ('食費',        680,  1, 'カフェ'),
    ('交通費',      380,  2, '電車'),
    ('日用品',      980,  4, 'ドラッグストア'),
    ('娯楽',       1800,  6, '映画'),
    ('食費',       2400,  8, 'ランチ'),
    ('交際費',     4500, 12, '飲み会'),
    ('住居',      58000, 15, '家賃'),
    ('食費',       3200, 20, 'スーパー'),
    ('美容・健康', 3500, 25, '美容院'),
    ('食費',       2800, 40, 'スーパー'),
    ('住居',      58000, 45, '家賃'),
    ('交通費',     1000, 50, 'ICカードチャージ'),
    ('娯楽',       2500, 55, '本'),
    ('食費',       3000, 70, 'スーパー'),
    ('住居',      58000, 75, '家賃')
) AS v(category, amount, days_ago, memo)
JOIN categories c ON c.name = v.category
JOIN users u ON u.email = 'demo@example.com'
WHERE NOT EXISTS (SELECT 1 FROM expenses e WHERE e.user_id = u.id);
