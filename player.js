(function () {
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function initPlayer(root) {
    var video = root.querySelector("video");
    var overlay = root.querySelector("[data-overlay]");
    var playBtn = root.querySelector("[data-play]");
    var fsBtn = root.querySelector("[data-fs]");
    var scrub = root.querySelector("[data-scrub]");
    var fill = root.querySelector("[data-fill]");
    var ticks = root.querySelector("[data-ticks]");
    var curEl = root.querySelector("[data-current]");
    var durEl = root.querySelector("[data-duration]");
    var chapBox = root.querySelector("[data-chapters]");
    var nowTitle = root.querySelector("[data-now-title]");
    var nowSub = root.querySelector("[data-now-sub]");
    var speedBox = root.querySelector("[data-speed]");
    if (!video || !scrub) return;

    var chapters = [];
    try {
      chapters = JSON.parse(root.getAttribute("data-chapters") || "[]");
    } catch (e) {
      chapters = [];
    }

    var duration = 454.59;
    var dragging = false;

    function currentChapter(t) {
      var ch = chapters[0] || null;
      for (var i = 0; i < chapters.length; i++) {
        if (t >= chapters[i].t) ch = chapters[i];
      }
      return ch;
    }

    function renderChapters() {
      if (!chapBox || !chapters.length) return;
      chapBox.innerHTML = chapters
        .map(function (c, i) {
          return (
            '<button type="button" class="chap" data-jump="' +
            c.t +
            '" aria-label="' +
            c.title +
            '">' +
            '<span class="t">' +
            fmt(c.t) +
            "</span>" +
            "<span><strong>" +
            c.title +
            "</strong><span class=\"sub\">" +
            (c.sub || "") +
            "</span></span></button>"
          );
        })
        .join("");
      if (ticks) {
        ticks.innerHTML = chapters
          .map(function (c) {
            var pct = (c.t / duration) * 100;
            return '<i class="scrub-tick" style="left:' + pct + '%"></i>';
          })
          .join("");
      }
    }

    function syncChapters(t) {
      var ch = currentChapter(t);
      if (chapBox) {
        var buttons = chapBox.querySelectorAll(".chap");
        buttons.forEach(function (b) {
          b.classList.toggle("on", Number(b.getAttribute("data-jump")) === (ch && ch.t));
        });
      }
      if (ch) {
        if (nowTitle) nowTitle.textContent = ch.title;
        if (nowSub) nowSub.textContent = ch.sub || "";
      }
    }

    function sync() {
      var t = video.currentTime || 0;
      var d = video.duration || duration;
      if (isFinite(d) && d > 0) duration = d;
      if (durEl) durEl.textContent = fmt(duration);
      if (curEl) curEl.textContent = fmt(t);
      if (fill) fill.style.width = duration ? (t / duration) * 100 + "%" : "0%";
      if (!dragging) scrub.value = duration ? String((t / duration) * 1000) : "0";
      syncChapters(t);
      var playing = !video.paused;
      root.classList.toggle("is-playing", playing);
      if (overlay) overlay.classList.toggle("hide", playing);
      if (playBtn) {
        playBtn.setAttribute("aria-label", playing ? playBtn.getAttribute("data-pause-label") : playBtn.getAttribute("data-play-label"));
        playBtn.innerHTML = playing
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      }
    }

    function toggle() {
      if (video.paused) video.play().catch(function () {});
      else video.pause();
    }

    renderChapters();
    sync();

    playBtn && playBtn.addEventListener("click", toggle);
    overlay && overlay.addEventListener("click", toggle);
    video.addEventListener("click", toggle);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", function () {
      duration = video.duration || duration;
      renderChapters();
      sync();
    });
    video.addEventListener("ended", function () {
      video.pause();
      sync();
    });

    scrub.addEventListener("input", function () {
      dragging = true;
      var t = (Number(scrub.value) / 1000) * duration;
      video.currentTime = t;
      sync();
    });
    scrub.addEventListener("change", function () {
      dragging = false;
      var t = (Number(scrub.value) / 1000) * duration;
      video.currentTime = t;
    });

    chapBox &&
      chapBox.addEventListener("click", function (e) {
        var b = e.target.closest("[data-jump]");
        if (!b) return;
        video.currentTime = Number(b.getAttribute("data-jump"));
        video.play().catch(function () {});
      });

    speedBox &&
      speedBox.addEventListener("click", function (e) {
        var b = e.target.closest("[data-rate]");
        if (!b) return;
        video.playbackRate = Number(b.getAttribute("data-rate"));
        speedBox.querySelectorAll("[data-rate]").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
      });

    fsBtn &&
      fsBtn.addEventListener("click", function () {
        var el = root.querySelector(".player-stage") || root;
        if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
        else document.exitFullscreen && document.exitFullscreen();
      });

    root.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        video.currentTime = Math.min(duration, video.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (e.key === "f") {
        fsBtn && fsBtn.click();
      }
    });
  }

  document.querySelectorAll("[data-presentation]").forEach(initPlayer);
})();
