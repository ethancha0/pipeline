// applypipe in-page helpers. Plain JS, injected as text (context.addInitScript / frame.evaluate)
// so discovery and submit capture share one set of field-key and label rules.
// It only reads the page and listens; it never clicks anything.
(() => {
  if (window.__applypipe) return;

  const SUBMIT_RE = /\b(submit|send application|apply now|finish|complete application)\b/i;
  const NEXT_RE = /^(next|save and continue|continue)$/i;
  const GENERIC_LABEL = /^(attach|upload|browse|choose file|select\.{0,3}|search|toggle flyout)$/i;
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password']);

  const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/\s*\*+\s*$/, '').trim();
  const textOf = (el) => (el ? clean(el.innerText || el.textContent || '') : '');
  const byIds = (ids) =>
    (ids || '')
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean)
      .join(' ');

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function groupOf(el) {
    return el.closest('[role="group"],[role="radiogroup"],fieldset');
  }

  function groupLabel(el) {
    const g = groupOf(el);
    if (!g) return '';
    if (g.getAttribute('aria-labelledby')) return byIds(g.getAttribute('aria-labelledby'));
    if (g.getAttribute('aria-label')) return clean(g.getAttribute('aria-label'));
    const legend = g.querySelector(':scope > legend');
    return textOf(legend);
  }

  /** The question text a person sees for this control. */
  function labelOf(el) {
    const own = el.getAttribute('aria-labelledby');
    if (own) {
      const t = byIds(own);
      if (t && !GENERIC_LABEL.test(t)) return t;
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      const t = textOf(l);
      if (t && !GENERIC_LABEL.test(t)) return t;
    }
    const wrap = el.closest('label');
    if (wrap && textOf(wrap) && !GENERIC_LABEL.test(textOf(wrap))) return textOf(wrap);
    const g = groupLabel(el);
    if (g) return g;
    const aria = clean(el.getAttribute('aria-label'));
    if (aria && !GENERIC_LABEL.test(aria)) return aria;
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
  }

  /** Label of one radio/checkbox option (its own label, not the group question). */
  function optionLabel(el) {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (textOf(l)) return textOf(l);
    }
    const wrap = el.closest('label');
    if (wrap) return textOf(wrap);
    return clean(el.getAttribute('aria-label') || el.value || '');
  }

  function typeOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return 'combobox';
    if (t === 'radio' || t === 'checkbox' || t === 'file' || t === 'date') return t;
    return 'text';
  }

  function isRequired(el, rawLabel) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const g = groupOf(el);
    if (g && g.getAttribute('aria-required') === 'true') return true;
    return /\*\s*$/.test(rawLabel || '');
  }

  function rawLabelText(el) {
    const own = el.getAttribute('aria-labelledby');
    if (own) return (own.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')).trim();
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return (l.textContent || '').trim();
    }
    const g = groupOf(el);
    if (g && g.getAttribute('aria-labelledby')) return byIdsRaw(g.getAttribute('aria-labelledby'));
    return '';
  }
  const byIdsRaw = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();

  const visible = (el) => el.getClientRects().length > 0 || (el.getAttribute('type') || '').toLowerCase() === 'file';

  function candidates(root, exclude) {
    const scope = root ? document.querySelector(root) || document : document;
    return [...scope.querySelectorAll('input, select, textarea')].filter((el) => {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (SKIP_TYPES.has(t) || el.disabled) return false;
      if (exclude && el.matches(exclude)) return false;
      return visible(el);
    });
  }

  function keyOf(el, label) {
    return el.id || el.getAttribute('name') || el.getAttribute('data-automation-id') || 'label:' + hash(label);
  }

  /**
   * Find the form's controls under `root` (a selector; whole document if null).
   * Marks each with data-applypipe-key and returns field descriptors.
   */
  function controls(root, exclude) {
    const out = [];
    const seen = new Map();
    const radioGroups = new Map();
    for (const el of candidates(root, exclude)) {
      const type = typeOf(el);
      if (type === 'radio') {
        const name = el.getAttribute('name') || 'radio:' + hash(groupLabel(el));
        if (!radioGroups.has(name)) radioGroups.set(name, []);
        radioGroups.get(name).push(el);
        continue;
      }
      const label = labelOf(el);
      let key = keyOf(el, label);
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      if (n > 0) key = key + '#' + n;
      el.setAttribute('data-applypipe-key', key);
      const field = { fieldKey: key, label, type, required: isRequired(el, rawLabelText(el)) };
      if (type === 'select') {
        field.options = [...el.options].filter((o) => o.value !== '' && clean(o.text)).map((o) => clean(o.text));
      }
      if (el.maxLength > 0) field.maxLength = el.maxLength;
      if (type === 'checkbox' && !label) field.label = optionLabel(el);
      out.push(field);
    }
    for (const [name, els] of radioGroups) {
      const label = groupLabel(els[0]) || name;
      for (const el of els) el.setAttribute('data-applypipe-key', name);
      out.push({
        fieldKey: name,
        label,
        type: 'radio',
        required: els.some((e) => e.required) || isRequired(els[0], ''),
        options: els.map(optionLabel),
      });
    }
    return out;
  }

  /** Current value as a person would read it. */
  function valueOf(el) {
    const type = typeOf(el);
    if (type === 'checkbox') return el.checked ? 'true' : 'false';
    if (type === 'radio') {
      const name = el.getAttribute('name');
      const checked = name ? document.querySelector('input[type="radio"][name="' + CSS.escape(name) + '"]:checked') : el.checked ? el : null;
      return checked ? optionLabel(checked) : '';
    }
    if (type === 'file') return [...(el.files || [])].map((f) => f.name).join(', ');
    if (type === 'select') return el.selectedIndex >= 0 && el.options[el.selectedIndex].value !== '' ? clean(el.options[el.selectedIndex].text) : '';
    if (type === 'combobox') {
      const control = el.closest('[class*="control"]') || el.parentElement;
      const single = control && control.querySelector('[class*="single-value"]');
      if (single) return clean(single.textContent);
      const multi = control ? [...control.querySelectorAll('[class*="multi-value__label"]')].map((m) => clean(m.textContent)) : [];
      if (multi.length) return multi.join(', ');
      return el.value || '';
    }
    return el.value || '';
  }

  /** Every visible control's current value, keyed like `controls()`. */
  function serialize() {
    const out = [];
    const seenRadio = new Set();
    for (const el of candidates(null, '[aria-hidden="true"], .iti__search-input')) {
      const type = typeOf(el);
      const label = type === 'radio' ? groupLabel(el) : labelOf(el);
      const key =
        el.getAttribute('data-applypipe-key') ||
        (type === 'radio' ? el.getAttribute('name') || 'radio:' + hash(label) : keyOf(el, label));
      if (type === 'radio') {
        if (seenRadio.has(key)) continue;
        seenRadio.add(key);
      }
      out.push({ fieldKey: key, label, type, value: valueOf(el) });
    }
    return out;
  }

  function accessibleName(el) {
    return clean(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '');
  }

  function clickKind(target) {
    const el = target && target.closest && target.closest('button, input[type="submit"], input[type="button"], a, [role="button"]');
    if (!el) return null;
    const name = accessibleName(el);
    const type = (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
    if (SUBMIT_RE.test(name) || (type === 'submit' && /^apply$/i.test(name))) return 'submit';
    if (NEXT_RE.test(name)) return 'next';
    return null;
  }

  let lastSent = 0;
  function send(kind) {
    if (typeof window.__applypipeCapture !== 'function') return;
    const now = Date.now();
    if (kind === 'submit' && now - lastSent < 1000) return; // click + form submit for the same press
    if (kind === 'submit') lastSent = now;
    try {
      window.__applypipeCapture({ kind, url: location.href, fields: serialize() });
    } catch (e) {
      // capture must never break the page
    }
  }

  document.addEventListener('click', (e) => {
    const kind = clickKind(e.target);
    if (kind) send(kind);
  }, true);
  document.addEventListener('submit', () => send('submit'), true);

  window.__applypipe = { controls, serialize, valueOf, labelOf, optionLabel, accessibleName };
})();
