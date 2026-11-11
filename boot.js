(function () {
  var boot = document.getElementById("boot");
  if (!boot) return;
  var root = document.documentElement;
  if (!root.classList.contains("boot")) {
    boot.parentNode.removeChild(boot);
    return;
  }

  /* Logo-only overlay on top of a page that is already rendered underneath.
     Shown once per visit (the head script sets the flag), 1.5 s at most. */
  var MIN_MS = 700;
  var CAP_MS = 1500;
  var done = false;
  var word = boot.querySelector(".boot-word");
  if (word) word.classList.add("on");

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function reveal() {
    if (done) return;
    done = true;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("focusin", onFocus);
    root.classList.remove("boot");
    boot.classList.add("out");
    window.dispatchEvent(new Event("robinspect:ready"));
    setTimeout(function () {
      if (boot.parentNode) boot.parentNode.removeChild(boot);
    }, 700);
  }
  function onKey(e) {
    if (e.key === "Escape" || e.key === "Esc") reveal();
  }
  function onFocus(e) {
    if (!boot.contains(e.target)) reveal();
  }

  var loaded = document.readyState === "complete";
  var fontsOk = !(document.fonts && document.fonts.ready);
  function check() {
    if (done || !loaded || !fontsOk) return;
    setTimeout(reveal, Math.max(0, MIN_MS - now()));
  }
  if (!loaded) window.addEventListener("load", function () { loaded = true; check(); }, { once: true });
  if (!fontsOk) document.fonts.ready.then(function () { fontsOk = true; check(); }, function () { fontsOk = true; check(); });
  check();

  document.addEventListener("keydown", onKey);
  document.addEventListener("focusin", onFocus);
  boot.addEventListener("click", reveal);
  setTimeout(reveal, Math.max(0, CAP_MS - now()));
})();
