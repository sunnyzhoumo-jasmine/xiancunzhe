// ---------- 基础 ----------
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const NAV_ICON = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const NAV = [
  { hash: '#/review', label: '回顾', icon: NAV_ICON('<path d="M3 12a9 9 0 1 1 2.6 6.4L3 16"/><path d="M3 21v-5h5"/>') },
  { hash: '#/kb', label: '知识库', icon: NAV_ICON('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>') },
  { hash: '#/add', label: '添加', icon: NAV_ICON('<path d="M12 5v14M5 12h14"/>') },
  { hash: '#/profile', label: '我的', icon: NAV_ICON('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>') },
];
let me = null;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { me = null; location.hash = '#/login'; throw new Error('请先登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function statusBadge(s) {
  const map = {
    '待解析': ['gray', ''], '解析中': ['accent', ''],
    '完整解析': ['ok', 'ok'], '部分解析': ['accent', ''],
    '已保存正文': ['ok', 'ok'],
    '仅保存链接': ['gray', ''], '解析失败': ['danger', 'fail'],
  };
  const [cls, dot] = map[s] || ['gray', ''];
  return `<span class="badge ${cls}"><span class="dot ${dot}"></span> ${esc(s)}</span>`;
}

function useBadge(s) {
  const map = { '未读': 'gray', '已读': '', '稍后处理': 'accent', '已使用': '', '已归档': 'gray' };
  return `<span class="badge ${map[s] || 'gray'}">${esc(s)}</span>`;
}

function coverHtml(c) {
  if (c.cover) return `<img class="col-cover" src="${esc(c.cover)}" onerror="this.outerHTML='<div class=col-cover ph>📄</div>'">`;
  return `<div class="col-cover ph">${c.url ? '🔗' : '📝'}</div>`;
}

// 双列信息流卡片：标题 + 摘要 + 标签
function feedCard(c, opts = {}) {
  const tags = (c.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `
  <div class="f-card" data-id="${c.id}">
    <div class="f-body">
      <div class="f-title">${esc(c.title || '无标题')}</div>
      ${c.summary ? `<div class="f-summary">${esc(c.summary)}</div>` : ''}
      ${tags ? `<div class="f-meta">${tags}</div>` : ''}
    </div>
  </div>`;
}

function itemHtml(c, opts = {}) {
  const tags = (c.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `
  <div class="col-item" data-id="${c.id}">
    ${opts.check ? `<label class="row" style="align-self:center"><input type="checkbox" class="batch-check" data-id="${c.id}"></label>` : ''}
    ${opts.noCover ? '' : coverHtml(c)}
    <div class="col-main">
      <div class="col-title">${esc(c.title || '无标题')}${c.url ? `<a class="orig" href="${esc(c.url)}" target="_blank" rel="noopener" title="查看原文" onclick="event.stopPropagation()">↗</a>` : ''}</div>
      ${c.summary ? `<div class="col-summary">${esc(c.summary)}</div>` : ''}
      <div class="col-meta">
        ${c.platform ? `<span class="badge gray">${esc(c.platform)}</span>` : ''}
        ${c.type ? `<span class="badge">${esc(c.type)}</span>` : ''}
        ${useBadge(c.useStatus)}
        ${statusBadge(c.parseStatus)}
        ${shortDate(c.createdAt)}
      </div>
      <div class="col-meta">${tags}</div>
    </div>
  </div>`;
}

// ---------- 路由 ----------
let restoreScrollY = null;

async function route() {
  const h = location.hash || '#/review';
  if (h === '#/login') return render(viewLogin());
  if (h.startsWith('#/detail/')) return render(await viewDetail(Number(h.split('/')[2])));
  if (h.startsWith('#/search/')) return render(await viewSearch(decodeURIComponent(h.slice(9))));
  if (h === '#/kb' || h.startsWith('#/kb?')) return render(await viewKb());
  if (h === '#/add') return render(await viewAdd());
  if (h === '#/profile') return render(await viewProfile());
  if (h === '#/insights') return render(await viewInsights());
  if (h === '#/review' || h.startsWith('#/review?')) return render(await viewReview());
  if (h === '#/collections' || h === '#/cards') return render(await viewKb());
  return render(await viewReview());
}

function render(html) {
  const scrollY = restoreScrollY;
  restoreScrollY = null;
  app.innerHTML = html;
  app.classList.toggle('no-nav', !html.includes('bottom-nav'));
  const nav = document.getElementById('bottom-nav');
  if (nav) {
    const active = NAV.find((n) => (location.hash || '').startsWith(n.hash.replace(/\/$/, '')));
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.hash === (active ? active.hash : '')));
  }
  window.scrollTo(0, scrollY == null ? 0 : scrollY);
  bind();
}

function refreshCurrent({ preserveScroll = false } = {}) {
  if (preserveScroll) restoreScrollY = window.scrollY;
  route();
}

function topbar(title, { back, right } = {}) {
  return `
  <div class="topbar">
    ${back ? `<button class="back" data-nav="back">‹ 返回</button>` : ''}
    <h1>${title}</h1>
    <div class="right">${right || ''}</div>
  </div>`;
}

function bottomNav() {
  return `
  <nav class="bottom-nav" id="bottom-nav">
    ${NAV.map((n) => `<button data-hash="${n.hash}"><span class="ic">${n.icon}</span>${n.label}</button>`).join('')}
  </nav>`;
}

// ---------- 登录 ----------
function viewLogin() {
  return `
  <div class="login-wrap">
    <div class="login-logo">
      <div class="icon">🌱</div>
      <h1>先存着</h1>
      <p>把值得记住的内容放进来，之后真的记住它</p>
    </div>
    <div class="login-tab">
      <button data-login-tab="login" class="active">登录</button>
      <button data-login-tab="register">注册</button>
    </div>
    <div class="card">
      <div class="field"><label>账号</label><input class="input" id="lg-account" placeholder="字母、数字或 . _ -" autocomplete="username"></div>
      <div class="field"><label>密码</label><input class="input" id="lg-password" type="password" placeholder="至少 6 位" autocomplete="current-password"></div>
      <div class="field" id="lg-nick-wrap" style="display:none"><label>昵称（可选）</label><input class="input" id="lg-nick" placeholder="怎么称呼你"></div>
      <button class="btn" id="lg-submit">进入先存着</button>
      <p class="muted mt16" style="text-align:center">数据仅保存在你自己的设备/服务器上，默认私密。</p>
    </div>
  </div>`;
}

function bindLogin() {
  let mode = 'login';
  const tabBtns = document.querySelectorAll('[data-login-tab]');
  tabBtns.forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.loginTab;
    tabBtns.forEach((x) => x.classList.toggle('active', x === b));
    document.getElementById('lg-nick-wrap').style.display = mode === 'register' ? '' : 'none';
    document.getElementById('lg-submit').textContent = mode === 'register' ? '注册并进入' : '进入先存着';
  }));
  document.getElementById('lg-submit').addEventListener('click', async () => {
    const account = document.getElementById('lg-account').value.trim();
    const password = document.getElementById('lg-password').value;
    const nick = document.getElementById('lg-nick').value.trim();
    try {
      const r = await api(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: { account, password, nickname: nick } });
      me = r.user;
      location.hash = '#/collections';
      toast(mode === 'register' ? '欢迎来到先存着 🌱' : '欢迎回来');
    } catch (e) { toast(e.message); }
  });
}

// ---------- 知识库 ----------
const CONTENT_TYPES = ['其他', '概念', '方法', '事实', '工作经验', '课程笔记'];
const PARSE_FILTERS = ['待解析', '解析中', '完整解析', '部分解析', '已保存正文', '仅保存链接', '解析失败'];

function kbHref(overrides) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  for (const [k, v] of Object.entries(overrides)) {
    if (v === '' || v == null) params.delete(k); else params.set(k, v);
  }
  const qs = params.toString();
  return '#/kb' + (qs ? '?' + qs : '');
}

async function viewKb() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const view = params.get('v') === 'cards' ? 'cards' : 'content';
  const seg = `
    <div class="seg">
      <button class="seg-btn ${view === 'content' ? 'active' : ''}" data-hash="#/kb">内容</button>
      <button class="seg-btn ${view === 'cards' ? 'active' : ''}" data-hash="#/kb?v=cards">卡片</button>
    </div>`;
  try {
    if (view === 'cards') return await kbCardsView(params, seg);
    return await kbContentView(params, seg);
  } catch (e) { return errView(e.message); }
}

async function kbContentView(params, seg) {
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  const parse = params.get('parse') || '';
  const use = params.get('use') || '';
  const sort = params.get('sort') || 'recent';
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (type) qs.set('type', type);
  if (parse) qs.set('parse', parse);
  if (use) qs.set('use', use);
  if (sort) qs.set('sort', sort);
  qs.set('perPage', '100');
  const r = await api('/collections?' + qs.toString());
  return `
  <div class="page-top-gap"></div>
  ${seg}
  <div class="col-top">
    <input class="input search-input" id="kb-q" placeholder="搜索标题、内容、标签…" value="${esc(q)}">
    <div class="row" style="gap:8px;padding:10px 14px 0">
      <select class="input" id="kb-type" style="flex:1">${['', ...CONTENT_TYPES].map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${t === '' ? '全部类型' : t}</option>`).join('')}</select>
      <select class="input" id="kb-parse" style="flex:1">${['', ...PARSE_FILTERS].map((t) => `<option value="${t}" ${t === parse ? 'selected' : ''}>${t === '' ? '全部状态' : t}</option>`).join('')}</select>
      <select class="input" id="kb-sort" style="flex:1">${[['recent', '最近添加'], ['oldest', '最早添加'], ['updated', '最近更新']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
  </div>
  <div class="list-wrap">
    <div class="list-card">
      ${r.items.length ? r.items.map((c) => kbItemHtml(c)).join('') : `<div class="empty" style="padding:28px">还没有内容<br><button class="btn" data-hash="#/add">添加第一条</button></div>`}
    </div>
  </div>
  ${bottomNav()}`;
}

function kbItemHtml(c) {
  const tags = (c.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const meta = [
    `<span class="badge">${esc(c.type || '其他')}</span>`,
    statusBadge(c.parseStatus),
    shortDate(c.createdAt),
  ].join('');
  const extra = [
    c.cardCount ? `${c.cardCount} 张卡片` : '',
    c.lastReviewAt ? `上次回顾 ${shortDate(c.lastReviewAt)}` : '',
  ].filter(Boolean).join(' · ');
  return `
  <div class="col-item" data-id="${c.id}">
    <div class="col-main">
      <div class="col-title">${esc(c.title || '无标题')}</div>
      ${c.summary ? `<div class="col-summary">${esc(c.summary)}</div>` : ''}
      <div class="col-meta">${meta}</div>
      ${(tags || extra) ? `<div class="col-meta">${tags}${extra ? `<span class="muted">${esc(extra)}</span>` : ''}</div>` : ''}
    </div>
    <div class="col-ops">
      <button class="btn small ghost" data-id="${c.id}" data-act="archive">归档</button>
      <button class="btn small ghost danger" data-id="${c.id}" data-act="delete">删除</button>
    </div>
  </div>`;
}

async function kbCardsView(params, seg) {
  const q = (params.get('q') || '').toLowerCase();
  const status = params.get('s') || '';
  const r = await api('/cards' + (status ? `?status=${encodeURIComponent(status)}` : ''));
  const items = (r.items || []).filter((k) => {
    if (!q) return true;
    return (k.question || '').toLowerCase().includes(q)
      || (k.answer || '').toLowerCase().includes(q)
      || (k.title || '').toLowerCase().includes(q);
  });
  const statusChips = ['', '候选中', '已确认', '计划中', '已暂停', '已归档'].map((t) =>
    `<button class="chip ${status === t ? 'active' : ''}" data-href="${kbHref({ v: 'cards', s: t })}">${t === '' ? '全部' : t}</button>`).join('');
  return `
  <div class="page-top-gap"></div>
  ${seg}
  <div class="col-top">
    <input class="input search-input" id="kb-q" placeholder="搜索问题、答案、所属内容…" value="${esc(q)}">
    <div class="chips">${statusChips}</div>
  </div>
  <div class="list-wrap">
    <div class="list-card">
      ${items.length ? items.map((k) => kbCardHtml(k)).join('') : `<div class="empty" style="padding:28px">${status ? `没有「${esc(status)}」的卡片` : '还没有卡片<br>添加知识内容后会自动生成候选卡片，确认后进入回顾'}</div>`}
    </div>
  </div>
  ${bottomNav()}`;
}

function kbCardHtml(k) {
  const pts = (k.points || []).length ? `<ul class="pts">${k.points.slice(0, 3).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  const qa = (k.question || k.answer) ? `<div class="col-title">${esc(k.question || '')}</div>${k.answer ? `<div class="col-summary">${esc(k.answer)}</div>` : ''}` : '';
  const statusMap = { '候选中': 'accent', '已确认': 'ok', '计划中': 'ok', '已暂停': 'gray', '已归档': 'gray' };
  const reviewMeta = [
    k.lastReviewedAt ? `上次 ${shortDate(k.lastReviewedAt)}` : '从未回顾',
    k.nextReviewAt ? `下次 ${shortDate(k.nextReviewAt)}` : '',
  ].filter(Boolean).join(' · ');
  return `
  <div class="kcard" data-card="${k.id}">
    <div class="col-main">
      <span class="kind">${esc(k.kind)}卡</span>
      <span class="badge ${statusMap[k.status] || 'gray'}">${esc(k.status)}</span>
      ${qa}
      ${pts}
      <div class="col-meta">${esc(k.title || '')}${reviewMeta ? ` · ${esc(reviewMeta)}` : ''}</div>
    </div>
    <div class="ops">
      ${k.status === '候选中' ? `<button class="btn small accent" data-card-act="confirm">确认</button><button class="btn small ghost" data-card-act="edit">编辑</button>` : ''}
      ${k.status === '已确认' || k.status === '计划中' ? `<button class="btn small ghost" data-card-act="pause">暂停</button>` : ''}
      ${k.status === '已暂停' ? `<button class="btn small" data-card-act="resume">恢复</button>` : ''}
      ${k.status !== '已归档' ? `<button class="btn small ghost" data-card-act="archive">归档</button>` : ''}
      <button class="btn small danger" data-card-act="delete">删除</button>
    </div>
  </div>`;
}

function bindKb() {
  const input = document.getElementById('kb-q');
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') location.hash = kbHref({ q: input.value.trim() });
  });
  document.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.href; }));
  document.querySelectorAll('#kb-type, #kb-parse, #kb-sort').forEach((el) => el.addEventListener('change', () => {
    const k = el.id === 'kb-type' ? 'type' : el.id === 'kb-parse' ? 'parse' : 'sort';
    location.hash = kbHref({ [k]: el.value });
  }));
  document.querySelectorAll('.col-item[data-id]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')) return;
    location.hash = `#/detail/${el.dataset.id}`;
  }));
  document.querySelectorAll('.col-ops [data-act]').forEach((el) => el.addEventListener('click', async () => {
    const id = Number(el.dataset.id);
    if (el.dataset.act === 'delete') {
      if (!confirm('删除这条内容？相关卡片也会删除。')) return;
      await api(`/collections/${id}`, { method: 'DELETE' });
    } else {
      await api(`/collections/${id}`, { method: 'PATCH', body: { use_status: '已归档' } });
    }
    toast(el.dataset.act === 'delete' ? '已删除' : '已归档');
    route();
  }));
  document.querySelectorAll('[data-card-act]').forEach((el) => el.addEventListener('click', async () => {
    const cardId = Number(el.closest('[data-card]').dataset.card);
    const act = el.dataset.cardAct;
    const statusMap = { confirm: '已确认', pause: '已暂停', resume: '已确认', archive: '已归档', delete: '已删除' };
    if (act === 'delete' && !confirm('删除这张卡片？')) return;
    await api(`/cards/${cardId}/status`, { method: 'POST', body: { status: statusMap[act] } });
    toast('已更新');
    refreshCurrent({ preserveScroll: true });
  }));
  document.querySelectorAll('[data-card-act="edit"]').forEach((el) => el.addEventListener('click', () => openCardEdit(Number(el.closest('[data-card]').dataset.card))));
}

function renderCurrent() { route(); }

// ---------- 搜索 ----------
async function viewSearch(q) {
  try {
    const r = await api('/search/nl?q=' + encodeURIComponent(q));
    return `
    ${topbar('搜索', { back: true })}
    <div class="card">
      <div class="field"><label>换个说法再试试</label>
        <div class="row"><input class="input" id="search2" value="${esc(q)}"><button class="btn small" id="search2-btn">搜</button></div>
      </div>
    </div>
    ${r.answer ? `<div class="card" style="background:var(--accent-soft);border-color:#f0d9a8"><b>💡 答案</b><p class="mt8" style="font-size:14px;white-space:pre-wrap">${esc(r.answer)}</p><p class="muted mt8">AI 回答基于你自己的收藏，配置 API Key 后可用</p></div>` : ''}
    <div class="section-title">命中 ${r.items.length} 条收藏</div>
    <div class="feed">
      ${r.items.length ? r.items.map((c) => feedCard(c)).join('') : `<div class="empty" style="grid-column:1/-1"><span class="big">🔍</span>没有找到「${esc(q)}」<br>换个关键词试试</div>`}
    </div>`;
  } catch (e) { return errView(e.message); }
}

function bindSearch() {
  const input = document.getElementById('search2');
  const go = () => { if (input.value.trim()) location.hash = '#/search/' + encodeURIComponent(input.value.trim()); };
  document.getElementById('search2-btn').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  bindItems();
}

// ---------- 详情 ----------
async function viewDetail(id) {
  try {
    const [d, cards] = await Promise.all([api(`/collections/${id}`), api('/cards')]);
    const c = d.item;
    api(`/collections/${id}/open`, { method: 'POST' }).catch(() => {});
    const myCards = cards.items.filter((k) => k.collectionId === id);
    const candidates = myCards.filter((k) => k.status === '候选中');
    const active = myCards.filter((k) => ['已确认', '计划中'].includes(k.status));
    const rest = myCards.filter((k) => ['已暂停', '已归档'].includes(k.status));
    const cardGroup = (title, list) => list.length
      ? `<h3>${title}（${list.length}）</h3><div class="list-wrap" style="padding:0">${list.map((k) => cardBlock(k)).join('')}</div>`
      : '';
    if (['待解析', '解析中'].includes(c.parseStatus)) {
      setTimeout(() => { if (location.hash === `#/detail/${id}`) route(); }, 2500);
    }
    const cardEmpty = !myCards.length ? `
      <h3>知识卡片（0）</h3>
      <div class="empty" style="padding:20px">还没有卡片，可在下方点击「生成候选卡片」或「手动添加卡片」</div>` : '';
    return `
    ${topbar('内容详情', { back: true, right: `<button class="back" data-act="delete">删除</button>` })}
    ${c.cover ? `<img class="detail-cover" src="${esc(c.cover)}" onerror="this.remove()">` : ''}
    ${(c.images || []).length > 1 ? `<div class="gal">${c.images.map((im) => `<img src="${esc(im)}" loading="lazy" onclick="window.open('${esc(im)}','_blank')">`).join('')}</div>` : ''}
    <div class="detail-head">
      <h2>${esc(c.title || '无标题')}</h2>
      <div class="detail-meta">
        <span class="badge">${esc(c.type)}</span>
        ${statusBadge(c.parseStatus)}
        <span class="muted">${shortDate(c.createdAt)}</span>
      </div>
      ${c.parseError ? `<p class="muted mt8" style="color:var(--danger)">⚠️ ${esc(c.parseError)}</p>` : ''}
      <div class="col-meta mt8">${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${c.video ? `<p class="mt8"><a class="link" href="${esc(c.video)}" target="_blank" rel="noopener">▶️ 查看视频</a></p>` : ''}
    </div>
    <div class="detail-body">
      <h3>原文${c.parsedText ? `（${c.parsedText.length} 字）` : ''}</h3>
      ${c.parsedText ? `<details class="parsed"><summary>展开原文（${c.parsedText.length} 字）</summary><div class="parsed-body">${esc(c.parsedText)}</div></details>` : `<p class="muted">暂无原文。如果是小红书/抖音等平台，可在下方「整理与修改」里粘贴笔记文字，再生成卡片。</p>`}
      <h3>保存原因</h3>
      <p>${esc(c.note || '未填写')}</p>
      <h3>AI 核心知识总结</h3>
      <div class="ai-summary">
        ${c.summary ? `<p>${esc(c.summary)}</p>` : `<p class="muted">${['待解析', '解析中'].includes(c.parseStatus) ? '正在生成…' : '暂无总结，可点击「重新解析」或「重新生成候选卡片」'}</p>`}
        ${(c.keyPoints || []).length ? `<ul>${c.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>
      <p class="muted ai-summary-note">这段总结围绕知识卡片提炼核心知识点，可能有误，可在下方修改。</p>
      ${cardGroup('候选卡片', candidates)}
      ${cardGroup('已确认卡片', active)}
      ${cardGroup('其他卡片', rest)}
      ${cardEmpty}
      <h3>来源链接</h3>
      ${c.url ? `<p><a class="link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></p>` : '<p class="muted">未填写</p>'}
      <details class="detail-editor">
        <summary><span>整理与修改</span><span class="detail-editor-hint">标题、标签</span></summary>
        <div class="detail-editor-body">
          <div class="field"><label>标题</label><input class="input" id="dt-title" value="${esc(c.title || '')}"></div>
          <div class="field"><label>保存原因</label><textarea class="input" id="dt-note" placeholder="你为什么想记住它？">${esc(c.note || '')}</textarea></div>
          <div class="row" style="gap:8px">
            <div class="field" style="flex:1"><label>内容类型</label><select class="input" id="dt-type">${CONTENT_TYPES.map((t) => `<option ${c.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="field" style="flex:1"><label>状态</label><select class="input" id="dt-use">${['未读','已读','稍后处理','已使用','已归档'].map((t) => `<option ${c.useStatus === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>标签（逗号分隔）</label><input class="input" id="dt-tags" value="${esc((c.tags || []).join(', '))}"></div>
          <button class="btn" id="dt-save">保存修改</button>
        </div>
      </details>
      <div class="detail-actions">
        <button class="btn ghost" id="dt-reparse">重新解析</button>
        <button class="btn ghost" id="dt-cards">重新生成候选卡片</button>
        <button class="btn ghost" id="dt-add-card">手动添加卡片</button>
      </div>
    </div>`;
  } catch (e) { return errView(e.message); }
}

function cardBlock(k) {
  const pts = (k.points || []).length ? `<ul class="pts">${k.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  const qa = k.question || k.answer ? `<h4>${esc(k.question || '')}</h4><p class="mt8">${esc(k.answer || '')}</p>` : '';
  const statusMap = { '候选中': 'accent', '已确认': 'ok', '计划中': 'ok', '已暂停': 'gray', '已归档': 'gray' };
  return `
  <div class="kcard" data-card="${k.id}">
    <span class="kind">${esc(k.kind)}卡</span>
    <span class="badge ${statusMap[k.status] || 'gray'}" style="margin-left:6px">${esc(k.status)}</span>
    ${qa}${pts}
    ${k.sourceSnippet ? `<div class="src">来源：${esc(k.sourceSnippet)}</div>` : ''}
    <div class="ops">
      ${k.status === '候选中' ? `<button class="btn small accent" data-card-act="confirm">确认</button><button class="btn small ghost" data-card-act="edit">编辑</button>` : ''}
      ${k.status === '已确认' || k.status === '计划中' ? `<button class="btn small ghost" data-card-act="pause">暂停</button>` : ''}
      ${k.status === '已暂停' ? `<button class="btn small" data-card-act="resume">恢复</button>` : ''}
      ${k.status !== '已归档' ? `<button class="btn small ghost" data-card-act="archive">归档</button>` : ''}
      <button class="btn small danger" data-card-act="delete">删除</button>
    </div>
  </div>`;
}

async function bindDetail() {
  const id = Number(location.hash.split('/')[2]);
  const save = async () => {
    const tags = document.getElementById('dt-tags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    await api(`/collections/${id}`, { method: 'PATCH', body: { title: document.getElementById('dt-title').value, note: document.getElementById('dt-note').value, type: document.getElementById('dt-type').value, use_status: document.getElementById('dt-use').value, tags } });
    toast('已保存');
    refreshCurrent({ preserveScroll: true });
  };
  document.getElementById('dt-save').addEventListener('click', save);
  document.getElementById('dt-reparse').addEventListener('click', async () => { const scrollY = window.scrollY; await api(`/collections/${id}/reparse`, { method: 'POST' }); toast('已重新解析'); restoreScrollY = scrollY; setTimeout(route, 1200); });
  document.getElementById('dt-cards').addEventListener('click', async () => {
    const existing = (await api('/cards')).items.filter((k) => k.collectionId === id && k.status === '候选中');
    if (existing.length && !confirm('已有候选卡片，重新生成会替换 AI 生成的候选卡片（手动添加的会保留）。继续？')) return;
    const r = await api(`/collections/${id}/cards/generate`, { method: 'POST', body: { force: existing.length > 0 } });
    const reasonText = {
      already: '已有可用卡片，未重复生成',
      'not-knowledge': '该内容被标记为非知识类，暂不生成记忆卡',
      insufficient: '正文不足 80 字，请补充更多原文后再生成',
    };
    toast(r.created ? `生成了 ${r.created} 张候选卡片` : (reasonText[r.reason] || '模型未生成有效卡片，请检查模型配置或补充原文'));
    refreshCurrent({ preserveScroll: true });
  });
  document.getElementById('dt-add-card').addEventListener('click', () => openCardCreate(id));
  document.querySelectorAll('[data-card-act]').forEach((el) => el.addEventListener('click', async () => {
    const cardId = Number(el.closest('[data-card]').dataset.card);
    const act = el.dataset.cardAct;
    const statusMap = { confirm: '已确认', pause: '已暂停', resume: '已确认', archive: '已归档', delete: '已删除' };
    if (act === 'delete' && !confirm('删除这张卡片？')) return;
    await api(`/cards/${cardId}/status`, { method: 'POST', body: { status: statusMap[act] } });
    toast('已更新');
    refreshCurrent({ preserveScroll: true });
  }));
  document.querySelectorAll('[data-act="delete"]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm('删除这条收藏？相关卡片也会删除。')) return;
    await api(`/collections/${id}`, { method: 'DELETE' });
    toast('已删除');
    location.hash = '#/collections';
  }));
  document.querySelectorAll('.kcard [data-card-act="edit"]').forEach((el) => el.addEventListener('click', () => {
    const cardId = Number(el.closest('[data-card]').dataset.card);
    openCardEdit(cardId);
  }));
}

// 卡片编辑弹层
function openCardEdit(cardId) {
  api('/cards').then((r) => {
    const k = r.items.find((x) => x.id === cardId);
    if (!k) return toast('卡片不存在');
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="sheet">
        <h3>编辑卡片</h3>
        <div class="field"><label>问题</label><input class="input" id="ce-q" value="${esc(k.question || '')}"></div>
        <div class="field"><label>答案</label><textarea class="input" id="ce-a">${esc(k.answer || '')}</textarea></div>
        <div class="field"><label>要点（每行一条）</label><textarea class="input" id="ce-p">${esc((k.points || []).join('\n'))}</textarea></div>
        <div class="row"><button class="btn" id="ce-save">保存</button><button class="btn ghost" id="ce-close">取消</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('ce-close').addEventListener('click', () => overlay.remove());
    document.getElementById('ce-save').addEventListener('click', async () => {
      await api(`/cards/${cardId}`, { method: 'PATCH', body: { question: document.getElementById('ce-q').value, answer: document.getElementById('ce-a').value, points: document.getElementById('ce-p').value.split('\n').map((s) => s.trim()).filter(Boolean) } });
      const scrollY = window.scrollY;
      overlay.remove(); toast('已保存'); restoreScrollY = scrollY; route();
    });
  });
}

// 手动创建卡片弹层
function openCardCreate(collectionId) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <h3>手动添加卡片</h3>
      <div class="field"><label>卡片类型</label><select class="input" id="cc-kind">${['问答', '概念', '填空'].map((k) => `<option>${k}</option>`).join('')}</select></div>
      <div class="field"><label>问题</label><input class="input" id="cc-q" placeholder="例如：番茄工作法的核心是什么？"></div>
      <div class="field"><label>答案</label><textarea class="input" id="cc-a" placeholder="答案内容"></textarea></div>
      <div class="field"><label>补充要点（每行一条，可选）</label><textarea class="input" id="cc-p" placeholder="可补充答案中的关键点"></textarea></div>
      <div class="row"><button class="btn" id="cc-save">保存</button><button class="btn ghost" id="cc-close">取消</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('cc-close').addEventListener('click', () => overlay.remove());
  document.getElementById('cc-save').addEventListener('click', async () => {
    const body = {
      collectionId,
      kind: document.getElementById('cc-kind').value,
      question: document.getElementById('cc-q').value,
      answer: document.getElementById('cc-a').value,
      points: document.getElementById('cc-p').value.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    const r = await api('/cards', { method: 'POST', body });
    if (r.error) return toast(r.error);
    overlay.remove(); toast('已创建候选卡片'); route();
  });
}

// ---------- 添加 ----------
async function viewAdd() {
  let recent = [];
  try { recent = (await api('/collections?perPage=5')).items; } catch {}
  const token = me ? (await api('/me').catch(() => ({}))).apiToken || '' : '';
  return `
  <div class="page-top-gap"></div>
  <div class="card">
    <h3 style="margin:0 0 4px">添加一段值得记住的内容</h3>
    <div class="field"><label>标题（可选）</label><input class="input" id="ad-title" placeholder="给这条内容起个名字，留空则自动生成"></div>
    <div class="field"><label>正文（必填）</label><textarea class="input" id="ad-text" placeholder="粘贴知识、方法、定义或工作经验"></textarea></div>
    <div class="field"><label>我为什么保存（可选）</label><textarea class="input add-note" id="ad-note" placeholder="你为什么想记住它？"></textarea></div>
    <div class="field"><label>来源链接（可选）</label><input class="input" id="ad-url" placeholder="可选，作为原始来源保存"></div>
    <div class="field"><label>内容类型（可选）</label><select class="input" id="ad-type"><option value="">自动判断</option>${CONTENT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></div>
    <p class="muted" style="font-size:12px;margin:-4px 0 12px">只填链接也能先保存，但摘要和知识卡片只能基于你输入的正文生成，建议把正文一起粘贴进来（小红书/抖音等平台的正文在 App 里复制即可）。</p>
    <button class="btn" id="ad-submit">保存</button>
    <details class="mt16">
      <summary class="muted">iPhone 快捷指令收录（推荐）</summary>
      <p class="muted mt8">在 iPhone 快捷指令 App 里新建快捷指令：</p>
      <ol class="muted mt8" style="padding-left:18px">
        <li>「接收共享内容」→ 网络链接；</li>
        <li>「获取 URL 内容」方法选 POST，请求体 JSON：<br><code class="k">{"url":"输入"}，头加 X-Auth-Token</code>；</li>
        <li>地址填你的服务器地址：<code class="k">${location.origin}/api/shortcut</code>；</li>
        <li>令牌：<code class="k" id="ad-token">${token || '（在「我的」页查看）'}</code></li>
      </ol>
      <p class="muted mt8">之后在任意 App 点「分享 → 快捷指令」即可一键存到先存着。</p>
    </details>
  </div>
  <div class="section-title">最近添加</div>
  <div class="list-wrap"><div class="list-card recent-list">
    ${recent.length ? recent.map((c) => itemHtml(c, { noCover: true })).join('') : `<div class="empty" style="padding:20px"><span class="big">🌱</span>还没有收藏</div>`}
  </div></div>
  ${bottomNav()}`;
}

function bindAdd() {
  document.getElementById('ad-submit').addEventListener('click', async () => {
    const url = document.getElementById('ad-url').value.trim();
    const text = document.getElementById('ad-text').value.trim();
    const note = document.getElementById('ad-note').value.trim();
    const title = document.getElementById('ad-title').value.trim();
    const type = document.getElementById('ad-type').value.trim();
    if (!url && !text) return toast('请输入正文内容，或粘贴来源链接');
    const btn = document.getElementById('ad-submit');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const r = await api('/collections', { method: 'POST', body: { url, text, note, title, type } });
      if (r.duplicate) {
        showDuplicate(r, () => {});
      } else {
        toast('内容已保存，正在后台整理');
        location.hash = `#/detail/${r.collection.id}`;
      }
    } catch (e) { toast(e.message); }
    btn.disabled = false; btn.textContent = '存起来 🌱';
  });
  bindItems();
}

function showDuplicate(r) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <h3>这条已经收藏过啦</h3>
      <p class="muted">${esc(r.collection.title || '')}</p>
      <div class="row mt16">
        <button class="btn" id="dup-goto">去看看</button>
        <button class="btn ghost" id="dup-again">再存一次</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('dup-goto').addEventListener('click', () => { overlay.remove(); location.hash = `#/detail/${r.collection.id}`; });
  document.getElementById('dup-again').addEventListener('click', async () => {
    const url = document.getElementById('ad-url').value.trim();
    const text = document.getElementById('ad-text').value.trim();
    const note = document.getElementById('ad-note').value.trim();
    overlay.remove();
    const r2 = await api('/collections', { method: 'POST', body: { url, text, note, force: true } });
    toast('已再存一条');
    location.hash = `#/detail/${r2.collection.id}`;
  });
}

// ---------- 我的 ----------
async function viewProfile() {
  try {
    const [meR, stats] = await Promise.all([api('/me'), api('/stats')]);
    me = meR.user;
    const reviewCount = meR.prefs?.reviewCount || 5;
    return `
    <div class="page-top-gap"></div>
    <div class="card" style="display:flex;align-items:center;gap:12px">
      <div class="avatar">👤</div>
      <div style="flex:1"><b style="font-size:16px">${esc(me.nickname || me.account)}</b><div class="muted">@${esc(me.account)}</div></div>
      <button class="btn small ghost" id="pf-logout">退出</button>
    </div>
    <div class="section-title">数据统计</div>
    <div class="list-wrap" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 14px">
      ${statCell(stats.total, '累计输入')}
      ${statCell(stats.confirmed, '已确认卡片')}
      ${statCell(stats.reviewedCount, '已完成回顾')}
      ${statCell(stats.weekReviews, '近 7 天回顾')}
    </div>
    <div class="section-title">学习洞察</div>
    <div class="list-wrap">
      <div class="list-card">
        ${menuRow('#/insights', '薄弱知识点', stats.weakCards?.length ? `${stats.weakCards.length} 张卡片需要再巩固` : '完成几次回顾后，这里会出现你的薄弱点', '', IC('#f59e0b', '<path d="M4 19V5M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/>'))}
        ${menuRow('#/review', '今日复习节奏', stats.due ? `还有 ${stats.due} 张待回顾卡片` : '今天没有待回顾卡片', '', IC('#3b82f6', '<path d="M3 12a9 9 0 1 1 18 0"/><path d="M12 7v5l3 2"/>'))}
      </div>
    </div>
    <div class="section-title">设置</div>
    <div class="list-wrap">
      <div class="list-card">
        <div class="col-item" style="cursor:pointer">
          <span class="menu-ic" style="background:#14b8a6">${NAV_ICON('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>')}</span>
          <div class="col-main"><div style="font-weight:600;font-size:15px">每次回顾数量</div><div class="muted">每轮回顾推荐几张卡片</div></div>
          <select class="input" id="pf-review-count" style="width:90px">${[3, 5, 8, 10].map((n) => `<option value="${n}" ${n === reviewCount ? 'selected' : ''}>${n} 张</option>`).join('')}</select>
        </div>
        ${menuRow(null, '提醒设置', '后续版本提供', 'pf-remind', IC('#8b5cf6', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'))}
        ${menuRow(null, '收录令牌', 'iPhone 快捷指令使用', 'pf-token-row', IC('#6366f1', '<path d="M15.5 8.5 19 5"/><path d="M13 11a5 5 0 1 1-7 0 5 5 0 0 1 7 0z"/>'))}
        ${menuRow(null, '隐私说明', '所有内容默认仅自己可见', 'pf-privacy', IC('#0ea5e9', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'))}
        ${menuRow(null, '导出全部数据', '', 'pf-export', IC('#10b981', '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'))}
        ${menuRow(null, '清空全部内容', '删除所有内容、卡片和记录', 'pf-clear', IC('#ef4444', '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'))}
        ${menuRow(null, '账号注销', '删除账号及全部数据', 'pf-account-del', IC('#dc2626', '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/>'))}
        ${menuRow(null, '重启服务', '断开几秒后自动恢复', 'pf-restart', IC('#3b82f6', '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>'))}
        ${menuRow(null, '退出登录', '', 'pf-logout-row', IC('#64748b', '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'))}
      </div>
    </div>
    <div class="section-title">关于</div>
    <div class="list-wrap">
      <div class="list-card">
        ${menuRow(null, 'AI 生成说明', '', 'pf-ai', IC('#a855f7', '<path d="m12 3 1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>'))}
        ${menuRow(null, '反馈问题', '', 'pf-feedback', IC('#ec4899', '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'))}
        ${menuRow(null, '产品版本', 'v0.4', 'pf-version', IC('#94a3b8', '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'))}
        ${menuRow(null, '服务条款与隐私政策', '', 'pf-terms', IC('#64748b', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>'))}
      </div>
    </div>
    <div class="card mt16" id="pf-token-box" style="display:none">
      <p class="muted">用于 iPhone 快捷指令收录，不要泄露给他人。</p>
      <div class="row mt8">
        <code class="k" id="pf-token" style="flex:1">${esc(meR.apiToken)}</code>
        <button class="btn small ghost" id="pf-copy">复制</button>
      </div>
    </div>
    <p class="muted" style="text-align:center;padding:20px">先存着 v0.4 · AI 结果可能存在错误<br>内容版权归原作者所有</p>
    ${bottomNav()}`;
  } catch (e) { return errView(e.message); }
}

async function viewInsights() {
  const stats = await api('/stats');
  const weak = stats.weakCards || [];
  const trendMap = new Map((stats.reviewTrend || []).map((d) => [d.day, d.count]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { label: i === 6 ? '今' : `${d.getMonth() + 1}/${d.getDate()}`, count: trendMap.get(key) || 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  return `
  <div class="page-top-gap"></div>
  <div class="insights-head"><a href="#/profile" class="back-link">‹ 我的</a><h1>学习洞察</h1></div>
  <div class="insight-summary">
    <div><strong>${stats.weekReviews}</strong><span>本周回顾</span></div>
    <div><strong>${weak.length}</strong><span>待加强</span></div>
    <div><strong>${stats.due}</strong><span>今日待办</span></div>
  </div>
  <div class="section-title">最近 7 天</div>
  <div class="insight-chart">${days.map((d) => `<div><i style="height:${Math.max(6, Math.round(d.count / max * 48))}px"></i><span>${d.count || ''}</span><small>${d.label}</small></div>`).join('')}</div>
  <div class="section-title">需要再巩固</div>
  <div class="list-wrap"><div class="list-card">${weak.length ? weak.map((k) => `<div class="col-item" data-hash="#/kb?v=cards&q=${encodeURIComponent(k.question || k.title || '')}"><div class="col-main"><div class="col-title">${esc(k.question || '未命名问题')}</div><div class="col-meta">来源：${esc(k.title || '')} · 忘记/模糊 ${k.attempts} 次</div></div><div class="muted">›</div></div>`).join('') : '<div class="empty" style="padding:24px">目前没有明显薄弱点，继续保持。</div>'}</div></div>
  <div class="insight-tip">${weak.length ? '先复习这些卡片，再开始新的输入，记忆会更稳。' : '每次反馈都会帮助你找到真正需要加强的知识点。'}</div>
  ${bottomNav()}`;
}

function statCell(n, label) {
  return `<div class="card" style="margin:0;text-align:center;padding:12px 4px"><div style="font-size:20px;font-weight:800">${n}</div><div class="muted" style="font-size:12px">${label}</div></div>`;
}

function menuRow(hash, title, sub, id, danger = false) {
  const ic = typeof danger === 'object' ? danger : null;
  const dangerFlag = typeof danger === 'boolean' ? danger : false;
  return `<div class="col-item" ${hash ? `data-hash="${hash}"` : ''} data-menu="${id || ''}" style="cursor:pointer">
    ${ic || ''}
    <div class="col-main"><div style="font-weight:600;font-size:15px${dangerFlag ? ';color:var(--danger)' : ''}">${esc(title)}</div>${sub ? `<div class="muted">${esc(sub)}</div>` : ''}</div>
    <div style="color:var(--text-2)">›</div></div>`;
}

function IC(color, d) {
  return `<span class="menu-ic" style="background:${color}">${NAV_ICON(d)}</span>`;
}

function bindProfile() {
  document.getElementById('pf-logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); me = null; location.hash = '#/login'; });
  document.getElementById('pf-review-count').addEventListener('change', async (e) => {
    await api('/me/prefs', { method: 'POST', body: { reviewCount: Number(e.target.value) } });
    toast('已保存回顾偏好');
  });
  const copyBtn = document.getElementById('pf-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(document.getElementById('pf-token').textContent); toast('已复制'); }
    catch { toast(document.getElementById('pf-token').textContent); }
  });
  const menu = (id, fn) => { document.querySelector(`[data-menu="${id}"]`)?.addEventListener('click', fn); };
  menu('pf-token-row', () => {
    const box = document.getElementById('pf-token-box');
    if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
  });
  menu('pf-remind', () => toast('提醒功能将在后续版本提供'));
  menu('pf-privacy', () => toast('所有内容默认仅自己可见，AI 结果基于原文生成'));
  menu('pf-export', () => {
    const a = document.createElement('a');
    a.href = '/api/export'; a.download = 'xiancunzhe-export.json';
    document.body.appendChild(a); a.click(); a.remove();
  });
  menu('pf-clear', async () => {
    if (!confirm('确定清空全部内容？内容、卡片、回顾记录都会被删除，无法恢复。')) return;
    const r = await api('/me', { method: 'DELETE' });
    toast(r.message || '已清空'); route();
  });
  menu('pf-account-del', async () => {
    if (!confirm('确定注销账号？账号和全部数据将被删除，无法恢复。')) return;
    if (!confirm('再次确认：注销后无法找回任何数据。')) return;
    const r = await api('/me/account', { method: 'DELETE' });
    toast(r.message || '已注销'); me = null; location.hash = '#/login';
  });
  menu('pf-ai', () => toast('摘要和卡片由 AI 基于你输入的内容生成，可能出错，请以原文为准'));
  menu('pf-feedback', () => toast('暂未接入反馈通道，可直接在 Codex 里告诉我'));
  menu('pf-version', () => toast('先存着 v0.4'));
  menu('pf-terms', () => toast('内容版权归原作者所有；所有数据默认私密'));
  menu('pf-logout-row', async () => { await api('/auth/logout', { method: 'POST' }); me = null; location.hash = '#/login'; });
  menu('pf-restart', async () => {
    if (!confirm('确定要重启服务吗？页面会断开几秒钟，然后自动恢复。')) return;
    toast('正在重启…');
    try { await api('/admin/restart', { method: 'POST' }); } catch {}
    for (let i = 0; i < 24; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try { await api('/me'); toast('服务已恢复'); return; } catch {}
    }
    toast('服务未恢复，请检查电脑上的终端');
  });
}

// ---------- 回顾 ----------
async function viewReview() {
  try {
    const start = location.hash.includes('start');
    if (start) return await reviewSessionView();
    return await reviewHomeView();
  } catch (e) { return errView(e.message); }
}

async function reviewHomeView() {
  const [stats, session] = await Promise.all([api('/stats'), api('/review/session')]);
  const due = session.items.length;
  const estimate = Math.max(1, Math.ceil(due * 0.6));
  const trendMap = new Map((stats.reviewTrend || []).map((d) => [d.day, d.count]));
  const trendDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { label: i === 6 ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`, count: trendMap.get(key) || 0 };
  });
  const maxTrend = Math.max(1, ...trendDays.map((d) => d.count));
  const trendHtml = trendDays.map((d) => `
    <div class="review-trend-day" title="${esc(d.label)} · ${d.count} 次">
      <span>${d.count || ''}</span>
      <i style="height:${Math.max(6, Math.round((d.count / maxTrend) * 42))}px"></i>
      <small>${esc(d.label)}</small>
    </div>`).join('');
  const hero = due > 0
    ? `<div class="review-hero">
        <div class="review-kicker">今日复习</div>
        <div class="review-hero-title">${due} 张卡片已准备好</div>
        <div class="muted">预计 ${estimate} 分钟 · 随时可以停</div>
        <a class="btn review-start" href="#/review?start=1&total=${due}">开始复习</a>
      </div>`
    : `<div class="review-hero">
        <div class="review-kicker done">今日已完成</div>
        <div class="review-hero-title">现在没有待复习卡片</div>
        <div class="muted">${stats.candidate ? `有 ${stats.candidate} 张候选卡片等待确认` : '添加新内容，生成你的第一批卡片'}</div>
        <div class="row" style="gap:10px;margin-top:16px;justify-content:center">
          <a class="btn ghost" href="#/add">添加内容</a>
          ${stats.candidate ? `<a class="btn" href="#/kb?v=cards&s=${encodeURIComponent('候选中')}">确认候选卡片</a>` : ''}
        </div>
      </div>`;
  const confirmedHtml = (stats.recentlyConfirmed || []).map((k) => `
    <div class="col-item review-recent-item" data-id="${k.collectionId}">
      <div class="col-main">
        <div class="review-recent-title">${esc(k.title || '未命名知识内容')}</div>
        <div class="review-recent-question">${esc(k.question || (k.points || [])[0] || '回忆这条知识内容')}</div>
        <div class="col-meta"><span class="review-card-type">${esc(k.kind || '知识')}卡</span><span>确认于 ${shortDate(k.confirmedAt)}</span></div>
      </div>
    </div>`).join('') || '<div class="muted" style="padding:16px">还没有确认的卡片</div>';
  const reviewsHtml = (stats.recentReviews || []).map((r) => `
    <div class="col-item" data-id="${r.collection_id}">
      <div class="col-main">
        <div class="col-title">${esc(r.question || '')}</div>
        <div class="col-meta"><span class="fb">${esc(r.feedback)}</span> · ${esc(r.title || '')} · ${shortDate(r.reviewed_at)}</div>
      </div>
    </div>`).join('') || '<div class="muted" style="padding:16px">还没有回顾记录</div>';
  const dailyQuotes = ['今天记住的一点，会成为明天的底气。', '慢一点没关系，重要的是持续向前。', '把知识变成自己的，靠的是一次次回想。', '现在多理解一分，未来少摸索一步。', '认真积累，时间会替你放大答案。', '每一次复习，都是在给未来的自己留路。', '你不需要记住所有，只要记住重要的。'];
  const dayIndex = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000) % dailyQuotes.length;
  const dailyQuote = dailyQuotes[dayIndex];
  return `
  <div class="page-top-gap"></div>
  <div class="review-page-head">
    <div><div class="review-date">今日复习</div><h1 class="review-daily-quote"><span class="review-daily-quote-track">${dailyQuote}</span></h1></div>
    <div class="review-streak" aria-label="近七天复习 ${stats.weekReviews} 次"><strong>${stats.weekReviews}</strong><span>近 7 天</span></div>
  </div>
  ${hero}
  <div class="review-stats" aria-label="复习统计">
    <div><strong>${stats.confirmed}</strong><span>学习中</span></div>
    <div><strong>${stats.reviewedCount}</strong><span>累计复习</span></div>
    <div><strong>${stats.candidate}</strong><span>待确认</span></div>
  </div>
  <div class="section-title review-section-head"><span>近 7 天趋势</span><span class="sub">共 ${stats.weekReviews} 次</span></div>
  <div class="review-trend" aria-label="近 7 天复习趋势">${trendHtml}</div>
  <div class="section-title">最近确认的卡片</div>
  <div class="list-wrap"><div class="list-card">${confirmedHtml}</div></div>
  <div class="section-title">最近回顾</div>
  <div class="list-wrap"><div class="list-card">${reviewsHtml}</div></div>
  ${bottomNav()}`;
}

async function reviewSessionView() {
  const r = await api('/review/session');
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const total = Math.max(r.items.length, Number(params.get('total')) || r.items.length);
  const completed = Math.max(0, total - r.items.length);
  if (!r.items.length) {
    return `
      <div class="page-top-gap"></div>
      <div class="review-done">
        <div class="review-done-mark">✓</div>
        <h2>本轮复习完成</h2>
        <p class="muted mt8">完成 ${total} 张，记忆会在下一次合适的时间继续巩固。</p>
        <button class="btn" style="max-width:220px;margin:20px auto 0" data-hash="#/review">查看复习概览</button>
      </div>
      ${bottomNav()}`;
  }
  const first = r.items[0];
  const fbQuestion = first.question || ({ 问答: '回忆这张卡片的内容', 概念: '这个概念是什么？', 填空: '填上句中的空缺' }[first.kind] || '回忆这张卡片');
  const sourceText = first.sourceText || first.sourceSnippet || '暂无可展开的原文';
  return `
  <div class="review-wrap">
    <div class="review-session-head">
      <a href="#/review" class="review-close" aria-label="结束复习">×</a>
      <div class="review-progress-track"><i style="width:${total ? Math.round((completed / total) * 100) : 0}%"></i></div>
      <span>${completed + 1} / ${total}</span>
    </div>
    <div class="review-progress">先在脑中回忆，再显示答案</div>
    <div class="review-card" data-rid="${first.id}">
      <h1 class="review-question-title">${esc(fbQuestion)}</h1>
      <div class="review-source-row"><span>来源：${esc(first.title || '未命名知识内容')}</span><button id="rv-source" type="button">原文展开</button></div>
      <div class="review-source-text" id="rv-source-text" style="display:none">${esc(sourceText)}</div>
      <div class="review-a" style="display:none">
        <div class="review-answer-label">答案</div>
        ${first.answer ? `<p>${esc(first.answer)}</p>` : ''}
        ${(first.points || []).length ? `<ul class="pts mt8">${first.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>
    <div class="review-primary-actions">
      <button class="btn" id="rv-show">点击显示答案</button>
      <button class="review-skip" id="rv-skip">稍后再看</button>
    </div>
    <div class="review-ops" id="rv-ops" style="display:none">
      <button data-fb="忘了"><strong>忘了</strong><span>1 天后</span></button>
      <button data-fb="模糊"><strong>模糊</strong><span>3 天后</span></button>
      <button data-fb="记得"><strong>记得</strong><span>7 天后</span></button>
      <button data-fb="很熟"><strong>很熟</strong><span>15 天后</span></button>
    </div>
  </div>`;
}

function bindReview() {
  const show = document.getElementById('rv-show');
  if (!show) {
    const quote = document.querySelector('.review-daily-quote');
    const track = quote?.querySelector('.review-daily-quote-track');
    if (quote && track && track.scrollWidth > quote.clientWidth) {
      quote.style.setProperty('--quote-shift', `${track.scrollWidth - quote.clientWidth}px`);
      quote.classList.add('is-marquee');
    }
    bindItems();
    return;
  }
  const skip = document.getElementById('rv-skip');
  const sourceButton = document.getElementById('rv-source');
  const sourceText = document.getElementById('rv-source-text');
  const ops = document.getElementById('rv-ops');
  const card = document.querySelector('.review-card');
  const answer = document.querySelector('.review-a');
  const toggleAnswer = () => {
    const opening = answer.style.display === 'none';
    answer.style.display = opening ? '' : 'none';
    ops.style.display = opening ? 'grid' : 'none';
    show.textContent = opening ? '收起答案' : '点击显示答案';
    card.classList.toggle('answer-open', opening);
  };
  show.addEventListener('click', toggleAnswer);
  sourceButton.addEventListener('click', () => {
    const opening = sourceText.style.display === 'none';
    sourceText.style.display = opening ? '' : 'none';
    sourceButton.textContent = opening ? '收起原文' : '原文展开';
  });
  card.addEventListener('click', (e) => {
    if (e.target.closest('a, button, details, summary')) return;
    toggleAnswer();
  });
  skip.addEventListener('click', () => { toast('已跳过'); route(); });
  ops.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const rid = Number(document.querySelector('.review-card').dataset.rid);
    await api(`/review/${rid}`, { method: 'POST', body: { feedback: b.dataset.fb } });
    toast(`已记录 · ${b.querySelector('span').textContent}`);
    route();
  }));
}

// ---------- 公共 ----------
function errView(msg) {
  return `<div class="empty"><span class="big">😵</span>${esc(msg)}<br><br><button class="btn" style="max-width:200px;margin:0 auto" data-hash="#/kb">回到知识库</button></div>`;
}

function bindItems() {
  document.querySelectorAll('.col-item[data-id], .f-card[data-id]').forEach((el) => el.addEventListener('click', () => location.hash = `#/detail/${el.dataset.id}`));
}

// ---------- 启动 ----------
async function boot() {
  try {
    const r = await api('/me');
    me = r.user;
    if (!location.hash || location.hash === '#/login') location.hash = '#/review';
  } catch {
    if (!location.hash) location.hash = '#/login';
  }
  window.addEventListener('hashchange', route);
  route();
}

const binders = {
  login: bindLogin,
  detail: bindDetail,
  search: bindSearch,
  kb: bindKb,
  add: bindAdd,
  profile: bindProfile,
  insights: () => {},
  review: bindReview,
};

function bind() {
  document.querySelectorAll('[data-hash]').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.hash; }));
  document.querySelectorAll('[data-nav="back"]').forEach((el) => el.addEventListener('click', () => history.back()));
  let h = location.hash || '#/review';
  if (h === '#/collections' || h === '#/cards') h = '#/kb';
  if (h === '#/discover') h = '#/review';
  if (h === '#/login') binders.login();
  else if (h.startsWith('#/detail/')) binders.detail();
  else if (h.startsWith('#/search/')) binders.search();
  else if (h === '#/kb' || h.startsWith('#/kb?')) binders.kb();
  else if (h === '#/add') binders.add();
  else if (h === '#/profile') binders.profile();
  else if (h === '#/insights') binders.insights();
  else if (h === '#/review' || h.startsWith('#/review?')) binders.review();
  else binders.kb();
}

boot();
