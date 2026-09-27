import * as THREE from 'three';
import { HOME } from './arm.js';
import { FX } from './fx.js';
import { createPathVisuals } from './trajectory.js';
import { computeZoneTrajectory } from './trajectory.js';
import { createCoverageUV, coverageGrid, COVER_RADIUS } from './cscan.js';
import { createWeldPart, createElbowPart, createFairingPart, createPanelPart, IND_THRESHOLD } from './parts.js';
import { derivePacing, timeProfile } from './pacing.js';
import { renderReport, clearReport, reportCopy } from './report.js';
import { rampRGB } from './panel.js';
import { easeInOutSine, easeInOutCubic, clamp } from './util.js';

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
    report: document.getElementById('yt-report'),
    reportThumb: document.getElementById('yt-report-thumb'),
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
  const pacing = derivePacing(world);
  api.pacing = pacing;
  /* ?ytfast=1 (tests) plays the same timeline faster. */
  const timeScale = fast ? 0.12 : 1;
  let plan = null;
  let report = null;

  function makePlan() {
    const profile = timeProfile(traj, pacing, spotsWorld());
    if (reduceMotion) {
      return { draw: 0.4, drawHold: 0, pre: 0, approach: 0.3, descend: 0.15, scan: 1.4, lift: 0.15, settle: 0, retract: 0.3, profile, linear: true };
    }
    const k = timeScale;
    return {
      draw: (traj.total / pacing.vDraw) * k,
      drawHold: pacing.drawHold * k,
      pre: pacing.preApproach * k,
      approach: pacing.approach * k,
      descend: pacing.descend * k,
      scan: profile.duration * k,
      lift: pacing.lift * k,
      settle: pacing.settle * k,
      retract: pacing.retract * k,
      profile,
      linear: false,
    };
  }

  function spotsWorld() {
    return (part.spots || []).map((sp) => ({ ...sp, at: part.point(sp.u, sp.v, new THREE.Vector3()) }));
  }

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
    if (next === 'done') showReport();
    else if (next !== 'drawing' && next !== 'scan') hideReport();
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
      shot.offX = 0;
      // The end report sits in the dock: part above it on phones, right of it on desktop.
      if (phase === 'done') {
        if (mobile) shot.offY = 0.24;
        else {
          shot.offX = -0.17;
          shot.offY = 0.03;
        }
      }
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
    hideReport();
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
      const offs = part.weldOffsets.map(Math.abs);
      const half = (Math.max(...offs) + COVER_RADIUS * (part.swath / 2)) / part.lengthS;
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
    coverage = createCoverageUV(stage.renderer, traj, { surface: part, clip: { ...zoneBand() } });
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
        return { maxPos, maxAng, maxRoll, lim, maxStep, qLast: r.q.slice(), n: samples.length, failed: true, failedAt: si };
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
    const tries = ranked.slice(0, 8);
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
    const failed = chain.failed ? samples[chain.failedAt] : null;
    const pose = {
      ok: judged.ok,
      failedAt: failed ? { i: chain.failedAt, u: +failed.u.toFixed(3), v: +failed.v.toFixed(3), kind: failed.kind } : null,
      hoverOk: !!(qH && qH.ok),
      endOk: !!(qE && qE.ok),
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
    plan = makePlan();
    report = buildReport();
    api.plan = {
      draw: plan.draw,
      scan: plan.scan,
      total: plan.draw + plan.drawHold + plan.pre + plan.approach + plan.descend + plan.scan + plan.lift + plan.settle + plan.retract,
      passTimes: plan.profile.passTimes,
      pathLength: traj.total,
      contactLength: traj.contactLen,
    };
    drawT = 0;
    setPhase('drawing');
  }

  function startScan() {
    scanT = 0;
    coverage.clear();
    world.arm.root.visible = true;
    world.arm.setLed(false);
    prevQ = HOME.slice();
    world.arm.setJoints(HOME);
    setPhase('scan');
  }

  /* Travel and cross extents (mm) of the zone, measured on the surface at mid-zone. */
  function zoneExtent(band) {
    const alongS = part.along !== 't';
    const n = 24;
    const measure = (fixedS, isS) => {
      let L = 0;
      for (let i = 0; i < n; i++) {
        const a = (isS ? band.s0 : band.t0) + (((isS ? band.s1 : band.t1) - (isS ? band.s0 : band.t0)) * i) / n;
        const b = (isS ? band.s0 : band.t0) + (((isS ? band.s1 : band.t1) - (isS ? band.s0 : band.t0)) * (i + 1)) / n;
        if (isS) {
          part.point(a, fixedS, _p);
          part.point(b, fixedS, _n);
        } else {
          part.point(fixedS, a, _p);
          part.point(fixedS, b, _n);
        }
        L += _p.distanceTo(_n);
      }
      return L * 1000;
    };
    const midS = (band.s0 + band.s1) / 2;
    const midT = (band.t0 + band.t1) / 2;
    const lenS = measure(midT, true);
    const lenT = measure(midS, false);
    return alongS ? { travel: lenS, cross: lenT } : { travel: lenT, cross: lenS };
  }

  /* Everything the end report states, from this part, this zone and this path. */
  function buildReport() {
    const band = { ...zoneBand() };
    const grid = coverageGrid(traj, part, band, coverage.radius);
    const found = [];
    for (const sp of part.spots || []) {
      if (sp.u < band.s0 || sp.u > band.s1 || sp.v < band.t0 || sp.v > band.t1) continue;
      if (!grid.covered(sp.u, sp.v)) continue;
      if (sp.amp < IND_THRESHOLD) continue;
      found.push(sp);
    }
    found.sort((a, b) => a.id.localeCompare(b.id));
    const ext = zoneExtent(band);
    return {
      part: part.id,
      preset: presetName(),
      zoneMm: [Math.round(ext.travel), Math.round(ext.cross)],
      passes: traj.passes,
      contactM: traj.contactLen,
      coverage: grid.fraction,
      indications: found.map((sp, i) => {
        const loc = part.locate(sp.u, sp.v);
        return {
          id: String(i + 1).padStart(2, '0'),
          a: loc.a !== undefined ? Math.round(loc.a) : undefined,
          b: loc.b !== undefined ? Math.round(loc.b) : undefined,
          cell: loc.cell,
          u: sp.u,
          v: sp.v,
          r: sp.r,
        };
      }),
      band,
      grid,
    };
  }

  function presetName() {
    for (const name of ['all', 'center', 'edge']) {
      const p = part.presets[name];
      if (!p) continue;
      const same = Math.abs(p.t0 - zone.t0) < 1e-3 && Math.abs(p.t1 - zone.t1) < 1e-3 && (part.kind === 'weld' || (Math.abs(p.s0 - zone.s0) < 1e-3 && Math.abs(p.s1 - zone.s1) < 1e-3));
      if (same) return name;
    }
    return 'custom';
  }

  /*
   * C-scan thumbnail of the scanned zone: the simulated field where the
   * probe footprint passed, dark where it did not. The longer side of the
   * zone runs across; on the panel that is s across and t downward, as in
   * the act-4 thumbnail, so the zone letters and numbers read the same.
   */
  function drawReportThumb(canvas, rep, widthPx) {
    if (!canvas) return;
    const band = rep.band;
    const grid = rep.grid;
    const spanS = (band.s1 - band.s0) * part.lengthS;
    const spanT = (band.t1 - band.t0) * part.lengthT;
    const sAcross = spanS >= spanT;
    const aspect = clamp(sAcross ? spanT / spanS : spanS / spanT, 0.3, 1);
    const dpr = widthPx ? widthPx / 160 : Math.min(window.devicePixelRatio || 1, 2);
    const cssW = widthPx ? 160 : canvas.getBoundingClientRect().width || 150;
    const W = Math.max(60, Math.round(cssW * dpr));
    const H = Math.max(20, Math.round(W * aspect));
    canvas.width = W;
    canvas.height = H;
    canvas.style.aspectRatio = `${W} / ${H}`;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const lut = [];
    for (let i = 0; i < 256; i++) {
      const c = rampRGB(i / 255);
      lut.push([c.r * 255, c.g * 255, c.b * 255]);
    }
    const toUV = (x, y) => {
      const a = (x + 0.5) / W;
      const b = (y + 0.5) / H;
      return sAcross ? [band.s0 + a * (band.s1 - band.s0), band.t0 + b * (band.t1 - band.t0)] : [band.s0 + b * (band.s1 - band.s0), band.t0 + a * (band.t1 - band.t0)];
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [u, v] = toUV(x, y);
        const o = (y * W + x) * 4;
        img.data[o + 3] = 255;
        if (part.blocked?.(u, v)) {
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 7;
          continue;
        }
        if (!grid.covered(u, v)) {
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 14;
          continue;
        }
        const c = lut[Math.max(0, Math.min(255, Math.round(part.field.sample(u, v).value * 255)))];
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (u, v) => {
      const a = sAcross ? (u - band.s0) / (band.s1 - band.s0) : (v - band.t0) / (band.t1 - band.t0);
      const b = sAcross ? (v - band.t0) / (band.t1 - band.t0) : (u - band.s0) / (band.s1 - band.s0);
      return [a * W, b * H];
    };
    const pxPerM = W / Math.max(spanS, spanT);
    for (const ind of rep.indications) {
      const [cx, cy] = toPx(ind.u, ind.v);
      const rr = Math.max(5 * dpr, ind.r * 1.4 * pxPerM);
      ctx.strokeStyle = '#e8c547';
      ctx.lineWidth = Math.max(1.5, 1.4 * dpr);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8c547';
      ctx.font = `600 ${Math.round(10 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'bottom';
      const tx = Math.min(W - 18 * dpr, cx + rr * 0.72);
      const ty = Math.max(12 * dpr, cy - rr * 0.72);
      ctx.fillText(ind.id, tx, ty);
    }
    ctx.strokeStyle = 'rgba(244,241,234,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  function showReport() {
    if (!report || !dom.report) return;
    const lang = document.documentElement.lang || 'en';
    renderReport(dom.report, report, reportCopy(copy), lang);
    drawReportThumb(dom.reportThumb, report);
    api.report = {
      part: report.part,
      preset: report.preset,
      zoneMm: report.zoneMm,
      passes: report.passes,
      contactM: +report.contactM.toFixed(3),
      coverage: +report.coverage.toFixed(4),
      indications: report.indications.map(({ id, a, b, cell }) => ({ id, a, b, cell })),
      text: dom.report.innerText,
    };
  }

  function hideReport() {
    report = null;
    api.report = null;
    if (dom.report) clearReport(dom.report);
    if (dom.reportThumb) {
      const c = dom.reportThumb;
      c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    }
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

  function paintLook(s, contact, paint = true) {
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
    if (paint) coverage.paintTo(s);
    api.cover = paint ? s : 0;
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
      const k = easeInOutSine(Math.min(1, drawT / Math.max(plan.draw, 1e-3)));
      const s = traj.total * k;
      path.uniforms.uDraw.value = s;
      path.uniforms.uFade.value = 1;
      path.head.visible = drawT < plan.draw;
      traj.at(s, st);
      path.head.position.copy(st.p).addScaledVector(st.n, 0.008);
      api.pathDraw = s;
      if (drawT >= plan.draw + plan.drawHold) startScan();
    } else if (phase === 'scan' && traj) {
      scanT += dt;
      const first = traj.samples[0];
      const last = traj.samples[traj.samples.length - 1];
      const qHover = traj.qHover || first.q;
      const qEnd = traj.qEnd || last.q || first.q;
      const tApproach = plan.pre;
      const tDescend = tApproach + plan.approach;
      const tScan = tDescend + plan.descend;
      const tLift = tScan + plan.scan;
      const tSettle = tLift + plan.lift;
      const tRetract = tSettle + plan.settle;
      const tDone = tRetract + plan.retract;
      path.head.visible = false;
      if (scanT < tDescend) {
        const k = scanT < tApproach ? 0 : easeInOutCubic(clamp((scanT - tApproach) / Math.max(plan.approach, 1e-3), 0, 1));
        lerpJoints(HOME, qHover, k);
        syncDebug(first.p, first.n);
        world.arm.setLed(false);
        paintLook(0, false, false);
      } else if (scanT < tScan) {
        const k = easeInOutCubic(clamp((scanT - tDescend) / Math.max(plan.descend, 1e-3), 0, 1));
        lerpJoints(qHover, first.q, k);
        syncDebug(first.p, first.n);
        world.arm.setLed(k > 0.98);
        paintLook(0, false, false);
      } else if (scanT < tLift) {
        const tau = scanT - tScan;
        const s = plan.linear ? traj.total * (tau / Math.max(plan.scan, 1e-3)) : plan.profile.sAt(tau / timeScale);
        traj.at(s, st);
        if (st.q) world.arm.setJoints(st.q);
        syncDebug(st.p, st.n);
        world.arm.setLed(!!st.contact);
        paintLook(s, !!st.contact, true);
        api.pathDraw = traj.total;
      } else if (scanT < tSettle) {
        const k = easeInOutCubic(clamp((scanT - tLift) / Math.max(plan.lift, 1e-3), 0, 1));
        lerpJoints(last.q || first.q, qEnd, k);
        syncDebug(last.p, last.n);
        world.arm.setLed(false);
        paintLook(traj.total, false, true);
      } else {
        const k = easeInOutCubic(clamp((scanT - tRetract) / Math.max(plan.retract, 1e-3), 0, 1));
        lerpJoints(qEnd, HOME, k);
        world.arm.setLed(false);
        paintLook(traj.total, false, true);
        const fade = clamp((scanT - tRetract) / Math.max(plan.retract, 1e-3), 0, 1);
        path.uniforms.uFade.value = 1 - fade;
        part.uniforms.uGlow.value = 1 - fade;
        if (scanT >= tDone) setPhase('done');
      }
    }
    if (dom.bar) {
      let v = 0.12;
      if (phase === 'zone') v = 0.28;
      else if (phase === 'drawing' && plan) v = 0.28 + 0.32 * Math.min(1, drawT / Math.max(plan.draw + plan.drawHold, 1e-3));
      else if (phase === 'scan' && plan) {
        const total = plan.pre + plan.approach + plan.descend + plan.scan + plan.lift + plan.settle + plan.retract;
        v = 0.6 + 0.4 * Math.min(1, scanT / Math.max(total, 1e-3));
      } else if (phase === 'done') v = 1;
      dom.bar.style.transform = `scaleX(${v.toFixed(4)})`;
    }
  }

  function setMobile(v) {
    mobile = v;
  }

  /* Stills for the no-WebGL fallback: the part, or the painted end state of one preset. */
  async function shoot(id, which, preset) {
    enter();
    busy = false;
    if (!cache[id]) {
      cache[id] = id === 'panel' ? panelPart : factories[id]();
      if (cache[id].ownsGroup) scene.add(cache[id].group);
    }
    applyPart(id);
    setPreset(preset || part.defaultPreset || 'center');
    setPhase('zone');
    if (which === 'before') {
      removeZone();
      removeHandles();
      world.arm.root.visible = false;
    } else {
      const result = computeZoneTrajectory(part, zone);
      if (result?.tooSmall) return false;
      buildPath(result);
      const pose = placeArm(result);
      path.uniforms.uDraw.value = traj.total;
      path.uniforms.uAct3.value = 1;
      path.uniforms.uProbeS.value = traj.total + 1;
      path.uniforms.uFade.value = 0;
      path.head.visible = false;
      coverage.paintTo(traj.total);
      part.uniforms.uCover.value = coverage.texture;
      part.uniforms.uCscan.value = 1;
      part.uniforms.uGlow.value = 0;
      part.uniforms.uScanNow.value = 1;
      if (part.id === 'panel') {
        part.uniforms.uMarks.value = 0;
        part.uniforms.uZones.value = 0;
        part.uniforms.uIso.value = 0;
        part.uniforms.uProbe.value.z = 0;
      }
      world.arm.root.visible = false;
      removeZone();
      removeHandles();
      api.cover = traj.total;
      api.pathDraw = traj.total;
      report = buildReport();
      showReport();
      api.report.poseOk = pose.ok;
    }
    shotHold = true;
    frameShot();
    shot.offY = 0.02;
    rig.setShot(shot);
    rig.snap();
    api.shotReady = true;
    return true;
  }

  function thumbURL(width = 320) {
    if (!report) return null;
    const c = document.createElement('canvas');
    drawReportThumb(c, report, width);
    return c.toDataURL('image/png');
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
    const band = zoneBand();
    const s0 = band.s0 ?? 0;
    const s1 = band.s1 ?? 1;
    const t0 = band.t0 ?? 0;
    const t1 = band.t1 ?? 1;
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
  api.thumbURL = thumbURL;
  api.renderMask = renderMask;
  api.selectPart = selectPart;
  api.setPreset = setPreset;
  api.compute = compute;
  api.park = park;
  return api;
}
