// 견적 앱에서 만든 견적서 불러오기.
// 같은 서버의 'docs' 표(견적 앱)에서 견적을 읽고, PDF는 견적 앱의 pdf.js로 똑같이 만듭니다.
import { store, supabase } from './store.js';

export const QUOTE_APP = 'https://doorrain.github.io/jipsuri-gyeonjeok';

// 견적 목록 (최근 것 먼저) + 견적 앱 설정(상호·연락처 등, PDF에 들어감)
export async function listQuotes() {
  if (store.mode !== 'cloud') throw new Error('이 기기에만 저장하는 모드에서는 견적 앱과 연결되지 않아요');
  const { data, error } = await supabase().from('docs').select('col,id,data').in('col', ['quotes', 'settings']);
  if (error) throw error;
  const settings = data.find((r) => r.col === 'settings')?.data || {};
  const quotes = data
    .filter((r) => r.col === 'quotes')
    .map((r) => ({ ...r.data, id: r.id }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.no || '').localeCompare(String(a.no || '')));
  return { quotes, settings };
}

let mods = null;
async function quoteModules() {
  if (!mods) {
    mods = Promise.all([import(`${QUOTE_APP}/js/pdf.js`), import(`${QUOTE_APP}/js/quote.js`)])
      .then(([pdf, quote]) => ({ makeQuotePdf: pdf.makeQuotePdf, calcTotals: quote.calcTotals }))
      .catch((e) => { mods = null; throw e; });
  }
  return mods;
}

export async function quoteTotal(q) {
  try {
    const { calcTotals } = await quoteModules();
    return calcTotals(q).total || 0;
  } catch (_) {
    return 0;
  }
}

// 견적 앱 PDF 도구가 쓰는 준비물(숨은 그리기 칸, 한글 글꼴)을 갖춘 뒤 PDF 만들기
export async function quotePdf(q, settings) {
  if (!document.getElementById('pdf-stage')) {
    const st = document.createElement('div');
    st.id = 'pdf-stage';
    st.setAttribute('aria-hidden', 'true');
    st.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.append(st);
  }
  if (!document.querySelector('link[data-noto]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.dataset.noto = '1';
    l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap';
    document.head.append(l);
  }
  const { makeQuotePdf } = await quoteModules();
  return makeQuotePdf(q, settings); // { blob, filename }
}
