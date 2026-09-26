import * as THREE from 'three';
import { clamp, springStep } from './util.js';

/*
 * Cinematic camera rig. A "shot" describes where the camera wants to be
 * (orbit target, azimuth, elevation, framing radius, fov, lens shift).
 * Critically damped springs move the camera between shots. When the user
 * drags, the current shot is frozen and user offsets are layered on top
 * until recenter() or the next act.
 */
const KEYS = ['tx', 'ty', 'tz', 'az', 'el', 'dist', 'fov', 'offX', 'offY'];

export function fitDistance(radius, fovDeg, aspect) {
  const v = THREE.MathUtils.degToRad(fovDeg);
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return radius / Math.sin(Math.min(v, h) / 2);
}

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.s = {};
    for (const k of KEYS) this.s[k] = { x: 0, v: 0 };
    this.shot = null;
    this.locked = null;
    this.user = { daz: 0, del: 0, zoom: 1, vaz: 0 };
    this.pointers = new Map();
    this.dragging = false;
    this.onUser = null;
    this.enabled = true;
    this.aspect = 1;
    this.initialized = false;
    this._target = new THREE.Vector3();
    this._bind();
  }

  setShot(shot) {
    this.shot = shot;
  }

  desired() {
    const sh = this.shot;
    const base = this.locked || sh;
    const d = {
      tx: base.target.x,
      ty: base.target.y,
      tz: base.target.z,
      az: base.az + (this.locked ? this.user.daz : 0),
      el: clamp(base.el + (this.locked ? this.user.del : 0), 0.06, 1.38),
      dist: (this.locked ? this.locked.dist : fitDistance(sh.radius, sh.fov, this.aspect * (sh.frameW || 1)) * (sh.distMul || 1)) * (this.locked ? this.user.zoom : 1),
      fov: sh.fov,
      offX: sh.offX || 0,
      offY: sh.offY || 0,
    };
    return d;
  }

  snap() {
    if (!this.shot) return;
    const d = this.desired();
    for (const k of KEYS) {
      this.s[k].x = d[k];
      this.s[k].v = 0;
    }
    this.initialized = true;
  }

  lock() {
    if (this.locked) return;
    const s = this.s;
    this.locked = {
      target: new THREE.Vector3(s.tx.x, s.ty.x, s.tz.x),
      az: s.az.x,
      el: s.el.x,
      dist: s.dist.x,
    };
    this.user.daz = 0;
    this.user.del = 0;
    this.user.zoom = 1;
    if (this.onUser) this.onUser(true);
  }

  recenter() {
    this.locked = null;
    this.user.vaz = 0;
    if (this.onUser) this.onUser(false);
  }

  get isLocked() {
    return !!this.locked;
  }

  update(dt, width, height) {
    if (!this.shot) return;
    this.aspect = width / Math.max(height, 1);
    if (!this.initialized) this.snap();
    if (this.locked && !this.dragging && Math.abs(this.user.vaz) > 1e-4) {
      this.user.daz += this.user.vaz * dt;
      this.user.vaz *= Math.exp(-dt * 3.5);
    }
    const d = this.desired();
    const omega = this.dragging ? 10 : this.locked ? 7 : this.shot.omega || 2.4;
    for (const k of KEYS) springStep(this.s[k], d[k], omega, dt);
    const s = this.s;
    const cam = this.camera;
    const el = s.el.x;
    const az = s.az.x;
    this._target.set(s.tx.x, s.ty.x, s.tz.x);
    cam.position.set(
      this._target.x + s.dist.x * Math.cos(el) * Math.sin(az),
      this._target.y + s.dist.x * Math.sin(el),
      this._target.z + s.dist.x * Math.cos(el) * Math.cos(az)
    );
    cam.lookAt(this._target);
    cam.fov = s.fov.x;
    cam.aspect = this.aspect;
    const ox = s.offX.x * width;
    const oy = s.offY.x * height;
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) cam.setViewOffset(width, height, ox, oy, width, height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  _bind() {
    const el = this.dom;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let moved = 0;
    let pinch0 = 0;
    let zoom0 = 1;
    const dist2 = () => {
      const p = [...this.pointers.values()];
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {
        /* capture is best effort */
      }
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = performance.now();
      moved = 0;
      this.user.vaz = 0;
      if (this.pointers.size === 2) {
        this.lock();
        pinch0 = dist2();
        zoom0 = this.user.zoom;
      }
      this.dragging = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        const d = dist2();
        if (pinch0 > 0) this.user.zoom = clamp((zoom0 * pinch0) / d, 0.55, 1.8);
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) this.lock();
      if (!this.locked) return;
      const now = performance.now();
      const dtm = Math.max(1, now - lastT) / 1000;
      lastT = now;
      const k = e.pointerType === 'mouse' ? 0.0062 : 0.0075;
      this.user.daz -= dx * k;
      this.user.vaz = (-dx * k) / dtm;
      this.user.del = clamp(this.user.del + dy * k * 0.7, -1.2, 1.2);
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.dragging = false;
        if (performance.now() - lastT > 90) this.user.vaz = 0;
      }
      if (this.pointers.size < 2) pinch0 = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.lock();
        this.user.zoom = clamp(this.user.zoom * Math.exp(e.deltaY * 0.004), 0.55, 1.8);
      },
      { passive: false }
    );
  }
}
