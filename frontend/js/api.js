'use strict';
/**
 * データ層：Go の REST API（../main.go）を呼び出す
 *
 * ログインすると JWT（ログインの証明書）を受け取り、このブラウザに保存する。
 * それ以降のリクエストには「Authorization: Bearer <JWT>」を付けて送る。
 *
 * データの形は PostgreSQL のテーブルと同じ:
 *   categories: { id, name }
 *   expenses:   { id, category_id, amount, date, memo, created_at }
 */
const Api = (() => {
  // API の送り先を決める
  //   ・Go のサーバー（http://localhost:8080）から画面を開いたとき → 同じ場所の /api
  //   ・それ以外（VS Code の Live Server〔ポート5500〕や、index.html をファイルとして直接開いたとき）
  //     → Go のサーバー（http://localhost:8080/api）に送る
  //   Live Server は画面のファイルを見せるだけで、API の処理はできないため。
  //   （どちらの場合も、Go のサーバーを go run . で起動しておく必要がある）
  const API_SERVER = 'http://localhost:8080';
  const servedByGo = location.port === '8080' && ['localhost', '127.0.0.1'].includes(location.hostname);
  const BASE = servedByGo ? '/api' : `${API_SERVER}/api`;
  const TOKEN_KEY = 'okane-note:token';

  // Go側から返ってくるエラー（status は HTTP ステータス。0 はサーバーにつながらなかったとき）
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* 保存できない環境では毎回ログインが必要 */ }

  function setToken(value) {
    token = value;
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 保存できなくてもこのページを開いている間は使える */ }
  }

  // ログインの期限切れなどで 401 が返ったときに呼ぶ処理（app.js が登録する）
  let unauthorizedHandler = null;

  // request は、API にお願いを1回送って、返事（JSON）を受け取る関数。すべての API 呼び出しがここを通る
  //   method … 'GET'（取得）/ 'POST'（追加）/ 'PUT'（更新）/ 'DELETE'（削除）
  //   path   … '/expenses' や '/expenses/3' など
  //   body   … 送るデータ（POST や PUT のとき）。JSON の文字に変換して送る
  //
  // 【fetch とは】
  //   ブラウザに最初からある「サーバーにリクエストを送る」機能。
  //   await fetch(...) で返事が来るまで待ち、await res.json() で返事の JSON を JavaScript のデータに戻す。
  async function request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, 'サーバーに接続できません。kakeibo_app フォルダで go run . を実行して、サーバーを起動してください');
    }

    if (res.status === 204) return null; // 削除成功など、中身なし
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // ログイン中なのに 401 → 期限切れ。保存しているトークンを捨ててログイン画面へ
      if (res.status === 401 && token) {
        setToken(null);
        unauthorizedHandler?.();
      }
      throw new ApiError(res.status, data?.error || `エラーが発生しました（${res.status}）`);
    }
    return data;
  }

  // { from: '2026-10-01', category_id: [1, 2] } → "?from=2026-10-01&category_id=1,2"
  function query(params) {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        if (value.length) p.set(key, value.join(','));
      } else {
        p.set(key, value);
      }
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  return {
    ApiError,

    // ---- 会員登録・ログイン ----
    isLoggedIn: () => !!token,
    onUnauthorized(fn) { unauthorizedHandler = fn; },

    // POST /api/register
    register: ({ email, password }) => request('POST', '/register', { email, password }),

    // POST /api/login（受け取った JWT を保存する）
    async login({ email, password }) {
      const data = await request('POST', '/login', { email, password });
      setToken(data.token);
      return data;
    },

    // JWT はサーバーに保存していないので、ブラウザから消せばログアウトになる
    logout() { setToken(null); },

    // GET /api/me
    me: () => request('GET', '/me'),

    // ---- カテゴリー ----
    // GET /api/categories
    listCategories: () => request('GET', '/categories'),
    // POST /api/categories
    createCategory: ({ name }) => request('POST', '/categories', { name }),
    // PUT /api/categories/{id}
    updateCategory: (id, { name }) => request('PUT', `/categories/${id}`, { name }),
    // DELETE /api/categories/{id}
    deleteCategory: id => request('DELETE', `/categories/${id}`),

    // ---- 支出 ----
    // GET /api/expenses?from=&to=&category_id=1,2
    listExpenses: ({ from, to, categoryIds } = {}) =>
      request('GET', '/expenses' + query({ from, to, category_id: categoryIds })),
    // GET /api/expenses/{id}
    getExpense: id => request('GET', `/expenses/${id}`),
    // POST /api/expenses
    createExpense: ({ category_id, amount, date, memo }) =>
      request('POST', '/expenses', { category_id, amount, date, memo }),
    // PUT /api/expenses/{id}
    updateExpense: (id, { category_id, amount, date, memo }) =>
      request('PUT', `/expenses/${id}`, { category_id, amount, date, memo }),
    // DELETE /api/expenses/{id}
    deleteExpense: id => request('DELETE', `/expenses/${id}`),

    // ---- 集計 ----
    // GET /api/summary?from=&to=
    getSummary: ({ from, to }) => request('GET', '/summary' + query({ from, to })),
    // GET /api/summary/monthly?from=2026-05&months=6
    getMonthlyTotals: ({ from, months }) => request('GET', '/summary/monthly' + query({ from, months })),
  };
})();
