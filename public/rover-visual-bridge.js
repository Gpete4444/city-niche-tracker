/**
 * Inert until Rover (127.0.0.1:8787) iframes this assembled preview and posts activate.
 * Renters / public visitors never see outlines or intercept clicks.
 */
(function () {
  var ALLOW = { 'http://127.0.0.1:8787': 1, 'http://localhost:8787': 1 };
  if (window.parent === window) return;

  var parentOrigin = '';
  var active = false;
  var selectedEl = null;

  function parse(el) {
    try {
      return JSON.parse(el.getAttribute('data-edit') || '');
    } catch (e) {
      return null;
    }
  }

  function send(payload) {
    if (!parentOrigin || !ALLOW[parentOrigin]) return;
    window.parent.postMessage(payload, parentOrigin);
  }

  function setSelected(el) {
    if (selectedEl) selectedEl.classList.remove('rover-ve-on');
    selectedEl = el || null;
    if (selectedEl) selectedEl.classList.add('rover-ve-on');
  }

  window.addEventListener('message', function (ev) {
    if (!ALLOW[ev.origin]) return;
    var msg = ev.data;
    if (!msg || msg.type !== 'rover-ve') return;
    parentOrigin = ev.origin;
    if (msg.action === 'activate') {
      active = true;
      document.documentElement.classList.add('rover-ve');
      send({ type: 'rover-ve', action: 'ready', href: location.pathname + location.search });
    }
    if (msg.action === 'highlight') {
      var hit = null;
      document.querySelectorAll('[data-edit]').forEach(function (node) {
        if (hit) return;
        var b = parse(node);
        if (b && JSON.stringify(b) === JSON.stringify(msg.binding)) hit = node;
      });
      setSelected(hit);
      if (hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (msg.action === 'setText' && selectedEl && typeof msg.text === 'string') {
      selectedEl.textContent = msg.text;
    }
    if (msg.action === 'applyTheme') {
      var root = document.documentElement;
      if (msg.primary) root.style.setProperty('--brand-primary', msg.primary);
      if (msg.accent) root.style.setProperty('--brand-accent', msg.accent);
      if (msg.ink) root.style.setProperty('--brand-ink', msg.ink);
      if (msg.fontDisplay) root.style.setProperty('--font-display', msg.fontDisplay);
      if (msg.fontBody) root.style.setProperty('--font-body', msg.fontBody);
      if (msg.googleHref) {
        var link = document.getElementById('rover-site-fonts');
        if (!link) {
          link = document.createElement('link');
          link.id = 'rover-site-fonts';
          link.rel = 'stylesheet';
          document.head.appendChild(link);
        }
        link.href = msg.googleHref;
      }
    }
    if (msg.action === 'clear') setSelected(null);
  });

  document.addEventListener(
    'click',
    function (ev) {
      if (!active) return;
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-edit]') : null;
      if (!el) return;
      ev.preventDefault();
      ev.stopPropagation();
      var binding = parse(el);
      if (!binding) return;
      setSelected(el);
      send({
        type: 'rover-ve',
        action: 'select',
        binding: binding,
        href: location.pathname,
        tag: (el.tagName || '').toLowerCase(),
        currentText: (el.innerText || '').trim().slice(0, 2000),
        currentAlt: el.getAttribute('alt') || '',
        currentSrc: el.getAttribute('src') || '',
      });
    },
    true,
  );

  var style = document.createElement('style');
  style.textContent =
    'html.rover-ve [data-edit]{outline:2px dashed rgba(232,163,23,.65);outline-offset:3px;cursor:pointer;}' +
    'html.rover-ve [data-edit].rover-ve-on{outline:3px solid #e8a317;outline-offset:3px;}' +
    'html.rover-ve [data-section]{position:relative;}';
  document.head.appendChild(style);

  try {
    window.parent.postMessage(
      { type: 'rover-ve', action: 'hello', href: location.pathname },
      '*',
    );
  } catch (e) {
    /* ignore */
  }
})();
