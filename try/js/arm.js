import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, REVEAL_Y } from './fx.js';
import { clamp } from './util.js';

/*
 * Generic, brandless 6-axis industrial arm with a spherical wrist.
 * Frames: J1 about local Y, J2/J3 about Z, J4 about X (forearm roll),
 * J5 about Z, J6 about X. Zero pose: upper arm up, forearm forward (+X).
 */
export const K = { d1: 0.52, a1: 0.16, a2: 0.92, a3: 0.14, x4: 0.34, d4: 0.96, d6: 0.12, tool: 0.19 };

export const HOME = [0, 0.1, -0.12, 0, -1.45, 0];

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

function stadiumShape(p0, r0, p1, r1) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const D = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx);
  const phi = Math.asin(clamp((r0 - r1) / D, -0.99, 0.99));
  const a1 = base + Math.PI / 2 - phi;
  const a2 = base - Math.PI / 2 + phi;
  const s = new THREE.Shape();
  s.moveTo(p0[0] + r0 * Math.cos(a2), p0[1] + r0 * Math.sin(a2));
  s.lineTo(p1[0] + r1 * Math.cos(a2), p1[1] + r1 * Math.sin(a2));
  s.absarc(p1[0], p1[1], r1, a2, a1, false);
  s.lineTo(p0[0] + r0 * Math.cos(a1), p0[1] + r0 * Math.sin(a1));
  s.absarc(p0[0], p0[1], r0, a1, a2 + Math.PI * 2, false);
  return s;
}

function link(p0, r0, p1, r1, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(stadiumShape(p0, r0, p1, r1), {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: 4,
    curveSegments: 28,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return toCreasedNormals(g, Math.PI / 4);
}

function cylZ(r, len, seg = 40) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateX(Math.PI / 2);
  return g;
}

function cylX(r, len, seg = 40, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  g.rotateZ(-Math.PI / 2);
  return g;
}

function latheX(profile, seg = 48) {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), seg);
  g.rotateZ(-Math.PI / 2);
  return g;
}

function ringZ(r, tube) {
  return new THREE.TorusGeometry(r, tube, 10, 64);
}

function ringX(r, tube) {
  const g = new THREE.TorusGeometry(r, tube, 10, 64);
  g.rotateY(Math.PI / 2);
  return g;
}

export function createArm() {
  const M = {
    ivory: patchMaterial(
      new THREE.MeshPhysicalMaterial({ color: 0xd9d3c5, roughness: 0.4, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.26 }),
      REVEAL_Y,
      'arm-ivory'
    ),
    graphite: patchMaterial(new THREE.MeshStandardMaterial({ color: 0x1d1c1b, metalness: 0.4, roughness: 0.44 }), REVEAL_Y, 'arm-graphite'),
    steel: patchMaterial(new THREE.MeshStandardMaterial({ color: 0x2a2927, metalness: 0.82, roughness: 0.3 }), REVEAL_Y, 'arm-steel'),
    gold: patchMaterial(new THREE.MeshStandardMaterial({ color: 0xe8c547, metalness: 1, roughness: 0.27 }), REVEAL_Y, 'arm-gold'),
    rubber: patchMaterial(new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.82, metalness: 0 }), REVEAL_Y, 'arm-rubber'),
    face: patchMaterial(new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 0.42, metalness: 0.2 }), REVEAL_Y, 'arm-face'),
  };
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8c547).multiplyScalar(0.25), toneMapped: false });

  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'arm';

  // Pedestal (root sits on the pedestal top plate).
  const ped = new THREE.Group();
  root.add(ped);
  add(ped, new THREE.BoxGeometry(0.62, 0.03, 0.62), M.steel, 0, -0.485, 0);
  add(ped, new THREE.BoxGeometry(0.4, 0.45, 0.4), M.graphite, 0, -0.245, 0);
  add(ped, new THREE.BoxGeometry(0.46, 0.02, 0.46), M.steel, 0, -0.01, 0);
  add(ped, new THREE.BoxGeometry(0.404, 0.012, 0.404), M.gold, 0, -0.07, 0);
  for (const [x, z] of [[0.26, 0.26], [-0.26, 0.26], [0.26, -0.26], [-0.26, -0.26]]) {
    add(ped, new THREE.CylinderGeometry(0.016, 0.016, 0.018, 12), M.steel, x, -0.462, z);
  }

  // Fixed base.
  add(root, new THREE.LatheGeometry([[0, 0], [0.25, 0], [0.25, 0.035], [0.236, 0.052], [0.214, 0.12], [0.2, 0.15], [0, 0.15]].map(([r, y]) => new THREE.Vector2(r, y)), 64), M.graphite);
  add(root, new THREE.CylinderGeometry(0.203, 0.203, 0.01, 64), M.gold, 0, 0.155, 0);

  const j1 = new THREE.Group();
  root.add(j1);
  add(j1, new THREE.CylinderGeometry(0.19, 0.2, 0.13, 64), M.ivory, 0, 0.225, 0);
  add(j1, link([0, 0.3], 0.175, [K.a1, K.d1], 0.158, 0.34, 0.03), M.ivory);
  add(j1, cylZ(0.128, 0.46), M.graphite, K.a1, K.d1, 0);
  for (const z of [-0.232, 0.232]) add(j1, ringZ(0.1, 0.006), M.gold, K.a1, K.d1, z);
  add(j1, new THREE.CylinderGeometry(0.056, 0.056, 0.17, 32), M.graphite, -0.13, 0.36, 0.13);
  add(j1, new THREE.CylinderGeometry(0.058, 0.058, 0.012, 32), M.gold, -0.13, 0.451, 0.13);

  const j2 = new THREE.Group();
  j2.position.set(K.a1, K.d1, 0);
  j1.add(j2);
  add(j2, link([0, 0], 0.138, [0, K.a2], 0.108, 0.24, 0.035), M.ivory);
  add(j2, cylZ(0.105, 0.3), M.graphite, 0, K.a2, 0);
  for (const z of [-0.152, 0.152]) add(j2, ringZ(0.082, 0.005), M.gold, 0, K.a2, z);

  const j3 = new THREE.Group();
  j3.position.set(0, K.a2, 0);
  j2.add(j3);
  add(j3, link([-0.24, K.a3], 0.098, [K.x4 - 0.02, K.a3], 0.11, 0.25, 0.03), M.ivory);
  add(j3, cylX(0.078, 0.13), M.graphite, -0.33, K.a3, 0);
  add(j3, cylX(0.08, 0.01), M.gold, -0.4, K.a3, 0);
  add(j3, cylX(0.103, 0.024), M.graphite, K.x4 - 0.008, K.a3, 0);

  const j4 = new THREE.Group();
  j4.position.set(K.x4, K.a3, 0);
  j3.add(j4);
  const L45 = K.d4 - K.x4;
  add(j4, latheX([[0.0, 0.0], [0.096, 0.0], [0.094, 0.06], [0.078, L45 - 0.14], [0.07, L45 - 0.1], [0.0, L45 - 0.1]]), M.ivory);
  add(j4, cylX(0.098, 0.008), M.gold, 0.012, 0, 0);
  for (const z of [-0.077, 0.077]) {
    add(j4, link([L45 - 0.16, 0], 0.07, [L45, 0], 0.062, 0.03, 0.009), M.ivory, 0, 0, z);
  }

  const j5 = new THREE.Group();
  j5.position.set(L45, 0, 0);
  j4.add(j5);
  add(j5, cylZ(0.058, 0.126), M.graphite);
  add(j5, link([0, 0], 0.056, [K.d6 - 0.03, 0], 0.047, 0.108, 0.02), M.ivory);

  const j6 = new THREE.Group();
  j6.position.set(K.d6, 0, 0);
  j5.add(j6);
  add(j6, cylX(0.045, 0.022), M.graphite, -0.011, 0, 0);
  add(j6, cylX(0.0462, 0.005), M.gold, -0.004, 0, 0);

  // End effector: contact UT probe on a compliant holder.
  const tool = new THREE.Group();
  j6.add(tool);
  add(tool, cylX(0.05, 0.012), M.steel, 0.006, 0, 0);
  const bellows = [];
  const x0 = 0.012;
  for (let i = 0; i <= 12; i++) bellows.push([i % 2 ? 0.035 : 0.029, x0 + (0.058 * i) / 12]);
  add(tool, latheX([[0, x0], ...bellows, [0, x0 + 0.058]], 36), M.rubber);
  add(tool, cylX(0.026, 0.07), M.steel, 0.105, 0, 0);
  add(tool, cylX(0.0266, 0.008), M.gold, 0.122, 0, 0);
  const ledRing = new THREE.Mesh(ringX(0.0272, 0.0022), led);
  ledRing.position.set(0.133, 0, 0);
  tool.add(ledRing);
  add(tool, cylX(0.019, 0.045), M.graphite, 0.1625, 0, 0);
  add(tool, cylX(0.0178, 0.004), M.face, 0.188, 0, 0);
  const cablePts = [
    new THREE.Vector3(0.15, 0.02, 0),
    new THREE.Vector3(0.125, 0.052, 0.004),
    new THREE.Vector3(0.07, 0.078, 0.01),
    new THREE.Vector3(0.0, 0.086, 0.012),
    new THREE.Vector3(-0.06, 0.078, 0.01),
  ];
  add(tool, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 40, 0.0055, 8, false), M.rubber);

  const joints = [j1, j2, j3, j4, j5, j6];
  const q = HOME.slice();

  function setJoints(v) {
    for (let i = 0; i < 6; i++) q[i] = v[i];
    j1.rotation.set(0, v[0], 0);
    j2.rotation.set(0, 0, v[1]);
    j3.rotation.set(0, 0, v[2]);
    j4.rotation.set(v[3], 0, 0);
    j5.rotation.set(0, 0, v[4]);
    j6.rotation.set(v[5], 0, 0);
  }
  setJoints(HOME);

  const _qi = new THREE.Quaternion();
  const _q03 = new THREE.Quaternion();
  const _qa = new THREE.Quaternion();
  const _qb = new THREE.Quaternion();
  const _Pb = new THREE.Vector3();
  const _Ab = new THREE.Vector3();
  const _W = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _y = new THREE.Vector3();

  /** Tool tip at world point P with probe axis along world direction A (into the part). */
  function solve(Pw, Aw, out = new Array(6)) {
    root.updateWorldMatrix(true, false);
    _Pb.copy(Pw);
    root.worldToLocal(_Pb);
    root.getWorldQuaternion(_qi).invert();
    _Ab.copy(Aw).applyQuaternion(_qi).normalize();
    _W.copy(_Pb).addScaledVector(_Ab, -(K.d6 + K.tool));
    const t1 = Math.atan2(-_W.z, _W.x);
    const rho = Math.hypot(_W.x, _W.z);
    const xp = rho - K.a1;
    const yp = _W.y - K.d1;
    const L3 = Math.hypot(K.d4, K.a3);
    const psi = Math.atan2(K.a3, K.d4);
    const Kc = clamp((xp * xp + yp * yp - K.a2 * K.a2 - L3 * L3) / (2 * K.a2 * L3), -1, 1);
    const t3 = Math.asin(Kc) - psi;
    const qx = K.d4 * Math.cos(t3) - K.a3 * Math.sin(t3);
    const qy = K.a2 + K.d4 * Math.sin(t3) + K.a3 * Math.cos(t3);
    const t2 = Math.atan2(yp, xp) - Math.atan2(qy, qx);
    _q03.setFromAxisAngle(AY, t1).multiply(_qa.setFromAxisAngle(AZ, t2 + t3));
    _q03.invert();
    _a.copy(_Ab).applyQuaternion(_q03);
    let t5 = Math.atan2(Math.hypot(_a.y, _a.z), _a.x);
    let t4 = Math.atan2(_a.z, _a.y);
    if (t4 > Math.PI / 2) {
      t4 -= Math.PI;
      t5 = -t5;
    } else if (t4 < -Math.PI / 2) {
      t4 += Math.PI;
      t5 = -t5;
    }
    _y.set(Math.cos(t1), 0, -Math.sin(t1));
    _y.addScaledVector(_Ab, -_y.dot(_Ab)).normalize().applyQuaternion(_q03);
    _qb.setFromAxisAngle(AX, t4).multiply(_qa.setFromAxisAngle(AZ, t5)).invert();
    _y.applyQuaternion(_qb);
    const t6 = Math.atan2(_y.z, _y.y);
    out[0] = t1;
    out[1] = t2;
    out[2] = t3;
    out[3] = t4;
    out[4] = t5;
    out[5] = t6;
    return out;
  }

  const tipLocal = new THREE.Vector3(K.tool, 0, 0);
  function tipWorld(out = new THREE.Vector3()) {
    tool.updateWorldMatrix(true, false);
    return out.copy(tipLocal).applyMatrix4(tool.matrixWorld);
  }

  function setLed(on) {
    led.color.set(0xe8c547).multiplyScalar(on ? 2.6 : 0.2);
  }

  return { root, joints, setJoints, solve, tipWorld, setLed, q, materials: M, tool };
}
