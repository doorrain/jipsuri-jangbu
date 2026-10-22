// 돈 계산은 모두 여기서. 엑셀처럼 칸마다 함수가 있지 않아 틀어질 일이 없습니다.
import { store } from './store.js';

const floor10 = (n) => Math.floor(n / 10) * 10;

/* ---------- 작업(매출) ---------- */
// 최종 금액 = 견적 금액 − 할인 + 추가. 부가세 별도면 받을 금액은 여기에 10%를 더한 금액.
export const quoteAmount = (job) => Number(job.amount) || 0;
export const finalAmount = (job) => Math.max(0, quoteAmount(job) - (Number(job.discount) || 0) + (Number(job.extra) || 0));
export const saleAmount = (job) => (job.status === '취소' ? 0 : finalAmount(job));
export const vatExtra = (job) => (job.vat === 'excl' ? Math.round(saleAmount(job) * 0.1) : 0);
export const billed = (job) => saleAmount(job) + vatExtra(job);
export const paidSum = (job) => (job.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const unpaid = (job) => Math.max(0, billed(job) - paidSum(job));
export function payState(job) {
  const b = billed(job);
  if (!b) return '';
  const p = paidSum(job);
  if (p >= b) return '완납';
  return p > 0 ? '부분입금' : '미입금';
}
// 미수: 작업이 끝났는데(작업완료/정산완료) 받을 돈이 남은 건
export const isReceivable = (job) => ['작업완료', '정산완료'].includes(job.status) && unpaid(job) > 0;
export const needsInvoice = (job) => job.status !== '취소' && job.taxInvoice?.need && !job.taxInvoice?.issued;

export const jobPurchases = (jobId) => store.state.purchases.filter((p) => p.jobId === jobId);
export const jobCost = (jobId) => jobPurchases(jobId).reduce((s, p) => s + (Number(p.amount) || 0), 0);
export const jobProfit = (job) => saleAmount(job) - jobCost(job.id);

/* ---------- 고객 ---------- */
export const customerOf = (job) => store.state.customers.find((c) => c.id === job.customerId);
export const custName = (c) => (c ? [c.region, c.name].filter(Boolean).join(' · ') || '(이름 없음)' : '(고객 없음)');
export const customerJobs = (cid) =>
  store.state.jobs.filter((j) => j.customerId === cid).sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999'));
export function customerStats(cid) {
  const jobs = customerJobs(cid).filter((j) => j.status !== '취소');
  return {
    count: jobs.length,
    total: jobs.reduce((s, j) => s + saleAmount(j), 0),
    last: jobs.map((j) => j.date).filter(Boolean).sort().pop() || '',
    unpaid: jobs.reduce((s, j) => s + (isReceivable(j) ? unpaid(j) : 0), 0),
  };
}

/* ---------- 인건비 원천징수 (기존 엑셀 인건비대장과 같은 계산) ---------- */
export function laborCalc(l) {
  const days = Number(l?.days) || 0;
  const daily = Number(l?.daily) || 0;
  const gross = days && daily ? days * daily : Number(l?.gross) || 0;
  let income = 0;
  if (l?.type === '외주(3.3%)') income = floor10(gross * 0.03);
  else if (l?.type === '일용직') {
    // 일당 15만 원 초과분 × 6% × (1-55% 세액공제), 하루 1,000원 미만은 안 뗌
    const perDay = floor10(Math.max(0, daily - 150000) * 0.06 * 0.45);
    income = (perDay < 1000 ? 0 : perDay) * days;
  }
  const local = floor10(income * 0.1);
  return { gross, income, local, tax: income + local, net: gross - income - local };
}

/* ---------- 기간 ---------- */
export const inRange = (d, from, to) => !!d && d >= from && d <= to;
