import { renderReport, clearReport, reportCopy } from './report.js';

/*
 * No-WebGL path for the your-turn step. Stills stand in for the 3D scene:
 * one of the bare part, and per zone preset an overlay of that zone (drawn
 * from the zone region on the surface, cut to the part's silhouette) and
 * the painted end state. /try/yt/turn.json holds the report numbers,
 * exported from the live computation together with those stills. Zone
 * handles and the weld sliders need the 3D scene.
 */

const STILL_W = 960;
const STILL_H = 540;

export function mountFallbackTurn() {
  const root = document.getElementById('yt-fallback');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';
  root.hidden = false;

  const thumbs = [...root.querySelectorAll('.yt-thumb')];
  const zones = [...root.querySelectorAll('[data-zone]')];
  const error = root.querySelector('.yt-error');
  const before = root.querySelector('.ytf-before');
  const after = root.querySelector('.ytf-after');
  const frame = root.querySelector('.ytf-frame');
  const overlay = root.querySelector('.ytf-zone');
  const reportEl = root.querySelector('.yt-report');
  const reportThumb = reportEl?.querySelector('[data-r="thumb"]');
  const lang = document.documentElement.lang || 'en';
  let copy = null;
  try {
    copy = reportCopy(JSON.parse(document.getElementById('xp-copy').textContent).turn);
  } catch (_) {
    copy = null;
  }
  let data = null;
  const loaded = fetch('/try/yt/turn.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      data = json;
      placeOverlay();
    })
    .catch(() => null);

  // Same default as the 3D step 5: the nozzle, first vignette.
  let part = 'nozzle';
  let phase = 'pick';
  let preset = 'center';
  let busy = false;

  function show(next) {
    phase = next;
    root.dataset.phase = next;
    if (next !== 'done' && reportEl) clearReport(reportEl);
  }

  function applyImages() {
    const name = thumbs.find((b) => b.dataset.part === part)?.querySelector('.yt-thumb-name')?.textContent || part;
    if (before) {
      before.src = `/try/yt/${part}-before.webp`;
      before.alt = name;
    }
    if (after) {
      after.src = `/try/yt/${part}-${preset}-after.webp`;
      after.alt = name;
    }
  }

  function fitFrame() {
    if (!frame) return;
    const view = frame.parentElement;
    if (!view) return;
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    if (!vw || !vh) return;
    const scale = Math.max(vw / STILL_W, vh / STILL_H);
    const w = STILL_W * scale;
    const h = STILL_H * scale;
    frame.style.left = `${(vw - w) / 2}px`;
    frame.style.top = `${(vh - h) / 2}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
  }

  function placeOverlay() {
    if (!overlay) return;
    fitFrame();
    overlay.src = `/try/yt/${part}-${preset}-zone.webp`;
  }

  function markPreset() {
    zones.forEach((b) => b.classList.toggle('on', b.dataset.zone === preset));
  }

  async function pick(id) {
    if (busy) return;
    const btn = thumbs.find((b) => b.dataset.part === id);
    busy = true;
    if (btn) {
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
    }
    await Promise.all([new Promise((r) => setTimeout(r, 420)), loaded]);
    part = id;
    preset = 'center';
    thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === id));
    root.classList.remove('is-drawn', 'is-done');
    if (error) error.hidden = true;
    applyImages();
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
    preset = name;
    if (error) error.hidden = true;
    applyImages();
    markPreset();
    placeOverlay();
  }

  function showReport() {
    const entry = data?.[part]?.[preset];
    if (!reportEl || !entry || !copy) return;
    renderReport(reportEl, entry.report, copy, lang);
    if (reportThumb) reportThumb.src = `/try/yt/${part}-${preset}-cscan.webp`;
  }

  function compute() {
    if (phase !== 'zone') return;
    if (error) error.hidden = true;
    show('drawing');
    root.classList.add('is-drawn');
    window.setTimeout(() => {
      if (phase !== 'drawing') return;
      show('done');
      showReport();
      root.classList.add('is-done');
    }, 1700);
  }

  thumbs.forEach((b) => b.addEventListener('click', () => pick(b.dataset.part)));
  zones.forEach((b) => b.addEventListener('click', () => {
    if (phase === 'zone') setPreset(b.dataset.zone);
  }));
  root.querySelector('.yt-compute')?.addEventListener('click', compute);
  root.querySelector('.yt-again')?.addEventListener('click', () => {
    root.classList.remove('is-drawn', 'is-done');
    if (error) error.hidden = true;
    show('pick');
  });

  thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === part));
  applyImages();
  markPreset();
  placeOverlay();
  show('pick');
  window.addEventListener('resize', fitFrame);
  if (before) before.addEventListener('load', fitFrame);
}
