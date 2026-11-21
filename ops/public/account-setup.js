/**
 * Account setup page: keys on the left, the how-to on the right.
 */
let fields = [];
let activeId = '';
let sourceCheckout = true;

function el(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

function fieldById(id) {
  return fields.find((field) => field.id === id) || null;
}

function renderGuide(field) {
  const guide = document.getElementById('account-setup-guide');
  if (!guide) return;
  if (!field) {
    guide.innerHTML = '<p class="muted">Choose <strong>How to get this key</strong> and the steps stay here while you paste.</p>';
    return;
  }
  const steps = (field.guide?.steps || [])
    .map((step, index) => {
      const link = step.href
        ? ` <a href="${step.href}" target="_blank" rel="noopener">${step.label || 'Open'}</a>`
        : '';
      return `<li><span>${step.text}</span>${link}</li>`;
    })
    .join('');
  guide.innerHTML = `<h3>${field.guide?.title || field.label}</h3><ol class="account-setup-steps">${steps}</ol>`;
  document.querySelectorAll('.account-setup-row').forEach((row) => {
    row.classList.toggle('is-active', row.getAttribute('data-field') === field.id);
  });
}

function inputFor(field) {
  if (field.secret) {
    const hint = field.set
      ? field.last4
        ? `Saved · ends in ${field.last4}`
        : 'Saved'
      : '';
    return `<input type="password" autocomplete="off" data-input="${field.id}" placeholder="${hint}" />`;
  }
  if (field.kind === 'path') {
    return `<span class="account-setup-path"><input type="text" data-input="${field.id}" value="${escapeAttr(field.value || '')}" placeholder="D:\\Rover Sites" /><button type="button" class="btn" data-browse>Browse</button></span>`;
  }
  const type = field.kind === 'email' ? 'email' : 'text';
  return `<input type="${type}" data-input="${field.id}" value="${escapeAttr(field.value || '')}" />`;
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function renderCount() {
  const count = document.getElementById('account-setup-count');
  if (!count) return;
  const total = fields.length;
  const set = fields.filter((field) => field.set).length;
  const full = total > 0 && set === total;
  count.innerHTML = total ? `<strong>${set} of ${total}</strong> set up` : '';
  count.classList.toggle('is-full', full);
  count.classList.toggle('is-short', total > 0 && !full);
}

function renderRows() {
  renderCount();
  const host = document.getElementById('account-setup-rows');
  if (!host) return;
  let group = '';
  let section = null;
  host.replaceChildren();
  for (const field of fields) {
    if (field.group !== group) {
      group = field.group;
      section = el(`<section class="account-setup-section"><h3 class="account-setup-group">${group}</h3></section>`);
      host.append(section);
    }
    const mark = field.set ? 'Saved' : field.optional ? 'Optional' : 'Missing';
    const markClass = field.set ? 'is-set' : field.optional ? 'is-optional' : 'is-missing';
    const row = el(`<div class="account-setup-row" data-field="${field.id}">
      <div class="account-setup-row-head">
        <label for="acct-${field.id}">${field.label}</label>
        <span class="account-setup-mark ${markClass}">${mark}</span>
        <button type="button" class="btn btn-sm" data-how="${field.id}">${field.button}</button>
      </div>
      ${inputFor(field)}
    </div>`);
    const input = row.querySelector('input');
    if (input) input.id = `acct-${field.id}`;
    section.append(row);
  }
}

function collectUpdates() {
  const updates = {};
  for (const field of fields) {
    const input = document.querySelector(`[data-input="${field.id}"]`);
    if (!input) continue;
    const value = input.value.trim();
    if (field.secret) {
      if (!value) continue;
      updates[field.id] = value;
      continue;
    }
    updates[field.id] = value;
  }
  return updates;
}

async function loadSetup() {
  const res = await fetch('/api/account-setup');
  const data = await res.json();
  fields = data.fields || [];
  sourceCheckout = Boolean(data.sourceCheckout);
  renderRows();
  const sessionRes = await fetch('/api/account/session');
  const session = await sessionRes.json().catch(() => ({}));
  renderSession(session);
  if (!sourceCheckout && !fieldById('sitesFolder')?.set) openAccountSetup('sitesFolder');
}

function renderSession(session) {
  const host = document.getElementById('account-setup-session');
  if (!host) return;
  if (!session?.configured) {
    host.innerHTML = sourceCheckout
      ? '<p class="muted">This checkout is not asked to sign in or pay. Weekly plans apply to a customer install.</p>'
      : '<p class="muted">The account service is not configured on this install yet.</p>';
    return;
  }
  if (!session.signedIn) {
    host.innerHTML = `<form id="account-auth-form" class="account-auth-form">
      <h3>Sign in</h3>
      <label>Email <input name="email" type="email" required autocomplete="username"></label>
      <label>Password <input name="password" type="password" required minlength="8" autocomplete="current-password"></label>
      <span class="account-auth-actions">
        <button class="btn primary" type="submit" data-auth="login">Sign in</button>
        <button class="btn" type="submit" data-auth="signup">Create account</button>
        <button class="btn" type="button" data-auth="forgot">Forgot password</button>
      </span>
      <p id="account-auth-note" class="muted"></p>
    </form>`;
    return;
  }
  const plan = session.role === 'admin' ? 'Admin' : session.plan === 'full' ? 'Full' : session.plan === 'maintain' ? 'Maintain' : 'No week yet';
  const until = session.paidThrough ? ` through ${session.paidThrough.slice(0, 10)}` : '';
  host.innerHTML = `<p><strong>${session.email}</strong> · ${plan}${session.role === 'admin' ? '' : until}</p>
    <span class="account-auth-actions">
      <button class="btn primary" type="button" data-plan="full">Full week</button>
      <button class="btn" type="button" data-plan="maintain">Maintain week</button>
      <button class="btn" type="button" data-plan="portal">Card and cancel</button>
      <button class="btn" type="button" data-auth="logout">Sign out</button>
    </span>`;
}

export function openAccountSetup(fieldId = '') {
  const root = document.getElementById('account-setup');
  if (!root) return;
  root.hidden = false;
  root.classList.remove('hidden');
  const field = fieldById(fieldId) || fieldById(activeId);
  activeId = field?.id || '';
  renderGuide(field);
  if (field) {
    document.getElementById(`acct-${field.id}`)?.focus();
    document.querySelector(`[data-field="${field.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

export function showMissingKey(error) {
  const field = error?.field || '';
  const note = document.getElementById('account-setup-banner');
  const message = error?.message || 'A key is missing.';
  if (note) {
    note.hidden = false;
    note.innerHTML = `${message} <button type="button" class="btn btn-sm" data-open-account="${field}">Open Account setup</button>`;
  }
  openAccountSetup(field);
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function note(text) {
  const node = document.getElementById('account-auth-note');
  if (node) node.textContent = text;
}

export function installAccountSetup() {
  if (document.getElementById('account-setup')) return;
  const root = el(`<div id="account-setup" class="account-setup hidden" hidden>
    <div class="account-setup-card" role="dialog" aria-labelledby="account-setup-title">
      <header class="account-setup-head">
        <div class="account-setup-title-block">
          <h2 id="account-setup-title">Account setup</h2>
          <p id="account-setup-count" class="account-setup-count"></p>
        </div>
        <button type="button" class="btn" data-close>Close</button>
      </header>
      <p id="account-setup-banner" class="account-setup-banner" hidden></p>
      <div id="account-setup-session"></div>
      <div class="account-setup-split">
        <form id="account-setup-form" class="account-setup-form">
          <div id="account-setup-rows" class="account-setup-rows"></div>
          <div class="account-setup-save">
            <button class="btn primary" type="submit">Save</button>
            <p id="account-setup-status" class="muted"></p>
          </div>
        </form>
        <aside id="account-setup-guide" class="account-setup-guide"></aside>
      </div>
    </div>
  </div>`);
  document.body.append(root);
  document.getElementById('settings-open-account')?.addEventListener('click', () => openAccountSetup());
  root.addEventListener('click', async (event) => {
    const how = event.target.closest('[data-how]');
    if (how) {
      activeId = how.getAttribute('data-how');
      renderGuide(fieldById(activeId));
      return;
    }
    if (event.target.closest('[data-browse]')) {
      event.preventDefault();
      const result = await post('/api/account-setup/browse', {});
      if (result.folder) {
        const input = document.querySelector('[data-input="sitesFolder"]');
        if (input) input.value = result.folder;
      }
      return;
    }
    if (event.target.closest('[data-close]')) {
      root.hidden = true;
      root.classList.add('hidden');
    }
  });
  document.getElementById('account-setup-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('account-setup-status');
    try {
      const data = await post('/api/account-setup', { fields: collectUpdates() });
      fields = data.fields || fields;
      renderRows();
      renderGuide(fieldById(activeId));
      if (status) {
        status.textContent = data.restartRequired
          ? 'Saved. Restart Rover so the new sites folder is used for dashboard files.'
          : 'Saved.';
      }
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  });
  root.addEventListener('click', async (event) => {
    const auth = event.target.closest('[data-auth]');
    const plan = event.target.closest('[data-plan]');
    if (!auth && !plan) return;
    event.preventDefault();
    const form = document.getElementById('account-auth-form');
    const email = form?.email?.value || '';
    const password = form?.password?.value || '';
    try {
      if (auth?.getAttribute('data-auth') === 'signup') {
        const data = await post('/api/account/signup', { email, password });
        note(data.devLink ? `Confirm using ${data.devLink}` : 'Check your email to confirm the account, then sign in.');
        return;
      }
      if (auth?.getAttribute('data-auth') === 'login') {
        await post('/api/account/login', { email, password });
        const session = await (await fetch('/api/account/session')).json();
        renderSession(session);
        return;
      }
      if (auth?.getAttribute('data-auth') === 'forgot') {
        const data = await post('/api/account/forgot', { email });
        note(data.devLink ? `Reset using ${data.devLink}` : 'If that email has an account, a reset link is on its way.');
        return;
      }
      if (auth?.getAttribute('data-auth') === 'logout') {
        const session = await post('/api/account/logout', {});
        renderSession(session);
        return;
      }
      if (plan) {
        const which = plan.getAttribute('data-plan');
        const data = await post(which === 'portal' ? '/api/account/portal' : '/api/account/checkout', {
          plan: which,
        });
        if (data.url) window.open(data.url, '_blank', 'noopener');
      }
    } catch (error) {
      note(error.message);
    }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-account]');
    if (!button || root.contains(button)) return;
    openAccountSetup(button.getAttribute('data-open-account') || '');
  });
  void loadSetup();
}
