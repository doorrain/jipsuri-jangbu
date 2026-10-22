// 캡처 사진 속 글자 읽기 (휴대폰 안에서 처리, 사진을 다른 곳에 보내지 않음)
// 처음 한 번은 한글 인식 자료(약 10MB)를 받느라 시간이 걸리고, 그다음부터는 빨라집니다.
import { loadScript } from './util.js';

const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerP = null;

async function getWorker(onStatus) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(TESS);
      return window.Tesseract.createWorker('kor+eng', 1, {
        logger: (m) => {
          if (!onStatus) return;
          if (m.status === 'recognizing text') onStatus(`글자 읽는 중… ${Math.round(m.progress * 100)}%`);
          else if (/loading|initializ/.test(m.status)) onStatus('글자 인식 준비 중… (처음 한 번은 조금 걸려요)');
        },
      });
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}

// 어두운 화면(다크 모드) 캡처는 밝게 뒤집고, 작은 글씨는 키워서 읽기 쉽게
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(2, 1800 / bmp.width);
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 16) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  const dark = sum / (d.length / 16) < 110;
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    if (dark) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function readImageText(file, onStatus) {
  const worker = await getWorker(onStatus);
  const canvas = await prepare(file);
  onStatus && onStatus('글자 읽는 중…');
  const { data } = await worker.recognize(canvas);
  return data.text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}
