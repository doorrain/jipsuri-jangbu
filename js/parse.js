// 당근·네이버 톡톡·문자 내용을 붙여넣으면 전화번호, 주소, 날짜·시간, 유입경로를 찾아냅니다.
// 확실하지 않은 것은 비워 두고, 원문은 메모에 그대로 남깁니다.
import { today, addDays, ymd, fmtPhone } from './util.js';

const WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

function findDate(t) {
  const base = today();
  if (/모레/.test(t)) return addDays(base, 2);
  if (/내일/.test(t)) return addDays(base, 1);
  if (/오늘/.test(t)) return base;
  let m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || t.match(/(?:^|[^\d])(\d{1,2})[/.](\d{1,2})(?:[^\d]|$)/);
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
  m = t.match(/(다음\s*주\s*)?([일월화수목금토])요일/);
  if (m) {
    const now = new Date();
    let diff = (WD[m[2]] - now.getDay() + 7) % 7;
    if (m[1]) diff += diff === 0 ? 7 : 7;
    return addDays(base, diff);
  }
  return '';
}

function findTime(t) {
  let m = t.match(/(오전|오후|아침|저녁|낮)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (m) {
    let h = Number(m[2]);
    const min = m[3] === '반' ? 30 : Number(m[4] || 0);
    if ((m[1] === '오후' || m[1] === '저녁' || m[1] === '낮') && h < 12) h += 12;
    else if (!m[1] && h >= 1 && h <= 7) h += 12; // "2시" → 보통 오후 2시
    if (h <= 23 && min <= 59) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = t.match(/(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?:[^\d]|$)/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return '';
}

function findAddress(lines) {
  const addrRe = /([가-힣]+(시|도)\s)?[가-힣]+(시|군|구)\s|[가-힣\d]+(로|길)\s?\d+|[가-힣]+(동|읍|면|리)\s|\d+\s*동\s*\d+\s*호|아파트|빌라|오피스텔|단지/;
  const hit = lines.find((l) => addrRe.test(l) && !/^\s*\d{2,3}-?\d{3,4}-?\d{4}\s*$/.test(l));
  return hit ? hit.replace(/^(주소|위치|현장)\s*[:：]?\s*/, '').trim().slice(0, 80) : '';
}

export function parseInquiry(text) {
  const t = String(text || '');
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const phone = (t.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/) || t.match(/0\d{1,2}-\d{3,4}-\d{4}/) || [''])[0];
  const name = (t.match(/(?:이름|성함|고객명?)\s*[:：]\s*([가-힣a-zA-Z]{2,10})/) || [])[1] || '';
  let source = '';
  if (/당근/.test(t)) source = '당근';
  else if (/네이버|톡톡|스마트플레이스|naver/i.test(t)) source = '네이버';
  else if (/소개/.test(t)) source = '소개';
  return {
    phone: phone ? fmtPhone(phone) : '',
    name,
    address: findAddress(lines),
    date: findDate(t),
    time: findTime(t),
    source,
    raw: t.trim(),
  };
}
