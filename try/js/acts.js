import * as THREE from 'three';
import { HOME } from './arm.js';
import { TIMING } from './world.js';
import { smoothstep, easeInOutCubic, easeInOutSine, easeOutCubic, invLerp, lerp } from './util.js';

/*
 * The experience is four discrete acts. Each act is a pure function of its
 * local time t (seconds): params(ctx, t) returns every scene parameter and
 * shot(ctx, t) returns the camera shot. Jumping to any act/time is therefore
 * deterministic, which lets a later screen-by-screen UX drive the same scene.
 */

export function baseParams() {
  return {
    fade: 1,
    shadow: 1,
    partReveal: 2,
    partRevealOn: 0,
    iso: 0,
    isoSweep: 0,
    pathDraw: 0,
    pathProbeS: -1,
    pathAct3: 0,
    pathFade: 1,
    head: false,
    armVisible: false,
    armReveal: 4,
    armRevealOn: 0,
    q: HOME,
    led: false,
    coverS: 0,
    cscan: 0,
    glow: 0,
    scanNow: 0,
    zones: 0,
    marks: 0,
    leaders: 0,
    probe: null,
    contact: false,
    envRot: 0.4,
  };
}

const CENTER = new THREE.Vector3(0, 0.86, 0);
const _t = new THREE.Vector3();

const shot = (tx, ty, tz, az, el, radius, extra = {}) => ({
  target: new THREE.Vector3(tx, ty, tz),
  az,
  el,
  radius,
  fov: 30,
  ...extra,
});

export const ACTS = [
  {
    id: 'part',
    duration: 7.5,
    params(ctx, t) {
      const p = baseParams();
      p.fade = smoothstep(0, 0.9, t);
      p.partReveal = lerp(-0.06, 1.1, easeInOutSine(invLerp(0.45, 3.9, t)));
      p.partRevealOn = p.partReveal < 1.09 ? 1 : 0;
      p.shadow = smoothstep(0.8, 3.9, t);
      p.envRot = lerp(-1.1, 0.4, easeInOutSine(invLerp(0.3, 7.5, t)));
      return p;
    },
    shot(ctx, t) {
      const k = easeInOutCubic(invLerp(0, 7.5, t));
      return shot(0, 0.82, 0.02, lerp(1.1, 0.6, k), lerp(0.06, 0.42, easeInOutSine(invLerp(0.4, 7.2, t))), ctx.mobile ? 0.8 : 0.6, {
        distMul: lerp(1.45, 1.0, easeOutCubic(invLerp(0, 4.5, t))),
        offX: ctx.mobile ? 0 : -0.13,
        offY: ctx.mobile ? 0.16 : 0,
        omega: 2.2,
      });
    },
  },
  {
    id: 'path',
    duration: 9.5,
    params(ctx, t) {
      const p = baseParams();
      const total = ctx.world.traj.total;
      p.iso = smoothstep(0, 0.35, t) * (1 - 0.75 * smoothstep(7.9, 9.4, t));
      p.isoSweep = 1.05 * easeInOutSine(invLerp(0.05, 1.7, t));
      p.pathDraw = total * easeInOutSine(invLerp(1.7, 7.9, t));
      p.head = t > 1.7 && t < 8.1;
      p.envRot = lerp(0.4, 0.62, invLerp(0, 9.5, t));
      return p;
    },
    shot(ctx, t) {
      const k = easeInOutCubic(invLerp(0, 9.5, t));
      return shot(0, 0.84, 0.03, lerp(0.44, 0.14, k), lerp(0.76, 0.88, k), ctx.mobile ? 0.7 : 0.6, {
        offX: ctx.mobile ? 0 : -0.06,
        offY: ctx.mobile ? -0.06 : 0,
        omega: 1.8,
      });
    },
  },
  {
    id: 'scan',
    duration: 0,
    params(ctx, t) {
      const p = baseParams();
      const w = ctx.world;
      const total = w.traj.total;
      const pose = w.poseScan(t);
      p.armVisible = true;
      p.armReveal = lerp(-0.05, 2.45, easeOutCubic(invLerp(0, 1.5, t)));
      p.armRevealOn = t < 1.5 ? 1 : 0;
      p.q = pose.q;
      p.contact = pose.contact;
      p.led = pose.contact;
      p.pathDraw = total;
      p.pathAct3 = 1;
      p.pathProbeS = pose.s;
      p.coverS = pose.s;
      p.cscan = 1;
      p.glow = 1;
      p.scanNow = pose.s / total;
      p.probe = pose.X !== undefined ? [pose.X, pose.Y, pose.contact ? 1 : 0] : null;
      p.envRot = lerp(0.62, 0.95, invLerp(0, w.scanDuration, t));
      return p;
    },
    shot(ctx, t) {
      const w = ctx.world;
      const [d1, d2] = w.discoveryT;
      const m = ctx.mobile;
      if (t < 3.3) return shot(0.05, 1.02, -0.6, 0.92, 0.2, m ? 1.18 : 1.28, { omega: 2.0 });
      if (t < d2 - 0.9) {
        w.probeWorld(_t);
        _t.lerp(CENTER, 0.45);
        return shot(_t.x, _t.y, _t.z, 1.05, 0.38, m ? 0.62 : 0.66, { omega: 1.6 });
      }
      if (t < d2 + 2.3) {
        w.probeWorld(_t);
        _t.lerp(w.panel.indications[1].pos, 0.6);
        return shot(_t.x, _t.y, _t.z, 0.42, 0.8, m ? 0.56 : 0.54, { omega: 1.5 });
      }
      if (t < d1 - 1.4) return shot(0.0, 0.94, -0.28, -0.55, 0.6, m ? 0.98 : 1.0, { omega: 1.3 });
      if (t < d1 + 2.0) {
        w.probeWorld(_t);
        _t.lerp(w.panel.indications[0].pos, 0.6);
        return shot(_t.x, _t.y, _t.z, 0.3, 0.7, m ? 0.54 : 0.52, { omega: 1.5 });
      }
      return shot(0.03, 0.88, 0.0, 0.18, 0.86, m ? 0.72 : 0.78, { omega: 1.5 });
    },
  },
  {
    id: 'result',
    duration: 6,
    params(ctx, t) {
      const p = baseParams();
      const w = ctx.world;
      const pose = w.poseResult(t);
      p.armVisible = true;
      p.q = pose.q;
      p.pathDraw = w.traj.total;
      p.pathAct3 = 1;
      p.pathProbeS = w.traj.total + 1;
      p.pathFade = 0;
      p.coverS = w.traj.total;
      p.cscan = 1;
      p.glow = 1 - smoothstep(0, 1.2, t);
      p.scanNow = 1;
      p.marks = smoothstep(0.9, 2.0, t);
      p.leaders = smoothstep(1.0, 2.0, t);
      p.zones = smoothstep(1.2, 2.6, t);
      p.envRot = lerp(0.95, 1.1, invLerp(0, 6, t));
      return p;
    },
    shot(ctx, t) {
      const k = easeInOutSine(invLerp(0, 6, t));
      if (ctx.mobile) {
        return shot(0, 0.86, 0.02, lerp(0.02, 0.1, k), 1.1, 0.58, { offY: 0.24, omega: 1.9 });
      }
      return shot(0, 0.86, 0.0, lerp(0.0, 0.1, k), 1.12, 0.62, { offX: 0.15, frameW: 0.68, omega: 1.9 });
    },
  },
];

export function configureActs(world) {
  ACTS[2].duration = world.scanDuration;
  return ACTS;
}

/** Minimal act state machine: play / pause / goto / next / restart, auto-advance. */
export class Story {
  constructor(acts, { autoplay = true } = {}) {
    this.acts = acts;
    this.index = 0;
    this.t = 0;
    this.playing = autoplay;
    this.ended = false;
    this.hold = false;
    this.listeners = {};
  }
  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
    return this;
  }
  emit(name, ...args) {
    (this.listeners[name] || []).forEach((fn) => fn(...args));
  }
  get act() {
    return this.acts[this.index];
  }
  get progress() {
    return this.act.duration ? Math.min(1, this.t / this.act.duration) : 1;
  }
  tick(dt) {
    if (!this.playing) return;
    this.t += dt;
    const act = this.act;
    if (this.t < act.duration) return;
    if (this.index < this.acts.length - 1) {
      if (this.hold) {
        this.t = act.duration;
        return;
      }
      this.goto(this.index + 1);
    } else {
      this.t = act.duration;
      this.playing = false;
      this.ended = true;
      this.emit('state');
      this.emit('end');
    }
  }
  goto(i, t = 0) {
    const prev = this.index;
    this.index = Math.max(0, Math.min(this.acts.length - 1, i));
    this.t = Math.max(0, Math.min(t, this.act.duration));
    this.ended = false;
    this.emit('act', this.index, prev);
    this.emit('state');
  }
  next() {
    if (this.index < this.acts.length - 1) this.goto(this.index + 1);
  }
  play() {
    if (this.ended) return this.restart();
    this.playing = true;
    this.emit('state');
  }
  pause() {
    this.playing = false;
    this.emit('state');
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  restart() {
    this.playing = true;
    this.goto(0);
  }
}
