import * as THREE from 'three';
import { HOME } from './arm.js';
import { FX } from './fx.js';
import { createPathVisuals } from './trajectory.js';
import { computeZoneTrajectory } from './trajectory.js';
import { createCoverageUV } from './cscan.js';
import { createWeldPart, createElbowPart, createFairingPart, createPanelPart } from './parts.js';
import { easeInOutSine, clamp } from './util.js';

/*
 * Interactive step after the four scripted acts. The act timeline is not
 * modified; this controller only runs while `active` and the main loop
 * skips the act integrator.
 */

const GOLD = 0xe8c547;
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const _aim = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _hover = new THREE.Vector3();
const _end = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

function useHandles() {
  const coarse = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
  return !coarse && window.innerWidth > 720;
}

export function createYourTurn({ world, stage, rig, root, copy, reduceMotion, fast, debugNormals = false }) {
  const { scene } = stage;
  const panelPart = createPanelPart(world.panel);
  const factories = {
    weld: createWeldPart,
    elbow: createElbowPart,
    fairing: createFairingPart,
  };
  const cache = { panel: panelPart };
  const saved = {
    cover: world.panel.uniforms.uCover.value,
    arm: world.arm.root.position.clone(),
    armY: world.arm.root.rotation.y,
  };

  const dom = {
    yt: document.getElementById('yt'),
    thumbs: [...document.querySelectorAll('#yt .yt-thumb')],
    zones: [...document.querySelectorAll('#yt [data-zone]')],
    weld: document.getElementById('yt-weld'),
    rangeA: document.getElementById('yt-range-a'),
    rangeB: document.getElementById('yt-range-b'),
    error: document.getElementById('yt-error'),
    compute: document.getElementById('yt-compute'),
    again: document.getElementById('yt-again'),
    turnBtn: document.getElementById('xp-step-turn'),
    of: document.querySelector('.xp-cap-of'),
    capNum: document.getElementById('xp-cap-num'),
    capName: document.getElementById('xp-cap-name'),
    capText: document.getElementById('xp-cap-text'),
    capStatus: document.getElementById('xp-cap-status'),
    bar: document.querySelector('#xp-step-turn .xp-step-bar i'),
  };
  if (dom.error && copy?.tooSmall) dom.error.textContent = copy.tooSmall;

  const api = {
    active: false,
    phase: 'pick',
    partId: 'panel',
    zone: null,
    preset: 'center',
    tooSmall: false,
    pathDraw: 0,
    cover: 0,
    reach: null,
    handleScreen,
    enter,
    leave,
    showPick,
  };

  let part = panelPart;
  let zone = { ...panelPart.presets.center };
  let phase = 'pick';
  let busy = false;
  let traj = null;
  let path = null;
  let coverage = null;
  let zoneMesh = null;
  let handleGroup = null;
  let drag = -1;
  let drawT = 0;
  let scanT = 0;
  let scanDur = 4;
  let mobile = false;
  let shotHold = false;
  let prevQ = null;
  const qbuf = [0, 0, 0, 0, 0, 0];
  const st = {};
  const shot = {
    target: new THREE.Vector3(),
    az: 0.7,
    el: 0.5,
    radius: 0.6,
    fov: 30,
    offX: 0,
    offY: 0.06,
    omega: 2.1,
    distMul: 1,
  };
  const drawDur = fast ? 0.45 : reduceMotion ? 0.4 : 1.55;
  const approachT = 0.6;
  const retractT = 0.5;

  function setPhase(next) {
    phase = next;
    api.phase = next;
    if (dom.yt) dom.yt.dataset.phase = next;
    const showSub = next === 'pick';
    if (dom.capText) {
      dom.capText.textContent = showSub ? copy.sub : '';
      dom.capText.hidden = !showSub;
    }
    if (dom.weld) dom.weld.hidden = !(next === 'zone' && part.kind === 'weld');
    if (next === 'zone') {
      syncSliders();
      rebuildZone();
      syncHandles();
      markPreset();
    } else {
      removeZone();
      removeHandles();
    }
    frameShot();
  }

  function caption() {
    if (!copy) return;
    if (dom.capNum) dom.capNum.textContent = copy.n || '05';
    if (dom.capName) dom.capName.textContent = copy.name;
    if (dom.capStatus) {
      dom.capStatus.textContent = copy.tag;
      dom.capStatus.dataset.kind = 'direction';
    }
    if (dom.of) dom.of.textContent = '/ 05';
  }

  function hideScripted() {
    world.path.group.visible = false;
    world.markers.forEach((m) => {
      m.mesh.visible = false;
    });
    root.classList.remove('report-on', 'ascan-on', 'ascan-hot');
    document.querySelectorAll('.xp-pin').forEach((p) => p.classList.remove('on'));
    const U = world.panel.uniforms;
    U.uCscan.value = 0;
    U.uMarks.value = 0;
    U.uZones.value = 0;
    U.uGlow.value = 0;
    U.uIso.value = 0;
    U.uProbe.value.z = 0;
    FX.uPartReveal.value = 2;
    FX.uPartRevealOn.value = 0;
    FX.uArmReveal.value = 4;
    FX.uArmRevealOn.value = 0;
    world.arm.root.visible = false;
    world.arm.setJoints(HOME);
    stage.setFade(1);
    stage.setShadowStrength(1);
  }

  function showOnly(id) {
    for (const key of Object.keys(cache)) {
      const g = cache[key].group;
      if (g) g.visible = key === id;
    }
  }

  function applyPart(id) {
    part = cache[id];
    api.partId = id;
    showOnly(id);
    zone = { ...part.presets[part.defaultPreset || 'center'] };
    api.zone = zone;
    api.preset = part.defaultPreset || 'center';
    clearPath();
    hideError();
    dom.thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === id));
    frameShot();
    rig.setShot(shot);
    rig.recenter();
    if (dom.weld) dom.weld.hidden = part.kind !== 'weld' || phase !== 'zone';
    syncSliders();
    markPreset();
  }

  function frameShot() {
    const focus = part.focus(_p);
    shot.target.copy(focus);
    shot.az = part.shot.az;
    shot.el = part.shot.el;
    shot.radius = part.shot.radius;
    shot.fov = part.shot.fov || 30;
    if (!shotHold) {
      const dock = phase === 'pick' || phase === 'zone' || phase === 'done';
      shot.offY = dock ? (mobile ? 0.14 : 0.06) : mobile ? 0.06 : 0.02;
    }
  }

  function markSteps() {
    document.querySelectorAll('#xp-steps [data-act]').forEach((b) => {
      b.classList.add('done');
      b.classList.remove('on');
      b.removeAttribute('aria-current');
    });
    if (dom.turnBtn) {
      dom.turnBtn.classList.add('on');
      dom.turnBtn.setAttribute('aria-current', 'step');
    }
  }

  function enter() {
    if (api.active) return api;
    api.active = true;
    root.classList.add('is-turn');
    hideScripted();
    caption();
    if (dom.yt) {
      dom.yt.hidden = false;
      dom.yt.dataset.phase = 'pick';
    }
    applyPart('panel');
    setPhase('pick');
    markSteps();
    rig.setShot(shot);
    rig.recenter();
    bind();
    return api;
  }

  function leave() {
    if (!api.active) return;
    hold = null;
    if (debugLines) {
      debugLines.n.visible = false;
      debugLines.a.visible = false;
    }
    api.active = false;
    root.classList.remove('is-turn');
    clearPath();
    removeZone();
    removeHandles();
    for (const key of Object.keys(cache)) {
      if (cache[key].ownsGroup && cache[key].group) cache[key].group.visible = false;
    }
    world.panel.group.visible = true;
    world.panel.uniforms.uCover.value = saved.cover;
    world.path.group.visible = true;
    world.markers.forEach((m) => {
      m.mesh.visible = true;
    });
    world.arm.root.position.copy(saved.arm);
    world.arm.root.rotation.y = saved.armY;
    world.arm.setJoints(HOME);
    world.arm.root.visible = false;
    if (dom.yt) dom.yt.hidden = true;
    if (dom.of) dom.of.textContent = '/ 04';
    if (dom.capText) dom.capText.hidden = false;
    if (dom.turnBtn) {
      dom.turnBtn.classList.remove('on');
      dom.turnBtn.removeAttribute('aria-current');
    }
    unbind();
  }

  function showPick() {
    if (!api.active) enter();
    hold = null;
    clearPath();
    hideError();
    world.arm.root.visible = false;
    if (part?.uniforms) {
      part.uniforms.uCscan.value = 0;
      part.uniforms.uGlow.value = 0;
    }
    if (part?.id === 'panel') {
      world.panel.uniforms.uCover.value = saved.cover;
      world.panel.uniforms.uCscan.value = 0;
    }
    setPhase('pick');
  }

  function hideError() {
    api.tooSmall = false;
    api.outOfReach = false;
    if (dom.error) dom.error.hidden = true;
  }

  function showError(kind) {
    api.tooSmall = kind !== 'reach';
    api.outOfReach = kind === 'reach';
    if (dom.error) {
      dom.error.hidden = false;
      dom.error.textContent = kind === 'reach' ? copy?.outOfReach || 'Zone out of reach' : copy?.tooSmall || '';
    }
  }

  async function selectPart(id) {
    if (busy || !api.active) return;
    const btn = dom.thumbs.find((b) => b.dataset.part === id);
    busy = true;
    if (btn) {
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
    }
    const t0 = performance.now();
    if (!cache[id]) {
      cache[id] = id === 'panel' ? panelPart : factories[id]();
      if (cache[id].ownsGroup) scene.add(cache[id].group);
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const min = fast ? 80 : 420;
    const wait = min - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    applyPart(id);
    if (btn) {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
    }
    busy = false;
    setPhase('zone');
  }

  function syncSliders() {
    if (!dom.rangeA || part.kind !== 'weld') return;
    dom.rangeA.value = String(Math.round(zone.t0 * 1000));
    dom.rangeB.value = String(Math.round(zone.t1 * 1000));
  }

  function markPreset() {
    dom.zones.forEach((b) => {
      const p = part.presets[b.dataset.zone];
      const on = p && Math.abs(p.t0 - zone.t0) < 0.02 && Math.abs(p.t1 - zone.t1) < 0.02 && (part.kind === 'weld' || (Math.abs(p.s0 - zone.s0) < 0.02 && Math.abs(p.s1 - zone.s1) < 0.02));
      b.classList.toggle('on', !!on);
      if (on) api.preset = b.dataset.zone;
    });
  }

  function setPreset(name) {
    const p = part.presets[name];
    if (!p) return;
    zone = { ...p };
    api.zone = zone;
    api.preset = name;
    hideError();
    syncSliders();
    markPreset();
    if (phase === 'zone') rebuildZone();
  }

  function setSlider(which) {
    if (part.kind !== 'weld') return;
    let a = Number(dom.rangeA.value) / 1000;
    let b = Number(dom.rangeB.value) / 1000;
    const gap = 0.04;
    if (b < a + gap) {
      if (which === 'a') b = Math.min(1, a + gap);
      else a = Math.max(0, b - gap);
    }
    zone.t0 = a;
    zone.t1 = b;
    api.zone = zone;
    dom.rangeA.value = String(Math.round(a * 1000));
    dom.rangeB.value = String(Math.round(b * 1000));
    hideError();
    markPreset();
    rebuildZone();
  }

  function zoneBand() {
    if (part.kind === 'weld') {
      const half = 0.046 / part.lengthS;
      return { s0: 0.5 - half, s1: 0.5 + half, t0: zone.t0, t1: zone.t1 };
    }
    return zone;
  }

  function rebuildZone() {
    removeZone();
    const band = zoneBand();
    const ns = 20;
    const nt = 12;
    const pos = [];
    const idx = [];
    const grid = ns + 1;
    for (let j = 0; j <= nt; j++) {
      const t = band.t0 + ((band.t1 - band.t0) * j) / nt;
      for (let i = 0; i <= ns; i++) {
        const s = band.s0 + ((band.s1 - band.s0) * i) / ns;
        part.point(s, t, _p);
        const x = _p.x;
        const y = _p.y;
        const z = _p.z;
        part.normal(s, t, _n);
        _p.set(x, y, z).addScaledVector(_n, 0.008);
        pos.push(_p.x, _p.y, _p.z);
      }
    }
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < ns; i++) {
        const s = band.s0 + ((band.s1 - band.s0) * (i + 0.5)) / ns;
        const t = band.t0 + ((band.t1 - band.t0) * (j + 0.5)) / nt;
        if (part.blocked?.(s, t)) continue;
        const a = j * grid + i;
        idx.push(a, a + grid, a + 1, a + 1, a + grid, a + grid + 1);
      }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    zoneMesh = new THREE.Mesh(g, mat);
    zoneMesh.renderOrder = 2;
    zoneMesh.frustumCulled = false;
    scene.add(zoneMesh);
    positionHandles();
  }

  function removeZone() {
    if (!zoneMesh) return;
    scene.remove(zoneMesh);
    zoneMesh.geometry.dispose();
    zoneMesh.material.dispose();
    zoneMesh = null;
  }

  function makeHandles() {
    removeHandles();
    if (!useHandles() || part.kind === 'weld' || phase !== 'zone') return;
    handleGroup = new THREE.Group();
    handleGroup.name = 'yt-handles';
    const vis = new THREE.MeshBasicMaterial({ color: 0xffe7a0, toneMapped: false });
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.016), vis);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), hitMat);
      hit.userData.handle = i;
      g.add(box, hit);
      g.userData.handle = i;
      handleGroup.add(g);
    }
    scene.add(handleGroup);
    positionHandles();
  }

  function syncHandles() {
    if (useHandles() && part.kind !== 'weld' && phase === 'zone') {
      if (!handleGroup) makeHandles();
      else positionHandles();
    } else removeHandles();
  }

  function removeHandles() {
    if (!handleGroup) return;
    scene.remove(handleGroup);
    handleGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    handleGroup = null;
  }

  function cornerST(i) {
    const b = zoneBand();
    const s = i === 0 || i === 3 ? b.s0 : b.s1;
    const t = i === 0 || i === 1 ? b.t0 : b.t1;
    return { s, t };
  }

  function positionHandles() {
    if (!handleGroup) return;
    handleGroup.children.forEach((g, i) => {
      const { s, t } = cornerST(i);
      part.point(s, t, _p);
      const x = _p.x;
      const y = _p.y;
      const z = _p.z;
      part.normal(s, t, _n);
      g.position.set(x, y, z).addScaledVector(_n, 0.018);
    });
  }

  function pickHandle(e) {
    if (!handleGroup) return null;
    pointerNDC(e);
    raycaster.setFromCamera(ndc, stage.camera);
    const hits = raycaster.intersectObjects(handleGroup.children, true);
    const h = hits.find((x) => x.object.userData.handle !== undefined);
    if (!h) return null;
    const surf = raycaster.intersectObject(part.pick, false)[0];
    if (surf && h.distance > surf.distance + 0.04) return null;
    return { index: h.object.userData.handle };
  }

  function pointerNDC(e) {
    const rect = stage.canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(e) {
    if (!api.active || phase !== 'zone' || !useHandles() || part.kind === 'weld') return;
    const hit = pickHandle(e);
    if (!hit) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drag = hit.index;
    try {
      stage.canvas.parentElement.setPointerCapture(e.pointerId);
    } catch (_) {
      /* best effort */
    }
  }

  /* Ray hit, or the closest point of the surface when the pointer leaves the mesh. */
  function surfaceUV() {
    const hit = raycaster.intersectObject(part.pick, false)[0];
    if (hit?.uv) return { s: hit.uv.x, t: hit.uv.y };
    const ray = raycaster.ray;
    let best = Infinity;
    let bs = 0.5;
    let bt = 0.5;
    const n = 20;
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        part.point(s, t, _p);
        const d = ray.distanceToPoint(_p);
        if (d < best) {
          best = d;
          bs = s;
          bt = t;
        }
      }
    }
    let span = 1 / n;
    for (let iter = 0; iter < 3; iter++) {
      span *= 0.5;
      let ns = bs;
      let nt = bt;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const s = clamp(bs + i * span, 0, 1);
          const t = clamp(bt + j * span, 0, 1);
          part.point(s, t, _p);
          const d = ray.distanceToPoint(_p);
          if (d < best) {
            best = d;
            ns = s;
            nt = t;
          }
        }
      }
      bs = ns;
      bt = nt;
    }
    return { s: bs, t: bt };
  }

  function onPointerMove(e) {
    if (drag < 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerNDC(e);
    raycaster.setFromCamera(ndc, stage.camera);
    const uv = surfaceUV();
    const minS = 0.06;
    const minT = 0.06;
    let s = clamp(uv.s, 0, 1);
    let t = clamp(uv.t, 0, 1);
    if (drag === 0 || drag === 3) zone.s0 = Math.min(s, zone.s1 - minS);
    else zone.s1 = Math.max(s, zone.s0 + minS);
    if (drag === 0 || drag === 1) zone.t0 = Math.min(t, zone.t1 - minT);
    else zone.t1 = Math.max(t, zone.t0 + minT);
    zone.s0 = clamp(zone.s0, 0, 1);
    zone.s1 = clamp(zone.s1, 0, 1);
    zone.t0 = clamp(zone.t0, 0, 1);
    zone.t1 = clamp(zone.t1, 0, 1);
    api.zone = zone;
    hideError();
    markPreset();
    rebuildZone();
  }

  function onPointerUp() {
    drag = -1;
  }

  function handleScreen(i) {
    if (!handleGroup) return null;
    const g = handleGroup.children[i];
    if (!g) return null;
    _p.copy(g.position).project(stage.camera);
    const rect = stage.canvas.getBoundingClientRect();
    return {
      x: rect.left + (_p.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-_p.y * 0.5 + 0.5) * rect.height,
      behind: _p.z > 1,
    };
  }

  let listening = false;
  function bind() {
    if (listening) return;
    listening = true;
    const host = document.getElementById('xp-canvas');
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', onResize);
  }
  function unbind() {
    if (!listening) return;
    listening = false;
    const host = document.getElementById('xp-canvas');
    host.removeEventListener('pointerdown', onPointerDown, true);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
  }
  function onResize() {
    if (api.active && phase === 'zone') syncHandles();
  }

  function clearPath() {
    if (part?.id === 'panel') world.panel.uniforms.uCover.value = saved.cover;
    if (part?.uniforms && part.id !== 'panel') {
      part.uniforms.uCscan.value = 0;
      part.uniforms.uGlow.value = 0;
    }
    if (path) {
      scene.remove(path.group);
      path.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = [].concat(o.material);
          mats.forEach((m) => {
            if (m && m.dispose) m.dispose();
          });
        }
      });
      path = null;
    }
    if (coverage) {
      coverage.dispose();
      coverage = null;
    }
    traj = null;
    api.pathDraw = 0;
    api.cover = 0;
    world.panel.uniforms.uCscan.value = 0;
  }

  function buildPath(result) {
    clearPath();
    traj = result;
    path = createPathVisuals(traj, world.glow);
    path.uniforms.uDraw.value = 0;
    path.uniforms.uFade.value = 1;
    path.uniforms.uAct3.value = 0;
    path.uniforms.uProbeS.value = -1;
    scene.add(path.group);
    const stampU = (part.swath || 0.05) / part.lengthS;
    const stampV = (part.swath || 0.05) / part.lengthT;
    coverage = createCoverageUV(stage.renderer, traj, {
      width: 1024,
      height: 768,
      stampU: clamp(stampU, 0.02, 0.22),
      stampV: clamp(stampV, 0.02, 0.24),
    });
  }

  function keySamples(samples) {
    const src = samples.filter((s) => s.contact);
    const list = src.length ? src : samples;
    const n = Math.min(12, list.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / Math.max(1, n - 1))]);
    return out;
  }

  function baseList() {
    const bases = [];
    for (const z of [-0.85, -1.15, -1.45]) {
      for (const y of [0.32, 0.55, 0.82]) {
        for (const x of [-0.28, 0.05, 0.32]) {
          for (const ry of [-Math.PI / 2, -Math.PI / 2 + 0.4]) bases.push({ x, y, z, ry });
        }
      }
    }
    return bases;
  }

  function scoreBase(b, keys) {
    applyBase(b);
    const first = keys[0];
    const seeds = world.arm.poseSeeds(first.p, _aim.copy(first.n).negate(), first.t);
    if (!seeds.length) return { ok: false, maxPos: 999, maxAng: 999, maxRoll: 999, lim: 1, jump: 99, score: 1e9, ...b };
    let best = null;
    for (const seed of seeds) {
      let prev = seed.q;
      let maxPos = seed.pos;
      let maxAng = seed.ang;
      let maxRoll = seed.roll;
      let lim = 0;
      let jump = 0;
      let dead = false;
      for (let i = 1; i < keys.length; i++) {
        const smp = keys[i];
        const r = world.arm.solvePose(smp.p, _aim.copy(smp.n).negate(), smp.t, prev);
        if (!r) {
          dead = true;
          break;
        }
        maxPos = Math.max(maxPos, r.pos);
        maxAng = Math.max(maxAng, r.ang);
        maxRoll = Math.max(maxRoll, r.roll);
        lim += r.limit;
        jump += r.step || 0;
        prev = r.q;
        if (!r.ok && (maxPos > 30 || maxAng > 35 || (r.step || 0) > 1.05)) {
          dead = true;
          break;
        }
      }
      const ok = !dead && maxPos <= 2 && maxAng <= 3 && lim === 0;
      const score = (ok ? 0 : 1e6) + maxPos * 6 + maxAng * 4 + maxRoll * 0.05 + jump + lim * 20;
      if (!best || score < best.score) best = { ok, maxPos, maxAng, maxRoll, lim, jump, score };
    }
    return { ...best, ...b };
  }

  function solveChain(samples, prev0) {
    let prev = prev0.slice();
    let maxPos = 0;
    let maxAng = 0;
    let maxRoll = 0;
    let lim = 0;
    let maxStep = 0;
    for (let si = 0; si < samples.length; si++) {
      const smp = samples[si];
      const r = world.arm.solvePose(smp.p, _aim.copy(smp.n).negate(), smp.t, prev);
      if (!r) return null;
      smp.q = r.q.slice();
      maxPos = Math.max(maxPos, r.pos);
      maxAng = Math.max(maxAng, r.ang);
      maxRoll = Math.max(maxRoll, r.roll);
      lim += r.limit;
      maxStep = Math.max(maxStep, r.step || 0);
      if (!r.ok) {
        return { maxPos, maxAng, maxRoll, lim, maxStep, qLast: r.q.slice(), n: samples.length, failed: true };
      }
      prev = r.q;
    }
    return { maxPos, maxAng, maxRoll, lim, maxStep, qLast: prev.slice(), n: samples.length };
  }

  function applyBase(b) {
    world.arm.root.position.set(b.x, b.y, b.z);
    world.arm.root.rotation.y = b.ry;
    world.arm.root.updateMatrixWorld(true);
  }

  function chainAccept(chain, qH, qE) {
    if (!chain) return null;
    const pos = Math.max(chain.maxPos, qH ? qH.pos : 999, qE ? qE.pos : 999);
    const ang = Math.max(chain.maxAng, qH ? qH.ang : 999, qE ? qE.ang : 999);
    const lim = chain.lim + (qH ? qH.limit : 1) + (qE ? qE.limit : 1);
    const step = Math.max(chain.maxStep, qH ? qH.step || 0 : 99, qE ? qE.step || 0 : 99);
    const hoverOk = qH && qH.ok;
    const endOk = qE && qE.ok;
    const ok = pos <= 2 && ang <= 3 && lim === 0 && step <= 1.05 && hoverOk && endOk;
    return { ok, pos, ang, lim, step, roll: chain.maxRoll };
  }

  function solveStandoff(sample, prev) {
    let last = null;
    for (const dist of [0.09, 0.05, 0.025, 0.012]) {
      const at = _hover.copy(sample.p).addScaledVector(sample.n, dist);
      const r = world.arm.solvePose(at, _aim.copy(sample.n).negate(), sample.t, prev);
      last = r;
      if (r && r.ok) return r;
    }
    return last;
  }

  function finishOnBase(b, samples, prev0) {
    applyBase(b);
    const first = samples[0];
    const last = samples[samples.length - 1];
    const qH = solveStandoff(first, prev0);
    const chain = solveChain(samples, qH && qH.ok ? qH.q : prev0);
    if (!chain) return null;
    const qE = solveStandoff(last, chain.qLast);
    const judged = chainAccept(chain, qH, qE);
    if (!judged) return null;
    return { judged, chain, qH, qE, b };
  }

  function placeArm(result) {
    const samples = result.samples;
    const keys = keySamples(samples);
    const ranked = baseList()
      .map((b) => scoreBase(b, keys))
      .sort((a, c) => a.score - c.score);
    let found = null;
    const tries = ranked.slice(0, 3);
    for (const b of tries) {
      applyBase(b);
      const first = samples[0];
      const seeds = world.arm.poseSeeds(first.p, _aim.copy(first.n).negate(), first.t);
      const starts = seeds.length ? seeds : [{ q: HOME }];
      for (const seed of starts) {
        const alt = finishOnBase(b, samples, seed.q);
        if (!alt) continue;
        if (!found || alt.judged.ok || alt.judged.lim + alt.judged.step < found.judged.lim + found.judged.step) found = alt;
        if (found && found.judged.ok) break;
      }
      if (found && found.judged.ok) break;
    }
    if (!found) return { ok: false, pos: 999, ang: 999, roll: 999, limit: 1, step: 99, n: samples.length };
    const { judged, chain, qH, qE, b } = found;
    applyBase(b);
    if (qH) samples[0].q = samples[0].q || qH.q.slice();
    result.qHover = (qH && qH.q ? qH.q : samples[0].q).slice();
    result.qEnd = (qE && qE.q ? qE.q : chain.qLast).slice();
    world.arm.setJoints(HOME);
    prevQ = HOME.slice();
    let minSin = 1;
    for (const s of samples) {
      if (s.q) minSin = Math.min(minSin, Math.abs(Math.sin(s.q[4])));
    }
    const pose = {
      ok: judged.ok,
      pos: judged.pos,
      ang: judged.ang,
      roll: judged.roll,
      limit: judged.lim,
      step: judged.step,
      minSin,
      n: samples.length,
      x: b.x,
      y: b.y,
      z: b.z,
      ry: b.ry,
    };
    api.pose = pose;
    api.reach = { max: judged.pos / 1000, mean: judged.pos / 1000, ang: judged.ang, ok: judged.ok, x: b.x, y: b.y, z: b.z };
    return pose;
  }

  function compute() {
    if (phase !== 'zone' || busy) return;
    hold = null;
    hideError();
    const result = computeZoneTrajectory(part, zone);
    if (!result || result.tooSmall) {
      showError('small');
      return;
    }
    buildPath(result);
    const pose = placeArm(result);
    if (!pose.ok) {
      clearPath();
      world.arm.setJoints(HOME);
      world.arm.root.visible = false;
      showError('reach');
      return;
    }
    world.arm.root.visible = false;
    drawT = 0;
    setPhase('drawing');
  }

  function startScan() {
    scanT = 0;
    const travel = fast ? 0.9 : clamp(traj.total / 0.28, 2.6, 5.2);
    scanDur = reduceMotion ? 1.4 : travel;
    coverage.clear();
    world.arm.root.visible = true;
    world.arm.setLed(false);
    prevQ = HOME.slice();
    world.arm.setJoints(HOME);
    setPhase('scan');
  }

  function lerpJoints(a, b, k) {
    for (let i = 0; i < 6; i++) qbuf[i] = a[i] + (b[i] - a[i]) * k;
    world.arm.setJoints(qbuf);
  }

  let debugLines = null;
  function ensureDebug() {
    if (!debugNormals || debugLines) return;
    const mk = (color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, toneMapped: false, depthTest: false }));
      line.frustumCulled = false;
      line.renderOrder = 6;
      line.visible = false;
      scene.add(line);
      return line;
    };
    debugLines = { n: mk(0xe8c547), a: mk(0xf4f1ea) };
  }

  function setLine(line, a, b) {
    const arr = line.geometry.attributes.position.array;
    arr[0] = a.x;
    arr[1] = a.y;
    arr[2] = a.z;
    arr[3] = b.x;
    arr[4] = b.y;
    arr[5] = b.z;
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  function syncDebug(pos, normal) {
    if (!debugNormals) return;
    ensureDebug();
    world.arm.toolAxes(_aim, null);
    setLine(debugLines.n, pos, _p.copy(pos).addScaledVector(normal, 0.12));
    setLine(debugLines.a, _tip.copy(pos).addScaledVector(_aim, -0.11), pos);
    debugLines.n.visible = true;
    debugLines.a.visible = true;
  }

  let hold = null;
  function park(u, v) {
    if (!traj) return null;
    let best = null;
    let bd = 1e9;
    for (const smp of traj.samples) {
      if (!smp.q) continue;
      const d = (smp.u - u) ** 2 + (smp.v - v) ** 2;
      if (d < bd) {
        bd = d;
        best = smp;
      }
    }
    if (!best) return null;
    hold = best;
    world.arm.root.visible = true;
    world.arm.setJoints(best.q);
    world.arm.setLed(true);
    if (path) {
      path.uniforms.uDraw.value = traj.total;
      path.uniforms.uFade.value = 1;
      path.head.visible = false;
    }
    const side = _p.copy(best.t).cross(best.n);
    if (side.lengthSq() < 1e-8) side.copy(best.t);
    side.normalize();
    shot.target.copy(best.p);
    shot.el = Math.asin(clamp(side.y, -0.82, 0.82));
    shot.az = Math.atan2(side.x, side.z);
    shot.radius = 0.32;
    shot.fov = 26;
    shot.offY = 0;
    shotHold = true;
    if (dom.yt) dom.yt.hidden = true;
    rig.recenter();
    rig.setShot(shot);
    rig.snap();
    syncDebug(best.p, best.n);
    const m = world.arm.measurePose(best.p, _n.copy(best.n).negate(), best.t);
    api.parked = { u: +best.u.toFixed(3), v: +best.v.toFixed(3), pos: +m.pos.toFixed(2), ang: +m.ang.toFixed(2), roll: +m.roll.toFixed(2) };
    return api.parked;
  }

  function paintLook(s, contact) {
    const U = part.uniforms;
    U.uCover.value = coverage.texture;
    U.uCscan.value = 1;
    U.uGlow.value = 1;
    U.uScanNow.value = traj.total ? s / traj.total : 1;
    if (part.id === 'panel') {
      U.uMarks.value = 0;
      U.uZones.value = 0;
      U.uIso.value = 0;
      if (contact) {
        const X = (st.u - 0.5) * part.lengthS;
        const Y = (st.v - 0.5) * part.lengthT;
        U.uProbe.value.set(X, Y, 1);
      } else U.uProbe.value.z = 0;
    }
    coverage.paintTo(s);
    api.cover = s;
    path.uniforms.uDraw.value = traj.total;
    path.uniforms.uAct3.value = 1;
    path.uniforms.uProbeS.value = s;
    path.uniforms.uFade.value = 1;
  }

  function frame(dt) {
    if (hold) {
      world.arm.root.visible = true;
      world.arm.setJoints(hold.q);
      syncDebug(hold.p, hold.n);
      if (!rig.isLocked) rig.setShot(shot);
      return;
    }
    frameShot();
    if (!rig.isLocked) rig.setShot(shot);
    if (phase === 'drawing' && traj) {
      drawT += dt;
      const k = easeInOutSine(Math.min(1, drawT / drawDur));
      const s = traj.total * k;
      path.uniforms.uDraw.value = s;
      path.uniforms.uFade.value = 1;
      path.head.visible = true;
      traj.at(s, st);
      path.head.position.copy(st.p).addScaledVector(st.n, 0.008);
      api.pathDraw = s;
      if (drawT >= drawDur) startScan();
    } else if (phase === 'scan' && traj) {
      scanT += dt;
      const scanEnd = approachT + scanDur;
      const first = traj.samples[0];
      const last = traj.samples[traj.samples.length - 1];
      if (scanT < approachT) {
        const k = easeInOutSine(scanT / approachT);
        lerpJoints(traj.qHover || first.q, first.q, k);
        syncDebug(first.p, first.n);
        world.arm.setLed(k > 0.92);
        paintLook(0, false);
        path.head.visible = false;
      } else if (scanT < scanEnd) {
        const k = easeInOutSine((scanT - approachT) / scanDur);
        const s = traj.total * k;
        traj.at(s, st);
        if (st.q) world.arm.setJoints(st.q);
        syncDebug(st.p, st.n);
        world.arm.setLed(!!st.contact);
        paintLook(s, !!st.contact);
        api.pathDraw = traj.total;
      } else {
        const k = easeInOutSine(Math.min(1, (scanT - scanEnd) / retractT));
        lerpJoints(last.q || first.q, traj.qEnd || last.q || first.q, k);
        syncDebug(last.p, last.n);
        world.arm.setLed(false);
        paintLook(traj.total, false);
        if (k >= 1) setPhase('done');
      }
    }
    if (dom.bar) {
      let v = 0.12;
      if (phase === 'zone') v = 0.28;
      else if (phase === 'drawing') v = 0.28 + 0.32 * Math.min(1, drawT / drawDur);
      else if (phase === 'scan') v = 0.6 + 0.4 * Math.min(1, scanT / (approachT + scanDur + retractT));
      else if (phase === 'done') v = 1;
      dom.bar.style.transform = `scaleX(${v.toFixed(4)})`;
    }
  }

  function setMobile(v) {
    mobile = v;
  }

  async function shoot(id, which) {
    enter();
    busy = false;
    if (!cache[id]) {
      cache[id] = id === 'panel' ? panelPart : factories[id]();
      if (cache[id].ownsGroup) scene.add(cache[id].group);
    }
    applyPart(id);
    setPreset(part.defaultPreset || 'center');
    setPhase('zone');
    if (which === 'before') {
      removeZone();
      removeHandles();
      world.arm.root.visible = false;
    } else {
      const result = computeZoneTrajectory(part, zone);
      if (result?.tooSmall) return false;
      buildPath(result);
      placeArm(result);
      path.uniforms.uDraw.value = traj.total;
      path.uniforms.uAct3.value = 0;
      path.uniforms.uFade.value = 1;
      path.head.visible = false;
      coverage.paintTo(traj.total);
      part.uniforms.uCover.value = coverage.texture;
      part.uniforms.uCscan.value = 1;
      part.uniforms.uGlow.value = 0.15;
      part.uniforms.uScanNow.value = 1;
      if (part.id === 'panel') {
        part.uniforms.uMarks.value = 0;
        part.uniforms.uZones.value = 0;
        part.uniforms.uIso.value = 0;
      }
      world.arm.root.visible = false;
      removeZone();
      removeHandles();
      api.cover = traj.total;
      api.pathDraw = traj.total;
    }
    shotHold = true;
    frameShot();
    shot.offY = 0.02;
    rig.setShot(shot);
    rig.snap();
    api.shotReady = true;
    return true;
  }

  dom.thumbs.forEach((b) => b.addEventListener('click', () => selectPart(b.dataset.part)));
  dom.zones.forEach((b) => b.addEventListener('click', () => {
    if (phase === 'zone') setPreset(b.dataset.zone);
  }));
  dom.rangeA?.addEventListener('input', () => setSlider('a'));
  dom.rangeB?.addEventListener('input', () => setSlider('b'));
  dom.compute?.addEventListener('click', () => compute());
  dom.again?.addEventListener('click', () => showPick());

  function projectZone() {
    const cam = stage.camera;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    const s0 = zone.s0 ?? 0;
    const s1 = zone.s1 ?? 1;
    const t0 = zone.t0 ?? 0;
    const t1 = zone.t1 ?? 1;
    for (let j = 0; j <= 14; j++) {
      for (let i = 0; i <= 14; i++) {
        part.point(s0 + ((s1 - s0) * i) / 14, t0 + ((t1 - t0) * j) / 14, _p);
        _p.project(cam);
        if (_p.z > 1) continue;
        const x = _p.x * 0.5 + 0.5;
        const y = -_p.y * 0.5 + 0.5;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    return { left: minX, top: minY, width: Math.max(0.02, maxX - minX), height: Math.max(0.02, maxY - minY) };
  }

  function hideDress(hide) {
    scene.traverse((o) => {
      if (o.name === 'floor' || o.name === 'yt-support' || o.isPoints) o.visible = !hide;
    });
  }

  function renderMask() {
    const hidden = [];
    scene.traverse((o) => {
      if ((o.isMesh || o.isPoints || o.isLine || o.isLineSegments) && o !== part.pick && o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const prev = part.pick.material;
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    part.pick.material = white;
    const bg = scene.background;
    const env = scene.environment;
    scene.background = new THREE.Color(0x000000);
    scene.environment = null;
    stage.renderer.render(scene, stage.camera);
    part.pick.material = prev;
    white.dispose();
    scene.background = bg;
    scene.environment = env;
    hidden.forEach((o) => {
      o.visible = true;
    });
  }

  api.zone = zone;
  api.setMobile = setMobile;
  api.frame = frame;
  api.shoot = shoot;
  api.projectZone = projectZone;
  api.handleAt = (i) => handleScreen(i);
  api.hideDress = hideDress;
  api.renderMask = renderMask;
  api.selectPart = selectPart;
  api.setPreset = setPreset;
  api.compute = compute;
  api.park = park;
  return api;
}
