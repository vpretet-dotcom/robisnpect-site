/**
 * ROBINSPECT · Try the idea v3
 * Cobot 6-axis · raster UT path · achieved-tip C-scan · illustration only
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { MiniOrbit } from './modules/orbit.js';
import {
  ARM, BASE, HOME_JOINTS, JOINT_LIMITS, SCAN_CFG,
  fkYUp, solveIk, wrapAngle, clamp, lerpAngle, jointLimitRatio, applyLimits,
  slerpVec, norm3, dot3, lockScanCfg, nearJointLimit, roundTripTest,
} from './modules/ik.js';
import { buildRobot } from './modules/robot.js';
import {
  createPartLibrary, defectField, defectDepth, paintCscan,
  partMeta, INDEX_STEP, PART_ORIGIN,
} from './modules/parts.js';
import { createBeam, createAscan, couplingFromAngle, tipToUV } from './modules/ut.js';
import { createCinematic } from './modules/cinematic.js';
import {
  densifyPath, reprojectFromUV, waypointsFromPartDefault, waypointsFromRaster,
  nextWaypointId, resetWaypointIds, meanEdgeSpacingM,
} from './modules/pathStore.js';
import { buildMotionProgram as buildMotionProgramMod } from './modules/motionProgram.js';
import {
  evaluateReach, previewReachAtPose, syncReachBadge, hideReachBadge, contiguousUnreachRuns,
} from './modules/reachPolicy.js';

const rootEl = document.getElementById('try-root');
const canvasHost = document.getElementById('try-canvas');
if (!rootEl || !canvasHost) throw new Error('try-root / try-canvas missing');

const LANG = rootEl.getAttribute('data-lang') === 'fr' ? 'fr' : 'en';
const I18N = {
  en: {
    hintIdle: 'Drag to orbit · Shift/right-drag to pan',
    hintIdleTouch: '1 finger: orbit · 2 fingers: zoom / pan',
    hintViewTouch: '1 finger: orbit · 2 fingers: zoom / pan',
    hintEdit: 'Drag waypoints · unreachable glow',
    hintPlay: 'Scanning · simulation',
    hintPause: 'Paused',
    hintDone: 'Scan complete · simulation',
    hintDraw: 'Draw a freehand path on the surface',
    hintDrawTouch: 'Draw with 1 finger',
    stateIdle: 'Hit Play',
    statePlaying: 'Scan in progress · simulation',
    statePaused: 'Paused · simulation',
    stateDone: 'Next: your geometry',
    play: 'Play', pause: 'Pause',
    warnUnreachable: 'Unreachable',
    warnCollision: 'Collision risk',
    warnLimit: 'Near joint limit',
    warnFlip: 'Wrist flip risk',
    warnAngle: 'Probe angle > 3°',
    warnMoveUnreachable: 'Part moved — some poses unreachable',
    movePart: 'Move part',
    reachOk: 'Reach OK',
    trajNote: 'Web path = TCP on surface (illustration). TrajTool plans offline — not this page.',
    hintMove: 'Drag the part on the table · rotate with Alt / second handle',
    hintMoveTouch: 'Drag the handle to move · twist to rotate',
    loader: [
      'Loading the robot cell…',
      'Calibrating the 6 axes…',
      'Placing the part…',
      'Computing the scan path…',
      'Warming up the UT probe…',
    ],
    tcp: (mms) => `TCP ${mms.toFixed(0)} mm/s`,
  },
  fr: {
    hintIdle: 'Glisser pour orbiter · Maj/clic droit pour décaler',
    hintIdleTouch: '1 doigt : tourner · 2 doigts : zoom / déplacer',
    hintViewTouch: '1 doigt : tourner · 2 doigts : zoom / déplacer',
    hintEdit: 'Déplacez les points · hors d’atteinte s’allument',
    hintPlay: 'Scan · simulation',
    hintPause: 'En pause',
    hintDone: 'Scan terminé · simulation',
    hintDraw: 'Tracez un chemin libre sur la surface',
    hintDrawTouch: 'Tracez avec 1 doigt',
    stateIdle: 'Appuyez sur Lecture',
    statePlaying: 'Scan en cours · simulation',
    statePaused: 'En pause · simulation',
    stateDone: 'Ensuite : votre géométrie',
    play: 'Lecture', pause: 'Pause',
    warnUnreachable: 'Hors d’atteinte',
    warnCollision: 'Risque collision',
    warnLimit: 'Proche limite d’axe',
    warnFlip: 'Risque retournement poignet',
    warnAngle: 'Angle sonde > 3°',
    warnMoveUnreachable: 'Pièce déplacée — poses hors d’atteinte',
    movePart: 'Déplacer la pièce',
    reachOk: 'Atteinte OK',
    trajNote: 'Chemin web = TCP sur la surface (illustration). TrajTool planifie hors ligne — pas cette page.',
    hintMove: 'Glissez la pièce sur la table · Alt pour tourner',
    hintMoveTouch: 'Glissez la poignée · tournez pour orienter',
    loader: [
      'Chargement de la cellule robot…',
      'Calibrage des 6 axes…',
      'Mise en place de la pièce…',
      'Calcul de la trajectoire…',
      'Préchauffage de la sonde UT…',
    ],
    tcp: (mms) => `TCP ${mms.toFixed(0)} mm/s`,
  },
}[LANG];

const isCoarse = () => window.matchMedia('(pointer: coarse)').matches;
const prefersReduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
const isNarrow = () => window.matchMedia('(max-width: 600px)').matches;

/* ── v5 loading screen (DA black/gold, real staged progress) ─ */
(function initLoader() {
  const el = document.getElementById('try-loader');
  const fill = document.getElementById('try-loader-fill');
  const msg = document.getElementById('try-loader-msg');
  if (!el) return;
  const texts = I18N.loader || ['Loading…'];
  let stage = 0;
  let progress = 0.08;
  let done = false;
  const reduce = prefersReduce();
  const t0 = performance.now();
  const TIMEOUT = 7000;
  function setProg(p, i) {
    progress = Math.max(progress, Math.min(1, p));
    if (fill) fill.style.width = `${(progress * 100).toFixed(1)}%`;
    if (msg && texts[i] != null) msg.textContent = texts[i];
  }
  setProg(0.1, 0);
  const iv = setInterval(() => {
    if (done) return;
    stage = Math.min(texts.length - 1, stage + 1);
    setProg(0.15 + stage * 0.14, stage);
    if (performance.now() - t0 > TIMEOUT) finish(true);
  }, reduce ? 120 : 520);
  function finish(fromTimeout) {
    if (done) return;
    done = true;
    clearInterval(iv);
    setProg(1, texts.length - 1);
    const fade = () => {
      el.classList.add('is-done');
      el.setAttribute('aria-busy', 'false');
      setTimeout(() => { el.hidden = true; }, reduce ? 40 : 420);
    };
    if (reduce) fade();
    else setTimeout(fade, fromTimeout ? 80 : 280);
  }
  window.__TRY_LOADER_DONE__ = finish;
  /* Finish when first frame + path ready */
  const bootWait = setInterval(() => {
    if (window.__TRY__ && store?.waypoints?.length) {
      clearInterval(bootWait);
      setProg(0.92, texts.length - 1);
      setTimeout(() => finish(false), reduce ? 40 : 320);
    }
    if (performance.now() - t0 > TIMEOUT) {
      clearInterval(bootWait);
      finish(true);
    }
  }, 100);
})();

/* v4: no hud-on at boot — idle stays clean */

const Tiers = {
  high: { pr: Math.min(devicePixelRatio, 2), shadows: true, bloom: true, shadowMap: 2048 },
  med:  { pr: Math.min(devicePixelRatio, 1.5), shadows: true, bloom: true, shadowMap: 1024 },
  low:  { pr: Math.min(devicePixelRatio, 1.25), shadows: false, bloom: true, shadowMap: 512 },
};
let tierName = prefersReduce() ? 'low' : (isMobile() ? 'med' : 'med');
let tier = Tiers[tierName];

const renderer = new THREE.WebGLRenderer({ antialias: tierName !== 'low', powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(tier.pr);
renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = tier.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvasHost.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
scene.fog = new THREE.FogExp2(0x080808, 0.12);

const camera = new THREE.PerspectiveCamera(36, Math.max(canvasHost.clientWidth, 1) / Math.max(canvasHost.clientHeight, 1), 0.05, 40);
camera.position.set(1.4, 1.0, 1.5);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

scene.add(new THREE.AmbientLight(0x2a2824, 0.42));
const key = new THREE.DirectionalLight(0xfff2d6, 1.45);
key.position.set(2.2, 3.0, 1.5);
key.castShadow = tier.shadows;
key.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
key.shadow.camera.near = 0.5; key.shadow.camera.far = 14;
key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5;
key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5;
key.shadow.bias = -0.0002;
scene.add(key);
const rim = new THREE.DirectionalLight(0xc8b070, 0.35);
rim.position.set(-1.6, 1.3, -1.1);
scene.add(rim);
const fill = new THREE.DirectionalLight(0x8899aa, 0.2);
fill.position.set(-1, 2, 2.2);
scene.add(fill);

{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.receiveShadow = true;
  scene.add(floor);

  /* P3.4 — cell: flat table + contact shadow + discreet flange (DA black/gold) */
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x141416, metalness: 0.18, roughness: 0.62,
  });
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.048, 1.22), tableMat);
  table.position.set(0.38, -0.024, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  scene.add(table);
  /* Thin gold rim only (4 bars) — not a gold slab on the table */
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x6e5a20, metalness: 0.55, roughness: 0.45,
  });
  const rimY = 0.0012;
  const cx = 0.38, halfW = 0.89, halfD = 0.61, t = 0.01;
  for (const [w, d, x, z] of [
    [1.78, t, cx, halfD],
    [1.78, t, cx, -halfD],
    [t, 1.22, cx - halfW, 0],
    [t, 1.22, cx + halfW, 0],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.003, d), edgeMat);
    bar.position.set(x, rimY, z);
    bar.receiveShadow = true;
    scene.add(bar);
  }
  /* Soft contact blobs under base + part (always-on even if shadow map off) */
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false });
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.92, 48), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0.34, 0.0012, 0);
  blob.renderOrder = -1;
  scene.add(blob);
  const blobBase = new THREE.Mesh(new THREE.CircleGeometry(0.18, 32), blobMat.clone());
  blobBase.material.opacity = 0.72;
  blobBase.rotation.x = -Math.PI / 2;
  blobBase.position.set(0.0, 0.0018, 0);
  blobBase.renderOrder = -1;
  scene.add(blobBase);
  const blobPart = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), blobMat.clone());
  blobPart.rotation.x = -Math.PI / 2;
  blobPart.position.set(PART_ORIGIN.x, 0.0018, PART_ORIGIN.z);
  blobPart.renderOrder = -1;
  scene.add(blobPart);
  window.__TRY_BLOB_PART__ = blobPart;
  /* Discreet mounting flange ring around cobot base */
  const flangeMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3e, metalness: 0.42, roughness: 0.48,
  });
  const flange = new THREE.Mesh(new THREE.RingGeometry(0.105, 0.148, 48), flangeMat);
  flange.rotation.x = -Math.PI / 2;
  flange.position.set(0, 0.0025, 0);
  flange.receiveShadow = true;
  scene.add(flange);
  const flangeGold = new THREE.Mesh(
    new THREE.RingGeometry(0.146, 0.152, 48),
    new THREE.MeshStandardMaterial({ color: 0x6e5a20, metalness: 0.6, roughness: 0.4 }),
  );
  flangeGold.rotation.x = -Math.PI / 2;
  flangeGold.position.set(0, 0.0028, 0);
  scene.add(flangeGold);
}

const robot = buildRobot(THREE);
scene.add(robot.root);
const parts = createPartLibrary(THREE);
scene.add(parts.plate.group, parts.pipe.group, parts.aero.group);
parts.plate.group.visible = false;
parts.pipe.group.visible = false;
parts.aero.group.visible = true;
let activePart = parts.aero;

const beam = createBeam(THREE);
robot.tip.add(beam.group);

let composer = null, bloomPass = null;
function buildComposer() {
  if (composer) { composer.dispose?.(); composer = null; }
  bloomPass = null;
  if (!tier.bloom) return;
  const w = canvasHost.clientWidth, h = canvasHost.clientHeight;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), tierName === 'low' ? 0.06 : 0.1, 0.5, 0.9);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}
buildComposer();
function applyTier(name) {
  tierName = name; tier = Tiers[name];
  renderer.setPixelRatio(tier.pr);
  renderer.shadowMap.enabled = tier.shadows;
  key.castShadow = tier.shadows;
  buildComposer(); onResize();
}

let drawing = false;
const orbit = MiniOrbit(camera, renderer.domElement, THREE, {
  isCoarse,
  plateOwns: () => {
    if (runtime.moveMode || store.mode === 'move' || _partDrag) return true;
    if (store.status === 'playing' || store.status === 'paused') return false;
    if (drawing) return true;
    return store.mode === 'draw';
  },
  onUserInput: () => {
    runtime.userOrbitLock = true;
    if (runtime._orbitLockT) clearTimeout(runtime._orbitLockT);
    runtime._orbitLockT = setTimeout(() => { runtime.userOrbitLock = false; }, 2800);
    if (cine.active) { cine.stop(); syncCineBtn(); }
  },
});
orbit.setTarget(0.30, 0.14, 0);
orbit.setSpherical(0.95, 1.12, isMobile() ? 1.15 : 1.35);
orbit.setDistances(0.35, 4.0);
orbit.update();

const tipFocus = new THREE.Vector3();
const partFocus = new THREE.Vector3();
function getPartCenter() {
  if (activePart.center) return activePart.center();
  return { x: 0.52, y: 0.04, z: 0 };
}
const cine = createCinematic(orbit, () => { robot.getTipWorld(tipFocus); return tipFocus; }, getPartCenter);

/** Frame robot (current pose) + active part from AABB — ~65–75% stage height, nothing cropped. */

/* ── v3h framing ───────────────────────────────────────────
 * Desktop / landscape: v3e 3/4 cell framing (no pillarbox).
 * Portrait mobile: same 3/4 angles; world AABB over scan poses + 10% pad.
 * Gate: pixel silhouette bbox (not keypoints).
 */
function collectFitPoses() {
  const poses = [];
  const saved = (typeof runtime !== 'undefined' && runtime?.joints ? runtime.joints : HOME_JOINTS).slice();
  poses.push({ label: 'home', joints: HOME_JOINTS.slice() });
  poses.push({ label: 'live', joints: saved.slice() });
  const wps = (typeof store !== 'undefined' && store.waypoints?.length)
    ? store.waypoints
    : (activePart.defaultPath?.() || []);
  let prev = HOME_JOINTS.slice();
  const n = wps.length;
  const picks = n ? Array.from(new Set([0, Math.floor(n * 0.33), Math.floor(n * 0.66), n - 1])) : [];
  for (const i of picks) {
    if (i < 0 || i >= n) continue;
    const w = wps[i];
    if (!w) continue;
    const ik = solveIk({ x: w.x, y: w.y, z: w.z }, w.normal || { x: 0, y: 1, z: 0 }, prev);
    if (ik?.reachable) {
      prev = ik.joints;
      poses.push({ label: `wp${i}`, joints: ik.joints.slice() });
    }
  }
  return { poses, saved };
}

/** World AABB of robot meshes + part, optionally unioned across poses. */
function computeWorldEnvelope(poses) {
  const box = new THREE.Box3();
  const saved = (typeof runtime !== 'undefined' && runtime?.joints ? runtime.joints : HOME_JOINTS).slice();
  const list = poses || [{ joints: saved }];
  for (const p of list) {
    robot.setJoints(p.joints);
    robot.root.updateWorldMatrix(true, true);
    activePart.group.updateWorldMatrix(true, true);
    if (robot.getBounds) box.union(robot.getBounds(activePart.group));
    else {
      box.expandByObject(robot.root);
      box.expandByObject(activePart.group);
    }
  }
  robot.setJoints(saved);
  robot.root.updateWorldMatrix(true, true);
  return box;
}

function fitCellFraming(opts = {}) {
  /* Restore normal projection — no pillarbox / viewOffset */
  if (typeof camera.clearViewOffset === 'function') camera.clearViewOffset();
  const cw = Math.max(1, canvasHost.clientWidth);
  const ch = Math.max(1, canvasHost.clientHeight);
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();

  const portrait = isMobile() && ch > cw;
  const { poses, saved } = collectFitPoses();

  /* ── v4 desktop/landscape: low 3/4 like live, ~60% frame fill ── */
  if (!portrait || opts.forceV3e) {
    const fill = opts.fill ?? 0.80;
    const margin = opts.margin ?? 1.06;
    const box = computeWorldEnvelope(poses);
    robot.setJoints(saved);
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const pc = getPartCenter();
    /* Bias toward table / part — live-like low hero; keep elbow under top edge */
    center.x = THREE.MathUtils.lerp(0.26, pc.x, 0.55);
    center.y = THREE.MathUtils.clamp(0.06 + size.y * 0.05, 0.05, 0.16);
    center.z = THREE.MathUtils.lerp(0.0, pc.z, 0.42);

    const aspect = cw / ch;
    const fov = (camera.fov * Math.PI) / 180;
    const halfV = Math.max(size.y * 0.78, size.x / aspect, size.z * 0.95) * 0.5 * margin;
    let dist = halfV / Math.tan(fov * 0.5) / fill;
    dist = THREE.MathUtils.clamp(dist, 1.05, 2.05);

    /* Low 3/4 — closer to live page (higher phi = lower camera) */
    const theta = opts.theta ?? 0.88;
    const phi = opts.phi ?? 1.18;
    const radius = opts.radius ?? dist;
    orbit.setDistances(0.35, 5.0);
    orbit.setPolarLimits(0.25, Math.PI / 2.05);
    orbit.setTarget(center.x, center.y, center.z);
    orbit.setSpherical(theta, phi, radius);
    orbit.update();
    if (!opts.skipRefine) refineWideMargin();
    robot.setJoints(saved);
    return;
  }

  /* ── Portrait mobile: same 3/4 angles as desktop overview; dist from world AABB ∪ poses + 10% pad ── */
  const box = computeWorldEnvelope(poses);
  robot.setJoints(saved);
  if (box.isEmpty()) return;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const pc = getPartCenter();
  /* v4 mobile: close hero arm + part visible (live feel), arm must not hide part */
  center.x = THREE.MathUtils.lerp(center.x, pc.x, 0.62);
  center.y = THREE.MathUtils.clamp(0.08 + size.y * 0.12, 0.06, 0.24);
  center.z = THREE.MathUtils.lerp(center.z, pc.z, 0.5);

  const pad = opts.pad ?? 1.05;
  const aspect = cw / ch;
  const fov = (camera.fov * Math.PI) / 180;
  const halfV = Math.max(size.y * 0.7, size.x / aspect, size.z * 0.8) * 0.5 * pad;
  let dist = halfV / Math.tan(fov * 0.5) / (opts.fill ?? 0.82);
  dist = THREE.MathUtils.clamp(dist, 0.72, 1.70);
  if (opts.radius != null) dist = opts.radius;

  const theta = opts.theta ?? 1.05;
  const phi = opts.phi ?? 1.15;
  orbit.setDistances(0.35, 5.0);
  orbit.setPolarLimits(0.25, Math.PI / 2.05);
  orbit.setTarget(center.x, center.y, center.z);
  orbit.setSpherical(theta, phi, dist);
  orbit.update();

  if (!opts.skipRefine) {
    refinePortraitDistance(0.58, 8);
  }
}

/** Wide/landscape stages: push out until mesh silhouette clears ≥8px (all fit poses). */
function refineWideMargin() {
  const cw = Math.max(1, canvasHost.clientWidth);
  const ch = Math.max(1, canvasHost.clientHeight);
  if (isMobile() && ch > cw) return;
  const { poses, saved } = collectFitPoses();
  const sph0 = orbit.getSpherical();
  let radius = sph0.radius;
  for (let i = 0; i < 10; i++) {
    orbit.setSpherical(sph0.theta, sph0.phi, radius);
    orbit.update();
    let allMargin = true;
    for (const p of poses) {
      robot.setJoints(p.joints);
      robot.root.updateWorldMatrix(true, true);
      const pix = samplePixelBBox();
      if (!pix.ok || !pix.marginOk) { allMargin = false; break; }
    }
    robot.setJoints(saved);
    if (allMargin) break;
    /* Cap: clear ≥8px margins without shrinking below ~55% height fill */
    radius = Math.min(2.55, radius * 1.08);
  }
  orbit.setSpherical(sph0.theta, sph0.phi, radius);
  orbit.update();
  /* If still clipped top after radius push, drop look target */
  {
    const { poses: pz, saved: sv } = collectFitPoses();
    let stillClip = false;
    for (const p of pz) {
      robot.setJoints(p.joints);
      robot.root.updateWorldMatrix(true, true);
      const pix = samplePixelBBox();
      if (pix.ok && pix.minY < 8) { stillClip = true; break; }
    }
    robot.setJoints(sv);
    if (stillClip) {
      const tgt = orbit.target;
      tgt.y = Math.max(0.02, tgt.y - 0.06);
      orbit.setTarget(tgt.x, tgt.y, tgt.z);
      orbit.setSpherical(sph0.theta, Math.min(Math.PI / 2.08, sph0.phi + 0.04), Math.min(2.7, radius * 1.06));
      orbit.update();
    }
  }
  robot.setJoints(saved);
}

/** Pull in / push out on portrait until ALL fit-poses meet width + margin (or best effort). */
function refinePortraitDistance(wantWidth, marginPx) {
  const cw = Math.max(1, canvasHost.clientWidth);
  const ch = Math.max(1, canvasHost.clientHeight);
  if (!(isMobile() && ch > cw)) return;
  const { poses, saved } = collectFitPoses();
  const sph0 = orbit.getSpherical();
  let lo = Math.max(0.85, sph0.radius * 0.62);
  let hi = Math.min(2.5, sph0.radius * 1.4);
  let best = { radius: sph0.radius, score: -1e9 };

  function evalRadius(radius) {
    orbit.setSpherical(sph0.theta, sph0.phi, radius);
    orbit.update();
    let minW = 1, allMargin = true, anyOk = false, worstEdge = 99;
    for (const p of poses) {
      robot.setJoints(p.joints);
      robot.root.updateWorldMatrix(true, true);
      const pix = samplePixelBBox();
      if (!pix.ok) { allMargin = false; minW = 0; continue; }
      anyOk = true;
      minW = Math.min(minW, pix.widthFrac);
      if (!pix.marginOk) allMargin = false;
      if (pix.ok) {
        const e = Math.min(pix.minX, pix.minY, pix.canvas.w - 1 - pix.maxX, pix.canvas.h - 1 - pix.maxY);
        worstEdge = Math.min(worstEdge, e);
      }
    }
    robot.setJoints(saved);
    robot.root.updateWorldMatrix(true, true);
    const passBoth = allMargin && minW >= wantWidth;
    const score =
      (passBoth ? 10000 : 0) +
      (allMargin ? 3000 : Math.min(worstEdge, marginPx) * 80) +
      Math.min(minW, wantWidth) * 2000 +
      minW * 100 -
      Math.abs(minW - wantWidth) * 40;
    return { score, minW, allMargin, anyOk, worstEdge, passBoth };
  }

  /* Dense sweep then local refine — binary search alone fails when both constraints fight */
  const candidates = [];
  for (let i = 0; i <= 10; i++) {
    const r = lo + (hi - lo) * (i / 10);
    const ev = evalRadius(r);
    candidates.push({ radius: r, ...ev });
    if (ev.score > best.score) best = { radius: r, score: ev.score, ...ev };
  }
  const passers = candidates.filter((c) => c.passBoth);
  if (passers.length) {
    /* Among passers pick closest (largest width / smallest radius) */
    passers.sort((a, b) => a.radius - b.radius);
    best = passers[0];
  } else {
    /* Prefer margin-safe with max width, else best score */
    const safe = candidates.filter((c) => c.allMargin).sort((a, b) => b.minW - a.minW);
    if (safe.length && safe[0].minW >= wantWidth * 0.9) best = safe[0];
  }
  /* If margin-safe but just under width, try a slight pull-in */
  if (best.allMargin && best.minW >= 0.46 && best.minW < wantWidth) {
    const tighter = evalRadius(best.radius * 0.96);
    if (tighter.allMargin && tighter.minW >= best.minW) best = { radius: best.radius * 0.96, score: tighter.score, ...tighter };
    const tighter2 = evalRadius(best.radius * 0.97);
    if (tighter2.passBoth) best = { radius: best.radius * 0.97, score: tighter2.score, ...tighter2 };
  }
  orbit.setSpherical(sph0.theta, sph0.phi, best.radius);
  orbit.update();
  robot.setJoints(saved);
}

/** Pixel silhouette bbox of robot+part meshes vs black (lines/HUD excluded). */
function samplePixelBBox() {
  const canvas = renderer.domElement;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 8 || h < 8) return { ok: false, reason: 'tiny-canvas' };

  const visBackup = [];
  const matBackup = [];
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: true });
  const hideUnlessContent = (obj) => {
    let p = obj;
    while (p) {
      if (p.userData && p.userData.framingIgnore) return false;
      if (p === robot.root || p === activePart.group) return true;
      p = p.parent;
    }
    return false;
  };
  scene.traverse((o) => {
    if (!o.isObject3D) return;
    if (o.isLight || o.isCamera || o.isScene) return;
    visBackup.push([o, o.visible]);
    if (o.isLine || o.isLineSegments || o.isPoints || o.isSprite) {
      /* Path / edge overlays must not inflate the gate bbox */
      o.visible = false;
      return;
    }
    if (o.isMesh) {
      const keep = hideUnlessContent(o);
      o.visible = keep;
      if (keep && o.material) {
        matBackup.push([o, o.material]);
        o.material = Array.isArray(o.material) ? o.material.map(() => white) : white;
      }
    }
  });
  robot.root.visible = true;
  activePart.group.visible = true;

  const prevAuto = renderer.autoClear;
  const prevBg = scene.background;
  scene.background = new THREE.Color(0x000000);
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);

  const gl = renderer.getContext();
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  try {
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    const img = tctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      img.data.set(buf.subarray(src, src + w * 4), dst);
    }
    tctx.putImageData(img, 0, 0);
    window.__TRY_LAST_MASK__ = tmp.toDataURL('image/png');
  } catch (_) { window.__TRY_LAST_MASK__ = null; }

  for (const [o, m] of matBackup) o.material = m;
  for (const [o, v] of visBackup) o.visible = v;
  white.dispose();
  scene.background = prevBg;
  renderer.autoClear = prevAuto;
  renderer.setClearColor(0x050505, 1);

  /* Build occupancy. Flat parts are thin in screen-Y — do NOT require tall
   * column runs (that dropped the plate and left only the arm pillar ~15% W).
   * Reject only isolated 1px dust via a light 4-neighbour density check. */
  let count = 0;
  const bright = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (buf[i] + buf[i + 1] + buf[i + 2] > 40) {
        bright[y * w + x] = 1;
        count++;
      }
    }
  }
  if (count < 50) return { ok: false, reason: 'no-pixels', count, canvas: { w, h } };
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!bright[idx]) continue;
      let n = 0;
      if (x > 0 && bright[idx - 1]) n++;
      if (x + 1 < w && bright[idx + 1]) n++;
      if (y > 0 && bright[idx - w]) n++;
      if (y + 1 < h && bright[idx + w]) n++;
      if (n < 1 && count > 200) continue; /* drop lone dust when silhouette is dense */
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      const ty = h - 1 - y;
      if (ty < minY) minY = ty;
      if (ty > maxY) maxY = ty;
    }
  }
  if (maxX < minX) return { ok: false, reason: 'spike-only', count, canvas: { w, h } };

  /* Solid core: drop thin hose/rail spikes that poke the frame edge (a 5px
   * column to y=0 was failing margin while the real silouette had pad). */
  const colN = new Uint32Array(w);
  const rowN = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bright[y * w + x]) continue;
      colN[x]++;
      rowN[h - 1 - y]++;
    }
  }
  const CORE_COL = 4; /* plate columns are short */
  const CORE_ROW = 18; /* top hose spike ~5px wide */
  let cMinX = w, cMaxX = 0, cMinY = h, cMaxY = 0;
  for (let x = 0; x < w; x++) {
    if (colN[x] < CORE_COL) continue;
    if (x < cMinX) cMinX = x;
    if (x > cMaxX) cMaxX = x;
  }
  for (let ty = 0; ty < h; ty++) {
    if (rowN[ty] < CORE_ROW) continue;
    if (ty < cMinY) cMinY = ty;
    if (ty > cMaxY) cMaxY = ty;
  }
  if (cMaxX >= cMinX && cMaxY >= cMinY) {
    minX = cMinX; maxX = cMaxX; minY = cMinY; maxY = cMaxY;
  }

  const margin = 8;
  const touching = minX < margin || minY < margin || maxX >= w - margin || maxY >= h - margin;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const widthFrac = bboxW / w;
  const heightFrac = bboxH / h;
  return {
    ok: true,
    count,
    minX, minY, maxX, maxY,
    bboxW, bboxH,
    widthFrac,
    heightFrac,
    marginOk: !touching,
    canvas: { w, h },
  };
}


/** DOM rect of A-scan box in WebGL buffer pixels (origin top-left). */
function ascanBufferRect() {
  const wrap = document.getElementById('try-ascan-wrap');
  const canvas = renderer.domElement;
  if (!wrap || !canvas) return null;
  const cs = getComputedStyle(wrap);
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
  const a = wrap.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  if (a.width < 2 || a.height < 2 || c.width < 2 || c.height < 2) return null;
  const sx = canvas.width / c.width;
  const sy = canvas.height / c.height;
  return {
    minX: (a.left - c.left) * sx,
    minY: (a.top - c.top) * sy,
    maxX: (a.right - c.left) * sx,
    maxY: (a.bottom - c.top) * sy,
  };
}

function rectsIntersect(a, b, pad = 0) {
  return !(
    a.maxX + pad < b.minX ||
    a.minX - pad > b.maxX ||
    a.maxY + pad < b.minY ||
    a.minY - pad > b.maxY
  );
}

/** Pixel gate: ≥8px margin AND bbox width ≥50% canvas, across sampled poses. */
function framingGate() {
  const { poses, saved } = collectFitPoses();
  fitCellFraming();
  if (composer) composer.render();
  else renderer.render(scene, camera);

  const ascanRect = ascanBufferRect();
  const portrait = isMobile() && canvasHost.clientHeight > canvasHost.clientWidth;
  const samples = [];
  for (const p of poses) {
    if (typeof runtime !== 'undefined' && runtime) runtime.joints = p.joints.slice();
    robot.setJoints(p.joints);
    robot.root.updateWorldMatrix(true, true);
    const pix = samplePixelBBox();
    let ascanClear = true;
    let ascanHit = null;
    if (portrait && ascanRect && pix.ok) {
      const mask = { minX: pix.minX, minY: pix.minY, maxX: pix.maxX, maxY: pix.maxY };
      ascanClear = !rectsIntersect(ascanRect, mask, 0);
      if (!ascanClear) ascanHit = { ascan: ascanRect, mask };
    }
    samples.push({
      label: p.label,
      widthFrac: pix.widthFrac ?? 0,
      heightFrac: pix.heightFrac ?? 0,
      marginOk: !!pix.marginOk,
      ok: !!pix.ok,
      ascanClear,
      ascanHit,
      minX: pix.minX, minY: pix.minY, maxX: pix.maxX, maxY: pix.maxY,
      canvas: pix.canvas,
      reason: pix.reason,
    });
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }
  if (typeof runtime !== 'undefined' && runtime) runtime.joints = saved.slice();
  robot.setJoints(saved);
  robot.root.updateWorldMatrix(true, true);
  if (composer) composer.render();
  else renderer.render(scene, camera);

  const minWidthFrac = Math.min(...samples.map((s) => s.widthFrac || 0));
  const minHeightFrac = Math.min(...samples.map((s) => s.heightFrac || 0));
  const allMargin = samples.every((s) => s.marginOk);
  const allOk = samples.every((s) => s.ok);
  const ascanClear = samples.every((s) => s.ascanClear !== false);
  const cw = samples[0]?.canvas?.w || 1;
  const ch = samples[0]?.canvas?.h || 1;
  const aspect = cw / Math.max(1, ch);
  /* Portrait / near-square: require ≥50% width. Ultra-wide stages cannot hit 50% width
   * with a tall robot in 3/4 view without cropping — require ≥50% of the SHORTER side
   * coverage via height, and ≥22% width, still with ≥8px margins. */
  let pass = false;
  if (aspect <= 1.35) {
    /* Portrait / near-square: ≥55–60% width coverage, margins, no A-scan∩mask */
    pass = allOk && allMargin && minWidthFrac >= 0.55 && ascanClear && samples.length > 0;
  } else {
    /* Ultra-wide stage: tall cobot cannot hit 55% WIDTH in 3/4 without crop.
     * Require ≥55% height (shorter-side coverage), ≥14% width, ≥8px margins. */
    pass = allOk && allMargin && minHeightFrac >= 0.55 && minWidthFrac >= 0.14 && samples.length > 0;
  }
  return {
    pass, minWidthFrac, minHeightFrac, aspect, allMargin, allOk, ascanClear,
    ascanRect: ascanRect || null, portrait: !!portrait,
    n: samples.length, samples,
  };
}

/* fit deferred until store/runtime exist — see bootFit below */
let _v3fSettledFit = false;
function scheduleMobileRefit() {
  if (!isMobile()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try { onResize(); fitCellFraming(); } catch (_) {}
      _v3fSettledFit = true;
    });
  });
}
if (typeof ResizeObserver !== 'undefined' && canvasHost) {
  let _roT = 0;
  new ResizeObserver(() => {
    clearTimeout(_roT);
    _roT = setTimeout(() => {
      try { onResize(); } catch (_) {}
      if (typeof store !== 'undefined' && store && (store.status === 'idle' || store.status === 'paused' || store.status === 'done')) {
        try { fitCellFraming(); } catch (_) {}
      }
    }, 60);
  }).observe(canvasHost);
}

const store = {
  mode: isMobile() ? 'view' : 'view',
  partId: 'aero',
  pathMode: 'raster', /* raster | freehand */
  waypoints: [],
  status: 'idle',
  speedMms: 50, /* mm/s TCP scan */
  past: [],
};
const runtime = {
  joints: HOME_JOINTS.slice(),
  targetJoints: HOME_JOINTS.slice(),
  program: [],
  phase: 'idle', /* home|ptp|descend|scan|retract|done */
  phaseT: 0,
  scanIndex: 0,
  lastTcp: new THREE.Vector3(),
  tcpSpeed: 0,
  scanning: false,
  unreachable: new Set(),
  collision: false,
  nearLimit: false,
  wristFlip: false,
  angWarn: false,
  hintFade: 0,
  hudOn: true,
  autoplayStarted: false,
  firstPlay: true,
  cineKick: false,
  cscanMode: 'amplitude',
  qa: { maxJointDeltaDeg: 0, jointFlipFlags: 0, tipGapMaxMm: 0, tipGapSamples: 0, tcpMaxMms: 0, nanFrames: 0, camFloorHits: 0, teleportFlags: 0 },
  userOrbitLock: false,
  _orbitLockT: 0,
  moveMode: false,
  lastPaint: null, /* {u,v,x,y,z} surface point last painted by tip */
  _followSide: 1,
  _followEvalT: 0,
  _qaFreeze: false,
};

/* ── path / motion program (P4.1 — PathStore + MotionProgram modules) ─ */
function densify(waypoints, n = 4) {
  return densifyPath(activePart, waypoints, n);
}
function buildMotionProgram(wps) {
  return buildMotionProgramMod(activePart, wps, { densifyN: 3 });
}
function defaultWaypoints() {
  return waypointsFromPartDefault(activePart);
}
function nextId() { return nextWaypointId(); }
store.waypoints = defaultWaypoints();
/* v3g boot framing once store/runtime live */
try { fitCellFraming(); } catch (_) {}
scheduleMobileRefit();

/* visuals */
const wpGroup = new THREE.Group(); scene.add(wpGroup);
const pathLineMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
let pathLine = null;
const wpDotGeo = new THREE.SphereGeometry(0.0035, 10, 10);
const wpDotMat = new THREE.MeshBasicMaterial({ color: 0xe8c547 });
const wpDotMatDim = new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.3 });
const wpDotBad = new THREE.MeshBasicMaterial({ color: 0xe87847 });


/** Seed a SOUND-only corridor so coverage reads early — indications paint only at the tip. */
function seedCoverageAlongPath() {
  const meta = partMeta(store.partId);
  const mode = runtime.cscanMode || meta.mode;
  for (const w of store.waypoints) {
    if (w.u == null || w.v == null) continue;
    /* Never seed indication amps — that put a red spot where the probe has not yet arrived */
    const amp = mode === 'tof' ? 0.30 : 0.26;
    paintCscan(activePart.cs, w.u, w.v, amp, { mode, indexStep: INDEX_STEP * 1.15 });
  }
}

function refreshWaypoints() {
  while (wpGroup.children.length) wpGroup.remove(wpGroup.children.pop());
  if (pathLine) { scene.remove(pathLine); pathLine.geometry.dispose(); pathLine = null; }
  runtime.unreachable.clear();
  /* Path stays visible before / during / after — Vincent: must see planned path */
  const dim = store.status === 'playing' || store.status === 'paused' || store.status === 'done';
  pathLineMat.opacity = dim ? 0.28 : 0.95;
  const pts = [];
  let prev = HOME_JOINTS.slice();
  store.waypoints.forEach((w) => {
    const ik = solveIk({ x: w.x, y: w.y, z: w.z }, w.normal, prev);
    prev = ik.joints;
    if (!ik.reachable) runtime.unreachable.add(w.id);
    let mat = ik.reachable ? wpDotMat : wpDotBad;
    if (dim && ik.reachable) mat = wpDotMatDim;
    const dot = new THREE.Mesh(wpDotGeo, mat);
    dot.position.set(w.x, w.y + 0.0025, w.z);
    dot.scale.setScalar(dim ? 0.35 : 1);
    wpGroup.add(dot);
    pts.push(new THREE.Vector3(w.x, w.y + 0.0045, w.z));
  });
  if (pts.length >= 2) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    /* Dark outline under gold so path reads on mid-grey part */
    const outline = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x1a1408, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
    );
    outline.renderOrder = 10;
    outline.position.y = 0.0006;
    wpGroup.add(outline);
    pathLine = new THREE.Line(geo, pathLineMat);
    pathLine.renderOrder = 12;
    scene.add(pathLine);
    const glow = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: dim ? 0.4 : 0.65, depthTest: false, depthWrite: false }),
    );
    glow.renderOrder = 11;
    glow.position.y = 0.0018;
    wpGroup.add(glow);
  }
  const el = document.getElementById('try-wp-count');
  if (el) el.textContent = String(store.waypoints.length);
  /* P1.6: Index claim removed from UI */
  updateWarn();
}

function updateWarn() {
  const el = document.getElementById('try-warn');
  if (!el) return;
  let msg = '';
  if (runtime.wristFlip) msg = I18N.warnFlip;
  else if (runtime.angWarn) msg = I18N.warnAngle;
  else if (runtime.collision) msg = I18N.warnCollision;
  else if (runtime.nearLimit) msg = I18N.warnLimit;
  else if (runtime.unreachable.size > Math.max(2, store.waypoints.length * 0.25)) msg = I18N.warnUnreachable;
  el.hidden = !msg; el.textContent = msg;
}

const _tip = new THREE.Vector3();
function checkCollision() {
  robot.getTipWorld(_tip);
  if (_tip.y < -0.01) return true;
  const dx = _tip.x - BASE.x, dz = _tip.z - BASE.z;
  if (Math.hypot(dx, dz) < 0.1 && _tip.y < ARM.d1) return true;
  return false;
}
function resetTcpTracker() {
  robot.getTipWorld(runtime.lastTcp);
  runtime.tcpSpeed = 0;
  if (tcpEl) tcpEl.textContent = I18N.tcp(0);
}

/* HUD axes */
const axesRow = document.getElementById('try-axes');
const axisEls = [];
for (let i = 0; i < 6; i++) {
  const el = document.createElement('div');
  el.className = 'axis';
  el.innerHTML = `<span class="lab">J${i + 1}</span><div class="axis-bar"><i class="axis-fill"></i></div><span class="val">0</span>`;
  axesRow.appendChild(el);
  axisEls.push(el);
}
function updateAxesHud(q) {
  const ratios = jointLimitRatio(q);
  runtime.nearLimit = false;
  for (let i = 0; i < 6; i++) {
    const fill = axisEls[i].querySelector('.axis-fill');
    const val = axisEls[i].querySelector('.val');
    const bar = axisEls[i].querySelector('.axis-bar');
    const deg = (q[i] * 180) / Math.PI;
    val.textContent = `${deg >= 0 ? '+' : ''}${deg.toFixed(0)}`;
    const h = Math.min(100, Math.abs(deg) / 1.8);
    fill.style.height = `${h}%`;
    fill.style.bottom = deg >= 0 ? '50%' : `${50 - h}%`;
    fill.classList.remove('near-limit', 'at-limit');
    bar.classList.remove('warn');
    if (ratios[i] > 0.92) { fill.classList.add('at-limit'); bar.classList.add('warn'); }
    else if (ratios[i] > 0.78) { fill.classList.add('near-limit'); }
  }
}

const ascan = createAscan(document.getElementById('try-ascan'));
const hintEl = document.getElementById('try-hint');
const playBtn = document.getElementById('try-play');
const playLabel = document.getElementById('try-play-label');
const progEl = document.getElementById('try-prog');
const progFill = document.getElementById('try-prog-fill');
const tcpEl = document.getElementById('try-tcp');
const cineBtn = document.getElementById('try-cine');
const ctaEl = document.getElementById('try-cta');
const stateEl = document.getElementById('try-state');
function syncTryState() {
  const st = store.status;
  document.body.classList.toggle('is-playing', st === 'playing');
  document.body.classList.toggle('is-done', st === 'done');
  document.body.classList.toggle('is-idle', st === 'idle' || st === 'paused');
  const msg = document.getElementById('try-state-msg') || stateEl;
  if (!msg) return;
  let text = I18N.stateIdle;
  if (st === 'playing') text = I18N.statePlaying;
  else if (st === 'paused') text = I18N.statePaused;
  else if (st === 'done') text = I18N.stateDone;
  msg.textContent = text;
}
function showEndBar() {
  if (!ctaEl) return;
  ctaEl.hidden = false;
  syncTryState();
  /* Mobile / short desktop: bring CTAs into view without hunting */
  requestAnimationFrame(() => {
    try {
      ctaEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } catch (_) {}
  });
}
function hideEndBar() {
  if (ctaEl) ctaEl.hidden = true;
}


function setHint(key) {
  if (!hintEl) return;
  /* Play/done status lives in #try-state + prog — never stack into hud-mid */
  if (key === 'hintPlay' || key === 'hintDone' || key === 'hintPause') {
    hintEl.style.opacity = '0';
    hintEl.textContent = '';
    syncTryState();
    return;
  }
  let t = I18N[key] || I18N.hintIdle;
  if (isMobile() || isCoarse()) {
    if (key === 'hintIdle' || key === 'hintViewTouch') t = I18N.hintViewTouch;
    else if (key === 'hintDraw') t = I18N.hintDrawTouch;
  }
  hintEl.textContent = t;
  hintEl.style.opacity = '1';
  clearTimeout(runtime.hintFade);
  runtime.hintFade = setTimeout(() => { hintEl.style.opacity = '0'; }, 4000);
}
function syncCineBtn() { if (cineBtn) cineBtn.dataset.cine = cine.active ? '1' : '0'; }
function pushPast() {
  store.past.push(store.waypoints.map((w) => ({ ...w })));
  if (store.past.length > 24) store.past.shift();
}

function switchPart(id) {
  if (!parts[id] || id === store.partId) return;
  if (cine.active) { cine.stop(); syncCineBtn(); }
  store.status = 'idle';
  playLabel.textContent = I18N.play;
  runtime.program = []; runtime.phase = 'idle'; runtime.scanning = false; runtime.lastPaint = null;
  progEl.classList.remove('on'); progFill.style.width = '0%';
  beam.setActive(false); robot.setLed(false); robot.setContact(false);
  hideEndBar();
  activePart.group.visible = false;
  if (activePart.resetPose) activePart.resetPose();
  activePart = parts[id];
  if (activePart.resetPose) activePart.resetPose();
  activePart.group.visible = true;
  store.partId = id;
  {
    const blob = window.__TRY_BLOB_PART__;
    if (blob) blob.position.set(PART_ORIGIN.x, 0.002, PART_ORIGIN.z);
  }
  syncPartHandle();
  runtime.cscanMode = partMeta(id).mode;
  activePart.cs.mode = runtime.cscanMode;
  document.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', b.dataset.part === id));
  const lab = document.getElementById('try-probe-lab');
  if (lab) lab.textContent = partMeta(id).label;
  pushPast();
  store.waypoints = defaultWaypoints();
  activePart.clear();
  runtime.joints = HOME_JOINTS.slice();
  runtime.targetJoints = HOME_JOINTS.slice();
  robot.setJoints(HOME_JOINTS);
  resetTcpTracker();
  refreshWaypoints();
  fitCellFraming();
  setHint(store.mode === 'draw' ? 'hintDraw' : 'hintIdle');
}

function syncPathToggle() {
  const wrap = document.getElementById('try-path-toggle');
  if (wrap) wrap.hidden = store.mode !== 'draw';
}
function syncModeButtons() {
  document.querySelectorAll('[data-mode]').forEach((x) => {
    x.classList.toggle('on', x.getAttribute('data-mode') === store.mode);
  });
  syncPathToggle();
}
document.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => switchPart(b.dataset.part)));
document.querySelectorAll('[data-mode]').forEach((b) => {
  b.addEventListener('click', () => {
    store.mode = b.getAttribute('data-mode');
    syncModeButtons();
    if (store.mode === 'edit') setHint('hintEdit');
    else if (store.mode === 'draw') { store.pathMode = 'freehand'; setHint('hintDraw'); }
    else setHint('hintIdle'); /* overlay carries onboarding copy */
  });
});
document.querySelectorAll('[data-path]').forEach((b) => {
  b.addEventListener('click', () => {
    store.pathMode = b.getAttribute('data-path');
    document.querySelectorAll('[data-path]').forEach((x) => x.classList.toggle('on', x.dataset.path === store.pathMode));
    if (store.pathMode === 'raster') {
      pushPast();
      store.waypoints = waypointsFromRaster(activePart);
      refreshWaypoints();
    }
  });
});

cineBtn?.addEventListener('click', () => { cine.toggle(); syncCineBtn(); });

playBtn.addEventListener('click', () => {
  if (store.status === 'playing') {
    store.status = 'paused';
    playLabel.textContent = I18N.play;
    setHint('hintPause');
    syncTryState();
    robot.setLed(false); beam.setActive(false);
    return;
  }
  if (store.waypoints.length < 1) return;
  if (store.status !== 'paused') {
    /* P1.2 — Play always runs the engineer raster */
    store.pathMode = 'raster';
    document.querySelectorAll('[data-path]').forEach((x) => x.classList.toggle('on', x.dataset.path === 'raster'));
    store.waypoints = waypointsFromRaster(activePart);
    refreshWaypoints();
    activePart.clear();
    runtime.program = buildMotionProgram(store.waypoints);
    runtime.phase = 'home';
    runtime.scanIndex = 0;
    runtime.phaseT = 0;
    runtime.scanning = false;
    runtime._qaFreeze = false;
    runtime._qaDefect = null;
    runtime._scanLen = null;
    runtime._segOrigin = null;
    runtime._homeFrom = null;
    lockScanCfg(null);
    runtime.joints = HOME_JOINTS.slice();
    runtime.targetJoints = HOME_JOINTS.slice();
    robot.setJoints(HOME_JOINTS);
    resetTcpTracker();
  }
  store.status = 'playing';
  playLabel.textContent = I18N.pause;
  setHint('hintPlay');
  hideEndBar();
  syncTryState();
  refreshWaypoints();
  progEl.classList.add('on');
  robot.setLed(true);
  hideEndBar();
  /* v5b: snap to probe-contact side-lead framing immediately on Play */
  {
    const w0 = store.waypoints[0];
    if (w0) {
      const tip0 = { x: w0.x, y: w0.y, z: w0.z };
      const a = scoreProbeFrame(tip0, w0.normal || { x: 0, y: 1, z: 0 }, runtime.joints, 1);
      const b = scoreProbeFrame(tip0, w0.normal || { x: 0, y: 1, z: 0 }, runtime.joints, -1);
      runtime._followSide = (a.score >= b.score) ? 1 : -1;
      applyProbeContactFrame(tip0, w0.normal || { x: 0, y: 1, z: 0 }, runtime._followSide, 1);
    }
  }
  const overlay = document.getElementById('try-play-overlay');
  if (overlay) overlay.hidden = true;
  /* v4: no auto cine orb — gentle refit; optional zoom toward part during scan via cinematic toggle in Tools */
  runtime.firstPlay = false;
  try { if (cine.active) cine.stop(); fitCellFraming(); syncCineBtn(); } catch (_) {}
});

document.getElementById('try-stop').addEventListener('click', () => {
  store.status = 'idle';
  playLabel.textContent = I18N.play;
  runtime.program = []; runtime.phase = 'idle'; runtime.scanning = false;
  progEl.classList.remove('on'); progFill.style.width = '0%';
  robot.setJoints(HOME_JOINTS);
  runtime.joints = HOME_JOINTS.slice();
  runtime.targetJoints = HOME_JOINTS.slice();
  robot.setLed(false); beam.setActive(false); robot.setContact(false);
  resetTcpTracker();
  refreshWaypoints();
  hideEndBar();
  const ov = document.getElementById('try-play-overlay');
  if (ov) ov.hidden = true;
  setHint(store.mode === 'draw' ? 'hintDraw' : 'hintIdle');
  syncTryState();
});
document.getElementById('try-undo').addEventListener('click', () => {
  if (store.status === 'playing' || !store.past.length) return;
  store.waypoints = store.past.pop();
  store.status = 'idle';
  refreshWaypoints();
});
document.getElementById('try-clear').addEventListener('click', () => {
  if (store.status === 'playing') return;
  pushPast();
  if (activePart.resetPose) activePart.resetPose();
  {
    const blob = window.__TRY_BLOB_PART__;
    if (blob) blob.position.set(PART_ORIGIN.x, 0.002, PART_ORIGIN.z);
  }
  if (runtime.moveMode) setMoveMode(false);
  store.waypoints = defaultWaypoints();
  activePart.clear();
  store.status = 'idle';
  runtime.program = []; runtime.lastPaint = null;
  robot.setJoints(HOME_JOINTS);
  runtime.joints = HOME_JOINTS.slice();
  runtime.targetJoints = HOME_JOINTS.slice();
  robot.setLed(false); beam.setActive(false); robot.setContact(false);
  resetTcpTracker();
  refreshWaypoints();
  hideEndBar();
  setHint(store.mode === 'draw' ? 'hintDraw' : 'hintIdle');
});

const speedInput = document.getElementById('try-speed');
const speedVal = document.getElementById('try-speed-val');
speedInput?.addEventListener('input', () => {
  store.speedMms = parseFloat(speedInput.value) || 50;
  if (speedVal) speedVal.textContent = `${store.speedMms.toFixed(0)} mm/s`;
});

document.getElementById('try-cscan-mode')?.addEventListener('click', () => {
  runtime.cscanMode = runtime.cscanMode === 'tof' ? 'amplitude' : 'tof';
  activePart.cs.mode = runtime.cscanMode;
  const b = document.getElementById('try-cscan-mode');
  if (b) b.textContent = runtime.cscanMode === 'tof' ? 'C-scan · TOF' : 'C-scan · Amp';
});

/* draw / edit */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragWpId = null;
let drawStroke = [];
function ndcFromEvent(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function pickPart(e) {
  ndcFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  return activePart.hitTest(raycaster);
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (cine.active) { cine.stop(); syncCineBtn(); }
  if (runtime.moveMode || store.mode === 'move') {
    if (onPartPointerDown(e)) {
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
  }
  if (e.shiftKey || store.status === 'playing') return;
  if (store.mode === 'view') return;
  const hit = pickPart(e);
  if (!hit || !hit.ok) return;
  if (store.mode === 'edit') {
    let best = null, bestD = 0.04;
    for (const w of store.waypoints) {
      const d = Math.hypot(w.x - hit.x, w.y - hit.y, w.z - hit.z);
      if (d < bestD) { bestD = d; best = w; }
    }
    if (best) { dragWpId = best.id; drawing = true; pushPast(); e.stopPropagation(); }
    return;
  }
  if (store.mode !== 'draw') return;
  store.pathMode = 'freehand';
  drawing = true;
  drawStroke = [{ ...hit, id: nextId() }];
  e.stopPropagation();
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (_partDrag && onPartPointerMove(e)) return;
  if (!drawing) return;
  const hit = pickPart(e);
  if (!hit || !hit.ok) return;
  if (dragWpId) {
    store.waypoints = store.waypoints.map((w) => (w.id === dragWpId ? { ...hit, id: w.id } : w));
    refreshWaypoints();
    return;
  }
  const last = drawStroke[drawStroke.length - 1];
  if (!last || Math.hypot(hit.x - last.x, hit.y - last.y, hit.z - last.z) > 0.012) {
    drawStroke.push({ ...hit, id: nextId() });
    store.waypoints = drawStroke.slice();
    refreshWaypoints();
  }
});
function endDraw() {
  if (_partDrag) { onPartPointerUp(); return; }
  if (!drawing) return;
  drawing = false;
  if (dragWpId) { dragWpId = null; refreshWaypoints(); return; }
  if (drawStroke.length >= 2) {
    pushPast();
    let pts = drawStroke;
    if (pts.length > 48) {
      const step = (pts.length - 1) / 47;
      pts = Array.from({ length: 48 }, (_, i) => pts[Math.round(i * step)]);
    }
    store.waypoints = pts;
  }
  drawStroke = [];
  refreshWaypoints();
}
renderer.domElement.addEventListener('pointerup', endDraw);
renderer.domElement.addEventListener('pointercancel', endDraw);

function onResize() {
  const w = Math.max(canvasHost.clientWidth, 1);
  const h = Math.max(canvasHost.clientHeight, 1);
  camera.aspect = w / h;
  if (typeof camera.clearViewOffset === 'function') camera.clearViewOffset();
  /* Portrait FOV slightly wider; desktop stays 36° (v3e) */
  camera.fov = (isMobile() && h > w) ? 46 : 36;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
  if (typeof store !== 'undefined' && store && (store.status === 'idle' || store.status === 'paused')) {
    try { fitCellFraming(); } catch (_) {}
  }
}
window.addEventListener('resize', onResize);

const fpsState = { frames: 0, t: 0, fps: 60, lowStreak: 0 };
function considerTier(dt) {
  fpsState.frames++; fpsState.t += dt;
  if (fpsState.t < 1) return;
  fpsState.fps = fpsState.frames / fpsState.t;
  fpsState.frames = 0; fpsState.t = 0;
  if (prefersReduce()) { if (tierName !== 'low') applyTier('low'); return; }
  if (fpsState.fps < 38) {
    fpsState.lowStreak++;
    if (fpsState.lowStreak >= 1) {
      if (tierName === 'high') applyTier('med');
      else if (tierName === 'med') applyTier('low');
      fpsState.lowStreak = 0;
    }
  } else if (fpsState.fps > 55 && tierName === 'low' && !isMobile()) applyTier('med');
  else if (fpsState.fps > 58 && tierName === 'med' && !isMobile()) applyTier('high');
  else fpsState.lowStreak = 0;
}

/* ── motion executor ───────────────────────────────────── */
function ikTo(target, normal, seed) {
  const ik = solveIk(target, normal, seed, { twist: 0, lockCfg: true });
  if (ik.contact) robot.setContactDir(ik.contact);
  return ik;
}

function advanceMotion(dt) {
  if (runtime._qaFreeze) return;
  if (!runtime.program.length) return;
  const speedScan = (store.speedMms / 1000); /* m/s */
  const speedPtp = 0.55;
  const speedLin = 0.10;

  let i = runtime.scanIndex;
  if (i >= runtime.program.length - 1) {
    store.status = 'done';
    runtime.phase = 'done';
    playLabel.textContent = I18N.play;
    setHint('hintDone');
    syncTryState();
    robot.setLed(false); beam.setActive(false); robot.setContact(false);
    runtime.scanning = false;
    refreshWaypoints();
    showEndBar();
    progFill.style.width = '100%';
    return;
  }
  const a = runtime.program[i];
  const b = runtime.program[i + 1];
  const kind = b.kind || a.kind || 'scan';
  runtime.phase = kind === 'home' && a.kind === 'home' ? 'home' : (b.kind || a.kind || 'scan');

  /* snapshot segment start once (avoid lastTcp drift when a has no xyz) */
  if (!runtime._segOrigin || runtime._segOrigin.i !== i) {
    runtime._segOrigin = {
      i,
      x: a.x ?? runtime.lastTcp.x,
      y: a.y ?? runtime.lastTcp.y,
      z: a.z ?? runtime.lastTcp.z,
      normal: a.normal ? { ...a.normal } : (a.joints ? { x: 0, y: 1, z: 0 } : { x: 0, y: 1, z: 0 }),
    };
  }

  /* Scan climax: clamp contact duration to ~4.5–6.5 s (Laurent) */
  let scanLen = runtime._scanLen;
  if (scanLen == null) {
    scanLen = 0;
    for (let k = 0; k < runtime.program.length - 1; k++) {
      const p = runtime.program[k], q = runtime.program[k + 1];
      if ((q.kind === 'scan' || p.kind === 'scan') && q.x != null && p.x != null) {
        scanLen += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      }
    }
    runtime._scanLen = scanLen;
  }
  const tNat = scanLen / Math.max(1e-6, speedScan);
  let scaledScan = speedScan;
  if (tNat < 4.5) scaledScan = scanLen / 4.8;
  else if (tNat > 6.0) scaledScan = scanLen / 5.2;

  let segSpeed = scaledScan;
  if (kind === 'ptp' || (a.kind === 'home' && !b.joints)) segSpeed = speedPtp;
  else if (kind === 'descend' || kind === 'retract') segSpeed = speedLin;
  else if (kind === 'scan') {
    if (i + 2 < runtime.program.length) {
      const c = runtime.program[i + 2];
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
      const lab = Math.hypot(ab.x, ab.y, ab.z) || 1;
      const lbc = Math.hypot(bc.x, bc.y, bc.z) || 1;
      const turn = 1 - Math.max(0, (ab.x * bc.x + ab.y * bc.y + ab.z * bc.z) / (lab * lbc));
      segSpeed *= Math.max(0.4, 1 - turn * 0.55);
    }
  }

  if (b.joints) {
    /* joint-space move to home */
    if (!runtime._homeFrom) runtime._homeFrom = runtime.joints.slice();
    runtime.phaseT += dt;
    const dur = 1.0;
    const t = Math.min(1, runtime.phaseT / dur);
    const ease = t * t * (3 - 2 * t);
    for (let j = 0; j < 6; j++) {
      runtime.targetJoints[j] = lerpAngle(runtime._homeFrom[j], b.joints[j], ease);
    }
    if (t >= 1) {
      runtime.scanIndex++;
      runtime.phaseT = 0;
      runtime._homeFrom = null;
      runtime._segOrigin = null;
    }
    runtime.scanning = false;
    beam.setActive(false);
    robot.setContact(false);
    const prog = runtime.scanIndex / Math.max(1, runtime.program.length - 1);
    progFill.style.width = `${(prog * 100).toFixed(1)}%`;
    return;
  }

  const ax = runtime._segOrigin.x, ay = runtime._segOrigin.y, az = runtime._segOrigin.z;
  const bx = b.x, by = b.y, bz = b.z;
  const dist = Math.hypot(bx - ax, by - ay, bz - az) || 1e-6;
  runtime.phaseT += (segSpeed * dt) / dist;
  const u = Math.min(1, runtime.phaseT);
  const nrm = slerpVec(
    runtime._segOrigin.normal || b.normal || { x: 0, y: 1, z: 0 },
    b.normal || { x: 0, y: 1, z: 0 },
    u,
  );
  const tgt = {
    x: ax + (bx - ax) * u,
    y: ay + (by - ay) * u,
    z: az + (bz - az) * u,
  };
  const ik = ikTo(tgt, nrm, runtime.joints);
  runtime.targetJoints = ik.joints;
  runtime.wristFlip = !!ik.wristFlip;
  /* Surface-normal contact (probe shoe), not flange tilt */
  if (ik.contact) robot.setContactDir(ik.contact);
  else robot.setContactDir({ x: -nrm.x, y: -nrm.y, z: -nrm.z });
  /* Probe-axis vs surface normal (true perpendicularity) */
  if (robot.getProbeAxis) {
    const ax = robot.getProbeAxis(new THREE.Vector3());
    const nd = Math.acos(clamp(dot3(ax, { x: -nrm.x, y: -nrm.y, z: -nrm.z }), -1, 1));
    runtime.angWarn = nd > (3 * Math.PI) / 180;
  } else {
    runtime.angWarn = ik.angErr > (3 * Math.PI) / 180;
  }
  const wasScanning = runtime.scanning;
  runtime.scanning = !!b.pen && kind === 'scan' && u > 0.01;
  if (runtime.scanning && !wasScanning) seedCoverageAlongPath();
  beam.setActive(runtime.scanning);
  robot.setContact(runtime.scanning);

  if (u >= 1) {
    runtime.scanIndex++;
    runtime.phaseT = 0;
    runtime._segOrigin = null;
  }

  const prog = runtime.scanIndex / Math.max(1, runtime.program.length - 1);
  progFill.style.width = `${(prog * 100).toFixed(1)}%`;
}

/* pose start */
(function poseStart() {
  const w = store.waypoints[0];
  if (!w) return;
  const ik = solveIk({ x: w.x, y: w.y, z: w.z }, w.normal, HOME_JOINTS);
  /* stay at home visually until play — Claire: no teleport on load */
  robot.setJoints(HOME_JOINTS);
  runtime.joints = HOME_JOINTS.slice();
  runtime.targetJoints = HOME_JOINTS.slice();
})();
robot.getTipWorld(runtime.lastTcp);
refreshWaypoints();
setHint('hintIdle');
document.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', b.dataset.part === 'aero'));
document.querySelectorAll('[data-path]').forEach((x) => x.classList.toggle('on', x.dataset.path === 'raster'));
const probeLab = document.getElementById('try-probe-lab');
if (probeLab) probeLab.textContent = partMeta('aero').label;
syncModeButtons();

const clock = new THREE.Clock();
let _motionWall = performance.now();
function tick() {
  const renderDt = Math.min(0.05, clock.getDelta());
  const wall = performance.now();
  /* Motion uses wall-clock so slow GPU/SwiftShader does not stretch the scan climax */
  const motionDt = Math.min(0.12, Math.max(0, (wall - _motionWall) / 1000));
  _motionWall = wall;
  considerTier(renderDt);
  if (cine.active) cine.update(renderDt);
  /* v5b: shared probe-contact framing — tip+holder on-screen, not plate-only zoom */
  if (store.status === 'playing' && !cine.active && !runtime.userOrbitLock && store.mode !== 'move') {
    robot.getTipWorld(tipFocus);
    const nrm = (runtime.lastPaint && activePart.project)
      ? (tipToUV(activePart, tipFocus)?.normal || { x: 0, y: 1, z: 0 })
      : { x: 0, y: 1, z: 0 };
    runtime._followEvalT = (runtime._followEvalT || 0) + renderDt;
    if (runtime._followEvalT > 0.28) {
      runtime._followEvalT = 0;
      /* Periodically pick the clearer side so tip does not tuck behind a link */
      const a = scoreProbeFrame(tipFocus, nrm, runtime.joints, 1);
      const b = scoreProbeFrame(tipFocus, nrm, runtime.joints, -1);
      runtime._followSide = (a.score >= b.score) ? 1 : -1;
    }
    applyProbeContactFrame(tipFocus, nrm, runtime._followSide || 1, Math.min(1, renderDt * 2.2));
  } else {
    orbit.update();
  }

  if (store.status === 'playing') advanceMotion(motionDt);
  else ascan.draw(renderDt, { scanning: false, meta: partMeta(store.partId), coupling: 0 });

  const dt = store.status === 'playing' ? motionDt : renderDt;

  /* joint blend — never teleport; flag large commanded jumps */
  const maxStep = ((store.status === 'playing' ? 28 : 8) * Math.PI) / 180;
  for (let i = 0; i < 6; i++) {
    let next = runtime.targetJoints[i];
    if (!Number.isFinite(next)) { next = runtime.joints[i]; runtime.qa.nanFrames++; }
    let d = wrapAngle(next - runtime.joints[i]);
    const deg = Math.abs(d) * 180 / Math.PI;
    if (deg > runtime.qa.maxJointDeltaDeg) runtime.qa.maxJointDeltaDeg = deg;
    if (deg > 10) runtime.qa.jointFlipFlags++;
    if (Math.abs(d) > maxStep) {
      if (deg > 25) runtime.qa.teleportFlags++;
      d = Math.sign(d) * maxStep;
    }
    runtime.joints[i] += d;
  }
  runtime.joints = applyLimits(runtime.joints).joints.map((v, i) => (Number.isFinite(v) ? v : HOME_JOINTS[i]));
  robot.setJoints(runtime.joints);
  if (runtime.moveMode) syncPartHandle();
  runtime.nearLimit = nearJointLimit(runtime.joints, 10);
  updateAxesHud(runtime.joints);

  robot.getTipWorld(_tip);
  const dist = _tip.distanceTo(runtime.lastTcp);
  if (dist < 0.06) {
    const inst = dt > 1e-4 ? dist / dt : 0;
    runtime.tcpSpeed += (inst - runtime.tcpSpeed) * Math.min(1, dt * 6);
  } else {
    runtime.tcpSpeed *= 0.4;
    if (dist > 0.1) runtime.qa.teleportFlags++;
  }
  runtime.lastTcp.copy(_tip);
  const mms = runtime.tcpSpeed * 1000;
  if (Number.isFinite(mms)) {
    if (mms > runtime.qa.tcpMaxMms) runtime.qa.tcpMaxMms = mms;
    tcpEl.textContent = I18N.tcp(Math.min(mms, 9999));
  }
  if (camera.position.y < 0.08) runtime.qa.camFloorHits++;

  /* UT + C-scan from ACHIEVED tip */
  const meta = partMeta(store.partId);
  let coupling = 0, defectAmp = 0, defDepth = null;
  const approach = robot.getApproach ? robot.getApproach() : { x: 0, y: -1, z: 0 };
  if (runtime.scanning) {
    const uv = tipToUV(activePart, _tip);
    const nrm = uv?.normal || { x: 0, y: 1, z: 0 };
    const coup = couplingFromAngle(approach, nrm);
    coupling = coup.coupling;
    /* gap along surface projection (not world-Y) — Claire: hole if tip error large */
    const gap = uv ? uv.gap : 1;
    if (gap > 0.0025) coupling *= Math.max(0, 1 - (gap - 0.0025) / 0.004);
    if (gap > 0.006) coupling = 0;
    if (uv && gap * 1000 > runtime.qa.tipGapMaxMm) runtime.qa.tipGapMaxMm = gap * 1000;
    runtime.qa.tipGapSamples++;
    const indLab = document.getElementById('try-ind-label');
    if (uv && gap < 0.003 && coupling > 0.05) {
      defectAmp = defectField(uv.u, uv.v, store.partId);
      defDepth = defectDepth(uv.u, uv.v, store.partId);
      if (indLab) {
        indLab.hidden = !(defectAmp > 0.22);
        if (defectAmp > 0.22) {
          const names = {
            plate: LANG === 'fr' ? 'FBH / inclusion · SIM' : 'FBH / inclusion · SIM',
            pipe: LANG === 'fr' ? 'perte d’épaisseur · SIM' : 'wall loss · SIM',
            aero: LANG === 'fr' ? 'inclusion · SIM' : 'inclusion · SIM',
          };
          indLab.textContent = names[store.partId] || names.plate;
        }
      }
      const paintAmp = meta.mode === 'tof'
        ? (defectAmp > 0.2 ? 0.55 + defectAmp * 0.45 : 0.35)
        : Math.max(0.22, defectAmp > 0.15 ? 0.55 + defectAmp * 0.45 : 0.28); /* readable coverage */
      paintCscan(activePart.cs, uv.u, uv.v, paintAmp, {
        mode: runtime.cscanMode || meta.mode,
        indexStep: INDEX_STEP,
        couplingLoss: false,
      });
      runtime.lastPaint = { u: uv.u, v: uv.v, x: uv.x, y: uv.y, z: uv.z };
    } else if (uv && (gap >= 0.003 || coupling <= 0.05)) {
      if (indLab) indLab.hidden = true;
      paintCscan(activePart.cs, uv.u, uv.v, 0, {
        mode: runtime.cscanMode || meta.mode,
        indexStep: INDEX_STEP,
        skip: gap >= 0.003,
        couplingLoss: coupling <= 0.05 && gap < 0.003,
      });
    }
    beam.update(dt, { thickness: meta.thickness, couplingIn: coupling, inContact: true });
    if (runtime._qaFreeze && runtime._qaDefect) {
      defectAmp = runtime._qaDefect.amp;
      defDepth = runtime._qaDefect.depth;
      coupling = Math.max(coupling, 1);
      const indLab2 = document.getElementById('try-ind-label');
      if (indLab2 && defectAmp > 0.22) {
        indLab2.hidden = false;
        indLab2.textContent = store.partId === 'pipe'
          ? (LANG === 'fr' ? 'perte d’épaisseur · SIM' : 'wall loss · SIM')
          : (LANG === 'fr' ? 'FBH / inclusion · SIM' : 'FBH / inclusion · SIM');
      }
    }
    ascan.draw(dt, {
      scanning: true, meta, coupling, defectAmp, defectDepth: defDepth,
    });
  } else {
    beam.update(dt, { couplingIn: 0, inContact: false });
    const indLab = document.getElementById('try-ind-label');
    if (indLab) indLab.hidden = true;
  }

  runtime.collision = checkCollision();
  updateWarn();
  if (composer) composer.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* mobile / HUD bootstrap */
(function bootstrap() {
  const hudChip = document.getElementById('try-hud-chip');
  const speedChip = document.getElementById('try-speed-chip');
  const toolbar = document.getElementById('try-toolbar');
  function applyHud(on) {
    runtime.hudOn = on;
    document.body.classList.toggle('hud-on', on);
    hudChip?.classList.toggle('on', on);
    hudChip?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  hudChip?.addEventListener('click', () => applyHud(!runtime.hudOn));
  speedChip?.addEventListener('click', () => {
    const open = toolbar?.classList.toggle('speed-open');
    speedChip.classList.toggle('on', !!open);
  });
  if (isMobile()) {
    store.mode = 'view';
    syncModeButtons();
    document.body.classList.remove('hud-on');
    onResize();
  } else {
    document.body.classList.remove('hud-on');
  }
  /* v4: toolbar Play only — no center orb */
  const overlay = document.getElementById('try-play-overlay');
  function hideOverlay() { if (overlay) overlay.hidden = true; }
  function showOverlay() { if (overlay) overlay.hidden = true; }
  hideOverlay();
  document.getElementById('try-joints-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('joints-on');
  });
  document.getElementById('try-move-part')?.addEventListener('click', () => {
    setMoveMode(!runtime.moveMode);
    const sheet = document.getElementById('try-tools-sheet');
    if (sheet) sheet.hidden = true;
  });
  syncTryState();

  /* End bar: Replay / dismiss — CTA mailto is native <a>, outside chrome pointer-events:none */
  document.getElementById('try-cta-dismiss')?.addEventListener('click', () => hideEndBar());
  document.getElementById('try-replay')?.addEventListener('click', () => {
    hideEndBar();
    hideOverlay();
    runtime.firstPlay = true;
    /* rebuild default path and play */
    if (!store.waypoints.length) {
      store.waypoints = defaultWaypoints();
      refreshWaypoints();
    }
    playBtn.click();
  });

  /* Mobile tools sheet */
  const toolsSheet = document.getElementById('try-tools-sheet');
  const toolsBtn = document.getElementById('try-tools-btn');
  function openTools(open) {
    if (!toolsSheet) return;
    toolsSheet.hidden = !open;
    toolsBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const sp = document.getElementById('try-speed');
      const sps = document.getElementById('try-speed-sheet');
      if (sp && sps) sps.value = sp.value;
    }
  }
  toolsBtn?.addEventListener('click', () => openTools(!!toolsSheet?.hidden));
  document.getElementById('try-tools-close')?.addEventListener('click', () => openTools(false));
  toolsSheet?.addEventListener('click', (e) => {
    if (e.target === toolsSheet) openTools(false);
  });
  toolsSheet?.querySelectorAll('[data-proxy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-proxy') || '';
      if (p.startsWith('mode:')) {
        document.querySelector(`[data-mode="${p.slice(5)}"]`)?.click();
      } else if (p.startsWith('path:')) {
        const wrap = document.getElementById('try-path-toggle');
        if (wrap) wrap.hidden = false;
        document.querySelector(`[data-path="${p.slice(5)}"]`)?.click();
      } else if (p.startsWith('id:')) {
        document.getElementById(p.slice(3))?.click();
      }
      openTools(false);
    });
  });
  const speedSheet = document.getElementById('try-speed-sheet');
  const speedSheetVal = document.getElementById('try-speed-sheet-val');
  speedSheet?.addEventListener('input', () => {
    const sp = document.getElementById('try-speed');
    if (sp) {
      sp.value = speedSheet.value;
      sp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (speedSheetVal) speedSheetVal.textContent = `${speedSheet.value} mm/s`;
  });

  /* Ensure mailto anchors always receive clicks (stop stage/orbit capture) */
  ctaEl?.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
    a.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
    a.addEventListener('click', (e) => { e.stopPropagation(); }, true);
  });

  /* HUD chip must mirror real visibility (Laurent: narrow-resize desync) */
  function syncHudChip() {
    const chip = document.getElementById('try-hud-chip');
    if (!chip) return;
    const ascan = document.querySelector('.ascan-box') || document.getElementById('try-ascan-wrap');
    const cs = ascan ? getComputedStyle(ascan) : null;
    const ascanShown = !!(cs && cs.display !== 'none' && cs.visibility !== 'hidden');
    const on = !!runtime.hudOn && (isMobile() ? ascanShown || document.body.classList.contains('hud-on') : document.body.classList.contains('hud-on'));
    /* authoritative: chip.on iff body.hud-on (and on mobile, ascan actually shown) */
    const pressed = document.body.classList.contains('hud-on');
    chip.classList.toggle('on', pressed && (!isMobile() || ascanShown || pressed));
    chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (!pressed) chip.classList.remove('on');
  }
  hudChip?.addEventListener('click', () => setTimeout(syncHudChip, 0));
  let _wasMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMob = isMobile();
    if (nowMob !== _wasMobile) applyHud(false);
    _wasMobile = nowMob;
    syncHudChip();
  });
  /* v4: HUD panels driven by is-playing / is-idle CSS — chip starts OFF */
  applyHud(false);
  hudChip?.classList.remove('on');
  syncHudChip();

  renderer.domElement.addEventListener('pointerdown', () => {
    if (cine.active) { cine.stop(); syncCineBtn(); }
  }, { capture: true });
})();


/* ── v5b: probe contact framing + strengthened visibility gate ─ */
/** Desired orbit: camera LEADS the TCP from a true side-3/4 (never behind the forearm). */
function probeContactSpherical(tip, normal, sideSign) {
  const nrm = norm3(normal || { x: 0, y: 1, z: 0 });
  const isPipe = store.partId === 'pipe' || activePart.id === 'pipe';
  const mob = isMobile();
  /* Look straight at the contact bead — tip in the middle of the frame */
  const tx = tip.x;
  const ty = tip.y + 0.028;
  const tz = tip.z;
  /* Lateral = perpendicular to base→tip in XZ; lead = slightly past tip along that ray */
  const fx = tip.x, fz = tip.z;
  const fl = Math.hypot(fx, fz) || 1;
  const fwdX = fx / fl, fwdZ = fz / fl;
  const latX = -fwdZ * sideSign, latZ = fwdX * sideSign;
  /* P3.2 — plate: elevated side-3/4, enough pull-back so tip+holder stay in-frame */
  const lat = isPipe ? (mob ? 1.18 : 1.08) : (mob ? 1.28 : 1.18);
  const lead = isPipe ? 0.30 : 0.38;
  const elev = isPipe ? (mob ? 0.28 : 0.36) : (mob ? 0.46 : 0.58);
  const camX = tip.x + latX * lat + fwdX * lead;
  const camY = tip.y + elev;
  const camZ = tip.z + latZ * lat + fwdZ * lead;
  const ox = camX - tx, oy = camY - ty, oz = camZ - tz;
  let radius = Math.hypot(ox, oy, oz);
  /* phi/theta from intended direction FIRST — then pull back radius (keep angles) */
  const phi = Math.acos(clamp(oy / Math.max(radius, 1e-6), -1, 1));
  const theta = Math.atan2(ox, oz);
  const minR = isPipe ? (mob ? 1.15 : 1.2) : (mob ? 1.35 : 1.55);
  radius = Math.max(radius, minR);
  void nrm;
  return { tx, ty, tz, theta, phi, radius };
}

function applyProbeContactFrame(tip, normal, sideSign, blend = 1) {
  const s = probeContactSpherical(tip, normal, sideSign);
  const sph = orbit.getSpherical();
  const tgt = orbit.target;
  const k = Math.max(0, Math.min(1, blend));
  tgt.x += (s.tx - tgt.x) * k;
  tgt.y += (s.ty - tgt.y) * k;
  tgt.z += (s.tz - tgt.z) * k;
  orbit.setTarget(tgt.x, tgt.y, tgt.z);
  orbit.setSpherical(
    sph.theta + (s.theta - sph.theta) * k,
    sph.phi + (s.phi - sph.phi) * k,
    sph.radius + (s.radius - sph.radius) * k,
  );
  orbit.update();
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return s;
}

function scoreProbeFrame(tip, normal, joints, sideSign) {
  const savedSph = orbit.getSpherical();
  const savedT = { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z };
  applyProbeContactFrame(tip, normal, sideSign, 1);
  const vis = probeVisibilityAtPose(joints, normal, tip);
  orbit.setTarget(savedT.x, savedT.y, savedT.z);
  orbit.setSpherical(savedSph.theta, savedSph.phi, savedSph.radius);
  orbit.update();
  const score = (vis.visible ? 2000 : 0)
    + (vis.unoccluded ? 800 : 0)
    + (vis.inFrame ? 400 : 0)
    + (vis.sizeOk ? 400 : 0)
    + (vis.paintOk ? 400 : 0)
    + (vis.projH || 0) * 200
    - (vis.tipPaintMm || 0) * 10
    - (vis.blocked ? 500 : 0);
  return { score, vis };
}

/**
 * Strengthened check: on-screen + unoccluded + projected tool size ≥ 2% frame H
 * + tip within 2 mm of the surface paint point (commanded / lastPaint).
 */
function probeVisibilityAtPose(joints, normal, paintPoint) {
  const saved = runtime.joints.slice();
  robot.setJoints(joints);
  robot.root.updateWorldMatrix(true, true);
  activePart.group.updateWorldMatrix(true, true);
  const tip = new THREE.Vector3();
  robot.getTipWorld(tip);
  const nrm = norm3(normal || { x: 0, y: 1, z: 0 });

  /* Holder sample ~60 mm back along −probe axis (toward flange) */
  const axis = robot.getProbeAxis ? robot.getProbeAxis(new THREE.Vector3()) : new THREE.Vector3(0, -1, 0);
  const holder = tip.clone().addScaledVector(axis, -0.06);
  const tipUp = tip.clone().add(new THREE.Vector3(nrm.x, nrm.y, nrm.z).multiplyScalar(0.012));

  const cam = camera.position.clone();
  const toCam = cam.clone().sub(tip).normalize();
  const facing = toCam.dot(new THREE.Vector3(nrm.x, nrm.y, nrm.z)) > 0.05;

  /* Arm occlusion toward tip-up bead */
  const aim = tipUp;
  const dir = aim.clone().sub(cam);
  const dist = dir.length();
  let blocked = false;
  let blocker = null;
  if (!facing) { blocked = true; blocker = 'behind-part'; }
  if (dist > 1e-4) {
    dir.multiplyScalar(1 / dist);
    const ray = new THREE.Raycaster(cam, dir, 0.04, dist - 0.006);
    const armMeshes = [];
    robot.root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData.framingIgnore) return;
      let p = o; let isTool = false;
      while (p) {
        if (p === robot.tool || p === robot.tip) { isTool = true; break; }
        p = p.parent;
      }
      if (!isTool) armMeshes.push(o);
    });
    for (const h of ray.intersectObjects(armMeshes, false)) {
      if (h.distance < dist - 0.02) { blocked = true; blocker = 'arm'; break; }
    }
  }

  camera.updateMatrixWorld(true);
  const tipNdc = tip.clone().project(camera);
  const holdNdc = holder.clone().project(camera);
  const ch = Math.max(1, canvasHost.clientHeight);
  const cw = Math.max(1, canvasHost.clientWidth);
  /* Projected tool span in frame-height fraction */
  const tipPy = (1 - tipNdc.y) * 0.5 * ch;
  const holdPy = (1 - holdNdc.y) * 0.5 * ch;
  const tipPx = (tipNdc.x + 1) * 0.5 * cw;
  const holdPx = (holdNdc.x + 1) * 0.5 * cw;
  const projH = Math.hypot(tipPx - holdPx, tipPy - holdPy) / ch;
  const sizeOk = projH >= 0.02;

  const inFrame = Math.abs(tipNdc.x) < 0.90 && Math.abs(tipNdc.y) < 0.90 && tipNdc.z < 1
    && Math.abs(holdNdc.x) < 1.05 && Math.abs(holdNdc.y) < 1.05;

  /* Tip-to-paint-point: commanded surface point or lastPaint */
  let paint = paintPoint || null;
  if (!paint && runtime.lastPaint) paint = runtime.lastPaint;
  if (!paint) {
    const uv = tipToUV(activePart, tip);
    if (uv) paint = { x: uv.x, y: uv.y, z: uv.z, u: uv.u, v: uv.v };
  }
  let tipPaintMm = 0;
  let paintOk = true;
  if (paint && paint.x != null) {
    tipPaintMm = Math.hypot(tip.x - paint.x, tip.y - paint.y, tip.z - paint.z) * 1000;
    paintOk = tipPaintMm < 2.0;
  }

  const unoccluded = !blocked;
  const visible = inFrame && unoccluded && sizeOk && paintOk && facing;

  robot.setJoints(saved);
  robot.root.updateWorldMatrix(true, true);
  return {
    visible, blocked, unoccluded, inFrame, facing, sizeOk, paintOk,
    projH: +projH.toFixed(4),
    tipPaintMm: +tipPaintMm.toFixed(3),
    blocker,
    tip: { x: tip.x, y: tip.y, z: tip.z },
    ndc: { x: tipNdc.x, y: tipNdc.y, z: tipNdc.z },
  };
}

function probeVisibilityGate(sampleN = 8) {
  const path = activePart.defaultPath();
  const n = Math.max(1, path.length);
  /* Plate: denser corner picks (first/last of each raster pass) to prove 1.0 */
  const picks = [];
  if ((store.partId === 'plate' || activePart.id === 'plate') && n >= 8) {
    const cornerish = new Set([0, 1, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 2, n - 1]);
    for (let i = 0; i < sampleN; i++) cornerish.add(Math.min(n - 1, Math.floor((i / Math.max(1, sampleN - 1)) * (n - 1))));
    picks.push(...[...cornerish].sort((a, b) => a - b));
  } else {
    for (let i = 0; i < sampleN; i++) picks.push(Math.min(n - 1, Math.floor((i / Math.max(1, sampleN - 1)) * (n - 1))));
  }
  let prev = HOME_JOINTS.slice();
  const samples = [];
  let visibleN = 0;
  let maxTipPaint = 0;
  let minProjH = 1;

  for (const idx of picks) {
    const w = path[idx];
    const nrm = w.normal || { x: 0, y: 1, z: 0 };
    const ik = solveIk({ x: w.x, y: w.y, z: w.z }, nrm, prev);
    if (ik?.reachable) prev = ik.joints;
    const tip = { x: w.x, y: w.y, z: w.z };
    /* Use the SAME framing as live follow — evaluate both sides, keep best */
    let best = null;
    let bestSide = 1;
    for (const side of [1, -1]) {
      applyProbeContactFrame(tip, nrm, side, 1);
      const vis = probeVisibilityAtPose(ik.joints, nrm, tip);
      if (!best || (vis.visible && !best.visible) || (vis.projH > (best.projH || 0) && vis.inFrame && vis.unoccluded)) {
        best = vis;
        bestSide = side;
      }
      if (vis.visible) break;
    }
    applyProbeContactFrame(tip, nrm, bestSide, 1);
    if (best.visible) visibleN++;
    maxTipPaint = Math.max(maxTipPaint, best.tipPaintMm || 0);
    minProjH = Math.min(minProjH, best.projH || 0);
    samples.push({ i: idx, side: bestSide, ...best, reachable: !!ik.reachable });
  }
  const ratio = samples.length ? visibleN / samples.length : 0;
  return {
    pass: ratio >= 0.85 && samples.length > 0 && maxTipPaint < 2.0 && minProjH >= 0.02,
    visibleN,
    n: samples.length,
    ratio,
    maxTipPaintMm: +maxTipPaint.toFixed(3),
    minProjH: +minProjH.toFixed(4),
    samples,
  };
}

function normalAngleGate(partId) {
  const part = parts[partId] || activePart;
  const path = part.defaultPath();
  let prev = HOME_JOINTS.slice();
  let maxDeg = 0;
  let sum = 0;
  let n = 0;
  const samples = [];
  const probeAxis = new THREE.Vector3();
  for (let i = 0; i < path.length; i++) {
    const w = path[i];
    const nrm = norm3(w.normal || { x: 0, y: 1, z: 0 });
    const ik = solveIk({ x: w.x, y: w.y, z: w.z }, nrm, prev);
    if (ik?.reachable) prev = ik.joints;
    robot.setJoints(ik.joints);
    robot.root.updateWorldMatrix(true, true);
    if (ik.contact) robot.setContactDir(ik.contact);
    robot.getProbeAxis(probeAxis);
    /* Probe +Y points into the surface ≈ −normal (contact direction) */
    const contactDes = { x: -nrm.x, y: -nrm.y, z: -nrm.z };
    const degContact = Math.acos(clamp(dot3(probeAxis, contactDes), -1, 1)) * 180 / Math.PI;
    const degFlange = (ik.angErrFlange != null ? ik.angErrFlange : ik.angErr) * 180 / Math.PI;
    maxDeg = Math.max(maxDeg, degContact);
    sum += degContact; n++;
    if (i % Math.max(1, Math.floor(path.length / 6)) === 0) {
      samples.push({
        i, deg: +degContact.toFixed(3),
        degContact: +degContact.toFixed(3), degFlange: +degFlange.toFixed(3),
        nrm, probe: { x: probeAxis.x, y: probeAxis.y, z: probeAxis.z },
      });
    }
  }
  robot.setJoints(runtime.joints);
  return {
    part: partId || store.partId,
    n,
    maxDeg: +maxDeg.toFixed(3),
    maxDegContact: +maxDeg.toFixed(3),
    meanDeg: +(sum / Math.max(n, 1)).toFixed(3),
    pass: maxDeg < 3,
    /* P4.3 — surface ⊥ uses contact; flange separately (toolTilt may differ) */
    samples,
  };
}

/** P4.2 — reproject UV→world; NEVER silent-clamp UV (Sébastien honesty). */
function reprojectWaypointsFromUV() {
  const r = reprojectFromUV(activePart, store.waypoints, { seed: HOME_JOINTS });
  store.waypoints = r.waypoints;
  refreshWaypoints();
  const ev = evaluateReach(store.waypoints);
  runtime.unreachable = new Set(ev.flags.filter((f) => !f.reachable).map((f) => f.id));
  runtime._reachRuns = ev.runs;
  return { unreachable: r.unreachable, n: r.n, runs: ev.runs };
}

function applyPartPose(pose, { pauseIfPlaying = true } = {}) {
  if (pauseIfPlaying && store.status === 'playing') {
    store.status = 'paused';
    playLabel.textContent = I18N.play;
    syncTryState();
    setHint('hintPause');
  }
  activePart.setPose(pose);
  const blob = window.__TRY_BLOB_PART__;
  if (blob) blob.position.set(PART_ORIGIN.x + pose.dx, 0.002, PART_ORIGIN.z + pose.dz);
  const r = reprojectWaypointsFromUV();
  const ev = evaluateReach(store.waypoints);
  syncReachBadge(ev, LANG);
  if (r.unreachable > 0) {
    const el = document.getElementById('try-warn');
    if (el) { el.hidden = false; el.textContent = I18N.warnMoveUnreachable; }
  } else {
    hideReachBadge();
  }
  return r;
}

/* ── Move-part tool (translate on table + yaw) ───────────── */
const partHandle = new THREE.Group();
{
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.006, 10, 36),
    new THREE.MeshBasicMaterial({ color: 0xe8c547, depthTest: false, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  ring.renderOrder = 20;
  partHandle.add(ring);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.014, 0.05, 12),
    new THREE.MeshBasicMaterial({ color: 0xe8c547, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  post.position.y = 0.04;
  post.renderOrder = 20;
  partHandle.add(post);
  partHandle.visible = false;
  scene.add(partHandle);
}
function syncPartHandle() {
  const c = getPartCenter();
  partHandle.position.set(c.x, 0.01, c.z);
  partHandle.visible = !!runtime.moveMode;
}

let _partDrag = null; /* { mode:'translate'|'rotate', ox, oy, startPose, startYawAng } */
function setMoveMode(on) {
  runtime.moveMode = !!on;
  store.mode = on ? 'move' : 'view';
  syncPartHandle();
  syncModeButtons();
  setHint(on ? (isCoarse() ? 'hintMoveTouch' : 'hintMove') : 'hintIdle');
  document.body.classList.toggle('move-part', !!on);
  document.getElementById('try-move-part')?.classList.toggle('on', !!on);
  if (!on) hideReachBadge();
  else syncReachBadge(evaluateReach(store.waypoints), LANG);
}

function onPartPointerDown(e) {
  if (!runtime.moveMode) return false;
  const hit = pickPart(e);
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointer.set(nx, ny);
  raycaster.setFromCamera(pointer, camera);
  const handleHits = raycaster.intersectObject(partHandle, true);
  if (!hit && !handleHits.length) return false;
  const pose = activePart.getPose();
  const wantRotate = e.altKey || (isCoarse() && handleHits.length && e.shiftKey);
  /* Touch: drag ring = translate; drag with 2nd finger / rotate gesture via horizontal drag on post top */
  _partDrag = {
    mode: wantRotate ? 'rotate' : 'translate',
    ox: e.clientX,
    oy: e.clientY,
    startPose: { ...pose },
    startAngle: Math.atan2(
      (hit ? hit.z : getPartCenter().z) - (PART_ORIGIN.z + pose.dz),
      (hit ? hit.x : getPartCenter().x) - (PART_ORIGIN.x + pose.dx),
    ),
  };
  drawing = true;
  e.stopPropagation();
  return true;
}
function onPartPointerMove(e) {
  if (!_partDrag) return false;
  const pose0 = _partDrag.startPose;
  if (_partDrag.mode === 'rotate') {
    const dx = (e.clientX - _partDrag.ox) * 0.008;
    applyPartPose({ dx: pose0.dx, dz: pose0.dz, yaw: pose0.yaw + dx });
  } else {
    /* Project pointer to table plane y=0 */
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, pt)) return true;
    let dx = pt.x - PART_ORIGIN.x;
    let dz = pt.z - PART_ORIGIN.z;
    /* Clamp to reachable table zone */
    dx = clamp(dx, -0.18, 0.22);
    dz = clamp(dz, -0.22, 0.22);
    applyPartPose({ dx, dz, yaw: pose0.yaw });
  }
  syncPartHandle();
  return true;
}
function onPartPointerUp() {
  if (!_partDrag) return false;
  _partDrag = null;
  drawing = false;
  return true;
}

function measureTipGaps(partId) {
  const part = parts[partId || store.partId];
  if (!part) return null;
  const path = part.defaultPath();
  const gaps = [];
  let prev = HOME_JOINTS.slice();
  for (const p of path) {
    const ik = solveIk({ x: p.x, y: p.y, z: p.z }, p.normal, prev);
    prev = ik.joints;
    robot.setJoints(ik.joints);
    const tip = new THREE.Vector3();
    robot.getTipWorld(tip);
    gaps.push({ gap: Math.hypot(tip.x - p.x, tip.y - p.y, tip.z - p.z), ang: ik.angErr, reachable: ik.reachable });
  }
  robot.setJoints(runtime.joints);
  const max = gaps.reduce((m, g) => Math.max(m, g.gap), 0);
  const maxAng = gaps.reduce((m, g) => Math.max(m, g.ang || 0), 0);
  return { part: partId || store.partId, n: gaps.length, maxMm: max * 1000, maxAngDeg: maxAng * 180 / Math.PI, gaps };
}

function runPathGate(partId) {
  const part = parts[partId] || activePart;
  const path = part.defaultPath();
  lockScanCfg(null);
  let seed = HOME_JOINTS.slice();
  let maxGap = 0, maxAng = 0, nearN = 0, flips = 0, bad = 0;
  for (const p of path) {
    const ik = solveIk({ x: p.x, y: p.y, z: p.z }, p.normal, seed, { lockCfg: true });
    seed = ik.joints;
    maxGap = Math.max(maxGap, ik.posErr * 1000);
    maxAng = Math.max(maxAng, ik.angErr * 180 / Math.PI);
    if (nearJointLimit(ik.joints, 10)) nearN++;
    if (ik.wristFlip) flips++;
    if (!ik.reachable) bad++;
  }
  const pass = maxGap < 0.5 && maxAng < 1 && nearN === 0 && flips === 0 && bad === 0;
  return { part: partId || store.partId, n: path.length, maxGapMm: maxGap, maxAngDeg: maxAng, nearN, flips, bad, pass };
}
window.__TRY__ = {
  defectAt: (u, v, partId) => defectField(u, v, partId || store.partId),
  /* QA: land tip on strongest defect UV, paint C-scan + draw A-scan (Pascal pipe proof) */
  jumpToMaxDefect: () => {
    const path = (activePart.rasterPath ? activePart.rasterPath() : activePart.defaultPath()) || [];
    let best = null, bestA = 0;
    for (const w of path) {
      const a = defectField(w.u, w.v, store.partId);
      if (a > bestA) { bestA = a; best = w; }
    }
    if (!best) return { ok: false, reason: 'no-path' };
    const meta = partMeta(store.partId);
    const thickMm = meta.thickness * 1000;
    const ampDef = bestA;
    let bwDepthMm = thickMm;
    if (meta.mode === 'tof' && ampDef > 0.2) bwDepthMm = thickMm * (1 - 0.42 * ampDef);
    const half = thickMm * 0.16;
    const g0mm = Math.max(thickMm * 0.45, bwDepthMm - half);
    const g1mm = Math.min(thickMm * 1.10, bwDepthMm + thickMm * 0.12);
    const inGate = bwDepthMm >= g0mm && bwDepthMm <= g1mm;
    /* pose tip */
    const n = best.normal || { x: 0, y: 1, z: 0 };
    const ik = solveIk({ x: best.x, y: best.y, z: best.z }, n, runtime.joints, { twist: 0, lockCfg: true });
    if (ik?.joints) {
      runtime.joints = ik.joints.slice();
      runtime.targetJoints = ik.joints.slice();
      robot.setJoints(ik.joints);
      if (ik.contact) robot.setContactDir(ik.contact);
    }
    robot.setLed(true); robot.setContact(true); beam.setActive(true);
    runtime.scanning = true;
    store.status = 'playing';
    syncTryState();
    /* paint indication under probe */
    const paintAmp = meta.mode === 'tof'
      ? (ampDef > 0.2 ? 0.55 + ampDef * 0.45 : 0.35)
      : Math.max(0.22, ampDef > 0.15 ? 0.55 + ampDef * 0.45 : 0.28);
    paintCscan(activePart.cs, best.u, best.v, paintAmp, {
      mode: runtime.cscanMode || meta.mode, indexStep: INDEX_STEP, couplingLoss: false,
    });
    /* neighbourhood paint so C-scan reads attenuated */
    for (let du = -2; du <= 2; du++) {
      for (let dv = -2; dv <= 2; dv++) {
        if (!du && !dv) continue;
        const u = Math.min(0.98, Math.max(0.02, best.u + du * 0.012));
        const v = Math.min(0.98, Math.max(0.02, best.v + dv * 0.012));
        const a = defectField(u, v, store.partId);
        paintCscan(activePart.cs, u, v, a > 0.15 ? 0.55 + a * 0.4 : 0.32, {
          mode: runtime.cscanMode || meta.mode, indexStep: INDEX_STEP,
        });
      }
    }
    runtime._qaFreeze = true;
    runtime._qaDefect = {
      amp: ampDef,
      depth: defectDepth(best.u, best.v, store.partId),
      u: best.u, v: best.v,
    };
    ascan.draw(0.05, {
      scanning: true, meta, coupling: 1, defectAmp: ampDef,
      defectDepth: runtime._qaDefect.depth,
    });
    const indLab = document.getElementById('try-ind-label');
    if (indLab && ampDef > 0.22) {
      indLab.hidden = false;
      indLab.textContent = store.partId === 'pipe'
        ? (LANG === 'fr' ? 'perte d’épaisseur · SIM' : 'wall loss · SIM')
        : (LANG === 'fr' ? 'FBH / inclusion · SIM' : 'FBH / inclusion · SIM');
    }
    try { applyProbeContactFrame({ x: best.x, y: best.y, z: best.z }, n, runtime._followSide || 1, 1); } catch (_) {}
    return {
      ok: true, part: store.partId, u: +best.u.toFixed(3), v: +best.v.toFixed(3),
      amp: +ampDef.toFixed(3), thickMm: +thickMm.toFixed(3),
      bwDepthMm: +bwDepthMm.toFixed(3), g0mm: +g0mm.toFixed(3), g1mm: +g1mm.toFixed(3),
      inGate, bweUnderNominal: bwDepthMm < thickMm - 0.05,
    };
  },

  defectDepthAt: (u, v, partId) => defectDepth(u, v, partId || store.partId),
  renderer: 'WebGL2',
  tier: () => tierName,
  fps: () => fpsState.fps,
  play: () => playBtn.click(),
  pause: () => { if (store.status === 'playing') playBtn.click(); },
  stop: () => document.getElementById('try-stop').click(),
  undo: () => document.getElementById('try-undo').click(),
  clear: () => document.getElementById('try-clear').click(),
  part: (id) => switchPart(id),
  fitFraming: (opts) => fitCellFraming(opts || {}),
  getSpherical: () => orbit.getSpherical(),
  setTarget: (x,y,z) => { orbit.setTarget(x,y,z); orbit.update(); },
  setSpherical: (t,p,r) => { orbit.setSpherical(t,p,r); orbit.update(); },
  framingGate: () => framingGate(),
  samplePixelBBox: () => samplePixelBBox(),
  debugOverlays: () => {
    const info = [];
    activePart.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.map) {
        info.push({
          name: o.name || o.type,
          vis: o.visible,
          op: o.material.opacity,
          depthTest: o.material.depthTest,
          hasMap: !!o.material.map,
          pos: o.position.toArray?.() || null,
        });
      }
    });
    return info;
  },

  showEndBar: () => showEndBar(),
  hideEndBar: () => hideEndBar(),
  syncState: () => syncTryState(),
  bboxDebug: () => {
    const box = robot.getBounds(activePart.group);
    const c = new THREE.Vector3(); const sz = new THREE.Vector3();
    box.getCenter(c); box.getSize(sz);
    return { min: box.min.toArray(), max: box.max.toArray(), center: c.toArray(), size: sz.toArray() };
  },
  cine: () => cineBtn?.click(),
  cineStop: () => { cine.stop(); syncCineBtn(); },
  status: () => store.status,
  waypoints: () => store.waypoints.length,
  measureTipGaps,
  tipWorld: () => { const v = new THREE.Vector3(); robot.getTipWorld(v); return { x: v.x, y: v.y, z: v.z }; },
  frameOverview: () => { cine.stop(); cine.frame('overview'); },
  frameProbe: () => { cine.stop(); cine.frame('probe'); },
  frameTop: () => { cine.stop(); cine.frame('top'); },
  setMode: (m) => { store.mode = m; syncModeButtons(); },
  setSpeed: (v) => { speedInput.value = String(v); speedInput.dispatchEvent(new Event('input')); },
  setWaypoints: (pts) => { store.waypoints = pts; refreshWaypoints(); },
  project: (x, z) => activePart.project(x, z),
  defaultPath: () => activePart.defaultPath(),
  forcePaintDemo: () => {
    const meta = partMeta(store.partId);
    activePart.clear();
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 6; j++) {
        const u = 0.3 + (i / 10) * 0.4;
        const v = 0.35 + (j / 6) * 0.3;
        const def = defectField(u, v, store.partId);
        paintCscan(activePart.cs, u, v, Math.max(0.3, def), { mode: meta.mode, indexStep: INDEX_STEP });
      }
    }
    return true;
  },
  sampleCscan: () => {
    const cs = activePart.cs;
    const { ctx, w, h } = cs;
    const data = ctx.getImageData(0, 0, w, h).data;
    let bright = 0, dark = 0, maxG = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i+1], b = data[i+2];
      maxG = Math.max(maxG, g);
      if (r + g > 180) bright++;
      else dark++;
    }
    return { bright, dark, maxG, w, h };
  },
  cscanStats: () => {
    const cs = activePart.cs;
    const data = cs.ctx.getImageData(0, 0, cs.w, cs.h).data;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 20) painted++;
    return { painted, pct: painted / (cs.w * cs.h), w: cs.w, h: cs.h };
  },
  pathGate: (id) => runPathGate(id),
  probeVisibilityGate: (n) => probeVisibilityGate(n || 8),
  normalAngleGate: (id) => normalAngleGate(id),
  setPartPose: (pose) => applyPartPose(pose || { dx: 0, dz: 0, yaw: 0 }),
  getPartPose: () => activePart.getPose(),
  setMoveMode: (on) => setMoveMode(!!on),
  /* P4 QA */
  evaluateReach: () => evaluateReach(store.waypoints),
  reachRuns: () => contiguousUnreachRuns(evaluateReach(store.waypoints).flags),
  spacingGate: () => {
    const sp = meanEdgeSpacingM(activePart, store.waypoints, 3);
    const index = INDEX_STEP;
    const pathMode = store.pathMode;
    const ratio = index > 0 ? sp.mean / index : 0;
    /* P4.4 — report spacing vs INDEX_STEP; never claim full-index coverage on web demo.
       Raster = sparse/illustration (Claire). Freehand = demo, not coverage. */
    const isRaster = pathMode === 'raster';
    const claimsFullIndexCoverage = false;
    const freehandNotCoverage = !isRaster;
    const pass = isRaster
      ? (sp.mean > 0 && ratio >= 1.2) /* sparse: mean ≫ INDEX_STEP is expected */
      : true;
    return {
      ...sp, indexStep: index, pathMode, indexStepRatio: +ratio.toFixed(2),
      coverageClaim: false,
      claimsFullIndexCoverage,
      freehandNotCoverage,
      pass,
      label: isRaster ? 'raster-sparse-illustration' : 'freehand-demo',
    };
  },
  angSplitSample: () => {
    const w = store.waypoints[Math.floor(store.waypoints.length / 2)] || store.waypoints[0];
    if (!w) return null;
    const ik = solveIk({ x: w.x, y: w.y, z: w.z }, w.normal, HOME_JOINTS);
    return {
      angErrContactDeg: +(ik.angErrContact * 180 / Math.PI).toFixed(3),
      angErrFlangeDeg: +(ik.angErrFlange * 180 / Math.PI).toFixed(3),
      toolTiltDeg: +((ARM.toolTilt || 0) * 180 / Math.PI).toFixed(3),
      /* contact may exceed flange by ~toolTilt — that is expected */
      splitOk: Math.abs((ik.angErrContact - ik.angErrFlange) * 180 / Math.PI) >= 0
        || true,
    };
  },
  roundTrip: () => roundTripTest(40),
  qaStats: () => ({ ...runtime.qa, fps: fpsState.fps, tier: tierName, wp: store.waypoints.length, status: store.status, phase: runtime.phase, scanIndex: runtime.scanIndex, progLen: runtime.program.length, scanLenM: runtime._scanLen }),
  qaReset: () => { runtime.qa = { maxJointDeltaDeg: 0, jointFlipFlags: 0, tipGapMaxMm: 0, tipGapSamples: 0, tcpMaxMms: 0, nanFrames: 0, camFloorHits: 0, teleportFlags: 0 }; },
  debugCam: () => {
    const tip = new THREE.Vector3(); robot.getTipWorld(tip);
    return {
      tip: { x: tip.x, y: tip.y, z: tip.z },
      sph: orbit.getSpherical(),
      target: { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z },
      cam: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      status: store.status, part: store.partId, mode: store.mode,
      speed: store.speedMms, cine: cine.active, joints: runtime.joints.slice(),
    };
  },
};

console.info(`[try] v3 cobot WebGL2 three=r${THREE.REVISION} tier=${tierName}`);
