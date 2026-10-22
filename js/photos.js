// 현장 사진: 올리기 전에 자동으로 줄여서(긴 변 1600px, 약 300KB) 저장하고,
// 목록에는 작은 미리보기(긴 변 360px)만 띄워 무료 용량·전송량을 아낍니다.
// 클라우드 모드 → Supabase Storage(비공개 보관함), 이 기기 모드 → IndexedDB.
import { store, supabase, BUCKET, newId } from './store.js';
import { download, loadScript } from './util.js';
import { custName, customerOf } from './calc.js';

const FULL = 1600;
const THUMB = 360;

/* ---------- 이 기기 보관(IndexedDB) ---------- */
let dbp = null;
function idb() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('hyeonjang-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('p', mode);
    const req = fn(tx.objectStore('p'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

/* ---------- 줄이기 ---------- */
async function resize(file, max, quality) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = src.width, h0 = src.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  return { blob, w, h };
}

async function put(path, blob) {
  if (store.mode === 'cloud') {
    const { error } = await supabase().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
  } else {
    await idbDo('readwrite', (s) => s.put(blob, path));
  }
}

// 파일들을 줄여서 올리고, 작업에 붙일 사진 정보 목록을 돌려줌
export async function uploadPhotos(jobId, files, stage, onProgress) {
  const out = [];
  let i = 0;
  for (const f of files) {
    onProgress && onProgress(++i, files.length);
    const id = newId('ph');
    const full = await resize(f, FULL, 0.82);
    const th = await resize(f, THUMB, 0.7);
    const path = `${jobId}/${id}.jpg`;
    const thumb = `${jobId}/${id}_t.jpg`;
    await put(path, full.blob);
    await put(thumb, th.blob);
    out.push({ id, path, thumb, stage, w: full.w, h: full.h, size: full.blob.size + th.blob.size, at: new Date().toISOString() });
  }
  return out;
}

export async function deletePhotos(photos) {
  const paths = photos.flatMap((p) => [p.path, p.thumb]);
  if (!paths.length) return;
  if (store.mode === 'cloud') {
    const { error } = await supabase().storage.from(BUCKET).remove(paths);
    if (error) throw error;
  } else {
    await idbDo('readwrite', (s) => paths.forEach((p) => s.delete(p)));
  }
}

/* ---------- 보기 ---------- */
const urlCache = new Map(); // path → { url, exp }
export async function photoUrls(paths) {
  const now = Date.now();
  const need = paths.filter((p) => !(urlCache.get(p)?.exp > now));
  if (need.length) {
    if (store.mode === 'cloud') {
      const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls(need, 3600);
      if (error) throw error;
      data.forEach((d) => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, exp: now + 50 * 60 * 1000 }));
    } else {
      for (const p of need) {
        const b = await idbDo('readonly', (s) => s.get(p));
        if (b) urlCache.set(p, { url: URL.createObjectURL(b), exp: Infinity });
      }
    }
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url || '']));
}

export async function getBlob(path) {
  if (store.mode === 'cloud') {
    const { data, error } = await supabase().storage.from(BUCKET).download(path);
    if (error) throw error;
    return data;
  }
  return idbDo('readonly', (s) => s.get(path));
}

/* ---------- 용량 ---------- */
export function usedBytes() {
  return store.state.jobs.reduce((s, j) => s + (j.photos || []).reduce((a, p) => a + (p.size || 0), 0), 0);
}

/* ---------- 내려받기 ---------- */
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '이름없음';
const siteName = (job) => safe(`${job.date || '날짜미정'} ${job.address || job.work || ''}`);

export async function downloadOne(photo, name) {
  const b = await getBlob(photo.path);
  download(b, name || `${photo.id}.jpg`);
}

// mode: 'customer' (고객 > 현장 > 단계) / 'site' (현장(고객) > 단계)
export async function downloadZip(jobs, mode, zipName, onProgress) {
  const list = jobs.flatMap((j) => (j.photos || []).map((p) => ({ j, p })));
  if (!list.length) throw new Error('내려받을 사진이 없습니다');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = new window.JSZip();
  const counters = {};
  let i = 0;
  for (const { j, p } of list) {
    onProgress && onProgress(++i, list.length);
    const cust = safe(custName(customerOf(j)));
    const dir = mode === 'customer' ? `${cust}/${siteName(j)}` : `${siteName(j)} (${cust})`;
    const folder = `${dir}/${safe(p.stage || '기타')}`;
    counters[folder] = (counters[folder] || 0) + 1;
    zip.file(`${folder}/${String(counters[folder]).padStart(2, '0')}.jpg`, await getBlob(p.path));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, safe(zipName) + '.zip');
  return list.length;
}
