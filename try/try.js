/**
 * ROBINSPECT · Try the idea
 * Vanilla Three.js port of Grok Build kinema (cobot + plate waypoints).
 * Three r160 CDN + MiniOrbit (OrbitControls classic build removed in r160).
 */
(function () {
  "use strict";

  var CDN_THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";

  /* ── constants ─────────────────────────────────────────── */
  var BASE = { x: -0.24, y: 0, z: 0 };
  var ARM = {
    d1: 0.148,
    a2: 0.42,
    a3: 0.348,
    d4: 0.072,
    d6: 0.112,
    baseRadius: 0.078,
  };
  var PLATE = { cx: 0.32, cz: 0, y: 0.01, width: 0.4, depth: 0.28, margin: 0.018 };
  var TABLE = { width: 1.18, depth: 0.72, thickness: 0.038, leg: 0.68 };
  var MOTION = { hover: 0.13, tcpSpeed: 0.42, airSpeed: 0.55, maxWaypoints: 24 };
  var HOME_JOINTS = [0.1289, 0.8465, -1.4964, 0, -0.9209, 0];
  var JOINT_SMOOTH = 10; /* ~10 Hz exponential toward IK */

  /* ── i18n (from data-lang on #try-root) ─────────────────── */
  var I18N = {
    en: {
      hintIdle: "Click the plate to place waypoints",
      hintIdleTouch: "Tap the plate to place waypoints · two fingers to orbit",
      hintReady: "Press Play to run the arm",
      hintReadyTouch: "Tap Play to run the arm · two fingers to orbit",
      hintPlay: "Cobot executing",
      hintPause: "Paused",
      hintDone: "Trajectory complete",
      play: "Play",
      pause: "Pause",
      stop: "Stop",
      undo: "Undo",
      clear: "Clear",
      speed: "Speed",
      presets: {
        star: "Star",
        circle: "Circle",
        square: "Square",
        infinity: "Infinity",
        heart: "Heart",
        wave: "Wave",
      },
    },
    fr: {
      hintIdle: "Cliquez la plaque pour poser un point",
      hintIdleTouch: "Touchez la plaque pour poser un point · deux doigts pour orbiter",
      hintReady: "Lecture pour lancer le bras",
      hintReadyTouch: "Touchez Lecture · deux doigts pour orbiter",
      hintPlay: "Le cobot exécute",
      hintPause: "En pause",
      hintDone: "Trajectoire terminée",
      play: "Lecture",
      pause: "Pause",
      stop: "Stop",
      undo: "Annuler",
      clear: "Effacer",
      speed: "Vitesse",
      presets: {
        star: "Étoile",
        circle: "Cercle",
        square: "Carré",
        infinity: "Infini",
        heart: "Cœur",
        wave: "Vague",
      },
    },
  };


  /** Minimal orbit — mouse drag / two-finger touch (pinch zoom). */
  function MiniOrbit(camera, dom, THREE, opts) {
    opts = opts || {};
    var target = new THREE.Vector3(0.12, 0.12, 0);
    var spherical = new THREE.Spherical();
    var offset = new THREE.Vector3();
    offset.copy(camera.position).sub(target);
    spherical.setFromVector3(offset);
    var minPolar = 0.35,
      maxPolar = Math.PI / 2.15,
      minDist = 0.9,
      maxDist = 3.8;
    var enabled = true;
    var pointers = new Map();
    var rotating = false;
    var pending = false;
    var lastX = 0,
      lastY = 0;
    var pinchStart = 0;
    var sphDelta = { theta: 0, phi: 0 };
    var scale = 1;

    function isCoarse() {
      return !!(opts.isCoarse && opts.isCoarse());
    }
    function plateOwns() {
      return !!(opts.plateOwns && opts.plateOwns());
    }

    function onDown(e) {
      if (!enabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        dom.setPointerCapture(e.pointerId);
      } catch (err) {}

      if (isCoarse()) {
        /* touch: orbit only with 2+ fingers */
        pending = false;
        rotating = pointers.size >= 2 && !plateOwns();
        if (pointers.size >= 2) {
          var pts = Array.from(pointers.values());
          lastX = (pts[0].x + pts[1].x) / 2;
          lastY = (pts[0].y + pts[1].y) / 2;
          pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        }
        return;
      }

      /* mouse / fine pointer: single-drag orbit if plate does not own */
      if (plateOwns()) {
        pending = false;
        rotating = false;
        return;
      }
      pending = true;
      rotating = false;
      lastX = e.clientX;
      lastY = e.clientY;
    }

    function onMove(e) {
      if (!enabled || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (isCoarse()) {
        if (pointers.size < 2 || plateOwns()) {
          rotating = false;
          return;
        }
        var pts = Array.from(pointers.values());
        var mx = (pts[0].x + pts[1].x) / 2;
        var my = (pts[0].y + pts[1].y) / 2;
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        if (!rotating) {
          rotating = true;
          lastX = mx;
          lastY = my;
          pinchStart = dist;
          return;
        }
        var dx = mx - lastX;
        var dy = my - lastY;
        lastX = mx;
        lastY = my;
        sphDelta.theta -= (2 * Math.PI * dx) / Math.max(dom.clientHeight, 1);
        sphDelta.phi -= (2 * Math.PI * dy) / Math.max(dom.clientHeight, 1);
        var ratio = dist / (pinchStart || 1);
        if (Math.abs(ratio - 1) > 0.01) {
          scale *= ratio > 1 ? 0.96 : 1.04;
          pinchStart = dist;
        }
        return;
      }

      if (plateOwns()) {
        pending = false;
        rotating = false;
        return;
      }
      if (pending) {
        var adx = e.clientX - lastX;
        var ady = e.clientY - lastY;
        if (Math.hypot(adx, ady) > 4) {
          rotating = true;
          pending = false;
          lastX = e.clientX;
          lastY = e.clientY;
        }
        return;
      }
      if (!rotating) return;
      var mdx = e.clientX - lastX;
      var mdy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      sphDelta.theta -= (2 * Math.PI * mdx) / Math.max(dom.clientHeight, 1);
      sphDelta.phi -= (2 * Math.PI * mdy) / Math.max(dom.clientHeight, 1);
    }

    function onUp(e) {
      pointers.delete(e.pointerId);
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (pointers.size < 2) {
        rotating = false;
        pinchStart = 0;
      }
      if (pointers.size === 0) {
        pending = false;
        rotating = false;
      } else if (pointers.size === 1 && isCoarse()) {
        rotating = false;
      }
    }

    function onWheel(e) {
      if (!enabled || plateOwns()) return;
      e.preventDefault();
      scale *= e.deltaY > 0 ? 1.08 : 0.92;
    }

    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    return {
      get enabled() {
        return enabled;
      },
      set enabled(v) {
        enabled = !!v;
        if (!enabled) {
          rotating = false;
          pending = false;
          pointers.clear();
        }
      },
      target: target,
      update: function () {
        offset.copy(camera.position).sub(target);
        spherical.setFromVector3(offset);
        spherical.theta += sphDelta.theta;
        spherical.phi += sphDelta.phi;
        sphDelta.theta *= 0.72;
        sphDelta.phi *= 0.72;
        if (Math.abs(sphDelta.theta) < 1e-5) sphDelta.theta = 0;
        if (Math.abs(sphDelta.phi) < 1e-5) sphDelta.phi = 0;
        spherical.phi = Math.max(minPolar, Math.min(maxPolar, spherical.phi));
        spherical.radius = Math.max(minDist, Math.min(maxDist, spherical.radius * scale));
        scale = 1;
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
      },
    };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Failed " + src));
      };
      document.head.appendChild(s);
    });
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function wrapAngle(a) {
    var x = a;
    while (x > Math.PI) x -= Math.PI * 2;
    while (x < -Math.PI) x += Math.PI * 2;
    return x;
  }
  function lerpAngle(a, b, t) {
    return a + wrapAngle(b - a) * t;
  }
  function clampPlate(x, z) {
    var hx = PLATE.width / 2 - PLATE.margin;
    var hz = PLATE.depth / 2 - PLATE.margin;
    return {
      x: clamp(x, PLATE.cx - hx, PLATE.cx + hx),
      z: clamp(z, PLATE.cz - hz, PLATE.cz + hz),
    };
  }

  /* ── IK / FK ───────────────────────────────────────────── */
  function fk(joints) {
    var j1 = joints[0],
      j2 = joints[1],
      j3 = joints[2],
      j5 = joints[4];
    var c1 = Math.cos(j1),
      s1 = Math.sin(j1);
    var pitch = j2 + j3;
    var toolPitch = pitch + j5;
    var lx =
      ARM.a2 * Math.cos(j2) +
      ARM.a3 * Math.cos(pitch) +
      ARM.d6 * Math.cos(toolPitch);
    var ly =
      ARM.d1 +
      ARM.a2 * Math.sin(j2) +
      ARM.a3 * Math.sin(pitch) +
      ARM.d6 * Math.sin(toolPitch);
    return {
      tcp: {
        x: BASE.x + lx * c1 + ARM.d4 * s1,
        y: BASE.y + ly,
        z: BASE.z - lx * s1 + ARM.d4 * c1,
      },
      heading: j1,
      toolPitch: toolPitch,
    };
  }

  function solveIk(target, prev) {
    prev = prev || HOME_JOINTS;
    var dx = target.x - BASE.x;
    var dz = target.z - BASE.z;
    var rw = Math.hypot(dx, dz);
    var sinOff = clamp(ARM.d4 / Math.max(rw, 1e-6), -0.999, 0.999);
    var j1 = Math.asin(sinOff) - Math.atan2(dz, dx);
    var r = Math.sqrt(Math.max(rw * rw - ARM.d4 * ARM.d4, 1e-8));
    var dy = target.y + ARM.d6 - (BASE.y + ARM.d1);
    var dist = Math.hypot(r, dy);
    var maxReach = ARM.a2 + ARM.a3 - 0.002;
    var minReach = Math.abs(ARM.a2 - ARM.a3) + 0.002;
    dist = clamp(dist, minReach, maxReach);
    var cosElbow = clamp(
      (ARM.a2 * ARM.a2 + ARM.a3 * ARM.a3 - dist * dist) / (2 * ARM.a2 * ARM.a3),
      -1,
      1
    );
    var interior = Math.acos(cosElbow);
    var cosPhi = clamp(
      (ARM.a2 * ARM.a2 + dist * dist - ARM.a3 * ARM.a3) / (2 * ARM.a2 * dist),
      -1,
      1
    );
    var phi = Math.acos(cosPhi);
    var alpha = Math.atan2(dy, r);
    var j2 = alpha + phi;
    var j3 = interior - Math.PI;
    var j5 = -Math.PI / 2 - (j2 + j3);
    return [j1, j2, j3, 0, j5, wrapAngle(-j1 * 0.15)];
  }

  function solveIkWithHeading(target, heading, prev) {
    var q = solveIk(target, prev);
    q[5] = wrapAngle(heading - q[0]);
    return q;
  }

  /* ── paths / presets ───────────────────────────────────── */
  var idSeq = 1;
  function nextId() {
    idSeq += 1;
    return "w" + idSeq;
  }
  function resetIds() {
    idSeq = 1;
  }
  function pt(nx, nz) {
    return {
      id: nextId(),
      x: PLATE.cx + nx * (PLATE.width / 2 - PLATE.margin),
      z: PLATE.cz + nz * (PLATE.depth / 2 - PLATE.margin),
    };
  }

  var PRESETS = {
    star: function () {
      var n = 5,
        pts = [],
        i,
        a;
      for (i = 0; i < n; i++) {
        a = -Math.PI / 2 + (i * 2 * Math.PI * 2) / n;
        pts.push(pt(Math.cos(a) * 0.78, Math.sin(a) * 0.78));
      }
      pts.push({ id: nextId(), x: pts[0].x, z: pts[0].z });
      return pts;
    },
    circle: function () {
      var pts = [],
        n = 12,
        i,
        a;
      for (i = 0; i < n; i++) {
        a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        pts.push(pt(Math.cos(a) * 0.72, Math.sin(a) * 0.72));
      }
      pts.push({ id: nextId(), x: pts[0].x, z: pts[0].z });
      return pts;
    },
    square: function () {
      var s = 0.7;
      return [
        [-s, -s],
        [s, -s],
        [s, s],
        [-s, s],
        [-s, -s],
      ].map(function (p) {
        return pt(p[0], p[1]);
      });
    },
    infinity: function () {
      var pts = [],
        n = 16,
        i,
        t,
        s;
      for (i = 0; i < n; i++) {
        t = (i / n) * Math.PI * 2;
        s = 1 + Math.sin(t) * Math.sin(t);
        pts.push(pt((Math.sin(t) * 0.9) / s, (Math.sin(t) * Math.cos(t) * 0.9) / s));
      }
      pts.push({ id: nextId(), x: pts[0].x, z: pts[0].z });
      return pts;
    },
    heart: function () {
      var pts = [],
        n = 14,
        i,
        t,
        x,
        y;
      for (i = 0; i < n; i++) {
        t = Math.PI + (i / (n - 1)) * Math.PI * 2;
        x = 16 * Math.pow(Math.sin(t), 3);
        y =
          13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t);
        pts.push(pt(x / 18, -y / 18));
      }
      return pts;
    },
    wave: function () {
      var pts = [],
        n = 10,
        i,
        u;
      for (i = 0; i < n; i++) {
        u = i / (n - 1);
        pts.push(pt(-0.85 + u * 1.7, Math.sin(u * Math.PI * 2) * 0.55));
      }
      return pts;
    },
  };
  var PRESET_ORDER = ["star", "circle", "square", "infinity", "heart", "wave"];

  function polylineLength(knots) {
    var len = 0,
      i,
      a,
      b;
    for (i = 1; i < knots.length; i++) {
      a = knots[i - 1];
      b = knots[i];
      len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return len;
  }

  function samplePolyline(knots, dist) {
    if (!knots.length) {
      return { knot: { x: 0, y: 0, z: 0, pen: false }, heading: 0, done: true, index: 0, segT: 1 };
    }
    if (knots.length === 1 || dist <= 0) {
      var a0 = knots[0],
        b0 = knots[1] || a0;
      return {
        knot: { x: a0.x, y: a0.y, z: a0.z, pen: a0.pen },
        heading: Math.atan2(b0.z - a0.z, b0.x - a0.x),
        done: false,
        index: 0,
        segT: 0,
      };
    }
    var remain = dist,
      i,
      a,
      b,
      seg,
      t;
    for (i = 1; i < knots.length; i++) {
      a = knots[i - 1];
      b = knots[i];
      seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (remain <= seg || i === knots.length - 1) {
        t = seg < 1e-8 ? 1 : Math.max(0, Math.min(1, remain / seg));
        return {
          knot: {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
            pen: !!(a.pen && b.pen),
          },
          heading: Math.atan2(b.z - a.z, b.x - a.x),
          done: i === knots.length - 1 && t >= 1,
          index: i - 1,
          segT: t,
        };
      }
      remain -= seg;
    }
    var last = knots[knots.length - 1],
      prev = knots[knots.length - 2] || last;
    return {
      knot: { x: last.x, y: last.y, z: last.z, pen: last.pen },
      heading: Math.atan2(last.z - prev.z, last.x - prev.x),
      done: true,
      index: knots.length - 1,
      segT: 1,
    };
  }

  /** Catmull-Rom densify of plate waypoints (XZ), closed if ends match. */
  function densifyCatmull(waypoints, samplesPerSeg) {
    samplesPerSeg = samplesPerSeg || 8;
    if (waypoints.length < 2) return waypoints.slice();
    var pts = waypoints.slice();
    var closed =
      Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 1e-4;
    var out = [];
    var n = pts.length;
    var i, j, t, t2, t3, p0, p1, p2, p3, x, z;
    function at(k) {
      if (closed) return pts[(k + n) % n];
      return pts[clamp(k, 0, n - 1)];
    }
    var segs = closed ? n - 1 : n - 1;
    for (i = 0; i < segs; i++) {
      p0 = at(i - 1);
      p1 = at(i);
      p2 = at(i + 1);
      p3 = at(i + 2);
      for (j = 0; j < samplesPerSeg; j++) {
        t = j / samplesPerSeg;
        t2 = t * t;
        t3 = t2 * t;
        x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        z =
          0.5 *
          (2 * p1.z +
            (-p0.z + p2.z) * t +
            (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
            (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        out.push({ x: x, z: z });
      }
    }
    out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
    return out;
  }

  /* ── store ─────────────────────────────────────────────── */
  function defaultPath() {
    resetIds();
    return PRESETS.star();
  }

  var store = {
    waypoints: defaultPath(),
    selectedId: null,
    status: "idle",
    speed: 1,
    orbitLocked: false,
    inkKey: 0,
    past: [],
  };

  function pushPast() {
    var next = store.past.concat([
      store.waypoints.map(function (w) {
        return { id: w.id, x: w.x, z: w.z };
      }),
    ]);
    store.past = next.length > 24 ? next.slice(next.length - 24) : next;
  }

  var listeners = [];
  function emit() {
    listeners.forEach(function (fn) {
      fn(store);
    });
  }
  function onChange(fn) {
    listeners.push(fn);
  }

  var actions = {
    addWaypoint: function (x, z) {
      if (store.status === "playing") return;
      if (store.waypoints.length >= MOTION.maxWaypoints) return;
      var p = clampPlate(x, z);
      pushPast();
      store.waypoints = store.waypoints.concat([{ id: nextId(), x: p.x, z: p.z }]);
      if (store.status === "done") store.status = "idle";
      emit();
    },
    moveWaypoint: function (id, x, z) {
      var p = clampPlate(x, z);
      store.waypoints = store.waypoints.map(function (w) {
        return w.id === id ? { id: w.id, x: p.x, z: p.z } : w;
      });
      emit();
    },
    removeWaypoint: function (id) {
      pushPast();
      store.waypoints = store.waypoints.filter(function (w) {
        return w.id !== id;
      });
      if (store.selectedId === id) store.selectedId = null;
      emit();
    },
    select: function (id) {
      store.selectedId = id;
      emit();
    },
    undo: function () {
      if (store.status === "playing" || !store.past.length) return;
      store.waypoints = store.past[store.past.length - 1];
      store.past = store.past.slice(0, -1);
      store.selectedId = null;
      store.status = "idle";
      emit();
    },
    clear: function () {
      if (store.status === "playing" || !store.waypoints.length) return;
      pushPast();
      store.waypoints = [];
      store.selectedId = null;
      store.status = "idle";
      store.inkKey += 1;
      emit();
    },
    loadPreset: function (id) {
      if (store.status === "playing" || !PRESETS[id]) return;
      pushPast();
      resetIds();
      store.waypoints = PRESETS[id]();
      store.selectedId = null;
      store.status = "idle";
      store.inkKey += 1;
      emit();
    },
    play: function () {
      if (store.waypoints.length < 1) return;
      if (store.status === "paused") {
        store.status = "playing";
        emit();
        return;
      }
      store.status = "playing";
      store.selectedId = null;
      store.inkKey += 1;
      emit();
    },
    pause: function () {
      if (store.status === "playing") {
        store.status = "paused";
        emit();
      }
    },
    stop: function () {
      store.status = "idle";
      store.inkKey += 1;
      emit();
    },
    finish: function () {
      store.status = "done";
      emit();
    },
    setSpeed: function (v) {
      store.speed = clamp(v, 0.4, 2.2);
      emit();
    },
    setOrbitLocked: function (v) {
      store.orbitLocked = !!v;
    },
  };

  var runtime = {
    joints: HOME_JOINTS.slice(),
    targetJoints: HOME_JOINTS.slice(),
    target: { x: 0, y: 0.2, z: 0 },
    progress: 0,
    pathLength: 0,
    traveled: 0,
    drawing: false,
    program: [],
    clock: 0,
  };

  function buildProgram(waypoints, from) {
    var home = fk(HOME_JOINTS).tcp;
    var knots = [{ x: from.x, y: from.y, z: from.z, pen: false }];
    if (!waypoints.length) return knots;
    var hover = MOTION.hover;
    var yDraw = PLATE.y;
    var dense = densifyCatmull(waypoints, 10);
    var first = dense[0];
    var last = dense[dense.length - 1];
    knots.push({ x: first.x, y: yDraw + hover, z: first.z, pen: false });
    knots.push({ x: first.x, y: yDraw, z: first.z, pen: false });
    dense.forEach(function (w) {
      knots.push({ x: w.x, y: yDraw, z: w.z, pen: true });
    });
    knots.push({ x: last.x, y: yDraw + hover, z: last.z, pen: false });
    knots.push({ x: home.x, y: home.y, z: home.z, pen: false });
    return knots;
  }

  /* ── paper texture ─────────────────────────────────────── */
  function makePaper(THREE) {
    var SIZE = 2048;
    var PAPER = "#12110e";
    var GRID = "rgba(232,197,71,0.12)";
    var INK = "#e8c547";
    var canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    var ctx = canvas.getContext("2d");
    var texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    var last = null;

    function paintBase() {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      var step = SIZE / 8,
        i;
      for (i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * step);
        ctx.lineTo(SIZE, i * step);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(232,197,71,0.28)";
      ctx.lineWidth = 2;
      ctx.strokeRect(8, 8, SIZE - 16, SIZE - 16);
    }
    paintBase();
    texture.needsUpdate = true;

    function worldToUv(x, z) {
      return {
        u: (x - (PLATE.cx - PLATE.width / 2)) / PLATE.width,
        v: (PLATE.cz + PLATE.depth / 2 - z) / PLATE.depth,
      };
    }
    return {
      texture: texture,
      stamp: function (x, z) {
        var uv = worldToUv(x, z);
        if (uv.u < 0.02 || uv.u > 0.98 || uv.v < 0.02 || uv.v > 0.98) return;
        var px = uv.u * SIZE,
          py = uv.v * SIZE;
        ctx.fillStyle = INK;
        ctx.strokeStyle = INK;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (last) {
          ctx.lineWidth = 7.5;
          ctx.beginPath();
          ctx.moveTo(last.u * SIZE, last.v * SIZE);
          ctx.lineTo(px, py);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
        last = { u: uv.u, v: uv.v };
        texture.needsUpdate = true;
      },
      clear: function () {
        last = null;
        paintBase();
        texture.needsUpdate = true;
      },
      lift: function () {
        last = null;
      },
    };
  }

  function makeNumberSprite(THREE, n, selected) {
    var c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    var ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#e8c547" : "#1a1814";
    ctx.fill();
    ctx.strokeStyle = selected ? "#f3d56a" : "rgba(232,197,71,0.45)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = selected ? "#070707" : "#f4f1ea";
    ctx.font = "bold 28px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 32, 34);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var spr = new THREE.Sprite(mat);
    spr.scale.set(0.038, 0.038, 1);
    spr.userData.dispose = function () {
      tex.dispose();
      mat.dispose();
    };
    return spr;
  }

  /* ── cobot builder ─────────────────────────────────────── */
  function buildCobot(THREE) {
    var shell = new THREE.MeshStandardMaterial({
      color: "#35332e",
      roughness: 0.42,
      metalness: 0.45,
    });
    var joint = new THREE.MeshStandardMaterial({
      color: "#141210",
      roughness: 0.28,
      metalness: 0.72,
    });
    var dark = new THREE.MeshStandardMaterial({
      color: "#0e0d0b",
      roughness: 0.48,
      metalness: 0.4,
    });
    var ring = new THREE.MeshStandardMaterial({
      color: "#7a7468",
      roughness: 0.28,
      metalness: 0.7,
    });
    var accent = new THREE.MeshStandardMaterial({
      color: "#c4a84a",
      roughness: 0.34,
      metalness: 0.58,
      emissive: "#5a4820",
      emissiveIntensity: 0.28,
    });
    var pen = new THREE.MeshStandardMaterial({
      color: "#1c1b18",
      roughness: 0.4,
      metalness: 0.22,
    });
    var tip = new THREE.MeshStandardMaterial({
      color: "#3a3830",
      roughness: 0.52,
      metalness: 0.18,
    });
    var led = new THREE.MeshStandardMaterial({
      color: "#e8c547",
      emissive: "#e8c547",
      emissiveIntensity: 1.05,
      roughness: 0.3,
      metalness: 0.1,
    });
    var ledIdle = new THREE.Color("#9a958a");
    var ledMove = new THREE.Color("#e8c547");

    function cyl(r, h, mat, cast) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), mat);
      m.castShadow = !!cast;
      m.receiveShadow = true;
      return m;
    }
    function tube(radius, length, mat) {
      var g = new THREE.Group();
      var m = cyl(radius, length, mat, true);
      m.rotation.z = Math.PI / 2;
      m.position.x = length / 2;
      g.add(m);
      return g;
    }
    function jointDisk(radius, height, mat, axis) {
      var m = cyl(radius, height, mat, true);
      if (axis === "x") m.rotation.z = Math.PI / 2;
      else if (axis === "z") m.rotation.x = Math.PI / 2;
      return m;
    }

    var root = new THREE.Group();
    root.position.set(BASE.x, BASE.y, BASE.z);

    var basePad = cyl(0.1, 0.012, dark, true);
    basePad.position.y = 0.006;
    root.add(basePad);
    var baseShell = cyl(0.08, 0.036, shell, true);
    baseShell.geometry = new THREE.CylinderGeometry(0.078, 0.082, 0.036, 32);
    baseShell.position.y = 0.028;
    root.add(baseShell);

    var j1 = new THREE.Group();
    root.add(j1);
    j1.add(jointDisk(0.074, 0.054, joint, "y"));
    var ring1 = cyl(0.076, 0.006, ring, false);
    ring1.position.y = 0.046;
    j1.add(ring1);
    var ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 16), led);
    ledMesh.position.set(0.052, 0.03, 0);
    j1.add(ledMesh);
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.064, ARM.d1 * 0.72, 28),
      shell
    );
    col.castShadow = true;
    col.position.y = ARM.d1 * 0.42;
    j1.add(col);
    var shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.07, 0.11), shell);
    shoulder.castShadow = true;
    shoulder.position.set(0, ARM.d1 - 0.01, ARM.d4 * 0.35);
    j1.add(shoulder);
    var goldStrip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.04, 0.08), accent);
    goldStrip.position.set(0.04, ARM.d1 - 0.01, ARM.d4 * 0.35);
    j1.add(goldStrip);

    var j1tip = new THREE.Group();
    j1tip.position.set(0, ARM.d1, ARM.d4);
    j1.add(j1tip);
    j1tip.add(jointDisk(0.056, 0.062, joint, "z"));

    var j2 = new THREE.Group();
    j1tip.add(j2);
    var j2ring = cyl(0.048, 0.07, ring, false);
    j2ring.rotation.x = Math.PI / 2;
    j2ring.position.x = 0.02;
    j2.add(j2ring);
    j2.add(tube(0.036, ARM.a2, shell));
    var strip2 = new THREE.Mesh(new THREE.BoxGeometry(ARM.a2 * 0.55, 0.018, 0.012), dark);
    strip2.castShadow = true;
    strip2.position.set(ARM.a2 * 0.5, 0, 0.028);
    j2.add(strip2);
    var accent2 = new THREE.Mesh(new THREE.BoxGeometry(ARM.a2 * 0.4, 0.006, 0.008), accent);
    accent2.position.set(ARM.a2 * 0.5, 0.02, 0);
    j2.add(accent2);

    var j2tip = new THREE.Group();
    j2tip.position.set(ARM.a2, 0, 0);
    j2.add(j2tip);
    j2tip.add(jointDisk(0.05, 0.058, joint, "z"));

    var j3 = new THREE.Group();
    j2tip.add(j3);
    j3.add(tube(0.032, ARM.a3, shell));
    var strip3 = new THREE.Mesh(new THREE.BoxGeometry(ARM.a3 * 0.5, 0.014, 0.01), dark);
    strip3.position.set(ARM.a3 * 0.48, 0, 0.024);
    j3.add(strip3);

    var j3tip = new THREE.Group();
    j3tip.position.set(ARM.a3, 0, 0);
    j3.add(j3tip);
    j3tip.add(jointDisk(0.042, 0.05, joint, "x"));

    var j4 = new THREE.Group();
    j3tip.add(j4);
    j4.add(jointDisk(0.038, 0.046, joint, "z"));

    var j5 = new THREE.Group();
    j4.add(j5);
    var wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.056, 24), shell);
    wrist.rotation.z = Math.PI / 2;
    wrist.position.x = 0.028;
    wrist.castShadow = true;
    j5.add(wrist);

    var j6 = new THREE.Group();
    j5.add(j6);
    j6.add(jointDisk(0.026, 0.032, joint, "x"));
    var penBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.012, ARM.d6 * 0.78, 24),
      pen
    );
    penBody.rotation.z = Math.PI / 2;
    penBody.position.x = ARM.d6 * 0.46;
    penBody.castShadow = true;
    j6.add(penBody);
    var tipMesh = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.024, 24), tip);
    tipMesh.rotation.z = -Math.PI / 2;
    tipMesh.position.x = ARM.d6 - 0.012;
    j6.add(tipMesh);
    var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 20), ring);
    collar.rotation.z = Math.PI / 2;
    collar.position.x = 0.034;
    j6.add(collar);

    return {
      root: root,
      j1: j1,
      j2: j2,
      j3: j3,
      j4: j4,
      j5: j5,
      j6: j6,
      led: led,
      ledIdle: ledIdle,
      ledMove: ledMove,
      applyJoints: function (q) {
        j1.rotation.y = q[0];
        j2.rotation.z = q[1];
        j3.rotation.z = q[2];
        j4.rotation.x = q[3];
        j5.rotation.z = q[4];
        j6.rotation.x = q[5];
      },
    };
  }

  function buildWorkshop(THREE) {
    var g = new THREE.Group();
    var floorY = -TABLE.leg;
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: "#0c0b0a", roughness: 0.9, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    g.add(floor);

    var gridHelper = new THREE.GridHelper(12, 60, "#2a2418", "#161410");
    gridHelper.position.y = floorY + 0.002;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.5;
    g.add(gridHelper);

    var top = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.width, TABLE.thickness, TABLE.depth),
      new THREE.MeshStandardMaterial({ color: "#1a1814", roughness: 0.52, metalness: 0.22 })
    );
    top.position.set(0.06, -TABLE.thickness / 2, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    var legs = [
      [-TABLE.width / 2 + 0.05, -TABLE.depth / 2 + 0.05],
      [TABLE.width / 2 - 0.05, -TABLE.depth / 2 + 0.05],
      [-TABLE.width / 2 + 0.05, TABLE.depth / 2 - 0.05],
      [TABLE.width / 2 - 0.05, TABLE.depth / 2 - 0.05],
    ];
    legs.forEach(function (lz) {
      var leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, TABLE.leg, 0.045),
        new THREE.MeshStandardMaterial({ color: "#141210", roughness: 0.5, metalness: 0.3 })
      );
      leg.position.set(0.06 + lz[0], -TABLE.thickness - TABLE.leg / 2, lz[1]);
      leg.castShadow = true;
      g.add(leg);
    });
    return g;
  }

  /* ── main scene ────────────────────────────────────────── */
  function boot(THREE) {
    var rootEl = document.getElementById("try-root");
    var canvasHost = document.getElementById("try-canvas");
    if (!rootEl || !canvasHost) return;

    var lang = rootEl.getAttribute("data-lang") === "fr" ? "fr" : "en";
    var t = I18N[lang];

    function isMobile() {
      return window.innerWidth < 700;
    }
    function isCoarse() {
      try {
        return window.matchMedia("(pointer: coarse)").matches;
      } catch (err) {
        return "ontouchstart" in window;
      }
    }
    var mobile = isMobile();
    var coarse = isCoarse();
    var plateActive = false; /* true while placing/dragging on plate */

    var renderer = new THREE.WebGLRenderer({
      antialias: !mobile,
      alpha: false,
      powerPreference: "high-performance",
    });
    var maxDpr = mobile || coarse ? 1.75 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setClearColor("#080807");
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.domElement.style.touchAction = "none";
    canvasHost.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color("#080807");
    scene.fog = new THREE.Fog("#080807", 8, 16);

    var camera = new THREE.PerspectiveCamera(
      mobile ? 42 : 34,
      1,
      0.05,
      22
    );
    camera.position.set(mobile ? 1.05 : 1.28, mobile ? 1.35 : 0.86, mobile ? 1.28 : 1.38);

    var controls = MiniOrbit(camera, renderer.domElement, THREE, {
      isCoarse: function () {
        return isCoarse();
      },
      plateOwns: function () {
        return plateActive || store.orbitLocked;
      },
    });
    controls.target.set(mobile ? 0.16 : 0.12, mobile ? 0.1 : 0.12, 0);
    controls.update();

    var hemi = new THREE.HemisphereLight("#e4ddd0", "#12110e", 0.88);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xfff4e6, 0.48));
    var key = new THREE.DirectionalLight("#fff6ea", 1.65);
    key.position.set(2.6, 4.8, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(mobile || coarse ? 1024 : 2048, mobile || coarse ? 1024 : 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 10;
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.2;
    key.shadow.camera.bottom = -2.2;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.025;
    if ("intensity" in key.shadow) key.shadow.intensity = 0.55;
    scene.add(key);
    var fill = new THREE.DirectionalLight("#c8cec6", 0.85);
    fill.position.set(-2.8, 2.8, -0.6);
    scene.add(fill);
    var rim = new THREE.DirectionalLight("#e8c547", 0.7);
    rim.position.set(-1.6, 1.7, 2.8);
    scene.add(rim);
    var side = new THREE.DirectionalLight("#d8d2c4", 0.55);
    side.position.set(3.0, 1.2, -1.5);
    scene.add(side);
    var plateLamp = new THREE.PointLight("#e8c547", 0.75, 2.4);
    plateLamp.position.set(0.32, 0.6, 0.08);
    scene.add(plateLamp);
    var robotLift = new THREE.PointLight("#fff4e6", 0.85, 2.4);
    robotLift.position.set(0.1, 1.05, 0.55);
    scene.add(robotLift);

    scene.add(buildWorkshop(THREE));
    var cobot = buildCobot(THREE);
    scene.add(cobot.root);
    cobot.applyJoints(runtime.joints);

    var paper = makePaper(THREE);
    var plateGroup = new THREE.Group();
    scene.add(plateGroup);

    var frame = new THREE.Mesh(
      new THREE.PlaneGeometry(PLATE.width + 0.036, PLATE.depth + 0.036),
      new THREE.MeshStandardMaterial({ color: "#1a1814", roughness: 0.5, metalness: 0.4 })
    );
    frame.rotation.x = -Math.PI / 2;
    frame.position.set(PLATE.cx, PLATE.y - 0.008, PLATE.cz);
    frame.receiveShadow = true;
    plateGroup.add(frame);

    var plateMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PLATE.width, PLATE.depth),
      new THREE.MeshBasicMaterial({ map: paper.texture, toneMapped: false })
    );
    plateMesh.rotation.x = -Math.PI / 2;
    plateMesh.position.set(PLATE.cx, PLATE.y, PLATE.cz);
    plateGroup.add(plateMesh);

    var hoverDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 20),
      new THREE.MeshBasicMaterial({ color: "#e8c547", transparent: true, opacity: 0.35 })
    );
    hoverDot.rotation.x = -Math.PI / 2;
    hoverDot.visible = false;
    plateGroup.add(hoverDot);

    var pathLine = null;
    var markerGroup = new THREE.Group();
    plateGroup.add(markerGroup);

    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var dragId = null;
    var lastInkKey = store.inkKey;

    function rebuildMarkers() {
      while (markerGroup.children.length) {
        var ch = markerGroup.children[0];
        markerGroup.remove(ch);
        if (ch.userData && ch.userData.dispose) ch.userData.dispose();
      }
      if (pathLine) {
        plateGroup.remove(pathLine);
        pathLine.geometry.dispose();
        pathLine.material.dispose();
        pathLine = null;
      }
      if (store.waypoints.length >= 2) {
        var pts = store.waypoints.map(function (w) {
          return new THREE.Vector3(w.x, PLATE.y + 0.004, w.z);
        });
        var geo = new THREE.BufferGeometry().setFromPoints(pts);
        pathLine = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: "#6b665c",
            transparent: true,
            opacity: 0.55,
          })
        );
        plateGroup.add(pathLine);
      }
      var hitR = isCoarse() ? 0.048 : 0.03;
      store.waypoints.forEach(function (w, i) {
        var hit = new THREE.Mesh(
          new THREE.CircleGeometry(hitR, 20),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
          })
        );
        hit.rotation.x = -Math.PI / 2;
        hit.position.set(w.x, PLATE.y + 0.007, w.z);
        hit.userData.wpId = w.id;
        hit.userData.dispose = function () {
          hit.geometry.dispose();
          hit.material.dispose();
        };
        markerGroup.add(hit);
        var spr = makeNumberSprite(THREE, i + 1, w.id === store.selectedId);
        spr.position.set(w.x, PLATE.y + 0.022, w.z);
        spr.userData.wpId = w.id;
        spr.raycast = function () {}; /* hit disc owns picking */
        markerGroup.add(spr);
      });
    }
    rebuildMarkers();

    function setPointer(e) {
      var rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    function hitPlate() {
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObject(plateMesh);
      return hits[0] || null;
    }
    function hitMarker() {
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(markerGroup.children, false);
      return hits[0] || null;
    }

    var playing = function () {
      return store.status === "playing" || store.status === "paused";
    };

    function setCanvasDrag(on) {
      document.body.classList.toggle("is-canvas-drag", !!on);
    }

    renderer.domElement.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button > 0) return;
      /* multi-touch orbit: ignore secondary fingers for plate */
      if (e.pointerType !== "mouse" && !e.isPrimary && typeof e.isPrimary === "boolean") {
        /* still allow; primary handles plate */
      }
      setPointer(e);
      var mh = hitMarker();
      if (mh && !playing()) {
        dragId = mh.object.userData.wpId;
        plateActive = true;
        actions.select(dragId);
        actions.setOrbitLocked(true);
        setCanvasDrag(true);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var ph = hitPlate();
      if (ph && !playing()) {
        /* one finger on plate = place (never orbit) */
        plateActive = true;
        actions.setOrbitLocked(true);
        setCanvasDrag(true);
        actions.addWaypoint(ph.point.x, ph.point.z);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      /* off-plate: mouse may orbit; coarse needs 2 fingers (MiniOrbit) */
      if (e.pointerType === "mouse" || !isCoarse()) {
        plateActive = false;
      }
    });
    renderer.domElement.addEventListener(
      "pointermove",
      function (e) {
        setPointer(e);
        var ph = hitPlate();
        if (ph && !playing() && !dragId && !isCoarse()) {
          hoverDot.visible = true;
          hoverDot.position.set(ph.point.x, PLATE.y + 0.003, ph.point.z);
        } else if (!dragId) {
          hoverDot.visible = false;
        }
        if (dragId) {
          /* project onto plate plane even if ray misses edges slightly */
          raycaster.setFromCamera(pointer, camera);
          var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLATE.y);
          var hit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(plane, hit)) {
            actions.moveWaypoint(dragId, hit.x, hit.z);
            rebuildMarkers();
          }
          e.preventDefault();
        }
      },
      { passive: false }
    );
    function endDrag(e) {
      dragId = null;
      plateActive = false;
      actions.setOrbitLocked(false);
      setCanvasDrag(false);
    }
    renderer.domElement.addEventListener("pointerup", endDrag);
    renderer.domElement.addEventListener("pointercancel", endDrag);
    renderer.domElement.addEventListener("pointerleave", function () {
      hoverDot.visible = false;
    });
    /* block page scroll/bounce while touching the canvas */
    renderer.domElement.addEventListener(
      "touchmove",
      function (e) {
        e.preventDefault();
      },
      { passive: false }
    );

    /* motion */
    var prevStatus = "idle";
    var returning = false;
    var homeT = 0;
    var fromJoints = HOME_JOINTS.slice();

    function easeInOut(t) {
      return t * t * (3 - 2 * t);
    }
    function segmentEase(segT) {
      /* soft ease near segment ends (0..1) */
      var edge = 0.12;
      if (segT < edge) return 0.55 + 0.45 * easeInOut(segT / edge);
      if (segT > 1 - edge) return 0.55 + 0.45 * easeInOut((1 - segT) / edge);
      return 1;
    }

    function tickMotion(dt) {
      var d = Math.min(dt, 0.05);
      runtime.clock += d;
      var status = store.status;
      var speed = store.speed;

      if (status === "playing" && prevStatus !== "playing") {
        if (prevStatus !== "paused") {
          var from = fk(runtime.joints).tcp;
          runtime.program = buildProgram(store.waypoints, from);
          runtime.pathLength = Math.max(polylineLength(runtime.program), 0.001);
          runtime.traveled = 0;
        }
      }
      if (status === "idle" && prevStatus !== "idle" && prevStatus !== "paused") {
        returning = true;
        homeT = 0;
        fromJoints = runtime.joints.slice();
      }
      if (status === "playing") returning = false;
      prevStatus = status;

      if (returning) {
        homeT += d * 1.35;
        var tt = Math.min(1, homeT);
        var e = easeInOut(tt);
        for (var i = 0; i < 6; i++) {
          runtime.joints[i] = lerpAngle(fromJoints[i], HOME_JOINTS[i], e);
          runtime.targetJoints[i] = runtime.joints[i];
        }
        runtime.drawing = false;
        if (tt >= 1) returning = false;
        cobot.applyJoints(runtime.joints);
        return;
      }

      if (status === "playing") {
        var sampleNow = samplePolyline(runtime.program, runtime.traveled);
        var baseSpeed = sampleNow.knot.pen ? MOTION.tcpSpeed : MOTION.airSpeed;
        var ease = segmentEase(sampleNow.segT || 0);
        runtime.traveled += speed * baseSpeed * ease * d;
        var sample = samplePolyline(runtime.program, runtime.traveled);
        runtime.target.x = sample.knot.x;
        runtime.target.y = sample.knot.y;
        runtime.target.z = sample.knot.z;
        runtime.drawing = !!sample.knot.pen;
        runtime.progress = Math.min(1, runtime.traveled / runtime.pathLength);
        runtime.targetJoints = solveIkWithHeading(
          sample.knot,
          sample.heading,
          runtime.targetJoints
        );
        if (sample.done) {
          runtime.drawing = false;
          runtime.progress = 1;
          actions.finish();
        }
      } else {
        runtime.drawing = false;
      }

      /* exponential joint smoothing toward IK target */
      var k = 1 - Math.exp(-JOINT_SMOOTH * d);
      for (var j = 0; j < 6; j++) {
        runtime.joints[j] = lerpAngle(runtime.joints[j], runtime.targetJoints[j], k);
      }
      cobot.applyJoints(runtime.joints);

      var moving = store.status === "playing";
      var lk = 1 - Math.exp(-8 * d);
      cobot.led.emissive.lerp(moving ? cobot.ledMove : cobot.ledIdle, lk);
      cobot.led.color.copy(cobot.led.emissive);
      var targetI = moving ? 1.8 : 1.05;
      cobot.led.emissiveIntensity +=
        (targetI - cobot.led.emissiveIntensity) * (1 - Math.exp(-6 * d));

      if (runtime.drawing) paper.stamp(runtime.target.x, runtime.target.z);
      else paper.lift();
    }

    /* UI */
    var hintEl = document.getElementById("try-hint");
    var progEl = document.getElementById("try-prog");
    var progFill = document.getElementById("try-prog-fill");
    var playBtn = document.getElementById("try-play");
    var stopBtn = document.getElementById("try-stop");
    var undoBtn = document.getElementById("try-undo");
    var clearBtn = document.getElementById("try-clear");
    var speedInput = document.getElementById("try-speed");
    var speedVal = document.getElementById("try-speed-val");
    var wpCount = document.getElementById("try-wp-count");
    var axesEl = document.getElementById("try-axes");
    var playLabel = document.getElementById("try-play-label");

    function syncUI() {
      var busy = store.status === "playing";
      var touchish = isCoarse();
      var hint =
        store.status === "playing"
          ? t.hintPlay
          : store.status === "paused"
            ? t.hintPause
            : store.status === "done"
              ? t.hintDone
              : store.waypoints.length === 0
                ? touchish
                  ? t.hintIdleTouch
                  : t.hintIdle
                : touchish
                  ? t.hintReadyTouch
                  : t.hintReady;
      if (hintEl) hintEl.textContent = hint;
      if (playLabel) playLabel.textContent = busy ? t.pause : t.play;
      if (playBtn) playBtn.disabled = store.waypoints.length === 0;
      if (stopBtn) stopBtn.disabled = store.status === "idle";
      if (undoBtn) undoBtn.disabled = busy;
      if (clearBtn) clearBtn.disabled = busy || store.waypoints.length === 0;
      document.querySelectorAll("[data-preset]").forEach(function (b) {
        b.disabled = busy;
      });
      if (wpCount) wpCount.textContent = String(store.waypoints.length);
      if (speedInput) speedInput.value = String(store.speed);
      if (speedVal) speedVal.textContent = store.speed.toFixed(1) + "×";
      if (progEl) {
        if (store.status === "playing" || store.status === "paused") progEl.classList.add("on");
        else progEl.classList.remove("on");
      }
      if (store.inkKey !== lastInkKey) {
        paper.clear();
        lastInkKey = store.inkKey;
      }
      rebuildMarkers();
    }
    onChange(syncUI);
    syncUI();

    if (playBtn)
      playBtn.addEventListener("click", function () {
        if (store.status === "playing") actions.pause();
        else actions.play();
      });
    if (stopBtn) stopBtn.addEventListener("click", function () { actions.stop(); });
    if (undoBtn) undoBtn.addEventListener("click", function () { actions.undo(); });
    if (clearBtn)
      clearBtn.addEventListener("click", function () {
        if (store.selectedId) actions.removeWaypoint(store.selectedId);
        else actions.clear();
      });
    if (speedInput)
      speedInput.addEventListener("input", function () {
        actions.setSpeed(Number(speedInput.value));
      });
    document.querySelectorAll("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        actions.loadPreset(b.getAttribute("data-preset"));
      });
    });

    window.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (store.status === "playing") actions.pause();
        else actions.play();
      } else if (e.code === "Escape") actions.stop();
      else if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        actions.undo();
      } else if ((e.code === "Delete" || e.code === "Backspace") && store.selectedId) {
        actions.removeWaypoint(store.selectedId);
      }
    });

    function applyCameraFraming(forcePos) {
      var nowMobile = isMobile();
      mobile = nowMobile;
      coarse = isCoarse();
      camera.fov = nowMobile ? 42 : 34;
      camera.updateProjectionMatrix();
      var wantTarget = nowMobile
        ? { x: 0.16, y: 0.1, z: 0 }
        : { x: 0.12, y: 0.12, z: 0 };
      /* soft retarget — never yank mid-play */
      if (store.status !== "playing") {
        controls.target.x += (wantTarget.x - controls.target.x) * (forcePos ? 1 : 0.35);
        controls.target.y += (wantTarget.y - controls.target.y) * (forcePos ? 1 : 0.35);
        controls.target.z += (wantTarget.z - controls.target.z) * (forcePos ? 1 : 0.35);
        if (forcePos) {
          camera.position.set(
            nowMobile ? 1.05 : 1.28,
            nowMobile ? 1.35 : 0.86,
            nowMobile ? 1.28 : 1.38
          );
        }
      }
      var dprCap = nowMobile || coarse ? 1.75 : 2;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
      var mapSize = nowMobile || coarse ? 1024 : 2048;
      if (key.shadow.mapSize.x !== mapSize) {
        key.shadow.mapSize.set(mapSize, mapSize);
        key.shadow.map = null; /* force rebuild */
      }
    }

    function resize() {
      var w = canvasHost.clientWidth;
      var h = canvasHost.clientHeight;
      if (w < 1 || h < 1) return;
      camera.aspect = w / h;
      applyCameraFraming(false);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", function () {
      window.setTimeout(function () {
        applyCameraFraming(store.status !== "playing");
        resize();
      }, 120);
    });

    var last = performance.now();
    var uiAcc = 0;
    function onAnimFrame(now) {
      requestAnimationFrame(onAnimFrame);
      var dt = (now - last) / 1000;
      last = now;
      /* MiniOrbit self-gates via plateOwns(); keep enabled true */
      controls.enabled = true;
      controls.update();
      tickMotion(dt);
      uiAcc += dt;
      if (uiAcc > 0.08) {
        uiAcc = 0;
        if (progFill) progFill.style.width = Math.round(runtime.progress * 100) + "%";
        if (axesEl) {
          var html = "";
          for (var i = 0; i < 6; i++) {
            var deg = Math.round((runtime.joints[i] * 180) / Math.PI);
            var hgt = Math.min(50, (Math.abs(deg) / 180) * 50);
            var transform = deg < 0 ? "translateY(100%)" : "";
            html +=
              '<div class="axis"><div class="axis-bar"><i class="axis-fill" style="height:' +
              hgt +
              "%;transform:" +
              transform +
              '"></i></div><span class="lab">J' +
              (i + 1) +
              '</span><span class="val">' +
              deg +
              "°</span></div>";
          }
          axesEl.innerHTML = html;
        }
        window.__kinema = {
          status: store.status,
          progress: runtime.progress,
          drawing: runtime.drawing,
          joints: runtime.joints.slice(),
          tcp: { x: runtime.target.x, y: runtime.target.y, z: runtime.target.z },
        };
      }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(onAnimFrame);
    window.__kinema = {
      status: store.status,
      progress: runtime.progress,
      drawing: runtime.drawing,
      joints: runtime.joints.slice(),
      tcp: { x: runtime.target.x, y: runtime.target.y, z: runtime.target.z },
    };
    window.__kinemaReady = true;
  }

  function start() {
    var p = Promise.resolve();
    if (!window.THREE) p = p.then(function () { return loadScript(CDN_THREE); });
    p.then(function () {
        boot(window.THREE);
      })
      .catch(function (err) {
        console.error(err);
        var host = document.getElementById("try-canvas");
        if (host)
          host.innerHTML =
            '<p style="padding:2rem;color:#9a958a;font-family:Manrope,sans-serif">Three.js failed to load.</p>';
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
