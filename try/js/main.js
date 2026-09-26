/*
 * Try page bootstrap: capability checks, loader, quality tier, render loop,
 * adaptive quality, and the overlay UI. All copy comes from the page
 * (#xp-copy JSON + markup) so EN and FR share this file.
 */
const $ = (id) => document.getElementById(id);
const root = $('xp');
const stageEl = $('xp-stage');
const copy = JSON.parse($('xp-copy').textContent);
const Q = new URLSearchParams(location.search);
const OPT = {
  tier: Q.get('q'),
  lock: Q.has('lock'),
  capture: Q.has('capture'),
  act: Q.has('act') ? Math.max(1, Math.min(4, parseInt(Q.get('act'), 10) || 1)) - 1 : null,
  at: Q.has('t') ? parseFloat(Q.get('t')) : null,
  paused: Q.has('paused'),
  fallback: Q.get('fallback'),
};
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const api = (window.__xp = { state: 'boot', fps: 0, tier: null, errors: [] });

function setLoad(p, msg) {
  const fill = $('xp-load-fill');
  if (fill) fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, p))})`;
  const pct = $('xp-load-pct');
  if (pct) pct.textContent = String(Math.round(p * 100)).padStart(2, '0');
  if (msg) $('xp-load-msg').textContent = msg;
}

let stopLoop = null;
function showFallback(reason) {
  if (stopLoop) stopLoop();
  root.classList.remove('is-loading', 'is-live');
  root.classList.add('is-fallback');
  const note = $('xp-fallback-note');
  if (note) note.textContent = copy.fallback[reason] || copy.fallback.nowebgl;
  const gl = stageEl.querySelector('canvas.xp-gl');
  if (gl) gl.remove();
  api.state = 'fallback';
  api.fallbackReason = reason;
}

function probeGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { name };
  } catch (e) {
    return null;
  }
}

const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

function pickTier(gpu) {
  if (OPT.tier && ['high', 'medium', 'low'].includes(OPT.tier)) return OPT.tier;
  const n = (gpu && gpu.name) || '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(n)) return 'low';
  const small = Math.min(screen.width, screen.height) < 820;
  if (isTouch || small) {
    const cores = navigator.hardwareConcurrency || 4;
    return cores <= 4 ? 'low' : 'medium';
  }
  if (/intel|uhd|iris|mali|adreno|powervr/i.test(n)) return 'medium';
  return 'high';
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  if (OPT.fallback) return showFallback(OPT.fallback === 'slow' ? 'slow' : 'nowebgl');
  const gpu = probeGPU();
  if (!gpu) return showFallback('nowebgl');
  root.classList.add('is-loading');
  setLoad(0.08, copy.load[0]);

  let M;
  try {
    const [stage, world, acts, rig, hud, fx] = await Promise.all([
      import('./stage.js'),
      import('./world.js'),
      import('./acts.js'),
      import('./rig.js'),
      import('./hud.js'),
      import('./fx.js'),
    ]);
    M = { stage, world, acts, rig, hud, fx };
  } catch (e) {
    console.warn('[try] engine failed to load', e);
    return showFallback('error');
  }
  setLoad(0.46, copy.load[1]);
  await nextFrame();

  let stage;
  let world;
  const tierName = pickTier(gpu);
  try {
    const glow = M.fx.makeGlowTexture();
    stage = M.stage.createStage($('xp-canvas'), { tier: tierName, capture: OPT.capture, glowTexture: glow });
    setLoad(0.58, copy.load[2]);
    await nextFrame();
    world = M.world.createWorld(stage, M.stage.TIERS[tierName]);
    setLoad(0.76, copy.load[3]);
    await nextFrame();
    world.arm.root.visible = true;
    stage.camera.position.set(2, 1.6, 2.4);
    stage.camera.lookAt(0, 0.9, 0);
    stage.camera.updateMatrixWorld();
    const r = stage.renderer;
    if (r.compileAsync && r.extensions.has('KHR_parallel_shader_compile')) await r.compileAsync(stage.scene, stage.camera);
    else r.compile(stage.scene, stage.camera);
    stage.render(0);
  } catch (e) {
    console.warn('[try] scene failed to build', e);
    return showFallback('error');
  }
  setLoad(1, copy.load[4]);
  stage.canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    showFallback('error');
  });
  start(M, stage, world, tierName);
}

function start(M, stage, world, tierName) {
  const acts = M.acts.configureActs(world);
  const story = new M.acts.Story(acts, { autoplay: !(OPT.paused || reduceMotion) });
  const rig = new M.rig.CameraRig(stage.camera, $('xp-canvas'));
  const ctx = { world, stage, mobile: false };
  const FX = M.fx.FX;
  const PU = world.path.uniforms;
  const U = world.panel.uniforms;
  const st = {};
  const ascan = M.hud.createAscan($('xp-ascan-c'));
  let thumbDone = false;
  api.tier = tierName;

  // ---------------- UI wiring ----------------
  const steps = [...document.querySelectorAll('#xp-steps [data-act]')];
  const bars = steps.map((b) => b.querySelector('.xp-step-bar i'));
  const cap = { num: $('xp-cap-num'), name: $('xp-cap-name'), text: $('xp-cap-text'), status: $('xp-cap-status'), box: $('xp-cap') };
  const playBtn = $('xp-play');
  const recenterBtn = $('xp-recenter');
  const pins = [...document.querySelectorAll('.xp-pin')];
  const logItems = [...document.querySelectorAll('#xp-log li')];
  const toast = $('xp-toast');
  let toastTimer = 0;
  const zoneEls = document.querySelectorAll('[data-zone]');
  zoneEls.forEach((el) => {
    const ind = world.panel.indications[+el.dataset.zone];
    if (ind) el.textContent = ind.zone;
  });

  function setCaption(i) {
    const a = copy.acts[i];
    cap.box.classList.remove('in');
    void cap.box.offsetWidth;
    cap.num.textContent = a.n;
    cap.name.textContent = a.name;
    cap.text.textContent = a.text;
    cap.status.textContent = a.status;
    cap.status.dataset.kind = a.kind;
    cap.box.classList.add('in');
  }

  function setActClass(i) {
    for (let k = 0; k < 4; k++) root.classList.toggle(`act-${k + 1}`, k === i);
    steps.forEach((b, k) => {
      b.classList.toggle('on', k === i);
      b.classList.toggle('done', k < i);
      if (k === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
  }

  function syncPlay() {
    const label = story.ended ? copy.ui.replay : story.playing ? copy.ui.pause : copy.ui.play;
    playBtn.setAttribute('aria-label', label);
    playBtn.dataset.state = story.ended ? 'replay' : story.playing ? 'playing' : 'paused';
    playBtn.querySelector('.xp-play-label').textContent = label;
    root.classList.toggle('is-playing', story.playing);
    root.classList.toggle('is-ended', story.ended);
  }

  let lastS = 0;
  story.on('act', (i) => {
    setCaption(i);
    setActClass(i);
    rig.recenter();
    lastS = 0;
    if (reduceMotion && !story.playing) story.t = story.act.duration * 0.999;
  });
  story.on('state', syncPlay);

  steps.forEach((b, k) =>
    b.addEventListener('click', () => {
      story.goto(k);
      if (!reduceMotion && !story.playing) story.play();
    })
  );
  playBtn.addEventListener('click', () => story.toggle());
  recenterBtn.addEventListener('click', () => rig.recenter());
  rig.onUser = (on) => {
    root.classList.toggle('is-user', on);
    recenterBtn.hidden = !on;
    if (on) root.classList.add('has-dragged');
  };
  stageEl.addEventListener('keydown', (e) => {
    if (e.target !== stageEl) return;
    if (e.key === ' ') {
      e.preventDefault();
      story.toggle();
    } else if (e.key === 'ArrowRight') story.next();
    else if (e.key === 'ArrowLeft') story.goto(story.index - 1);
  });

  function showToast(i) {
    const ind = world.panel.indications[i];
    toast.textContent = `${copy.ui.indication} ${ind.id} · ${copy.ui.zone} ${ind.zone}`;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 2400);
  }

  // ---------------- per-frame ----------------
  const v3 = stage.camera.position.clone();
  function updatePins(p, act) {
    const { width, height } = stage.size;
    world.markers.forEach((mk, i) => {
      const el = pins[i];
      if (!el) return;
      let vis = 0;
      if (act === 3) vis = p.marks;
      else if (act === 2 && p.coverS >= world.discovery[i]) vis = 1;
      if (vis <= 0.01) {
        el.classList.remove('on');
        return;
      }
      v3.copy(act === 3 ? mk.anchor : mk.ind.pos).project(stage.camera);
      if (v3.z > 1) {
        el.classList.remove('on');
        return;
      }
      const x = (v3.x * 0.5 + 0.5) * width;
      const y = (-v3.y * 0.5 + 0.5) * height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.classList.toggle('on', true);
      el.classList.toggle('lead', act === 3);
    });
  }

  function updateLog(p, act) {
    if (act !== 1) return;
    const tt = story.t;
    const firstLift = world.traj.samples.find((s) => s.kind === 'lift');
    const marks = [0.25, 1.5, 2.3, null, 7.95];
    logItems.forEach((li, k) => {
      let on = false;
      if (k === 3) on = firstLift && p.pathDraw >= firstLift.s;
      else on = tt >= marks[k];
      li.classList.toggle('on', !!on);
    });
  }

  function apply(p, dt, time) {
    FX.uTime.value = time;
    FX.uPartReveal.value = p.partReveal;
    FX.uPartRevealOn.value = p.partRevealOn;
    FX.uArmReveal.value = p.armReveal;
    FX.uArmRevealOn.value = p.armRevealOn;
    U.uIso.value = p.iso;
    U.uIsoSweep.value = p.isoSweep;
    U.uCscan.value = p.cscan;
    U.uGlow.value = p.glow;
    U.uScanNow.value = p.scanNow;
    U.uZones.value = p.zones;
    U.uMarks.value = p.marks;
    if (p.probe) U.uProbe.value.set(p.probe[0], p.probe[1], p.probe[2]);
    else U.uProbe.value.z = 0;
    PU.uDraw.value = p.pathDraw;
    PU.uProbeS.value = p.pathProbeS;
    PU.uAct3.value = p.pathAct3;
    PU.uFade.value += (p.pathFade - PU.uFade.value) * (1 - Math.exp(-dt * 3.2));
    if (p.pathFade > PU.uFade.value && story.index < 3) PU.uFade.value = p.pathFade;
    PU.uTime.value = time;
    world.path.head.visible = p.head;
    if (p.head) {
      world.traj.at(p.pathDraw, st);
      world.path.head.position.copy(st.p).addScaledVector(st.n, 0.005);
    }
    world.arm.root.visible = p.armVisible;
    world.arm.setJoints(p.q);
    world.arm.setLed(p.led);
    world.coverage.paintTo(p.coverS);
    world.markers.forEach((mk) => {
      mk.mesh.scale.y = Math.max(p.leaders * mk.h, 0.0001);
      mk.mesh.material.opacity = p.leaders;
    });
    stage.setShadowStrength(p.shadow);
    stage.setFade(p.fade);
  }

  function uiFrame(p, dt, time) {
    const i = story.index;
    bars.forEach((b, k) => {
      const v = k < i ? 1 : k === i ? story.progress : 0;
      b.style.transform = `scaleX(${v.toFixed(4)})`;
    });
    updatePins(p, i);
    updateLog(p, i);
    if (i === 2) {
      const scanning = story.t > 2.2 && story.t < world.scanDuration - 0.2;
      root.classList.toggle('ascan-on', scanning);
      if (scanning) {
        const smp = p.probe ? world.fieldAt(p.probe[0], p.probe[1]) : null;
        const hot = ascan.draw(smp, p.contact, time);
        root.classList.toggle('ascan-hot', hot > 0.5);
      }
      if (story.playing) {
        world.discovery.forEach((s, k) => {
          if (lastS < s && p.coverS >= s) showToast(k);
        });
      }
      lastS = p.coverS;
    } else {
      root.classList.remove('ascan-on', 'ascan-hot');
    }
    const showReport = i === 3 && story.t > 2.3;
    root.classList.toggle('report-on', showReport);
    if (showReport && !thumbDone) {
      thumbDone = true;
      M.hud.drawThumbnail($('xp-thumb'), world.panel.field, world.panel.indications);
    }
    story.hold = rig.dragging;
  }

  // ---------------- loop + adaptive quality ----------------
  const mon = { frames: [], lastEval: 0, bad: 0, warm: performance.now() + 2500 };
  const budget = isTouch ? 1000 / 30 : 1000 / 40;
  function monitor(ms, now) {
    if (ms <= 0 || ms > 1500) return;
    mon.frames.push(ms);
    if (mon.frames.length > 90) mon.frames.shift();
    if (now - mon.lastEval < 1000) return;
    mon.lastEval = now;
    const sorted = mon.frames.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1] || 16;
    api.fps = Math.round(1000 / med);
    api.frameMs = +med.toFixed(1);
    if (OPT.lock || OPT.capture || now < mon.warm || mon.frames.length < 20) return;
    if (med > budget) {
      const order = M.stage.TIER_ORDER;
      const k = order.indexOf(stage.tier);
      if (k < order.length - 1) {
        stage.applyTier(order[k + 1]);
        api.tier = stage.tier;
        api.tierDrops = (api.tierDrops || 0) + 1;
        mon.frames.length = 0;
        mon.warm = now + 1800;
      } else if (med > 1000 / 14) {
        mon.bad++;
        if (mon.bad >= 3) showFallback('slow');
      } else mon.bad = 0;
    } else mon.bad = 0;
  }

  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((ents) => ents.forEach((e) => (visible = e.isIntersecting)), { threshold: 0.05 }).observe(stageEl);
  }
  const ro = new ResizeObserver(() => {
    stage.resize();
    ctx.mobile = stage.size.width < 720 || stage.size.height > stage.size.width * 1.15;
    ascan.resize();
  });
  ro.observe(stageEl);
  ctx.mobile = stage.size.width < 720 || stage.size.height > stage.size.width * 1.15;

  let clock = 0;
  function frame(dt) {
    story.tick(dt);
    clock += dt;
    const act = story.act;
    const p = act.params(ctx, story.t);
    apply(p, dt, clock);
    rig.setShot(act.shot(ctx, story.t));
    rig.update(dt, stage.size.width, stage.size.height);
    stage.render(clock);
    uiFrame(p, dt, clock);
  }

  let raf = 0;
  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const ms = Math.max(0, now - last);
    last = now;
    if (!visible || document.hidden) return;
    frame(Math.min(ms / 1000, 0.1));
    monitor(ms, now);
  }
  stopLoop = () => cancelAnimationFrame(raf);

  // Initial state.
  const startAct = OPT.act ?? 0;
  story.goto(startAct, OPT.at != null ? OPT.at * (acts[startAct].duration || 1) : reduceMotion ? acts[startAct].duration * 0.999 : 0);
  syncPlay();
  const p0 = story.act.params(ctx, story.t);
  apply(p0, 0.016, 0);
  rig.setShot(story.act.shot(ctx, story.t));
  rig.snap();

  root.classList.remove('is-loading');
  root.classList.add('is-live');
  api.state = 'live';
  api.story = story;
  api.rig = rig;
  api.world = world;
  api.stage = stage;
  api.goto = (act, frac = 0) => story.goto(act - 1, frac * (acts[act - 1].duration || 1));
  api.pause = () => story.pause();
  api.play = () => story.play();
  api.setTier = (t) => stage.applyTier(t);

  if (OPT.capture) {
    api.step = (dt = 1 / 30, n = 1) => {
      for (let k = 0; k < n; k++) frame(dt);
      return { act: story.index + 1, t: story.t };
    };
    api.settle = (n = 90) => {
      frame(0);
      rig.setShot(story.act.shot(ctx, story.t));
      for (let k = 0; k < n; k++) rig.update(1 / 30, stage.size.width, stage.size.height);
      frame(0);
    };
    frame(0);
  } else {
    raf = requestAnimationFrame(loop);
  }
}

window.addEventListener('error', (e) => api.errors.push(String(e.message || e)));
boot().catch((e) => {
  console.warn('[try] boot failed', e);
  showFallback('error');
});
