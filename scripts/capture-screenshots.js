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
  {
    id: 'p-2',
    name: 'FastAPI Microservice Quality Suite',
    description: 'Automated test quality and mutation analysis for REST API endpoints.',
    current_revision: 1,
    created_at: '2026-11-03T14:20:00Z',
    updated_at: '2026-11-03T14:20:00Z',
  },
  {
    id: 'p-3',
    name: 'Evaluation Sandbox Regression Lab',
    description: 'Tests closed-box execution security and isolation under failure conditions.',
    current_revision: 2,
    created_at: '2026-11-04T09:15:00Z',
    updated_at: '2026-11-06T11:30:00Z',
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
  } else if (url.startsWith('/api/v1/projects/') && url.endsWith('/history')) {
    res.writeHead(200);
    res.end(JSON.stringify(mockHistory));
  } else if (url.startsWith('/api/v1/projects/')) {
    res.writeHead(200);
    res.end(JSON.stringify(mockProjects[0]));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ detail: 'Not found' }));
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

  // Wait for Vite to be ready
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

  // Start Chrome with remote debugging
  const tmpProfile = path.resolve(__dirname, '../.tmp_chrome_profile');
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
    await delay(1000);
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(SCREENSHOT_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    console.log(`Saved screenshot: ${filePath} (${fs.statSync(filePath).size} bytes)`);
  }

  try {
    // 1. Navigate to login
    console.log('Navigating to login...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/login' });
    await delay(2000);

    // 2. Perform sign in
    console.log('Signing in...');
    await evaluate(`
      const emailInput = document.querySelector('#email');
      const passwordInput = document.querySelector('#password');
      if (emailInput && passwordInput) {
        emailInput.value = 'user@testlab.dev';
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.value = 'Password123456!';
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    `);
    await delay(2000);

    // 3. Projects Dashboard screenshot
    console.log('Capturing Projects Dashboard...');
    await takeScreenshot('dashboard.png');

    // 4. Open Create Project Modal
    console.log('Opening Create Project Modal...');
    await evaluate(`
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('New project'));
      if (btn) btn.click();
    `);
    await delay(800);
    await evaluate(`
      const nameInput = document.querySelector('#project-create-name');
      const descInput = document.querySelector('#project-create-description');
      if (nameInput) {
        nameInput.value = 'New Test Evaluation Matrix';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (descInput) {
        descInput.value = 'Comparative benchmark testing prompt variation levels across models.';
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
    await delay(600);
    console.log('Capturing Create Project Modal...');
    await takeScreenshot('create-project-modal.png');

    // Close modal
    await evaluate(`
      const closeBtn = document.querySelector('[aria-label="Close dialog"]');
      if (closeBtn) closeBtn.click();
    `);
    await delay(500);

    // 5. Navigate to Project Editor
    console.log('Navigating to Project Editor...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/projects/p-1' });
    await delay(2000);
    console.log('Capturing Project Editor & History...');
    await takeScreenshot('project-editor.png');

    // 6. Empty state screenshot
    console.log('Switching to empty projects state...');
    mockProjects = [];
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/projects' });
    await delay(2000);
    console.log('Capturing Empty State...');
    await takeScreenshot('empty-state.png');

    console.log('All screenshots captured successfully!');
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
