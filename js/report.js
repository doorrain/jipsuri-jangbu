// 기간 보고서 계산과 엑셀 만들기. 엑셀에는 함수 없이 계산된 숫자만 넣습니다.
import { store } from './store.js';
import { loadScript } from './util.js';
import { VAT_MODES, PAY_METHODS, BUY_CATS, SOURCES, PAYERS } from './seed.js';
import {
  saleAmount, vatExtra, billed, paidSum, unpaid, payState, isReceivable, needsInvoice,
  customerOf, custName, inRange, laborCalc, jobCost,
} from './calc.js';

const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const vatLabel = (k) => VAT_MODES.find((v) => v.k === k)?.label || '부가세 없음';

export function summarize(from, to) {
  const { jobs: allJobs, purchases: allBuys } = store.state;
  const jobs = allJobs.filter((j) => j.status !== '취소' && inRange(j.date, from, to));
  const sales = jobs.filter((j) => saleAmount(j) > 0);
  const buys = allBuys.filter((p) => inRange(p.date, from, to));
  const pays = allJobs.flatMap((j) => (j.payments || []).map((p) => ({ ...p, job: j }))).filter((p) => inRange(p.date, from, to));

  const byVat = VAT_MODES.map((v) => ({ label: v.label, n: sales.filter((j) => (j.vat || 'none') === v.k).length, amount: sum(sales.filter((j) => (j.vat || 'none') === v.k), saleAmount) }));
  const byMethod = PAY_METHODS.map((m) => ({ label: m, amount: sum(pays.filter((p) => (p.method || '기타') === m), (p) => p.amount) }));
  const byCat = BUY_CATS.map((c) => ({ label: c, amount: sum(buys.filter((p) => (p.category || '현장 자재') === c), (p) => p.amount) }));
  const byPayer = PAYERS.map((w) => ({ label: w, amount: sum(buys.filter((p) => p.payer === w), (p) => p.amount) }));
  const bySource = SOURCES.map((s) => ({ label: s, n: jobs.filter((j) => (j.source || '기타') === s).length, amount: sum(jobs.filter((j) => (j.source || '기타') === s), saleAmount) }));

  // 월별 추이
  const months = [];
  for (let d = new Date(from.slice(0, 7) + '-01T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setMonth(d.getMonth() + 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      key: k,
      sales: sum(sales.filter((j) => j.date.startsWith(k)), saleAmount),
      buys: sum(buys.filter((p) => p.date.startsWith(k)), (p) => p.amount),
    });
  }

  const salesTotal = sum(sales, saleAmount);
  const buyTotal = sum(buys, (p) => p.amount);
  return {
    from, to, jobs, sales, buys, pays, byVat, byMethod, byCat, byPayer, bySource, months,
    jobCount: jobs.length,
    salesTotal,
    vatExtraTotal: sum(sales, vatExtra),
    paidTotal: sum(pays, (p) => p.amount),
    buyTotal,
    siteBuy: sum(buys.filter((p) => p.jobId), (p) => p.amount),
    commonBuy: sum(buys.filter((p) => !p.jobId), (p) => p.amount),
    profit: salesTotal - buyTotal,
    receivables: jobs.filter(isReceivable),
    receivableTotal: sum(jobs.filter(isReceivable), unpaid),
    invoicePending: jobs.filter(needsInvoice),
    buyInvoiceMissing: buys.filter((p) => p.taxInvoice?.need && !p.taxInvoice?.received),
    labor: buys.filter((p) => p.category === '인건비'),
  };
}

const X = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

function sheet(XLSX, rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

export async function exportExcel(r) {
  await loadScript(X);
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const cust = (j) => customerOf(j);

  const summary = [
    [`하이집수리 보고서  ${r.from} ~ ${r.to}`],
    [],
    ['항목', '금액(원)', '비고'],
    ['작업 건수', r.jobCount, '취소 제외'],
    ['매출 합계', r.salesTotal, '입력한 금액 기준'],
    ['부가세 별도로 받을 금액', r.vatExtraTotal, '부가세 별도 건의 10%'],
    ['입금 합계', r.paidTotal, '입금일 기준'],
    ['매입 합계', r.buyTotal, `현장 ${r.siteBuy.toLocaleString()} / 공통 ${r.commonBuy.toLocaleString()}`],
    ['차익 (매출 - 매입)', r.profit, ''],
    ['미수금', r.receivableTotal, `${r.receivables.length}건`],
    ['세금계산서 미발행(매출)', r.invoicePending.length, '건'],
    ['세금계산서 미수취(매입)', r.buyInvoiceMissing.length, '건'],
    [],
    ['부가세 구분별 매출', '금액(원)', '건수'],
    ...r.byVat.map((v) => [v.label, v.amount, v.n]),
    [],
    ['결제수단별 입금', '금액(원)'],
    ...r.byMethod.map((m) => [m.label, m.amount]),
    [],
    ['매입 분류별', '금액(원)'],
    ...r.byCat.map((c) => [c.label, c.amount]),
    [],
    ['결제자별 매입', '금액(원)'],
    ...r.byPayer.map((c) => [c.label, c.amount]),
    [],
    ['유입경로별', '매출(원)', '건수'],
    ...r.bySource.map((s) => [s.label, s.amount, s.n]),
    [],
    ['월', '매출(원)', '매입(원)', '차익(원)'],
    ...r.months.map((m) => [m.key, m.sales, m.buys, m.sales - m.buys]),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, summary, [26, 16, 28, 14]), '요약');

  const jobsRows = [
    ['작업일', '시간', '고객', '연락처', '현장 주소', '유입경로', '작업내역', '상태', '매출금액', '부가세', '받을 금액', '입금액', '미수금', '입금상태', '세금계산서', '발행일', '현장 매입', '현장 순이익', '후기', '특이사항'],
    ...[...r.jobs].sort((a, b) => a.date.localeCompare(b.date)).map((j) => [
      j.date, j.time || '', custName(cust(j)), cust(j)?.phone || '', j.address || '', j.source || '', j.work || '', j.status,
      saleAmount(j), vatLabel(j.vat), billed(j), paidSum(j), unpaid(j), payState(j),
      j.taxInvoice?.need ? (j.taxInvoice.issued ? '발행완료' : '미발행') : '해당없음', j.taxInvoice?.date || '',
      jobCost(j.id), saleAmount(j) - jobCost(j.id), j.review?.text || '', j.note || '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, jobsRows, [11, 6, 18, 14, 28, 9, 28, 9, 11, 11, 11, 11, 11, 9, 10, 11, 11, 11, 24, 24]), '작업내역');

  const payRows = [
    ['입금일', '고객', '현장 주소', '작업내역', '결제수단', '입금은행', '입금액', '부가세', '세금계산서'],
    ...[...r.pays].sort((a, b) => a.date.localeCompare(b.date)).map((p) => [
      p.date, custName(cust(p.job)), p.job.address || '', p.job.work || '', p.method || '', p.bank || '', Number(p.amount) || 0,
      vatLabel(p.job.vat), p.job.taxInvoice?.need ? (p.job.taxInvoice.issued ? '발행완료' : '미발행') : '해당없음',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, payRows, [11, 18, 28, 28, 9, 11, 12, 11, 10]), '입금내역');

  const jobName = (id) => {
    const j = store.state.jobs.find((x) => x.id === id);
    return j ? `${j.date || ''} ${custName(cust(j))}` : '공통';
  };
  const buyRows = [
    ['날짜', '구매처', '매입내역', '분류', '결제방식', '결제자', '금액', '세금계산서', '연결 현장', '메모'],
    ...[...r.buys].sort((a, b) => a.date.localeCompare(b.date)).map((p) => [
      p.date, p.vendor || '', p.item || '', p.category || '', p.method || '', p.payer || '', Number(p.amount) || 0,
      p.taxInvoice?.need ? (p.taxInvoice.received ? '수취완료' : '미수취') : '해당없음', jobName(p.jobId), p.memo || '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, buyRows, [11, 14, 30, 12, 10, 7, 12, 10, 22, 24]), '매입');

  if (r.labor.length) {
    const lr = [
      ['지급일', '성명', '연락처', '구분', '일수', '일당', '지급액', '원천징수(소득세+지방세)', '실지급액', '지급명세서', '연결 현장'],
      ...r.labor.map((p) => {
        const c = laborCalc(p.labor);
        return [p.date, p.labor?.name || '', p.labor?.phone || '', p.labor?.type || '', Number(p.labor?.days) || '', Number(p.labor?.daily) || '', c.gross, c.tax, c.net, p.labor?.reported ? '신고완료' : '미신고', jobName(p.jobId)];
      }),
    ];
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, lr, [11, 10, 14, 10, 6, 10, 12, 20, 12, 10, 22]), '인건비');
  }

  XLSX.writeFile(wb, `하이집수리_보고서_${r.from}_${r.to}.xlsx`);
}
