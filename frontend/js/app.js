'use strict';
/**
 * 画面（ビュー）とルーティング
 * URLの # 以降で画面を切り替えるシングルページアプリです。
 *   #/home            ① ホーム
 *   #/add             ② 支出の追加（カテゴリー選択）
 *   #/add/input       ③ 支出の追加（入力）
 *   #/list            ④ 支出一覧
 *   #/graph           ⑤ グラフ・分析
 *   #/calendar        ⑥ カレンダー
 *   #/categories      ⑦ カテゴリー管理
 *   #/expenses/{id}/edit  ⑧ 支出の編集
 *   #/expenses/{id}   ⑨ 支出の詳細
 *   #/filter          ⑩ 期間フィルター
 *   #/menu            ⑪ メニュー（その他）
 */
(() => {
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');

  // ===== ユーティリティ =====
  const pad = n => String(n).padStart(2, '0');
  const toYmd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => toYmd(new Date());
  const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const ymKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const isThisMonth = d => ymKey(d) === ymKey(new Date());
  const monthRange = d => ({
    from: toYmd(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  });

  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const yen = n => '¥' + Math.abs(n).toLocaleString('ja-JP');
  const compactYen = n => n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : n.toLocaleString('ja-JP');
  const monthLabel = d => `${d.getFullYear()}年${d.getMonth() + 1}月`;
  const fmtDateJP = s => { const d = parseYmd(s); return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`; };
  const fmtSlash = s => s.replaceAll('-', '/');
  const fmtDateTime = iso => {
    const d = new Date(iso);
    return `${toYmd(d).replaceAll('-', '/')} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sum = list => list.reduce((acc, e) => acc + e.amount, 0);

  const UNKNOWN_CAT = { id: 0, name: '不明' };
  const getCatMap = async () => new Map((await Api.listCategories()).map(c => [c.id, c]));

  const go = (hash, { replace = false } = {}) => replace ? location.replace(hash) : (location.hash = hash);

  // ===== カテゴリーの見た目 =====
  // DBにはカテゴリー名しか保存しないので、アイコンと色は画面側で決める。
  // 最初から用意しているカテゴリーは名前で、それ以外はIDから色を選び、名前の1文字目をアイコンにする。
  const CATEGORY_STYLES = {
    '食費': ['🍴', '#ef5350'],
    '住居': ['🏠', '#3b82f6'],
    '交通費': ['🚃', '#f59e0b'],
    '娯楽': ['🎮', '#8b5cf6'],
    '日用品': ['🛒', '#0ea5e9'],
    '美容・健康': ['🧴', '#ec4899'],
    '交際費': ['👥', '#f97316'],
    'その他': ['💬', '#64748b'],
  };
  const PALETTE = ['#0d9488', '#eab308', '#6366f1', '#16a34a', '#db2777', '#0284c7', '#ea580c', '#7c3aed'];
  function styleOf(c) {
    const s = CATEGORY_STYLES[c.name];
    if (s) return { icon: s[0], color: s[1], letter: false };
    return { icon: esc([...(c.name || '?')][0]), color: PALETTE[(c.id || 0) % PALETTE.length], letter: true };
  }

  // ===== 画面をまたいで保持する状態 =====
  const state = {
    month: startOfMonth(new Date()), // ホーム・一覧・グラフ・カレンダーで共通の表示月
    graphMode: 'month',
    calSelected: today(),
    filter: null, // { period, from, to, categoryIds }
  };

  // ===== アイコン（SVG） =====
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    yen: '<path d="m6 3 6 8 6-8M12 11v10M7 13h10M7 17h10"/>',
    memo: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };
  const ic = (name, cls = '') =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  function catIcon(c, cls = '') {
    const s = styleOf(c);
    return `<span class="cat-icon ${cls} ${s.letter ? 'letter' : ''}" style="--c:${s.color}">${s.icon}</span>`;
  }

  // ===== 共通パーツ =====
  function topbar({ title, back, right = '' }) {
    let left = '<span class="icon-btn-space"></span>';
    if (back === 'history') left = `<button class="icon-btn" data-action="history-back" aria-label="戻る">${ic('back')}</button>`;
    else if (back) left = `<a class="icon-btn" href="${back}" aria-label="戻る">${ic('back')}</a>`;
    return `<header class="topbar">${left}<h1>${esc(title)}</h1>${right || '<span class="icon-btn-space"></span>'}</header>`;
  }

  function monthNav(label = monthLabel(state.month), prev = 'prev-month', next = 'next-month') {
    return `<div class="month-nav">
      <button class="icon-btn sm" data-action="${prev}" aria-label="前へ">${ic('back')}</button>
      <span>${label}</span>
      <button class="icon-btn sm" data-action="${next}" aria-label="次へ">${ic('next')}</button>
    </div>`;
  }

  function tabbar(active) {
    const item = (key, icon, label) =>
      `<a class="tab ${active === key ? 'active' : ''}" href="#/${key}">${ic(icon)}<span>${label}</span></a>`;
    return `<nav class="tabbar" aria-label="メインメニュー">
      ${item('home', 'home', 'ホーム')}
      ${item('list', 'list', '一覧')}
      <a class="fab" href="#/add" aria-label="支出を追加">${ic('plus')}</a>
      ${item('graph', 'chart', 'グラフ')}
      ${item('calendar', 'calendar', 'カレンダー')}
    </nav>`;
  }

  function segmented(items, current, action) {
    return `<div class="segmented" role="tablist">${items.map(([value, label]) =>
      `<button role="tab" aria-selected="${value === current}" class="${value === current ? 'active' : ''}" data-action="${action}" data-value="${value}">${label}</button>`
    ).join('')}</div>`;
  }

  // summary.by_category から円グラフを描く
  function donut(items, total, label) {
    let acc = 0;
    const stops = items.map(it => {
      const start = acc / total * 360;
      acc += it.amount;
      return `${styleOf({ id: it.category_id, name: it.name }).color} ${start}deg ${acc / total * 360}deg`;
    });
    const bg = total ? `conic-gradient(${stops.join(',')})` : 'var(--track)';
    return `<div class="donut" style="background:${bg}">
      <div class="donut-hole"><b>${yen(total)}</b><small>${label}</small></div>
    </div>`;
  }

  function breakdown(items, total) {
    if (!items.length) return '<p class="empty">この期間の支出はまだありません</p>';
    return `<ul class="breakdown">${items.map(it => {
      const c = { id: it.category_id, name: it.name };
      const { color } = styleOf(c);
      return `
      <li>
        ${catIcon(c, 'xs')}
        <span class="name">${esc(it.name)}</span>
        <span class="pct">${Math.round(it.amount / total * 100)}%</span>
        <span class="amt">${yen(it.amount)}</span>
        <span class="meter"><i style="width:${it.amount / total * 100}%;background:${color}"></i></span>
      </li>`;
    }).join('')}</ul>`;
  }

  function expenseRow(e, cats) {
    const c = cats.get(e.category_id) || UNKNOWN_CAT;
    return `<a class="tx" href="#/expenses/${e.id}">
      ${catIcon(c)}
      <span class="tx-main"><b>${esc(e.memo || c.name)}</b><small>${esc(c.name)}</small></span>
      <span class="amt">${yen(e.amount)}</span>
      ${ic('next', 'chev')}
    </a>`;
  }

  const notFound = (msg = 'データが見つかりませんでした') => ({
    header: topbar({ title: '見つかりません', back: '#/home' }),
    body: `<p class="empty">${esc(msg)}</p><a class="btn soft block" href="#/home">ホームに戻る</a>`,
  });

  // ===== トースト・シート（モーダル） =====
  let toastTimer;
  function toast(msg, kind = '') {
    $toast.textContent = msg;
    $toast.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.className = 'toast'; }, 2200);
  }

  function openSheet(html, { center = false, onMount, onClose } = {}) {
    const el = document.createElement('div');
    el.className = `sheet-backdrop${center ? ' center' : ''}`;
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.add('closing');
      setTimeout(() => el.remove(), 180);
      onClose?.();
    };
    el._close = close;
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-close]')) close();
    });
    onMount?.(el, close);
    return close;
  }

  const closeAllSheets = () => document.querySelectorAll('.sheet-backdrop').forEach(el => el.remove());

  function confirmDialog(message, okLabel = '削除する') {
    return new Promise(resolve => {
      let ok = false;
      openSheet(`
        <p class="dialog-msg">${esc(message)}</p>
        <div class="btn-row">
          <button class="btn ghost" data-close>キャンセル</button>
          <button class="btn danger" data-ok>${okLabel}</button>
        </div>`, {
        center: true,
        onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { ok = true; close(); }),
        onClose: () => resolve(ok),
      });
    });
  }

  function categoryTiles(cats, { currentId, hrefOf } = {}) {
    return `<div class="cat-grid">${cats.map(c => {
      const s = styleOf(c);
      const inner = `<span class="emoji ${s.letter ? 'letter' : ''}">${s.icon}</span><span class="tile-name">${esc(c.name)}</span>`;
      return hrefOf
        ? `<a class="cat-tile" style="--c:${s.color}" href="${hrefOf(c)}">${inner}</a>`
        : `<button type="button" class="cat-tile ${c.id === currentId ? 'on' : ''}" style="--c:${s.color}" data-id="${c.id}">${inner}</button>`;
    }).join('')}</div>`;
  }

  function pickCategory(cats, currentId, onPick) {
    openSheet(`
      <div class="sheet-head"><h2>カテゴリーを選ぶ</h2><button class="icon-btn" data-close aria-label="閉じる">${ic('close')}</button></div>
      ${categoryTiles(cats, { currentId })}`, {
      onMount: (el, close) => el.addEventListener('click', e => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        onPick(cats.find(c => c.id === Number(b.dataset.id)));
        close();
      }),
    });
  }

  function categorySheet(cat = {}) {
    const isNew = !cat.id;
    openSheet(`
      <form class="form" id="catForm" novalidate>
        <div class="sheet-head">
          <h2>${isNew ? 'カテゴリーを追加' : 'カテゴリーを編集'}</h2>
          <button type="button" class="icon-btn" data-close aria-label="閉じる">${ic('close')}</button>
        </div>
        <div class="cat-preview">${catIcon({ id: cat.id, name: cat.name || '？' }, 'xl')}</div>
        <label class="field">
          <span class="field-label">カテゴリー名</span>
          <input class="input" name="name" maxlength="30" value="${esc(cat.name || '')}" placeholder="例：カフェ" autocomplete="off">
        </label>
        <p class="hint">アイコンと色は名前に合わせて自動で決まります。</p>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary block">${isNew ? '追加する' : '保存する'}</button>
      </form>`, {
      onMount: (el, close) => {
        const form = el.querySelector('#catForm');
        const nameInput = form.elements.name;
        const err = form.querySelector('.form-error');
        nameInput.addEventListener('input', () => {
          el.querySelector('.cat-preview').innerHTML = catIcon({ id: cat.id, name: nameInput.value.trim() || '？' }, 'xl');
        });
        form.addEventListener('submit', async e => {
          e.preventDefault();
          try {
            if (isNew) await Api.createCategory({ name: nameInput.value });
            else await Api.updateCategory(cat.id, { name: nameInput.value });
            close();
            toast(isNew ? '追加しました' : '保存しました');
            render();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
          }
        });
      },
    });
  }

  // ===== 支出フォーム（③追加・⑧編集で共通） =====
  function expenseForm(v, { changeHref, edit = false }) {
    return `<form class="form" id="expenseForm" novalidate>
      <div class="cat-picked">
        <span class="cat-slot">${catIcon(v.cat)}<b>${esc(v.cat.name)}</b></span>
        ${changeHref
          ? `<a class="link" href="${changeHref}">変更</a>`
          : '<button type="button" class="link" data-action="change-cat">変更</button>'}
      </div>
      <label class="field">
        <span class="field-label">${ic('calendar')}日付</span>
        <input class="input" type="date" name="date" value="${v.date}">
      </label>
      <label class="field">
        <span class="field-label">${ic('yen')}金額</span>
        <span class="input-wrap">
          <input class="input amount" name="amount" inputmode="numeric" autocomplete="off" placeholder="0"
            value="${v.amount ? Number(v.amount).toLocaleString('ja-JP') : ''}">
          <span class="suffix">円</span>
        </span>
      </label>
      <label class="field">
        <span class="field-label">${ic('memo')}メモ（任意）</span>
        <input class="input" name="memo" maxlength="100" placeholder="例：スーパーで買い物" value="${esc(v.memo)}" autocomplete="off">
      </label>
      <p class="form-error" role="alert" hidden></p>
      ${edit
        ? `<div class="btn-row">
             <button type="button" class="btn danger" data-action="delete-expense">削除する</button>
             <button class="btn primary">更新する</button>
           </div>`
        : '<button class="btn primary block">保存する</button>'}
    </form>`;
  }

  function bindExpenseForm(onSubmit) {
    const form = $app.querySelector('#expenseForm');
    const amount = form.elements.amount;
    const err = form.querySelector('.form-error');
    // 入力中に 1,200 のようにカンマ区切りで表示する（全角数字も受け付ける）
    amount.addEventListener('input', () => {
      const digits = amount.value
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
      amount.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = {
        date: form.elements.date.value,
        amount: Number(amount.value.replace(/,/g, '')),
        memo: form.elements.memo.value.trim(),
      };
      const msg = !data.date ? '日付を入力してください' : !(data.amount > 0) ? '金額を入力してください' : '';
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      try {
        await onSubmit(data);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  // ===== ① ホーム =====
  async function viewHome() {
    const range = monthRange(state.month);
    const [s, prev, list, cats] = await Promise.all([
      Api.getSummary(range),
      Api.getSummary(monthRange(addMonths(state.month, -1))),
      Api.listExpenses(range),
      getCatMap(),
    ]);
    const lbl = isThisMonth(state.month) ? '今月' : `${state.month.getMonth() + 1}月`;
    const diff = s.total - prev.total;
    return {
      nav: 'home',
      header: `<header class="topbar">
        <span class="icon-btn-space"></span>
        <div class="brand">${ic('leaf')}<span>おかねノート</span></div>
        <a class="icon-btn" href="#/menu" aria-label="その他のメニュー">${ic('settings')}</a>
      </header>`,
      body: `
        ${monthNav()}
        <div class="stats">
          <div class="stat total"><span class="stat-ico">🛒</span><span class="stat-label">${lbl}の支出</span><b>${yen(s.total)}</b></div>
          <div class="stat diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">
            <span class="stat-ico">${diff > 0 ? '📈' : '📉'}</span><span class="stat-label">前月との差</span>
            <b>${diff > 0 ? '+' : diff < 0 ? '-' : '±'}${yen(diff)}</b>
          </div>
        </div>
        <section class="card">
          <h2 class="sec-title">${lbl}の支出の割合</h2>
          ${donut(s.by_category, s.total, `${lbl}の支出`)}
          ${breakdown(s.by_category, s.total)}
        </section>
        <section class="card">
          <div class="sec-head"><h2 class="sec-title">最近の支出</h2><a class="link" href="#/list">すべて見る</a></div>
          ${list.length
            ? `<div class="tx-list">${list.slice(0, 4).map(e => expenseRow(e, cats)).join('')}</div>`
            : '<p class="empty">まだ記録がありません。＋ボタンから追加しましょう</p>'}
        </section>`,
    };
  }

  // ===== ② 支出の追加（カテゴリー選択） =====
  async function viewAddSelect(q) {
    const date = q.get('date');
    const cats = await Api.listCategories();
    const dateParam = date ? `&date=${date}` : '';
    return {
      header: topbar({ title: '支出の追加', back: 'history' }),
      body: `
        <h2 class="sec-title">カテゴリーを選ぶ</h2>
        ${categoryTiles(cats, { hrefOf: c => `#/add/input?cat=${c.id}${dateParam}` })}
        <a class="link center" href="#/categories">カテゴリーを編集する</a>`,
    };
  }

  // ===== ③ 支出の追加（入力） =====
  async function viewAddInput(q) {
    const rawDate = q.get('date');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate || '') ? rawDate : today();
    const cat = (await Api.listCategories()).find(c => c.id === Number(q.get('cat')));
    if (!cat) { go('#/add', { replace: true }); return null; }
    const selectHref = `#/add${rawDate ? `?date=${date}` : ''}`;
    return {
      header: topbar({ title: '支出の追加', back: selectHref }),
      body: expenseForm({ cat, date, amount: '', memo: '' }, { changeHref: selectHref }),
      mount() {
        bindExpenseForm(async data => {
          await Api.createExpense({ ...data, category_id: cat.id });
          state.month = startOfMonth(parseYmd(data.date));
          toast('保存しました');
          go('#/list', { replace: true });
        });
      },
    };
  }

  // ===== ④ 支出一覧 =====
  function periodLabel(f) {
    return { thisMonth: '今月', lastMonth: '先月', thisYear: '今年' }[f.period]
      || `${fmtSlash(f.from)}〜${fmtSlash(f.to)}`;
  }

  function filterToParams(f) {
    const now = new Date();
    let r;
    if (f.period === 'thisMonth') r = monthRange(now);
    else if (f.period === 'lastMonth') r = monthRange(addMonths(now, -1));
    else if (f.period === 'thisYear') r = { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    else r = { from: f.from, to: f.to };
    return { ...r, categoryIds: f.categoryIds };
  }

  async function viewList() {
    const f = state.filter;
    const params = f ? filterToParams(f) : monthRange(state.month);
    const [list, cats] = await Promise.all([Api.listExpenses(params), getCatMap()]);

    const groups = new Map();
    for (const e of list) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }

    const filterBar = f ? `<div class="filter-chip">
        ${ic('filter')}
        <span>${periodLabel(f)}・${f.categoryIds.length ? `${f.categoryIds.length}カテゴリー` : 'すべてのカテゴリー'}</span>
        <button data-action="clear-filter">解除</button>
      </div>` : monthNav();

    return {
      nav: 'list',
      header: topbar({
        title: '支出一覧', back: '#/home',
        right: `<a class="icon-btn ${f ? 'badge' : ''}" href="#/filter" aria-label="絞り込み">${ic('filter')}</a>`,
      }),
      body: `
        ${filterBar}
        <div class="list-sum card">
          <span>${list.length}件</span>
          <span>合計 <b class="amt">${yen(sum(list))}</b></span>
        </div>
        ${groups.size ? [...groups].map(([date, items]) => `
          <section class="day-group">
            <h3><span>${fmtDateJP(date)}</span><span>${yen(sum(items))}</span></h3>
            <div class="tx-list">${items.map(e => expenseRow(e, cats)).join('')}</div>
          </section>`).join('') : '<p class="empty">該当する支出はありません</p>'}`,
      actions: {
        'clear-filter': () => { state.filter = null; render(); },
      },
    };
  }

  // ===== ⑤ グラフ・分析 =====
  async function viewGraph() {
    const yearMode = state.graphMode === 'year';
    const m = state.month;
    const y = m.getFullYear();
    const range = yearMode ? { from: `${y}-01-01`, to: `${y}-12-31` } : monthRange(m);
    const [s, series] = await Promise.all([
      Api.getSummary(range),
      Api.getMonthlyTotals({ from: yearMode ? `${y}-01` : ymKey(addMonths(m, -5)), months: yearMode ? 12 : 6 }),
    ]);
    const max = Math.max(1, ...series.map(x => x.total));
    const current = ymKey(m);
    const bars = series.map(x => `
      <div class="bar ${x.month === current ? 'current' : ''}" title="${x.month.replace('-', '年')}月 ${yen(x.total)}">
        <span class="bar-val">${x.total ? compactYen(x.total) : ''}</span>
        <span class="bar-track"><span class="bar-fill" style="height:${x.total / max * 100}%"></span></span>
        <span class="bar-label">${Number(x.month.slice(5))}月</span>
      </div>`).join('');
    const top = s.by_category[0];

    return {
      nav: 'graph',
      header: topbar({ title: 'グラフ', back: '#/home' }),
      body: `
        ${segmented([['month', '月'], ['year', '年']], state.graphMode, 'graph-mode')}
        ${yearMode ? monthNav(`${y}年`, 'prev-year', 'next-year') : monthNav()}
        <section class="card">
          <h2 class="sec-title">支出の割合</h2>
          ${donut(s.by_category, s.total, yearMode ? `${y}年の支出` : `${m.getMonth() + 1}月の支出`)}
          ${breakdown(s.by_category, s.total)}
        </section>
        <section class="card">
          <h2 class="sec-title">月ごとの支出</h2>
          <div class="bars ${yearMode ? 'dense' : ''}">${bars}</div>
        </section>
        <section class="card">
          <h2 class="sec-title">支出のまとめ</h2>
          <ul class="sum-rows">
            <li><span>合計</span><b>${yen(s.total)}</b></li>
            <li><span>件数</span><b>${s.count}件</b></li>
            <li><span>いちばん多いカテゴリー</span><b>${top ? esc(top.name) : '—'}</b></li>
          </ul>
        </section>`,
      actions: {
        'graph-mode': ({ value }) => { state.graphMode = value; render(); },
      },
    };
  }

  // ===== ⑥ カレンダー =====
  async function viewCalendar() {
    const m = state.month;
    const range = monthRange(m);
    const [list, cats] = await Promise.all([Api.listExpenses(range), getCatMap()]);
    if (!state.calSelected.startsWith(ymKey(m))) state.calSelected = isThisMonth(m) ? today() : range.from;

    const byDay = new Map();
    for (const e of list) byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount);

    const y = m.getFullYear();
    const mo = m.getMonth();
    const firstDow = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    const prevDays = new Date(y, mo, 0).getDate();
    const todayStr = today();
    const cells = [];
    for (let i = 0; i < firstDow; i++) {
      cells.push(`<span class="cal-day other"><span class="num">${prevDays - firstDow + 1 + i}</span><span class="cal-amt"></span></span>`);
    }
    for (let d = 1; d <= days; d++) {
      const key = `${ymKey(m)}-${pad(d)}`;
      const dow = (firstDow + d - 1) % 7;
      const amount = byDay.get(key);
      const cls = [dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', key === todayStr ? 'today' : '', key === state.calSelected ? 'selected' : ''].join(' ');
      cells.push(`<button class="cal-day ${cls}" data-action="cal-day" data-value="${key}" aria-label="${mo + 1}月${d}日${amount ? ` ${yen(amount)}` : ''}" aria-pressed="${key === state.calSelected}">
        <span class="num">${d}</span>
        <span class="cal-amt">${amount ? compactYen(amount) : ''}</span>
      </button>`);
    }
    for (let i = 1; cells.length % 7; i++) {
      cells.push(`<span class="cal-day other"><span class="num">${i}</span><span class="cal-amt"></span></span>`);
    }

    const sel = parseYmd(state.calSelected);
    const dayList = list.filter(e => e.date === state.calSelected);

    return {
      nav: 'calendar',
      header: topbar({ title: 'カレンダー', back: '#/home' }),
      body: `
        ${monthNav()}
        <div class="card cal">
          <div class="cal-head">${WEEK.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
          <div class="cal-grid">${cells.join('')}</div>
          <div class="cal-total">${m.getMonth() + 1}月の合計 <b>${yen(sum(list))}</b></div>
        </div>
        <section class="card">
          <div class="sec-head">
            <h2 class="sec-title">${sel.getMonth() + 1}月${sel.getDate()}日の支出</h2>
            ${dayList.length ? `<b class="amt">${yen(sum(dayList))}</b>` : ''}
          </div>
          ${dayList.length
            ? `<div class="tx-list">${dayList.map(e => expenseRow(e, cats)).join('')}</div>`
            : '<p class="empty">この日の記録はありません</p>'}
          <a class="btn soft block" href="#/add?date=${state.calSelected}">${ic('plus')}この日の支出を追加</a>
        </section>`,
      actions: {
        'cal-day': ({ value }) => { state.calSelected = value; render(); },
      },
    };
  }

  // ===== ⑦ カテゴリー管理 =====
  async function viewCategories() {
    const cats = await Api.listCategories();
    return {
      header: topbar({ title: 'カテゴリー管理', back: 'history' }),
      body: `
        <ul class="cat-list card flush">${cats.map(c => `
          <li>
            ${catIcon(c, 'sm')}
            <span class="name">${esc(c.name)}</span>
            <button class="icon-btn sm" data-action="edit-cat" data-id="${c.id}" aria-label="${esc(c.name)}を編集">${ic('pencil')}</button>
            <button class="icon-btn sm danger" data-action="del-cat" data-id="${c.id}" aria-label="${esc(c.name)}を削除">${ic('trash')}</button>
          </li>`).join('') || '<li class="empty">カテゴリーがありません</li>'}
        </ul>
        <button class="btn primary block" data-action="add-cat">${ic('plus')}カテゴリーを追加</button>`,
      actions: {
        'add-cat': () => categorySheet(),
        'edit-cat': ({ id }) => categorySheet(cats.find(c => c.id === Number(id))),
        'del-cat': async ({ id }) => {
          const c = cats.find(x => x.id === Number(id));
          if (!await confirmDialog(`「${c.name}」を削除しますか？`)) return;
          try {
            await Api.deleteCategory(c.id);
            toast('削除しました');
            render();
          } catch (ex) {
            toast(ex.message, 'error');
          }
        },
      },
    };
  }

  // ===== ⑧ 支出の編集 =====
  async function viewEdit(id) {
    const e = await Api.getExpense(Number(id)).catch(() => null);
    if (!e) return notFound();
    const cats = await Api.listCategories();
    let cat = cats.find(c => c.id === e.category_id) || cats[0];
    return {
      header: topbar({ title: '支出の編集', back: `#/expenses/${e.id}` }),
      body: expenseForm({ ...e, cat }, { edit: true }),
      mount() {
        bindExpenseForm(async data => {
          await Api.updateExpense(e.id, { ...data, category_id: cat.id });
          toast('更新しました');
          go(`#/expenses/${e.id}`, { replace: true });
        });
      },
      actions: {
        'change-cat': () => pickCategory(cats, cat.id, c => {
          cat = c;
          $app.querySelector('.cat-slot').innerHTML = `${catIcon(c)}<b>${esc(c.name)}</b>`;
        }),
        'delete-expense': async () => {
          if (!await confirmDialog('この支出を削除しますか？')) return;
          await Api.deleteExpense(e.id);
          toast('削除しました');
          go('#/list', { replace: true });
        },
      },
    };
  }

  // ===== ⑨ 支出の詳細 =====
  async function viewDetail(id) {
    const e = await Api.getExpense(Number(id)).catch(() => null);
    if (!e) return notFound();
    const c = (await getCatMap()).get(e.category_id) || UNKNOWN_CAT;
    const row = (icon, label, value) =>
      `<li class="detail-row">${ic(icon)}<div><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div></li>`;
    return {
      header: topbar({ title: '支出の詳細', back: 'history' }),
      body: `
        <div class="detail-hero">
          ${catIcon(c, 'xl')}
          <b>${esc(e.memo || c.name)}</b>
          <small>${esc(c.name)}</small>
        </div>
        <ul class="detail-list">
          ${row('calendar', '日付', `${e.date.slice(0, 4)}年${fmtDateJP(e.date)}`)}
          ${row('yen', '金額', `<span class="amt expense">${yen(e.amount)}</span>`)}
          ${row('memo', 'メモ', e.memo ? esc(e.memo) : '<span class="muted">なし</span>')}
          ${row('clock', '登録日時', fmtDateTime(e.created_at))}
        </ul>
        <a class="btn soft block" href="#/expenses/${e.id}/edit">${ic('pencil')}この内容を編集する</a>`,
    };
  }

  // ===== ⑩ 期間フィルター =====
  async function viewFilter() {
    const cats = await Api.listCategories();
    const f = state.filter || { period: 'thisMonth', from: monthRange(new Date()).from, to: today(), categoryIds: [] };
    const periods = [['thisMonth', '今月'], ['lastMonth', '先月'], ['thisYear', '今年'], ['custom', '期間指定']];

    return {
      header: topbar({
        title: '絞り込み', back: '#/list',
        right: `<a class="icon-btn" href="#/list" aria-label="閉じる">${ic('close')}</a>`,
      }),
      body: `
        <form class="form" id="filterForm" novalidate>
          <h2 class="sec-title">期間</h2>
          <div class="chip-group">${periods.map(([v, l]) => `
            <label class="chip"><input type="radio" name="period" value="${v}" ${f.period === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          </div>
          <div class="date-range" ${f.period === 'custom' ? '' : 'hidden'}>
            <input class="input" type="date" name="from" value="${f.from}" aria-label="開始日">
            <span>〜</span>
            <input class="input" type="date" name="to" value="${f.to}" aria-label="終了日">
          </div>
          <h2 class="sec-title">カテゴリー</h2>
          <div class="check-list">
            <label class="check-row">
              <span class="cat-icon sm all">${ic('grid')}</span><span class="name">すべて</span>
              <input type="checkbox" name="all" ${f.categoryIds.length ? '' : 'checked'}><span class="check"></span>
            </label>
            ${cats.map(c => `
            <label class="check-row">
              ${catIcon(c, 'sm')}<span class="name">${esc(c.name)}</span>
              <input type="checkbox" name="cat" value="${c.id}" ${f.categoryIds.includes(c.id) ? 'checked' : ''}><span class="check"></span>
            </label>`).join('')}
          </div>
          <p class="form-error" role="alert" hidden></p>
          <div class="sticky-actions">
            <button type="button" class="btn ghost" data-action="reset-filter">リセット</button>
            <button class="btn primary">この条件で表示する</button>
          </div>
        </form>`,
      mount() {
        const form = $app.querySelector('#filterForm');
        const els = form.elements;
        const catBoxes = [...form.querySelectorAll('[name=cat]')];
        form.addEventListener('change', e => {
          const name = e.target.name;
          if (name === 'period') form.querySelector('.date-range').hidden = els.period.value !== 'custom';
          if (name === 'all') {
            if (e.target.checked) catBoxes.forEach(c => { c.checked = false; });
            else if (!catBoxes.some(c => c.checked)) e.target.checked = true;
          }
          if (name === 'cat') els.all.checked = !catBoxes.some(c => c.checked);
        });
        form.addEventListener('submit', e => {
          e.preventDefault();
          const next = {
            period: els.period.value,
            from: els.from.value,
            to: els.to.value,
            categoryIds: catBoxes.filter(c => c.checked).map(c => Number(c.value)),
          };
          if (next.period === 'custom') {
            const err = form.querySelector('.form-error');
            const msg = !next.from || !next.to ? '開始日と終了日を入力してください'
              : next.from > next.to ? '開始日は終了日より前にしてください' : '';
            if (msg) { err.textContent = msg; err.hidden = false; return; }
          }
          state.filter = next;
          go('#/list');
        });
      },
      actions: {
        'reset-filter': () => { state.filter = null; render(); },
      },
    };
  }

  // ===== ⑪ メニュー（その他） =====
  const THEME_KEY = 'okane-note:theme';
  const THEMES = { light: 'ライト', dark: 'ダーク', system: '端末の設定に合わせる' };
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function setTheme(t) {
    try {
      if (t === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch (e) { /* 保存できなくても表示だけは切り替える */ }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  async function viewMenu() {
    const item = (icon, label, action, value = '', cls = '') => `
      <li><button class="menu-item ${cls}" data-action="${action}">
        ${ic(icon)}<span class="label">${label}</span>${value ? `<span class="value">${value}</span>` : ''}${ic('next', 'chev')}
      </button></li>`;
    return {
      nav: '',
      header: topbar({ title: 'その他', back: '#/home' }),
      body: `
        <ul class="menu card flush">
          <li><a class="menu-item" href="#/categories">${ic('tag')}<span class="label">カテゴリー管理</span>${ic('next', 'chev')}</a></li>
          ${item('download', 'データのバックアップ', 'backup')}
          ${item('upload', 'バックアップから復元', 'restore')}
          ${item('sun', 'テーマ設定', 'theme', THEMES[getTheme()])}
          ${item('help', '使い方ガイド', 'guide')}
          ${item('info', 'アプリについて', 'about')}
        </ul>
        <ul class="menu card flush">
          ${item('refresh', 'サンプルデータに戻す', 'reset', '', 'danger')}
        </ul>
        <input type="file" id="restoreFile" accept="application/json,.json" hidden>`,
      mount() {
        $app.querySelector('#restoreFile').addEventListener('change', async e => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (!await confirmDialog('今のデータを上書きして復元しますか？', '復元する')) return;
            await Api.importAll(data);
            toast('復元しました');
          } catch (ex) {
            toast(ex instanceof SyntaxError ? 'ファイルを読み込めませんでした' : ex.message, 'error');
          }
        });
      },
      actions: {
        backup: async () => {
          const data = await Api.exportAll();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `okane-note-${today().replaceAll('-', '')}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          toast('バックアップを保存しました');
        },
        restore: () => $app.querySelector('#restoreFile').click(),
        theme: () => {
          const current = getTheme();
          openSheet(`
            <div class="sheet-head"><h2>テーマ設定</h2><button class="icon-btn" data-close aria-label="閉じる">${ic('close')}</button></div>
            <ul class="menu card flush">${Object.entries(THEMES).map(([k, l]) => `
              <li><button class="menu-item" data-theme-opt="${k}">
                <span class="label">${l}</span>${k === current ? ic('check', 'on') : ''}
              </button></li>`).join('')}</ul>`, {
            onMount: (el, close) => el.addEventListener('click', e => {
              const b = e.target.closest('[data-theme-opt]');
              if (!b) return;
              setTheme(b.dataset.themeOpt);
              close();
              render();
            }),
          });
        },
        guide: () => openSheet(`
          <div class="sheet-head"><h2>使い方ガイド</h2><button class="icon-btn" data-close aria-label="閉じる">${ic('close')}</button></div>
          <ol class="prose">
            <li>下の <b>＋</b> ボタンを押して、カテゴリーをタップします。</li>
            <li>日付・金額・メモを入力して「保存する」を押します。</li>
            <li>「一覧」で記録を確認できます。タップすると詳細・編集・削除ができます。</li>
            <li>「グラフ」で支出の割合や月ごとの推移を確認できます。</li>
            <li>「カレンダー」で日ごとの支出を確認できます。</li>
            <li>一覧の右上のボタンから、期間やカテゴリーで絞り込めます。</li>
          </ol>`),
        about: () => openSheet(`
          <div class="sheet-head"><h2>アプリについて</h2><button class="icon-btn" data-close aria-label="閉じる">${ic('close')}</button></div>
          <div class="about">
            <span class="about-logo">${ic('leaf')}</span>
            <b>おかねノート</b>
            <small class="muted">バージョン 0.2.0（デザイン版）</small>
            <p class="prose">支出を記録する家計簿アプリです。いまはデータをこのブラウザの中にだけ保存しています。今後、Go で作る REST API とつないで PostgreSQL に保存できるようにする予定です。</p>
          </div>`),
        reset: async () => {
          if (!await confirmDialog('すべてのデータを消して、サンプルデータに戻しますか？', '戻す')) return;
          await Api.reset();
          state.filter = null;
          toast('サンプルデータに戻しました');
        },
      },
    };
  }

  // ===== ルーティング =====
  const routes = [
    [/^\/home$/, viewHome],
    [/^\/add$/, viewAddSelect],
    [/^\/add\/input$/, viewAddInput],
    [/^\/list$/, viewList],
    [/^\/graph$/, viewGraph],
    [/^\/calendar$/, viewCalendar],
    [/^\/categories$/, viewCategories],
    [/^\/expenses\/(\d+)$/, viewDetail],
    [/^\/expenses\/(\d+)\/edit$/, viewEdit],
    [/^\/filter$/, viewFilter],
    [/^\/menu$/, viewMenu],
  ];

  const globalActions = {
    'prev-month': () => { state.month = addMonths(state.month, -1); render(); },
    'next-month': () => { state.month = addMonths(state.month, 1); render(); },
    'prev-year': () => { state.month = addMonths(state.month, -12); render(); },
    'next-year': () => { state.month = addMonths(state.month, 12); render(); },
    'history-back': () => { if (history.length > 1) history.back(); else go('#/home'); },
  };

  let actions = {};
  let renderSeq = 0;
  let lastPath = '';

  async function render() {
    const seq = ++renderSeq;
    const hash = location.hash.replace(/^#/, '') || '/home';
    const [path, qs = ''] = hash.split('?');
    const route = routes.find(([re]) => re.test(path));
    if (!route) { go('#/home', { replace: true }); return; }

    let view;
    try {
      view = await route[1](...path.match(route[0]).slice(1), new URLSearchParams(qs));
    } catch (ex) {
      console.error(ex);
      view = notFound('読み込み中にエラーが発生しました');
    }
    if (seq !== renderSeq || view === null) return; // 途中で別の画面に移った／リダイレクトした

    closeAllSheets();
    const samePage = path === lastPath;
    const scroll = samePage ? $app.querySelector('.content')?.scrollTop || 0 : 0;
    actions = view.actions || {};
    $app.innerHTML = `${view.header}<main class="content">${view.body}</main>${view.nav !== undefined ? tabbar(view.nav) : ''}`;
    $app.querySelector('.content').scrollTop = scroll;
    lastPath = path;
    const title = $app.querySelector('.topbar h1')?.textContent;
    document.title = title ? `${title} | おかねノート` : 'おかねノート';
    view.mount?.();
  }

  $app.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action] || globalActions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(el.dataset, el);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const sheets = document.querySelectorAll('.sheet-backdrop:not(.closing)');
    sheets[sheets.length - 1]?._close();
  });

  // PCで開いたときの案内画面から、スマホの大きさでプレビューする
  document.getElementById('pcPreview').addEventListener('click', () => {
    try { sessionStorage.setItem('okane-note:pc-preview', '1'); } catch (e) { /* 保存できなくても今回は表示する */ }
    document.documentElement.classList.add('pc-preview');
  });

  window.addEventListener('hashchange', render);
  if (!location.hash) location.replace('#/home');
  render();
})();
