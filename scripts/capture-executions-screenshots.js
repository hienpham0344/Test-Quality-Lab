const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/screenshots/executions');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('Starting mock backend on port 8000...');
  const mockProcess = spawn('node', ['mock-backend.js'], {
    cwd: path.resolve(__dirname, '../frontend'),
    stdio: 'pipe',
    shell: true,
  });

  // Wait for mock backend to be ready
  let mockReady = false;
  for (let i = 0; i < 20; i++) {
    try {
      const resp = await fetch('http://127.0.0.1:8000/health');
      if (resp.ok) {
        mockReady = true;
        break;
      }
    } catch { }
    await delay(300);
  }

  if (!mockReady) {
    console.error('Mock backend failed to start');
    mockProcess.kill();
    process.exit(1);
  }
  console.log('Mock backend is ready.');

  console.log('Starting Vite server on port 5173...');
  const viteProcess = spawn('npm.cmd', ['run', 'dev', '--', '--port', '5173', '--host', '127.0.0.1'], {
    cwd: path.resolve(__dirname, '../frontend'),
    stdio: 'pipe',
    shell: true,
  });

  let viteReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch('http://127.0.0.1:5173');
      if (resp.ok) {
        viteReady = true;
        break;
      }
    } catch { }
    await delay(500);
  }

  if (!viteReady) {
    console.error('Vite failed to start');
    cleanup([mockProcess, viteProcess]);
    process.exit(1);
  }
  console.log('Vite is ready.');

  const tmpProfile = path.resolve(__dirname, '../.tmp_chrome_profile_exec');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9222',
      `--user-data-dir=${tmpProfile}`,
      '--window-size=1280,900',
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
    cleanup([mockProcess, viteProcess, chromeProcess]);
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
    await delay(1200);
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(SCREENSHOT_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    console.log(`Saved screenshot: ${filePath} (${fs.statSync(filePath).size} bytes)`);
  }

  try {
    // 1. Sign in
    console.log('Navigating to login...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/login' });
    await delay(2000);

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

    // 2. Navigate to Executions tab
    console.log('Navigating to Executions tab...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/projects/demo-project?tab=executions' });
    await delay(2500);

    // 3. Capture 01-execution-status-overview.png
    console.log('Capturing 01-execution-status-overview.png...');
    await takeScreenshot('01-execution-status-overview.png');

    // 4. Open Cancel Execution Modal on running run
    console.log('Opening Cancel Execution Modal...');
    await evaluate(`
      const cancelBtn = document.querySelector('[data-testid="cancel-run-btn-exec-run-101"]');
      if (cancelBtn) cancelBtn.click();
    `);
    await delay(1000);

    console.log('Capturing 02-cancel-execution-modal.png...');
    await takeScreenshot('02-cancel-execution-modal.png');

    // Close cancel modal
    await evaluate(`
      const closeBtn = document.querySelector('[aria-label="Close dialog"]');
      if (closeBtn) closeBtn.click();
    `);
    await delay(800);

    // 5. Open Inspection / Detail Modal on running run
    console.log('Opening Inspection / Logs Modal...');
    await evaluate(`
      const inspectBtn = document.querySelector('[data-testid="inspect-run-btn-exec-run-101"]');
      if (inspectBtn) inspectBtn.click();
    `);
    await delay(1000);

    console.log('Capturing 03-execution-detail-and-logs.png...');
    await takeScreenshot('03-execution-detail-and-logs.png');

    console.log('Screenshots completed successfully!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    ws.close();
    cleanup([mockProcess, viteProcess, chromeProcess]);
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch { }
    process.exit(0);
  }
}

function cleanup(processes) {
  for (const p of processes) {
    if (p) {
      try {
        process.kill(p.pid);
      } catch { }
    }
  }
}

run();
