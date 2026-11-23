const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MOCK_PORT = 8000;
const VITE_PORT = 5173;
const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/screenshots/projects');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

let mockProjects = [
  {
    id: 'p-1',
    name: 'LLM Python Test Evaluator',
    description: 'Suite for evaluating prompt variation levels L1 through L5 on standard Python test cases.',
    current_revision: 3,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-08T16:45:00Z',
  },
];

const mockHistory = [
  {
    revision: 1,
    name: 'LLM Python Test Evaluator (Draft)',
    description: 'Initial project setup with basic test configuration.',
    changed_at: '2026-11-01T10:00:00Z',
  },
  {
    revision: 2,
    name: 'LLM Python Test Evaluator',
    description: 'Updated scope to include prompt levels L1 through L3.',
    changed_at: '2026-11-05T12:30:00Z',
  },
  {
    revision: 3,
    name: 'LLM Python Test Evaluator',
    description: 'Suite for evaluating prompt variation levels L1 through L5 on standard Python test cases.',
    changed_at: '2026-11-08T16:45:00Z',
  },
];

// Start mock server
const mockServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url;
  res.setHeader('Content-Type', 'application/json');

  if (url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (url === '/api/v1/auth/login') {
    res.writeHead(200);
    res.end(JSON.stringify({ access_token: 'mock-access-token', refresh_token: 'mock-refresh-token' }));
  } else if (url === '/api/v1/projects') {
    res.writeHead(200);
    res.end(JSON.stringify(mockProjects));
  } else if (url === '/api/v1/projects/p-1/history') {
    res.writeHead(200);
    res.end(JSON.stringify(mockHistory));
  } else if (url === '/api/v1/projects/p-1') {
    res.writeHead(200);
    res.end(JSON.stringify(mockProjects[0]));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ detail: 'Project not found' }));
  }
});

mockServer.listen(MOCK_PORT, () => {
  console.log(`Mock API listening on http://localhost:${MOCK_PORT}`);
  startViteAndCapture();
});

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startViteAndCapture() {
  const frontendDir = path.resolve(__dirname, '../frontend');
  const viteProcess = spawn('npm.cmd', ['run', 'dev', '--', '--port', '5173', '--host', '127.0.0.1'], {
    cwd: frontendDir,
    stdio: 'pipe',
    shell: true,
  });

  viteProcess.stdout.on('data', (d) => process.stdout.write('[Vite] ' + d));
  viteProcess.stderr.on('data', (d) => process.stderr.write('[Vite err] ' + d));

  console.log('Waiting for Vite server...');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch('http://127.0.0.1:5173');
      if (resp.ok) {
        ready = true;
        break;
      }
    } catch { }
    await delay(500);
  }

  if (!ready) {
    console.error('Vite failed to start');
    cleanup(viteProcess);
    process.exit(1);
  }
  console.log('Vite is ready on http://127.0.0.1:5173');

  const tmpProfile = path.resolve(__dirname, '../.tmp_chrome_profile_prj90');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9222',
      `--user-data-dir=${tmpProfile}`,
      '--window-size=1280,850',
      'http://127.0.0.1:5173',
    ],
    { stdio: 'ignore' }
  );

  console.log('Waiting for Chrome CDP...');
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch('http://127.0.0.1:9222/json');
      const targets = await resp.json();
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch { }
    await delay(500);
  }

  if (!wsUrl) {
    console.error('Chrome CDP not reachable');
    cleanup(viteProcess, chromeProcess);
    process.exit(1);
  }
  console.log('Connected to CDP at:', wsUrl);

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise((r) => ws.onopen = r);

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evaluate(code) {
    return send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
  }

  async function takeScreenshot(fileName) {
    await delay(800);
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(SCREENSHOT_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    console.log(`Saved screenshot: ${filePath} (${fs.statSync(filePath).size} bytes)`);
  }

  try {
    // 1. Sign in
    console.log('Navigating to login...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/login' });
    await delay(2500);

    console.log('Signing in with prototype setters...');
    await evaluate(`(() => {
      const setVal = (el, val) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        ).set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(document.querySelector('input[name="email"]'), 'user@testlab.dev');
      setVal(document.querySelector('input[name="password"]'), 'Password123456!');
      const btn = document.querySelector('button[type="submit"]') || [...document.querySelectorAll('button')].find(b => b.textContent.includes('Sign in'));
      if (btn) btn.click();
    })()`);
    await delay(2500);

    console.log('Navigating client-side to /projects/p-1...');
    await evaluate(`(() => {
      window.history.pushState({}, '', '/projects/p-1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    await delay(2000);

    // 2. Project Detail Overview
    console.log('Capturing project-detail-overview.png...');
    await takeScreenshot('project-detail-overview.png');

    // 3. History (F5) tab
    console.log('Switching to History (F5) tab...');
    await evaluate(`(() => {
      const histTab = [...document.querySelectorAll('button')].find(b => b.textContent.includes('History (F5)'));
      if (histTab) histTab.click();
    })()`);
    await delay(1200);
    console.log('Capturing project-detail-history-tab.png...');
    await takeScreenshot('project-detail-history-tab.png');

    // 4. Experiments (F6) tab
    console.log('Switching to Experiments (F6) tab...');
    await evaluate(`(() => {
      const expTab = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Experiments (F6)'));
      if (expTab) expTab.click();
    })()`);
    await delay(1200);
    console.log('Capturing project-detail-experiments-tab.png...');
    await takeScreenshot('project-detail-experiments-tab.png');

    // 5. Back to Overview tab for Edit mode
    console.log('Switching back to Overview tab...');
    await evaluate(`(() => {
      const ovTab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Overview');
      if (ovTab) ovTab.click();
    })()`);
    await delay(1000);

    // Edit mode with changes (Save enabled)
    console.log('Editing name and description using prototype setters...');
    await evaluate(`(() => {
      const setVal = (el, val) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        ).set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(document.querySelector('#edit-project-name'), 'LLM Python Test Evaluator - Production Edition');
      setVal(document.querySelector('#edit-project-description'), 'Comprehensive evaluation suite testing models across L1 to L5 prompt variants with immutable revision history.');
    })()`);
    await delay(1000);
    console.log('Capturing project-detail-edit-active.png...');
    await takeScreenshot('project-detail-edit-active.png');

    // 6. Trigger Unsaved Changes warning guard
    console.log('Triggering unsaved changes guard modal via History tab click...');
    await evaluate(`(() => {
      const histTab = [...document.querySelectorAll('button')].find(b => b.textContent.includes('History (F5)'));
      if (histTab) histTab.click();
    })()`);
    await delay(1000);
    console.log('Capturing project-detail-unsaved-warning.png...');
    await takeScreenshot('project-detail-unsaved-warning.png');

    // Discard unsaved changes modal
    console.log('Discarding unsaved changes to restore clean state...');
    await evaluate(`(() => {
      const discardBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Discard changes'));
      if (discardBtn) discardBtn.click();
    })()`);
    await delay(1000);

    // 7. 404 Project Not Found page
    console.log('Navigating client-side to missing project /projects/p-999 (404)...');
    await evaluate(`(() => {
      window.history.pushState({}, '', '/projects/p-999');
      window.dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    await delay(2000);
    console.log('Capturing project-detail-404-not-found.png...');
    await takeScreenshot('project-detail-404-not-found.png');

    console.log('All project detail screenshots captured successfully!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    ws.close();
    cleanup(viteProcess, chromeProcess);
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch { }
    mockServer.close(() => {
      console.log('Mock server stopped. Done!');
      process.exit(0);
    });
  }
}

function cleanup(viteProcess, chromeProcess) {
  if (viteProcess) {
    try {
      process.kill(viteProcess.pid);
    } catch { }
  }
  if (chromeProcess) {
    try {
      process.kill(chromeProcess.pid);
    } catch { }
  }
}
