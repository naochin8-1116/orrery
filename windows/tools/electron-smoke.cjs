// Run on Windows: uses the real Electron preload, IPC, OS metrics and persistence.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
(async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'orrery-smoke-'));
  let desktop;
  try {
    desktop = await electron.launch({ args: [path.resolve(__dirname, '..'), `--user-data-dir=${userData}`] });
    const page = await desktop.firstWindow();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => Boolean(window.orrery));
    const data = await page.evaluate(async () => ({ initial: await window.orrery.load(), metrics: await window.orrery.metrics(), requireType: typeof require }));
    assert.equal(data.requireType, 'undefined');
    assert.equal(data.initial.platform, process.platform);
    assert.ok(data.metrics.cores > 0);
    assert.ok(Number.isFinite(data.metrics.cpu));
    await page.click('#settingsButton');
    await page.locator('[name=city]').fill('SMOKE TEST');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => !document.getElementById('settingsDialog').open);
    assert.equal(await page.evaluate(async () => (await window.orrery.load()).settings.city), 'SMOKE TEST');
    await assert.rejects(() => page.evaluate(() => window.orrery.save({latitude: 1000})));
    const userDataPath = await desktop.evaluate(({ app }) => app.getPath('userData'));
    const settingsPath = path.join(userDataPath, 'settings.json');
    assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).settings.city, 'SMOKE TEST');
    assert.deepEqual(errors, []);
    console.log('PASS: real Electron window, sandbox/preload, IPC, OS telemetry, settings persistence and invalid-input rejection');
  } finally { if (desktop) await desktop.close(); await fs.rm(userData, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
