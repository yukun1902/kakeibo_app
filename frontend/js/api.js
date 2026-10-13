'use strict';
/**
 * データ層（APIの代わり）
 *
 * いまはブラウザの localStorage に保存しています。
 * Go で REST API を作ったら、各関数の中身を fetch() に置き換えるだけで
 * 画面側（app.js）はそのまま使えるようにしてあります。
 * 各関数の上のコメントが「対応させる予定のエンドポイント」です。
 *
 * データの形は PostgreSQL のテーブル（db/schema.sql）に合わせています。
 *   categories: { id, name }
 *   expenses:   { id, category_id, amount, date, memo, created_at }
 */
const Api = (() => {
  const KEY = 'okane-note:data:v2';

  const DEFAULT_CATEGORIES = ['食費', '住居', '交通費', '娯楽', '日用品', '美容・健康', '交際費', 'その他']
    .map((name, i) => ({ id: i + 1, name }));

  const pad = n => String(n).padStart(2, '0');
  const toYmd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clone = v => JSON.parse(JSON.stringify(v));

  // Go側で返す予定のHTTPステータスを持たせたエラー
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  // 動作確認用のサンプルデータ（直近7か月分）
  function seedExpenses() {
    let s = 20251024;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const between = (min, max) => Math.round((min + rnd() * (max - min)) / 10) * 10;

    const now = new Date();
    const list = [];
    const add = (date, categoryId, amount, memo) => {
      const created = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
        9 + Math.floor(rnd() * 12), Math.floor(rnd() * 60));
      list.push({
        id: list.length + 1, category_id: categoryId, amount,
        date: toYmd(date), memo, created_at: created.toISOString(),
      });
    };

    const patterns = [
      // [カテゴリーID, メモ候補, 最小, 最大, 月あたりの回数]
      [1, ['スーパー', 'コンビニ', 'ランチ', 'カフェ', 'パン屋'], 300, 3500, 14],
      [3, ['電車', 'バス', 'ICカードチャージ'], 200, 3000, 5],
      [4, ['映画', 'ゲーム', '本', 'カラオケ'], 800, 4000, 3],
      [5, ['ドラッグストア', '100円ショップ'], 300, 2500, 3],
      [6, ['美容院', 'ジム'], 2000, 5000, 1],
      [7, ['飲み会', 'プレゼント'], 2000, 6000, 1],
      [8, ['雑費', null], 300, 3000, 2],
    ];

    for (let m = 6; m >= 0; m--) {
      const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const last = m === 0 ? now.getDate() : days;
      const day = n => new Date(first.getFullYear(), first.getMonth(), n);

      if (last >= 1) add(day(1), 2, 58000, '家賃');
      if (last >= 27) add(day(27), 2, between(6000, 10000), '光熱費');

      for (const [cid, memos, min, max, times] of patterns) {
        for (let i = 0; i < times; i++) {
          const d = 1 + Math.floor(rnd() * days);
          if (d > last) continue;
          add(day(d), cid, between(min, max), memos[Math.floor(rnd() * memos.length)]);
        }
      }
    }
    return list;
  }

  function freshDb() {
    const expenses = seedExpenses();
    return {
      categories: clone(DEFAULT_CATEGORIES),
      expenses,
      nextId: { category: DEFAULT_CATEGORIES.length + 1, expense: expenses.length + 1 },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 読めなければ初期データで始める */ }
    return freshDb();
  }

  let db = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 保存できない環境ではメモリ上だけで動く */ }
  }

  const findCategory = id => db.categories.find(c => c.id === id);
  const findExpense = id => db.expenses.find(e => e.id === id);

  // Go側でも同じチェックをする想定
  function validateExpense(input) {
    const amount = Number(input.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 999999999) {
      throw new ApiError(400, '金額は1円以上の整数で入力してください');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new ApiError(400, '日付が正しくありません');
    const cat = findCategory(Number(input.category_id));
    if (!cat) throw new ApiError(400, 'カテゴリーが正しくありません');
    const memo = String(input.memo || '').trim();
    return { category_id: cat.id, amount, date: input.date, memo: memo || null };
  }

  function validateCategory(input, selfId) {
    const name = String(input.name || '').trim();
    if (!name) throw new ApiError(400, 'カテゴリー名を入力してください');
    if (name.length > 100) throw new ApiError(400, 'カテゴリー名は100文字以内で入力してください');
    if (db.categories.some(c => c.name === name && c.id !== selfId)) {
      throw new ApiError(409, '同じ名前のカテゴリーがすでにあります');
    }
    return { name };
  }

  function query({ from, to, categoryIds } = {}) {
    return db.expenses.filter(e =>
      (!from || e.date >= from) &&
      (!to || e.date <= to) &&
      (!categoryIds || !categoryIds.length || categoryIds.includes(e.category_id)));
  }

  const sortExpenses = (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || b.id - a.id;
  const total = list => list.reduce((acc, e) => acc + e.amount, 0);

  return {
    ApiError,

    // GET /categories
    async listCategories() {
      return clone([...db.categories].sort((a, b) => a.id - b.id));
    },

    // POST /categories
    async createCategory(input) {
      const c = { id: db.nextId.category++, ...validateCategory(input) };
      db.categories.push(c);
      save();
      return clone(c);
    },

    // PUT /categories/{id}
    async updateCategory(id, input) {
      const c = findCategory(id);
      if (!c) throw new ApiError(404, 'カテゴリーが見つかりません');
      Object.assign(c, validateCategory(input, id));
      save();
      return clone(c);
    },

    // DELETE /categories/{id}
    // 支出で使われているカテゴリーは外部キー制約で消せない → 409 を返す想定
    async deleteCategory(id) {
      if (!findCategory(id)) throw new ApiError(404, 'カテゴリーが見つかりません');
      if (db.expenses.some(e => e.category_id === id)) {
        throw new ApiError(409, 'このカテゴリーは支出で使われているため削除できません');
      }
      db.categories = db.categories.filter(c => c.id !== id);
      save();
    },

    // GET /expenses?from=2025-10-01&to=2025-10-31&category_id=1,2
    async listExpenses(params) {
      return clone(query(params).sort(sortExpenses));
    },

    // GET /expenses/{id}
    async getExpense(id) {
      const e = findExpense(id);
      if (!e) throw new ApiError(404, '支出が見つかりません');
      return clone(e);
    },

    // POST /expenses
    async createExpense(input) {
      const e = { id: db.nextId.expense++, ...validateExpense(input), created_at: new Date().toISOString() };
      db.expenses.push(e);
      save();
      return clone(e);
    },

    // PUT /expenses/{id}
    async updateExpense(id, input) {
      const e = findExpense(id);
      if (!e) throw new ApiError(404, '支出が見つかりません');
      Object.assign(e, validateExpense(input));
      save();
      return clone(e);
    },

    // DELETE /expenses/{id}
    async deleteExpense(id) {
      if (!findExpense(id)) throw new ApiError(404, '支出が見つかりません');
      db.expenses = db.expenses.filter(e => e.id !== id);
      save();
    },

    // GET /summary?from=2025-10-01&to=2025-10-31
    // → 期間の合計・件数と、カテゴリー別の合計（多い順）
    async getSummary({ from, to }) {
      const list = query({ from, to });
      const byCat = new Map();
      for (const e of list) byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + e.amount);
      const by_category = [...byCat].map(([category_id, amount]) => ({
        category_id, name: findCategory(category_id)?.name ?? '不明', amount,
      })).sort((a, b) => b.amount - a.amount);
      return { from, to, total: total(list), count: list.length, by_category };
    },

    // GET /summary/monthly?from=2025-05&months=6
    // → 月ごとの合計（棒グラフ用）
    async getMonthlyTotals({ from, months }) {
      const [y, m] = from.split('-').map(Number);
      const out = [];
      for (let i = 0; i < months; i++) {
        const d = new Date(y, m - 1 + i, 1);
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        out.push({ month: key, total: total(db.expenses.filter(e => e.date.startsWith(key))) });
      }
      return out;
    },

    // ---- 以下はバックアップ用（API化は任意） ----
    async exportAll() {
      return clone({
        version: 2, exported_at: new Date().toISOString(),
        categories: db.categories, expenses: db.expenses,
      });
    },

    async importAll(data) {
      if (!data || !Array.isArray(data.categories) || !Array.isArray(data.expenses)) {
        throw new ApiError(400, 'バックアップファイルの形式が正しくありません');
      }
      db = {
        categories: data.categories,
        expenses: data.expenses,
        nextId: {
          category: Math.max(0, ...data.categories.map(c => c.id)) + 1,
          expense: Math.max(0, ...data.expenses.map(e => e.id)) + 1,
        },
      };
      save();
    },

    async reset() {
      db = freshDb();
      save();
    },
  };
})();
