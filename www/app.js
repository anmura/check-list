'use strict';

/* ---------- Capacitor plugins (absent in a plain browser) ---------- */
const Cap = window.Capacitor || null;
const Plugins = (Cap && Cap.Plugins) || {};
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const LN = isNative ? Plugins.LocalNotifications : null;
const Prefs = isNative ? Plugins.Preferences : null;
const AppPlugin = isNative ? Plugins.App : null;
const StatusBar = isNative ? Plugins.StatusBar : null;

const STORE_KEY = 'checklist.v1';
const CHANNEL_ID = 'reminders';

/* ---------- Icons ---------- */
const svg = (w, body, sw = 2) =>
  `<svg aria-hidden="true" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const I = {
  check: (w = 16, sw = 3) => svg(w, '<path d="M5 12.5l4.5 4.5L19 7.5"></path>', sw),
  back: () => svg(20, '<path d="M15 5l-7 7 7 7"></path>', 2.2),
  bell: (w = 22) => svg(w, '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"></path><path d="M10 20.5a2 2 0 0 0 4 0"></path>', 2.1),
  pencil: () => svg(21, '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"></path><path d="M13.5 6.5l4 4"></path>', 2.1),
  reset: () => svg(18, '<path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path>'),
  chev: () => svg(20, '<path d="M9 5l7 7-7 7"></path>'),
  plus: () => svg(20, '<path d="M12 5v14"></path><path d="M5 12h14"></path>', 2.4),
  up: () => svg(22, '<path d="M12 19V5"></path><path d="M5.5 11.5L12 5l6.5 6.5"></path>', 2.2),
  down: () => svg(22, '<path d="M12 5v14"></path><path d="M5.5 12.5L12 19l6.5-6.5"></path>', 2.2),
  order: () => svg(18, '<path d="M7 4v16"></path><path d="M3.5 7.5L7 4l3.5 3.5"></path><path d="M17 20V4"></path><path d="M13.5 16.5L17 20l3.5-3.5"></path>'),
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Data ---------- */
let data = { v: 1, nextNid: 1, lists: [] };

function defaultRemind() {
  return { on: false, many: false, at: '18:00', every: 2, from: '09:00', to: '21:00', days: 'all' };
}

function newList(name, text) {
  return {
    id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nid: data.nextNid++,
    name, text, done: {},
    remind: defaultRemind(),
  };
}

/** Items of a list text: [{gap:true} | {name}] with outer blank lines dropped. */
function parse(text) {
  const rows = [];
  for (const line of (text || '').split('\n')) {
    const name = line.trim();
    rows.push(name ? { name } : { gap: true });
  }
  while (rows.length && rows[0].gap) rows.shift();
  while (rows.length && rows[rows.length - 1].gap) rows.pop();
  return rows;
}

function stats(list) {
  const names = parse(list.text).filter((r) => !r.gap).map((r) => r.name);
  const left = names.filter((n) => !list.done[n]);
  return { total: names.length, done: names.length - left.length, left };
}

async function load() {
  let raw = null;
  try {
    if (Prefs) raw = (await Prefs.get({ key: STORE_KEY })).value;
  } catch (e) { /* fall back to localStorage */ }
  if (!raw) {
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* ignore */ }
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.lists)) data = parsed;
    } catch (e) { /* keep defaults */ }
  }
  for (const l of data.lists) l.remind = Object.assign(defaultRemind(), l.remind || {});
}

let saveTimer = null;
function save() {
  const raw = JSON.stringify(data);
  try { localStorage.setItem(STORE_KEY, raw); } catch (e) { /* ignore */ }
  if (Prefs) Prefs.set({ key: STORE_KEY, value: raw }).catch(() => {});
  clearTimeout(saveTimer);
  saveTimer = setTimeout(reschedule, 600);
}

const byId = (id) => data.lists.find((l) => l.id === id);

/* ---------- Reminders ---------- */
const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
const fmt = (m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');

function reminderTimes(r) {
  if (!r.many) return [toMin(r.at)];
  const from = toMin(r.from), to = toMin(r.to), step = r.every * 60;
  const out = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
}

// Capacitor weekday numbers: 1 = Sunday ... 7 = Saturday
const DAY_SETS = { all: null, weekdays: [2, 3, 4, 5, 6], weekends: [7, 1] };
const DAY_WORDS = { all: 'каждый день', weekdays: 'по будням', weekends: 'по выходным' };

function reminderSummary(r) {
  const times = reminderTimes(r);
  if (!times.length) return null;
  if (!r.many) return `Один раз ${DAY_WORDS[r.days]} в ${fmt(times[0])}.`;
  const n = times.length;
  const many = (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) ? 'раза' : 'раз';
  return `${n} ${many} ${DAY_WORDS[r.days]}: ${times.map(fmt).join(', ')}.`;
}

let scheduling = Promise.resolve();
function reschedule() {
  if (!LN) return Promise.resolve();
  scheduling = scheduling.then(doReschedule).catch((e) => console.warn('reschedule failed', e));
  return scheduling;
}

async function doReschedule() {
  const pending = await LN.getPending();
  if (pending && pending.notifications && pending.notifications.length) {
    await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
  const perm = await LN.checkPermissions();
  if (perm.display !== 'granted') return;

  const notifications = [];
  for (const list of data.lists) {
    const r = list.remind;
    if (!r.on) continue;
    const s = stats(list);
    if (!s.left.length) continue; // everything bought: stay quiet
    const title = `${list.name}: осталось ${s.left.length}`;
    const shown = s.left.slice(0, 4).join(', ');
    const body = s.left.length > 4 ? `${shown} и ещё ${s.left.length - 4}` : shown;
    const days = DAY_SETS[r.days];
    let k = 0;
    for (const m of reminderTimes(r)) {
      const hour = Math.floor(m / 60), minute = m % 60;
      for (const weekday of (days || [null])) {
        const on = weekday ? { weekday, hour, minute } : { hour, minute };
        notifications.push({
          id: list.nid * 128 + (k++ % 128),
          title, body,
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_list',
          iconColor: '#F5C518',
          extra: { listId: list.id },
          schedule: { on, allowWhileIdle: true },
        });
      }
    }
  }
  if (notifications.length) await LN.schedule({ notifications });
}

async function ensurePermission() {
  if (!LN) return 'unsupported';
  let p = await LN.checkPermissions();
  if (p.display !== 'granted') p = await LN.requestPermissions();
  return p.display;
}

/* ---------- UI state ---------- */
const ui = {
  screen: 'lists',  // lists | list | edit | new
  listId: null,
  ordering: false,
  sheet: false,
  confirmDelete: false,
  permError: false,
  draft: null,
};

const app = document.getElementById('app');

/* The screen the user was on is saved, so that after switching to another app
   (Android may close this one in the background) the same list opens again. */
const UI_KEY = 'checklist.ui';
let uiScroll = 0;
function saveUi() {
  if (ui.screen === 'edit' || ui.screen === 'new') {
    const ed = document.getElementById('text') ? readEditor() : null;
    if (ed) ui.draft = ed;
  }
  const raw = JSON.stringify({ screen: ui.screen, listId: ui.listId, draft: ui.draft, scroll: uiScroll });
  try { localStorage.setItem(UI_KEY, raw); } catch (e) { /* ignore */ }
  if (Prefs) Prefs.set({ key: UI_KEY, value: raw }).catch(() => {});
}
async function loadUi() {
  let raw = null;
  try { if (Prefs) raw = (await Prefs.get({ key: UI_KEY })).value; } catch (e) { /* ignore */ }
  if (!raw) { try { raw = localStorage.getItem(UI_KEY); } catch (e) { /* ignore */ } }
  if (!raw) return;
  try {
    const st = JSON.parse(raw);
    if (!['lists', 'list', 'edit', 'new'].includes(st.screen)) return;
    if ((st.screen === 'list' || st.screen === 'edit') && !byId(st.listId)) return;
    ui.screen = st.screen;
    ui.listId = st.listId || null;
    ui.draft = st.draft || null;
    uiScroll = st.scroll || 0;
  } catch (e) { /* start from the lists */ }
}
let uiTimer = null;
function saveUiSoon() { clearTimeout(uiTimer); uiTimer = setTimeout(saveUi, 300); }

function go(screen, listId) {
  ui.screen = screen;
  if (listId !== undefined) ui.listId = listId;
  ui.sheet = false;
  ui.confirmDelete = false;
  ui.ordering = false;
  ui.draft = null;
  uiScroll = 0;
  render();
  const body = app.querySelector('.body');
  if (body) body.scrollTop = 0;
  saveUi();
}

function render() {
  const list = byId(ui.listId);
  if ((ui.screen === 'list' || ui.screen === 'edit') && !list) ui.screen = 'lists';
  let html = '';
  if (ui.screen === 'lists') html = renderLists();
  else if (ui.screen === 'list') html = renderList(list);
  else if (ui.screen === 'edit') html = renderEdit(list);
  else if (ui.screen === 'new') html = renderNew();
  if (ui.sheet && list) html += renderSheet(list);
  app.innerHTML = html;
}

/* ---------- Screens ---------- */
function renderLists() {
  const n = data.lists.length;
  let body = '';
  if (!n) {
    body = `<div class="empty"><p>Здесь будут ваши списки: продукты, аптека, дела на даче.</p>
      <button class="new-list" data-act="new">${I.plus()}Создать первый список</button></div>`;
  } else if (ui.ordering) {
    body = `<p class="hint" style="margin: 0 8px 10px">Стрелками поднимите или опустите список.</p><div class="lists">` +
      data.lists.map((l, i) => `
        <div class="list-card order-card">
          <span class="title"><span>${esc(l.name)}</span></span>
          <button class="arrow" data-act="up" data-i="${i}" aria-label="Поднять ${esc(l.name)}" ${i === 0 ? 'disabled' : ''}>${I.up()}</button>
          <button class="arrow" data-act="down" data-i="${i}" aria-label="Опустить ${esc(l.name)}" ${i === n - 1 ? 'disabled' : ''}>${I.down()}</button>
        </div>`).join('') + '</div>';
  } else {
    body = '<div class="lists">' + data.lists.map((l) => {
      const s = stats(l);
      const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
      const bell = l.remind.on ? `<span class="bell-mark" role="img" aria-label="Напоминания включены">${I.bell(16)}</span>` : '';
      const meta = s.total
        ? `<span class="bar"><i style="width:${pct}%"></i></span><span class="count">${s.done} из ${s.total}</span>`
        : '<span class="count">Пустой список</span>';
      return `<button class="list-card" data-act="open" data-id="${l.id}">
          <span class="info"><span class="title"><span>${esc(l.name)}</span>${bell}</span><span class="meta">${meta}</span></span>
          <span class="chev">${I.chev()}</span>
        </button>`;
    }).join('') + `<button class="new-list" data-act="new">${I.plus()}Новый список</button></div>`;
  }
  const action = !n ? '' : ui.ordering
    ? `<button class="pill primary" data-act="order">${I.check(18, 2.6)}Готово</button>`
    : (n > 1 ? `<button class="pill" data-act="order">${I.order()}Порядок</button>` : '');
  return `<div class="screen">
    <header class="head top"><div class="row"><h1>Списки</h1>${action}</div></header>
    <main class="body">${body}</main>
  </div>`;
}

function renderList(list) {
  const rows = parse(list.text);
  const s = stats(list);
  const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
  const r = list.remind;
  const bellCls = r.on ? 'on' : 'off';
  const bellLabel = r.on ? 'Напоминания включены, изменить' : 'Включить напоминания';
  let body;
  if (!s.total) {
    body = `<div class="empty"><p>Список пока пустой.</p>
      <button class="pill primary" data-act="edit">${I.pencil()}Добавить товары</button></div>`;
  } else {
    body = '<div class="card">' + rows.map((row) => {
      if (row.gap) return '<div class="gap"></div>';
      const d = !!list.done[row.name];
      return `<button class="item${d ? ' done' : ''}" data-act="toggle" data-name="${esc(row.name)}" aria-pressed="${d}">
          <span class="box">${I.check(13, 3.2)}</span><span class="name">${esc(row.name)}</span>
        </button>`;
    }).join('') + '</div>' +
      (s.done ? `<div class="foot"><button class="ghost" data-act="reset">${I.reset()}Снять все отметки</button></div>` : '');
  }
  return `<div class="screen">
    <header class="head">
      <button class="back" data-act="lists">${I.back()}Списки</button>
      <div class="row">
        <h1>${esc(list.name)}</h1>
        <div class="icons">
          <button class="icon-btn ${bellCls}" data-act="sheet" aria-label="${bellLabel}">${I.bell()}</button>
          <button class="icon-btn" data-act="edit" aria-label="Изменить список">${I.pencil()}</button>
        </div>
      </div>
      ${s.total ? `<div class="progress"><div class="bar"><i style="width:${pct}%"></i></div><div class="count">Куплено ${s.done} из ${s.total}</div></div>` : ''}
    </header>
    <main class="body">${body}</main>
  </div>`;
}

function renderEdit(list) {
  const d = ui.draft || { name: list.name, text: list.text };
  const del = ui.confirmDelete
    ? `<div class="confirm"><span>Удалить «${esc(list.name)}»?</span>
        <button class="danger-btn" data-act="delete-yes">Удалить</button>
        <button class="ghost" data-act="delete-no">Отмена</button></div>`
    : `<button class="ghost delete" data-act="delete">Удалить список</button>`;
  return `<div class="screen">
    <header class="head top">
      <div class="row">
        <label for="name" class="sr">Название списка</label>
        <input id="name" class="title-input" value="${esc(d.name)}" autocomplete="off" enterkeyhint="done">
        <button class="pill primary" data-act="save">${I.check(18, 2.6)}Готово</button>
      </div>
      <p class="hint">Один товар на строку. Пустая строка — отступ между группами.</p>
    </header>
    <div class="edit-body">
      <label for="text" class="sr">Товары</label>
      <textarea id="text" class="text" spellcheck="true" autocapitalize="sentences">${esc(d.text)}</textarea>
      ${del}
    </div>
  </div>`;
}

function renderNew() {
  const d = ui.draft || { name: '', text: '' };
  return `<div class="screen">
    <header class="head">
      <button class="back" data-act="lists">${I.back()}Отмена</button>
      <div class="row">
        <label for="name" class="sr">Название списка</label>
        <input id="name" class="title-input" placeholder="Название" value="${esc(d.name)}" autocomplete="off" enterkeyhint="next">
        <button class="pill primary" data-act="create">${I.check(18, 2.6)}Создать</button>
      </div>
      <p class="hint">Один товар на строку. Пустая строка — отступ между группами.</p>
    </header>
    <div class="edit-body">
      <label for="text" class="sr">Товары</label>
      <textarea id="text" class="text" spellcheck="true" autocapitalize="sentences" placeholder="Например:&#10;Хлеб&#10;Молоко&#10;&#10;Губки для посуды">${esc(d.text)}</textarea>
    </div>
  </div>`;
}

function renderSheet(list) {
  const r = list.remind;
  const chip = (active, act, val, label) =>
    `<button class="chip${active ? ' active' : ''}" data-act="${act}" data-v="${val}" aria-pressed="${active}">${label}</button>`;
  let inner = '';
  if (r.on) {
    const summary = reminderSummary(r);
    inner = `
      <div class="segment" role="group" aria-label="Как часто">
        <button class="${r.many ? '' : 'active'}" data-act="many" data-v="0" aria-pressed="${!r.many}">Раз в день</button>
        <button class="${r.many ? 'active' : ''}" data-act="many" data-v="1" aria-pressed="${r.many}">Несколько раз</button>
      </div>
      ${r.many ? `
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="field-label">Каждые</span>
          <div class="chips c4">${[1, 2, 3, 4].map((h) => chip(r.every === h, 'every', h, h + ' ч')).join('')}</div>
        </div>
        <div class="time-row">
          <label for="from" class="field-label">С</label>
          <input id="from" class="time" type="time" value="${r.from}" data-field="from">
          <label for="to" class="field-label">до</label>
          <input id="to" class="time" type="time" value="${r.to}" data-field="to">
        </div>` : `
        <div class="row">
          <label for="at" class="field-label">Во сколько</label>
          <input id="at" class="time" type="time" value="${r.at}" data-field="at">
        </div>`}
      <div class="chips c3" role="group" aria-label="Дни">
        ${chip(r.days === 'all', 'days', 'all', 'Каждый день')}
        ${chip(r.days === 'weekdays', 'days', 'weekdays', 'Будни')}
        ${chip(r.days === 'weekends', 'days', 'weekends', 'Выходные')}
      </div>
      ${summary
        ? `<div class="note">${I.bell(20)}<span>${summary} Когда всё отмечено, напоминания не приходят.</span></div>`
        : `<div class="note warn"><span>Время «до» должно быть позже, чем «с».</span></div>`}`;
  }
  const perm = ui.permError
    ? `<div class="note warn"><span>Уведомления запрещены. Разрешите их для приложения «Покупки» в настройках телефона.</span></div>`
    : '';
  const browser = !LN && r.on
    ? `<div class="note warn"><span>В браузере уведомления не приходят. Установите приложение на телефон.</span></div>`
    : '';
  return `<div class="overlay" data-act="close-sheet"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Уведомления для списка ${esc(list.name)}">
      <div class="grip"></div>
      <div><h2>Уведомления</h2><p class="sub">для списка «${esc(list.name)}»</p></div>
      <button class="switch-row" data-act="remind-on" aria-pressed="${r.on}">
        <span class="txt"><b>Напоминать</b><small>Только если есть невыполненные пункты</small></span>
        <span class="switch${r.on ? ' on' : ''}"></span>
      </button>
      ${perm}${browser}${inner}
      <button class="wide" data-act="close-sheet">Готово</button>
    </section>`;
}

/* ---------- Actions ---------- */
function readEditor() {
  const name = (document.getElementById('name')?.value || '').trim();
  const text = (document.getElementById('text')?.value || '').replace(/\s+$/, '');
  return { name, text };
}

function saveEdit() {
  const list = byId(ui.listId);
  if (!list) return go('lists');
  const { name, text } = readEditor();
  list.name = name || list.name || 'Без названия';
  list.text = text;
  const names = new Set(parse(text).filter((r) => !r.gap).map((r) => r.name));
  for (const k of Object.keys(list.done)) if (!names.has(k)) delete list.done[k];
  save();
  go('list');
}

function createList() {
  const { name, text } = readEditor();
  if (!name && !text) return go('lists');
  const list = newList(name || 'Новый список', text);
  data.lists.push(list);
  save();
  go(text ? 'list' : 'edit', list.id);
}

function back() {
  if (ui.sheet) { ui.sheet = false; render(); return true; }
  if (ui.screen === 'edit') { saveEdit(); return true; }
  if (ui.screen === 'new') { createList(); return true; }
  if (ui.screen === 'list') { go('lists'); return true; }
  if (ui.ordering) { ui.ordering = false; render(); return true; }
  return false;
}

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const list = byId(ui.listId);

  switch (act) {
    case 'open': return go('list', el.dataset.id);
    case 'lists': return go('lists');
    case 'new': return go('new');
    case 'edit': return go('edit');
    case 'save': return saveEdit();
    case 'create': return createList();
    case 'order': ui.ordering = !ui.ordering; return render();
    case 'up':
    case 'down': {
      const i = +el.dataset.i, j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= data.lists.length) return;
      [data.lists[i], data.lists[j]] = [data.lists[j], data.lists[i]];
      save(); render();
      const btn = app.querySelector(`[data-act="${act}"][data-i="${j}"]`);
      if (btn && !btn.disabled) btn.focus();
      return;
    }
    case 'toggle': {
      const name = el.dataset.name;
      if (list.done[name]) delete list.done[name]; else list.done[name] = true;
      save();
      const body = app.querySelector('.body');
      const top = body ? body.scrollTop : 0;
      render();
      const nb = app.querySelector('.body');
      if (nb) nb.scrollTop = top;
      return;
    }
    case 'reset': list.done = {}; save(); return render();
    case 'delete': ui.draft = readEditor(); ui.confirmDelete = true; return render();
    case 'delete-no': ui.draft = readEditor(); ui.confirmDelete = false; return render();
    case 'delete-yes':
      data.lists = data.lists.filter((l) => l.id !== list.id);
      save();
      return go('lists', null);
    case 'sheet': ui.sheet = true; ui.permError = false; return render();
    case 'close-sheet': ui.sheet = false; return render();
    case 'remind-on': {
      if (!list.remind.on && LN) {
        const p = await ensurePermission();
        if (p !== 'granted') { ui.permError = true; return render(); }
      }
      ui.permError = false;
      list.remind.on = !list.remind.on;
      save(); return render();
    }
    case 'many': list.remind.many = el.dataset.v === '1'; save(); return render();
    case 'every': list.remind.every = +el.dataset.v; save(); return render();
    case 'days': list.remind.days = el.dataset.v; save(); return render();
  }
});

app.addEventListener('change', (e) => {
  const f = e.target.dataset && e.target.dataset.field;
  const list = byId(ui.listId);
  if (!f || !list || !e.target.value) return;
  list.remind[f] = e.target.value;
  save(); render();
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'name' || e.target.id === 'text') saveUiSoon();
});

app.addEventListener('scroll', (e) => {
  if (e.target.classList && e.target.classList.contains('body') && ui.screen === 'list') {
    uiScroll = e.target.scrollTop;
    saveUiSoon();
  }
}, true);

window.addEventListener('pagehide', saveUi);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveUi(); });

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'name') {
    e.preventDefault();
    document.getElementById('text')?.focus();
  }
});

/* ---------- Start ---------- */
(async function start() {
  await load();
  await loadUi();
  render();
  if (ui.screen === 'list' && uiScroll) {
    const body = app.querySelector('.body');
    if (body) body.scrollTop = uiScroll;
  }

  if (StatusBar) {
    StatusBar.setBackgroundColor({ color: '#F7F6F0' }).catch(() => {});
    StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
  }

  if (AppPlugin) {
    AppPlugin.addListener('backButton', () => {
      if (!back()) AppPlugin.minimizeApp ? AppPlugin.minimizeApp() : AppPlugin.exitApp();
    });
    AppPlugin.addListener('pause', saveUi);
  }

  if (LN) {
    try {
      await LN.createChannel({ id: CHANNEL_ID, name: 'Напоминания о списках', description: 'Напоминания о невыполненных пунктах', importance: 4, visibility: 1 });
    } catch (e) { /* older Android: no channels */ }
    LN.addListener('localNotificationActionPerformed', (ev) => {
      const id = ev && ev.notification && ev.notification.extra && ev.notification.extra.listId;
      if (id && byId(id)) go('list', id);
    });
    reschedule();
  }
})();
