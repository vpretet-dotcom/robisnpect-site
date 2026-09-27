/*
 * No-WebGL path for the your-turn step. Two stills per part (before the
 * path, and after the path plus C-scan) stand in for the 3D scene.
 * Buttons match the live step. Zone handles are not available here.
 */

export function mountFallbackTurn() {
  const root = document.getElementById('yt-fallback');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';
  root.hidden = false;

  const thumbs = [...root.querySelectorAll('.yt-thumb')];
  const zones = [...root.querySelectorAll('[data-zone]')];
  const weld = root.querySelector('.yt-weld');
  const rangeA = root.querySelector('[data-range="a"]');
  const rangeB = root.querySelector('[data-range="b"]');
  const error = root.querySelector('.yt-error');
  const before = root.querySelector('.ytf-before');
  const after = root.querySelector('.ytf-after');
  const overlay = root.querySelector('.ytf-zone');
  let part = 'panel';
  let phase = 'pick';
  let zone = { t0: 0.3, t1: 0.7, preset: 'center' };
  let busy = false;

  function show(next) {
    phase = next;
    root.dataset.phase = next;
  }

  function applyImages() {
    const base = `/try/yt/${part}`;
    if (before) before.src = `${base}-before.webp`;
    if (after) after.src = `${base}-after.webp`;
    const name = thumbs.find((b) => b.dataset.part === part)?.querySelector('.yt-thumb-name')?.textContent || part;
    if (before) before.alt = name;
    if (after) after.alt = name;
  }

  function placeOverlay() {
    if (!overlay) return;
    if (part === 'weld') {
      const left = 10 + zone.t0 * 70;
      const width = Math.max(8, (zone.t1 - zone.t0) * 70);
      overlay.style.left = `${left}%`;
      overlay.style.width = `${width}%`;
      overlay.style.top = '40%';
      overlay.style.height = '18%';
      return;
    }
    const box = {
      all: [8, 14, 84, 70],
      center: [28, 26, 44, 46],
      edge: [8, 16, 26, 66],
    }[zone.preset] || [28, 26, 44, 46];
    overlay.style.left = `${box[0]}%`;
    overlay.style.top = `${box[1]}%`;
    overlay.style.width = `${box[2]}%`;
    overlay.style.height = `${box[3]}%`;
  }

  function markPreset() {
    zones.forEach((b) => b.classList.toggle('on', b.dataset.zone === zone.preset));
  }

  function syncSliders() {
    if (!rangeA) return;
    rangeA.value = String(Math.round(zone.t0 * 1000));
    rangeB.value = String(Math.round(zone.t1 * 1000));
  }

  async function pick(id) {
    if (busy) return;
    const btn = thumbs.find((b) => b.dataset.part === id);
    busy = true;
    if (btn) {
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
    }
    await new Promise((r) => setTimeout(r, 420));
    part = id;
    thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === id));
    zone = { t0: 0.3, t1: 0.7, preset: 'center' };
    root.classList.remove('is-drawn', 'is-done');
    if (error) error.hidden = true;
    applyImages();
    if (weld) weld.hidden = id !== 'weld';
    syncSliders();
    markPreset();
    placeOverlay();
    if (btn) {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
    }
    busy = false;
    show('zone');
  }

  function setPreset(name) {
    zone.preset = name;
    if (name === 'all') {
      zone.t0 = 0.02;
      zone.t1 = 0.98;
    } else if (name === 'edge') {
      zone.t0 = 0;
      zone.t1 = 0.38;
    } else {
      zone.t0 = 0.3;
      zone.t1 = 0.7;
    }
    if (error) error.hidden = true;
    syncSliders();
    markPreset();
    placeOverlay();
  }

  function onSlider(which) {
    let a = Number(rangeA.value) / 1000;
    let b = Number(rangeB.value) / 1000;
    if (b < a + 0.04) {
      if (which === 'a') b = Math.min(1, a + 0.04);
      else a = Math.max(0, b - 0.04);
    }
    zone.t0 = a;
    zone.t1 = b;
    zone.preset = '';
    rangeA.value = String(Math.round(a * 1000));
    rangeB.value = String(Math.round(b * 1000));
    if (error) error.hidden = true;
    markPreset();
    placeOverlay();
  }

  function tooSmall() {
    return part === 'weld' && (zone.t1 - zone.t0) * 0.4 < 0.05;
  }

  function compute() {
    if (phase !== 'zone') return;
    if (tooSmall()) {
      if (error) error.hidden = false;
      return;
    }
    if (error) error.hidden = true;
    show('drawing');
    root.classList.add('is-drawn');
    window.setTimeout(() => {
      if (phase !== 'drawing') return;
      show('done');
      root.classList.add('is-done');
    }, 1700);
  }

  thumbs.forEach((b) => b.addEventListener('click', () => pick(b.dataset.part)));
  zones.forEach((b) => b.addEventListener('click', () => {
    if (phase === 'zone') setPreset(b.dataset.zone);
  }));
  rangeA?.addEventListener('input', () => onSlider('a'));
  rangeB?.addEventListener('input', () => onSlider('b'));
  root.querySelector('.yt-compute')?.addEventListener('click', compute);
  root.querySelector('.yt-again')?.addEventListener('click', () => {
    root.classList.remove('is-drawn', 'is-done');
    if (error) error.hidden = true;
    show('pick');
  });

  thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === 'panel'));
  if (weld) weld.hidden = true;
  applyImages();
  markPreset();
  placeOverlay();
  show('pick');
}
