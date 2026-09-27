/*
 * End report of the "your turn" step. Values come from the computed path
 * and coverage (live) or from the same numbers exported with the fallback
 * stills; this module only formats them. No three.js, so the no-WebGL
 * fallback can use it.
 */

export function reportCopy(turnCopy) {
  return (turnCopy && turnCopy.report) || null;
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

function plural(lang, n, forms) {
  if (!Array.isArray(forms)) return forms;
  const one = new Intl.PluralRules(lang).select(n) === 'one';
  return one ? forms[0] : forms[1];
}

export function formatReport(data, copy, lang) {
  const num = (v, digits) => new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  const int = (v) => new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(v);
  const len = data.contactM >= 1 ? num(data.contactM, 1) : num(data.contactM, 2);
  const pct = Math.min(100, Math.floor(data.coverage * 100 + 1e-6));
  const nInd = data.indications.length;
  const locTpl = copy.loc[data.part];
  return {
    title: copy.parts[data.part],
    zone: fill(copy.zone, { name: copy.zones[data.preset] || copy.zones.custom, a: int(data.zoneMm[0]), b: int(data.zoneMm[1]) }),
    passes: fill(plural(lang, data.passes, copy.passes), { n: int(data.passes), len }),
    coverage: fill(copy.coverage, { pct: int(pct) }),
    indications: nInd ? fill(plural(lang, nInd, copy.ind), { n: int(nInd) }) : copy.indNone,
    items: data.indications.map((ind) => ({
      id: ind.id,
      where: fill(locTpl, { a: ind.a !== undefined ? int(ind.a) : '', b: ind.b !== undefined ? int(ind.b) : '', cell: ind.cell || '' }),
      above: copy.above,
    })),
    thumb: fill(plural(lang, nInd, copy.thumb), { n: int(nInd), part: copy.parts[data.part] }),
    note: copy.note,
  };
}

export function renderReport(root, data, copy, lang) {
  if (!root || !copy) return null;
  const f = formatReport(data, copy, lang);
  const set = (key, text) => {
    const el = root.querySelector(`[data-r="${key}"]`);
    if (el) el.textContent = text;
  };
  set('title', f.title);
  set('zone', f.zone);
  set('passes', f.passes);
  set('coverage', f.coverage);
  set('indications', f.indications);
  set('note', f.note);
  const thumb = root.querySelector('[data-r="thumb"]');
  if (thumb) {
    if (thumb.tagName === 'IMG') thumb.alt = f.thumb;
    else thumb.setAttribute('aria-label', f.thumb);
  }
  const list = root.querySelector('[data-r="list"]');
  if (list) {
    list.textContent = '';
    for (const item of f.items) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = item.id;
      const span = document.createElement('span');
      span.append(`${item.where} · `);
      const em = document.createElement('em');
      em.textContent = item.above;
      span.append(em);
      li.append(b, span);
      list.append(li);
    }
    list.hidden = f.items.length === 0;
  }
  root.dataset.part = data.part;
  root.dataset.preset = data.preset;
  return f;
}

export function clearReport(root) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-r]')) {
    const key = el.dataset.r;
    if (key === 'thumb') {
      if (el.tagName === 'IMG') {
        el.removeAttribute('src');
        el.alt = '';
      } else el.removeAttribute('aria-label');
    } else if (key === 'list') {
      el.textContent = '';
      el.hidden = true;
    } else el.textContent = '';
  }
  delete root.dataset.part;
  delete root.dataset.preset;
}
