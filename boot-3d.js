/**
 * ROBINSPECT boot vignette — Three.js (r160+)
 * 6-axis arm + UT wedge probe performing ultrasonic weld inspection.
 * Falls back: caller uses SVG if this returns null / throws.
 */
(function (global) {
  "use strict";

  var CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";

  function loadThree(cb) {
    if (global.THREE) {
      cb(null, global.THREE);
      return;
    }
    var s = document.createElement("script");
    s.src = CDN;
    s.async = true;
    s.onload = function () {
      cb(global.THREE ? null : new Error("THREE missing"), global.THREE);
    };
    s.onerror = function () {
      cb(new Error("THREE CDN failed"));
    };
    document.head.appendChild(s);
  }

  function webglOk() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (e) {
      return false;
    }
  }

  /**
   * @param {HTMLElement} container  .boot-scene
   * @param {{reduce?: boolean}} opts
   * @returns {{ pose: function(number), dispose: function(), kind: string } | null}
   */
  function mount(container, opts) {
    opts = opts || {};
    if (!container || opts.reduce || !webglOk() || !global.THREE) return null;

    var THREE = global.THREE;
    var W = container.clientWidth || 920;
    var H = Math.max(280, Math.round(W * 0.5625));

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (e) {
      return null;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x050505, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    var canvas = renderer.domElement;
    canvas.className = "boot-canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050505, 0.042);

    /* Camera: high-angle industrial view; subtle push-in during scan */
    var camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 80);
    global.__bootCam = camera;
    var camHome = new THREE.Vector3(5.55, 5.95, 5.55);
    var camScan = new THREE.Vector3(4.35, 4.75, 4.55);
    var camEnd = new THREE.Vector3(4.7, 5.15, 4.85);
    camera.position.copy(camHome);
    var lookHome = new THREE.Vector3(0.45, 0.42, 0.12);
    var lookScan = new THREE.Vector3(0.95, 0.22, 0.16);
    var lookAt = lookHome.clone();
    camera.lookAt(lookAt);

    /* Lights */
    scene.add(new THREE.AmbientLight(0x2a2824, 0.32));

    var key = new THREE.DirectionalLight(0xfff2d6, 1.12);
    key.position.set(2.5, 6.5, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0004;
    scene.add(key);

    var rim = new THREE.DirectionalLight(0xe8c547, 0.52);
    rim.position.set(-3.5, 2.2, -2.5);
    scene.add(rim);

    var fill = new THREE.DirectionalLight(0x8899aa, 0.2);
    fill.position.set(-1.5, 3, 4);
    scene.add(fill);

    var spot = new THREE.SpotLight(0xffe8a8, 2.5, 14, Math.PI / 7, 0.55, 1.4);
    spot.position.set(0.6, 5.2, 0.2);
    spot.target.position.set(0.9, 0.12, 0.15);
    spot.castShadow = true;
    scene.add(spot);
    scene.add(spot.target);

    /* Materials — dark industrial + gold accents */
    var matBase = new THREE.MeshStandardMaterial({
      color: 0x12110e,
      metalness: 0.82,
      roughness: 0.38,
    });
    var matLink = new THREE.MeshStandardMaterial({
      color: 0x1a1814,
      metalness: 0.78,
      roughness: 0.42,
    });
    var matAccent = new THREE.MeshStandardMaterial({
      color: 0xe8c547,
      metalness: 0.9,
      roughness: 0.28,
      emissive: 0xe8c547,
      emissiveIntensity: 0.18,
    });
    var matGoldSoft = new THREE.MeshStandardMaterial({
      color: 0xf3d56a,
      metalness: 0.85,
      roughness: 0.32,
      emissive: 0xe8c547,
      emissiveIntensity: 0.12,
    });
    var matPlate = new THREE.MeshStandardMaterial({
      color: 0x0c0b09,
      metalness: 0.88,
      roughness: 0.45,
    });
    var matBench = new THREE.MeshStandardMaterial({
      color: 0x0a0908,
      metalness: 0.55,
      roughness: 0.62,
    });
    var matProbe = new THREE.MeshStandardMaterial({
      color: 0x161410,
      metalness: 0.72,
      roughness: 0.38,
    });
    var matCable = new THREE.MeshStandardMaterial({
      color: 0x0e0d0b,
      metalness: 0.35,
      roughness: 0.7,
    });
    var matWedgeFace = new THREE.MeshStandardMaterial({
      color: 0x2a2618,
      metalness: 0.55,
      roughness: 0.45,
      emissive: 0xe8c547,
      emissiveIntensity: 0.06,
    });

    /* Floor */
    var floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 48),
      new THREE.MeshStandardMaterial({
        color: 0x070706,
        metalness: 0.3,
        roughness: 0.9,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);

    /* Bench */
    var bench = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.6), matBench);
    bench.position.set(0.85, 0.06, 0.15);
    bench.castShadow = true;
    bench.receiveShadow = true;
    scene.add(bench);

    /* Coupon plate */
    var plate = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.05, 0.72), matPlate);
    plate.position.set(1.05, 0.145, 0.18);
    plate.castShadow = true;
    plate.receiveShadow = true;
    scene.add(plate);

    /* Weld bead — gold accent curve along plate */
    var weldPts = [];
    var wi;
    for (wi = 0; wi <= 48; wi++) {
      var u = wi / 48;
      var x = 0.25 + u * 1.55;
      var z =
        0.18 +
        Math.sin(u * Math.PI * 2.2) * 0.045 +
        Math.sin(u * Math.PI * 5) * 0.012;
      var y = 0.175;
      weldPts.push(new THREE.Vector3(x, y, z));
    }
    var weldCurve = new THREE.CatmullRomCurve3(weldPts);
    var weldGeo = new THREE.TubeGeometry(weldCurve, 64, 0.018, 8, false);
    var weldMesh = new THREE.Mesh(weldGeo, matGoldSoft);
    weldMesh.castShadow = true;
    scene.add(weldMesh);

    /* Progress trail along weld */
    var trailMat = new THREE.MeshStandardMaterial({
      color: 0xe8c547,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0xe8c547,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.9,
    });
    var trailMesh = null;
    var trailLast = -1;

    function setTrail(s) {
      var tt = Math.max(0, Math.min(1, s));
      if (tt < 0.015) {
        if (trailMesh) {
          scene.remove(trailMesh);
          trailMesh.geometry.dispose();
          trailMesh = null;
          trailLast = -1;
        }
        return;
      }
      /* Rebuild only when progress moves enough (cheap) */
      if (trailMesh && Math.abs(tt - trailLast) < 0.012) return;
      trailLast = tt;
      if (trailMesh) {
        scene.remove(trailMesh);
        trailMesh.geometry.dispose();
        trailMesh = null;
      }
      var sub = weldCurve.getPoints(Math.max(4, Math.floor(48 * tt)));
      if (sub.length < 2) return;
      var c = new THREE.CatmullRomCurve3(sub);
      trailMesh = new THREE.Mesh(
        new THREE.TubeGeometry(c, Math.max(8, sub.length * 2), 0.024, 6, false),
        trailMat
      );
      scene.add(trailMesh);
    }

    /* —— 6-axis industrial arm (thicker links) —— */
    function jointRing(r) {
      var g = new THREE.Group();
      var outer = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 0.1, 22),
        matAccent
      );
      outer.rotation.z = Math.PI / 2;
      outer.castShadow = true;
      g.add(outer);
      var core = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.38, r * 0.38, 0.12, 12),
        matLink
      );
      core.rotation.z = Math.PI / 2;
      g.add(core);
      return g;
    }

    function linkTube(len, r) {
      var g = new THREE.Group();
      var m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.9, len, 16),
        matLink
      );
      m.position.y = len / 2;
      m.castShadow = true;
      g.add(m);
      /* Gold seam ring mid-link */
      var seam = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.05, 0.012, 8, 20),
        matAccent
      );
      seam.rotation.x = Math.PI / 2;
      seam.position.y = len * 0.45;
      g.add(seam);
      return g;
    }

    var robot = new THREE.Group();
    robot.position.set(-0.42, 0.12, 0.15);
    scene.add(robot);

    /* Base */
    var basePed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.44, 0.16, 24),
      matBase
    );
    basePed.position.y = 0.08;
    basePed.castShadow = true;
    robot.add(basePed);
    var basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), matAccent);
    basePlate.position.y = 0.01;
    robot.add(basePlate);

    /* Link lengths (must match IK) */
    var L_SHOULDER_Y = 0.5;
    var L_UPPER = 1.14;
    var L_FORE = 1.04;
    /* Tip offset from wrist pitch pivot (along probe local +Z after wedge) */
    var TIP_ALONG = 0.17;
    var TIP_DOWN = 0.05;

    /* J1 yaw */
    var j1 = new THREE.Group();
    j1.position.y = 0.16;
    robot.add(j1);
    j1.add(jointRing(0.24));
    var shoulderCol = new THREE.Mesh(
      new THREE.CylinderGeometry(0.175, 0.2, L_SHOULDER_Y - 0.06, 16),
      matLink
    );
    shoulderCol.position.y = (L_SHOULDER_Y - 0.06) / 2 + 0.04;
    shoulderCol.castShadow = true;
    j1.add(shoulderCol);

    /* J2 pitch at shoulder */
    var j2 = new THREE.Group();
    j2.position.set(0, L_SHOULDER_Y, 0);
    j1.add(j2);
    var j2ring = jointRing(0.2);
    j2ring.rotation.z = Math.PI / 2;
    j2.add(j2ring);
    var upper = new THREE.Group();
    j2.add(upper);
    upper.add(linkTube(L_UPPER, 0.105));

    /* J3 elbow */
    var j3 = new THREE.Group();
    j3.position.y = L_UPPER;
    upper.add(j3);
    var j3ring = jointRing(0.155);
    j3ring.rotation.z = Math.PI / 2;
    j3.add(j3ring);
    var fore = new THREE.Group();
    j3.add(fore);
    fore.add(linkTube(L_FORE, 0.088));

    /* J4 wrist roll */
    var j4 = new THREE.Group();
    j4.position.y = L_FORE;
    fore.add(j4);
    j4.add(jointRing(0.11));

    /* J5 wrist pitch */
    var j5 = new THREE.Group();
    j5.position.y = 0.07;
    j4.add(j5);
    var j5ring = jointRing(0.095);
    j5ring.rotation.z = Math.PI / 2;
    j5.add(j5ring);

    /* J6 + UT wedge probe */
    var j6 = new THREE.Group();
    j6.position.y = 0.09;
    j5.add(j6);
    j6.add(jointRing(0.075));

    var probe = new THREE.Group();
    j6.add(probe);

    /* Housing */
    var housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.09, 0.14),
      matProbe
    );
    housing.position.set(0, 0.02, 0.02);
    housing.castShadow = true;
    probe.add(housing);

    /* Angled UT wedge (~45°) — contact face toward plate */
    var wedge = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.055, 0.12),
      matWedgeFace
    );
    wedge.position.set(0, -0.01, 0.11);
    wedge.rotation.x = 0.55;
    wedge.castShadow = true;
    probe.add(wedge);

    /* Acoustic face highlight */
    var face = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.008, 0.055),
      matAccent
    );
    face.position.set(0, -0.028, 0.145);
    face.rotation.x = 0.55;
    probe.add(face);

    /* Tip contact sphere (visual lock to weld) */
    var tip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 12), matAccent);
    var TIP_LOCAL_DEFAULT = new THREE.Vector3(0, -0.05, 0.155);
    tip.position.copy(TIP_LOCAL_DEFAULT);
    tip.castShadow = true;
    probe.add(tip);

    var tipGlow = new THREE.PointLight(0xe8c547, 0.55, 1.35);
    tipGlow.position.copy(tip.position);
    probe.add(tipGlow);

    /* Cable stub from housing back toward forearm */
    var cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.014, 0.22, 8),
      matCable
    );
    cable.position.set(0.04, 0.05, -0.06);
    cable.rotation.z = 0.7;
    cable.rotation.x = 0.35;
    probe.add(cable);
    var cableBend = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 8),
      matCable
    );
    cableBend.position.set(0.09, 0.1, -0.1);
    probe.add(cableBend);

    /* Contact marker on weld */
    var contactMat = new THREE.MeshStandardMaterial({
      color: 0xe8c547,
      emissive: 0xe8c547,
      emissiveIntensity: 0.85,
      metalness: 0.5,
      roughness: 0.28,
      transparent: true,
      opacity: 1,
    });
    var contact = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), contactMat);
    scene.add(contact);

    /* Thin gold scan ring at contact (acquisition cue) */
    var scanRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.006, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0xe8c547,
        emissive: 0xe8c547,
        emissiveIntensity: 0.7,
        metalness: 0.6,
        roughness: 0.3,
        transparent: true,
        opacity: 0,
      })
    );
    scanRing.rotation.x = Math.PI / 2;
    scene.add(scanRing);

    /* Soft vertical “beam” stub (lightweight) */
    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.014, 0.11, 6),
      new THREE.MeshStandardMaterial({
        color: 0xe8c547,
        emissive: 0xe8c547,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0,
        metalness: 0.4,
        roughness: 0.4,
      })
    );
    scene.add(beam);

    /* —— Helpers —— */
    function easeInOut(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function clamp01(t) {
      return Math.max(0, Math.min(1, t));
    }

    /** Pure linear in arc-length — NO mid-scan easing (FR5 constant TCP). */
    function scanS(u) {
      return clamp01(u);
    }

    /** Slight accel/decel on LIN lift (industrial, not floaty mid-scan). */
    function linU(u) {
      return easeInOut(clamp01(u));
    }

    /* Hover height above weld start (surface-normal / +Y) */
    var HOVER_LIFT = 0.2;

    /**
     * FR5 C-scan cell cycle on t∈[0,1] (~4s boot) — pacing from presentation 6:04–7:13:
     *  0.00–0.08 HOME hold
     *  0.08–0.22 PTP to hover above weld start
     *  0.22–0.28 LIN approach FAST along normal (ease in/out, no bounce)
     *  0.28–0.78 LIN scan SLOW constant TCP (linear s, wrist keeps probe normal)
     *  0.78–0.88 measure dwell (~brief pause still in contact)
     *  0.88–0.94 LIN retract FAST straight up along tool Z
     *  0.94–1.00 PTP home / hold retracted
     * Contrast: approach/retract short+fast vs deliberate slow scan.
     */
    function phaseOf(t) {
      var p = clamp01(t);
      if (p < 0.08) return { name: "home", u: 0, s: 0 };
      if (p < 0.22) {
        return {
          name: "ptpApproach",
          u: easeInOut((p - 0.08) / 0.14),
          s: 0,
        };
      }
      if (p < 0.28) {
        /* FAST LIN down — ease in/out only on this short window */
        return { name: "linApproach", u: (p - 0.22) / 0.06, s: 0 };
      }
      if (p < 0.78) {
        var su = (p - 0.28) / 0.5;
        return { name: "scan", u: su, s: scanS(su) };
      }
      if (p < 0.88) return { name: "measure", u: 1, s: 1 };
      if (p < 0.94) {
        return { name: "linRetract", u: (p - 0.88) / 0.06, s: 1 };
      }
      return {
        name: "ptpHome",
        u: easeInOut((p - 0.94) / 0.06),
        s: 1,
      };
    }

    /**
     * Approximate planar IK in the J1 yaw frame.
     * Convention (verified): joint z=0 → link along +Y; negative z leans toward
     * +X in the yawed frame. Seed aims wrist (j5); CCD finishes on real tip.
     */
    function solveReach(targetWorld, tipOffsetAlong, tipOffsetDown) {
      var dx = targetWorld.x - robot.position.x;
      var dz = targetWorld.z - robot.position.z;
      var yaw = Math.atan2(dx, dz) - Math.PI / 2;
      yaw = Math.max(-1.2, Math.min(0.9, yaw));

      var shY = robot.position.y + 0.16 + L_SHOULDER_Y;
      var horiz = Math.sqrt(dx * dx + dz * dz);
      /* Wrist near tip: tip sits ~along probe forward/down from j5 */
      var wristHoriz = Math.max(0.2, horiz - tipOffsetAlong * 0.55);
      var wristY = targetWorld.y + 0.14 + tipOffsetDown * 0.5;

      /* Pitch-plane coords: x = forward reach, y = up from shoulder */
      var x = wristHoriz;
      var y = wristY - shY;

      var L1 = L_UPPER;
      var L2 = L_FORE + 0.07 + 0.09;
      var d2 = x * x + y * y;
      var d = Math.sqrt(Math.max(d2, 1e-8));
      var maxR = L1 + L2 - 0.05;
      var minR = Math.abs(L1 - L2) + 0.1;
      if (d > maxR) {
        x *= maxR / d;
        y *= maxR / d;
        d = maxR;
        d2 = d * d;
      } else if (d < minR) {
        x *= minR / d;
        y *= minR / d;
        d = minR;
        d2 = d * d;
      }

      var cosEl = (L1 * L1 + L2 * L2 - d2) / (2 * L1 * L2);
      cosEl = Math.max(-1, Math.min(1, cosEl));
      /* interior angle at elbow between the two links */
      var elInterior = Math.acos(cosEl);
      /*
       * Elbow-UP fold: NEGATIVE (π - interior).
       * With joint z=0 → link +Y, FK wrist hits target only for:
       *   sh = -(baseAng - alpha)  AND  el = -(π - interior)
       * Old pair +(alpha) with +el was elbow-DOWN (forearm through plate).
       */
      var elJoint = -(Math.PI - elInterior);

      var cosA = (L1 * L1 + d2 - L2 * L2) / (2 * L1 * d);
      cosA = Math.max(-1, Math.min(1, cosA));
      var alpha = Math.acos(cosA);
      var baseAng = Math.atan2(x, y); /* from +Y toward +X */
      var sh = -(baseAng - alpha); /* elbow-UP shoulder */

      /* Wrist: keep probe face toward plate (|el| keeps prior pitch feel) */
      var wr = -sh - Math.abs(elJoint) * 0.55 + 0.35;
      wr = Math.max(-1.7, Math.min(0.2, wr));

      return { yaw: yaw, sh: sh, el: elJoint, wr: wr, wrY: 0 };
    }

    /* Key poses (manual polish for home / approach / retract readability) */
    var POSE_HOME = {
      yaw: -0.55,
      sh: -0.85,
      el: -1.55,
      wr: -0.55,
      wrY: 0.15,
      probeX: 0.25,
    };
    /* Fallback PTP approach seed (overridden by poseForWeld hover when available) */
    var POSE_APPROACH = {
      yaw: -0.22,
      sh: -0.72,
      el: -1.42,
      wr: -0.95,
      wrY: 0.05,
      probeX: 0.45,
    };

    /* Joint clamps so CCD / seed cannot explode the arm.
     * Elbow-UP uses NEGATIVE el (see solveReach). Positive el is elbow-DOWN
     * and is excluded so CCD cannot flip through the plate.
     * LIM_SH: deep << -2 is the old elbow-down shoulder. */
    var LIM_YAW = [-1.6, 1.2];
    var LIM_SH = [-1.85, 0.55];
    var LIM_EL = [-2.65, -0.12];
    var LIM_WR = [-2.6, 1.0];
    /* Plate top ≈ 0.17; keep elbow clearly above coupon */
    var PLATE_Y = 0.17;
    var ELBOW_MARGIN = 0.45;
    var ELBOW_MIN_Y = PLATE_Y + ELBOW_MARGIN;

    function clampJoint(v, lim) {
      return Math.max(lim[0], Math.min(lim[1], v));
    }
    function applyJoints(p) {
      j1.rotation.y = clampJoint(p.yaw, LIM_YAW);
      j2.rotation.z = clampJoint(p.sh, LIM_SH);
      j3.rotation.z = clampJoint(p.el, LIM_EL);
      j4.rotation.y = p.wrY || 0;
      j5.rotation.z = clampJoint(p.wr, LIM_WR);
      j6.rotation.y = 0;
      probe.rotation.x = p.probeX != null ? p.probeX : 0.5;
      probe.rotation.z = 0;
    }

    function mixPose(a, b, t) {
      return {
        yaw: lerp(a.yaw, b.yaw, t),
        sh: lerp(a.sh, b.sh, t),
        el: lerp(a.el, b.el, t),
        wr: lerp(a.wr, b.wr, t),
        wrY: lerp(a.wrY || 0, b.wrY || 0, t),
        probeX: lerp(
          a.probeX != null ? a.probeX : 0.5,
          b.probeX != null ? b.probeX : 0.5,
          t
        ),
      };
    }

    /**
     * Seed pose for tip near weld sample s (TrajTool piquage grammar):
     * tip on dense bead, incidence ~0° (plate-normal), slight lead on tangent,
     * orientation continuous (~1° max jump feel — no gaming fly-through).
     */
    var _prevOrient = { wrY: 0, probeX: 0.52, init: false };
    function poseForWeld(s, lift) {
      lift = lift || 0;
      var ss = clamp01(s);
      var pt = weldCurve.getPointAt(ss);
      var tan = weldCurve.getTangentAt(ss).normalize();
      var target = pt.clone();
      /* Contact standoff; lift is along surface normal (+Y) only */
      target.y += 0.012 + lift;
      var ik = solveReach(target, TIP_ALONG, TIP_DOWN);
      /* 0° incidence (normale): wrist pitches with path so probe stays plate-normal */
      var yawTan = Math.atan2(tan.z, tan.x);
      /* Continuous wrist yaw along dense bead; slight lead, not fly-through */
      var wrYTarget = yawTan * 0.22;
      /* Pitch holds acoustic face down — lift only while approaching/retracting */
      var probeTarget = 0.5 + Math.min(0.05, lift * 0.3);
      if (!_prevOrient.init) {
        _prevOrient.wrY = wrYTarget;
        _prevOrient.probeX = probeTarget;
        _prevOrient.init = true;
      } else {
        /* Cap orient step (~1° ≈ 0.017 rad feel over successive samples) */
        var maxStep = 0.035;
        var dW = wrYTarget - _prevOrient.wrY;
        if (dW > maxStep) dW = maxStep;
        else if (dW < -maxStep) dW = -maxStep;
        _prevOrient.wrY += dW;
        var dP = probeTarget - _prevOrient.probeX;
        if (dP > maxStep) dP = maxStep;
        else if (dP < -maxStep) dP = -maxStep;
        _prevOrient.probeX += dP;
      }
      ik.wrY = _prevOrient.wrY;
      ik.probeX = _prevOrient.probeX;
      return ik;
    }


    /* Scratch for CCD / refine / snap */
    var _ccdTip = new THREE.Vector3();
    var _ccdLocal = new THREE.Vector3();

    var _elbowWorld = new THREE.Vector3();

    function elbowWorldY() {
      j3.updateWorldMatrix(true, false);
      j3.getWorldPosition(_elbowWorld);
      return _elbowWorld.y;
    }

    /** Nudge shoulder/elbow so elbow stays above plate (elbow-up, el < 0). */
    function enforceElbowUp() {
      var ey = elbowWorldY();
      var guard = 0;
      /* Force negative elbow fold if CCD drifted toward straight/positive */
      if (j3.rotation.z > -0.12) {
        j3.rotation.z = clampJoint(-0.85, LIM_EL);
      }
      while (ey < ELBOW_MIN_Y && guard < 22) {
        /* Lift elbow: lessen |sh| toward 0; deepen negative fold */
        if (j2.rotation.z < -0.2) {
          j2.rotation.z = clampJoint(j2.rotation.z + 0.07, LIM_SH);
        }
        if (j3.rotation.z > -2.4) {
          j3.rotation.z = clampJoint(j3.rotation.z - 0.06, LIM_EL);
        }
        ey = elbowWorldY();
        guard++;
      }
      return ey;
    }

    /**
     * CCD IK on real tip mesh world position.
     * Joints tip→base: j5.z, j3.z, j2.z, j1.y
     * Finite-difference cyclic descent (never increases tip error).
     * Rejects steps that flip to elbow-DOWN (elbow below plate+margin).
     */
    function ccdReach(target, iterations) {
      iterations = iterations == null ? 12 : iterations;
      var joints = [
        { obj: j5, axis: "z", lim: LIM_WR },
        { obj: j3, axis: "z", lim: LIM_EL },
        { obj: j2, axis: "z", lim: LIM_SH },
        { obj: j1, axis: "y", lim: LIM_YAW },
      ];
      var eps = 0.1;
      var iter, ji, jdef, joint, prop, original, d0, dPlus, dMinus, best;
      var ey0, eyPlus, eyMinus, scorePlus, scoreMinus, scoreBest;
      for (iter = 0; iter < iterations; iter++) {
        tip.updateWorldMatrix(true, true);
        tip.getWorldPosition(_ccdTip);
        d0 = _ccdTip.distanceTo(target);
        if (d0 < 0.008) break;

        for (ji = 0; ji < joints.length; ji++) {
          jdef = joints[ji];
          joint = jdef.obj;
          prop = jdef.axis;
          original = joint.rotation[prop];

          tip.updateWorldMatrix(true, true);
          tip.getWorldPosition(_ccdTip);
          best = _ccdTip.distanceTo(target);
          ey0 = elbowWorldY();
          /* Soft penalty if already below — still allow tip progress */
          scoreBest = best + (ey0 < ELBOW_MIN_Y ? 0.35 : 0);

          joint.rotation[prop] = clampJoint(original + eps, jdef.lim);
          tip.updateWorldMatrix(true, true);
          tip.getWorldPosition(_ccdTip);
          dPlus = _ccdTip.distanceTo(target);
          eyPlus = elbowWorldY();
          /* Hard-reject elbow-down flips when current was OK */
          if (ey0 >= ELBOW_MIN_Y && eyPlus < ELBOW_MIN_Y) {
            scorePlus = 1e9;
          } else {
            scorePlus = dPlus + (eyPlus < ELBOW_MIN_Y ? 0.35 : 0);
            /* Bias: prefer higher elbow when tip scores are close */
            scorePlus -= Math.min(0.02, Math.max(0, eyPlus - ey0) * 0.04);
          }

          joint.rotation[prop] = clampJoint(original - eps, jdef.lim);
          tip.updateWorldMatrix(true, true);
          tip.getWorldPosition(_ccdTip);
          dMinus = _ccdTip.distanceTo(target);
          eyMinus = elbowWorldY();
          if (ey0 >= ELBOW_MIN_Y && eyMinus < ELBOW_MIN_Y) {
            scoreMinus = 1e9;
          } else {
            scoreMinus = dMinus + (eyMinus < ELBOW_MIN_Y ? 0.35 : 0);
            scoreMinus -= Math.min(0.02, Math.max(0, eyMinus - ey0) * 0.04);
          }

          if (scorePlus <= scoreMinus && scorePlus < scoreBest - 1e-7) {
            joint.rotation[prop] = clampJoint(original + eps, jdef.lim);
          } else if (scoreMinus < scoreBest - 1e-7) {
            joint.rotation[prop] = clampJoint(original - eps, jdef.lim);
          } else {
            joint.rotation[prop] = original;
          }
        }
        eps = Math.max(0.004, eps * 0.85);
      }

      enforceElbowUp();
      tip.updateWorldMatrix(true, false);
      tip.getWorldPosition(_ccdTip);
      return _ccdTip.distanceTo(target);
    }

    function refineReach(target, passes) {
      passes = passes == null ? 5 : passes;
      var p, errVec = new THREE.Vector3(), adjusted = new THREE.Vector3(), ik;
      for (p = 0; p < passes; p++) {
        tip.updateWorldMatrix(true, true);
        tip.getWorldPosition(_ccdTip);
        errVec.subVectors(target, _ccdTip);
        if (errVec.lengthSq() < 0.000064) break;
        /* Partial correction avoids analytic wind-up past joint limits */
        adjusted.copy(target).addScaledVector(errVec, 0.65);
        ik = solveReach(adjusted, TIP_ALONG, TIP_DOWN);
        ik.wrY = j4.rotation.y;
        ik.probeX = probe.rotation.x;
        applyJoints(ik);
        enforceElbowUp();
      }
      tip.updateWorldMatrix(true, false);
      tip.getWorldPosition(_ccdTip);
      return _ccdTip.distanceTo(target);
    }

    /** Optional micro-snap of tip local offset if CCD almost there */
    function maybeSnapTip(target, residual) {
      /* Snap only when nearly there — never mask a broken reach (>=0.12) */
      if (!(residual > 0.035 && residual < 0.12)) return residual;
      tip.parent.updateWorldMatrix(true, false);
      _ccdLocal.copy(target);
      tip.parent.worldToLocal(_ccdLocal);
      tip.position.copy(_ccdLocal);
      tipGlow.position.copy(tip.position);
      tip.updateWorldMatrix(true, false);
      tip.getWorldPosition(_ccdTip);
      return _ccdTip.distanceTo(target);
    }

    /** Weld contact target at sample s with vertical lift */
    function weldTarget(s, lift) {
      var pt = weldCurve.getPointAt(clamp01(s));
      var t = pt.clone();
      t.y += 0.01 + (lift || 0);
      return t;
    }

    var tipWorld = new THREE.Vector3();
    var _pulseT = 0;

    function pose(t) {
      var ph = phaseOf(t);
      var joints;
      var contactOn = false;
      var trailS = 0;
      var pulse = 0;
      var dwellBright = false;
      var lift = 0;
      var settleLift = 0;

      var hoverStart = poseForWeld(0, HOVER_LIFT);
      var hoverEnd = poseForWeld(1, HOVER_LIFT);

      if (ph.name === "home") {
        _prevOrient.init = false;
        joints = POSE_HOME;
        contact.visible = false;
        scanRing.material.opacity = 0;
        beam.material.opacity = 0;
        setTrail(0);
      } else if (ph.name === "ptpApproach") {
        /* Joint-space PTP: HOME → hover above weld start (curved TCP OK) */
        joints = mixPose(POSE_HOME, hoverStart, ph.u);
        lift = HOVER_LIFT;
        contact.visible = false;
        setTrail(0);
      } else if (ph.name === "linApproach") {
        /* LIN along surface normal (+Y): hover → contact */
        var au = linU(ph.u);
        lift = lerp(HOVER_LIFT, 0, au);
        joints = poseForWeld(0, lift);
        contactOn = au > 0.92;
        contact.visible = contactOn;
        setTrail(0);
      } else if (ph.name === "scan") {
        /* Steady contact — no bounce; constant TCP along bead */
        settleLift = 0;
        joints = poseForWeld(ph.s, 0);
        lift = 0;
        contactOn = true;
        trailS = ph.s;
        _pulseT = t * 4 * Math.PI * 2 * 7;
        pulse = 0.5 + 0.5 * Math.sin(_pulseT);
        contact.visible = true;
        setTrail(trailS);
      } else if (ph.name === "measure") {
        joints = poseForWeld(1, 0);
        contactOn = true;
        trailS = 1;
        dwellBright = true;
        _pulseT = t * 4 * Math.PI * 2 * 5;
        pulse = 0.7 + 0.3 * Math.sin(_pulseT);
        contact.visible = true;
        setTrail(1);
      } else if (ph.name === "linRetract") {
        /* LIN retract along normal: contact → hover at weld end */
        var ru = linU(ph.u);
        lift = lerp(0, HOVER_LIFT, ru);
        joints = poseForWeld(1, lift);
        contactOn = ru < 0.12;
        trailS = 1;
        contact.visible = contactOn;
        setTrail(1);
      } else {
        /* ptpHome: joint-space PTP hoverEnd → HOME */
        joints = mixPose(hoverEnd, POSE_HOME, ph.u);
        lift = HOVER_LIFT;
        contactOn = false;
        trailS = 1;
        contact.visible = false;
        setTrail(1);
      }

      /* Reset tip local offset each frame (snap is ephemeral) */
      tip.position.copy(TIP_LOCAL_DEFAULT);
      tipGlow.position.copy(TIP_LOCAL_DEFAULT);

      applyJoints(joints);
      /* Keep elbow-up after analytic seed (PTP mixes may still dip) */
      if (
        ph.name === "linApproach" ||
        ph.name === "scan" ||
        ph.name === "measure" ||
        ph.name === "linRetract" ||
        (ph.name === "ptpApproach" && ph.u > 0.55)
      ) {
        enforceElbowUp();
      }

      /* CCD target: tip on weld during contact/scan; along +Y for approach/retract */
      var sSamp =
        ph.name === "scan" || ph.name === "measure"
          ? ph.s
          : ph.name === "linRetract" || ph.name === "ptpHome"
            ? 1
            : 0;
      var ccdLift = 0;
      var runCcd = false;
      if (ph.name === "ptpApproach") {
        /* Late PTP: nudge tip toward hover target so LIN starts clean */
        ccdLift = HOVER_LIFT;
        runCcd = ph.u > 0.75;
      } else if (ph.name === "linApproach") {
        ccdLift = lift;
        runCcd = true;
      } else if (ph.name === "scan" || ph.name === "measure") {
        ccdLift = settleLift;
        runCcd = true;
      } else if (ph.name === "linRetract") {
        ccdLift = lift;
        runCcd = true;
      }

      var tipTarget = weldTarget(sSamp, ccdLift);
      var tipErr = 0;
      var preErr = 0;
      tip.updateWorldMatrix(true, false);
      tip.getWorldPosition(_ccdTip);
      preErr = _ccdTip.distanceTo(tipTarget);
      if (runCcd) {
        tipErr = refineReach(tipTarget, 5);
        tipErr = ccdReach(tipTarget, 22);
        tipErr = maybeSnapTip(tipTarget, tipErr);
      } else {
        tip.updateWorldMatrix(true, false);
        tip.getWorldPosition(_ccdTip);
        tipErr = _ccdTip.distanceTo(tipTarget);
      }

      tip.updateWorldMatrix(true, false);
      tip.getWorldPosition(tipWorld);
      global.__bootTipErr = tipErr;
      var _eyDbg = elbowWorldY();
      global.__bootElbowY = _eyDbg;
      global.__bootJoints = {
        yaw: j1.rotation.y,
        sh: j2.rotation.z,
        el: j3.rotation.z,
        wr: j5.rotation.z,
        wrY: j4.rotation.y,
      };
      global.__bootTipDebug = {
        phase: ph.name,
        s: sSamp,
        lift: ccdLift,
        err: tipErr,
        preErr: preErr,
        elbowY: _eyDbg,
        joints: global.__bootJoints,
        tip: [tipWorld.x, tipWorld.y, tipWorld.z],
        tgt: [tipTarget.x, tipTarget.y, tipTarget.z],
      };

      var weldPt = weldCurve.getPointAt(sSamp);

      if (contactOn || ph.name === "scan" || ph.name === "measure") {
        contact.position.copy(weldPt);
        contact.position.y += 0.01;
        contactMat.emissiveIntensity = dwellBright
          ? 1.35
          : 0.65 + 0.55 * pulse;
        contact.scale.setScalar(dwellBright ? 1.25 : 0.95 + 0.2 * pulse);

        scanRing.position.copy(contact.position);
        scanRing.position.y += 0.002;
        scanRing.material.opacity = dwellBright
          ? 0.95
          : 0.35 + 0.5 * pulse;
        scanRing.scale.setScalar(dwellBright ? 1.15 : 0.9 + 0.25 * pulse);

        beam.position.copy(contact.position);
        beam.position.y += 0.06;
        beam.material.opacity = dwellBright
          ? 0.7
          : 0.15 + 0.45 * pulse;
      } else {
        scanRing.material.opacity = 0;
        beam.material.opacity = 0;
      }

      /* Tip glow: UT pulse during scan/measure */
      if (ph.name === "scan") {
        tipGlow.intensity = 0.35 + 0.85 * pulse;
        tipGlow.distance = 1.1 + 0.4 * pulse;
        matAccent.emissiveIntensity = 0.25 + 0.45 * pulse;
      } else if (ph.name === "measure") {
        tipGlow.intensity = 1.15 + 0.35 * pulse;
        tipGlow.distance = 1.5;
        matAccent.emissiveIntensity = 0.7;
      } else if (ph.name === "linApproach" && contactOn) {
        tipGlow.intensity = 0.7;
        matAccent.emissiveIntensity = 0.35;
      } else {
        tipGlow.intensity = 0.35;
        tipGlow.distance = 1.15;
        matAccent.emissiveIntensity = 0.18;
      }

      /* Camera: calm hold → gentle push-in on approach/scan → ease back (no orbit) */
      var camT;
      if (ph.name === "home") {
        camera.position.copy(camHome);
        lookAt.copy(lookHome);
      } else if (ph.name === "ptpApproach") {
        camT = ph.u;
        camera.position.lerpVectors(camHome, camScan, camT * 0.55);
        lookAt.lerpVectors(lookHome, lookScan, camT * 0.7);
      } else if (ph.name === "linApproach") {
        camT = easeInOut(ph.u);
        camera.position.lerpVectors(
          new THREE.Vector3().lerpVectors(camHome, camScan, 0.55),
          camScan,
          camT
        );
        lookAt.lerpVectors(
          new THREE.Vector3().lerpVectors(lookHome, lookScan, 0.7),
          lookScan,
          camT
        );
      } else if (ph.name === "scan") {
        camT = ph.s;
        camera.position.lerpVectors(camScan, camEnd, camT * 0.28);
        lookAt.copy(lookScan);
        lookAt.x = lookScan.x + ph.s * 0.32;
      } else if (ph.name === "measure") {
        camera.position.copy(camEnd);
        lookAt.copy(lookScan);
        lookAt.x = lookScan.x + 0.32;
      } else if (ph.name === "linRetract") {
        camT = easeInOut(ph.u) * 0.25;
        camera.position.lerpVectors(camEnd, camHome, camT);
        lookAt.lerpVectors(
          new THREE.Vector3(lookScan.x + 0.32, lookScan.y, lookScan.z),
          lookHome,
          camT
        );
      } else {
        /* ptpHome */
        camT = ph.u;
        camera.position.lerpVectors(
          new THREE.Vector3().lerpVectors(camEnd, camHome, 0.25),
          camHome,
          camT
        );
        lookAt.lerpVectors(
          new THREE.Vector3().lerpVectors(
            new THREE.Vector3(lookScan.x + 0.32, lookScan.y, lookScan.z),
            lookHome,
            0.25
          ),
          lookHome,
          camT
        );
      }
      camera.lookAt(lookAt);

      renderer.render(scene, camera);
    }

    function onResize() {
      var w = container.clientWidth || W;
      var h = Math.max(280, Math.round(w * 0.5625));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
    }
    window.addEventListener("resize", onResize);

    var disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", onResize);
      try {
        renderer.dispose();
      } catch (e) {}
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      scene.traverse(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material))
            obj.material.forEach(function (m) {
              m.dispose && m.dispose();
            });
          else if (obj.material.dispose) obj.material.dispose();
        }
      });
    }

    pose(0);
    return { pose: pose, dispose: dispose, kind: "three" };
  }

  /**
   * Async-friendly entry: loads THREE if needed, then mounts.
   * cb(err, controller|null)
   */
  function tryMount(container, opts, cb) {
    opts = opts || {};
    if (!container || opts.reduce || !webglOk()) {
      cb(null, null);
      return;
    }
    loadThree(function (err) {
      if (err || !global.THREE) {
        cb(null, null);
        return;
      }
      var ctl = null;
      try {
        ctl = mount(container, opts);
      } catch (e) {
        ctl = null;
      }
      cb(null, ctl);
    });
  }

  global.RobinspectBoot3D = {
    tryMount: tryMount,
    mount: mount,
    CDN: CDN,
  };
})(typeof window !== "undefined" ? window : this);
