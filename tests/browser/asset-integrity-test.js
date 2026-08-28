#!/usr/bin/env node
/**
 * After Earth — asset integrity test (wires the orphaned testing.html harness into CI)
 * ---------------------------------------------------------------------------------
 * testing.html is a real, pre-existing browser harness (predates this tests/ suite)
 * that boots the actual game in an iframe and checks things nothing else in this
 * pipeline does: every planet/unit/structure image is actually wired up, no
 * duplicate planet images, every wired image genuinely loads over the real
 * network, all 6 buildings exist on every planet, and a live (non-mocked)
 * AI-hunting behavioral check. It was never run by anything automated - this
 * script is that missing driver.
 *
 * Two things this needed that the rest of the suite doesn't:
 *
 * 1. testing.html loads index.html in an iframe and reaches into it
 *    (win.__reportTestResults = ...). Opened directly via file:// (the same way
 *    every other test here loads index.html), Chromium treats each file:// document
 *    as its own opaque origin and BLOCKS that cross-frame access outright -
 *    confirmed directly: it throws "Blocked a frame with origin 'null' from
 *    accessing a cross-origin frame" and testing.html hangs forever on
 *    "running tests inside the game...". This is almost certainly why the harness
 *    went unused - it doesn't work if you just double-click it. Fixed here by
 *    serving both files over a real (local, throwaway) HTTP origin instead, which
 *    is genuinely same-origin and has none of this restriction.
 *
 * 2. Unlike every other job in this pipeline (which deliberately mocks out
 *    sprite/image requests for determinism - see visual-test.js/interaction-
 *    test.js), the whole point of this one is to hit the REAL network and
 *    confirm every asset URL actually resolves. That makes it slower and
 *    dependent on GitHub's raw-content CDN being reachable/fast from the
 *    runner, which is a different failure mode than everything else here
 *    (network flakiness, not a code regression) - hence the generous timeout
 *    and the clear distinction in the failure message.
 *
 * Usage:
 *   node asset-integrity-test.js "<path-to-repo-root>"
 *
 * Exits 0 if every check in testing.html's own suite passes, 1 otherwise
 * (including "never finished" - printed as a timeout, not a silent hang).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('playwright');

const REPO_ROOT = process.argv[2];
const RUN_TIMEOUT_MS = 4 * 60 * 1000; // generous - real network image loads, not mocked

if (!REPO_ROOT || !fs.existsSync(path.join(REPO_ROOT, 'testing.html'))) {
    console.error('Usage: node asset-integrity-test.js "<path-to-repo-root>" (must contain testing.html)');
    process.exit(1);
}

function contentType(filePath) {
    if (filePath.endsWith('.html')) return 'text/html';
    if (filePath.endsWith('.js')) return 'application/javascript';
    if (filePath.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
}

function startStaticServer(root) {
    const absRoot = path.resolve(root);
    const server = http.createServer((req, res) => {
        const filePath = path.join(absRoot, decodeURIComponent(req.url.split('?')[0]));
        if (!filePath.startsWith(absRoot)) { res.writeHead(403); res.end(); return; }
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': contentType(filePath) });
            res.end(data);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

async function run() {
    const { server, port } = await startStaticServer(REPO_ROOT);
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage();

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    try {
        await page.goto(`http://127.0.0.1:${port}/testing.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#runBtn', { state: 'visible', timeout: 30000 });
        await page.click('#runBtn', { timeout: 30000 });

        const deadline = Date.now() + RUN_TIMEOUT_MS;
        let done = false;
        while (Date.now() < deadline) {
            done = await page.evaluate(() => document.getElementById('summary').style.display === 'block');
            if (done) break;
            await page.waitForTimeout(2000);
        }

        if (!done) {
            console.error(`FATAL: testing.html did not finish within ${RUN_TIMEOUT_MS / 1000}s.`);
            if (pageErrors.length) console.error('Page errors seen while waiting:\n  ' + pageErrors.join('\n  '));
            const progress = await page.evaluate(() => document.getElementById('progress').textContent).catch(() => '(unknown)');
            console.error(`Last known progress: "${progress}"`);
            process.exitCode = 1;
            return;
        }

        const { summaryText, rows } = await page.evaluate(() => ({
            summaryText: document.getElementById('summary').textContent,
            rows: Array.from(document.querySelectorAll('.row')).map(r => ({
                pass: r.classList.contains('pass'),
                text: r.textContent,
            })),
        }));

        const failures = rows.filter(r => !r.pass);
        console.log(summaryText);
        if (failures.length) {
            console.log('\nFailed checks:');
            failures.forEach(f => console.log(`  ❌ ${f.text}`));
            process.exitCode = 1;
        } else {
            console.log('✅ Every check in testing.html passed.');
        }
    } finally {
        await browser.close().catch(() => {}); // may already be gone (e.g. a renderer crash) - don't mask the real failure above
        server.close();
    }
}

run().catch((e) => {
    console.error('FATAL:', e.stack || e.message);
    process.exit(1);
});
