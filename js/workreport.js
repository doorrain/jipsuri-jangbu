// 작업 보고서 PDF (A4): 집주인·관리인에게 보내는 작업 요청 / 작업 내용 / 남은 작업 / 현장 사진 보고.
// 견적 앱처럼 A4 크기 HTML을 그린 뒤 이미지로 찍어 PDF에 붙입니다(한글 글꼴 문제 없음).
// 고객 전화번호는 넣지 않고, 현장명(고객으로 등록한 이름 그대로)·작업 날짜만 넣습니다.
// 사진은 원본 비율 그대로 2장씩(최대 6장) 넣고, 첫 장에 다 안 들어가면 다음 장으로 이어 붙입니다.
import { getBlob } from './photos.js';
import { esc, loadScript, md } from './util.js';

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];
export const COMPANY = { name: '하이집수리', person: '담당자', phone: '010-6341-3012' };
const W = 794, H = 1123, PAD = 44; // A4 @96dpi
const GAP = 10;
const COL_W = (W - PAD * 2 - GAP) / 2; // 사진 한 칸 너비
const MAX_PH = 420; // 세로 사진이 너무 길어지지 않게 (비율은 그대로, 크기만 줄임)

const CSS = `
.wr{width:${W}px;height:${H}px;padding:${PAD}px;box-sizing:border-box;background:#fff;color:#1c2430;font-family:'Noto Sans KR',sans-serif;
  font-size:13px;line-height:1.5;display:flex;flex-direction:column;overflow:hidden}
.wr *{box-sizing:border-box}
.wr .top{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1f3a5f;padding-bottom:12px;flex:none}
.wr .top img{height:84px;margin:-8px 0}
.wr .top.mini img{height:48px;margin:-4px 0}
.wr .top .t{flex:1;text-align:right}
.wr .top h1{margin:0;font-size:28px;font-weight:900;color:#1f3a5f;letter-spacing:4px}
.wr .top.mini h1{font-size:18px;letter-spacing:2px}
.wr .top .s{font-size:12px;color:#6b7686;margin-top:2px}
.wr table{width:100%;border-collapse:collapse;margin:14px 0 6px;font-size:13px;flex:none}
.wr th{width:92px;background:#eef2f7;color:#1f3a5f;font-weight:700;text-align:left;padding:7px 10px;border:1px solid #d5dce6}
.wr td{padding:7px 10px;border:1px solid #d5dce6}
.wr .sec{margin-top:12px;flex:none}
.wr .sec h2{margin:0 0 6px;font-size:15px;font-weight:800;color:#fff;background:#1f3a5f;border-radius:6px;padding:5px 12px;display:flex;gap:8px}
.wr .sec h2 i{font-style:normal;color:#f1a25e}
.wr .tx{white-space:pre-wrap;word-break:keep-all;padding:2px 4px 4px;font-size:13px}
.wr .row{display:flex;gap:${GAP}px;margin-top:${GAP}px;align-items:flex-start;flex:none}
.wr .row .cell{width:${COL_W}px;display:flex;justify-content:center}
.wr .row img{display:block;border-radius:4px}
.wr .ft{margin-top:auto;border-top:1px solid #e2e6ec;padding-top:8px;display:flex;justify-content:space-between;font-size:11px;color:#8a94a3;flex:none}
`;

// 사진은 미리 받아 둔 같은 출처 주소(blob)로 넣어야 PDF 그림에 빠지지 않음. 원본 가로·세로도 함께
async function loadPhotos(photos) {
  const out = [];
  for (const p of photos) {
    try {
      const url = URL.createObjectURL(await getBlob(p.path));
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      out.push({ url, w: im.naturalWidth, h: im.naturalHeight });
    } catch (_) { /* 못 받은 사진은 건너뜀 */ }
  }
  return out;
}

// 원본 비율 그대로: 칸 너비에 맞추되, 너무 긴 세로 사진은 높이를 MAX_PH로 (가로도 같이 줄어 찌그러지지 않음)
function imgTag(p) {
  let w = COL_W, h = (COL_W * p.h) / p.w;
  if (h > MAX_PH) { h = MAX_PH; w = (MAX_PH * p.w) / p.h; }
  return `<img src="${p.url}" style="width:${Math.round(w)}px;height:${Math.round(h)}px" />`;
}

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
  const pics = await loadPhotos((r.photos || []).slice(0, 6));
  const isFinal = r.type === '최종';
  const title = isFinal ? '최종 작업 보고서' : '작업 보고서';
  const done = [r.check, r.done].filter(Boolean).join('\n'); // 예전 보고서의 '현장 확인'은 작업 내용 앞에
  const photoNo = !isFinal && r.remain ? 4 : 3;
  const ft = `<div class="ft"><span>${COMPANY.name} · ${COMPANY.person} ${COMPANY.phone}</span><span class="pg"></span></div>`;

  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-10000px;top:0';
  stage.innerHTML = `<style>${CSS}</style>`;
  document.body.append(stage);
  const pages = [];
  const newPage = (html) => {
    const pg = document.createElement('div');
    pg.className = 'wr';
    pg.innerHTML = html + ft;
    stage.append(pg);
    pages.push(pg);
    return pg;
  };
  const fits = (pg) => pg.scrollHeight <= H;
  try {
    newPage(`
      <div class="top"><img src="${logoUrl}" /><div class="t"><h1>${title}</h1>
        <div class="s">${isFinal ? '작업 전체 요약' : `작업 중간 보고${r.seq ? ` · ${r.seq}차` : ''}`}</div></div></div>
      <table>
        <tr><th>현장명</th><td>${esc(r.site || '-')}</td></tr>
        <tr><th>작업 날짜</th><td>${esc(r.dateLabel || '-')}</td></tr>
      </table>
      <div class="sec"><h2><i>1</i>작업 요청</h2><div class="tx">${esc(r.request || '-')}</div></div>
      <div class="sec"><h2><i>2</i>${isFinal ? '작업 경과 및 완료' : '작업 내용'}</h2><div class="tx">${esc(done || '-')}</div></div>
      ${!isFinal && r.remain ? `<div class="sec"><h2><i>3</i>남은 작업</h2><div class="tx">${esc(r.remain)}</div></div>` : ''}`);
    await Promise.all(['400', '700', '800', '900'].map((w) => document.fonts.load(`${w} 14px "Noto Sans KR"`, stage.textContent).catch(() => {})));
    await document.fonts.ready;

    // 사진 2장씩 한 줄. 줄이 들어갈 자리가 없으면 다음 장에 이어서 (제목 칸은 첫 줄과 같이 움직임)
    for (let i = 0; i < pics.length; i += 2) {
      const row = `<div class="row">${pics.slice(i, i + 2).map((p) => `<div class="cell">${imgTag(p)}</div>`).join('')}</div>`;
      const head = i === 0 ? `<div class="sec"><h2><i>${photoNo}</i>현장 사진</h2></div>` : '';
      let pg = pages[pages.length - 1];
      const ftEl = pg.querySelector('.ft');
      ftEl.insertAdjacentHTML('beforebegin', head + row);
      if (!fits(pg)) {
        // 방금 넣은 것 빼고 새 장으로
        const added = [...pg.children].slice([...pg.children].indexOf(ftEl) - (head ? 2 : 1), [...pg.children].indexOf(ftEl));
        added.forEach((n) => n.remove());
        pg = newPage(`<div class="top mini"><img src="${logoUrl}" /><div class="t"><h1>${title}</h1><div class="s">${esc(r.site || '')} · 현장 사진 (이어서)</div></div></div>`);
        pg.querySelector('.ft').insertAdjacentHTML('beforebegin', (head || `<div class="sec"><h2><i>${photoNo}</i>현장 사진 (이어서)</h2></div>`) + row);
      }
    }
    const written = md(r.writtenOn || '') || '';
    pages.forEach((pg, i) => { pg.querySelector('.pg').textContent = `작성일 ${written}${pages.length > 1 ? `  ·  ${i + 1} / ${pages.length}` : ''}`; });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
    }
    const safe = (x) => String(x || '').replace(/[\\/:*?"<>|·\s]+/g, '_').slice(0, 30);
    return { blob: pdf.output('blob'), filename: `${isFinal ? '최종작업보고서' : '작업보고서'}_${safe(r.site) || '현장'}_${(r.writtenOn || '').slice(5)}.pdf`, pages: pages.length };
  } finally {
    pics.forEach((p) => URL.revokeObjectURL(p.url));
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
