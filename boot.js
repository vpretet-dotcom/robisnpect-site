(function () {
  var boot = document.getElementById("boot");
  if (!boot) return;
  var root = document.documentElement;
  if (!root.classList.contains("boot")) {
    boot.parentNode.removeChild(boot);
    return;
  }

  /* Budget from navigation start: intro 1.5 s + up to two 2 s loops + 1 s outro */
  var CAP_MS = 7000;
  var LOOP_MS = 2000;
  var OUTRO_MS = 1000;
  var STALL_MS = 2500;
  var HOLD_MS = 800;
  /* The bottom 22% of the frame was kept calm for the wordmark */
  var ZONE = 0.78;
  var BASE = "/media/loader/robinspect-loading-";

  var word = boot.querySelector(".boot-word");
  var reduce = false;
  var wide = true;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    wide = window.matchMedia("(min-width: 768px)").matches;
  } catch (e) {}
  /* Phones get the 960 clip too: shown whole (contain), so it must stay sharp */
  var size = "960";

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  var done = false;
  var failed = false;
  var clips = [];
  var current = null;

  function setPhase(p) {
    boot.setAttribute("data-phase", p);
  }

  var ready = false;
  var waiting = [];
  var loaded = document.readyState === "complete";
  var fontsOk = !(document.fonts && document.fonts.ready);
  function whenReady(fn) {
    if (ready) fn();
    else waiting.push(fn);
  }
  function checkReady() {
    if (ready || !loaded || !fontsOk) return;
    ready = true;
    waiting.splice(0).forEach(function (fn) { fn(); });
  }
  if (!loaded) {
    window.addEventListener("load", function () {
      loaded = true;
      checkReady();
    }, { once: true });
  }
  function fontsDone() {
    fontsOk = true;
    placeWord();
    checkReady();
  }
  if (!fontsOk) document.fonts.ready.then(fontsDone, fontsDone);

  function placeWord() {
    if (!word) return;
    var w = boot.clientWidth;
    var h = boot.clientHeight;
    if (!w || !h) return;
    var half = word.offsetHeight / 2;
    var y;
    if (w >= 768) {
      /* Rendered box of a 16:9 frame under object-fit: cover, centred */
      var s = Math.max(w / 960, h / 540);
      var bh = 540 * s;
      var top = (h - bh) / 2;
      var a = Math.max(0, top + bh * ZONE);
      var b = Math.min(h, top + bh);
      y = Math.min((a + b) / 2, h - half - 12);
    } else {
      /* Phones: frame is letterboxed (contain); word sits 24 px under the band */
      var bh2 = 540 * Math.min(w / 960, h / 540);
      y = Math.min((h + bh2) / 2 + 24 + half, h - half - 12);
    }
    word.style.top = y.toFixed(1) + "px";
  }

  function onKey(e) {
    if (e.key === "Escape" || e.key === "Esc") reveal();
  }
  function onFocus(e) {
    if (!boot.contains(e.target)) reveal();
  }

  function stopClip(v) {
    try { v.pause(); } catch (e) {}
    while (v.firstChild) v.removeChild(v.firstChild);
    try { v.load(); } catch (e) {}
  }

  function reveal() {
    if (done) return;
    done = true;
    setPhase("out");
    window.removeEventListener("resize", placeWord);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("focusin", onFocus);
    root.classList.remove("boot");
    boot.classList.add("out");
    window.dispatchEvent(new Event("robinspect:ready"));
    setTimeout(function () {
      clips.forEach(stopClip);
      if (boot.parentNode) boot.parentNode.removeChild(boot);
    }, 700);
  }

  function holdThenReveal() {
    var t = now();
    whenReady(function () {
      setTimeout(reveal, Math.max(0, HOLD_MS - (now() - t)));
    });
  }

  function fallback() {
    if (done || failed) return;
    failed = true;
    setPhase("fallback");
    clips.forEach(function (v) {
      v.classList.remove("on");
      stopClip(v);
    });
    if (word) word.classList.add("on");
    holdThenReveal();
  }

  function clip(name) {
    var v = document.createElement("video");
    v.className = "boot-vid";
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("disablepictureinpicture", "");
    v.setAttribute("disableremoteplayback", "");
    v.setAttribute("preload", "auto");
    v.tabIndex = -1;
    var src = BASE + name + "-" + size;
    var webm = document.createElement("source");
    webm.src = src + ".webm";
    webm.type = 'video/webm; codecs="vp9"';
    var mp4 = document.createElement("source");
    mp4.src = src + ".mp4";
    mp4.type = 'video/mp4; codecs="avc1.640028"';
    mp4.addEventListener("error", fallback);
    v.addEventListener("error", fallback);
    v.appendChild(webm);
    v.appendChild(mp4);
    boot.insertBefore(v, word);
    clips.push(v);
    return v;
  }

  function onFirstFrame(v, fn) {
    var fired = false;
    var rvfc = typeof v.requestVideoFrameCallback === "function";
    function go() {
      if (fired) return;
      fired = true;
      fn();
    }
    if (rvfc) v.requestVideoFrameCallback(go);
    v.addEventListener("playing", function once() {
      v.removeEventListener("playing", once);
      /* Backup in case the frame callback is withheld for a layer at opacity 0 */
      if (rvfc) setTimeout(go, 250);
      else requestAnimationFrame(go);
    });
  }

  /* Later clips sit above earlier ones, so the previous clip's last frame stays
     on screen until the next clip has painted its first frame. */
  function play(v, shown) {
    var ok = false;
    var timer = setTimeout(function () {
      if (!ok) fallback();
    }, STALL_MS);
    onFirstFrame(v, function () {
      ok = true;
      clearTimeout(timer);
      if (done || failed) return;
      v.classList.add("on");
      var prev = current;
      current = v;
      if (prev) requestAnimationFrame(function () { prev.classList.remove("on"); });
      if (shown) shown();
    });
    var p;
    try {
      p = v.play();
    } catch (e) {
      fallback();
      return;
    }
    if (p && typeof p.catch === "function") p.catch(fallback);
  }

  function sequence() {
    var intro = clip("intro");
    var loop, outro;

    play(intro, function () {
      setPhase("intro");
      loop = clip("loop");
      loop.loop = true;
      outro = clip("outro");
      outro.addEventListener("ended", reveal);
      loop.addEventListener("ended", function () {
        play(outro, function () { setPhase("outro"); });
      });
    });

    intro.addEventListener("ended", function () {
      if (!loop || done || failed) return;
      play(loop, function () {
        setPhase("loop");
        if (word) word.classList.add("on");
        var last = 0;
        /* Leaving `loop` false makes the current pass the last one:
           always one full pass, more only while loading and within the cap. */
        function decide(passStart) {
          if (ready || passStart + 2 * LOOP_MS + OUTRO_MS > CAP_MS) loop.loop = false;
        }
        decide(now());
        whenReady(function () { loop.loop = false; });
        loop.addEventListener("timeupdate", function () {
          if (loop.currentTime < last) decide(now());
          last = loop.currentTime;
        });
      });
    });
  }

  placeWord();
  window.addEventListener("resize", placeWord);
  document.addEventListener("keydown", onKey);
  document.addEventListener("focusin", onFocus);
  boot.addEventListener("click", reveal);
  setTimeout(reveal, Math.max(0, CAP_MS - now()));

  if (reduce) {
    setPhase("reduced");
    /* No video, but the word still says whose site this is */
    if (word) word.classList.add("on");
    holdThenReveal();
  } else {
    setPhase("poster");
    sequence();
  }
})();
