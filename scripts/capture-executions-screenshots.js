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
    shell: true,
  });

  await delay(1000);

  console.log('Starting Vite server on port 5173...');
  const viteProcess = spawn('npm.cmd', ['run', 'dev', '--', '--port', '5173', '--host', '127.0.0.1'], {
    cwd: path.resolve(__dirname, '../frontend'),
    shell: true,
  });

  await delay(2500);

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

  await new Promise((r) => ws.onopen = r);

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

  try {
    await delay(2000);

    // 1. Fill login form using prototype setters only
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

    const formCheck = await evaluate(`(() => {
      const form = document.querySelector('form');
      const data = new FormData(form);
      return { email: data.get('email'), pwd: Boolean(data.get('password')) };
    })()`);
    console.log('FormData before submit:', formCheck);

    // Click submit
    console.log('Clicking sign in submit button...');
    await evaluate(`(() => {
      const btn = document.querySelector('button[type="submit"]') || [...document.querySelectorAll('button')].find(b => b.textContent.includes('Sign in'));
      if (btn) btn.click();
    })()`);

    await delay(3000);

    const afterLoginUrl = await evaluate('window.location.href');
    console.log('URL after login:', afterLoginUrl);

    // 2. Navigate to Projects
    console.log('Navigating to Projects...');
    await evaluate(`(() => {
      const link = document.querySelector('a[href="/projects"]');
      if (link) link.click();
    })()`);
    await delay(2000);

    // 3. Click demo-project
    console.log('Clicking demo-project...');
    await evaluate(`(() => {
      const link = document.querySelector('a[href="/projects/demo-project"]');
      if (link) link.click();
    })()`);
    await delay(2500);

    // 4. Click "Executions (UC-08)" tab
    console.log('Clicking Executions (UC-08) tab...');
    const tabClick = await evaluate(`(() => {
      const tabBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Executions'));
      if (tabBtn) {
        tabBtn.click();
        return 'clicked executions tab';
      }
      return 'executions tab not found';
    })()`);
    console.log('Tab click result:', tabClick);
    await delay(2000);

    const execStatus = await evaluate(`(() => {
      return {
        url: window.location.href,
        hasSecurityNotice: Boolean(document.querySelector('#sandbox-notice-title')),
        cardsCount: document.querySelectorAll('[data-testid^="execution-card-"]').length,
        bodySnippet: document.body.innerText.slice(0, 300),
      };
    })()`);
    console.log('Executions tab status:', execStatus);

    // 5. Capture 01-execution-status-overview.png
    console.log('Capturing 01-execution-status-overview.png...');
    await takeScreenshot('01-execution-status-overview.png');

    // 6. Click Cancel on exec-run-101
    console.log('Opening Cancel Execution Modal...');
    const cancelModalResult = await evaluate(`(() => {
      const cancelBtn = document.querySelector('[data-testid="cancel-run-btn-exec-run-101"]');
      if (cancelBtn) {
        cancelBtn.click();
        return 'clicked cancel button';
      }
      return 'cancel button not found';
    })()`);
    console.log('Cancel modal click:', cancelModalResult);
    await delay(1200);

    console.log('Capturing 02-cancel-execution-modal.png...');
    await takeScreenshot('02-cancel-execution-modal.png');

    // Close cancel modal
    console.log('Closing Cancel Modal...');
    await evaluate(`(() => {
      const closeBtn = document.querySelector('[aria-label="Close dialog"]');
      if (closeBtn) closeBtn.click();
    })()`);
    await delay(1000);

    // 7. Click Inspect on exec-run-101
    console.log('Opening Inspection / Logs Modal...');
    const inspectModalResult = await evaluate(`(() => {
      const inspectBtn = document.querySelector('[data-testid="inspect-run-btn-exec-run-101"]');
      if (inspectBtn) {
        inspectBtn.click();
        return 'clicked inspect button';
      }
      return 'inspect button not found';
    })()`);
    console.log('Inspect modal click:', inspectModalResult);
    await delay(1200);

    console.log('Capturing 03-execution-detail-and-logs.png...');
    await takeScreenshot('03-execution-detail-and-logs.png');

    console.log('All screenshots completed successfully!');
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
