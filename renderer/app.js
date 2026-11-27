'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  handle: localStorage.getItem('cf.handle') || 'tourist',
  watchlist: (() => {
    try { return JSON.parse(localStorage.getItem('cf.watchlist')) || ['tourist']; }
    catch { return ['tourist']; }
  })(),
  store: new Map(),
  view: 'dashboard',
  contestPhase: 'BEFORE',
  problemPage: 1,
  problemPageSize: 30,
  subVerdict: 'all',
  problems: null,
  searchHistory: (() => {
    try { return JSON.parse(localStorage.getItem('cf.searchHistory')) || []; }
    catch { return []; }
  })(),
  quickTag: 'all',
  timer: null,
  submissionIndex: new Map(),
  detail: null,
  detailCloseTimer: null,
  statementPath: '',
  statementCloseTimer: null,
  editorProblem: null,
  editorSaveTimer: null
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

function localKey(method, params) {
  return method + '?' + Object.entries(params || {}).sort().map(([k, v]) => `${k}=${v}`).join('&');
}

function setApiState(kind, text) {
  const dot = $('#api-dot');
  dot.className = 'api-dot' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
  if (text) $('#api-state').textContent = text;
}

function status(message) { $('#status-message').textContent = message; }

async function api(method, params = {}, force = false) {
  setApiState('busy', '请求中');
  const result = await window.desktop.api(method, params, force);
  if (!result.ok) {
    setApiState('err', '请求失败');
    throw new Error(result.error);
  }
  setApiState('ok', result.cached ? '命中缓存' : '已更新');
  status(`${method} · ${result.cached ? '缓存' : '网络'} · ${new Date(result.fetchedAt).toLocaleTimeString('zh-CN')}`);
  return result.data;
}

async function get(method, params = {}, force = false) {
  const key = localKey(method, params);
  if (!force && state.store.has(key)) return state.store.get(key);
  const value = await api(method, params, force);
  state.store.set(key, value);
  return value;
}

function errorHTML(error) {
  return `<div class="error-box">请求失败：${esc(error?.message || error)}<br><span class="tiny">可能是网络问题、handle 不存在，或触发了官方 2 秒限流。稍后重试即可。</span></div>`;
}

function rankClass(rank = '') {
  const r = rank.toLowerCase();
  if (r.includes('legendary')) return 'rank-legends';
  if (r.includes('grandmaster')) return 'rank-grandmaster';
  if (r.includes('master')) return 'rank-master';
  if (r.includes('candidate')) return 'rank-candidate';
  if (r.includes('expert')) return 'rank-expert';
  if (r.includes('specialist')) return 'rank-specialist';
  return 'rank-newbie';
}

function ratingColor(value) {
  if (value == null) return '#8b99b1';
  if (value >= 2400) return '#ff5b5f';
  if (value >= 2100) return '#ff9c4a';
  if (value >= 1900) return '#c07dff';
  if (value >= 1600) return '#6e9dff';
  if (value >= 1400) return '#3bc5c5';
  if (value >= 1200) return '#43c98a';
  return '#9ba6b9';
}

function fmtDate(ts, withTime = true) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const date = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return withTime ? `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : date;
}

function countdown(startTs, duration, phase) {
  const now = Date.now() / 1000;
  if (phase === 'FINISHED') return `${Math.max(0, Math.floor((now - startTs - duration) / 86400))} 天前结束`;
  const remaining = startTs - now;
  if (phase === 'CODING') {
    const left = Math.max(0, startTs + duration - now);
    const h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = Math.floor(left % 60);
    return `剩余 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (remaining <= 0) return '即将开始';
  const d = Math.floor(remaining / 86400), h = Math.floor(remaining % 86400 / 3600), m = Math.floor(remaining % 3600 / 60);
  return d ? `${d} 天 ${h} 小时后` : `${h} 小时 ${m} 分钟后`;
}

function cfUrl(path) { return 'https://codeforces.com' + path; }

function openLink(event, path) {
  event.stopPropagation();
  window.desktop.openExternal(cfUrl(path));
}

function setHandle(handle) {
  const clean = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!clean || !/^[a-z0-9_.-]{2,24}$/.test(clean)) {
    status('handle 格式不对：2–24 位字母数字下划线');
    return;
  }
  if (!state.watchlist.includes(clean)) state.watchlist.unshift(clean);
  localStorage.setItem('cf.watchlist', JSON.stringify(state.watchlist));
  localStorage.setItem('cf.handle', clean);
  state.handle = clean;
  $('#handle-input').value = clean;
  $('#status-handle').textContent = clean;
  renderSideWatch();
  loadView(state.view, true);
}

function renderSideWatch() {
  const target = $('#side-watch');
  if (!state.watchlist.length) {
    target.innerHTML = '<div class="muted tiny pad">还没有关注，去「关注列表」添加</div>';
    return;
  }
  target.innerHTML = state.watchlist.map((handle) => `
    <div class="watch-row ${handle === state.handle ? 'current' : ''}" data-handle="${esc(handle)}">
      <img src="https://userpic.codeforces.org/no-title.jpg" alt="" loading="lazy">
      <span class="wh">${esc(handle)}</span>
      <span class="wr">·</span>
    </div>`).join('');
  $$('.watch-row', target).forEach((row) => row.addEventListener('click', () => setHandle(row.dataset.handle)));

  // 头像与 rating 走一次批量查询，失败也不影响其余界面
  api('user.info', { handles: state.watchlist.join(';') }).then((users) => {
    const byHandle = new Map(users.map((u) => [u.handle.toLowerCase(), u]));
    $$('.watch-row', target).forEach((row) => {
      const user = byHandle.get(row.dataset.handle);
      if (!user) return;
      $('img', row).src = user.avatar;
      $('.wr', row).textContent = user.rating ?? '—';
      $('.wr', row).style.color = ratingColor(user.rating);
    });
  }).catch(() => {});
}

/* ---------------- navigation ---------------- */
function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $('.content').scrollTop = 0;
  loadView(view);
}

function loadView(view, force = false) {
  const loaders = {
    dashboard: loadDashboard, profile: loadProfile, contests: loadContests,
    problems: loadProblems, submissions: loadSubmissions, users: loadUsers
  };
  loaders[view]?.(force);
}

/* ---------------- dashboard ---------------- */
async function loadDashboard(force = false) {
  const hero = $('#dash-hero');
  hero.innerHTML = '<div class="skeleton tall"></div>';
  $('#dash-chart').innerHTML = '<div class="skeleton tall"></div>';
  $('#dash-contests').innerHTML = '<div class="skeleton"></div>';
  $('#dash-submissions').innerHTML = '<div class="skeleton"></div>';
  try {
    const [infos, ratings, contests, submissions] = await Promise.all([
      get('user.info', { handles: state.handle }, force),
      get('user.rating', { handle: state.handle }, force),
      get('contest.list', {}, force),
      get('user.status', { handle: state.handle, from: 1, count: 8 }, force)
    ]);
    const user = infos[0];
    if (!user) throw new Error(`找不到用户 ${state.handle}`);
    renderHero(user, submissions);
    renderChart(ratings);
    const upcoming = contests.filter((c) => c.phase === 'BEFORE').slice(0, 3);
    $('#dash-contests').innerHTML = upcoming.length ? upcoming.map(contestCompact).join('') : '<div class="empty">暂无即将开始的比赛</div>';
    $('#dash-submissions').innerHTML = submissions.length ? submissions.slice(0, 5).map(subCompact).join('') : '<div class="empty">暂无提交记录</div>';
    bindCompactLinks();
  } catch (error) {
    hero.innerHTML = errorHTML(error);
    $('#dash-chart').innerHTML = '';
    $('#dash-contests').innerHTML = '';
    $('#dash-submissions').innerHTML = '';
  }
}

/* ---------------- profile ---------------- */
async function loadProfile(force = false) {
  const hero = $('#profile-hero');
  hero.innerHTML = '<div class="skeleton tall"></div>';
  ['#profile-chart', '#profile-stats', '#profile-bars', '#profile-contests', '#profile-submissions']
    .forEach((sel) => { $(sel).innerHTML = '<div class="skeleton"></div>'; });
  try {
    const [infos, ratings, submissions] = await Promise.all([
      get('user.info', { handles: state.handle }, force),
      get('user.rating', { handle: state.handle }, force),
      get('user.status', { handle: state.handle, from: 1, count: 200 }, force)
    ]);
    const user = infos[0];
    if (!user) throw new Error(`找不到用户 ${state.handle}`);
    $('#profile-sub').textContent = `${user.handle} · 注册于 ${fmtDate(user.registrationTimeSeconds, false)} · 最后在线 ${fmtDate(user.lastOnlineTimeSeconds)}`;
    indexSubmissions(submissions);
    renderProfileHero(user, submissions);
    renderChart(ratings, '#profile-chart', '#profile-chart-meta');
    renderProfileStats(submissions, ratings);
    renderProfileBars(submissions);
    const history = ratings.slice(-10).reverse();
    $('#profile-contests').innerHTML = history.length ? history.map((r) => {
      const delta = r.newRating - r.oldRating;
      return `<div class="contest-history-row">
        <span class="ch-name" title="${esc(r.contestName)}">${esc(r.contestName)}</span>
        <span class="ch-rank">#${r.rank}</span>
        <span class="ch-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}</span>
      </div>`;
    }).join('') : '<div class="empty">暂无比赛记录</div>';
    $('#profile-submissions').innerHTML = submissions.length
      ? submissions.slice(0, 6).map(subCompact).join('') : '<div class="empty">暂无提交记录</div>';
    bindCompactLinks();
  } catch (error) {
    hero.innerHTML = errorHTML(error);
    ['#profile-chart', '#profile-stats', '#profile-bars', '#profile-contests', '#profile-submissions']
      .forEach((sel) => { $(sel).innerHTML = ''; });
  }
}

function renderProfileHero(user, submissions) {
  const solved = new Set(submissions.filter((s) => s.verdict === 'OK')
    .map((s) => `${s.problem.contestId}${s.problem.index}`)).size;
  const detail = (k, v) => `<div class="profile-detail"><span class="k">${k}</span><span class="v">${esc(v || '—')}</span></div>`;
  $('#profile-hero').innerHTML = `
    <div class="hero-top">
      <img class="hero-avatar" src="${esc(user.avatar)}" alt="">
      <div>
        <div class="hero-name">${esc(user.handle)}</div>
        <div class="hero-rank ${rankClass(user.rank)}">${esc(user.rank || 'unrated')} · 峰值 ${esc(user.maxRank || user.rank || '—')}</div>
        <div class="hero-meta">${esc([user.firstName, user.lastName].filter(Boolean).join(' ') || 'Codeforces 选手')}</div>
      </div>
    </div>
    <div class="hero-rating">
      <span class="big rating" style="color:${ratingColor(user.rating)}">${user.rating ?? '—'}</span>
      <span class="delta">最高 ${user.maxRating ?? '—'}</span>
    </div>
    <div class="hero-stats">
      <div class="hero-stat"><div class="v">${solved}</div><div class="k">近期通过题目</div></div>
      <div class="hero-stat"><div class="v">${user.friendOfCount ?? 0}</div><div class="k">关注者</div></div>
      <div class="hero-stat"><div class="v">${user.contribution ?? 0}</div><div class="k">贡献值</div></div>
    </div>
    <div class="profile-detail-grid">
      ${detail('国家 / 城市', [user.country, user.city].filter(Boolean).join(' · '))}
      ${detail('组织', user.organization)}
      ${detail('注册时间', fmtDate(user.registrationTimeSeconds, false))}
      ${detail('最后在线', fmtDate(user.lastOnlineTimeSeconds))}
    </div>`;
}

function renderProfileStats(submissions, ratings) {
  const total = submissions.length;
  const accepted = submissions.filter((s) => s.verdict === 'OK');
  const solved = new Set(accepted.map((s) => `${s.problem.contestId}${s.problem.index}`)).size;
  const ratedProblems = accepted.filter((s) => s.problem.rating != null);
  const avgRating = ratedProblems.length
    ? Math.round(ratedProblems.reduce((sum, s) => sum + s.problem.rating, 0) / ratedProblems.length) : '—';
  const langs = new Map();
  submissions.forEach((s) => {
    const lang = (s.programmingLanguage || '').split('(')[0].trim() || '未知';
    langs.set(lang, (langs.get(lang) || 0) + 1);
  });
  const topLang = [...langs.entries()].sort((a, b) => b[1] - a[1])[0];
  const box = (v, k, color) => `<div class="stat-box"><div class="v" ${color ? `style="color:${color}"` : ''}>${v}</div><div class="k">${k}</div></div>`;
  $('#profile-stats').innerHTML = `<div class="panel-head"><h2>提交画像</h2><span class="panel-sub">基于最近 200 条提交</span></div>
    <div class="stat-grid">
      ${box(total, '提交总数')}
      ${box(total ? `${Math.round(accepted.length / total * 100)}%` : '—', 'AC 通过率', 'var(--green)')}
      ${box(solved, '不同题目通过')}
      ${box(avgRating, '平均通过难度', ratingColor(avgRating))}
      ${box(ratings.length, '参赛场次')}
      ${box(esc(topLang?.[0] || '—'), `最常用语言 ${topLang ? `(${topLang[1]})` : ''}`)}
    </div>`;
}

function renderProfileBars(submissions) {
  const accepted = submissions.filter((s) => s.verdict === 'OK');
  const buckets = [
    ['< 1200', (r) => r < 1200],
    ['1200–1599', (r) => r >= 1200 && r < 1600],
    ['1600–1999', (r) => r >= 1600 && r < 2000],
    ['2000–2399', (r) => r >= 2000 && r < 2400],
    ['2400+', (r) => r >= 2400]
  ].map(([label, test]) => [label, accepted.filter((s) => s.problem.rating != null && test(s.problem.rating)).length]);
  const tags = new Map();
  accepted.forEach((s) => (s.problem.tags || []).forEach((tag) => tags.set(tag, (tags.get(tag) || 0) + 1)));
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const bar = (label, count, max) => `<div class="bar-row">
      <span class="label" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${max ? Math.max(3, count / max * 100) : 0}%"></span></span>
      <span class="value">${count}</span>
    </div>`;
  const maxRatingCount = Math.max(1, ...buckets.map(([, n]) => n));
  const maxTagCount = Math.max(1, ...topTags.map(([, n]) => n));
  $('#profile-bars').innerHTML = `<div class="panel-head"><h2>通过题目画像</h2><span class="panel-sub">最近 200 条</span></div>
    <div style="padding:0 18px 16px">
      <div class="bar-title">难度分布</div>
      ${buckets.map(([label, n]) => bar(label, n, maxRatingCount)).join('')}
      <div class="bar-title">高频标签</div>
      ${topTags.length ? topTags.map(([label, n]) => bar(label, n, maxTagCount)).join('') : '<div class="tiny muted">暂无标签数据</div>'}
    </div>`;
}

function renderHero(user, submissions) {
  const accepted = new Set(submissions.filter((s) => s.verdict === 'OK').map((s) => `${s.problem.contestId}${s.problem.index}`)).size;
  const color = ratingColor(user.rating);
  $('#dash-hero').innerHTML = `
    <div class="hero-top">
      <img class="hero-avatar" src="${esc(user.avatar)}" alt="">
      <div>
        <div class="hero-name">${esc(user.handle)}</div>
        <div class="hero-rank ${rankClass(user.rank)}">${esc(user.rank || 'unrated')} ${user.maxRating ? `· 峰值 ${esc(user.maxRank)}` : ''}</div>
        <div class="hero-meta">${esc([user.city, user.country, user.organization].filter(Boolean).join(' · ') || 'Codeforces 选手')}</div>
      </div>
    </div>
    <div class="hero-rating">
      <span class="big rating" style="color:${color}">${user.rating ?? '—'}</span>
      <span class="delta">${user.rating != null && user.maxRating != null ? `历史最高 ${user.maxRating}` : ''}</span>
    </div>
    <div class="hero-stats">
      <div class="hero-stat"><div class="v">${accepted}</div><div class="k">近期通过题目</div></div>
      <div class="hero-stat"><div class="v">${user.friendOfCount ?? 0}</div><div class="k">关注者</div></div>
      <div class="hero-stat"><div class="v">${user.contribution ?? 0}</div><div class="k">贡献值</div></div>
    </div>`;
}

function renderChart(ratings, chartSel = '#dash-chart', metaSel = '#chart-meta') {
  const container = $(chartSel);
  const gradientId = `chartFill_${chartSel.replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!ratings?.length) { container.innerHTML = '<div class="empty">还没有评分记录</div>'; return; }
  const W = 760, H = 180, LEFT = 40, RIGHT = 12, TOP = 12, BOTTOM = 24;
  const values = ratings.map((r) => r.newRating);
  let min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max(60, (max - min) * .15);
  min = Math.floor((min - pad) / 100) * 100;
  max = Math.ceil((max + pad) / 100) * 100;
  const x = (i) => LEFT + (W - LEFT - RIGHT) * (values.length === 1 ? 0 : i / (values.length - 1));
  const y = (v) => TOP + (H - TOP - BOTTOM) * (1 - (v - min) / (max - min || 1));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${LEFT},${H - BOTTOM} ${points} ${x(values.length - 1).toFixed(1)},${H - BOTTOM}`;
  const grid = [0, .25, .5, .75, 1].map((t) => {
    const gy = TOP + (H - TOP - BOTTOM) * t;
    const gv = Math.round(max - (max - min) * t);
    return `<line x1="${LEFT}" y1="${gy}" x2="${W - RIGHT}" y2="${gy}" stroke="rgba(255,255,255,.055)" stroke-width="1"/>
            <text x="4" y="${gy + 4}" fill="#64718a" font-size="10" font-family="Consolas,monospace">${gv}</text>`;
  }).join('');
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff5b5f" stop-opacity=".32"/>
        <stop offset="100%" stop-color="#ff5b5f" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${area}" fill="url(#${gradientId})"/>
      <polyline points="${points}" fill="none" stroke="#ff6b6f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(values.length - 1)}" cy="${y(values.at(-1))}" r="4" fill="#ff6b6f" stroke="#121824" stroke-width="2"/>
    </svg>`;
  $(metaSel).textContent = `${ratings.length} 场比赛 · ${fmtDate(ratings[0].ratingUpdateTimeSeconds, false)} → ${fmtDate(ratings.at(-1).ratingUpdateTimeSeconds, false)}`;
}

function contestCompact(contest) {
  const phase = contest.phase;
  const badge = phase === 'CODING' ? '<span class="pill live">LIVE</span>'
    : phase === 'BEFORE' ? '<span class="pill soon">UPCOMING</span>' : '<span class="pill done">FINISHED</span>';
  return `<div class="compact-row row-click" data-contest="${contest.id}">
      <div class="c-main"><div class="c-title">${esc(contest.name)}</div>
      <div class="c-sub">${badge} #${contest.id} · ${esc(contest.type)} · ${Math.round(contest.durationSeconds / 3600)}h</div></div>
      <span class="countdown ${phase === 'CODING' ? 'live' : ''}" data-countdown="${contest.startTimeSeconds}" data-duration="${contest.durationSeconds}" data-phase="${phase}">${countdown(contest.startTimeSeconds, contest.durationSeconds, phase)}</span>
    </div>`;
}

function subCompact(sub) {
  const verdict = sub.verdict;
  const cls = verdict === 'OK' ? 'ok' : (!verdict || verdict === 'TESTING') ? 'wait' : 'bad';
  const label = verdict || 'TESTING';
  return `<div class="compact-row row-click" data-submission="${sub.problem.contestId}|${sub.id}" title="查看这次提交的评测详情">
      <div class="c-main"><div class="c-title">${esc(sub.problem.name)}</div>
      <div class="c-sub">${sub.problem.contestId}${esc(sub.problem.index)} · ${fmtDate(sub.creationTimeSeconds)}</div></div>
      <span class="verdict ${cls}">${esc(label)}</span>
    </div>`;
}

function bindCompactLinks() {
  $$('[data-contest]').forEach((el) => el.addEventListener('click', (e) => openLink(e, `/contest/${el.dataset.contest}`)));
  $$('[data-problem]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const [id, index] = el.dataset.problem.split('|');
    openStatement(id, index);
  }));
  $$('[data-submit]').forEach((el) => el.addEventListener('click', (e) => {
    const [id, index] = el.dataset.submit.split('|');
    openLink(e, `/problemset/problem/${id}/${index}`);
  }));
  $$('[data-submission]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openSubmissionDetail(el.dataset.submission.split('|')[1]);
  }));
}

/* ---------------- contests ---------------- */
async function loadContests(force = false) {
  const target = $('#contest-grid');
  target.innerHTML = '<div class="skeleton tall"></div>';
  try {
    const contests = await get('contest.list', {}, force);
    state.contests = contests;
    renderContests();
  } catch (error) { target.innerHTML = errorHTML(error); }
}

function renderContests() {
  const list = (state.contests || []).filter((c) => state.contestPhase === 'FINISHED'
    ? c.phase === 'FINISHED'
    : c.phase === state.contestPhase);
  const shown = state.contestPhase === 'FINISHED' ? list.slice(0, 30) : list;
  $('#contest-grid').innerHTML = shown.length ? shown.map((contest) => `
    <div class="contest-card row-click" data-contest="${contest.id}">
      <div class="cc-top">
        <span class="pill ${contest.phase === 'CODING' ? 'live' : contest.phase === 'BEFORE' ? 'soon' : 'done'}">${esc(contest.phase)}</span>
        <span class="tiny muted">#${contest.id}</span>
      </div>
      <h3>${esc(contest.name)}</h3>
      <div class="cc-meta">
        <span>${esc(contest.type)} · ${Math.round(contest.durationSeconds / 3600)}h</span>
        <span class="countdown ${contest.phase === 'CODING' ? 'live' : ''}" data-countdown="${contest.startTimeSeconds}" data-duration="${contest.durationSeconds}" data-phase="${contest.phase}">${countdown(contest.startTimeSeconds, contest.durationSeconds, contest.phase)}</span>
      </div>
    </div>`).join('') : '<div class="empty">这个分类下暂时没有比赛</div>';
  bindCompactLinks();
}

/* ---------------- problems ---------------- */
async function loadProblems(force = false) {
  const target = $('#problem-list');
  target.innerHTML = '<div class="skeleton"></div>';
  try {
    const data = await get('problemset.problems', {}, force);
    state.problems = data.problems || [];
    const rated = state.problems.filter((p) => p.rating != null).length;
    $('#problem-stats').textContent = `共 ${state.problems.length.toLocaleString()} 题 · ${rated.toLocaleString()} 题已评分 · 本地分页，筛选不额外请求 API`;
    buildTagOptions();
    renderProblems();
  } catch (error) { target.innerHTML = errorHTML(error); }
}

function buildTagOptions() {
  const counts = new Map();
  (state.problems || []).forEach((p) => (p.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('#problem-tags').innerHTML = '<option value="all">全部标签</option>' + top
    .map(([tag, count]) => `<option value="${esc(tag)}">${esc(tag)} (${count})</option>`).join('');
  renderQuickTags(top.slice(0, 12));
  renderSearchHistory();
}

function renderQuickTags(top) {
  if (!top) {
    const counts = new Map();
    (state.problems || []).forEach((p) => (p.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
    top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }
  const current = $('#problem-tags').value;
  $('#quick-tags').innerHTML = top.map(([tag]) =>
    `<button class="quick-tag ${tag === current ? 'active' : ''}" data-tag="${esc(tag)}">${esc(tag)}</button>`).join('');
}

function renderSearchHistory() {
  $('#search-history').innerHTML = state.searchHistory.length
    ? state.searchHistory.map((query) => `<button class="history-chip" data-query="${esc(query)}">${esc(query)}</button>`).join('')
    : '<span class="tiny">暂无</span>';
}

function pushSearchHistory(query) {
  const clean = query.trim();
  if (!clean) return;
  state.searchHistory = [clean, ...state.searchHistory.filter((item) => item !== clean)].slice(0, 8);
  localStorage.setItem('cf.searchHistory', JSON.stringify(state.searchHistory));
  renderSearchHistory();
}

function showRandomProblem() {
  if (!state.problems) { status('题库还没加载完'); return; }
  const list = filteredProblems();
  if (!list.length) { status('当前筛选条件下没有题目'); return; }
  const p = list[Math.floor(Math.random() * list.length)];
  const card = $('#random-card');
  card.innerHTML = `
    <div class="rc-main">
      <div class="rc-label">随机一题 · 从当前 ${list.length} 个结果中抽取</div>
      <div class="rc-title">${esc(p.name)}</div>
      <div class="rc-meta">${p.contestId}${esc(p.index)} · <span style="color:${ratingColor(p.rating)}">${p.rating ?? '未评分'}</span> · ${(p.tags || []).slice(0, 4).map((t) => esc(t)).join(' / ')}</div>
    </div>
    <button class="submit-link" data-submit="${p.contestId}|${esc(p.index)}">提交 ↗</button>
    <button class="text-btn" data-random-close>收起</button>`;
  card.classList.remove('hidden');
  bindCompactLinks();
}

function filteredProblems() {
  const query = $('#problem-search').value.trim().toLowerCase();
  const allRatings = $('#problem-rating').value === 'all';
  const [low, high] = (allRatings ? [0, 9999] : $('#problem-rating').value.split('-').map(Number));
  const tag = $('#problem-tags').value;
  const sort = $('#problem-sort').value;
  const list = (state.problems || []).filter((p) => {
    if (query && !`${p.contestId}${p.index} ${p.name}`.toLowerCase().includes(query)) return false;
    if (!allRatings && (p.rating == null || p.rating < low || p.rating > high)) return false;
    if (tag !== 'all' && !(p.tags || []).includes(tag)) return false;
    return true;
  });
  if (sort === 'rating-desc') list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.contestId - a.contestId);
  else if (sort === 'rating-asc') list.sort((a, b) => (a.rating ?? -1) - (b.rating ?? -1) || b.contestId - a.contestId);
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => b.contestId - a.contestId || b.index.localeCompare(a.index));
  return list;
}

function renderProblems() {
  if (!state.problems) return;
  const list = filteredProblems();
  const size = state.problemPageSize;
  const pages = Math.max(1, Math.ceil(list.length / size));
  state.problemPage = Math.min(state.problemPage, pages);
  const slice = list.slice((state.problemPage - 1) * size, state.problemPage * size);
  $('#problem-list').innerHTML = slice.length ? slice.map((p) => `
    <div class="row row-click" data-problem="${p.contestId}|${esc(p.index)}">
      <div><div class="row-title">${esc(p.name)}</div><div class="row-sub">${p.contestId}${esc(p.index)}</div></div>
      <div class="rating" style="color:${ratingColor(p.rating)}">${p.rating ?? '—'}</div>
      <div>${(p.tags || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div><button class="submit-link" data-submit="${p.contestId}|${esc(p.index)}" title="在 Codeforces 打开题目页并提交代码">提交 ↗</button></div>
    </div>`).join('') : '<div class="empty">没有匹配题目。新比赛题目通常还没有 rating，试试「全部难度」以外的筛选项。</div>';
  bindCompactLinks();

  const windowSize = 5;
  let start = Math.max(1, state.problemPage - 2);
  start = Math.min(start, Math.max(1, pages - windowSize + 1));
  const nums = Array.from({ length: Math.min(windowSize, pages) }, (_, i) => start + i);
  $('#problem-pager').innerHTML = `
    <button data-page="prev" ${state.problemPage === 1 ? 'disabled' : ''}>‹</button>
    ${nums.map((n) => `<button data-page="${n}" class="${n === state.problemPage ? 'active' : ''}">${n}</button>`).join('')}
    <button data-page="next" ${state.problemPage === pages ? 'disabled' : ''}>›</button>
    <span class="page-info">${list.length ? (state.problemPage - 1) * size + 1 : 0}–${Math.min(state.problemPage * size, list.length)} / ${list.length}</span>`;
}

/* ---------------- submissions ---------------- */
async function loadSubmissions(force = false) {
  const target = $('#sub-list');
  target.innerHTML = '<div class="skeleton"></div>';
  $('#sub-title').textContent = `${state.handle} · 最近 50 条提交`;
  try {
    state.submissions = await get('user.status', { handle: state.handle, from: 1, count: 50 }, force);
    indexSubmissions(state.submissions);
    renderSubmissions();
  } catch (error) { target.innerHTML = errorHTML(error); }
}

function verdictInfo(verdict) {
  if (verdict === 'OK') return { cls: 'ok', label: 'ACCEPTED' };
  if (!verdict || verdict === 'TESTING') return { cls: 'wait', label: 'PENDING' };
  return { cls: 'bad', label: verdict.replace(/_/g, ' ') };
}

function renderSubmissions() {
  const list = (state.submissions || []).filter((s) => {
    if (state.subVerdict === 'all') return true;
    const v = verdictInfo(s.verdict);
    if (state.subVerdict === 'OK') return s.verdict === 'OK';
    if (state.subVerdict === 'FAILED') return v.cls === 'bad';
    return v.cls === 'wait';
  });
  $('#sub-list').innerHTML = list.length ? list.map((s) => {
    const v = verdictInfo(s.verdict);
    return `<div class="row row-click" data-submission="${s.problem.contestId}|${s.id}" title="查看这次提交的评测详情">
      <div><div class="row-title">${esc(s.problem.name)}</div>
        <div class="row-sub">${s.problem.contestId}${esc(s.problem.index)} · #${s.id} · ${esc((s.programmingLanguage || '').split('(')[0].trim())}</div></div>
      <span class="verdict ${v.cls}">${v.label}</span>
      <div class="row-sub">${esc((s.programmingLanguage || '').match(/\([^)]*\)/)?.[0] || s.programmingLanguage || '')}<br>${fmtDate(s.creationTimeSeconds)}</div>
      <div class="row-sub">${s.timeConsumedMillis != null ? s.timeConsumedMillis + 'ms' : '—'}</div>
    </div>`;
  }).join('') : '<div class="empty">没有符合条件的提交</div>';
  bindCompactLinks();
}

/* ---------------- submission detail slide-over ---------------- */
function indexSubmissions(list) {
  (list || []).forEach((s) => {
    if (s && s.id != null) state.submissionIndex.set(String(s.id), s);
  });
}

const VERDICT_CN = {
  OK: '通过', COMPILATION_ERROR: '编译错误', WRONG_ANSWER: '答案错误',
  TIME_LIMIT_EXCEEDED: '超出时间限制', MEMORY_LIMIT_EXCEEDED: '超出内存限制',
  RUNTIME_ERROR: '运行时错误', PRESENTATION_ERROR: '输出格式错误',
  TESTING: '判定中', SKIPPED: '已跳过', CHALLENGED: '被 Hack',
  PARTIAL: '部分通过', INPUT_PREPARATION: '准备输入中'
};

function verdictDetail(verdict) {
  const base = verdictInfo(verdict);
  return { ...base, label: VERDICT_CN[verdict] || base.label };
}

function detailTrail(sub) {
  const pid = `${sub.problem?.contestId}|${sub.problem?.index}`;
  return [...state.submissionIndex.values()]
    .filter((s) => s.problem && `${s.problem.contestId}|${s.problem.index}` === pid)
    .sort((a, b) => b.id - a.id)
    .slice(0, 6);
}

function renderDetailBody(sub) {
  const v = verdictDetail(sub.verdict);
  const p = sub.problem || {};
  const emblem = v.cls === 'ok' ? '✓' : v.cls === 'wait' ? '◷' : '✕';
  const memory = sub.memoryConsumedBytes != null
    ? `${(sub.memoryConsumedBytes / 1048576).toFixed(1)} MB` : '—';
  const testset = sub.testset === 'PRETESTS' ? '预测试' : sub.testset === 'TESTS' ? '正式测试' : '—';
  const trail = detailTrail(sub);
  const rating = p.rating != null
    ? `<span class="tag" style="color:${ratingColor(p.rating)}">${p.rating}</span>` : '';

  state.detailPath = `/contest/${sub.contestId}/submission/${sub.id}`;
  $('#detail-body').innerHTML = `
    <div class="detail-stagger">
      <section class="detail-hero">
        <div class="detail-emblem ${v.cls}">${emblem}</div>
        <div class="detail-hero-main">
          <div class="detail-verdict ${v.cls}">${esc(v.label)}</div>
          <div class="detail-problem" title="${esc(p.name)}">${esc(p.name || '未知题目')}</div>
          <div class="detail-problem-meta">
            <span class="code">${p.contestId}${esc(p.index)}</span><span class="dot">·</span>
            <span>比赛 ${sub.contestId}</span>${rating}
            <span class="dot">·</span><span>#${sub.id}</span>
          </div>
        </div>
      </section>

      <div>
        <div class="detail-section-title">评测数据</div>
        <div class="detail-metrics">
          <div class="detail-metric"><div class="v">${sub.timeConsumedMillis ?? '—'}<span style="font-size:11px;color:var(--dim)"> ms</span></div><div class="k">运行耗时</div></div>
          <div class="detail-metric"><div class="v">${esc(memory)}</div><div class="k">峰值内存</div></div>
          <div class="detail-metric"><div class="v">${sub.passedTestCount ?? '—'}</div><div class="k">通过测试点</div><div class="sub">${esc(testset)}</div></div>
          <div class="detail-metric"><div class="v">${sub.points ?? '—'}</div><div class="k">本题得分</div></div>
        </div>
      </div>

      <div>
        <div class="detail-section-title">时间线</div>
        <div class="detail-timeline">
          <div class="tl-node"><div class="tl-time">${fmtDate(sub.creationTimeSeconds)}</div><div class="tl-label">提交</div></div>
          <div class="tl-arrow"></div>
          <div class="tl-node"><div class="tl-time">${judge(sub)}</div><div class="tl-label">判定${sub.judgedTimeSeconds ? '完成' : '中'}</div></div>
        </div>
      </div>

      <div>
        <div class="detail-section-title">提交信息</div>
        <div class="detail-meta-grid">
          <div class="dm"><span class="k">语言</span><span class="v" title="${esc(sub.programmingLanguage)}">${esc(sub.programmingLanguage || '—')}</span></div>
          <div class="dm"><span class="k">测试集</span><span class="v">${esc(testset)}</span></div>
          <div class="dm"><span class="k">提交者</span><span class="v">${esc(sub.author?.handle || state.handle)}</span></div>
          <div class="dm"><span class="k">提交编号</span><span class="v">${sub.id}</span></div>
        </div>
        <p class="detail-note">Codeforces 公开 API 只返回评测元数据，不含源码和逐测试点日志。完整提交（含代码、编译信息与测试点）需要到网页查看。<span id="detail-sync-tag"></span></p>
      </div>

      <div>
        <div class="detail-section-title">同题提交轨迹</div>
        <div class="detail-trail">${trail.length ? trail.map((s) => {
          const tv = verdictDetail(s.verdict);
          return `<div class="detail-trail-row ${String(s.id) === String(sub.id) ? 'current' : ''}" data-detail-sub="${s.id}">
            <span class="tt-id">#${s.id}</span>
            <span class="verdict ${tv.cls}">${esc(tv.label)}</span>
            <span class="tt-time">${fmtDate(s.creationTimeSeconds)}</span>
            <span class="tt-cost">${s.timeConsumedMillis ?? '—'}ms</span>
          </div>`;
        }).join('') : '<div class="empty">这条题目暂无其他提交</div>'}</div>
        <div class="detail-actions">
          <button class="primary-btn" id="detail-open-code">查看源码与测试点 ↗</button>
          <button class="ghost-btn" id="detail-back-bottom">返回列表</button>
        </div>
      </div>
    </div>`;
}

function judge(sub) {
  return sub.judgedTimeSeconds ? fmtDate(sub.judgedTimeSeconds) : fmtDate(sub.creationTimeSeconds);
}

let lastDetailSync = 0;
async function syncDetail(id) {
  if (Date.now() - lastDetailSync < 4000) return;
  lastDetailSync = Date.now();
  $('#detail-progress').classList.add('on');
  try {
    const fresh = await api('user.status', { handle: state.handle, from: 1, count: 50 }, true);
    indexSubmissions(fresh);
    if (!state.detail || String(state.detail.id) !== String(id)) return;
    const updated = state.submissionIndex.get(String(id));
    if (updated) {
      state.detail = updated;
      renderDetailBody(updated);
      const tag = $('#detail-sync-tag');
      if (tag) tag.innerHTML = '<span class="detail-sync">已同步最新判定</span>';
    }
  } catch {
    // 详情用的本地数据已经够用，同步失败不打断体验
  } finally {
    $('#detail-progress').classList.remove('on');
  }
}

function openSubmissionDetail(id) {
  const sub = state.submissionIndex.get(String(id));
  if (!sub) { status('找不到这条提交，请先打开提交记录加载'); return; }
  clearTimeout(state.detailCloseTimer);
  state.detail = sub;
  $('#detail-sub-id').textContent = `#${sub.id}`;
  renderDetailBody(sub);
  const root = $('#sub-detail');
  root.classList.add('mounted');
  root.setAttribute('aria-hidden', 'false');
  void root.offsetWidth; // 强制刷新初始 transform，保证 transition 一定跑
  root.classList.add('open');
  syncDetail(sub.id);
}

function closeSubmissionDetail() {
  const root = $('#sub-detail');
  if (!root.classList.contains('mounted')) return;
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  clearTimeout(state.detailCloseTimer);
  state.detailCloseTimer = setTimeout(() => root.classList.remove('mounted'), 520);
}

/* ---------------- problem statement (Jina Reader) ---------------- */
function statementInline(text) {
  return esc(text)
    .replace(/\\langle/g, '⟨').replace(/\\rangle/g, '⟩')
    .replace(/\\leq/g, '≤').replace(/\\le\b/g, '≤')
    .replace(/\\geq/g, '≥').replace(/\\ge\b/g, '≥')
    .replace(/\\cdot/g, '·').replace(/\\ldots/g, '…').replace(/\\times/g, '×')
    .replace(/\\bmod/g, ' mod ').replace(/\\neq?(\b|$)/g, '≠').replace(/\\bmod\b/g, ' mod ')
    .replace(/\\max\b/g, 'max').replace(/\\min\b/g, 'min').replace(/\\gcd\b/g, 'gcd').replace(/\\sum\b/g, 'Σ')
    .replace(/\\left|\\right|\\,|\\!|\\ /g, '')
    .replace(/_\{_\{([^}]*)\}\}/g, '<sub>$1</sub>')
    .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
    .replace(/_([a-zA-Z0-9])\b/g, '<sub>$1</sub>')
    .replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>')
    .replace(/\^([a-zA-Z0-9])\b/g, '<sup>$1</sup>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\$([^$]+)\$/g, '<span class="math">$1</span>');
}

function renderStatementMarkdown(md) {
  const out = [];
  let para = [], list = false, pre = [], fence = false;
  const flushPara = () => {
    if (para.length) { out.push(`<p>${statementInline(para.join(' '))}</p>`); para = []; }
  };
  const flushList = () => { if (list) { out.push('</ul>'); list = false; } };
  const flushPre = () => {
    if (pre.length) { out.push(`<pre>${esc(pre.join('\n'))}</pre>`); pre = []; }
  };
  for (const raw of (md || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim() === 'Copy') { flushPara(); flushList(); flushPre(); continue; }
    if (/^```/.test(line.trim())) {
      if (pre.length) { flushPre(); } else { flushPara(); flushList(); fence = true; }
      continue;
    }
    if (fence) { pre.push(line); continue; }
    if (/^#{1,3}\s+/.test(line.trim())) {
      flushPara(); flushList(); flushPre();
      const level = Math.min(line.trim().match(/^#+/)[0].length + 1, 4);
      out.push(`<h${level}>${statementInline(line.trim().replace(/^#+\s+/, ''))}</h${level}>`);
      continue;
    }
    if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      flushPara(); flushList(); flushPre();
      out.push(`<p class="st-label">${statementInline(line.trim())}</p>`);
      continue;
    }
    if (/^_([^_]+)_$/.test(line.trim())) {
      flushPara(); flushList(); flushPre();
      out.push(`<p class="st-limits">${esc(line.trim().replace(/^_|_$/g, ''))}</p>`);
      continue;
    }
    if (/^(Input|Output|Example|Examples|Note|Explanation|Constraints)$/i.test(line.trim())) {
      flushPara(); flushList(); flushPre();
      out.push(`<h3>${esc(line.trim())}</h3>`);
      continue;
    }
    if (/^(\*|-)\s+/.test(line)) {
      flushPara(); flushPre();
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${statementInline(line.replace(/^(\*|-)\s+/, ''))}</li>`);
      continue;
    }
    // 样例数据行：纯数字/空格/小数点，聚合成代码块
    if (/^[\d\s.\-+]+$/.test(line) && /\d/.test(line)) {
      flushPara(); flushList();
      pre.push(line);
      continue;
    }
    flushList(); flushPre();
    para.push(line.trim());
  }
  flushPara(); flushList(); flushPre();
  return `<div class="statement-body">${out.join('')}</div>`;
}

function renderStatementHero(p) {
  const rating = p.rating != null ? `<span class="tag" style="color:${ratingColor(p.rating)}">${p.rating}</span>` : '';
  const tags = (p.tags || []).slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `<div class="statement-hero detail-stagger">
    <h2>${esc(p.name || '未知题目')}</h2>
    <div class="sh-meta"><span class="sh-code">${p.contestId}${esc(p.index)}</span>${rating}${tags}</div>
  </div>`;
}

async function openStatement(contestId, index) {
  const p = (state.problems || []).find((x) => String(x.contestId) === String(contestId) && x.index === index)
    || { contestId, index, name: `${contestId}${index}`, tags: [] };
  clearTimeout(state.statementCloseTimer);
  state.statementPath = `/problemset/problem/${contestId}/${index}`;
  $('#statement-code').textContent = `${contestId}${index}`;
  $('#statement-content').innerHTML = `${renderStatementHero(p)}
    <div class="statement-loading detail-stagger"><span class="spinner"></span><span>正在从第三方题面源加载 ${contestId}${index}…</span></div>`;
  const root = $('#statement-detail');
  root.classList.add('mounted');
  root.setAttribute('aria-hidden', 'false');
  void root.offsetWidth;
  root.classList.add('open');
  $('#statement-progress').classList.add('on');
  try {
    const result = await window.desktop.statement(contestId, index);
    if (!result.ok) throw new Error(result.error);
    $('#statement-content').innerHTML = `${renderStatementHero(p)}
      ${renderStatementMarkdown(result.content)}
      <p class="statement-source">${result.source === 'jina' ? '直连不可用，题面由第三方服务 Jina Reader 代理获取' : '题面直连 Codeforces 官网解析获取'}${result.cached ? ' · 命中本地缓存' : ''}</p>
      <div class="detail-actions"><button class="primary-btn" id="statement-write-bottom">写代码 ✎</button><button class="ghost-btn" id="statement-open-code">在 Codeforces 打开原题 ↗</button><button class="ghost-btn" id="statement-back-bottom">返回列表</button></div>`;
  } catch (error) {
    $('#statement-content').innerHTML = `${renderStatementHero(p)}
      <div class="error-box detail-stagger">题面加载失败：${esc(error?.message || error)}<br><span class="tiny">第三方服务可能限流或暂时不可用，稍后重试或直接打开原网页。</span></div>
      <div class="detail-actions"><button class="primary-btn" id="statement-open-code">在 Codeforces 打开原题 ↗</button><button class="ghost-btn" id="statement-back-bottom">返回列表</button></div>`;
  } finally {
    $('#statement-progress').classList.remove('on');
  }
}

function closeStatement() {
  const root = $('#statement-detail');
  if (!root.classList.contains('mounted')) return;
  closeEditor(true);
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  clearTimeout(state.statementCloseTimer);
  state.statementCloseTimer = setTimeout(() => root.classList.remove('mounted'), 520);
}

/* ---------------- code editor ---------------- */
const DEFAULT_TEMPLATES = {
  'gnu-c++20': '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  'gnu-c++17': '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  'python3.8': 'import sys\n\n\ndef main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  'pypy3.10': 'import sys\n\n\ndef main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  'java17': 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n',
  'rust2021': 'use std::io;\n\nfn main() {\n    \n}\n'
};

function draftKey() {
  return state.editorProblem ? `cf.draft.${state.editorProblem.contestId}${state.editorProblem.index}` : '';
}

function editorUpdateStats() {
  const text = $('#editor-textarea').value;
  const lines = text === '' ? 0 : text.split('\n').length;
  $('#editor-stats').textContent = `${lines} 行 · ${text.length} 字符`;
}

function editorScheduleSave() {
  clearTimeout(state.editorSaveTimer);
  $('#editor-saved').textContent = '保存中…';
  state.editorSaveTimer = setTimeout(() => {
    const key = draftKey();
    if (!key) return;
    const value = $('#editor-textarea').value;
    if (value.trim()) localStorage.setItem(key, JSON.stringify({ code: value, lang: $('#editor-lang').value, at: Date.now() }));
    else localStorage.removeItem(key);
    $('#editor-saved').textContent = '已保存';
  }, 600);
}

function openEditor() {
  if (!state.statementPath) return;
  const m = state.statementPath.match(/problemset\/problem\/(\d+)\/(\w+)/);
  if (!m) return;
  state.editorProblem = { contestId: m[1], index: m[2] };
  $('#editor-code').textContent = `${m[1]}${m[2]}`;

  const saved = JSON.parse(localStorage.getItem(draftKey()) || 'null');
  const lang = saved?.lang || $('#editor-lang').value;
  $('#editor-lang').value = DEFAULT_TEMPLATES[lang] ? lang : 'gnu-c++17';
  const ta = $('#editor-textarea');
  ta.value = saved?.code ?? DEFAULT_TEMPLATES[$('#editor-lang').value] ?? '';
  editorUpdateStats();
  $('#editor-saved').textContent = saved ? '已恢复草稿' : '已保存';

  const sroot = $('#statement-detail');
  const eroot = $('#editor-root');
  eroot.classList.add('mounted');
  eroot.setAttribute('aria-hidden', 'false');
  void eroot.offsetWidth;
  sroot.classList.add('editor-mode');
  eroot.classList.add('open');
  setTimeout(() => ta.focus(), 480);
}

function closeEditor(keepStatement = false) {
  const root = $('#editor-root');
  if (!root.classList.contains('mounted')) return;
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  $('#statement-detail').classList.remove('editor-mode');
  setTimeout(() => root.classList.remove('mounted'), 520);
}

async function submitFromEditor() {
  const code = $('#editor-textarea').value;
  if (!code.trim()) { status('代码是空的，先写点什么再提交'); return; }
  if (!state.editorProblem) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(code);
    copied = true;
  } catch {
    const ta = $('#editor-textarea');
    ta.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    window.getSelection()?.removeAllRanges();
  }
  status(copied ? '代码已复制到剪贴板，正在打开 Codeforces 提交页…' : '复制失败，请在编辑器手动全选复制，正在打开提交页…');
  const url = `https://codeforces.com/contest/${state.editorProblem.contestId}/submit/${state.editorProblem.index}`;
  await window.desktop.openExternal(url);
}

/* ---------------- users ---------------- */
async function loadUsers(force = false) {
  const target = $('#user-grid');
  target.innerHTML = '<div class="skeleton tall"></div>';
  try {
    const users = await get('user.info', { handles: state.watchlist.join(';') }, force);
    target.innerHTML = users.length ? users.map((u) => `
      <div class="user-card ${u.handle.toLowerCase() === state.handle ? 'current' : ''}">
        <div class="uc-top">
          <img src="${esc(u.avatar)}" alt="" loading="lazy">
          <div style="min-width:0">
            <div class="uc-name">${esc(u.handle)}</div>
            <div class="uc-rank ${rankClass(u.rank)}">${esc(u.rank || 'unrated')}</div>
          </div>
          <div class="uc-rating"><div class="v" style="color:${ratingColor(u.rating)}">${u.rating ?? '—'}</div><div class="k">峰值 ${u.maxRating ?? '—'}</div></div>
        </div>
        <div class="uc-actions">
          <button data-select="${esc(u.handle)}">设为当前</button>
          <button data-open="${esc(u.handle)}">打开主页 ↗</button>
          <button class="danger" data-remove="${esc(u.handle)}">移除</button>
        </div>
      </div>`).join('') : '<div class="empty">关注列表是空的，先添加一个 handle</div>';
    $$('[data-select]', target).forEach((btn) => btn.addEventListener('click', () => setHandle(btn.dataset.select)));
    $$('[data-open]', target).forEach((btn) => btn.addEventListener('click', (e) => openLink(e, `/profile/${btn.dataset.open}`)));
    $$('[data-remove]', target).forEach((btn) => btn.addEventListener('click', () => {
      state.watchlist = state.watchlist.filter((h) => h !== btn.dataset.remove);
      localStorage.setItem('cf.watchlist', JSON.stringify(state.watchlist));
      renderSideWatch(); loadUsers(true);
    }));
  } catch (error) {
    target.innerHTML = errorHTML(error) + '<div class="empty tiny">批量查询里只要有一个 handle 写错，整个请求就会失败。删掉出错的 handle 再试。</div>';
  }
}

async function loadTop(force = false) {
  const target = $('#top-list');
  target.innerHTML = '<div class="skeleton"></div>';
  try {
    // 官方 ratedList 会忽略 from/count，一次返回全站 4 万+ 选手，这里必须自己截断
    const users = (await get('user.ratedList', { activeOnly: true, includeRetired: false }, force)).slice(0, 10);
    target.innerHTML = users.map((u, i) => `
      <div class="row row-click" data-open="${esc(u.handle)}">
        <span class="top-index">${String(i + 1).padStart(2, '0')}</span>
        <div><div class="row-title">${esc(u.handle)}</div><div class="row-sub ${rankClass(u.rank)}">${esc(u.rank)}</div></div>
        <span class="rating" style="color:${ratingColor(u.rating)}">${u.rating}</span>
        <span class="row-sub">${esc(u.country || '—')}</span>
      </div>`).join('');
    $$('[data-open]', target).forEach((el) => el.addEventListener('click', (e) => openLink(e, `/profile/${el.dataset.open}`)));
  } catch (error) { target.innerHTML = errorHTML(error); }
}

/* ---------------- auth ---------------- */
async function refreshAuthUI() {
  try {
    const info = await window.desktop.authStatus();
    $('#auth-status').className = 'auth-state' + (info.configured ? ' on' : '');
    $('#auth-status').textContent = info.configured
      ? `已启用：${info.apiKey} · 所有请求自动签名`
      : '未配置：当前走匿名公开数据';
    $('#auth-status').title = `配置文件：${info.path}`;
    $('#auth-btn').classList.toggle('auth-on', info.configured);
  } catch (error) {
    $('#auth-status').textContent = `读取配置失败：${error.message}`;
  }
}

async function saveAuth() {
  const apiKey = $('#auth-key').value.trim();
  const apiSecret = $('#auth-secret').value.trim();
  if (!apiKey || !apiSecret) { status('Key 和 Secret 都要填'); return; }
  try {
    await window.desktop.authSave({ apiKey, apiSecret });
    $('#auth-secret').value = '';
    await refreshAuthUI();
    $('#auth-modal').classList.add('hidden');
    state.store.clear();
    status('API 认证已保存，缓存已清空');
    loadView(state.view, true);
  } catch (error) { status(`保存失败：${error.message}`); }
}

async function clearAuth() {
  try {
    await window.desktop.authClear();
    $('#auth-key').value = '';
    $('#auth-secret').value = '';
    await refreshAuthUI();
    state.store.clear();
    status('已清除 API 认证，回到匿名模式');
    loadView(state.view, true);
  } catch (error) { status(`清除失败：${error.message}`); }
}

/* ---------------- events ---------------- */
$$('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$$('[data-jump]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.jump)));
$$('[data-win]').forEach((btn) => btn.addEventListener('click', () => window.desktop.window(btn.dataset.win)));

$('#handle-input').value = state.handle;
$('#status-handle').textContent = state.handle;

$('#handle-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setHandle(e.target.value);
});
$('#side-add').addEventListener('click', () => {
  switchView('users');
  setTimeout(() => $('#user-add-input').focus(), 150);
});
$('#user-add-btn').addEventListener('click', () => {
  setHandle($('#user-add-input').value);
  $('#user-add-input').value = '';
});
$('#user-add-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#user-add-btn').click();
});

$('#refresh-btn').addEventListener('click', () => {
  state.store.clear();
  loadView(state.view, true);
  if (state.view === 'users') loadTop(true);
  renderSideWatch();
});

$('#auth-btn').addEventListener('click', () => {
  refreshAuthUI();
  $('#auth-modal').classList.remove('hidden');
});
$('#auth-close').addEventListener('click', () => $('#auth-modal').classList.add('hidden'));
$('#auth-modal').addEventListener('click', (e) => {
  if (e.target === $('#auth-modal')) $('#auth-modal').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#auth-modal').classList.add('hidden');
});
$('#auth-generate').addEventListener('click', (e) => openLink(e, '/settings/api'));
$('#auth-save').addEventListener('click', saveAuth);
$('#auth-clear').addEventListener('click', clearAuth);
$('#dash-open-profile').addEventListener('click', (e) => openLink(e, `/profile/${state.handle}`));
$('#contest-refresh').addEventListener('click', () => loadContests(true));
$('#problem-refresh').addEventListener('click', () => loadProblems(true));
$('#sub-refresh').addEventListener('click', () => loadSubmissions(true));
$('#top-refresh').addEventListener('click', () => loadTop(true));
$('#profile-refresh').addEventListener('click', () => loadProfile(true));
$('#profile-submit-page').addEventListener('click', (e) => openLink(e, `/profile/${state.handle}`));
$('#problem-random').addEventListener('click', showRandomProblem);

$('#search-history').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-query]');
  if (!chip) return;
  $('#problem-search').value = chip.dataset.query;
  pushSearchHistory(chip.dataset.query);
  state.problemPage = 1;
  renderProblems();
});
$('#history-clear').addEventListener('click', () => {
  state.searchHistory = [];
  localStorage.removeItem('cf.searchHistory');
  renderSearchHistory();
});
$('#quick-tags').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  $('#problem-tags').value = chip.dataset.tag === $('#problem-tags').value ? 'all' : chip.dataset.tag;
  state.problemPage = 1;
  renderQuickTags();
  renderProblems();
});
$('#random-card').addEventListener('click', (e) => {
  if (e.target.closest('[data-random-close]')) $('#random-card').classList.add('hidden');
});
$('#problem-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pushSearchHistory(e.target.value);
});

$$('#contest-tabs button').forEach((btn) => btn.addEventListener('click', () => {
  $$('#contest-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  state.contestPhase = btn.dataset.phase;
  renderContests();
}));
$$('#sub-filters button').forEach((btn) => btn.addEventListener('click', () => {
  $$('#sub-filters button').forEach((b) => b.classList.toggle('active', b === btn));
  state.subVerdict = btn.dataset.verdict;
  renderSubmissions();
}));

['#problem-search', '#problem-rating', '#problem-tags', '#problem-sort'].forEach((sel) => {
  $(sel).addEventListener(sel === '#problem-search' ? 'input' : 'change', () => {
    state.problemPage = 1;
    if (sel === '#problem-tags') renderQuickTags();
    renderProblems();
  });
});
$('#problem-pager').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-page]');
  if (!btn || btn.disabled) return;
  const page = btn.dataset.page;
  if (page === 'prev') state.problemPage--;
  else if (page === 'next') state.problemPage++;
  else state.problemPage = Number(page);
  renderProblems();
  $('.content').scrollTop = 0;
});

// 倒计时每秒跳动，只更新数字不重绘列表
clearInterval(state.timer);
state.timer = setInterval(() => {
  $$('[data-countdown]').forEach((el) => {
    el.textContent = countdown(Number(el.dataset.countdown), Number(el.dataset.duration), el.dataset.phase);
  });
}, 1000);

$('#detail-back').addEventListener('click', closeSubmissionDetail);
$('#detail-close').addEventListener('click', closeSubmissionDetail);
$$('[data-detail-close]').forEach((el) => el.addEventListener('click', closeSubmissionDetail));
$('#detail-external').addEventListener('click', (e) => {
  if (state.detailPath) openLink(e, state.detailPath);
});
$('#detail-body').addEventListener('click', (e) => {
  const trail = e.target.closest('[data-detail-sub]');
  if (trail) { openSubmissionDetail(trail.dataset.detailSub); return; }
  if (e.target.closest('#detail-open-code') && state.detailPath) openLink(e, state.detailPath);
  if (e.target.closest('#detail-back-bottom')) closeSubmissionDetail();
});
$('#statement-back').addEventListener('click', closeStatement);
$('#statement-close').addEventListener('click', closeStatement);
$('#statement-write').addEventListener('click', openEditor);
$$('[data-statement-close]').forEach((el) => el.addEventListener('click', closeStatement));
$('#statement-external').addEventListener('click', (e) => {
  if (state.statementPath) openLink(e, state.statementPath);
});
$('#statement-content').addEventListener('click', (e) => {
  if (e.target.closest('#statement-open-code') && state.statementPath) openLink(e, state.statementPath);
  if (e.target.closest('#statement-back-bottom')) closeStatement();
  if (e.target.closest('#statement-write-bottom')) openEditor();
});
$('#editor-back').addEventListener('click', () => closeEditor());
$('#editor-submit').addEventListener('click', submitFromEditor);
$('#editor-lang').addEventListener('change', () => {
  const ta = $('#editor-textarea');
  if (ta.value.trim() === DEFAULT_TEMPLATES[Object.keys(DEFAULT_TEMPLATES).find((k) => DEFAULT_TEMPLATES[k] === ta.value)] || !ta.value.trim()) {
    ta.value = DEFAULT_TEMPLATES[$('#editor-lang').value] ?? '';
    editorUpdateStats();
  }
  editorScheduleSave();
});
$('#editor-textarea').addEventListener('input', () => { editorUpdateStats(); editorScheduleSave(); });
$('#editor-textarea').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + '    ' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + 4;
    editorUpdateStats();
    editorScheduleSave();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitFromEditor(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#editor-root').classList.contains('open')) closeEditor();
  else if ($('#statement-detail').classList.contains('open')) closeStatement();
  else if ($('#sub-detail').classList.contains('open')) closeSubmissionDetail();
});

refreshAuthUI();
renderSideWatch();
loadDashboard();
loadTop();
