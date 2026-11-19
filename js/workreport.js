// 작업 보고서 PDF (A4 1장): 집주인·관리인에게 보내는 작업 요청 / 현장 확인 / 작업 완료 보고.
// 견적 앱처럼 A4 크기 HTML을 그린 뒤 이미지로 찍어 PDF에 붙입니다(한글 글꼴 문제 없음).
// 고객 전화번호는 넣지 않고, 현장명(고객으로 등록한 이름 그대로)·작업 날짜만 넣습니다.
import { getBlob } from './photos.js';
import { esc, loadScript, md } from './util.js';

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];
export const COMPANY = { name: '하이집수리', person: '담당자', phone: '010-6341-3012' };
const W = 794, H = 1123, PAD = 44; // A4 @96dpi

const CSS = `
.wr{width:${W}px;height:${H}px;padding:${PAD}px;box-sizing:border-box;background:#fff;color:#1c2430;font-family:'Noto Sans KR',sans-serif;
  font-size:13px;line-height:1.5;display:flex;flex-direction:column;overflow:hidden}
.wr *{box-sizing:border-box}
.wr .top{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1f3a5f;padding-bottom:12px}
.wr .top img{height:84px;margin:-8px 0}
.wr .top .t{flex:1;text-align:right}
.wr .top h1{margin:0;font-size:28px;font-weight:900;color:#1f3a5f;letter-spacing:4px}
.wr .top .s{font-size:12px;color:#6b7686;margin-top:2px}
.wr table{width:100%;border-collapse:collapse;margin:14px 0 6px;font-size:13px}
.wr th{width:92px;background:#eef2f7;color:#1f3a5f;font-weight:700;text-align:left;padding:7px 10px;border:1px solid #d5dce6}
.wr td{padding:7px 10px;border:1px solid #d5dce6}
.wr .sec{margin-top:12px;display:flex;flex-direction:column;flex:none}
.wr .sec h2{margin:0 0 6px;font-size:15px;font-weight:800;color:#fff;background:#1f3a5f;border-radius:6px;padding:5px 12px;display:flex;gap:8px}
.wr .sec h2 i{font-style:normal;color:#f1a25e}
.wr .tx{white-space:pre-wrap;word-break:keep-all;padding:2px 4px 4px;font-size:13px}
.wr .ph{display:grid;gap:8px;margin-top:4px}
.wr .ph div{border-radius:6px;overflow:hidden;background:#f1f4f8;border:1px solid #e2e7ee}
.wr .ph img{width:100%;height:100%;object-fit:cover;display:block}
.wr .ft{margin-top:auto;border-top:1px solid #e2e6ec;padding-top:8px;display:flex;justify-content:space-between;font-size:11px;color:#8a94a3}
`;

// 사진은 미리 받아 둔 같은 출처 주소(blob)로 넣어야 PDF 그림에 빠지지 않음
async function photoSrcs(photos) {
  const out = [];
  for (const p of photos) {
    try { out.push(URL.createObjectURL(await getBlob(p.path))); } catch (_) { /* 못 받은 사진은 건너뜀 */ }
  }
  return out;
}

// 사진은 몇 장이든 같은 크기로 2장씩 (최대 6장 = 3줄)
const PHOTO_H = 150;
const grid = (srcs) => (srcs.length
  ? `<div class="ph" style="grid-template-columns:repeat(2,1fr)">${srcs.map((s) => `<div class="cell" style="height:${PHOTO_H}px"><img src="${s}" /></div>`).join('')}</div>`
  : '');

// r: { type:'중간'|'최종', dateLabel, site, request, check(예전 보고서), done, remain, photos:[photo], seq }
export async function makeReportPdf(r, logoUrl) {
  await Promise.all(LIBS.map(loadScript));
  if (!document.querySelector('link[data-noto]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.dataset.noto = '1';
    l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap';
    document.head.append(l);
  }
  const srcs = await photoSrcs(r.photos || []);
  const isFinal = r.type === '최종';
  const done = [r.check, r.done].filter(Boolean).join('\n'); // 예전 보고서의 '현장 확인'은 작업 내용 앞에
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-10000px;top:0';
  stage.innerHTML = `<style>${CSS}</style>
    <div class="wr">
      <div class="top"><img src="${logoUrl}" /><div class="t"><h1>${isFinal ? '최종 작업 보고서' : '작업 보고서'}</h1>
        <div class="s">${isFinal ? '작업 전체 요약' : `작업 중간 보고${r.seq ? ` · ${r.seq}차` : ''}`}</div></div></div>
      <table>
        <tr><th>현장명</th><td>${esc(r.site || '-')}</td></tr>
        <tr><th>작업 날짜</th><td>${esc(r.dateLabel || '-')}</td></tr>
      </table>
      <div class="sec"><h2><i>1</i>작업 요청</h2><div class="tx">${esc(r.request || '-')}</div></div>
      <div class="sec"><h2><i>2</i>${isFinal ? '작업 경과 및 완료' : '작업 내용'}</h2><div class="tx">${esc(done || '-')}</div></div>
      ${!isFinal && r.remain ? `<div class="sec"><h2><i>3</i>남은 작업</h2><div class="tx">${esc(r.remain)}</div></div>` : ''}
      ${srcs.length ? `<div class="sec"><h2><i>${!isFinal && r.remain ? 4 : 3}</i>현장 사진</h2>${grid(srcs)}</div>` : ''}
      <div class="ft"><span>${COMPANY.name} · ${COMPANY.person} ${COMPANY.phone}</span><span>작성일 ${esc(md(r.writtenOn || '') || '')}</span></div>
    </div>`;
  document.body.append(stage);
  try {
    await Promise.all(['400', '700', '800', '900'].map((w) => document.fonts.load(`${w} 14px "Noto Sans KR"`, stage.textContent).catch(() => {})));
    await document.fonts.ready;
    await Promise.all([...stage.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((res) => { im.onload = im.onerror = res; }))));
    // 사진 크기는 고정. 글이 길어 한 장을 넘치면 글자를 조금씩 줄임
    const page = stage.querySelector('.wr');
    let fs = 13;
    while (page.scrollHeight > H && fs > 10.5) {
      fs -= 0.5;
      stage.querySelectorAll('.tx').forEach((t) => (t.style.fontSize = fs + 'px'));
    }
    // 글이 아주 길어 그래도 넘칠 때만, 잘리지 않게 사진을 조금 줄임
    let ph = PHOTO_H;
    while (page.scrollHeight > H && ph > 100) {
      ph -= 5;
      stage.querySelectorAll('.cell').forEach((c) => (c.style.height = ph + 'px'));
    }
    const canvas = await window.html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
    const safe = (x) => String(x || '').replace(/[\\/:*?"<>|·\s]+/g, '_').slice(0, 30);
    return { blob: pdf.output('blob'), filename: `${isFinal ? '최종작업보고서' : '작업보고서'}_${safe(r.site) || '현장'}_${(r.writtenOn || '').slice(5)}.pdf` };
  } finally {
    stage.querySelectorAll('img').forEach((im) => im.src.startsWith('blob:') && URL.revokeObjectURL(im.src));
    stage.remove();
  }
}

// 휴대폰은 공유(카톡 등), 안 되면 내려받기
export async function shareOrDownload(blob, filename, download, type = 'application/pdf') {
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancel';
    }
  }
  download(blob, filename);
  return 'downloaded';
}
