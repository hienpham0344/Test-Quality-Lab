const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/screenshots/experiments');

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
    shell: true,
  });

  await delay(1000);

  console.log('Starting Vite server on port 5173...');
  const viteProcess = spawn('npm.cmd', ['run', 'dev', '--', '--port', '5173', '--host', '127.0.0.1'], {
    cwd: path.resolve(__dirname, '../frontend'),
    shell: true,
  });

  await delay(2500);

  const tmpProfile = path.resolve(__dirname, '../.tmp_chrome_profile_experiments');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9222',
      `--user-data-dir=${tmpProfile}`,
      '--window-size=1280,950',
      'http://127.0.0.1:5173/login',
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
    } catch {}
    await delay(500);
  }

  if (!wsUrl) {
    console.error('Could not connect to Chrome CDP.');
    cleanup();
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  console.log('Connected to Chrome WebSocket CDP.');

  let id = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const { resolve, reject } = callbacks.get(data.id);
      callbacks.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const currentId = id++;
      callbacks.set(currentId, { resolve, reject });
      ws.send(JSON.stringify({ id: currentId, method, params }));
    });
  }

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return res && res.result ? res.result.value : null;
  }

  async function takeScreenshot(filename) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const fullPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(data, 'base64'));
    console.log(`Saved screenshot: ${filename}`);
  }

  function cleanup() {
    try { chromeProcess.kill(); } catch {}
    try { viteProcess.kill(); } catch {}
    try { mockProcess.kill(); } catch {}
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Navigating to login page...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/login' });
    await delay(2000);

    // Auto login
    await evalJs(`
      const emailInput = document.querySelector('input[type="email"]');
      const passInput = document.querySelector('input[type="password"]');
      if (emailInput && passInput) {
        emailInput.value = 'test@example.com';
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.value = 'Password123!';
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        const form = document.querySelector('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    `);
    await delay(2000);

    // Navigate to Experiment Setup Wizard for demo-project
    console.log('Navigating to Experiment Wizard...');
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/projects/demo-project/experiments/new' });
    await delay(2000);

    // Step 0: Select source and functions
    console.log('Selecting source and functions...');
    await evalJs(`
      const select = document.querySelector('#experiment-source');
      if (select) {
        select.value = 'src-sample-1';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await delay(1000);

    // Select all functions
    await evalJs(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Select all functions'));
      if (btn) btn.click();
    `);
    await delay(600);

    // Advance to Step 1
    await evalJs(`
      const continueBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
      if (continueBtn) continueBtn.click();
    `);
    await delay(1000);

    // Step 1: Configure models, strategies, repeats
    console.log('Configuring models, strategies, and repeats...');
    await evalJs(`
      const modelsTextarea = document.querySelector('#experiment-models');
      if (modelsTextarea) {
        modelsTextarea.value = 'gpt-4o\\nclaude-3-5-sonnet\\ngemini-1.5-pro';
        modelsTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const repeatsInput = document.querySelector('#experiment-repeats');
      if (repeatsInput) {
        repeatsInput.value = '3';
        repeatsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const checkboxes = document.querySelectorAll('fieldset input[type="checkbox"]');
      if (checkboxes.length >= 3) {
        checkboxes[0].click(); // L1
        checkboxes[1].click(); // L2
        checkboxes[2].click(); // L3
      }
    `);
    await delay(1000);

    // Advance to Step 2 (Review / Matrix Preview)
    await evalJs(`
      const continueBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
      if (continueBtn) continueBtn.click();
    `);
    await delay(1500);

    // 1. Capture Matrix Grid View
    console.log('Capturing 01-experiment-matrix-preview-grid.png...');
    await takeScreenshot('01-experiment-matrix-preview-grid.png');

    // 2. Switch to Planned Runs List tab and capture
    console.log('Switching to Planned Runs list tab...');
    await evalJs(`
      const planTab = document.querySelector('[data-testid="tab-matrix-plan"]');
      if (planTab) planTab.click();
    `);
    await delay(1000);
    console.log('Capturing 02-experiment-matrix-preview-planned-runs.png...');
    await takeScreenshot('02-experiment-matrix-preview-planned-runs.png');

    // 3. Trigger input rejection alert
    console.log('Triggering input rejection alert...');
    await evalJs(`
      const prevBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Previous'));
      if (prevBtn) prevBtn.click();
    `);
    await delay(800);

    await evalJs(`
      const repeatsInput = document.querySelector('#experiment-repeats');
      if (repeatsInput) {
        repeatsInput.value = '500';
        repeatsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const continueBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
      if (continueBtn) continueBtn.click();
    `);
    await delay(800);
    console.log('Capturing 03-experiment-matrix-input-rejection.png...');
    await takeScreenshot('03-experiment-matrix-input-rejection.png');

    console.log('✅ All experiment matrix preview screenshots successfully captured!');
  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    cleanup();
    process.exit(0);
  }
}

run();
