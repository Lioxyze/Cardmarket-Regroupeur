/*
 * Visuels de la fiche Chrome Web Store, générés sur le faux Cardmarket (tests/harness) :
 *   store/capture-1-liste.png, capture-2-resultats.png, capture-3-vendeurs.png (1280×800)
 *   store/promo-440x280.png (vignette promotionnelle)
 * Usage : node scripts/store-assets.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'store');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/harness/index.html?fast&store`);
  const inShadow = (fn, arg) => page.evaluate(fn, arg);
  const click = (sel) =>
    inShadow((s) => {
      const el = document.getElementById('cmr-host').shadowRoot.querySelector(s);
      if (!el) throw new Error('introuvable : ' + s);
      el.click();
    }, sel);
  const waitFor = async (sel, ms = 120000) => {
    const t0 = Date.now();
    while (!(await inShadow((s) => !!document.getElementById('cmr-host').shadowRoot.querySelector(s), sel))) {
      if (Date.now() - t0 > ms) throw new Error('délai dépassé : ' + sel);
      await sleep(250);
    }
  };
  const shot = async (name) => {
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('store/' + name);
  };

  await waitFor('.launcher');
  await click('[data-act="open"]');
  await waitFor('.panel');

  // 1. Liste collée « numéro — nom », reconnue et associée par numéro
  await inShadow((v) => {
    const input = document.getElementById('cmr-host').shadowRoot.querySelector('input[data-model="searchQ"]');
    const data = new DataTransfer();
    data.setData('text/plain', v);
    input.focus();
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, composed: true, cancelable: true }));
  }, ['001 — Bulbizarre', '007 — Carapuce', '025 — Pikachu', '065 — Alakazam-ex', '2x 145 — Électhor-ex', '151 — Mew-ex', "160 — Invitation d'Érika"].join('\n'));
  const t0 = Date.now();
  while (!(await inShadow(() => {
    const b = document.getElementById('cmr-host').shadowRoot.querySelector('[data-act="bulk-add"]');
    return !!b && !b.disabled;
  }))) {
    if (Date.now() - t0 > 30000) throw new Error('liste non résolue');
    await sleep(250);
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await shot('capture-1-liste.png');
  await click('[data-act="bulk-add"]');
  await sleep(300);

  // 2. Résultats : la réponse en une phrase, le port, l'écart de chaque carte
  await click('[data-act="analyse"]');
  await waitFor('.answer', 180000);
  await sleep(2700); // laisse disparaître la notification
  await shot('capture-2-resultats.png');

  // 3. Vue large : combinaisons et vendeurs
  await click('[data-act="wide"]');
  await inShadow(() => {
    const r = document.getElementById('cmr-host').shadowRoot;
    const target = r.querySelector('.segmented[aria-label="Nombre de vendeurs"]') || r.querySelector('.table-wrap');
    r.querySelector('.body').scrollTop += target.getBoundingClientRect().top - 140;
  });
  await shot('capture-3-vendeurs.png');

  // 4. Vignette promotionnelle 440×280
  const logo = fs.readFileSync(path.join(ROOT, 'icons', 'icon-128.png')).toString('base64');
  const promo = await browser.newPage();
  await promo.setViewport({ width: 440, height: 280 });
  await promo.setContent(`<!doctype html><html><body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;
    background:linear-gradient(135deg,#13284c,#1f4fd1);font-family:system-ui,'Segoe UI',sans-serif;color:#fff">
    <img src="data:image/png;base64,${logo}" style="width:96px;height:96px;flex:none">
    <div><div style="font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1.05">Regroupeur</div>
    <div style="font-size:15px;opacity:.85;margin-top:4px">pour Cardmarket</div>
    <div style="font-size:16px;font-weight:600;margin-top:16px;line-height:1.3">Moins de vendeurs,<br>moins de frais de port.</div></div></body></html>`);
  await promo.screenshot({ path: path.join(OUT, 'promo-440x280.png') });
  console.log('store/promo-440x280.png');

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
