(function () {
  var boot = document.getElementById("boot");
  if (!boot) return;

  var lang = (document.documentElement.lang || "en").slice(0, 2);
  var fr = lang === "fr";
  var reduce = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  var STATUS = fr
    ? ["Initialisation", "Bras", "Trajectoire", "Sonde", "Système prêt"]
    : ["Initializing", "Arm", "Trajectory", "Probe", "System ready"];

  var CDN = "https://robinspect-systems.com";
  /* Local cinema jpg + light posters; heavy mp4s (>3MB) stay on CDN so localhost preload progresses */
  var ASSETS = [
    { url: "/media/fond-noir.webp", bytes: 17476 },
    { url: "/media/hero-cinema.jpg", bytes: 321966 },
    { url: "/media/probe-cinema.jpg", bytes: 296882 },
    { url: "/media/challenge-cinema.jpg", bytes: 556934 },
    { url: "/media/energy-cinema.jpg", bytes: 467630 },
    { url: "/media/bench-cinema.jpg", bytes: 317165 },
    { url: "/media/founder.webp", bytes: 132290 },
    { url: "/media/linkedin-noir.webp", bytes: 36744 },
    { url: "/media/presentation-poster.jpg", bytes: 137707 },
    { url: "/media/demo-sept-poster.webp", bytes: 72832 },
    { url: "/media/demo-wide-poster.webp", bytes: 23210 },
    { url: "/media/demo-square-poster.webp", bytes: 31332 },
    { url: CDN + "/media/hero-bg.mp4", bytes: 3848074 },
    { url: CDN + "/media/probe-bg.mp4", bytes: 3292923 },
    { url: "/media/demo-sept.mp4", bytes: 1295002 },
    { url: "/media/demo-wide.mp4", bytes: 1128294 },
    { url: "/media/demo-square.mp4", bytes: 921383 },
    { url: CDN + "/media/presentation.mp4", bytes: 10819792 },
  ];

  var saveData = false;
  try {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    saveData = !!(c && (c.saveData || /2g/.test(c.effectiveType || "")));
  } catch (e) {}

  var queue = saveData
    ? ASSETS.filter(function (a) {
        return !a.url.endsWith(".mp4") || a.bytes < 4000000;
      })
    : ASSETS.slice();

  var statusEl = document.getElementById("bootStatus");
  var pctEl = document.getElementById("bootPct");
  var fillEl = document.getElementById("bootFill");
  var skipEl = document.getElementById("bootSkip");
  var scene = document.getElementById("bootScene");

  var MIN = 4000;
  var started = Date.now();
  var done = false;
  var raf = 0;

  function setProgress(p) {
    var pct = Math.max(0, Math.min(1, p));
    if (fillEl) fillEl.style.width = pct * 100 + "%";
    if (pctEl) pctEl.textContent = pct.toFixed(1);
    var idx = pct < 0.22 ? 0 : pct < 0.45 ? 1 : pct < 0.68 ? 2 : pct < 0.9 ? 3 : 4;
    if (statusEl) statusEl.textContent = STATUS[idx];
  }

  function mountScene() {
    if (!scene) return { pose: function () {} };
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "boot-svg");
    svg.setAttribute("viewBox", "0 0 960 540");
    svg.setAttribute("aria-hidden", "true");
    scene.appendChild(svg);

    function el(name, attrs) {
      var n = document.createElementNS(NS, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }

    svg.appendChild(el("rect", { x: 0, y: 0, width: 960, height: 540, fill: "#050505" }));
    var defs = el("defs", {});
    defs.innerHTML =
      '<linearGradient id="riGold" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#f3d56a"/><stop offset="1" stop-color="#e8c547"/></linearGradient>' +
      '<filter id="riGlow" x="-50%" y="-50%" width="200%" height="200%">' +
      '<feGaussianBlur stdDeviation="2.2" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg.appendChild(defs);

    /* —— A-scan: amplitude vs time, rectified, with gate —— */
    var ax = 48, ay = 22, aw = 864, ah = 96;
    var baseY = ay + ah - 8;
    var topY = ay + 10;
    svg.appendChild(el("rect", {
      x: ax - 8, y: ay - 4, width: aw + 16, height: ah + 16,
      fill: "#080807", stroke: "#24211c", "stroke-width": "1",
    }));
    var g;
    for (g = 1; g <= 3; g++) {
      var gy = topY + (baseY - topY) * (g / 4);
      svg.appendChild(el("line", {
        x1: ax, y1: gy, x2: ax + aw, y2: gy,
        stroke: "#1c1a16", "stroke-width": "1",
      }));
    }
    for (g = 1; g <= 7; g++) {
      svg.appendChild(el("line", {
        x1: ax + (aw * g) / 8, y1: topY, x2: ax + (aw * g) / 8, y2: baseY,
        stroke: "#1c1a16", "stroke-width": "1",
      }));
    }
    var echoLbl = el("text", {
      x: ax, y: ay + 2, fill: "#e8c547",
      "font-family": "IBM Plex Mono, ui-monospace, monospace",
      "font-size": "10", "letter-spacing": "2.4",
    });
    echoLbl.textContent = "A-SCAN  ·  AMPLITUDE / TIME";
    svg.appendChild(echoLbl);
    var gate = el("rect", {
      x: ax + aw * 0.32, y: topY + 6, width: aw * 0.22, height: baseY - topY - 10,
      fill: "rgba(232,197,71,.08)", stroke: "#e8c547", "stroke-width": "1",
    });
    svg.appendChild(gate);
    var echo = el("path", { class: "boot-echo", d: "M48 110 H912", "stroke-linejoin": "round" });
    svg.appendChild(echo);
    svg.appendChild(el("line", {
      x1: ax, y1: baseY, x2: ax + aw, y2: baseY,
      stroke: "#3a362e", "stroke-width": "1",
    }));

    /* —— Coupon + weld bead, not a blob —— */
    var part = el("g", {});
    part.appendChild(el("path", {
      d: "M418 428 L 888 428 L 888 478 L 418 478 Z",
      fill: "#0c0b09", stroke: "#2a261f", "stroke-width": "1.2",
    }));
    part.appendChild(el("path", {
      d: "M418 428 L 888 428",
      fill: "none", stroke: "#3a362e", "stroke-width": "1",
    }));
    var weld = el("path", {
      d: "M460 428 C 520 412, 560 412, 600 428 C 650 412, 700 412, 750 428 C 800 414, 840 414, 870 428",
      fill: "none", stroke: "url(#riGold)", "stroke-width": "2.2", "stroke-linecap": "round",
    });
    part.appendChild(weld);
    svg.appendChild(part);

    var sx = 248, sy = 392, L1 = 168, L2 = 152;
    var arm = el("g", {});
    svg.appendChild(arm);

    arm.appendChild(el("rect", {
      x: sx - 62, y: 456, width: 124, height: 18, rx: 2,
      fill: "#0e0d0b", stroke: "#e8c547", "stroke-width": "1.15",
    }));
    arm.appendChild(el("rect", {
      x: sx - 34, y: sy + 8, width: 68, height: 58, rx: 8,
      fill: "#141310", stroke: "#e8c547", "stroke-width": "1.15",
    }));

    function joint() {
      var outer = el("circle", { r: 20, fill: "#12110e", stroke: "url(#riGold)", "stroke-width": "1.7" });
      var inner = el("circle", { r: 6, fill: "none", stroke: "url(#riGold)", "stroke-width": "1.05" });
      arm.appendChild(outer);
      arm.appendChild(inner);
      return {
        set: function (x, y, r) {
          outer.setAttribute("cx", x);
          outer.setAttribute("cy", y);
          if (r) outer.setAttribute("r", r);
          inner.setAttribute("cx", x);
          inner.setAttribute("cy", y);
          arm.appendChild(outer);
          arm.appendChild(inner);
        },
      };
    }
    var j2 = joint();
    j2.set(sx, sy, 21);

    function tube(wo, wi) {
      var a = el("line", {
        x1: sx, y1: sy, x2: sx, y2: sy,
        stroke: "#c4bbab", "stroke-width": String(wo), "stroke-linecap": "round",
      });
      var b = el("line", {
        x1: sx, y1: sy, x2: sx, y2: sy,
        stroke: "#161410", "stroke-width": String(wi), "stroke-linecap": "round",
      });
      arm.appendChild(a);
      arm.appendChild(b);
      return [a, b];
    }
    var upper = tube(16, 9);
    var j3 = joint();
    var fore = tube(14, 8);
    var j4 = joint();
    var j5 = joint();
    var j6 = joint();
    var wedge = el("path", {
      fill: "#10100c", stroke: "url(#riGold)", "stroke-width": "1.35",
      d: "M0 0",
    });
    arm.appendChild(wedge);
    var face = el("circle", {
      r: 3.2, fill: "#e8c547", filter: "url(#riGlow)",
    });
    svg.appendChild(face);

    function pathPoint(t) {
      var u = t * t * (3 - 2 * t);
      var x = 490 + u * 340;
      var y = 428;
      return { x: x, y: y, nx: 0, ny: -1 };
    }

    function echoPath(scan) {
      var ip = 0.1;
      var flaw = 0.4 + Math.sin(scan * Math.PI) * 0.03;
      var bw = 0.78;
      var flawH = 0.26 + 0.28 * (0.55 + 0.45 * Math.sin(scan * Math.PI * 2));
      function amp(u) {
        var grass = 0.025 * Math.abs(Math.sin(u * 70.3) * Math.sin(u * 17.1));
        var p0 = Math.exp(-Math.pow((u - ip) * 42, 2)) * 0.92;
        var p1 = Math.exp(-Math.pow((u - flaw) * 38, 2)) * flawH;
        var p2 = Math.exp(-Math.pow((u - bw) * 34, 2)) * 0.64;
        return grass + p0 + p1 + p2;
      }
      var d = "";
      var n = 160;
      for (var i = 0; i <= n; i++) {
        var u = i / n;
        var x = ax + u * aw;
        var y = baseY - amp(u) * (baseY - topY);
        d += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      return d;
    }

    function setLine(pair, x1, y1, x2, y2) {
      pair[0].setAttribute("x1", x1);
      pair[0].setAttribute("y1", y1);
      pair[0].setAttribute("x2", x2);
      pair[0].setAttribute("y2", y2);
      pair[1].setAttribute("x1", x1);
      pair[1].setAttribute("y1", y1);
      pair[1].setAttribute("x2", x2);
      pair[1].setAttribute("y2", y2);
    }

    function pose(t) {
      var scan = t < 0.2 ? (t / 0.2) * 0.06 : 0.5 - 0.5 * Math.cos((t - 0.2) * Math.PI * 2 * 1.05);
      var p = pathPoint(scan);
      var tx = p.x;
      var ty = p.y - 58;
      var dx = tx - sx, dy = ty - sy;
      var dist = Math.hypot(dx, dy);
      var reach = L1 + L2 - 8;
      if (dist > reach) {
        dx *= reach / dist;
        dy *= reach / dist;
        dist = reach;
        tx = sx + dx;
        ty = sy + dy;
      }
      dist = Math.max(16, dist);
      var a = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
      var b = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2))));
      var base = Math.atan2(dy, dx);
      var sh = base - a;
      var elA = Math.PI - b;
      var e1x = sx + Math.cos(sh) * L1;
      var e1y = sy + Math.sin(sh) * L1;
      var wAng = sh + elA;
      var wx = e1x + Math.cos(wAng) * L2;
      var wy = e1y + Math.sin(wAng) * L2;
      var down = Math.atan2(p.y - wy, p.x - wx);
      var j5x = wx + Math.cos(down) * 18;
      var j5y = wy + Math.sin(down) * 18;
      var j6x = wx + Math.cos(down) * 32;
      var j6y = wy + Math.sin(down) * 32;
      var ca = Math.cos(down), sa = Math.sin(down);
      function pt(lx, ly) {
        return [j6x + lx * ca - ly * sa, j6y + lx * sa + ly * ca];
      }
      var wA = pt(6, -11), wB = pt(28, -11), wC = pt(28, 6), wD = pt(4, 6);
      wedge.setAttribute(
        "d",
        "M" + wA[0].toFixed(1) + " " + wA[1].toFixed(1) +
          " L" + wB[0].toFixed(1) + " " + wB[1].toFixed(1) +
          " L" + wC[0].toFixed(1) + " " + wC[1].toFixed(1) +
          " L" + wD[0].toFixed(1) + " " + wD[1].toFixed(1) + " Z",
      );
      setLine(upper, sx, sy, e1x, e1y);
      j3.set(e1x, e1y, 19);
      setLine(fore, e1x, e1y, wx, wy);
      j4.set(wx, wy, 14);
      j5.set(j5x, j5y, 11);
      j6.set(j6x, j6y, 9);
      face.setAttribute("cx", p.x);
      face.setAttribute("cy", p.y);
      echo.setAttribute("d", echoPath(scan));
      gate.setAttribute("x", ax + aw * (0.32 + Math.sin(scan * Math.PI) * 0.012));
    }

    pose(reduce ? 0.5 : 0);
    return { pose: pose };
  }

  function mountSvgScene() {
    return mountScene();
  }

  var ctl = { pose: function () {}, dispose: function () {} };
  var sceneReady = false;

  function startTicks() {
    started = Date.now();
    if (reduce) {
      setProgress(0.5);
      if (ctl.pose) ctl.pose(0.5);
      setTimeout(reveal, MIN);
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function useController(c) {
    if (sceneReady || done) {
      if (c && c.dispose) try { c.dispose(); } catch (e) {}
      return;
    }
    if (c && c.pose) ctl = c;
    else ctl = mountSvgScene();
    sceneReady = true;
    startTicks();
  }

  /* Prefer Three.js vignette; SVG arm is the offline / no-WebGL fallback */
  if (reduce) {
    useController(mountSvgScene());
  } else if (window.RobinspectBoot3D && typeof window.RobinspectBoot3D.tryMount === "function") {
    window.RobinspectBoot3D.tryMount(scene, { reduce: reduce }, function (_err, c3) {
      if (done) {
        if (c3 && c3.dispose) c3.dispose();
        return;
      }
      useController(c3);
    });
    /* Safety: if THREE CDN hangs, fall back after 1.2s */
    setTimeout(function () {
      if (!sceneReady && !done) useController(null);
    }, 1200);
  } else {
    useController(mountSvgScene());
  }

  function tick() {
    if (done) return;
    var t = (Date.now() - started) / MIN;
    var p = Math.min(1, t);
    setProgress(p);
    if (ctl && ctl.pose) ctl.pose(p);
    if (t >= 1) {
      reveal();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function reveal() {
    if (done) return;
    done = true;
    if (raf) cancelAnimationFrame(raf);
    setProgress(1);
    if (ctl && ctl.dispose) {
      try { ctl.dispose(); } catch (e) {}
    }
    document.documentElement.classList.remove("boot");
    boot.classList.add("out");
    boot.setAttribute("aria-busy", "false");
    window.dispatchEvent(new Event("robinspect:ready"));
    setTimeout(function () {
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
    }, 700);
  }

  var CACHE = "robinspect-media-v1";
  async function loadOne(asset) {
    try {
      if ("caches" in window) {
        var cache = await caches.open(CACHE);
        if (await cache.match(asset.url)) return;
        var cred = asset.url.indexOf("http") === 0 ? "omit" : "same-origin";
        var res = await fetch(asset.url, { credentials: cred, mode: "cors" });
        if (res.ok) await cache.put(asset.url, res.clone());
      }
    } catch (e) {}
  }
  async function runQueue() {
    var i = 0;
    async function worker() {
      while (i < queue.length) {
        var item = queue[i++];
        await loadOne(item);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }

  if (skipEl) skipEl.addEventListener("click", reveal);
  setProgress(0);
  runQueue();
})();
