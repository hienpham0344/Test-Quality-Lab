const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/screenshots/reports');

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

  const tmpProfile = path.resolve(__dirname, '../.tmp_chrome_profile_reports');
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

  await new Promise((r) => (ws.onopen = r));

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evaluate(code) {
    const res = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
    return res.result ? res.result.value : res;
  }

  async function takeScreenshot(fileName) {
    await delay(1200);
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(SCREENSHOT_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    console.log(`Saved screenshot: ${filePath} (${fs.statSync(filePath).size} bytes)`);
  }

  async function waitForSelector(selector, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await evaluate(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await delay(400);
    }
    return false;
  }

  try {
    console.log('Waiting for login form...');
    await waitForSelector('input[name="email"]');

    // Fill login form
    console.log('Filling login form and signing in...');
    await evaluate(`(() => {
      const setVal = (el, val) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(document.querySelector('input[name="email"]'), 'tester@example.com');
      setVal(document.querySelector('input[name="password"]'), 'Password123456!');
    })()`);
    await delay(500);

    // Submit
    await evaluate(`(() => {
      const form = document.querySelector('form');
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    })()`);

    await delay(3000);

    // Navigate to Results Dashboard
    console.log('Navigating to /projects/demo-project/results...');
    await evaluate(`(() => {
      window.location.href = '/projects/demo-project/results';
    })()`);

    await delay(3000);
    await waitForSelector('[data-testid="results-dashboard-page"]');

    // 1. Capture 01-results-dashboard-overview-and-progress.png
    console.log('Capturing 01-results-dashboard-overview-and-progress.png...');
    await takeScreenshot('01-results-dashboard-overview-and-progress.png');

    // 2. Scroll to history table and capture 02-results-history-table-and-metrics.png
    console.log('Capturing 02-results-history-table-and-metrics.png...');
    await evaluate(`(() => {
      const table = document.querySelector('[data-testid="results-history-table"]');
      if (table) table.scrollIntoView({ behavior: 'instant', block: 'center' });
    })()`);
    await takeScreenshot('02-results-history-table-and-metrics.png');

    // 3. Apply search and filters and capture 03-results-filters-and-search.png
    console.log('Applying search filter "HumanEval" and status "COMPLETED"...');
    await evaluate(`(() => {
      const setVal = (el, val) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(document.querySelector('[data-testid="search-results-input"]'), 'HumanEval');

      const statusSelect = document.querySelector('[data-testid="filter-status-select"]');
      if (statusSelect) {
        statusSelect.value = 'COMPLETED';
        statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await delay(1000);
    console.log('Capturing 03-results-filters-and-search.png...');
    await takeScreenshot('03-results-filters-and-search.png');

    // 4. Reset filters, click Inspect on exec-run-101 and capture 04-result-drilldown-inspection-modal.png
    console.log('Resetting filters and clicking Inspect on exec-run-101...');
    await evaluate(`(() => {
      const resetBtn = document.querySelector('[data-testid="reset-filters-btn"]');
      if (resetBtn) resetBtn.click();
    })()`);
    await delay(1000);

    await evaluate(`(() => {
      const inspectBtn = document.querySelector('[data-testid="inspect-run-btn-exec-run-101"]');
      if (inspectBtn) inspectBtn.click();
    })()`);
    await delay(1500);

    console.log('Capturing 04-result-drilldown-inspection-modal.png...');
    await takeScreenshot('04-result-drilldown-inspection-modal.png');

    console.log('All screenshots captured successfully!');
  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    ws.close();
    cleanup([mockProcess, viteProcess, chromeProcess]);
  }
}

function cleanup(procs) {
  for (const p of procs) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', p.pid, '/f', '/t'], { stdio: 'ignore' });
      } else {
        p.kill('SIGTERM');
      }
    } catch { }
  }
}

run();
