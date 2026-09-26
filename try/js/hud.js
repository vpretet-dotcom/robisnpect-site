import { KIND, rampRGB, P, ZONES } from './panel.js';
import { mulberry32 } from './util.js';

const GOLD = '#e8c547';
const LINE = 'rgba(244,241,234,0.08)';

/** Simulated rectified A-scan: main bang, echoes by local structure. */
export function createAscan(canvas) {
  const ctx = canvas.getContext('2d');
  const rnd = mulberry32(99);
  let w = 0;
  let h = 0;
  const N = 220;
  const sig = new Float32Array(N);
  const smooth = new Float32Array(N);
  let flash = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  const pulse = (x, x0, amp, width, freq) => {
    const d = (x - x0) / width;
    return amp * Math.exp(-d * d) * Math.abs(Math.cos((x - x0) * freq));
  };

  function draw(sample, contact, time) {
    if (!w) resize();
    const echoes = [];
    if (contact && sample) {
      switch (sample.kind) {
        case KIND.FOOT:
          echoes.push([0.8, 0.58]);
          break;
        case KIND.DOUBLER:
          echoes.push([0.73, 0.62]);
          break;
        case KIND.IND1:
          echoes.push([0.37, 0.96], [0.62, 0.14]);
          break;
        case KIND.IND2:
          echoes.push([0.6, 0.97]);
          break;
        default:
          echoes.push([0.6, 0.74]);
      }
    }
    const hot = sample && (sample.kind === KIND.IND1 || sample.kind === KIND.IND2) && contact;
    flash = hot ? 1 : Math.max(0, flash - 0.04);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      let v = pulse(x, 0.055, 1.0, 0.018, 190) + pulse(x, 0.09, 0.35, 0.02, 170);
      for (const [x0, a] of echoes) v += pulse(x, x0, a, 0.016, 210);
      v += (rnd() - 0.5) * 0.05 * (contact ? 1 : 0.4) + (contact ? 0.02 * Math.abs(Math.sin(x * 60 + time * 7)) : 0);
      sig[i] = Math.max(0, v);
      smooth[i] = smooth[i] * 0.45 + sig[i] * 0.55;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const y = Math.round((h * i) / 5) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    for (let i = 1; i < 8; i++) {
      const x = Math.round((w * i) / 8) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
    // C-scan gate.
    const gy = h * 0.42;
    ctx.strokeStyle = 'rgba(232,197,71,0.55)';
    ctx.lineWidth = Math.max(1, h / 60);
    ctx.beginPath();
    ctx.moveTo(w * 0.2, gy);
    ctx.lineTo(w * 0.9, gy);
    ctx.stroke();
    const base = h - 2;
    const scaleY = h * 0.86;
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (let i = 0; i < N; i++) ctx.lineTo((i / (N - 1)) * w, base - Math.min(smooth[i], 1.05) * scaleY);
    ctx.lineTo(w, base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,197,71,0.1)';
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = base - Math.min(smooth[i], 1.05) * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.2, h / 70);
    ctx.shadowColor = 'rgba(243,213,106,0.65)';
    ctx.shadowBlur = h / 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    return flash;
  }

  return { draw, resize };
}

/** Report thumbnail: the full C-scan field, zone grid and the two indications. */
export function drawThumbnail(canvas, field, indications) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const W = Math.max(40, Math.round((r.width || 280) * dpr));
  const H = Math.round((W * P.LZ) / P.W0);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const lut = [];
  for (let i = 0; i < 256; i++) {
    const c = rampRGB(i / 255);
    lut.push([c.r * 255, c.g * 255, c.b * 255]);
  }
  for (let y = 0; y < H; y++) {
    const fy = Math.min(field.h - 1, Math.floor((y / H) * field.h));
    for (let x = 0; x < W; x++) {
      const fx = Math.min(field.w - 1, Math.floor((x / W) * field.w));
      const i = fy * field.w + fx;
      const o = (y * W + x) * 4;
      if (field.kind[i] === KIND.HOLE) {
        img.data[o] = 7;
        img.data[o + 1] = 7;
        img.data[o + 2] = 7;
        img.data[o + 3] = 255;
        continue;
      }
      const c = lut[Math.max(0, Math.min(255, Math.round(field.val[i] * 255)))];
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(232,197,71,0.35)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  const nc = ZONES.cols.length;
  for (let i = 1; i < nc; i++) {
    const x = Math.round((W * i) / nc) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let j = 1; j < ZONES.rows; j++) {
    const y = Math.round((H * j) / ZONES.rows) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.font = `${Math.round(9 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = 'rgba(244,241,234,0.7)';
  ctx.textBaseline = 'top';
  for (let i = 0; i < nc; i++) ctx.fillText(ZONES.cols[i], (W * i) / nc + 3 * dpr, 3 * dpr);
  for (let j = 0; j < ZONES.rows; j++) ctx.fillText(String(j + 1), 3 * dpr, (H * j) / ZONES.rows + 14 * dpr);
  for (const ind of indications) {
    const cx = ((ind.X + P.W0 / 2) / P.W0) * W;
    const cy = ((ind.Y + P.LZ / 2) / P.LZ) * H;
    const rr = (ind.ring / P.W0) * W;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.5, 1.4 * dpr);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.font = `600 ${Math.round(10 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(ind.id, cx + rr * 0.72, cy - rr * 0.72);
  }
  ctx.strokeStyle = 'rgba(244,241,234,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
