/**
 * Local routes for Account setup and the hosted account service.
 * The browser talks only to this process. The account token stays on disk.
 */
import { spawn } from 'node:child_process';
import {
  accountSetupView,
  ensureMachineId,
  localAccountToken,
  readProfile,
  saveAccountSession,
  saveAccountSetup,
} from './profile.mjs';
import { isSourceCheckout } from './source-checkout.mjs';

function accountBase() {
  return String(process.env.ROVER_ACCOUNT_URL || '').replace(/\/$/, '');
}

async function accountFetch(path, { method = 'GET', token = '', body } = {}) {
  const base = accountBase();
  if (!base) {
    const error = new Error('Account service is not configured yet.');
    error.status = 503;
    error.code = 'account_unconfigured';
    throw error;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Account service returned ${res.status}`);
    error.status = res.status;
    if (data.code) error.code = data.code;
    throw error;
  }
  return data;
}

function sessionView() {
  const profile = readProfile();
  const entitlement = profile.entitlement;
  return {
    ok: true,
    configured: Boolean(accountBase()),
    sourceCheckout: isSourceCheckout(),
    email: profile.accountEmail || '',
    signedIn: Boolean(localAccountToken()),
    role: entitlement?.role || null,
    plan: entitlement?.plan || null,
    paidThrough: entitlement?.paidThrough || null,
    emailConfirmed: entitlement?.emailConfirmed !== false,
  };
}

function browseFolder() {
  return new Promise((resolve) => {
    const command =
      process.platform === 'win32'
        ? {
            cmd: 'powershell.exe',
            args: [
              '-NoProfile',
              '-STA',
              '-Command',
              "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose the Rover sites folder'; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
            ],
          }
        : process.platform === 'darwin'
          ? {
              cmd: 'osascript',
              args: ['-e', 'POSIX path of (choose folder with prompt "Choose the Rover sites folder")'],
            }
          : null;
    if (!command) {
      resolve({ ok: false, error: 'Paste the folder path on this system.' });
      return;
    }
    const child = spawn(command.cmd, command.args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
    }, 120000);
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', () => {
      clearTimeout(timer);
      const folder = stdout.trim().replace(/\/$/, '');
      if (!folder) {
        resolve({ ok: false, cancelled: true, error: stderr.trim() || 'No folder selected.' });
        return;
      }
      resolve({ ok: true, folder });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
  });
}

export function registerAccountRoutes(app, sendError) {
  app.get('/api/account-setup', (_req, res) => {
    res.json(accountSetupView());
  });

  app.post('/api/account-setup', (req, res) => {
    try {
      const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
      res.json(saveAccountSetup(fields));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/account-setup/browse', async (_req, res) => {
    res.json(await browseFolder());
  });

  app.get('/api/account/session', async (_req, res) => {
    const token = localAccountToken();
    if (token && accountBase()) {
      try {
        const data = await accountFetch('/me', { token });
        saveAccountSession({
          email: data.user?.email,
          entitlement: data.user,
        });
      } catch {
        /* keep the last saved session if the service is briefly down */
      }
    }
    res.json(sessionView());
  });

  app.post('/api/account/signup', async (req, res) => {
    try {
      const data = await accountFetch('/signup', {
        method: 'POST',
        body: { email: req.body?.email, password: req.body?.password },
      });
      res.status(201).json({
        ok: true,
        email: data.email,
        confirmRequired: true,
        devLink: data.devLink || undefined,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/account/login', async (req, res) => {
    try {
      const data = await accountFetch('/login', {
        method: 'POST',
        body: {
          email: req.body?.email,
          password: req.body?.password,
          machineId: ensureMachineId(),
          takeover: req.body?.takeover === true,
        },
      });
      saveAccountSession({
        email: data.user?.email,
        token: data.token,
        entitlement: data.user,
      });
      res.json(sessionView());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/account/logout', async (_req, res) => {
    const token = localAccountToken();
    if (token && accountBase()) {
      try {
        await accountFetch('/logout', { method: 'POST', token });
      } catch {
        /* local sign-out still clears the token */
      }
    }
    saveAccountSession({ email: readProfile().accountEmail, token: null, entitlement: null });
    res.json(sessionView());
  });

  app.post('/api/account/forgot', async (req, res) => {
    try {
      const data = await accountFetch('/forgot', {
        method: 'POST',
        body: { email: req.body?.email },
      });
      res.json({ ok: true, devLink: data.devLink || undefined });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/account/checkout', async (req, res) => {
    try {
      const data = await accountFetch('/billing/checkout', {
        method: 'POST',
        token: localAccountToken(),
        body: { plan: req.body?.plan },
      });
      res.json({ ok: true, url: data.url });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/account/portal', async (_req, res) => {
    try {
      const data = await accountFetch('/billing/portal', {
        method: 'POST',
        token: localAccountToken(),
      });
      res.json({ ok: true, url: data.url });
    } catch (error) {
      sendError(res, error);
    }
  });
}
