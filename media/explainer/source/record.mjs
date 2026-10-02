// Records real footage of the running website (localhost:3000) per scene, paced to the narration.
// Also logs "marks": element rectangles at moments, used for camera moves and callouts.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const DIR = new URL('.', import.meta.url).pathname;
const OUT = `${DIR}footage/`;
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3000';
const WS = '00000000-0000-4000-8000-000000000100';
const USERS = { bob: '00000000-0000-4000-8000-000000000002', carol: '00000000-0000-4000-8000-000000000003', alice: '00000000-0000-4000-8000-000000000001' };
const VOICE = JSON.parse(readFileSync(`${DIR}voice/durations.json`, 'utf8'));
const only = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1600, H = 900, DPR = 1.2;

// Fake cursor + recording polish injected into every page (recording only; the app is unchanged).
const INJECT = () => {
  const install = () => {
    if (document.getElementById('__rec_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      nextjs-portal{display:none!important}
      html{scroll-behavior:auto}
      #__rec_cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}
      .__rec_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid rgba(59,130,246,.9);animation:__rip .6s ease-out forwards}
      @keyframes __rip{to{transform:scale(4.5);opacity:0}}`;
    document.head.appendChild(style);
    const c = document.createElement('div');
    c.id = '__rec_cursor';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3l16 9.5-6.8 1.6 4.2 8.4-3.3 1.6-4.2-8.4L5 21z" fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const saved = JSON.parse(sessionStorage.getItem('__cursor') || '[1200,640]');
    window.__cur = { x: saved[0], y: saved[1] };
    c.style.transform = `translate(${saved[0]}px,${saved[1]}px)`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  window.byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  window.__moveCursor = (x, y, ms) =>
    new Promise((res) => {
      install();
      const c = document.getElementById('__rec_cursor');
      const from = { ...window.__cur };
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms), e = ease(p);
        const cx = from.x + (x - from.x) * e, cy = from.y + (y - from.y) * e;
        c.style.transform = `translate(${cx}px,${cy}px)`;
        window.__cur = { x: cx, y: cy };
        sessionStorage.setItem('__cursor', JSON.stringify([cx, cy]));
        p < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  window.__ripple = (x, y) => {
    const r = document.createElement('div');
    r.className = '__rec_ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 700);
  };
  window.__smoothScroll = (to, ms) =>
    new Promise((res) => {
      const from = window.scrollY, t0 = performance.now();
      const target = Math.max(0, Math.min(to, document.documentElement.scrollHeight - innerHeight));
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, from + (target - from) * ease(p));
        p < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--hide-scrollbars'],
});

async function session(user, { theme = 'light', mobile = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: W, height: H, deviceScaleFactor: DPR });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('aic-theme', t), theme);
  await page.evaluateOnNewDocument(INJECT);
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.evaluate(async (id) => {
    await fetch('/api/v1/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) });
  }, USERS[user]);
  return page;
}

// ---- helpers ---------------------------------------------------------------
const findRect = (page, fn, arg) =>
  page.evaluate(
    (src, a) => {
      const el = new Function('a', `return (${src})(a)`)(a);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    fn.toString(),
    arg,
  );
const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text));

class Rec {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.marks = [];
  }
  async start() {
    this.recorder = await this.page.screencast({ path: `${OUT}${this.name}.webm`, fps: 30, quality: 14 });
    this.t0 = Date.now();
  }
  now() {
    return (Date.now() - this.t0) / 1000;
  }
  async at(sec) {
    const wait = sec * 1000 - (Date.now() - this.t0);
    if (wait > 0) await sleep(wait);
  }
  async mark(label, fn, arg, extra = {}) {
    const rect = await findRect(this.page, fn, arg);
    if (rect) this.marks.push({ t: this.now(), label, rect, ...extra });
    return rect;
  }
  async moveTo(fn, arg, ms = 700, offset = { x: 0.5, y: 0.5 }) {
    const r = await findRect(this.page, fn, arg);
    if (!r) throw new Error(`moveTo target missing in ${this.name}`);
    const x = r.x + r.w * offset.x, y = r.y + r.h * offset.y;
    await this.page.evaluate((a, b, c) => window.__moveCursor(a, b, c), x, y, ms);
    return { x, y, r };
  }
  async click(fn, arg, ms = 700) {
    const { x, y } = await this.moveTo(fn, arg, ms);
    await sleep(120);
    await this.page.evaluate((a, b) => window.__ripple(a, b), x, y);
    await this.page.mouse.click(x, y);
  }
  async scrollToEl(fn, arg, ms = 1200, topOffset = 90) {
    const r = await findRect(this.page, fn, arg);
    if (!r) return;
    const y = await this.page.evaluate(() => window.scrollY);
    await this.page.evaluate((to, d) => window.__smoothScroll(to, d), y + r.y - topOffset, ms);
  }
  async scrollBy(dy, ms = 1200) {
    const y = await this.page.evaluate(() => window.scrollY);
    await this.page.evaluate((to, d) => window.__smoothScroll(to, d), y + dy, ms);
  }
  async stop() {
    await sleep(400);
    await this.recorder.stop();
    writeFileSync(`${OUT}${this.name}.json`, JSON.stringify({ duration: this.now(), viewport: { w: this.page.viewport().width, h: this.page.viewport().height }, marks: this.marks }, null, 2));
    console.log(`recorded ${this.name} ${this.now().toFixed(1)}s, ${this.marks.length} marks`);
  }
}

function sendAlert() {
  const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8'); // repository root .env
  const secret = env.match(/SECRET_SYNTHETIC_ALERTS_DEV=(.+)/)[1].trim();
  const body = JSON.stringify({
    externalEventId: `video-${randomUUID()}`,
    serviceKey: 'shipping',
    environment: 'demo',
    alertType: 'label_printer_errors',
    severity: 'sev3',
    occurredAt: new Date().toISOString(),
    summary: 'Label printing failing for new orders',
    labels: {},
    measurements: {},
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
  return fetch('http://localhost:4000/api/v1/connectors/2f10a7b5-e8b3-4145-bcaf-787792815a89/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Connector-Timestamp': ts, 'X-Connector-Signature': sig },
    body,
  });
}

const sent = (id, i) => VOICE[id].sentences[i];
const lead = 0.6; // footage plays slightly ahead of speech

// ---- scenes ------------------------------------------------------------------
const bob = await session('bob');
const incId = await bob.evaluate(async (ws) => {
  const r = await fetch(`/api/v1/workspaces/${ws}/incidents?q=5xx`).then((x) => x.json());
  return r.data.items.find((i) => i.serviceName === 'Checkout API').id;
}, WS);

if (!only || only === 'overview') {
  await bob.goto(`${BASE}/w/acme/overview`, { waitUntil: 'load' });
  await sleep(2500);
  const r = new Rec(bob, 'overview');
  await r.start();
  await r.mark('live', () => byText('span', 'Live'));
  await r.mark('metrics', () => document.querySelector('section[aria-labelledby="metrics-h"]'));
  await r.at(lead + sent('overview', 1).start);
  await r.moveTo(() => byText('a', 'Open incidents'), null, 900);
  await r.at(lead + sent('overview', 2).start);
  await sendAlert(); // a real new alert arrives while we watch
  await sleep(1600);
  await r.mark('metric-updated', () => byText('a', 'Open incidents'));
  await r.at(lead + sent('overview', 2).start + 2.6);
  await r.scrollToEl(() => byText('h2', 'Active incidents'), null, 1600);
  await r.at(VOICE.overview.duration + 1.4);
  await r.stop();
}

if (!only || only === 'incidents') {
  await bob.goto(`${BASE}/w/acme/incidents`, { waitUntil: 'load' });
  await sleep(2500);
  const r = new Rec(bob, 'incidents');
  await r.start();
  await r.mark('table', () => document.querySelector('table'));
  await r.at(lead + sent('incidents', 1).start);
  await r.mark('severity', () => document.querySelector('table tbody'), null, { focus: 'left' });
  await r.moveTo(() => document.querySelector('table tbody tr td'), null, 900);
  await r.at(lead + sent('incidents', 2).start);
  await r.scrollBy(240, 1400);
  await r.at(lead + sent('incidents', 2).end - 0.6);
  await r.click(() => [...document.querySelectorAll('table a')].find((a) => a.textContent.includes('Checkout API: 5xx')), null, 900);
  await r.at(VOICE.incidents.duration + 1.4);
  await r.stop();
}

if (!only || only === 'ack') {
  await bob.goto(`${BASE}/w/acme/incidents/${incId}`, { waitUntil: 'load' });
  await sleep(2500);
  const r = new Rec(bob, 'ack');
  await r.start();
  await r.mark('header', () => document.querySelector('h1'));
  await r.at(lead + sent('ack', 1).start);
  await r.mark('ack-button', () => byText('button', 'Acknowledge incident'));
  await r.click(() => byText('button', 'Acknowledge incident'), null, 1100);
  await sleep(1500);
  await r.mark('status', () => byText('span', 'Investigating'));
  await r.at(VOICE.ack.duration + 1.4);
  await r.stop();
}

if (!only || only === 'diagnosis') {
  await bob.goto(`${BASE}/w/acme/incidents/${incId}`, { waitUntil: 'load' });
  await sleep(2500);
  const r = new Rec(bob, 'diagnosis');
  await r.start();
  await r.at(0.4);
  await r.scrollToEl(() => byText('h2', 'Diagnosis'), null, 1600);
  await r.mark('summary', () => [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('Evidence points to')));
  await r.at(lead + sent('diagnosis', 2).start);
  await r.scrollToEl(() => byText('h3', 'Hypotheses'), null, 1400, 140);
  await sleep(300);
  await r.mark('hypothesis', () => document.querySelector('#hyp-h + ol li'));
  await r.at(lead + sent('diagnosis', 3).start);
  await r.moveTo(() => [...document.querySelectorAll('a[href^="#evidence-"]')].find((a) => a.textContent.startsWith('Deployment')), null, 900);
  await r.mark('proof', () => document.querySelector('#hyp-h + ol li p:nth-of-type(2)'));
  await r.at(VOICE.diagnosis.duration + 1.4);
  await r.stop();
}

if (!only || only === 'secrets') {
  await bob.goto(`${BASE}/w/acme/incidents/${incId}`, { waitUntil: 'load' });
  await sleep(2500);
  await bob.evaluate(() => {
    const li = [...document.querySelectorAll('li[id^="evidence-"]')].find((l) => l.textContent.includes('Recent error log'));
    window.scrollTo(0, window.scrollY + li.getBoundingClientRect().top - 220);
  });
  await sleep(600);
  const r = new Rec(bob, 'secrets');
  await r.start();
  await r.at(0.5);
  await r.click(() => [...document.querySelectorAll('li[id^="evidence-"]')].find((l) => l.textContent.includes('Recent error log')).querySelector('summary'), null, 1000);
  await sleep(700);
  await r.mark('redacted', () => [...document.querySelectorAll('li[id^="evidence-"]')].find((l) => l.textContent.includes('Recent error log')).querySelector('pre'));
  await r.at(VOICE.secrets.duration + 1.4);
  await r.stop();
}

let approvalPath;
if (!only || only === 'request' || only === 'approve' || only === 'run') {
  await bob.goto(`${BASE}/w/acme/incidents/${incId}`, { waitUntil: 'load' });
  await sleep(2500);
  await bob.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.startsWith('Suggested action plan'));
    window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 200);
  });
  await sleep(600);
  const r = new Rec(bob, 'request');
  await r.start();
  await r.mark('suggestion', () => byText('h3', 'Suggested action plan').parentElement);
  await r.at(lead + sent('request', 1).start);
  await r.click(() => byText('button', 'Review and request this action'), null, 1000);
  await sleep(500);
  await r.scrollToEl(() => byText('h2', 'Request an action'), null, 1100);
  await r.at(lead + sent('request', 2).start);
  await r.mark('submit', () => byText('button', 'Submit action request'));
  await r.click(() => byText('button', 'Submit action request'), null, 900);
  await bob.waitForFunction(() => location.pathname.includes('/approvals/'), { timeout: 15000 });
  approvalPath = new URL(bob.url()).pathname;
  await sleep(1800);
  await r.at(lead + sent('request', 3).start);
  await r.scrollToEl(() => byText('h2', 'Decision'), null, 1500, 120);
  await sleep(300);
  await r.mark('blocked', () => byText('p', 'Another commander must review'));
  await r.at(VOICE.request.duration + 1.4);
  await r.stop();
}

let carol;
if (approvalPath && (!only || only === 'approve' || only === 'run')) {
  carol = await session('carol');
  await carol.goto(`${BASE}${approvalPath}`, { waitUntil: 'load' });
  await sleep(3000);
  await carol.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.startsWith('Review requirements'));
    window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 120);
  });
  await sleep(600);
  const r = new Rec(carol, 'approve');
  await r.start();
  await r.mark('requirements', () => byText('h2', 'Review requirements').closest('section'));
  await r.at(lead + sent('approve', 1).start);
  await r.scrollToEl(() => byText('h2', 'Decision'), null, 1200, 140);
  await r.at(lead + sent('approve', 2).start);
  await r.click(() => document.querySelector('input[type=checkbox]'), null, 800);
  await r.click(() => document.querySelector('#decision-reason'), null, 600);
  await carol.keyboard.type('Checked the target. Going back to v2.13.4 is safe.', { delay: 38 });
  await r.mark('approve-button', () => byText('button', 'Approve simulated rollback'));
  await r.click(() => byText('button', 'Approve simulated rollback'), null, 800);
  await sleep(1200);
  await r.at(VOICE.approve.duration + 1.2);
  await r.stop();
}

if (carol && (!only || only === 'run')) {
  await carol.waitForFunction(() => document.body.innerText.includes('Execution succeeded'), { timeout: 30000 });
  await carol.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
  const r = new Rec(carol, 'run');
  await r.start();
  await r.mark('success', () => byText('p', 'Execution succeeded').parentElement.parentElement);
  await r.at(lead + sent('run', 1).start);
  await r.scrollToEl(() => byText('h2', 'Execution record'), null, 1600, 140);
  await r.mark('record', () => byText('h2', 'Execution record').closest('section'));
  await r.at(lead + sent('run', 2).start);
  await carol.goto(`${BASE}/w/acme/audit`, { waitUntil: 'load' });
  await sleep(1800);
  await r.mark('audit', () => document.querySelector('table'));
  await r.scrollBy(260, 2200);
  await r.at(VOICE.run.duration + 1.4);
  await r.stop();
  await carol.browserContext().close();
}

if (!only || only === 'phone') {
  await bob.browserContext().close();
  await sleep(1200);
  const phone = await session('alice', { theme: 'dark', mobile: true });
  await phone.goto(`${BASE}/w/acme/overview`, { waitUntil: 'load' });
  await sleep(3000);
  await phone.evaluate(() => sessionStorage.setItem('__cursor', '[300,700]'));
  const r = new Rec(phone, 'phone');
  await r.start();
  await r.at(0.6);
  await r.scrollBy(520, 2200);
  await r.at(2.8);
  await r.scrollBy(-520, 1600);
  await r.at(VOICE.phone.duration + 1.6);
  await r.stop();
}

await browser.close();
