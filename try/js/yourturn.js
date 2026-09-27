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

export function createYourTurn({ world, stage, rig, root, copy, reduceMotion, fast }) {
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
    if (dom.error) dom.error.hidden = true;
  }

  function showError() {
    api.tooSmall = true;
    if (dom.error) dom.error.hidden = false;
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

  function onPointerMove(e) {
    if (drag < 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerNDC(e);
    raycaster.setFromCamera(ndc, stage.camera);
    const hit = raycaster.intersectObject(part.pick, false)[0];
    if (!hit || !hit.uv) return;
    const minS = 0.06;
    const minT = 0.06;
    let s = clamp(hit.uv.x, 0, 1);
    let t = clamp(hit.uv.y, 0, 1);
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
      width: 640,
      height: 480,
      stampU: clamp(stampU, 0.02, 0.2),
      stampV: clamp(stampV, 0.02, 0.22),
    });
  }

  function placeArm(result) {
    const samples = result.samples.filter((s) => s.contact);
    const picks = [];
    const step = Math.max(1, Math.floor(samples.length / 10));
    for (let i = 0; i < samples.length; i += step) picks.push(samples[i]);
    if (!picks.length) picks.push(result.samples[0]);
    const bases = [];
    for (const z of [-0.95, -1.15, -1.35, -1.55]) {
      for (const y of [0.28, 0.46, 0.64]) {
        for (const x of [-0.35, -0.12, 0.12, 0.35]) bases.push({ x, y, z, ry: -Math.PI / 2 });
      }
    }
    let best = null;
    const limits = [
      [-2.9, 2.9],
      [-1.35, 1.7],
      [-2.3, 1.4],
      [-3.1, 3.1],
      [-2.25, 2.25],
      [-3.4, 3.4],
    ];
    for (const b of bases) {
      world.arm.root.position.set(b.x, b.y, b.z);
      world.arm.root.rotation.y = b.ry;
      world.arm.root.updateMatrixWorld(true);
      let sum = 0;
      let max = 0;
      let pen = 0;
      for (const smp of picks) {
        const q = world.arm.solve(smp.p, _aim.copy(smp.n).negate(), qbuf);
        for (let i = 0; i < 6; i++) {
          if (q[i] < limits[i][0] || q[i] > limits[i][1]) pen += 0.05;
        }
        world.arm.setJoints(q);
        const err = world.arm.tipWorld(_tip).distanceTo(smp.p);
        sum += err;
        if (err > max) max = err;
      }
      const score = sum / picks.length + max * 2 + pen;
      if (!best || score < best.score) best = { score, max, mean: sum / picks.length, ...b };
    }
    world.arm.root.position.set(best.x, best.y, best.z);
    world.arm.root.rotation.y = best.ry;
    world.arm.root.updateMatrixWorld(true);
    world.arm.setJoints(HOME);
    prevQ = HOME.slice();
    api.reach = { max: best.max, mean: best.mean, x: best.x, y: best.y, z: best.z };
    return best;
  }

  function compute() {
    if (phase !== 'zone' || busy) return;
    hideError();
    const result = computeZoneTrajectory(part, zone);
    if (!result || result.tooSmall) {
      showError();
      return;
    }
    buildPath(result);
    placeArm(result);
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

  function solveAt(pos, normal) {
    const q = world.arm.solve(pos, _aim.copy(normal).negate(), qbuf);
    for (let i = 0; i < 6; i++) {
      let d = q[i] - prevQ[i];
      while (d > Math.PI) {
        q[i] -= Math.PI * 2;
        d -= Math.PI * 2;
      }
      while (d < -Math.PI) {
        q[i] += Math.PI * 2;
        d += Math.PI * 2;
      }
      prevQ[i] = q[i];
    }
    world.arm.setJoints(q);
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
        _hover.copy(first.p).addScaledVector(first.n, 0.09);
        _p.copy(_hover).lerp(first.p, k);
        solveAt(_p, first.n);
        world.arm.setLed(k > 0.92);
        paintLook(0, false);
        path.head.visible = false;
      } else if (scanT < scanEnd) {
        const k = easeInOutSine((scanT - approachT) / scanDur);
        const s = traj.total * k;
        traj.at(s, st);
        solveAt(st.p, st.n);
        world.arm.setLed(!!st.contact);
        paintLook(s, !!st.contact);
        api.pathDraw = traj.total;
      } else {
        const k = easeInOutSine(Math.min(1, (scanT - scanEnd) / retractT));
        _end.copy(last.p).addScaledVector(last.n, 0.09);
        _p.copy(last.p).lerp(_end, k);
        solveAt(_p, last.n);
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

  api.zone = zone;
  api.setMobile = setMobile;
  api.frame = frame;
  api.shoot = shoot;
  api.selectPart = selectPart;
  api.setPreset = setPreset;
  api.compute = compute;
  return api;
}
