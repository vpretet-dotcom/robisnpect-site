(function () {
  var btn = document.getElementById("menuBtn");
  var mobile = document.getElementById("mobile");
  if (btn && mobile) {
    btn.addEventListener("click", function () {
      var open = mobile.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* Lightbox: open framed shots, close on Esc, backdrop tap, or the close button. */
  var lb = document.getElementById("lightbox");
  if (lb) {
    var lbImg = lb.querySelector("[data-lb-img]");
    var lbCap = lb.querySelector("[data-lb-cap]");
    var closer = lb.querySelector("[data-lb-close]");
    var lastFocus = null;

    function closeLb() {
      lb.classList.remove("open");
      lb.setAttribute("aria-hidden", "true");
      document.body.classList.remove("lb-on");
      if (lbImg) {
        lbImg.removeAttribute("src");
        lbImg.alt = "";
      }
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function openLb(src, alt, cap) {
      lastFocus = document.activeElement;
      if (lbImg) {
        lbImg.src = src;
        lbImg.alt = alt || "";
      }
      if (lbCap) lbCap.textContent = cap || "";
      lb.classList.add("open");
      lb.setAttribute("aria-hidden", "false");
      document.body.classList.add("lb-on");
      if (closer) closer.focus();
    }
    document.querySelectorAll("[data-shot]").forEach(function (el) {
      el.addEventListener("click", function () {
        var src = el.getAttribute("data-full") || el.getAttribute("data-shot");
        var img = el.querySelector("img");
        var capEl = el.closest("figure") && el.closest("figure").querySelector("figcaption");
        openLb(src, img ? img.alt : "", capEl ? capEl.textContent : "");
      });
    });
    if (closer) closer.addEventListener("click", closeLb);
    lb.addEventListener("click", function (e) {
      if (e.target === lb) closeLb();
    });
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && lb.classList.contains("open")) {
        e.preventDefault();
        closeLb();
      }
    });
  }

  /* Beta form: posts to the Google Apps Script web app (Sheet « simUT bêta » + email).
     Set the deployed /exec URL in BETA_ENDPOINT below, or in data-endpoint on the form.
     While both are empty the form shows its error state: it never fakes a success. */
  var BETA_ENDPOINT = "";

  /* beta-validate:start  Same rules as validate_() in beta-apps-script.gs: anything accepted here is accepted there. */
  var BETA_EMAIL_RE = /^[A-Za-z0-9.!#$%&'*\/=?^_`{|}~+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
  var BETA_MAX = { email: 254, name: 100, company: 150 };
  var BETA_LINKISH_RE = /:\/\/|www\.|@/i;
  var BETA_SIMULATE = ["single-element", "phased-array", "other"];
  function betaNormalize(v) {
    return String(v == null ? "" : v)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]+/g, "")
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  /* Returns the name of the first invalid field, or "" when everything passes. */
  function betaCheck(f) {
    var email = betaNormalize(f.email).toLowerCase();
    var name = betaNormalize(f.name);
    var company = betaNormalize(f.company);
    if (email.length > BETA_MAX.email || !BETA_EMAIL_RE.test(email)) return "email";
    if (name.length < 1 || name.length > BETA_MAX.name || BETA_LINKISH_RE.test(name)) return "name";
    if (company.length < 1 || company.length > BETA_MAX.company || BETA_LINKISH_RE.test(company)) return "company";
    if (BETA_SIMULATE.indexOf(betaNormalize(f.simulate)) < 0) return "simulate";
    return "";
  }
  /* beta-validate:end */
  var BETA_MSG = {
    en: { email: "Enter a valid work email.", name: "Enter your name, without a link or an email address.", company: "Enter your company, without a link or an email address.", simulate: "Select one option." },
    fr: { email: "Indiquez un email professionnel valide.", name: "Indiquez votre nom, sans lien ni adresse email.", company: "Indiquez votre entreprise, sans lien ni adresse email.", simulate: "Choisissez une option." }
  };
  var form = document.getElementById("beta-form");
  if (!form) return;
  var ok = document.getElementById("beta-ok");
  var err = form.querySelector(".form-error");
  var submit = form.querySelector("[type=submit]");
  var sendingLabel = form.getAttribute("data-sending") || "Sending…";
  var idleLabel = submit ? submit.textContent : "Request beta access";
  var loadedAt = Date.now();
  var qs;
  try { qs = new URLSearchParams(window.location.search); } catch (e0) { qs = null; }

  function endpoint() {
    var override = qs && qs.get("endpoint");
    /* QA only: ?endpoint= is honoured solely for a local mock, so a crafted link can't redirect visitors' data. */
    if (override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(override)) return override;
    return form.getAttribute("data-endpoint") || BETA_ENDPOINT || "";
  }
  function showError() {
    form.classList.add("is-error");
    if (err) err.setAttribute("role", "alert");
    submit.disabled = false;
    submit.textContent = idleLabel;
  }
  function showOk() {
    form.hidden = true;
    if (ok) {
      ok.classList.add("is-on");
      ok.setAttribute("tabindex", "-1");
      ok.focus();
    }
  }

  ["email", "name", "company", "simulate"].forEach(function (n) {
    var el = form.elements[n];
    if (el) el.addEventListener(n === "simulate" ? "change" : "input", function () { el.setCustomValidity(""); });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!submit || submit.disabled) return;
    form.classList.remove("is-error");
    var bad = betaCheck({
      email: form.elements.email.value, name: form.elements.name.value,
      company: form.elements.company.value, simulate: form.elements.simulate.value
    });
    if (bad) {
      var lang = (form.elements.lang && form.elements.lang.value) === "fr" ? "fr" : "en";
      var field = form.elements[bad];
      field.setCustomValidity(BETA_MSG[lang][bad]);
      field.reportValidity();
      return;
    }
    submit.disabled = true;
    submit.textContent = sendingLabel;

    var url = endpoint();
    if ((qs && qs.get("fail") === "1") || !url || !window.fetch) {
      setTimeout(showError, 400);
      return;
    }
    var data = new URLSearchParams();
    new FormData(form).forEach(function (v, k) { data.append(k, String(v)); });
    data.set("elapsed", String(Date.now() - loadedAt));
    data.set("ua", (navigator.userAgent || "").slice(0, 400));

    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; showError(); } }, 15000);
    /* Apps Script answers with a cross-origin redirect, so the response is opaque (no-cors):
       a resolved fetch means the request reached Google; a rejection or timeout is an error. */
    fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: data.toString()
    }).then(function () {
      if (done) return; done = true; clearTimeout(timer); showOk();
    }, function () {
      if (done) return; done = true; clearTimeout(timer); showError();
    });
  });
})();
