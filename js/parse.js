// 당근·네이버 톡톡·문자 내용(또는 캡처에서 읽은 글자)에서 이름, 전화번호, 주소, 날짜·시간,
// 금액, 요청 작업, 유입경로를 찾아냅니다. 확실하지 않은 것은 비워 두고, 원문은 메모에 남깁니다.
import { today, addDays, ymd, fmtPhone } from './util.js';

const WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
// 줄 맨 앞의 항목 이름 (당근 예약 화면: 고객 / 일정 / 금액 / 요청 / 주소 / 예약번호 …)
const LABELS = {
  name: /^(고객명?|이름|성함|예약자)\s*[:：]?\s*/,
  date: /^(일정|날짜|예약일시?|방문일시?|희망일)\s*[:：]?\s*/,
  amount: /^(금액|가격|견적|결제금액|총액)\s*[:：]?\s*/,
  work: /^(요청사항|요청|작업내용|문의내용|서비스|내용)\s*[:：]?\s*/,
  address: /^(주소|위치|현장|방문지)\s*[:：]?\s*/,
  extra: /^(예약번호|쿠폰|보낸\s*견적|메모|연락처|전화)\s*[:：]?\s*/,
};
const PHONE_RE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}|0\d{1,2}-\d{3,4}-\d{4}/;

function findDate(t) {
  const base = today();
  let m = t.match(/(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return ymd(new Date(y, mo - 1, d));
  }
  m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || t.match(/(?:^|[^\d])(\d{1,2})[/.](\d{1,2})(?:[^\d]|$)/);
  if (m) {
    const now = new Date();
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let y = now.getFullYear();
      // 이미 두 달 넘게 지난 날짜면 내년으로
      if (new Date(y, mo - 1, d) < new Date(now.getFullYear(), now.getMonth() - 2, 1)) y += 1;
      return ymd(new Date(y, mo - 1, d));
    }
  }
  if (/모레/.test(t)) return addDays(base, 2);
  if (/내일/.test(t)) return addDays(base, 1);
  if (/오늘/.test(t)) return base;
  m = t.match(/(다음\s*주\s*)?([일월화수목금토])요일/);
  if (m) {
    const now = new Date();
    let diff = (WD[m[2]] - now.getDay() + 7) % 7;
    if (m[1]) diff += 7;
    return addDays(base, diff);
  }
  return '';
}

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
function findTime(t) {
  const pm = (ap, h) => ((/오후|저녁|낮|밤/.test(ap || '') && h < 12) ? h + 12 : /오전|아침/.test(ap || '') && h === 12 ? 0 : h);
  // 오전 9:00 / 오후 2:30 / 14:00
  let m = t.match(/(오전|오후|아침|저녁|낮|밤)?\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)/);
  if (m) {
    let h = Number(m[2]);
    if (m[1]) h = pm(m[1], h);
    else if (h >= 1 && h <= 7) h += 12; // "2:00" → 보통 오후 2시
    return hhmm(h, Number(m[3]));
  }
  // 오후 2시 반 / 2시 30분
  m = t.match(/(오전|오후|아침|저녁|낮|밤)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (m) {
    let h = Number(m[2]);
    const min = m[3] === '반' ? 30 : Number(m[4] || 0);
    if (m[1]) h = pm(m[1], h);
    else if (h >= 1 && h <= 7) h += 12; // "2시" → 보통 오후 2시
    if (h <= 23 && min <= 59) return hhmm(h, min);
  }
  return '';
}

function looseAddress(lines) {
  const addrRe = /([가-힣]+(시|도)\s)?[가-힣]+(시|군|구)\s|[가-힣\d]+(로|길)\s?\d+|[가-힣]+(동|읍|면|리)\s|\d+\s*동\s*\d+\s*호|아파트|빌라|오피스텔|단지/;
  const hit = lines.find((l) => addrRe.test(l) && !PHONE_RE.test(l) && !/[년월]\s*\d|:\d\d/.test(l));
  return hit ? hit.trim().slice(0, 100) : '';
}

export function parseInquiry(text) {
  const t = String(text || '').replace(/\r/g, '');
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  // 1) "항목 이름 + 값" 형태의 줄 모으기 (주소가 두 줄로 나뉘면 이어 붙임)
  const got = {};
  let last = '';
  for (const l of lines) {
    const key = Object.keys(LABELS).find((k) => LABELS[k].test(l));
    if (key) {
      const v = l.replace(LABELS[key], '').trim();
      if (!got[key]) got[key] = v;
      last = key;
    } else if (last === 'address' && got.address && !PHONE_RE.test(l) && l.length < 40 && !/[년월]\s*\d|원$/.test(l)) {
      got.address += ' ' + l;
      last = '';
    } else last = '';
  }

  // 캡처에서 밑줄 친 번호는 맨 앞 0이 빠져 읽히기도 함 (1068657279 → 010-6865-7279)
  const phoneM = t.match(PHONE_RE) || (t.match(/(?<![\d,])1[016789]\d{7,8}(?![\d,])/) || []).map((x) => '0' + x);
  let name = '';
  if (got.name) name = got.name.split(/[·•ㆍ|,]/)[0].replace(PHONE_RE, '').replace(/[^가-힣a-zA-Z\s]/g, '').trim().slice(0, 12);
  if (!name) name = (t.match(/(?:이름|성함|고객명?)\s*[:：]\s*([가-힣a-zA-Z]{2,10})/) || [])[1] || '';

  const dateSrc = got.date || t;
  const amtM = (got.amount || '').match(/[\d,]{3,}/) || t.match(/([\d,]{4,})\s*원/);
  const amount = amtM ? Number((amtM[1] || amtM[0]).replace(/,/g, '')) || 0 : 0;

  let source = '';
  if (/당근|예약번호|약속이\s*확정|이용\s*완료/.test(t)) source = '당근';
  else if (/네이버|톡톡|스마트플레이스|naver/i.test(t)) source = '네이버';
  else if (/소개/.test(t)) source = '소개';

  return {
    phone: phoneM && phoneM[0] ? fmtPhone(phoneM[0]) : '',
    name,
    address: (got.address || looseAddress(lines)).replace(/\s+/g, ' ').trim(),
    date: findDate(dateSrc) || findDate(t),
    time: findTime(dateSrc) || findTime(t),
    amount,
    work: (got.work || '').slice(0, 60),
    // 당근 쿠폰 "10% 할인 사용예정"
    discountRate: Number((t.match(/(\d{1,2})\s*%\s*할인/) || [])[1]) || 0,
    source,
    raw: t.trim(),
  };
}
