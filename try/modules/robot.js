/**
 * Premium UR-type cobot — DH-nested (Z-up → Y-up), satin graphite + gold.
 * Joint1 visual uses q1+π so flange origin matches analytic forward().
 * Tool orientation / TCP from fkYUp (logic untouched).
 */
import { ARM, BASE, HOME_JOINTS, fkYUp } from './ik.js';

export function buildRobot(THREE) {
  const root = new THREE.Group();
  root.position.set(BASE.x, BASE.y, BASE.z);

  /* v4: matte anthracite / brushed alu — no toy gold rings on every joint */
  const graphite = new THREE.MeshPhysicalMaterial({
    color: 0x2c2c2e, metalness: 0.48, roughness: 0.48,
    clearcoat: 0.18, clearcoatRoughness: 0.55, envMapIntensity: 0.55,
  });
  const mid = new THREE.MeshPhysicalMaterial({
    color: 0x3a3a3e, metalness: 0.42, roughness: 0.52,
    clearcoat: 0.12, clearcoatRoughness: 0.6, envMapIntensity: 0.5,
  });
  const cap = new THREE.MeshPhysicalMaterial({
    color: 0x6e6e74, metalness: 0.55, roughness: 0.38,
    clearcoat: 0.2, clearcoatRoughness: 0.45, envMapIntensity: 0.65,
  });
  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xe8c547, metalness: 0.85, roughness: 0.28,
    emissive: 0x3a2e08, emissiveIntensity: 0.12,
  });
  const dark = new THREE.MeshPhysicalMaterial({
    color: 0x161618, metalness: 0.35, roughness: 0.58, clearcoat: 0.1,
  });
  const shoeMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a3834, metalness: 0.22, roughness: 0.55, clearcoat: 0.1,
  });
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.88, metalness: 0.05 });
  const springMat = new THREE.MeshPhysicalMaterial({
    color: 0x5a5a60, metalness: 0.5, roughness: 0.4,
  });

  function cyl(r, h, mat, segs = 40) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.abs(h), segs), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function drumZ(r, h, mat) {
    const m = cyl(r, h, mat);
    m.rotation.x = Math.PI / 2; /* axis → local Z */
    return m;
  }
  function ringZ(r, t, mat) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 14, 40), mat);
    m.castShadow = true;
    return m; /* torus in XY → around Z */
  }
  function tubeX(r, len, mat) {
    const L = Math.abs(len);
    const m = cyl(r, L, mat, 36);
    m.rotation.z = Math.PI / 2;
    m.position.x = len / 2;
    return m;
  }

  const { d1, a2, a3, d4, d5, d6, toolLen } = ARM;

  /* Scene Y-up ← robot Z-up */
  const zUp = new THREE.Group();
  zUp.rotation.x = -Math.PI / 2;
  root.add(zUp);

  /* Base */
  {
    const plate = drumZ(0.12, 0.02, dark);
    plate.position.z = 0.01;
    zUp.add(plate);
    const body = drumZ(0.075, 0.09, graphite);
    body.position.z = 0.02 + 0.045;
    zUp.add(body);
    const c = drumZ(0.072, 0.014, cap);
    c.position.z = 0.02 + 0.09 + 0.005;
    zUp.add(c);
  }

  /* ── DH chain ── */
  const j1 = new THREE.Group();
  zUp.add(j1);
  {
    const h = drumZ(0.07, 0.095, mid);
    h.position.z = d1 * 0.55;
    j1.add(h);
  }

  const a1 = new THREE.Group();
  a1.position.z = d1;
  a1.rotation.x = Math.PI / 2;
  j1.add(a1);

  const j2 = new THREE.Group();
  a1.add(j2);
  {
    const sh = drumZ(0.072, 0.14, graphite);
    j2.add(sh);
    const c1 = drumZ(0.07, 0.014, cap); c1.position.z = 0.074; j2.add(c1);
    const c2 = drumZ(0.07, 0.014, cap); c2.position.z = -0.074; j2.add(c2);
    j2.add(tubeX(0.045, a2, mid)); /* a2 < 0 */
    const rail = tubeX(0.006, a2 * 0.88, cap);
    rail.position.y = 0.04;
    j2.add(rail);
  }

  const j3 = new THREE.Group();
  j3.position.x = a2;
  j2.add(j3);
  {
    const el = drumZ(0.065, 0.12, graphite);
    j3.add(el);
    const c1 = drumZ(0.063, 0.012, cap); c1.position.z = 0.064; j3.add(c1);
    const c2 = drumZ(0.063, 0.012, cap); c2.position.z = -0.064; j3.add(c2);
    j3.add(tubeX(0.038, a3, mid));
    const rail = tubeX(0.0055, a3 * 0.85, cap);
    rail.position.y = 0.034;
    j3.add(rail);
  }

  const j4 = new THREE.Group();
  j4.position.x = a3;
  j3.add(j4);
  {
    const w = drumZ(0.048, 0.095, graphite);
    j4.add(w);
    const sleeve = drumZ(0.04, d4 * 0.9, mid);
    sleeve.position.z = d4 * 0.42;
    j4.add(sleeve);
  }

  const a4 = new THREE.Group();
  a4.position.z = d4;
  a4.rotation.x = Math.PI / 2;
  j4.add(a4);

  const j5 = new THREE.Group();
  a4.add(j5);
  {
    const w = drumZ(0.046, 0.09, dark);
    j5.add(w);
    const sleeve = drumZ(0.038, d5 * 0.75, graphite);
    sleeve.position.z = d5 * 0.35;
    j5.add(sleeve);
  }

  const a5 = new THREE.Group();
  a5.position.z = d5;
  a5.rotation.x = -Math.PI / 2;
  j5.add(a5);

  const j6 = new THREE.Group();
  a5.add(j6);
  {
    const w = drumZ(0.042, 0.065, graphite);
    j6.add(w);
  }

  const flangeNest = new THREE.Group();
  flangeNest.position.z = d6;
  j6.add(flangeNest);
  {
    const disc = drumZ(0.036, 0.016, cap);
    flangeNest.add(disc);
  }

  /* Tool — parented to root, posed from FK each frame */
  const toolRoot = new THREE.Group();
  root.add(toolRoot);

  const tool = new THREE.Group();
  toolRoot.add(tool);

  const holder = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.052, 0.042), dark);
  holder.position.y = 0.028;
  holder.castShadow = true;
  tool.add(holder);
  /* Single DA gold accent — thin ring on the probe holder */
  const holderGold = new THREE.Mesh(new THREE.BoxGeometry(0.050, 0.0035, 0.044), gold);
  holderGold.position.y = 0.048;
  holderGold.castShadow = true;
  tool.add(holderGold);

  const springPts = [];
  for (let i = 0; i <= 56; i++) {
    const t = i / 56;
    const ang = t * 7 * Math.PI * 2;
    springPts.push(new THREE.Vector3(
      Math.cos(ang) * 0.015,
      0.06 + t * 0.042,
      Math.sin(ang) * 0.015,
    ));
  }
  const spring = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(springPts), 72, 0.003, 7, false),
    springMat,
  );
  spring.castShadow = true;
  tool.add(spring);

  const gimbal = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0035, 12, 28), cap);
  gimbal.rotation.x = Math.PI / 2;
  gimbal.position.y = 0.088;
  tool.add(gimbal);

  const shoePivot = new THREE.Group();
  shoePivot.position.y = 0.105;
  shoePivot.rotation.z = -(ARM.toolTilt || 0);
  tool.add(shoePivot);

  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.02, 0.034), shoeMat);
  shoe.position.y = 0.012;
  shoe.castShadow = true;
  shoePivot.add(shoe);

  const probe = cyl(0.011, 0.058, graphite, 20);
  probe.position.y = 0.05;
  shoePivot.add(probe);
  const probeTip = cyl(0.012, 0.024, gold, 16);
  probeTip.position.y = 0.090;
  shoePivot.add(probeTip);
  /* v5b: bright tip marker — must read on phone mid-scan */
  const tipHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }),
  );
  tipHalo.position.y = 0.098;
  tipHalo.renderOrder = 20;
  tipHalo.userData.framingIgnore = true;
  shoePivot.add(tipHalo);

  const hose = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.02, 0.05, 0.012),
        new THREE.Vector3(0.055, 0.02, 0.035),
        new THREE.Vector3(0.05, -0.04, 0.05),
        new THREE.Vector3(0.025, -0.10, 0.02),
      ]),
      40, 0.005, 8, false,
    ),
    hoseMat,
  );
  hose.userData.framingIgnore = true;
  tool.add(hose);

  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.0065, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0x333333 }),
  );
  led.position.set(0.026, 0.04, 0);
  tool.add(led);

  const tip = new THREE.Object3D();
  tip.position.y = toolLen;
  tool.add(tip);
  /* P3.3 — TCP bead mate: material contrast (brass), not glow/emissive candy */
  const tcpBead = new THREE.Mesh(
    new THREE.SphereGeometry(0.0135, 20, 20),
    new THREE.MeshStandardMaterial({
      color: 0xb8922e, roughness: 0.78, metalness: 0.32,
    }),
  );
  tcpBead.castShadow = true;
  tcpBead.receiveShadow = true;
  tcpBead.userData.framingIgnore = true;
  tip.add(tcpBead);
  const tcpRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.0175, 0.002, 8, 28),
    new THREE.MeshStandardMaterial({
      color: 0x2c2c30, roughness: 0.55, metalness: 0.45,
    }),
  );
  tcpRing.rotation.x = Math.PI / 2;
  tcpRing.castShadow = true;
  tcpRing.userData.framingIgnore = true;
  tip.add(tcpRing);

  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  let _q = HOME_JOINTS.slice();
  let _contact = { x: 0, y: -1, z: 0 };

  function setJoints(q) {
    _q = q.slice();
    /* q1+π aligns nested flange origin with analytic forward() */
    j1.rotation.z = q[0] + Math.PI;
    j2.rotation.z = q[1];
    j3.rotation.z = q[2];
    j4.rotation.z = q[3];
    j5.rotation.z = q[4];
    j6.rotation.z = q[5];

    const pose = fkYUp(q);
    toolRoot.position.set(pose.flange.x, pose.flange.y, pose.flange.z);
    /* local +Y of toolRoot = approach (toward TCP) */
    _y.set(pose.approach.x, pose.approach.y, pose.approach.z).normalize();
    _x.set(1, 0, 0);
    if (Math.abs(_y.dot(_x)) > 0.9) _x.set(0, 0, 1);
    _z.crossVectors(_x, _y).normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    toolRoot.quaternion.setFromRotationMatrix(_m);
  }

  function getTipWorld(out = new THREE.Vector3()) {
    const p = fkYUp(_q).tcp;
    out.set(p.x, p.y, p.z);
    return out;
  }
  const _probeAxis = new THREE.Vector3();
  const _probeQ = new THREE.Quaternion();
  /** World +Y of shoe/probe (surface contact axis, counter-tilted vs flange). */
  function getProbeAxis(out = new THREE.Vector3()) {
    shoePivot.updateWorldMatrix(true, false);
    shoePivot.getWorldQuaternion(_probeQ);
    _probeAxis.set(0, 1, 0).applyQuaternion(_probeQ).normalize();
    out.copy(_probeAxis);
    return out;
  }
  function getApproach() { return { ..._contact }; }
  function setContactDir(v) { if (v) _contact = { x: v.x, y: v.y, z: v.z }; }
  function setLed(on) { led.material.color.set(on ? 0xe8c547 : 0x333333); }
  function setContact(on) {
    if (probeTip.material?.color) probeTip.material.color.set(on ? 0xf3d56a : 0xe8c547);
  }
  function getBounds(extraGroup) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.min.y < -0.02) box.min.y = -0.02;
    if (extraGroup && extraGroup.visible !== false) {
      extraGroup.updateWorldMatrix(true, true);
      box.expandByObject(extraGroup);
    }
    return box;
  }

  setJoints(HOME_JOINTS);

  return {
    root, tip, tool,
    joints: [j1, j2, j3, j4, j5, j6],
    setJoints, getTipWorld, getProbeAxis, getApproach, setContactDir, setLed, setContact, getBounds,
    HOME: HOME_JOINTS.slice(),
  };
}
