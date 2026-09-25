/** Inspection parts — larger cell footprint, pose-aware, C-scan + rasters. */
import { clamp, norm3 } from './ik.js';

/** Centre of part top face — comfortable reach in front of base */
export const PART_ORIGIN = { x: 0.48, y: 0.0, z: 0 };
export const INDEX_STEP = 0.004;

export function defectField(u, v, partId) {
  /* P2.3 — defects sit on the engineer raster mid-pass so demo ALWAYS crosses one */
  let a = 0;
  const defects = {
    plate: [ /* FBH / inclusion — mid thickness */
      { u: 0.50, v: 0.50, r: 0.075, s: 1.0, depth: 0.006, kind: 'fbh' },
      { u: 0.62, v: 0.50, r: 0.045, s: 0.85, depth: 0.005, kind: 'inclusion' },
    ],
    pipe: [ /* wall loss — TOF */
      { u: 0.50, v: 0.50, r: 0.08, s: 0.98, depth: 0.003, kind: 'wall_loss' },
      { u: 0.62, v: 0.50, r: 0.055, s: 0.88, depth: 0.0035, kind: 'wall_loss' },
    ],
    aero: [ /* inclusion */
      { u: 0.50, v: 0.50, r: 0.07, s: 0.95, depth: 0.0025, kind: 'inclusion' },
      { u: 0.38, v: 0.50, r: 0.05, s: 0.85, depth: 0.0025, kind: 'inclusion' },
    ],
  };
  for (const d of defects[partId] || defects.aero) {
    const du = u - d.u, dv = v - d.v;
    const r2 = du * du + dv * dv;
    const rr = d.r * d.r;
    if (r2 < rr) a = Math.max(a, d.s * (1 - r2 / rr));
  }
  return a;
}

export function defectDepth(u, v, partId) {
  /* return depth of the strongest overlapping defect (m) */
  const defects = {
    plate: [
      { u: 0.50, v: 0.50, r: 0.075, depth: 0.006 },
      { u: 0.62, v: 0.50, r: 0.045, depth: 0.005 },
    ],
    pipe: [
      { u: 0.50, v: 0.50, r: 0.08, depth: 0.003 },
      { u: 0.62, v: 0.50, r: 0.055, depth: 0.0035 },
    ],
    aero: [
      { u: 0.50, v: 0.50, r: 0.07, depth: 0.0025 },
      { u: 0.38, v: 0.50, r: 0.05, depth: 0.0025 },
    ],
  };
  let best = null, bestA = 0;
  for (const d of defects[partId] || defects.aero) {
    const du = u - d.u, dv = v - d.v;
    const r2 = du * du + dv * dv;
    const rr = d.r * d.r;
    if (r2 < rr) {
      const a = 1 - r2 / rr;
      if (a > bestA) { bestA = a; best = d.depth; }
    }
  }
  return bestA > 0.2 ? best : null;
}

export function partMeta(partId) {
  const M = {
    plate: { label: '5 MHz · 0° · contact', mode: 'amplitude', thickness: 0.012, VL: 5920, att: 0.02, material: 'steel' },
    pipe: { label: '5 MHz · 0° · dual · thickness', mode: 'tof', thickness: 0.0071, VL: 5920, att: 0.025, material: 'steel' },
    aero: { label: '5 MHz · 0° · contact', mode: 'amplitude', thickness: 0.005, VL: 2950, att: 1.0, material: 'cfrp' },
  };
  return M[partId] || M.aero;
}

/** DA C-scan: dark base · sound = grey-blue · attenuated = amber · indication = gold/red-orange */
export function cscanColor(amp, mode = 'amplitude') {
  const t = Math.max(0, Math.min(1, amp));
  void mode;
  if (t < 0.18) return '#4a5568';       /* sound — neutral grey-blue */
  if (t < 0.42) return '#6b7a8d';       /* sound → soft atten */
  if (t < 0.62) return '#c48830';       /* attenuated — amber */
  if (t < 0.82) return '#e8a020';       /* strong atten / soft ind */
  return '#f04828';                     /* indication — bright red-orange */
}

function makeCscanTexture(THREE, w = 512, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return { canvas, ctx, tex, w, h, mode: 'amplitude' };
}

export function clearCscan(cs) {
  cs.ctx.fillStyle = '#1a1c22';
  cs.ctx.fillRect(0, 0, cs.w, cs.h);
  cs.ctx.strokeStyle = 'rgba(90,100,120,0.18)';
  cs.ctx.lineWidth = 1;
  const step = Math.max(10, Math.floor(cs.w / 20));
  for (let x = 0; x < cs.w; x += step) {
    cs.ctx.beginPath(); cs.ctx.moveTo(x, 0); cs.ctx.lineTo(x, cs.h); cs.ctx.stroke();
  }
  for (let y = 0; y < cs.h; y += step) {
    cs.ctx.beginPath(); cs.ctx.moveTo(0, y); cs.ctx.lineTo(cs.w, y); cs.ctx.stroke();
  }
  cs.tex.needsUpdate = true;
}

export function paintCscan(cs, u, v, amp, opts = {}) {
  const { indexStep = INDEX_STEP, skip = false, couplingLoss = false } = opts;
  if (skip) return;
  const x = Math.floor(u * cs.w);
  const y = Math.floor(v * cs.h);
  /* P2.4 — tighter spot; pedagogical colors; no soft-CND claim */
  const px = Math.max(cs.h <= 256 ? 7 : 6, Math.round((indexStep / 0.001) * (cs.w / (cs.h <= 256 ? 160 : 180))));
  if (couplingLoss) {
    cs.ctx.fillStyle = '#5a3010';
  } else {
    cs.ctx.fillStyle = cscanColor(amp, opts.mode || cs.mode);
  }
  cs.ctx.globalAlpha = 0.96;
  cs.ctx.beginPath();
  cs.ctx.arc(x, y, px, 0, Math.PI * 2);
  cs.ctx.fill();
  if (!couplingLoss && amp > 0.62) {
    cs.ctx.fillStyle = `rgba(240,72,40,${0.22 + (amp - 0.62) * 0.4})`;
    cs.ctx.beginPath();
    cs.ctx.arc(x, y, px * 1.35, 0, Math.PI * 2);
    cs.ctx.fill();
  } else if (!couplingLoss && amp > 0.18 && amp < 0.42) {
    cs.ctx.fillStyle = 'rgba(90,110,140,0.18)';
    cs.ctx.beginPath();
    cs.ctx.arc(x, y, px * 1.15, 0, Math.PI * 2);
    cs.ctx.fill();
  }
  cs.ctx.globalAlpha = 1;
  cs.tex.needsUpdate = true;
}

export function buildRaster(project, zone) {
  const { u0, u1, v0, v1 } = zone;
  const pts = [];
  const nPass = 3;
  const nAlong = 6;
  for (let i = 0; i < nPass; i++) {
    const tv = nPass === 1 ? 0.5 : i / (nPass - 1);
    const v = v0 + (v1 - v0) * tv;
    const forward = i % 2 === 0;
    for (let j = 0; j < nAlong; j++) {
      const tu = (forward ? j : (nAlong - 1 - j)) / (nAlong - 1);
      const u = u0 + (u1 - u0) * tu;
      const p = project(u, v, true);
      if (p && p.ok) pts.push(p);
    }
  }
  return pts;
}

function metalMat(THREE) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x7a7a80, metalness: 0.55, roughness: 0.42,
    clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.45,
  });
}

function overlayMat(THREE, cs) {
  return new THREE.MeshBasicMaterial({
    map: cs.tex,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function makePoseApi(g, PART_ORIGIN, projectLocal, extras = {}) {
  const pose = { dx: 0, dz: 0, yaw: 0 };
  function applyGroup() {
    g.position.set(PART_ORIGIN.x + pose.dx, 0, PART_ORIGIN.z + pose.dz);
    g.rotation.set(0, pose.yaw, 0);
    g.updateMatrixWorld(true);
  }
  applyGroup();

  function localToWorld(lx, ly, lz) {
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const rx = c * lx - s * lz;
    const rz = s * lx + c * lz;
    return {
      x: PART_ORIGIN.x + pose.dx + rx,
      y: ly,
      z: PART_ORIGIN.z + pose.dz + rz,
    };
  }
  function rotateNormal(n) {
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    return norm3({ x: c * n.x - s * n.z, y: n.y, z: s * n.x + c * n.z });
  }
  function worldToLocal(wx, wz) {
    const dx = wx - (PART_ORIGIN.x + pose.dx);
    const dz = wz - (PART_ORIGIN.z + pose.dz);
    const c = Math.cos(-pose.yaw), s = Math.sin(-pose.yaw);
    return { x: c * dx - s * dz, z: s * dx + c * dz };
  }

  function project(x, z, uvSpace) {
    let loc;
    if (uvSpace) {
      loc = projectLocal(x, z, true);
    } else {
      /* world xz → local (part may be translated / yawed) */
      const wl = worldToLocal(x, z);
      loc = projectLocal(wl.x, wl.z, false);
    }
    if (!loc || !loc.ok) return loc;
    const w = localToWorld(loc.lx, loc.ly, loc.lz);
    const n = rotateNormal(loc.normal);
    return { x: w.x, y: w.y, z: w.z, normal: n, u: loc.u, v: loc.v, ok: true };
  }

  function setPose({ dx = pose.dx, dz = pose.dz, yaw = pose.yaw } = {}) {
    pose.dx = dx; pose.dz = dz; pose.yaw = yaw;
    applyGroup();
  }
  function getPose() { return { ...pose }; }
  function resetPose() { setPose({ dx: 0, dz: 0, yaw: 0 }); }

  return {
    group: g, pose, setPose, getPose, resetPose,
    localToWorld, worldToLocal, rotateNormal, project,
    ...extras,
  };
}

function buildPlate(THREE) {
  const g = new THREE.Group();
  /* ~2× v4 footprint */
  const W = 0.68, D = 0.44, T = 0.016;
  const cs = makeCscanTexture(THREE, 512, 512);
  clearCscan(cs);
  const plateMat = metalMat(THREE);
  plateMat.emissiveMap = cs.tex;
  plateMat.emissive = new THREE.Color(0x3a4050);
  plateMat.emissiveIntensity = 0.22;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, T, D), plateMat);
  mesh.position.set(0, T / 2, 0);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);

  const beadPts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    beadPts.push(new THREE.Vector3(
      -W * 0.38 + t * W * 0.76,
      T + 0.0025,
      Math.sin(t * Math.PI * 3) * 0.0015,
    ));
  }
  const bead = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(beadPts), 48, 0.004, 8, false),
    new THREE.MeshPhysicalMaterial({
      color: 0x6a6a70, metalness: 0.7, roughness: 0.35,
      emissive: 0x2a2208, emissiveIntensity: 0.08,
    }),
  );
  bead.castShadow = true;
  g.add(bead);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W, T, D)),
    new THREE.LineBasicMaterial({ color: 0xc4a040 }),
  );
  edge.position.copy(mesh.position);
  g.add(edge);

  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.96, D * 0.96), overlayMat(THREE, cs));
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.set(0, T + 0.006, 0);
  overlay.renderOrder = 10;
  g.add(overlay);

  function projectLocal(x, z, uvSpace) {
    if (uvSpace) {
      const u = x, v = z;
      const lx = -W / 2 + u * W;
      const lz = D / 2 - v * D;
      return { lx, ly: T, lz, normal: { x: 0, y: 1, z: 0 }, u, v, ok: true };
    }
    const hx = W / 2 - 0.012, hz = D / 2 - 0.012;
    const lx = clamp(x, -hx, hx);
    const lz = clamp(z, -hz, hz);
    const u = (lx + W / 2) / W;
    const v = (D / 2 - lz) / D;
    return { lx, ly: T, lz, normal: { x: 0, y: 1, z: 0 }, u, v, ok: true };
  }

  const api = makePoseApi(g, PART_ORIGIN, projectLocal, {
    id: 'plate', mesh, cs,
    clear() { clearCscan(cs); },
    size: { W, D, T },
  });
  api.rasterPath = () => buildRaster(api.project, { u0: 0.30, u1: 0.70, v0: 0.34, v1: 0.66 });
  api.defaultPath = () => api.rasterPath();
  api.hitTest = (raycaster) => {
    const hits = raycaster.intersectObject(mesh, false);
    if (!hits.length) return null;
    return api.project(hits[0].point.x, hits[0].point.z, false);
  };
  api.center = () => {
    const p = api.getPose();
    return { x: PART_ORIGIN.x + p.dx, y: T, z: PART_ORIGIN.z + p.dz };
  };
  return api;
}

function buildPipe(THREE) {
  const g = new THREE.Group();
  /* P3.1 — OD ceiling ~1.80× of 6" sch40 (R0.084→0.151, OD≈302 mm); tip+normal OK on demo raster */
  const R = 0.151, L = 0.52, wall = 0.0071;
  const cs = makeCscanTexture(THREE, 512, 256);
  cs.mode = 'tof';
  clearCscan(cs);
  const pipeMat = new THREE.MeshPhysicalMaterial({
    color: 0x6a6a70, roughness: 0.45, metalness: 0.5,
    clearcoat: 0.18, clearcoatRoughness: 0.5,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 64), pipeMat);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(0, R, 0);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);

  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(R - wall, R - wall, L * 0.98, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9, metalness: 0.1, side: THREE.BackSide }),
  );
  inner.rotation.z = Math.PI / 2;
  inner.position.copy(mesh.position);
  g.add(inner);

  const bandGeo = new THREE.CylinderGeometry(R + 0.004, R + 0.004, L * 0.94, 64, 1, true, -0.9, 1.8);
  {
    const uv = bandGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, v, 1 - u);
    }
    uv.needsUpdate = true;
  }
  const band = new THREE.Mesh(bandGeo, overlayMat(THREE, cs));
  band.rotation.z = Math.PI / 2;
  band.position.copy(mesh.position);
  band.renderOrder = 10;
  g.add(band);

  /* Analytical cylinder normals — ang=0 at top (+Y) */
  function projectLocal(x, z, uvSpace) {
    if (uvSpace) {
      const u = x, v = z;
      const ang = (-0.35 + v * 0.70);
      const along = -L / 2 + u * L;
      const lx = along;
      const ly = R * Math.cos(ang);
      const lz = R * Math.sin(ang);
      return {
        lx, ly, lz,
        normal: norm3({ x: 0, y: Math.cos(ang), z: Math.sin(ang) }),
        u, v, ok: true,
      };
    }
    /* Infer angle from local z/y of a surface hit, or from xz plane sample */
    const along = clamp(x, -L / 2 + 0.015, L / 2 - 0.015);
    const u = (along + L / 2) / L;
    /* If z looks like a lateral offset on the cylinder, recover ang */
    const ang = clamp(Math.atan2(z, R), -0.35, 0.35);
    const v = clamp((ang + 0.35) / 0.70, 0, 1);
    return projectLocal(u, v, true);
  }

  const api = makePoseApi(g, PART_ORIGIN, projectLocal, {
    id: 'pipe', mesh, cs,
    clear() { clearCscan(cs); },
    size: { R, L, wall },
  });
  api.rasterPath = () => buildRaster(api.project, { u0: 0.30, u1: 0.70, v0: 0.35, v1: 0.65 });
  api.defaultPath = () => api.rasterPath();
  api.hitTest = (raycaster) => {
    const hits = raycaster.intersectObject(mesh, false);
    if (!hits.length) return null;
    const pt = hits[0].point;
    const loc = api.worldToLocal(pt.x, pt.z);
    /* Recover cylinder angle in local frame (before pose) using world Y and local z */
    const pose = api.getPose();
    const c = Math.cos(-pose.yaw), s = Math.sin(-pose.yaw);
    const dx = pt.x - (PART_ORIGIN.x + pose.dx);
    const dz = pt.z - (PART_ORIGIN.z + pose.dz);
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    const ly = pt.y;
    const along = clamp(lx, -L / 2 + 0.015, L / 2 - 0.015);
    const ang = Math.atan2(lz, ly);
    const u = (along + L / 2) / L;
    const v = clamp((ang + 0.35) / 0.70, 0, 1);
    return api.project(u, v, true);
  };
  api.center = () => {
    const p = api.getPose();
    return { x: PART_ORIGIN.x + p.dx, y: R, z: PART_ORIGIN.z + p.dz };
  };
  return api;
}

function buildAero(THREE) {
  const g = new THREE.Group();
  /* Readable curvature — radius ~1.1 m so normals lean visibly */
  const Rcurv = 1.15;
  const W = 0.68, D = 0.44, T = 0.008;
  const cs = makeCscanTexture(THREE, 512, 512);
  clearCscan(cs);

  const nu = 40, nv = 28;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const ovPos = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const z = -D / 2 + v * D;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const x = -W / 2 + u * W;
      const yy = Rcurv - Math.sqrt(Math.max(1e-8, Rcurv * Rcurv - x * x));
      const nx = x / Rcurv;
      const ny = Math.sqrt(Math.max(0, 1 - nx * nx));
      positions.push(x, T + yy, z);
      ovPos.push(x + nx * 0.0025, T + yy + ny * 0.0025, z);
      normals.push(nx, ny, 0);
      uvs.push(u, 1 - v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      indices.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x6e6e74, roughness: 0.48, metalness: 0.28,
    clearcoat: 0.55, clearcoatRoughness: 0.25,
    envMapIntensity: 0.9,
    side: THREE.DoubleSide,
  });
  mat.emissiveMap = cs.tex;
  mat.emissive = new THREE.Color(0x3a4050);
  mat.emissiveIntensity = 0.22;
  mat.map = cs.tex;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);

  const rimGeo = new THREE.BoxGeometry(W * 0.98, T * 2.2, 0.004);
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: 0x1c1c1e, metalness: 0.4, roughness: 0.45, clearcoat: 0.3,
  });
  for (const zSign of [-1, 1]) {
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(0, T / 2, zSign * (D / 2));
    rim.castShadow = true;
    g.add(rim);
  }

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xc4a035 }),
  );
  g.add(edge);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.88, 0.024, D * 0.58),
    new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.7, metalness: 0.2 }),
  );
  frame.position.set(0, 0.012, 0);
  frame.receiveShadow = true;
  g.add(frame);

  const ovGeo = new THREE.BufferGeometry();
  ovGeo.setAttribute('position', new THREE.Float32BufferAttribute(ovPos, 3));
  ovGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  ovGeo.setIndex(indices);
  ovGeo.computeVertexNormals();
  const overlay = new THREE.Mesh(ovGeo, overlayMat(THREE, cs));
  overlay.renderOrder = 10;
  g.add(overlay);

  function projectLocal(x, z, uvSpace) {
    if (uvSpace) {
      const u = x, v = z;
      const lx = -W / 2 + u * W;
      const lz = -D / 2 + v * D;
      const yy = Rcurv - Math.sqrt(Math.max(1e-8, Rcurv * Rcurv - lx * lx));
      const nx = lx / Rcurv;
      const ny = Math.sqrt(Math.max(0, 1 - nx * nx));
      return {
        lx, ly: T + yy, lz,
        normal: norm3({ x: nx, y: ny, z: 0 }),
        u, v, ok: true,
      };
    }
    const lx = clamp(x, -W / 2 + 0.012, W / 2 - 0.012);
    const lz = clamp(z, -D / 2 + 0.012, D / 2 - 0.012);
    const u = (lx + W / 2) / W;
    const v = (lz + D / 2) / D;
    return projectLocal(u, v, true);
  }

  const api = makePoseApi(g, PART_ORIGIN, projectLocal, {
    id: 'aero', mesh, cs,
    clear() { clearCscan(cs); },
    size: { W, D, T, Rcurv },
  });
  api.rasterPath = () => buildRaster(api.project, { u0: 0.28, u1: 0.72, v0: 0.32, v1: 0.68 });
  api.defaultPath = () => api.rasterPath();
  api.hitTest = (raycaster) => {
    const hits = raycaster.intersectObject(mesh, false);
    if (!hits.length) return null;
    return api.project(hits[0].point.x, hits[0].point.z, false);
  };
  api.center = () => {
    const p = api.getPose();
    return { x: PART_ORIGIN.x + p.dx, y: T + 0.02, z: PART_ORIGIN.z + p.dz };
  };
  return api;
}

export function createPartLibrary(THREE) {
  return {
    plate: buildPlate(THREE),
    pipe: buildPipe(THREE),
    aero: buildAero(THREE),
  };
}
