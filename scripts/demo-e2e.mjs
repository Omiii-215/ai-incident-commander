// End-to-end check of the public demo (apps/site + apps/web demo build): every person and the full approval story.
import puppeteer from 'puppeteer-core';

// Usage: BASE=https://ai-incident-commander-app.vercel.app pnpm test:demo  (defaults to a local static server on :3100)
const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const U = { alice: '00000000-0000-4000-8000-000000000001', bob: '00000000-0000-4000-8000-000000000002', carol: '00000000-0000-4000-8000-000000000003', erin: '00000000-0000-4000-8000-000000000005', gina: '00000000-0000-4000-8000-000000000008', dave: '00000000-0000-4000-8000-000000000004' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('requestfailed', (r) => r.failure()?.errorText !== 'net::ERR_ABORTED' && !r.url().includes('favicon') && errors.push(`request failed ${r.url()} ${r.failure()?.errorText}`));

const text = () => page.evaluate(() => document.body.innerText);
const waitText = async (t, timeout = 12000) => {
  try {
    await page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
    return true;
  } catch {
    return false;
  }
};
const click = async (label, sel = 'button,a', timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate((l, s) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(l) && !e.disabled);
      if (!el) return false;
      el.click();
      return true;
    }, label, sel);
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`no clickable "${label}"`);
};
const signInAs = async (who) => {
  await page.goto(`${BASE}/demo/login/?as=${U[who]}`, { waitUntil: 'load' });
  return waitText('Live demo as');
};
const metric = (label) => page.evaluate((l) => {
  const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim().startsWith(l));
  return a ? Number(a.querySelector('.tabular')?.textContent) : NaN;
}, label);

// 1. Bob: overview, live alert, acknowledge, request a fix, self-approval blocked.
check('Bob signs in via ?as= deep link', await signInAs('bob'));
check('Overview renders sample data', await waitText('Open incidents'));
const before = await metric('Open incidents');
await click('Send a test alert');
await sleep(1800);
const after = await metric('Open incidents');
check('Test alert appears live on the overview', after === before + 1, `${before} → ${after}`);

await page.goto(`${BASE}/demo/w/acme/incidents/?q=5xx`, { waitUntil: 'load' });
await waitText('Checkout API: 5xx');
await click('Checkout API: 5xx', 'a');
await waitText('Acknowledge incident');
await click('Acknowledge incident');
check('Acknowledge moves incident to Investigating', await waitText('Acknowledged and assigned'));
await click('Review and request this action');
await waitText('Submit action request');
await click('Submit action request');
check('Request opens the approval review', await waitText('Rollback Checkout API in demo'));
check('Requester cannot approve own request', await waitText('Another commander must review this request.'));
const approvalUrl = page.url();

// 2. Alice (responder): no approvals queue.
await signInAs('alice');
const navAlice = await text();
check('Responder does not see Approvals or Audit in navigation', !navAlice.includes('Audit log') && !/\nApprovals\n/.test(navAlice));
await page.goto(`${BASE}/demo/w/acme/approvals/`, { waitUntil: 'load' });
check('Responder sees permission message on the approvals queue', await waitText('commander or auditor role'));

// 3. Carol approves; the simulated run completes.
await signInAs('carol');
await page.goto(approvalUrl, { waitUntil: 'load' });
await waitText('I reviewed the environment');
await page.evaluate(() => document.querySelector('input[type=checkbox]').click());
await page.type('#decision-reason', 'Checked the target. Rolling back is safe.');
await click('Approve simulated rollback');
check('Approval recorded and queued', await waitText('Approval recorded; waiting for dispatch.', 8000) || await waitText('Executing', 4000));
check('Simulated execution succeeds', await waitText('Execution succeeded.', 20000));

// 4. Carol approves the pre-seeded Payments request: outcome unknown, then reconciled.
await page.goto(`${BASE}/demo/w/acme/approvals/`, { waitUntil: 'load' });
await waitText('Payments Gateway');
const payLink = await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Payments Gateway'))?.getAttribute('href'));
await page.goto(`${BASE}${payLink}`, { waitUntil: 'load' });
await waitText('I reviewed the environment');
await page.evaluate(() => document.querySelector('input[type=checkbox]').click());
await page.type('#decision-reason', 'Approved after review.');
await click('Approve simulated rollback');
const unknownOk = await waitText('Execution outcome is unknown', 15000);
check('Uncertain result shows Outcome unknown', unknownOk);
if (!unknownOk) console.log('--- alerts:', await page.evaluate(() => [...document.querySelectorAll('[role=alert],[role=status]')].map((e) => e.innerText).join(' | ')));
check('Reconciliation then confirms success', await waitText('Execution succeeded.', 20000));

// 5. Erin (auditor): audit log, read-only.
await signInAs('erin');
await page.goto(`${BASE}/demo/w/acme/audit/`, { waitUntil: 'load' });
check('Auditor sees approvals in the audit log', await waitText('action.approve'));
await page.goto(approvalUrl, { waitUntil: 'load' });
await waitText('Rollback Checkout API');
check('Auditor has no approve controls', !(await text()).includes('Approve simulated rollback'));

// 6. Dave (admin): plugins.
await signInAs('dave');
await page.goto(`${BASE}/demo/w/acme/settings/plugins/`, { waitUntil: 'load' });
check('Admin sees plugin settings', await waitText('Recovery Simulator'));

// 7. Gina (Globex): tenant isolation.
await signInAs('gina');
check('Globex user lands in Globex', (await text()).includes('Globex Corp'));
await page.goto(`${BASE}/demo/w/acme/overview/`, { waitUntil: 'load' });
check('Globex user cannot open Acme', await waitText('Workspace unavailable'));

// 8. Phone width.
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
await signInAs('bob');
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
check('Demo overview fits a 375 px phone', sw <= 375, `scrollWidth ${sw}`);

const relevant = errors.filter((e) => !/favicon|DevTools|Download the React/.test(e));
check('No page errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
