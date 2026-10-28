import { store, subscribe, initStore, login, logout, save, remove, saveSettings, restoreAll, newId } from './store.js';
import {
  esc, num, won, parseNum, moneyInput, today, addDays, ymd, toDate, md, fullDate, timeLabel, weekday,
  monthStart, monthEnd, addMonths, digits, fmtPhone, matches, download,
} from './util.js';
import {
  SOURCES, STATUSES, STATUS_CLASS, PAY_METHODS, BUY_METHODS, BUY_CATS, VAT_MODES, PHOTO_STAGES, LABOR_TYPES, PAYERS, OLD_PAYER, REVIEW_WHERE,
} from './seed.js';
import {
  saleAmount, finalAmount, vatExtra, billed, paidSum, unpaid, payState, isReceivable, needsInvoice, jobPurchases, jobCost, jobProfit, feeSum,
  customerOf, custName, customerJobs, customerStats, laborCalc, inRange,
} from './calc.js';
import { uploadPhotos, deletePhotos, photoUrls, downloadOne, downloadZip, usedBytes } from './photos.js';
import { parseInquiry } from './parse.js';
import { readImageText } from './ocr.js';
import { summarize, exportExcel } from './report.js';
import { ic } from './icons.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const ME_KEY = 'hyeonjang-me';
const UI_KEY = 'hyeonjang-ui';

const ui = Object.assign(
  { sel: today(), cal: 'week', cq: '', csort: 'recent', lt: 'sales', lm: today(), lf: '전체', bf: '전체', rp: 'month', rfrom: monthStart(today()), rto: monthEnd(today()), stage: '전체' },
  (() => {
    try {
      const u = JSON.parse(localStorage.getItem(UI_KEY)) || {};
      return Object.fromEntries(['cal', 'csort'].filter((k) => u[k]).map((k) => [k, u[k]]));
    } catch (_) { return {}; }
  })(),
);
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ cal: ui.cal, csort: ui.csort })); } catch (_) {} };
const me = () => {
  try {
    const v = localStorage.getItem(ME_KEY) || '';
    return OLD_PAYER[v] || v;
  } catch (_) { return ''; }
};

// 결제자 이름 변경(남편→LEE, 아내→BEE): 예전 기록을 한 번 바꿔 저장
let payerMigrating = false;
async function migratePayers() {
  if (payerMigrating || !store.ready || (store.mode === 'cloud' && !(store.user && store.online))) return;
  const old = store.state.purchases.filter((p) => OLD_PAYER[p.payer]);
  if (!old.length) return;
  payerMigrating = true;
  try {
    for (const p of old) await save('purchases', { ...p, payer: OLD_PAYER[p.payer] });
  } finally {
    payerMigrating = false;
  }
}

/* ================= 공통 도구 ================= */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2000);
}
function openSheet(html, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-bg"><div class="sheet"><div class="grab"></div>${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  $$('[data-close]', bg).forEach((b) => (b.onclick = closeSheet));
  onMount && onMount(bg.firstElementChild);
  return bg.firstElementChild;
}
const closeSheet = () => ($('#sheet-root').innerHTML = '');
const sheetHead = (title) => `<div class="sh"><h2>${title}</h2><button class="icon-btn" data-close>${ic('x')}</button></div>`;
const chipRow = (name, opts, val, cls = '') =>
  `<div class="chips ${cls}" data-chips="${name}">${opts.map((o) => {
    const k = typeof o === 'string' ? o : o.k;
    const l = typeof o === 'string' ? o : o.label;
    return `<button type="button" class="chip ${k === val ? 'on' : ''}" data-v="${esc(k)}">${esc(l)}</button>`;
  }).join('')}</div>`;
// 칩 묶음: 하나만 고르기 (같은 걸 다시 누르면 해제 가능 옵션)
function bindChips(root, name, onChange, allowNone = false) {
  const box = $(`[data-chips="${name}"]`, root);
  if (!box) return;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    const was = b.classList.contains('on');
    $$('button', box).forEach((x) => x.classList.remove('on'));
    if (!(allowNone && was)) b.classList.add('on');
    onChange && onChange(chipVal(root, name));
  });
}
const chipVal = (root, name) => $(`[data-chips="${name}"] .on`, root)?.dataset.v || '';
const moneyField = (id, label, v) =>
  `<label class="field"><span>${label}</span><div class="money-wrap"><input id="${id}" class="money-in" inputmode="numeric" autocomplete="off" value="${v ? num(v) : ''}" placeholder="0" /><b class="unit">원</b></div></label>`;
const statusPill = (s) => `<span class="pill ${STATUS_CLASS[s] || ''}">${esc(s)}</span>`;
const vatShort = (k) => ({ incl: '부가세 포함', none: '부가세 없음', excl: '부가세 별도' }[k || 'none']);
const amt = (n) => `${num(n)}<small>원</small>`;
const short = (n) => {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}<small>억</small>`;
  if (Math.abs(n) >= 10000) return `${num(Math.round(n / 1000) / 10)}<small>만</small>`;
  return `${num(n)}<small>원</small>`;
};
// 비율 표시: 23.4%
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace(/\.0$/, '')}%` : '–');
const initial = (c) => esc((c?.name || c?.region || '?').trim().slice(0, 1));

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });

/* ================= 렌더링 ================= */
// 같은 순간에 여러 번 불려도 한 번만 그림
let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    doRender();
  });
}
function route() {
  const [r, arg] = (location.hash.slice(1) || 'schedule').split('/');
  return { r, arg: arg ? decodeURIComponent(arg) : '' };
}
function doRender() {
  const { r, arg } = route();
  const tab = { schedule: 'schedule', job: 'schedule', customers: 'customers', customer: 'customers', ledger: 'ledger', report: 'report', settings: 'settings' }[r] || 'schedule';
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (!store.ready) {
    view.innerHTML = '<div class="empty" style="padding-top:40vh">불러오는 중…</div>';
    return;
  }
  if (store.mode === 'cloud' && !store.user) return renderLogin();
  $('#tabbar').hidden = false;
  $('#fab').hidden = ['job', 'customer', 'settings'].includes(r);
  const fn = { schedule: renderSchedule, job: () => renderJob(arg), customers: renderCustomers, customer: () => renderCustomer(arg), ledger: renderLedger, report: renderReport, settings: renderSettings }[r] || renderSchedule;
  fn();
}
subscribe(() => {
  // 입력 중인 시트는 그대로 두고 뒤 화면만 새로
  render();
  migratePayers();
});

function syncBadge() {
  if (store.mode !== 'cloud') return '<span class="sync">이 기기에만 저장</span>';
  if (!store.online || store.pending) return `<span class="sync off">${ic('cloud')} 오프라인${store.pending ? ` · 올릴 변경 ${store.pending}` : ''}</span>`;
  return '';
}

/* ---------- 로그인 ---------- */
function renderLogin() {
  $('#tabbar').hidden = true;
  $('#fab').hidden = true;
  view.innerHTML = `
    <div class="login">
      <div class="logo">${ic('cal')}</div>
      <h1>하이집수리 현장장부</h1>
      <p class="lead">견적 앱과 같은 계정으로 로그인하세요.</p>
      <label class="field"><span>이메일</span><input id="lg-email" type="email" autocomplete="username" /></label>
      <label class="field"><span>비밀번호</span><input id="lg-pw" type="password" autocomplete="current-password" /></label>
      <button class="btn block" id="lg-btn">로그인</button>
      <p class="hint">한 번 로그인하면 계속 유지됩니다.</p>
    </div>`;
  $('#lg-btn').onclick = async () => {
    try {
      await login($('#lg-email').value.trim(), $('#lg-pw').value);
    } catch (e) {
      alert('로그인 실패: 이메일과 비밀번호를 확인해 주세요.');
    }
  };
}

/* ================= ① 일정 ================= */
const activeJobs = () => store.state.jobs.filter((j) => j.status !== '취소');
const jobsOn = (d) => store.state.jobs.filter((j) => j.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99');

function jobCard(j, showDate = false) {
  const c = customerOf(j);
  const st = customerStats(j.customerId);
  const b = billed(j);
  const ps = payState(j);
  const money = b
    ? `<div class="money-line"><span class="money">${won(b)}</span>${ps === '완납' ? '<span class="pill green">완납</span>' : isReceivable(j) ? `<span class="pill red">미수 ${num(unpaid(j))}</span>` : ''}${needsInvoice(j) ? '<span class="pill orange">계산서 미발행</span>' : ''}</div>`
    : '';
  return `<button class="job ${STATUS_CLASS[j.status] || ''}" data-go="#job/${j.id}">
    <div class="t">${showDate ? `${j.date ? md(j.date).replace(/\(.\)/, '') : '미정'}<small>${j.time ? j.time : j.date ? weekday(j.date) + '요일' : ''}</small>` : j.time ? `${j.time}<small>${+j.time.slice(0, 2) < 12 ? '오전' : '오후'}</small>` : '<span class="faint">시간</span><small>미정</small>'}</div>
    <div class="b">
      <div class="n"><span class="nm">${esc(custName(c))}</span>${st.count >= 2 ? '<span class="badge-regular">단골</span>' : ''}${statusPill(j.status)}</div>
      ${j.address ? `<div class="a">${esc(j.address)}</div>` : ''}
      ${j.work || j.worker ? `<div class="w">${esc(j.work || '')}${j.worker ? `<span class="muted">${j.work ? ' · ' : ''}${esc(j.worker)}</span>` : ''}</div>` : ''}
      ${money}
    </div>
  </button>`;
}

function renderSchedule() {
  const t = today();
  const sel = ui.sel;
  // 위 요약은 달력에서 보고 있는(선택한) 날짜의 달 기준
  const mFrom = monthStart(sel), mTo = monthEnd(sel);
  const selMonth = toDate(sel).getMonth() + 1;
  const jobsAll = activeJobs();
  const monthJobs = jobsAll.filter((j) => inRange(j.date, mFrom, mTo));
  const monthDone = monthJobs.filter((j) => ['작업완료', '정산완료'].includes(j.status)).length;
  const monthSales = monthJobs.reduce((s, j) => s + saleAmount(j), 0);
  const monthBuy = store.state.purchases.filter((p) => inRange(p.date, mFrom, mTo)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const recv = jobsAll.filter(isReceivable);
  const inv = jobsAll.filter(needsInvoice);
  const revisit = jobsAll.filter((j) => j.revisit);
  const undated = jobsAll.filter((j) => !j.date && j.status === '문의');
  const todayN = jobsOn(t).filter((j) => j.status !== '취소').length;
  const d = toDate(t);

  // 달력
  let cal = '';
  const countOn = (ds) => jobsOn(ds).filter((j) => j.status !== '취소').length;
  const dayCell = (ds, extra = '') => {
    const n = countOn(ds);
    return `<button class="day ${ds === t ? 'today' : ''} ${ds === sel ? 'sel' : ''} ${toDate(ds).getDay() === 0 ? 'sun' : ''} ${extra}" data-day="${ds}">
      ${extra.includes('m') ? '' : `<span class="w">${weekday(ds)}</span>`}<span class="d">${toDate(ds).getDate()}</span>
      <span class="dots">${'<i></i>'.repeat(Math.min(n, 3))}</span></button>`;
  };
  if (ui.cal === 'week') {
    const s = addDays(sel, -toDate(sel).getDay());
    cal = `<div class="week">${Array.from({ length: 7 }, (_, i) => dayCell(addDays(s, i))).join('')}</div>`;
  } else {
    const ms = monthStart(sel);
    const start = addDays(ms, -toDate(ms).getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const ds = addDays(start, i);
      if (i >= 35 && ds.slice(0, 7) !== ms.slice(0, 7)) break;
      cells.push(dayCell(ds, `m ${ds.slice(0, 7) !== ms.slice(0, 7) ? 'out' : ''}`));
    }
    cal = `<div class="month">${['일', '월', '화', '수', '목', '금', '토'].map((w) => `<div class="wh">${w}</div>`).join('')}${cells.join('')}</div>`;
  }
  const dayJobs = jobsOn(sel);
  const sd = toDate(sel);

  view.innerHTML = `
    <header class="hd">
      <div class="grow"><p class="eyebrow">${d.getMonth() + 1}월 ${d.getDate()}일 ${weekday(t)}요일 ${syncBadge()}</p><h1>일정</h1></div>
      <button class="icon-btn" data-go="#settings" aria-label="설정">${ic('gear')}</button>
    </header>
    <section class="kpis">
      <div class="kpi dark"><div class="l">오늘 일정</div><div class="v">${todayN}<small>건</small></div></div>
      <button class="kpi" data-ledger="sales" style="text-align:left"><div class="l">${selMonth}월 매출</div><div class="v">${short(monthSales)}</div></button>
      <button class="kpi" data-ledger="buys" style="text-align:left"><div class="l">${selMonth}월 매입</div><div class="v">${short(monthBuy)}</div></button>
    </section>
    <div class="alerts">
      ${recv.length ? `<button class="alert red" data-alert="recv">미수 ${recv.length}건 · ${num(recv.reduce((s, j) => s + unpaid(j), 0))}원</button>` : ''}
      ${inv.length ? `<button class="alert orange" data-alert="inv">계산서 미발행 ${inv.length}건</button>` : ''}
      ${revisit.length ? `<button class="alert blue" data-alert="revisit">재방문 ${revisit.length}건</button>` : ''}
      <button class="alert gray" data-alert="month">${selMonth}월 작업 ${monthJobs.length}건${monthJobs.length ? ` · 완료 ${monthDone}` : ''}</button>
      ${undated.length ? `<button class="alert gray" data-alert="undated">날짜 미정 문의 ${undated.length}건</button>` : ''}
    </div>
    <div class="cal-head">
      <button class="icon-btn" data-cal-move="-1">${ic('left')}</button>
      <span class="m">${sd.getFullYear()}년 ${sd.getMonth() + 1}월</span>
      <button class="icon-btn" data-cal-move="1">${ic('right')}</button>
      ${sel !== t ? '<button class="chip sm" data-day="' + t + '">오늘</button>' : ''}
      <div class="seg"><button class="${ui.cal === 'week' ? 'on' : ''}" data-calmode="week">주</button><button class="${ui.cal === 'month' ? 'on' : ''}" data-calmode="month">월</button></div>
    </div>
    ${cal}
    <div class="sec-title">${fullDate(sel).replace(/^\d+년 /, '')}<span class="r">${dayJobs.length ? dayJobs.length + '건' : ''}</span></div>
    ${dayJobs.length ? dayJobs.map((j) => jobCard(j)).join('') : `<div class="empty">일정이 없습니다<br><span class="small faint">오른쪽 아래 ＋ 버튼으로 바로 등록하세요</span></div>`}
    ${undated.length ? `<div class="sec-title">날짜 미정 문의<span class="r">${undated.length}건</span></div>${undated.map((j) => jobCard(j, true)).join('')}` : ''}
  `;
  $$('[data-day]').forEach((b) => (b.onclick = () => { ui.sel = b.dataset.day; render(); }));
  // 매출·매입 요약을 누르면 그 달 장부로
  $$('[data-ledger]').forEach((b) => (b.onclick = () => { ui.lt = b.dataset.ledger; ui.lm = sel; go('#ledger'); }));
  $$('[data-calmode]').forEach((b) => (b.onclick = () => { ui.cal = b.dataset.calmode; saveUi(); render(); }));
  $$('[data-cal-move]').forEach((b) => (b.onclick = () => {
    const k = Number(b.dataset.calMove);
    ui.sel = ui.cal === 'week' ? addDays(ui.sel, 7 * k) : addMonths(ui.sel, k);
    render();
  }));
  $$('[data-alert]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.alert;
    const map = {
      recv: ['미수금', recv],
      inv: ['세금계산서 미발행', inv],
      revisit: ['재방문 필요', revisit],
      undated: ['날짜 미정 문의', undated],
      month: [`${selMonth}월 작업`, monthJobs],
    };
    jobListSheet(map[k][0], map[k][1]);
  }));
}

function jobListSheet(title, jobs) {
  openSheet(`${sheetHead(title)}${[...jobs].sort(byDate).map((j) => jobCard(j, true)).join('') || '<div class="empty">없습니다</div>'}`, (s) => {
    $$('[data-go]', s).forEach((b) => (b.onclick = () => { closeSheet(); go(b.dataset.go); }));
  });
}

/* ================= 작업 등록·수정 ================= */
function blankJob(customerId) {
  return {
    id: newId('jb'), customerId: customerId || '', date: today(), time: '', source: '', address: '', work: '',
    status: '예약확정', amount: 0, vat: 'none', payments: [], photos: [],
    taxInvoice: { need: false, issued: false, date: '' }, review: {}, note: '', revisit: false, createdBy: me(),
  };
}

function openJobForm({ job, customerId, prefill, afterSave } = {}) {
  const isNew = !job;
  const j = job ? JSON.parse(JSON.stringify(job)) : blankJob(customerId);
  let cust = store.state.customers.find((c) => c.id === j.customerId) || null;
  if (isNew && cust) {
    j.address = cust.address || '';
    j.source = '';
  }
  // 작업자 버튼: LEE + 인건비에 등록한 사람 + 예전에 적은 이름 (BEE는 현장 작업자가 아니라 기본 목록에서 뺌)
  const workerNames = [...new Set(['LEE', ...(store.state.settings.workers || []).map((w) => w.name), ...store.state.jobs.map((x) => x.worker)].filter(Boolean))];

  const s = openSheet(`
    ${sheetHead(isNew ? '새 일정' : '일정 수정')}
    ${isNew ? `<div class="paste-box" id="pb">
      <div class="btns"><button type="button" class="btn sm ghost" id="pb-btn" style="background:var(--card)">${ic('clip')} 글자 붙여넣기</button>
      <button type="button" class="btn sm ghost" id="pb-img" style="background:var(--card)">${ic('camera')} 캡처로 채우기</button></div>
      <input type="file" id="pb-file" accept="image/*" hidden />
      <div class="small muted" style="margin-top:6px" id="pb-msg">복사한 문의 내용이나 당근 예약 캡처에서 이름·번호·주소·날짜를 찾아 채워 드려요</div>
      <div id="pb-area" hidden style="margin-top:10px"><textarea id="pb-text" placeholder="당근·네이버·문자 내용을 여기에 붙여넣으세요"></textarea>
      <button type="button" class="btn sm" id="pb-go" style="margin-top:8px">내용으로 채우기</button></div>
    </div>` : ''}
    <div id="cust-box"></div>
    <label class="field"><span>날짜</span>
      <div class="chips" id="date-chips" style="margin-bottom:8px">
        <button type="button" class="chip" data-d="${today()}">오늘</button>
        <button type="button" class="chip" data-d="${addDays(today(), 1)}">내일</button>
        <button type="button" class="chip" data-d="${addDays(today(), 2)}">모레</button>
        <button type="button" class="chip" data-d="">미정</button>
      </div>
      <div class="grid2"><input type="date" id="jf-date" value="${esc(j.date)}" /><input type="time" id="jf-time" value="${esc(j.time)}" step="600" /></div>
    </label>
    <div class="field"><span>유입경로</span>${chipRow('source', SOURCES, j.source)}</div>
    <label class="field"><span>현장 주소</span><input id="jf-addr" value="${esc(j.address)}" placeholder="예) 별내 리슈빌 2113동 102호" autocomplete="off" /></label>
    <label class="field"><span>작업내역</span><textarea id="jf-work" placeholder="예) 세면대 교체, 도어클로저 교체">${esc(j.work)}</textarea></label>
    <div class="field"><span>작업자 <span class="faint" style="font-weight:500">— 함께 간 사람 모두 눌러 주세요 (여러 명 가능)</span></span>
      <div class="chips" id="wk-chips" style="margin-bottom:8px"></div>
      <div class="row"><input id="wk-new" class="input grow" placeholder="다른 사람 이름" autocomplete="off" /><button type="button" class="btn sm line" id="wk-add" style="height:48px">${ic('plus')} 추가</button></div>
    </div>
    <div class="grid2" style="align-items:end">${moneyField('jf-amt', '견적 금액 (나중에 입력해도 돼요)', j.amount)}<div class="field">${chipRow('vat', VAT_MODES, j.vat || 'none')}</div></div>
    <div class="small" id="jf-dc-msg" hidden style="margin:-8px 0 14px;color:var(--accent);font-weight:600"></div>
    ${isNew ? '' : `<div class="field"><span>상태</span>${chipRow('status', STATUSES, j.status)}</div>`}
    <label class="field"><span>메모 · 특이사항</span><textarea id="jf-note" placeholder="출입 방법, 주차, 고객 요청 등">${esc(j.note)}</textarea></label>
    ${isNew ? `<div class="field"><span>고객이 보낸 사진 · 문의 캡처</span>
      <div class="photos" id="jf-prev" style="margin-bottom:8px"></div>
      <button type="button" class="add-line" id="jf-pick" style="margin-top:0">${ic('camera')} 사진 첨부</button>
      <input type="file" id="jf-files" accept="image/*" multiple hidden /></div>` : ''}
    <div class="foot"><button class="btn block accent" id="jf-save">${isNew ? '일정 등록' : '저장'}</button></div>
  `);
  // 등록과 함께 올릴 사진 (고객이 보낸 현장 사진, 채팅 캡처 등)
  let pending = [];
  let parsedDiscount = null; // 캡처·문자에서 찾은 쿠폰 할인
  if (isNew) {
    const drawPrev = () => {
      $('#jf-prev', s).innerHTML = pending.map((f, i) => `<button type="button" data-rm="${i}"><img src="${URL.createObjectURL(f)}" alt="" /><span class="st">✕ 빼기</span></button>`).join('');
      $('#jf-pick', s).innerHTML = `${ic('camera')} ${pending.length ? `사진 더 첨부 (${pending.length}장)` : '사진 첨부'}`;
    };
    $('#jf-pick', s).onclick = () => $('#jf-files', s).click();
    $('#jf-files', s).onchange = (e) => { pending = [...pending, ...e.target.files]; e.target.value = ''; drawPrev(); };
    $('#jf-files', s).addEventListener('redraw', drawPrev);
    $('#jf-prev', s).addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]');
      if (b) { pending.splice(Number(b.dataset.rm), 1); drawPrev(); }
    });
  }
  moneyInput($('#jf-amt', s));
  bindChips(s, 'source', null, true);
  bindChips(s, 'vat');
  bindChips(s, 'status');

  const dateInput = $('#jf-date', s);
  const syncDateChips = () => $$('#date-chips .chip', s).forEach((b) => b.classList.toggle('on', b.dataset.d === dateInput.value));
  // 작업자: 여러 명 고르기 (칩을 누르면 선택/해제, 새 이름은 추가)
  const splitWorkers = (v) => String(v || '').split(/[,·/]+/).map((x) => x.trim()).filter(Boolean);
  const picked = new Set(splitWorkers(j.worker));
  // 예전에 BEE를 적은 작업이 있어도 버튼 목록에는 띄우지 않음 (그 작업에 이미 선택돼 있으면 표시)
  const wkOptions = [...new Set([...workerNames.flatMap(splitWorkers).filter((w) => w !== 'BEE'), ...picked])];
  const drawWorkers = () => {
    $('#wk-chips', s).innerHTML = wkOptions.map((w) => `<button type="button" class="chip ${picked.has(w) ? 'on' : ''}" data-wk="${esc(w)}">${picked.has(w) ? '✓ ' : ''}${esc(w)}</button>`).join('');
  };
  $('#wk-chips', s).addEventListener('click', (e) => {
    const b = e.target.closest('[data-wk]');
    if (!b) return;
    const w = b.dataset.wk;
    picked.has(w) ? picked.delete(w) : picked.add(w);
    drawWorkers();
  });
  const addWorker = () => {
    const inp = $('#wk-new', s);
    splitWorkers(inp.value).forEach((w) => {
      if (!wkOptions.includes(w)) wkOptions.push(w);
      picked.add(w);
    });
    inp.value = '';
    drawWorkers();
  };
  $('#wk-add', s).onclick = addWorker;
  $('#wk-new', s).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWorker(); } });
  drawWorkers();
  $$('#date-chips .chip', s).forEach((b) => (b.onclick = () => { dateInput.value = b.dataset.d; syncDateChips(); }));
  dateInput.addEventListener('input', syncDateChips);
  syncDateChips();

  // 고객 고르기 / 새 고객
  const nc = { name: '', region: '', phone: '' };
  let editingCust = false; // 고른 고객의 이름·동네·번호를 이 화면에서 고치는 중
  function renderCust() {
    const box = $('#cust-box', s);
    if (cust && editingCust) {
      box.innerHTML = `
        <div class="field"><span>고객 정보 수정 <span class="faint" style="font-weight:500">— 저장하면 이 고객의 다른 작업에도 반영돼요</span></span>
          <div class="grid2" style="margin-bottom:8px"><input id="ec-name" placeholder="이름" value="${esc(cust.name)}" autocomplete="off" /><input id="ec-region" placeholder="동네" value="${esc(cust.region)}" autocomplete="off" /></div>
          <input id="ec-phone" type="tel" placeholder="전화번호" value="${esc(fmtPhone(cust.phone))}" autocomplete="off" />
          <button type="button" class="btn sm ghost" id="ec-cancel" style="margin-top:8px">수정 취소</button>
        </div>`;
      $('#ec-cancel', box).onclick = () => { editingCust = false; renderCust(); };
    } else if (cust) {
      const st = customerStats(cust.id);
      const hist = customerJobs(cust.id).filter((x) => x.id !== j.id).slice(0, 3);
      box.innerHTML = `
        <div class="field"><span>고객</span>
          <div class="picked"><div class="avatar">${initial(cust)}</div>
            <div class="grow"><div style="font-weight:700">${esc(custName(cust))} ${st.count >= 2 ? '<span class="badge-regular">단골</span>' : ''}</div>
            <div class="small muted">${esc(fmtPhone(cust.phone) || '연락처 없음')} · 작업 ${st.count}회</div></div></div>
          <div class="btns" style="margin-bottom:8px"><button type="button" class="btn sm line" id="cust-edit">${ic('edit')} 정보 수정</button><button type="button" class="btn sm line" id="cust-change">다른 고객으로 바꾸기</button></div>
          ${hist.length ? `<div class="mini-hist">${hist.map((h) => `<div>· ${md(h.date)} ${esc(h.work || '')} ${saleAmount(h) ? '· ' + won(saleAmount(h)) : ''}</div>`).join('')}</div>` : ''}
        </div>`;
      $('#cust-edit', box).onclick = () => { editingCust = true; renderCust(); };
      $('#cust-change', box).onclick = () => { cust = null; j.customerId = ''; renderCust(); };
    } else {
      box.innerHTML = `
        <div class="field"><span>고객 <em>*</em> <span class="faint" style="font-weight:500">— 이름이나 번호를 치면 기존 고객이 떠요</span></span>
          <div class="grid2" style="margin-bottom:8px"><input id="nc-name" placeholder="이름 (예: 문춘호)" value="${esc(nc.name)}" autocomplete="off" /><input id="nc-region" placeholder="동네 (예: 별내동)" value="${esc(nc.region)}" autocomplete="off" /></div>
          <input id="nc-phone" type="tel" placeholder="전화번호" value="${esc(nc.phone)}" autocomplete="off" />
        </div>
        <div id="nc-sug"></div>`;
      const upd = () => {
        nc.name = $('#nc-name', box).value;
        nc.region = $('#nc-region', box).value;
        nc.phone = $('#nc-phone', box).value;
        suggest();
      };
      ['#nc-name', '#nc-region', '#nc-phone'].forEach((q) => $(q, box).addEventListener('input', upd));
      $('#nc-phone', box).addEventListener('blur', () => { $('#nc-phone', box).value = fmtPhone($('#nc-phone', box).value); nc.phone = $('#nc-phone', box).value; });
      suggest();
    }
  }
  function suggest() {
    const box = $('#nc-sug', s);
    if (!box) return;
    const pd = digits(nc.phone);
    const nm = nc.name.trim();
    let list = [];
    if (pd.length >= 4 || nm.length >= 1) {
      list = store.state.customers.filter((c) => (pd.length >= 4 && digits(c.phone).includes(pd)) || (nm && matches(`${c.name} ${c.region}`, nm)));
    }
    box.innerHTML = list.length
      ? `<div class="suggest"><div class="cap">혹시 이 고객인가요? 누르면 이전 작업이 이어집니다</div>${list.slice(0, 5).map((c) => {
          const st = customerStats(c.id);
          return `<button type="button" data-cid="${c.id}"><div class="avatar" style="width:32px;height:32px;font-size:13px">${initial(c)}</div><div class="grow"><b>${esc(custName(c))}</b> <span class="muted">${esc(fmtPhone(c.phone))}</span></div><span class="small muted">작업 ${st.count}회</span></button>`;
        }).join('')}</div>`
      : '';
    $$('[data-cid]', box).forEach((b) => (b.onclick = () => pickCustomer(b.dataset.cid)));
  }
  function pickCustomer(cid) {
    editingCust = false;
    cust = store.state.customers.find((c) => c.id === cid);
    j.customerId = cid;
    if (!$('#jf-addr', s).value && cust.address) $('#jf-addr', s).value = cust.address;
    renderCust();
  }
  renderCust();

  // 붙여넣기
  if (isNew) {
    const applyParse = (text) => {
      const p = parseInquiry(text);
      if (!p.raw) return;
      const found = [];
      if (p.date) { dateInput.value = p.date; syncDateChips(); found.push('날짜'); }
      if (p.time) { $('#jf-time', s).value = p.time; found.push('시간'); }
      if (p.address) { $('#jf-addr', s).value = p.address; found.push('주소'); }
      if (p.source) { $$('[data-chips="source"] button', s).forEach((b) => b.classList.toggle('on', b.dataset.v === p.source)); found.push('유입경로'); }
      if (p.amount) { $('#jf-amt', s).value = num(p.amount); found.push('금액'); }
      if (p.discountRate) {
        parsedDiscount = { rate: p.discountRate };
        $('#jf-dc-msg', s).hidden = false;
        $('#jf-dc-msg', s).textContent = `쿠폰 ${p.discountRate}% 할인이 함께 기록돼요 (최종 금액에서 빠짐)`;
        found.push('할인');
      }
      if (p.work) { $('#jf-work', s).value = p.work; found.push('작업'); }
      const note = $('#jf-note', s);
      note.value = (note.value ? note.value + '\n\n' : '') + '[문의 원문]\n' + p.raw;
      const same = p.phone && store.state.customers.find((c) => digits(c.phone) === digits(p.phone));
      if (same) { pickCustomer(same.id); found.push('기존 고객'); }
      else if (!cust) {
        if (p.phone) { nc.phone = p.phone; found.push('전화번호'); }
        if (p.name) { nc.name = p.name; found.push('이름'); }
        renderCust();
      }
      $('#pb-area', s).hidden = true;
      toast(found.length ? `${found.join(', ')}을(를) 채웠어요. 확인해 주세요` : '찾은 정보가 없어 원문만 메모에 넣었어요');
    };
    $('#pb-btn', s).onclick = async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch (_) {}
      if (text && text.trim()) applyParse(text);
      else { $('#pb-area', s).hidden = false; $('#pb-text', s).focus(); }
    };
    $('#pb-go', s).onclick = () => applyParse($('#pb-text', s).value);
    // 캡처 사진 → 글자 읽기 → 칸 채우기 (캡처는 '문의' 사진으로 함께 저장)
    $('#pb-img', s).onclick = () => $('#pb-file', s).click();
    $('#pb-file', s).onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const msg = $('#pb-msg', s);
      const btn = $('#pb-img', s);
      btn.disabled = true;
      try {
        const text = await readImageText(f, (m) => (msg.textContent = m));
        pending.push(f);
        $('#jf-files', s).dispatchEvent(new Event('redraw'));
        applyParse(text);
        msg.textContent = '캡처에서 읽은 내용을 채웠어요. 틀린 글자가 있을 수 있으니 확인해 주세요';
      } catch (err) {
        console.error(err);
        msg.textContent = '캡처를 읽지 못했어요. 인터넷 연결을 확인하거나 직접 입력해 주세요';
      } finally {
        btn.disabled = false;
      }
    };
    if (prefill) applyParse(prefill);
  }

  $('#jf-save', s).onclick = async () => {
    if (cust && editingCust) {
      const name = $('#ec-name', s).value.trim(), region = $('#ec-region', s).value.trim(), phone = fmtPhone($('#ec-phone', s).value);
      if (!name && !phone && !region) { toast('고객 이름이나 전화번호를 넣어 주세요'); return; }
      cust = { ...cust, name, region, phone };
      await save('customers', cust);
    }
    if (!cust) {
      const name = nc.name.trim(), phone = fmtPhone(nc.phone), region = nc.region.trim();
      if (!name && !phone && !region) { toast('고객 이름이나 전화번호를 넣어 주세요'); $('#nc-name', s)?.focus(); return; }
      cust = { id: newId('cu'), name, region, phone, address: $('#jf-addr', s).value.trim(), source: chipVal(s, 'source'), memo: '' };
      await save('customers', cust);
      j.customerId = cust.id;
    }
    j.date = dateInput.value;
    j.time = $('#jf-time', s).value;
    j.source = chipVal(s, 'source');
    j.address = $('#jf-addr', s).value.trim();
    j.work = $('#jf-work', s).value.trim();
    if ($('#wk-new', s).value.trim()) addWorker(); // 이름만 적고 추가를 안 눌렀어도 포함
    j.worker = wkOptions.filter((w) => picked.has(w)).join(', ');
    j.amount = parseNum($('#jf-amt', s).value);
    j.vat = chipVal(s, 'vat') || 'none';
    j.note = $('#jf-note', s).value.trim();
    if (isNew && parsedDiscount && j.amount) {
      j.discount = Math.round((j.amount * parsedDiscount.rate) / 100);
      j.discountNote = `쿠폰 ${parsedDiscount.rate}% 할인`;
    }
    if (isNew) j.status = j.date ? '예약확정' : '문의';
    else j.status = chipVal(s, 'status') || j.status;
    if (!cust.address && j.address) await save('customers', { ...cust, address: j.address });
    await save('jobs', j);
    closeSheet();
    toast(isNew ? '일정을 등록했어요' : '저장했어요');
    if (afterSave) afterSave(j);
    else if (isNew) go('#job/' + j.id);
    if (pending.length) {
      if (store.mode === 'cloud' && !navigator.onLine) {
        alert('일정은 등록했어요. 사진은 인터넷이 연결된 뒤 작업 화면에서 다시 올려 주세요.');
        return;
      }
      try {
        const added = await uploadPhotos(j.id, pending, '문의', (i, n) => toast(`사진 올리는 중… ${i}/${n}`));
        const fresh = store.state.jobs.find((x) => x.id === j.id) || j;
        await save('jobs', { ...fresh, photos: [...(fresh.photos || []), ...added] });
        toast(`일정 등록 · 사진 ${added.length}장을 올렸어요`);
      } catch (e) {
        console.error(e);
        alert('일정은 등록했지만 사진을 올리지 못했습니다. 작업 화면에서 다시 올려 주세요.');
      }
    }
  };
}

/* ================= 작업 상세 ================= */
function renderJob(id) {
  const j = store.state.jobs.find((x) => x.id === id);
  if (!j) {
    view.innerHTML = `<header class="hd sub"><button class="icon-btn" data-back>${ic('back')}</button><h1>없는 작업</h1></header><div class="empty">삭제되었거나 찾을 수 없는 작업입니다.</div>`;
    $('[data-back]').onclick = () => history.length > 1 ? history.back() : go('#schedule');
    return;
  }
  const c = customerOf(j);
  const st = customerStats(j.customerId);
  const buys = jobPurchases(j.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const cost = jobCost(j.id);
  const others = customerJobs(j.customerId).filter((x) => x.id !== j.id);
  const photos = (j.photos || []).filter((p) => ui.stage === '전체' || p.stage === ui.stage);
  const ti = j.taxInvoice || {};
  const rv = j.review || {};
  const addrQ = encodeURIComponent(j.address || '');

  view.innerHTML = `
    <header class="hd sub">
      <button class="icon-btn" data-back>${ic('back')}</button>
      <h1 class="grow" data-go="#customer/${j.customerId}" style="cursor:pointer">${esc(custName(c))} ${st.count >= 2 ? '<span class="badge-regular">단골</span>' : ''}</h1>
      <button class="btn sm line" id="j-edit">${ic('edit')} 수정</button>
    </header>

    <div class="status-bar">${STATUSES.map((s) => `<button class="${STATUS_CLASS[s]} ${j.status === s ? 'on' : ''}" data-status="${s}">${s}</button>`).join('')}</div>

    <div class="card">
      <div class="info-row">${ic('cal')}<div class="grow"><b>${fullDate(j.date)}</b> ${j.time ? timeLabel(j.time) : ''}</div></div>
      ${j.address ? `<div class="info-row">${ic('pin')}<div class="grow">${esc(j.address)}</div><div class="acts"><a class="btn sm ghost" href="https://map.naver.com/p/search/${addrQ}" target="_blank" rel="noopener">지도</a></div></div>` : ''}
      ${c?.phone ? `<div class="info-row">${ic('phone')}<div class="grow">${esc(fmtPhone(c.phone))}</div><div class="acts"><a class="btn sm ghost" href="tel:${digits(c.phone)}">전화</a><a class="btn sm ghost" href="sms:${digits(c.phone)}">문자</a></div></div>` : ''}
      ${j.source ? `<div class="info-row">${ic('source')}<div class="grow">유입경로 · ${esc(j.source)}</div></div>` : ''}
      ${j.work ? `<div class="info-row">${ic('tool')}<div class="grow note">${esc(j.work)}</div></div>` : ''}
      ${j.worker ? `<div class="info-row">${ic('users')}<div class="grow">작업자 · ${esc(j.worker)}</div></div>` : ''}
    </div>

    <div class="card">
      <h3>매출 · 입금 <span class="r">${payState(j) ? `<span class="pill ${payState(j) === '완납' ? 'green' : isReceivable(j) ? 'red' : ''}">${payState(j)}</span>` : ''}</span></h3>
      <button style="width:100%;text-align:left" id="j-amount">
        <div class="row"><div class="money-big grow">${finalAmount(j) ? amt(finalAmount(j)) : '<span class="faint" style="font-size:20px">금액 입력</span>'}</div><span class="pill">${vatShort(j.vat)}</span></div>
        ${j.discount || j.extra ? `<div class="small" style="margin-top:4px">
            <div class="kv" style="padding:2px 0"><span class="muted">견적 금액</span><span class="v">${won(j.amount)}</span></div>
            ${j.discount ? `<div class="kv" style="padding:2px 0"><span class="muted">할인${j.discountNote ? ` · ${esc(j.discountNote)}` : ''}</span><span class="v" style="color:var(--red)">−${num(j.discount)}원</span></div>` : ''}
            ${j.extra ? `<div class="kv" style="padding:2px 0"><span class="muted">추가${j.extraNote ? ` · ${esc(j.extraNote)}` : ''}</span><span class="v" style="color:var(--blue)">+${num(j.extra)}원</span></div>` : ''}
          </div>` : `<div class="small faint" style="margin-top:2px">눌러서 견적 금액 · 할인 · 추가 입력</div>`}
      </button>
      ${j.vat === 'excl' && saleAmount(j) ? `<div class="kv"><span class="muted">부가세 10%</span><span class="v">+${num(vatExtra(j))}원</span></div><div class="kv"><span class="muted">받을 금액</span><span class="v">${won(billed(j))}</span></div>` : ''}
      ${(j.payments || []).map((p, i) => `<button class="pay" data-pay="${i}"><span class="grow"><b>${md(p.date)}</b> <span class="muted">${esc(p.method || '')}${p.bank ? ' · ' + esc(p.bank) : ''}</span>${p.fee ? `<br><span class="small faint">실입금 ${num(p.deposit)} · 수수료 ${num(p.fee)}</span>` : p.method === '카드' ? '<br><span class="small faint">카드 실입금 미입력</span>' : ''}</span><b class="money">${won(p.amount)}</b><span class="faint" style="display:flex">${ic('edit')}</span></button>`).join('')}
      ${(j.payments || []).length ? '<div class="faint small" style="margin-top:2px">입금 줄을 누르면 수정하거나 취소할 수 있어요</div>' : ''}
      ${billed(j) ? `<div class="kv total"><span>${!unpaid(j) ? '입금 완료' : isReceivable(j) ? '남은 금액(미수)' : '받을 금액'}</span><span class="v" style="color:${!unpaid(j) ? 'var(--green)' : isReceivable(j) ? 'var(--red)' : 'inherit'}">${won(unpaid(j))}</span></div>` : ''}
      <div class="btns"><button class="add-line" id="j-addpay">${ic('plus')} 입금 기록</button>${(j.payments || []).length ? `<button class="add-line" id="j-unpay" style="color:var(--red)">미입금으로 되돌리기</button>` : ''}</div>
      <hr class="sep" />
      <div class="toggle-row"><span class="lbl">세금계산서</span>
        <div class="chips" style="flex:1"><button class="chip sm ${!ti.need ? 'on' : ''}" data-ti="none">해당없음</button><button class="chip sm ${ti.need && !ti.issued ? 'on' : ''}" data-ti="need">발행 필요</button><button class="chip sm ${ti.issued ? 'on' : ''}" data-ti="issued">발행 완료</button></div>
      </div>
      ${ti.issued ? `<div class="toggle-row"><span class="lbl">발행일</span><input type="date" class="input" style="flex:1;height:40px" id="ti-date" value="${esc(ti.date || '')}" /></div>` : ''}
    </div>

    <div class="card">
      <h3>현장 매입 <span class="r">${buys.length ? `${buys.length}건 · ${won(cost)}` : ''}</span></h3>
      ${buys.map((p) => `<button class="pay" data-buy="${p.id}"><span class="grow"><b>${esc(p.item || p.category || '매입')}</b> <span class="muted small">${esc([md(p.date), p.vendor, p.payer].filter(Boolean).join(' · '))}</span></span><b class="money">${won(p.amount)}</b></button>`).join('')}
      ${feeSum(j) ? `<div class="kv"><span class="muted">카드 수수료</span><span class="v">${won(feeSum(j))}</span></div>` : ''}
      ${saleAmount(j) ? `<div class="kv total"><span>현장 순이익</span><span class="v">${won(jobProfit(j))}</span></div>` : ''}
      <button class="add-line" id="j-addbuy">${ic('plus')} 이 현장 매입 추가</button>
    </div>

    <div class="card">
      <h3>${ic('camera')} 현장 사진 <span class="r">${(j.photos || []).length}장</span></h3>
      ${(j.photos || []).length ? `<div class="chips scroll" style="margin-bottom:10px">${['전체', ...PHOTO_STAGES].map((s) => `<button class="chip sm ${ui.stage === s ? 'on' : ''}" data-stage="${s}">${s}${s !== '전체' ? ` ${(j.photos || []).filter((p) => p.stage === s).length || ''}` : ''}</button>`).join('')}</div>` : ''}
      <div class="photos">${photos.map((p) => `<button data-photo="${p.id}"><img data-src="${esc(p.thumb)}" alt="" loading="lazy" /><span class="st">${esc(p.stage)}</span></button>`).join('')}</div>
      <div class="btns" style="margin-top:10px"><button class="add-line" id="j-addphoto" style="margin:0">${ic('plus')} 사진 추가</button>${(j.photos || []).length ? `<button class="add-line" id="j-zip" style="margin:0">${ic('down')} 전체 내려받기</button>` : ''}</div>
      <input type="file" id="j-file" accept="image/*" multiple hidden />
    </div>

    <div class="card">
      <h3>고객 후기 <span class="r"><button class="btn sm ghost" id="j-review">${rv.text || rv.rating ? '수정' : '기록'}</button></span></h3>
      ${rv.text || rv.rating ? `<div>${rv.rating ? `<span class="stars">${'★'.repeat(rv.rating)}${'☆'.repeat(5 - rv.rating)}</span> ` : ''}${rv.where ? `<span class="pill">${esc(rv.where)}</span>` : ''}</div>${rv.text ? `<div class="note" style="margin-top:6px">${esc(rv.text)}</div>` : ''}` : `<div class="muted small">${rv.requested ? '후기 요청 보냄 · 아직 기록 없음' : '아직 기록이 없어요'}</div>`}
    </div>

    <div class="card">
      <h3>${ic('link')} 블로그 글 <span class="r">${(j.blogs || []).length ? `${j.blogs.length}개` : ''}</span></h3>
      ${(j.blogs || []).map((b, i) => `<div class="pay blog"><a class="grow" href="${esc(b.url)}" target="_blank" rel="noopener"><b>${esc(b.title || blogHost(b.url))}</b><span class="muted small">${esc(b.url)}</span></a><button class="btn sm ghost" data-blog="${i}">수정</button></div>`).join('')}
      ${(j.blogs || []).length ? '' : '<div class="muted small">이 작업으로 쓴 블로그 글 주소를 연결해 두세요</div>'}
      <button class="add-line" id="j-addblog">${ic('plus')} 블로그 링크 추가</button>
    </div>

    <div class="card">
      <h3>특이사항</h3>
      <label class="check"><input type="checkbox" id="j-revisit" ${j.revisit ? 'checked' : ''} /> 재방문 필요 (A/S·추가 작업)</label>
      ${j.note ? `<div class="note" style="margin-top:6px">${esc(j.note)}</div>` : '<div class="muted small">메모는 [수정]에서 입력해요</div>'}
    </div>

    ${others.length ? `<div class="sec-title">이 고객의 다른 작업<span class="r">${others.length}건</span></div>${others.slice(0, 5).map((x) => jobCard(x, true)).join('')}` : ''}
    <div class="btns" style="margin-top:16px">
      <button class="btn line" id="j-again">${ic('plus')} 이 고객 새 작업</button>
      <button class="btn danger" id="j-del">${ic('trash')} 삭제</button>
    </div>
  `;
  hydrateImgs(view);
  $('[data-back]').onclick = () => (history.length > 1 ? history.back() : go('#schedule'));
  $('#j-edit').onclick = () => openJobForm({ job: j });
  $('#j-again').onclick = () => openJobForm({ customerId: j.customerId });
  $$('[data-status]').forEach((b) => (b.onclick = () => save('jobs', { ...j, status: b.dataset.status })));
  $('#j-amount').onclick = () => amountSheet(j);
  $('#j-addpay').onclick = () => paymentSheet(j);
  $('#j-unpay') && ($('#j-unpay').onclick = () => clearPayments(j));
  $$('[data-pay]').forEach((b) => (b.onclick = () => paymentSheet(j, Number(b.dataset.pay))));
  $$('[data-ti]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.ti;
    save('jobs', { ...j, taxInvoice: { need: k !== 'none', issued: k === 'issued', date: k === 'issued' ? ti.date || today() : '' } });
  }));
  $('#ti-date') && ($('#ti-date').onchange = (e) => save('jobs', { ...j, taxInvoice: { ...ti, date: e.target.value } }));
  $('#j-addbuy').onclick = () => purchaseSheet(null, j.id);
  $$('[data-buy]').forEach((b) => (b.onclick = () => purchaseSheet(store.state.purchases.find((p) => p.id === b.dataset.buy))));
  $$('[data-stage]').forEach((b) => (b.onclick = () => { ui.stage = b.dataset.stage; render(); }));
  $$('[data-photo]').forEach((b) => (b.onclick = () => openViewer(j, b.dataset.photo)));
  $('#j-addphoto').onclick = () => photoAddSheet(j);
  $('#j-zip') && ($('#j-zip').onclick = () => zipSheet([j], `${custName(c)}_${j.date || '날짜미정'}`));
  $('#j-review').onclick = () => reviewSheet(j);
  $('#j-addblog').onclick = () => blogSheet(j);
  $$('[data-blog]').forEach((b) => (b.onclick = () => blogSheet(j, Number(b.dataset.blog))));
  $('#j-revisit').onchange = (e) => save('jobs', { ...j, revisit: e.target.checked });
  $('#j-del').onclick = async () => {
    const msg = `이 작업을 삭제할까요?${(j.photos || []).length ? `\n사진 ${(j.photos || []).length}장도 함께 지워집니다.` : ''}${buys.length ? `\n연결된 매입 ${buys.length}건은 '공통 매입'으로 남습니다.` : ''}`;
    if (!confirm(msg)) return;
    try { await deletePhotos(j.photos || []); } catch (e) { console.warn(e); }
    for (const p of buys) await save('purchases', { ...p, jobId: '' });
    await remove('jobs', j.id);
    toast('삭제했어요');
    history.length > 1 ? history.back() : go('#schedule');
  };
}

async function hydrateImgs(root) {
  const imgs = $$('img[data-src]', root);
  if (!imgs.length) return;
  try {
    const urls = await photoUrls(imgs.map((i) => i.dataset.src));
    imgs.forEach((i) => { if (urls[i.dataset.src]) i.src = urls[i.dataset.src]; });
  } catch (e) {
    console.warn('사진을 불러오지 못했습니다', e);
  }
}

// 견적 금액 − 할인 + 추가 = 최종 금액
function amountSheet(j) {
  const s = openSheet(`
    ${sheetHead('매출 금액')}
    ${moneyField('am-v', '견적 금액', j.amount)}
    <div class="card" style="padding:14px 14px 4px">
      ${moneyField('am-dc', '할인', j.discount)}
      <div class="chips" style="margin:-6px 0 10px" id="am-rate">${[5, 10, 15, 20].map((r) => `<button type="button" class="chip sm" data-rate="${r}">견적의 ${r}%</button>`).join('')}<button type="button" class="chip sm" data-rate="0">없음</button></div>
      <label class="field"><span>할인 사유</span><input id="am-dcn" value="${esc(j.discountNote || '')}" placeholder="예) 당근 쿠폰 10%, 단골 할인" autocomplete="off" /></label>
    </div>
    <div class="card" style="padding:14px 14px 4px">
      ${moneyField('am-ex', '추가 (현장에서 늘어난 금액)', j.extra)}
      <label class="field"><span>추가 내용</span><input id="am-exn" value="${esc(j.extraNote || '')}" placeholder="예) 실리콘 추가 시공, 부품 교체" autocomplete="off" /></label>
    </div>
    <div class="card" id="am-sum"></div>
    <div class="field"><span>부가세</span>${chipRow('vat', VAT_MODES, j.vat || 'none')}</div>
    <div class="foot"><button class="btn block" id="am-save">저장</button></div>`);
  const inp = $('#am-v', s), dc = $('#am-dc', s), ex = $('#am-ex', s);
  [inp, dc, ex].forEach(moneyInput);
  const vals = () => ({ q: parseNum(inp.value), d: parseNum(dc.value), e: parseNum(ex.value), k: chipVal(s, 'vat') });
  const draw = () => {
    const { q, d, e, k } = vals();
    const fin = Math.max(0, q - d + e);
    $('#am-sum', s).innerHTML = `
      <div class="kv"><span class="muted">견적 금액</span><span class="v">${won(q)}</span></div>
      ${d ? `<div class="kv"><span class="muted">할인</span><span class="v" style="color:var(--red)">−${num(d)}원</span></div>` : ''}
      ${e ? `<div class="kv"><span class="muted">추가</span><span class="v" style="color:var(--blue)">+${num(e)}원</span></div>` : ''}
      <div class="kv total"><span>최종 금액</span><span class="v">${won(fin)}</span></div>
      ${k === 'excl' && fin ? `<div class="kv"><span class="muted">부가세 별도 → 받을 금액</span><span class="v">${won(Math.round(fin * 1.1))}</span></div>` : ''}`;
  };
  $('#am-rate', s).addEventListener('click', (e) => {
    const b = e.target.closest('[data-rate]');
    if (!b) return;
    const r = Number(b.dataset.rate);
    const v = Math.round((parseNum(inp.value) * r) / 100);
    dc.value = v ? num(v) : '';
    if (r && !$('#am-dcn', s).value) $('#am-dcn', s).value = `${r}% 할인`;
    draw();
  });
  bindChips(s, 'vat', draw);
  [inp, dc, ex].forEach((x) => x.addEventListener('input', draw));
  draw();
  $('#am-save', s).onclick = () => {
    const { q, d, e, k } = vals();
    save('jobs', fixPaidStatus({ ...j, amount: q, discount: d, discountNote: $('#am-dcn', s).value.trim(), extra: e, extraNote: $('#am-exn', s).value.trim(), vat: k || 'none' }));
    closeSheet();
  };
}

function paymentSheet(j, idx) {
  const isNew = idx == null;
  const p = isNew ? { id: newId('pa'), date: today(), amount: unpaid(j) || '', method: '계좌이체', bank: '' } : { ...j.payments[idx] };
  const banks = store.state.settings.banks || [];
  const s = openSheet(`
    ${sheetHead(isNew ? '입금 기록' : '입금 수정')}
    <div class="field"><span>결제수단</span>${chipRow('method', PAY_METHODS, p.method)}</div>
    ${moneyField('pa-amt', '<span id="pa-amt-l">입금액</span>', p.amount)}
    <div class="card" id="pa-card" style="padding:14px 14px 4px">
      ${moneyField('pa-dep', '카드사에서 실제 들어온 금액 (수수료 뺀 금액)', p.deposit)}
      <div class="small" id="pa-fee" style="margin:-6px 0 12px"></div>
    </div>
    <label class="field"><span id="pa-date-l">입금일</span><input type="date" id="pa-date" value="${esc(p.date)}" /></label>
    <div class="field" id="pa-bankf"><span>입금 은행</span>${chipRow('bank', banks, p.bank, 'scroll')}</div>
    ${isNew ? '' : `<button class="btn danger block" id="pa-del" style="margin-bottom:6px">${ic('trash')} 이 입금 취소 (미입금으로 되돌리기)</button>`}
    <div class="foot"><button class="btn block" id="pa-save">저장</button></div>`);
  ['#pa-amt', '#pa-dep'].forEach((q) => moneyInput($(q, s)));
  // 카드: 고객이 결제한 금액으로 미수를 맞추고, 덜 들어온 만큼은 수수료로 따로 기록
  const drawFee = () => {
    const a = parseNum($('#pa-amt', s).value), dep = parseNum($('#pa-dep', s).value);
    const el = $('#pa-fee', s);
    if (!dep) el.innerHTML = '<span class="faint">아직 안 들어왔으면 비워 두고 나중에 넣어도 돼요</span>';
    else if (dep > a) el.innerHTML = '<span style="color:var(--red)">결제 금액보다 많아요. 금액을 확인해 주세요</span>';
    else el.innerHTML = `카드 수수료 <b>${won(a - dep)}</b> <span class="muted">(${a ? (((a - dep) / a) * 100).toFixed(2) : 0}%)</span> — 미수금이 아닌 비용으로 처리돼요`;
  };
  const onMethod = () => {
    const m = chipVal(s, 'method');
    $('#pa-bankf', s).hidden = m !== '계좌이체';
    $('#pa-card', s).hidden = m !== '카드';
    $('#pa-amt-l', s).textContent = m === '카드' ? '카드 결제 금액 (고객이 결제한 금액)' : '입금액';
    $('#pa-date-l', s).textContent = m === '카드' ? '결제일' : '입금일';
    drawFee();
  };
  bindChips(s, 'method', onMethod);
  bindChips(s, 'bank', null, true);
  ['#pa-amt', '#pa-dep'].forEach((q) => $(q, s).addEventListener('input', drawFee));
  onMethod();
  $('#pa-save', s).onclick = () => {
    const amount = parseNum($('#pa-amt', s).value);
    if (!amount) return toast('금액을 넣어 주세요');
    const method = chipVal(s, 'method');
    const dep = method === '카드' ? parseNum($('#pa-dep', s).value) : 0;
    if (dep > amount) return toast('실제 들어온 금액이 결제 금액보다 많아요');
    const np = {
      ...p, amount, date: $('#pa-date', s).value || today(), method, bank: method === '계좌이체' ? chipVal(s, 'bank') : '',
      deposit: dep || 0, fee: dep ? amount - dep : 0,
    };
    const pays = [...(j.payments || [])];
    if (isNew) pays.push(np);
    else pays[idx] = np;
    const nj = fixPaidStatus({ ...j, payments: pays });
    save('jobs', nj);
    closeSheet();
    toast(nj.status === '정산완료' && j.status !== '정산완료' ? '입금 완료 · 정산완료로 바꿨어요' : '입금을 기록했어요');
  };
  $('#pa-del', s) && ($('#pa-del', s).onclick = () => {
    if (!confirm(`${md(p.date)} ${won(p.amount)} 입금을 취소할까요?`)) return;
    save('jobs', fixPaidStatus({ ...j, payments: j.payments.filter((_, i) => i !== idx) }));
    closeSheet();
    toast('입금을 취소했어요');
  });
}

// 다 받았으면 정산완료로, 입금을 취소해 받을 돈이 생기면 작업완료로 되돌림
function fixPaidStatus(nj) {
  if (nj.status === '작업완료' && billed(nj) && unpaid(nj) === 0) return { ...nj, status: '정산완료' };
  if (nj.status === '정산완료' && unpaid(nj) > 0) return { ...nj, status: '작업완료' };
  return nj;
}

function clearPayments(j) {
  if (!confirm(`입금 기록 ${j.payments.length}건(${won(paidSum(j))})을 모두 지우고 미입금으로 되돌릴까요?`)) return;
  save('jobs', fixPaidStatus({ ...j, payments: [] }));
  toast('미입금으로 되돌렸어요');
}

function reviewSheet(j) {
  const rv = { ...(j.review || {}) };
  let rating = rv.rating || 0;
  const s = openSheet(`
    ${sheetHead('고객 후기')}
    <div class="field"><span>별점</span><div class="star-pick" id="rv-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${n <= rating ? 'on' : ''}">★</button>`).join('')}</div></div>
    <div class="field"><span>후기 남긴 곳</span>${chipRow('where', REVIEW_WHERE, rv.where)}</div>
    <label class="field"><span>후기 내용</span><textarea id="rv-text" placeholder="고객이 남긴 후기를 복사해서 붙여넣으세요">${esc(rv.text || '')}</textarea></label>
    <div style="margin:-6px 0 14px">
      <button type="button" class="btn sm ghost" id="rv-img">${ic('camera')} 복사가 안 되면: 캡처로 채우기</button>
      <input type="file" id="rv-file" accept="image/*" hidden />
      <div class="small muted" id="rv-msg" style="margin-top:6px"></div>
    </div>
    <label class="check"><input type="checkbox" id="rv-req" ${rv.requested ? 'checked' : ''} /> 후기 요청 보냄</label>
    <div class="foot"><button class="btn block" id="rv-save">저장</button></div>`);
  bindChips(s, 'where', null, true);
  // 복사가 막힌 후기: 캡처에서 글자를 읽어 넣고, 캡처는 '후기' 사진으로 보관
  let capture = null;
  $('#rv-img', s).onclick = () => $('#rv-file', s).click();
  $('#rv-file', s).onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const msg = $('#rv-msg', s);
    $('#rv-img', s).disabled = true;
    try {
      const text = await readImageText(f, (m) => (msg.textContent = m));
      const ta = $('#rv-text', s);
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + text;
      capture = f;
      msg.textContent = '캡처에서 읽은 글자를 넣었어요. 필요 없는 줄은 지우고 틀린 글자는 고쳐 주세요. 캡처 원본도 함께 저장돼요';
    } catch (err) {
      console.error(err);
      msg.textContent = '캡처를 읽지 못했어요. 인터넷 연결을 확인하거나 직접 입력해 주세요';
    } finally {
      $('#rv-img', s).disabled = false;
    }
  };
  $('#rv-stars', s).addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    rating = Number(b.dataset.n) === rating ? 0 : Number(b.dataset.n);
    $$('#rv-stars button', s).forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= rating));
  });
  $('#rv-save', s).onclick = async () => {
    const review = { rating, where: chipVal(s, 'where'), text: $('#rv-text', s).value.trim(), requested: $('#rv-req', s).checked };
    await save('jobs', { ...j, review });
    closeSheet();
    if (!capture) return;
    try {
      const added = await uploadPhotos(j.id, [capture], '후기');
      const fresh = store.state.jobs.find((x) => x.id === j.id) || j;
      await save('jobs', { ...fresh, photos: [...(fresh.photos || []), ...added] });
      toast('후기와 캡처를 저장했어요');
    } catch (e) {
      console.error(e);
      toast('후기 글은 저장했지만 캡처 사진은 올리지 못했어요');
    }
  };
}

/* ---------- 블로그 링크 ---------- */
// 블로그에 사진·후기를 올렸다면 앱에는 주소만 남겨 저장공간을 아낍니다.
function blogHost(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|m)\./, '');
    if (/blog\.naver/.test(h)) return '네이버 블로그';
    if (/tistory/.test(h)) return '티스토리';
    if (/instagram/.test(h)) return '인스타그램';
    if (/daangn|karrot/.test(h)) return '당근';
    return h;
  } catch {
    return url;
  }
}

function blogSheet(j, idx = -1) {
  const list = [...(j.blogs || [])];
  const cur = list[idx] || {};
  const s = openSheet(`
    ${sheetHead(idx >= 0 ? '블로그 링크 수정' : '블로그 링크 추가')}
    <label class="field"><span>글 주소</span><input id="bl-url" type="url" inputmode="url" placeholder="블로그 글의 주소를 붙여넣으세요" value="${esc(cur.url || '')}" /></label>
    <label class="field"><span>제목 (선택)</span><input id="bl-title" placeholder="비우면 '네이버 블로그'처럼 표시돼요" value="${esc(cur.title || '')}" /></label>
    <div class="foot btns">${idx >= 0 ? '<button class="btn danger" id="bl-del" style="flex:0 0 96px">삭제</button>' : ''}<button class="btn" id="bl-save">저장</button></div>`);
  if (idx < 0) setTimeout(() => $('#bl-url', s)?.focus(), 50);
  $('#bl-save', s).onclick = async () => {
    // 블로그 앱 '공유'로 복사하면 제목과 주소가 섞여 오므로 주소만 골라냅니다.
    const raw = $('#bl-url', s).value.trim();
    const found = raw.match(/https?:\/\/\S+/);
    const url = found ? found[0] : raw && !/\s/.test(raw) ? `https://${raw}` : '';
    if (!url) return toast('블로그 글 주소를 넣어 주세요');
    const item = { url, title: $('#bl-title', s).value.trim() };
    if (idx >= 0) list[idx] = item; else list.push(item);
    await save('jobs', { ...j, blogs: list });
    closeSheet();
    toast('블로그 링크를 저장했어요');
  };
  $('#bl-del', s) && ($('#bl-del', s).onclick = async () => {
    if (!confirm('이 블로그 링크를 지울까요? (블로그 글은 그대로 있어요)')) return;
    list.splice(idx, 1);
    await save('jobs', { ...j, blogs: list });
    closeSheet();
  });
}

/* ---------- 사진 ---------- */
function photoAddSheet(j) {
  if (store.mode === 'cloud' && !navigator.onLine) return toast('사진은 인터넷이 연결됐을 때 올릴 수 있어요');
  const s = openSheet(`
    ${sheetHead('사진 추가')}
    <p class="muted small" style="margin-top:-6px">어떤 사진인지 고르면 사진 선택 창이 열려요. 여러 장 한 번에 고를 수 있어요.</p>
    <div class="grid2">${PHOTO_STAGES.map((st) => `<button class="btn ghost" data-st="${st}" style="height:64px">${st}</button>`).join('')}</div>
    <p class="muted small">사진은 자동으로 줄여서(장당 약 300KB) 저장돼요. 원본은 휴대폰 갤러리에 그대로 있어요.</p>`);
  $$('[data-st]', s).forEach((b) => (b.onclick = () => {
    const input = $('#j-file');
    input.value = '';
    input.onchange = async () => {
      const files = [...input.files];
      closeSheet();
      if (!files.length) return;
      try {
        const added = await uploadPhotos(j.id, files, b.dataset.st, (i, n) => toast(`사진 올리는 중… ${i}/${n}`));
        const fresh = store.state.jobs.find((x) => x.id === j.id) || j;
        await save('jobs', { ...fresh, photos: [...(fresh.photos || []), ...added] });
        toast(`사진 ${added.length}장을 올렸어요`);
      } catch (e) {
        console.error(e);
        alert('사진을 올리지 못했습니다. 인터넷 연결을 확인해 주세요.\n' + (e.message || ''));
      }
    };
    input.click();
  }));
}

function openViewer(j, pid) {
  const list = (j.photos || []).filter((p) => ui.stage === '전체' || p.stage === ui.stage);
  let i = Math.max(0, list.findIndex((p) => p.id === pid));
  const root = document.createElement('div');
  root.className = 'viewer';
  document.body.appendChild(root);
  const close = () => root.remove();
  const draw = async () => {
    const p = list[i];
    root.innerHTML = `
      <div class="vt"><button class="icon-btn" data-x>${ic('x')}</button><div class="grow">${esc(p.stage)} · ${i + 1} / ${list.length}</div>
        <button class="icon-btn" data-prev ${i ? '' : 'disabled'}>${ic('left')}</button><button class="icon-btn" data-next ${i < list.length - 1 ? '' : 'disabled'}>${ic('right')}</button></div>
      <div class="vi"><img alt="" /></div>
      <div class="vb"><button class="btn" data-dl>${ic('down')} 내려받기</button><button class="btn" data-del>${ic('trash')} 삭제</button></div>`;
    $('[data-x]', root).onclick = close;
    $('[data-prev]', root).onclick = () => { if (i) { i--; draw(); } };
    $('[data-next]', root).onclick = () => { if (i < list.length - 1) { i++; draw(); } };
    $('[data-dl]', root).onclick = async () => {
      try { await downloadOne(p, `${custName(customerOf(j))}_${j.date || ''}_${p.stage}_${i + 1}.jpg`.replace(/[\\/:*?"<>|]/g, '_')); } catch (e) { alert('내려받지 못했습니다'); }
    };
    $('[data-del]', root).onclick = async () => {
      if (!confirm('이 사진을 지울까요?')) return;
      try { await deletePhotos([p]); } catch (e) { console.warn(e); }
      const fresh = store.state.jobs.find((x) => x.id === j.id) || j;
      await save('jobs', { ...fresh, photos: (fresh.photos || []).filter((x) => x.id !== p.id) });
      list.splice(i, 1);
      if (!list.length) return close();
      i = Math.min(i, list.length - 1);
      draw();
    };
    // 미리보기를 먼저 띄우고 큰 사진으로 교체
    const urls = await photoUrls([p.thumb, p.path]).catch(() => ({}));
    const img = $('img', root);
    if (img && urls[p.thumb]) img.src = urls[p.thumb];
    if (img && urls[p.path]) img.src = urls[p.path];
  };
  draw();
}

function zipSheet(jobs, name) {
  const n = jobs.reduce((s, j) => s + (j.photos || []).length, 0);
  if (!n) return toast('내려받을 사진이 없어요');
  const s = openSheet(`
    ${sheetHead('사진 내려받기')}
    <p class="muted" style="margin-top:-6px">사진 ${n}장을 ZIP 파일 하나로 받아요. 압축을 풀면 폴더별로 정리되어 있어요.</p>
    <div class="list">
      <button class="li" data-mode="customer"><div class="grow"><div class="t1">고객별 폴더</div><div class="t2">고객 › 날짜·현장 › 작업 전/중/후</div></div>${ic('down')}</button>
      <button class="li" data-mode="site"><div class="grow"><div class="t1">현장별 폴더</div><div class="t2">날짜·현장(고객) › 작업 전/중/후</div></div>${ic('down')}</button>
    </div>`);
  $$('[data-mode]', s).forEach((b) => (b.onclick = async () => {
    closeSheet();
    try {
      const cnt = await downloadZip(jobs, b.dataset.mode, `사진_${name}`, (i, t) => toast(`사진 모으는 중… ${i}/${t}`));
      toast(`사진 ${cnt}장을 내려받았어요`);
    } catch (e) {
      alert('내려받지 못했습니다: ' + (e.message || ''));
    }
  }));
}

/* ================= ② 고객 ================= */
function customerListHtml(cs) {
  const list = cs.filter(({ c }) => matches(`${c.name} ${c.region} ${c.phone} ${digits(c.phone)} ${c.address} ${c.memo}`, ui.cq));
  const sorters = {
    recent: (a, b) => (b.st.last || b.c.createdAt || '').localeCompare(a.st.last || a.c.createdAt || ''),
    count: (a, b) => b.st.count - a.st.count || b.st.total - a.st.total,
    total: (a, b) => b.st.total - a.st.total,
    name: (a, b) => (a.c.name || a.c.region || '').localeCompare(b.c.name || b.c.region || '', 'ko'),
  };
  list.sort(sorters[ui.csort] || sorters.recent);
  return list.map(({ c, st }) => `<button class="li" data-go="#customer/${c.id}">
        <div class="avatar">${initial(c)}</div>
        <div class="grow"><div class="t1">${esc(custName(c))} ${st.count >= 2 ? '<span class="badge-regular">단골</span>' : ''}${st.unpaid ? '<span class="pill red">미수</span>' : ''}</div>
        <div class="t2">${esc([fmtPhone(c.phone), st.last ? '최근 ' + md(st.last) : ''].filter(Boolean).join(' · ') || c.address || '')}</div></div>
        <div class="amt">${st.count}회<small>${st.total ? won(st.total) : ''}</small></div></button>`).join('')
    || `<div class="empty">${ui.cq ? '찾는 고객이 없습니다' : '고객이 없습니다'}</div>`;
}

function renderCustomers() {
  const cs = store.state.customers.map((c) => ({ c, st: customerStats(c.id) }));
  // 검색창이 이미 있으면(입력 중) 목록만 새로 그림 — 한글 조합이 끊기지 않게
  const cur = $('#cq');
  if (cur && $('#c-list')) {
    $('#c-list').innerHTML = customerListHtml(cs);
    return;
  }
  view.innerHTML = `
    <header class="hd"><div class="grow"><p class="eyebrow">${store.state.customers.length}명 · 단골 ${cs.filter((x) => x.st.count >= 2).length}명</p><h1>고객</h1></div>
      <button class="btn sm line" id="c-new">${ic('plus')} 고객</button></header>
    <label class="field" style="position:relative;margin-bottom:10px"><input id="cq" type="search" placeholder="이름, 동네, 전화번호 (초성도 가능: ㅁㅊㅎ)" value="${esc(ui.cq)}" autocomplete="off" style="padding-left:42px" /><span style="position:absolute;left:13px;top:13px;color:var(--faint)">${ic('search')}</span></label>
    ${chipRow('csort', [{ k: 'recent', label: '최근 작업순' }, { k: 'count', label: '단골순' }, { k: 'total', label: '매출순' }, { k: 'name', label: '이름순' }], ui.csort, 'scroll')}
    <div class="list" style="margin-top:12px" id="c-list">${customerListHtml(cs)}</div>`;
  const q = $('#cq');
  q.addEventListener('input', () => {
    ui.cq = q.value;
    $('#c-list').innerHTML = customerListHtml(store.state.customers.map((c) => ({ c, st: customerStats(c.id) })));
  });
  bindChips(view, 'csort', (v) => { ui.csort = v || 'recent'; saveUi(); render(); });
  $('#c-new').onclick = () => customerSheet();
}

function customerSheet(c) {
  const isNew = !c;
  const x = c ? { ...c } : { id: newId('cu'), name: '', region: '', phone: '', address: '', source: '', memo: '' };
  const s = openSheet(`
    ${sheetHead(isNew ? '새 고객' : '고객 정보 수정')}
    <div class="grid2"><label class="field"><span>이름</span><input id="cu-name" value="${esc(x.name)}" /></label><label class="field"><span>동네</span><input id="cu-region" value="${esc(x.region)}" placeholder="예: 별내동" /></label></div>
    <label class="field"><span>전화번호</span><input id="cu-phone" type="tel" value="${esc(fmtPhone(x.phone))}" /></label>
    <label class="field"><span>기본 주소</span><input id="cu-addr" value="${esc(x.address)}" /></label>
    <div class="field"><span>처음 유입경로</span>${chipRow('source', SOURCES, x.source)}</div>
    <label class="field"><span>메모 (성향, 주차, 출입 방법, 소개해 준 분 등)</span><textarea id="cu-memo">${esc(x.memo)}</textarea></label>
    <div class="foot"><button class="btn block" id="cu-save">저장</button></div>`);
  bindChips(s, 'source', null, true);
  $('#cu-save', s).onclick = async () => {
    const nx = { ...x, name: $('#cu-name', s).value.trim(), region: $('#cu-region', s).value.trim(), phone: fmtPhone($('#cu-phone', s).value), address: $('#cu-addr', s).value.trim(), source: chipVal(s, 'source'), memo: $('#cu-memo', s).value.trim() };
    if (!nx.name && !nx.phone && !nx.region) return toast('이름이나 전화번호를 넣어 주세요');
    const dup = digits(nx.phone) && store.state.customers.find((o) => o.id !== nx.id && digits(o.phone) === digits(nx.phone));
    if (dup && !confirm(`같은 번호의 고객(${custName(dup)})이 이미 있어요. 그래도 저장할까요?`)) return;
    await save('customers', nx);
    closeSheet();
    if (isNew) go('#customer/' + nx.id);
  };
}

function renderCustomer(id) {
  const c = store.state.customers.find((x) => x.id === id);
  if (!c) { go('#customers'); return; }
  const st = customerStats(id);
  const jobs = customerJobs(id);
  const photoN = jobs.reduce((s, j) => s + (j.photos || []).length, 0);
  view.innerHTML = `
    <header class="hd sub"><button class="icon-btn" data-back>${ic('back')}</button><h1 class="grow">${esc(custName(c))}</h1>
      <button class="btn sm line" id="cu-edit">${ic('edit')} 수정</button></header>
    <div class="card">
      <div class="row" style="margin-bottom:6px"><div class="avatar" style="width:52px;height:52px;font-size:20px">${initial(c)}</div>
        <div class="grow"><div style="font-size:19px;font-weight:800">${esc(c.name || custName(c))} ${st.count >= 2 ? '<span class="badge-regular">단골</span>' : ''}</div><div class="muted small">${esc(c.region || '')}${c.source ? ' · ' + esc(c.source) + '로 처음 연락' : ''}</div></div></div>
      ${c.phone ? `<div class="info-row">${ic('phone')}<div class="grow">${esc(fmtPhone(c.phone))}</div><div class="acts"><a class="btn sm ghost" href="tel:${digits(c.phone)}">전화</a><a class="btn sm ghost" href="sms:${digits(c.phone)}">문자</a></div></div>` : ''}
      ${c.address ? `<div class="info-row">${ic('home')}<div class="grow">${esc(c.address)}</div></div>` : ''}
      ${c.memo ? `<div class="info-row">${ic('msg')}<div class="grow note">${esc(c.memo)}</div></div>` : ''}
    </div>
    <section class="kpis">
      <div class="kpi"><div class="l">작업</div><div class="v">${st.count}<small>회</small></div></div>
      <div class="kpi"><div class="l">누적 매출</div><div class="v">${short(st.total)}</div></div>
      <div class="kpi"><div class="l">미수</div><div class="v" style="${st.unpaid ? 'color:var(--red)' : ''}">${short(st.unpaid)}</div></div>
    </section>
    <button class="btn block accent" id="cu-newjob" style="margin:6px 0 4px">${ic('plus')} 이 고객 새 작업 추가</button>
    <div class="sec-title">작업 이력<span class="r">${photoN ? `<button class="btn sm ghost" id="cu-zip">${ic('down')} 사진 ${photoN}장</button>` : ''}</span></div>
    ${jobs.map((j) => jobCard(j, true)).join('') || '<div class="empty">아직 작업이 없습니다</div>'}
    <button class="btn danger block" id="cu-del" style="margin-top:20px">${ic('trash')} 고객 삭제</button>`;
  $('[data-back]').onclick = () => (history.length > 1 ? history.back() : go('#customers'));
  $('#cu-edit').onclick = () => customerSheet(c);
  $('#cu-newjob').onclick = () => openJobForm({ customerId: id });
  $('#cu-zip') && ($('#cu-zip').onclick = () => zipSheet(jobs, custName(c)));
  $('#cu-del').onclick = () => {
    if (jobs.length) return alert(`작업이 ${jobs.length}건 있어 삭제할 수 없어요. 작업을 먼저 지워 주세요.`);
    if (!confirm('이 고객을 삭제할까요?')) return;
    remove('customers', id);
    go('#customers');
  };
}

/* ================= ③ 장부 ================= */
function renderLedger() {
  const from = monthStart(ui.lm), to = monthEnd(ui.lm);
  const m = toDate(from);
  const head = `
    <header class="hd"><div class="grow"><p class="eyebrow">매출 · 매입 ${syncBadge()}</p><h1>장부</h1></div></header>
    <div class="seg" style="margin-bottom:12px"><button class="${ui.lt === 'sales' ? 'on' : ''}" data-lt="sales">매출</button><button class="${ui.lt === 'buys' ? 'on' : ''}" data-lt="buys">매입</button></div>
    <div class="cal-head" style="margin-top:0"><button class="icon-btn" data-lm="-1">${ic('left')}</button><span class="m">${m.getFullYear()}년 ${m.getMonth() + 1}월</span><button class="icon-btn" data-lm="1">${ic('right')}</button></div>`;
  let body = '';
  if (ui.lt === 'sales') {
    const all = store.state.jobs.filter((j) => j.status !== '취소' && inRange(j.date, from, to) && (saleAmount(j) || ['작업완료', '정산완료'].includes(j.status)));
    const filt = { 전체: () => true, 미수: isReceivable, '계산서 미발행': needsInvoice, 완납: (j) => payState(j) === '완납' }[ui.lf] || (() => true);
    const list = all.filter(filt).sort(byDate);
    const total = all.reduce((s, j) => s + saleAmount(j), 0);
    const pays = store.state.jobs.flatMap((j) => j.payments || []).filter((p) => inRange(p.date, from, to));
    const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const recv = all.filter(isReceivable).reduce((s, j) => s + unpaid(j), 0);
    body = `
      <section class="kpis">
        <div class="kpi dark"><div class="l">매출</div><div class="v">${short(total)}</div></div>
        <div class="kpi"><div class="l">입금</div><div class="v">${short(paid)}</div></div>
        <div class="kpi"><div class="l">미수</div><div class="v" style="${recv ? 'color:var(--red)' : ''}">${short(recv)}</div></div>
      </section>
      ${chipRow('lf', ['전체', '미수', '계산서 미발행', '완납'], ui.lf, 'scroll')}
      <div class="list" style="margin-top:12px">${list.map((j) => {
        const ps = payState(j);
        return `<button class="li" data-go="#job/${j.id}"><div class="grow"><div class="t1">${esc(custName(customerOf(j)))} ${needsInvoice(j) ? '<span class="pill orange">계산서</span>' : ''}</div>
          <div class="t2">${md(j.date)} · ${esc(j.work || j.address || '')}</div></div>
          <div class="amt">${won(saleAmount(j))}<small>${ps === '완납' ? '완납' : isReceivable(j) ? `<span style="color:var(--red)">미수 ${num(unpaid(j))}</span>` : vatShort(j.vat)}</small></div></button>`;
      }).join('') || '<div class="empty">이 달 매출이 없습니다</div>'}</div>`;
  } else {
    const all = store.state.purchases.filter((p) => inRange(p.date, from, to));
    const filt = { 전체: () => true, 현장: (p) => p.jobId, 공통: (p) => !p.jobId, '계산서 미수취': (p) => p.taxInvoice?.need && !p.taxInvoice?.received, 인건비: (p) => p.category === '인건비', ...Object.fromEntries(PAYERS.map((w) => [w, (p) => p.payer === w])) }[ui.bf] || (() => true);
    const list = all.filter(filt).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const total = all.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const by = (w) => all.filter((p) => p.payer === w).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    body = `
      <section class="kpis">
        <div class="kpi dark"><div class="l">매입</div><div class="v">${short(total)}</div></div>
        ${PAYERS.map((w) => `<div class="kpi"><div class="l">${w} 결제</div><div class="v">${short(by(w))}</div></div>`).join('')}
      </section>
      ${chipRow('bf', ['전체', '현장', '공통', '계산서 미수취', '인건비', ...PAYERS], ui.bf, 'scroll')}
      <button class="btn block line" id="b-new" style="margin-top:12px">${ic('plus')} 매입 기록</button>
      <div class="list" style="margin-top:10px">${list.map((p) => {
        const j = p.jobId && store.state.jobs.find((x) => x.id === p.jobId);
        return `<button class="li" data-buy="${p.id}"><div class="grow"><div class="t1">${esc(p.item || p.category || '매입')} ${p.taxInvoice?.need && !p.taxInvoice?.received ? '<span class="pill orange">계산서</span>' : ''}</div>
          <div class="t2">${esc([md(p.date), p.vendor, p.payer, j ? custName(customerOf(j)) : '공통'].filter(Boolean).join(' · '))}</div></div>
          <div class="amt">${won(p.amount)}<small>${esc(p.method || '')}</small></div></button>`;
      }).join('') || '<div class="empty">이 달 매입이 없습니다</div>'}</div>`;
  }
  view.innerHTML = head + body;
  $$('[data-lt]').forEach((b) => (b.onclick = () => { ui.lt = b.dataset.lt; render(); }));
  $$('[data-lm]').forEach((b) => (b.onclick = () => { ui.lm = addMonths(ui.lm, Number(b.dataset.lm)); render(); }));
  bindChips(view, 'lf', (v) => { ui.lf = v || '전체'; render(); });
  bindChips(view, 'bf', (v) => { ui.bf = v || '전체'; render(); });
  $('#b-new') && ($('#b-new').onclick = () => purchaseSheet());
  $$('[data-buy]').forEach((b) => (b.onclick = () => purchaseSheet(store.state.purchases.find((p) => p.id === b.dataset.buy))));
}

/* ---------- 매입 입력 ---------- */
function purchaseSheet(p, jobId) {
  const isNew = !p;
  const x = p ? JSON.parse(JSON.stringify(p)) : {
    id: newId('bu'), date: today(), amount: '', vendor: '', item: '', category: jobId ? '현장 자재' : '', method: '카드', payer: me(),
    taxInvoice: { need: false, received: false, date: '' }, jobId: jobId || '', memo: '', labor: null,
  };
  const set = store.state.settings;
  const recentJobs = store.state.jobs
    .filter((j) => j.status !== '취소' && (j.id === x.jobId || !j.date || j.date >= addDays(today(), -60)))
    .sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999'));
  const l = x.labor || { name: '', phone: '', type: '일용직', days: 1, daily: '', reported: false, docs: false };
  const tiState = !x.taxInvoice?.need ? 'none' : x.taxInvoice.received ? 'received' : 'need';
  const s = openSheet(`
    ${sheetHead(isNew ? '매입 기록' : '매입 수정')}
    <label class="field"><span>연결 현장</span><select id="bu-job"><option value="">공통 매입 (현장 없음)</option>${recentJobs.map((j) => `<option value="${j.id}" ${j.id === x.jobId ? 'selected' : ''}>${md(j.date)} ${esc(custName(customerOf(j)))} ${esc((j.work || '').slice(0, 14))}</option>`).join('')}</select></label>
    ${moneyField('bu-amt', '금액', x.amount)}
    <div class="field"><span>분류</span>${chipRow('cat', BUY_CATS, x.category)}</div>
    <div id="labor-box" hidden class="card" style="background:var(--card)">
      <h3>인건비 정보</h3>
      <div class="grid2"><label class="field"><span>작업자 이름</span><input id="lb-name" list="lb-workers" value="${esc(l.name)}" autocomplete="off" /></label><label class="field"><span>연락처</span><input id="lb-phone" type="tel" value="${esc(l.phone)}" /></label></div>
      <datalist id="lb-workers">${(set.workers || []).map((w) => `<option value="${esc(w.name)}">`).join('')}</datalist>
      <div class="field"><span>구분</span>${chipRow('ltype', LABOR_TYPES, l.type)}</div>
      <div class="grid2"><label class="field"><span>일수</span><input id="lb-days" inputmode="decimal" value="${esc(l.days)}" /></label>${moneyField('lb-daily', '일당', l.daily)}</div>
      <div id="lb-calc" class="small" style="margin:-4px 0 10px"></div>
      <label class="check"><input type="checkbox" id="lb-docs" ${l.docs ? 'checked' : ''} /> 신고 서류(주민번호·계좌) 받음 <span class="faint small">— 번호 자체는 앱에 적지 마세요</span></label>
      <label class="check"><input type="checkbox" id="lb-rep" ${l.reported ? 'checked' : ''} /> 지급명세서 신고 완료</label>
    </div>
    <label class="field"><span>날짜</span><input type="date" id="bu-date" value="${esc(x.date)}" /></label>
    <label class="field" id="vendor-f"><span>구매처</span><input id="bu-vendor" value="${esc(x.vendor)}" placeholder="직접 입력 또는 아래에서 선택" autocomplete="off" /></label>
    <div class="chips" id="vendor-chips" style="margin:-6px 0 16px">${(set.vendors || []).map((v) => `<button type="button" class="chip sm ${v === x.vendor ? 'on' : ''}" data-vendor="${esc(v)}">${esc(v)}</button>`).join('')}</div>
    <label class="field"><span>매입내역</span><input id="bu-item" value="${esc(x.item)}" placeholder="예) 세면대, 홀쏘 32mm" autocomplete="off" /></label>
    <div class="field"><span>결제방식</span>${chipRow('method', BUY_METHODS, x.method)}</div>
    <div class="field"><span>결제자</span>${chipRow('payer', PAYERS, x.payer)}</div>
    <div class="field"><span>세금계산서</span>${chipRow('ti', [{ k: 'none', label: '해당없음' }, { k: 'need', label: '받아야 함' }, { k: 'received', label: '받음' }], tiState)}</div>
    <label class="field"><span>메모</span><input id="bu-memo" value="${esc(x.memo)}" autocomplete="off" /></label>
    <div class="foot btns">${isNew ? '' : '<button class="btn danger" id="bu-del" style="flex:0 0 96px">삭제</button>'}<button class="btn" id="bu-save">저장</button></div>`);
  moneyInput($('#bu-amt', s));
  moneyInput($('#lb-daily', s));
  bindChips(s, 'method');
  bindChips(s, 'payer', null, true);
  bindChips(s, 'ti');
  bindChips(s, 'ltype', () => calcLabor());
  const vin = $('#bu-vendor', s);
  $('#vendor-chips', s).addEventListener('click', (e) => {
    const b = e.target.closest('[data-vendor]');
    if (!b) return;
    vin.value = b.dataset.vendor;
    $$('#vendor-chips .chip', s).forEach((c) => c.classList.toggle('on', c === b));
  });
  function calcLabor() {
    if (chipVal(s, 'cat') !== '인건비') return;
    const c = laborCalc({ type: chipVal(s, 'ltype'), days: Number($('#lb-days', s).value) || 0, daily: parseNum($('#lb-daily', s).value) });
    if (c.gross) $('#bu-amt', s).value = num(c.gross);
    $('#lb-calc', s).innerHTML = c.gross ? `지급액 <b>${won(c.gross)}</b> · 원천징수 <b>${won(c.tax)}</b> · 실지급 <b>${won(c.net)}</b>` : '';
  }
  ['#lb-days', '#lb-daily'].forEach((q) => $(q, s).addEventListener('input', calcLabor));
  $('#lb-name', s).addEventListener('change', () => {
    const w = (set.workers || []).find((o) => o.name === $('#lb-name', s).value.trim());
    if (w) {
      if (!$('#lb-phone', s).value) $('#lb-phone', s).value = w.phone || '';
      if (w.type) $$('[data-chips="ltype"] button', s).forEach((b) => b.classList.toggle('on', b.dataset.v === w.type));
      calcLabor();
    }
  });
  const onCat = () => {
    const isLabor = chipVal(s, 'cat') === '인건비';
    $('#labor-box', s).hidden = !isLabor;
    $('#vendor-f', s).hidden = isLabor;
    $('#vendor-chips', s).hidden = isLabor;
    if (isLabor) {
      if (isNew) $$('[data-chips="method"] button', s).forEach((b) => b.classList.toggle('on', b.dataset.v === '계좌이체'));
      calcLabor();
    }
  };
  bindChips(s, 'cat', onCat, true);
  onCat();
  if (isNew) setTimeout(() => $('#bu-amt', s).focus({ preventScroll: true }), 50);

  $('#bu-save', s).onclick = async () => {
    const amount = parseNum($('#bu-amt', s).value);
    if (!amount) return toast('금액을 넣어 주세요');
    const category = chipVal(s, 'cat');
    const ti = chipVal(s, 'ti');
    const nx = {
      ...x, amount, category, date: $('#bu-date', s).value || today(),
      vendor: category === '인건비' ? '' : vin.value.trim(), item: $('#bu-item', s).value.trim(),
      method: chipVal(s, 'method'), payer: chipVal(s, 'payer'), jobId: $('#bu-job', s).value, memo: $('#bu-memo', s).value.trim(),
      taxInvoice: { need: ti !== 'none', received: ti === 'received', date: ti === 'received' ? x.taxInvoice?.date || today() : '' },
      labor: null,
    };
    const settings = { ...set };
    let changed = false;
    if (category === '인건비') {
      const name = $('#lb-name', s).value.trim();
      nx.labor = { name, phone: fmtPhone($('#lb-phone', s).value), type: chipVal(s, 'ltype'), days: Number($('#lb-days', s).value) || 0, daily: parseNum($('#lb-daily', s).value), docs: $('#lb-docs', s).checked, reported: $('#lb-rep', s).checked };
      if (!nx.item) nx.item = `인건비 ${name}`.trim();
      if (name && !(set.workers || []).some((w) => w.name === name)) {
        settings.workers = [...(set.workers || []), { name, phone: nx.labor.phone, type: nx.labor.type }];
        changed = true;
      }
    } else if (nx.vendor && !(set.vendors || []).includes(nx.vendor)) {
      settings.vendors = [...(set.vendors || []), nx.vendor];
      changed = true;
    }
    if (nx.payer && nx.payer !== me()) {
      // 이 기기 사용자가 아직 정해지지 않았으면 처음 고른 결제자로
      if (!me()) try { localStorage.setItem(ME_KEY, nx.payer); } catch (_) {}
    }
    await save('purchases', nx);
    if (changed) await saveSettings(settings);
    closeSheet();
    toast('매입을 기록했어요');
  };
  $('#bu-del', s) && ($('#bu-del', s).onclick = () => {
    if (!confirm('이 매입 기록을 지울까요?')) return;
    remove('purchases', x.id);
    closeSheet();
  });
}

/* ================= ④ 보고서 ================= */
function periodOf(k) {
  const t = today();
  const y = t.slice(0, 4);
  return {
    month: [monthStart(t), monthEnd(t)],
    last: [addMonths(t, -1), monthEnd(addMonths(t, -1))],
    h1: [`${y}-01-01`, `${y}-06-30`],
    h2: [`${y}-07-01`, `${y}-12-31`],
    year: [`${y}-01-01`, `${y}-12-31`],
  }[k];
}
function renderReport() {
  const r = summarize(ui.rfrom, ui.rto);
  const maxM = Math.max(1, ...r.months.map((m) => Math.max(m.sales, m.buys)));
  const hbars = (rows, key = 'amount') => {
    const mx = Math.max(1, ...rows.map((x) => x[key]));
    return rows.map((x) => `<div class="hbar"><span>${esc(x.label)}</span><span class="tr"><i style="width:${(x[key] / mx) * 100}%"></i></span><span class="v">${num(x[key])}${x.n != null ? ` <span class="faint small">${x.n}건</span>` : ''}</span></div>`).join('');
  };
  const jobLi = (j) => `<button class="li" data-go="#job/${j.id}"><div class="grow"><div class="t1">${esc(custName(customerOf(j)))}</div><div class="t2">${md(j.date)} · ${esc(j.work || '')}</div></div><div class="amt">${won(isReceivable(j) ? unpaid(j) : billed(j))}</div></button>`;
  view.innerHTML = `
    <header class="hd"><div class="grow"><p class="eyebrow">${r.from} ~ ${r.to}</p><h1>보고서</h1></div></header>
    ${chipRow('rp', [{ k: 'month', label: '이번 달' }, { k: 'last', label: '지난 달' }, { k: 'h1', label: '1~6월' }, { k: 'h2', label: '7~12월' }, { k: 'year', label: '올해' }, { k: 'custom', label: '직접 지정' }], ui.rp, 'scroll')}
    <div class="grid2" style="margin:10px 0 14px" ${ui.rp === 'custom' ? '' : 'hidden'}><input type="date" class="input" id="r-from" value="${ui.rfrom}" /><input type="date" class="input" id="r-to" value="${ui.rto}" /></div>
    <section class="kpis" style="margin-top:12px">
      <div class="kpi dark"><div class="l">매출</div><div class="v">${short(r.salesTotal)}</div></div>
      <div class="kpi"><div class="l">매입</div><div class="v">${short(r.buyTotal)}</div>${r.salesTotal ? `<div class="small muted">매출의 ${pct(r.buyTotal, r.salesTotal)}</div>` : ''}</div>
      <div class="kpi"><div class="l">차익</div><div class="v">${short(r.profit)}</div>${r.salesTotal ? `<div class="small muted">매출의 ${pct(r.profit, r.salesTotal)}</div>` : ''}</div>
    </section>
    ${r.salesTotal ? `<div class="card">
      <h3>매출 대비 매입 <span class="r" style="font-size:20px;font-weight:800;color:var(--ink)">${pct(r.buyTotal, r.salesTotal)}</span></h3>
      <div class="ratio">
        <i style="width:${Math.min(100, (r.buyTotal / r.salesTotal) * 100)}%;background:var(--accent)"></i>
        <i style="width:${Math.min(100, (r.feeTotal / r.salesTotal) * 100)}%;background:var(--faint)"></i>
        <i style="flex:1;background:var(--ink)"></i>
      </div>
      <div class="legend"><span><i class="b"></i>매입 ${pct(r.buyTotal, r.salesTotal)}</span>${r.feeTotal ? `<span><i style="background:var(--faint)"></i>카드 수수료 ${pct(r.feeTotal, r.salesTotal)}</span>` : ''}<span><i></i>차익 ${pct(r.profit, r.salesTotal)}</span></div>
      ${r.months.length > 1 ? `<hr class="sep" />${r.months.filter((m) => m.sales || m.buys).map((m) => `<div class="kv"><span class="muted">${Number(m.key.slice(5))}월 <span class="faint small">매출 ${num(m.sales)} · 매입 ${num(m.buys)}</span></span><span class="v">${m.sales ? pct(m.buys, m.sales) : '–'}</span></div>`).join('')}` : ''}
    </div>` : ''}
    <div class="card">
      <div class="kv"><span class="muted">작업 건수</span><span class="v">${r.jobCount}건</span></div>
      <div class="kv"><span class="muted">입금 합계</span><span class="v">${won(r.paidTotal)}</span></div>
      ${r.feeTotal ? `<div class="kv"><span class="muted">카드 수수료 (차익에서 뺌)</span><span class="v">${won(r.feeTotal)}</span></div>` : ''}
      ${r.vatExtraTotal ? `<div class="kv"><span class="muted">부가세 별도로 받을 금액</span><span class="v">${won(r.vatExtraTotal)}</span></div>` : ''}
      <div class="kv"><span class="muted">매입 (현장 / 공통)</span><span class="v">${num(r.siteBuy)} / ${num(r.commonBuy)}</span></div>
      <div class="kv"><span class="muted">미수금</span><span class="v" style="${r.receivableTotal ? 'color:var(--red)' : ''}">${won(r.receivableTotal)}</span></div>
    </div>
    ${r.months.length > 1 ? `<div class="card"><h3>월별 추이</h3><div class="bars">${r.months.map((m) => `<div class="col"><div class="pair"><i style="height:${(m.sales / maxM) * 100}%"></i><i class="b" style="height:${(m.buys / maxM) * 100}%"></i></div><span class="lb">${Number(m.key.slice(5))}월</span></div>`).join('')}</div><div class="legend"><span><i></i>매출</span><span><i class="b"></i>매입</span></div></div>` : ''}
    <div class="card"><h3>결제수단별 입금</h3>${hbars(r.byMethod)}</div>
    <div class="card"><h3>부가세 구분별 매출</h3>${hbars(r.byVat)}</div>
    <div class="card"><h3>유입경로별 매출</h3>${hbars(r.bySource)}</div>
    <div class="card"><h3>매입 분류별</h3>${hbars(r.byCat)}<hr class="sep" />${hbars(r.byPayer)}</div>
    ${r.receivables.length ? `<div class="sec-title">미수금<span class="r">${r.receivables.length}건</span></div><div class="list">${r.receivables.map(jobLi).join('')}</div>` : ''}
    ${r.invoicePending.length ? `<div class="sec-title">세금계산서 미발행<span class="r">${r.invoicePending.length}건</span></div><div class="list">${r.invoicePending.map(jobLi).join('')}</div>` : ''}
    ${r.buyInvoiceMissing.length ? `<div class="sec-title">매입 세금계산서 미수취<span class="r">${r.buyInvoiceMissing.length}건</span></div><div class="list">${r.buyInvoiceMissing.map((p) => `<div class="li"><div class="grow"><div class="t1">${esc(p.item || '')}</div><div class="t2">${md(p.date)} · ${esc(p.vendor || '')}</div></div><div class="amt">${won(p.amount)}</div></div>`).join('')}</div>` : ''}
    <div class="sec-title">내려받기<span class="r">${r.from} ~ ${r.to}</span></div>
    <div class="btns" style="margin-bottom:12px"><button class="btn accent" id="r-xlsx">${ic('down')} 엑셀 다운로드</button><button class="btn line" id="r-zip">${ic('camera')} 사진 다운로드</button></div>
  `;
  bindChips(view, 'rp', (v) => {
    ui.rp = v || 'month';
    if (ui.rp !== 'custom') [ui.rfrom, ui.rto] = periodOf(ui.rp);
    render();
  });
  const fi = $('#r-from'), ti = $('#r-to');
  const onRange = () => { if (fi.value && ti.value && fi.value <= ti.value) { ui.rfrom = fi.value; ui.rto = ti.value; render(); } };
  fi.onchange = onRange;
  ti.onchange = onRange;
  $('#r-xlsx').onclick = async () => {
    try {
      toast('엑셀 만드는 중…');
      await exportExcel(r);
    } catch (e) {
      alert('엑셀을 만들지 못했습니다: ' + (e.message || ''));
    }
  };
  $('#r-zip').onclick = () => zipSheet(r.jobs, `${r.from}_${r.to}`);
}

/* ================= 설정 ================= */
function renderSettings() {
  const set = store.state.settings;
  const used = usedBytes();
  const quota = (set.photoQuotaMB || 1024) * 1024 * 1024;
  const pct = Math.min(100, (used / quota) * 100);
  const photoN = store.state.jobs.reduce((s, j) => s + (j.photos || []).length, 0);
  view.innerHTML = `
    <header class="hd sub"><button class="icon-btn" data-back>${ic('back')}</button><h1 class="grow">설정</h1></header>
    <div class="card"><h3>이 휴대폰 사용자</h3>
      <p class="muted small" style="margin:-6px 0 10px">매입 '결제자'가 자동으로 선택돼요.</p>
      ${chipRow('me', PAYERS, me())}</div>
    <div class="card"><h3>사진 저장공간 <span class="r">${photoN}장</span></h3>
      <div class="gauge ${pct > 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
      <div class="row small"><span class="grow">${(used / 1024 / 1024).toFixed(1)}MB 사용 / ${set.photoQuotaMB || 1024}MB</span><b>${pct.toFixed(1)}%</b></div>
      ${pct > 80 ? '<p class="small" style="color:var(--red)">공간이 거의 찼어요. 오래된 현장 사진을 내려받아 보관한 뒤 정리해 주세요.</p>' : '<p class="muted small">무료 저장공간(1GB)에는 사진 약 3,000장이 들어가요.</p>'}</div>
    <div class="card"><h3>구매처</h3><textarea class="input" id="s-vendors" style="height:110px;padding:12px">${esc((set.vendors || []).join('\n'))}</textarea></div>
    <div class="card"><h3>입금 은행</h3><textarea class="input" id="s-banks" style="height:110px;padding:12px">${esc((set.banks || []).join('\n'))}</textarea></div>
    <button class="btn block" id="s-save" style="margin-bottom:12px">목록 저장</button>
    <div class="card"><h3>백업</h3>
      <p class="muted small" style="margin:-6px 0 10px">고객·작업·장부 전체를 파일로 받아 둘 수 있어요. (사진 제외)</p>
      <div class="btns"><button class="btn ghost" id="s-backup">${ic('down')} 백업 받기</button><label class="btn ghost">복원<input type="file" id="s-restore" accept=".json" hidden /></label></div></div>
    <div class="card"><h3>계정</h3>
      <div class="kv"><span class="muted">저장 방식</span><span class="v">${store.mode === 'cloud' ? '클라우드 (두 분 공유)' : '이 기기에만'}</span></div>
      ${store.user ? `<div class="kv"><span class="muted">로그인</span><span class="v small">${esc(store.user.email)}</span></div>` : ''}
      ${store.pending ? `<div class="kv"><span class="muted">아직 못 올린 변경</span><span class="v">${store.pending}건</span></div>` : ''}
      ${store.mode === 'cloud' ? '<button class="btn danger block" id="s-logout" style="margin-top:10px">로그아웃</button>' : ''}</div>`;
  $('[data-back]').onclick = () => (history.length > 1 ? history.back() : go('#schedule'));
  bindChips(view, 'me', (v) => { try { localStorage.setItem(ME_KEY, v); } catch (_) {} toast(v ? `이 휴대폰은 '${v}'로 기록돼요` : '선택 해제'); }, true);
  const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
  $('#s-save').onclick = async () => {
    await saveSettings({ ...set, vendors: lines('#s-vendors'), banks: lines('#s-banks') });
    toast('저장했어요');
  };
  $('#s-backup').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'hyeonjang', at: new Date().toISOString(), ...store.state }, null, 1)], { type: 'application/json' });
    download(blob, `현장장부_백업_${today()}.json`);
  };
  $('#s-restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'hyeonjang') throw new Error('이 앱의 백업 파일이 아닙니다');
      if (!confirm(`백업(${(d.at || '').slice(0, 10)})의 고객 ${d.customers?.length || 0}명, 작업 ${d.jobs?.length || 0}건, 매입 ${d.purchases?.length || 0}건을 불러올까요?\n같은 항목은 백업 내용으로 바뀝니다.`)) return;
      await restoreAll(d);
      toast('복원했어요');
    } catch (err) {
      alert('복원 실패: ' + err.message);
    }
  };
  $('#s-logout') && ($('#s-logout').onclick = () => confirm('로그아웃할까요?') && logout());
}

/* ================= 시작 ================= */
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g && view.contains(g)) go(g.dataset.go);
});
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go('#' + b.dataset.tab);
});
$('#fab').onclick = () => {
  const { r } = route();
  if (r === 'ledger' && ui.lt === 'buys') return purchaseSheet();
  openSheet(`${sheetHead('무엇을 기록할까요?')}
    <div class="list">
      <button class="li" data-q="job"><div class="avatar" style="background:var(--accent-soft);color:var(--accent)">${ic('cal')}</div><div class="grow"><div class="t1">새 일정 · 문의</div><div class="t2">고객, 날짜, 유입경로만 넣으면 끝</div></div></button>
      <button class="li" data-q="buy"><div class="avatar">${ic('wallet')}</div><div class="grow"><div class="t1">매입 기록</div><div class="t2">자재, 공구, 인건비 등 쓴 돈</div></div></button>
    </div>`, (s) => {
    $('[data-q="job"]', s).onclick = () => openJobForm();
    $('[data-q="buy"]', s).onclick = () => purchaseSheet();
  });
};

// 다른 앱에서 '공유하기'로 보낸 문자·채팅
function takeShared() {
  const q = new URLSearchParams(location.search);
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
  if (!text) return;
  history.replaceState(null, '', location.pathname + (q.has('local') ? '?local' : '') + '#schedule');
  const tryOpen = () => {
    if (store.ready && (store.mode === 'local' || store.user)) openJobForm({ prefill: text });
    else setTimeout(tryOpen, 300);
  };
  tryOpen();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
render();
initStore().then(takeShared);
