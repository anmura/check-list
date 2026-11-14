// Runs JavaScript inside the app's WebView on a connected emulator (debug build)
// through the Chrome DevTools protocol. Used by the emulator test.
// Usage: node scripts/cdp.mjs setup|check
import { execSync } from 'node:child_process';

const PKG = 'io.github.anmura.checklist';
const mode = process.argv[2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const pid = execSync(`adb shell pidof ${PKG}`).toString().trim();
      execSync('adb forward --remove-all');
      execSync(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
      const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
      const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
      if (page) return { pid, ws: page.webSocketDebuggerUrl };
    } catch (e) { /* app still starting */ }
    await sleep(1000);
  }
  throw new Error('Could not connect to the app WebView');
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const reply = new Promise((res) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); };
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const d = await reply;
  ws.close();
  if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails));
  return d.result.result.value;
}

const SETUP = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !document.querySelector('[data-act="new"]'); i++) await wait(200);
  document.querySelector('[data-act="new"]').click();
  await wait(300);
  document.getElementById('name').value = 'Тест';
  document.getElementById('text').value = 'Молоко\\nХлеб';
  document.querySelector('[data-act="create"]').click();
  await wait(300);
  document.querySelector('[data-name="Хлеб"]').click();
  await wait(1500);
  return { h1: document.querySelector('h1').textContent, prefs: typeof Prefs !== 'undefined' && !!Prefs, notifications: typeof LN !== 'undefined' && !!LN };
})()`;

const CHECK = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !document.querySelector('h1'); i++) await wait(200);
  await wait(800);
  return { h1: document.querySelector('h1').textContent, done: document.querySelectorAll('.item.done').length, prefs: typeof Prefs !== 'undefined' && !!Prefs, notifications: typeof LN !== 'undefined' && !!LN };
})()`;

const { pid, ws } = await connect();
const result = await evaluate(ws, mode === 'setup' ? SETUP : CHECK);
console.log(mode, 'pid', pid, JSON.stringify(result));
if (mode === 'check' && result.h1 !== 'Тест') {
  console.error('FAIL: after the app was closed in the background it opened', JSON.stringify(result.h1), 'instead of the list');
  process.exit(1);
}
if (mode === 'check') console.log('PASS: the open list was restored');
