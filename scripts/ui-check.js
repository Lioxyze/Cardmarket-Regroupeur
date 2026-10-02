/*
 * Parcours complet de l'interface sur le faux Cardmarket (tests/harness), dans Chrome sans fenêtre.
 * Usage : node scripts/ui-check.js [dossier-captures]
 * Chrome : variable CHROME_PATH, sinon l'emplacement Windows par défaut.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tests', 'screenshots'));
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/tests/harness/index.html?fast`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Deck test' : undefined));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base);

  const $ = (sel) => page.evaluate((s) => !!document.getElementById('cmr-host').shadowRoot.querySelector(s), sel);
  const click = async (sel) => {
    const ok = await page.evaluate((s) => {
      const el = document.getElementById('cmr-host').shadowRoot.querySelector(s);
      if (el) el.click();
      return !!el;
    }, sel);
    if (!ok) throw new Error('introuvable : ' + sel);
    await sleep(150);
  };
  const text = (sel) => page.evaluate((s) => (document.getElementById('cmr-host').shadowRoot.querySelector(s) || {}).textContent || '', sel);
  const shot = async (name) => {
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('capture', name);
  };
  const waitFor = async (sel, ms = 120000) => {
    const t0 = Date.now();
    while (!(await $(sel))) {
      if (Date.now() - t0 > ms) throw new Error('délai dépassé : ' + sel);
      await sleep(300);
    }
  };

  await waitFor('.launcher');
  await shot('01-lanceur');

  // 0. Premier contact : panneau vide avec le mode d'emploi
  await click('[data-act="open"]');
  await waitFor('.panel');
  await shot('01b-accueil');

  const paste = (value) =>
    page.evaluate((v) => {
      const input = document.getElementById('cmr-host').shadowRoot.querySelector('input[data-model="searchQ"]');
      const data = new DataTransfer();
      data.setData('text/plain', v);
      input.focus();
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, composed: true, cancelable: true }));
    }, value);

  // 0 bis. Format Cardmarket « Nom (CODE 000) », deux extensions mélangées : un groupe par code
  let mark = await page.evaluate(() => window.__requests.length);
  await paste(['Bulbasaur (MEW 001)', 'Squirtle (MEW 007)', 'Mew ex (PAF 053)', 'Charmander (PAF 007)'].join('\n'));
  const tFmt = Date.now();
  while (
    !(await page.evaluate(() => {
      const b = document.getElementById('cmr-host').shadowRoot.querySelector('[data-act="bulk-add"]');
      return !!b && !b.disabled;
    }))
  ) {
    if (Date.now() - tFmt > 30000) throw new Error('format Cardmarket non résolu : ' + (await text('.bulk')));
    await sleep(300);
  }
  const fmtReq = (await page.evaluate(() => window.__requests.slice(0))).slice(mark);
  console.log(`format Cardmarket : ${(await text('.bulk')).replace(/\s+/g, ' ').slice(0, 300)} — ${fmtReq.length} pages lues`);
  fmtReq.forEach((r) => console.log('   ', r));
  await shot('01b2-format-cardmarket');
  await click('[data-act="bulk-cancel"]');

  // 0 bis-2. Même liste, collée dans la zone de texte puis « Lire la liste » (le geste le plus courant)
  mark = await page.evaluate(() => window.__requests.length);
  await page.evaluate((value) => {
    const r = document.getElementById('cmr-host').shadowRoot;
    r.querySelector('details[data-details="bulk"]').open = true;
    const ta = r.querySelector('textarea[data-model="addText"]');
    ta.focus();
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }, ['Houndoom (SFA 066)', 'Bulbasaur (MEW 001)', 'Squirtle (MEW 007)'].join('\n'));
  await click('[data-act="add-text"]');
  const tTa = Date.now();
  while (!(await text('.bulk')).includes('trouvées')) {
    if (Date.now() - tTa > 30000) throw new Error('zone de texte : liste non lue — ' + (await text('.bulk')));
    await sleep(300);
  }
  console.log(`zone de texte : ${(await text('.bulk')).replace(/\s+/g, ' ').slice(0, 160)}`);
  await click('[data-act="bulk-cancel"]');

  // 0 ter. Beaucoup de noms sans numéro : rien n'est lancé sans accord
  mark = await page.evaluate(() => window.__requests.length);
  await paste(['Pikachu', 'Carapuce', 'Bulbizarre', 'Mew', 'Salamèche', 'Alakazam', 'Électhor', 'Invitation', 'Machin', 'Truc'].join('\n'));
  await waitFor('[data-act="pending-go"]', 5000);
  const noReq = (await page.evaluate(() => window.__requests.length)) - mark;
  console.log(`10 noms sans numéro : confirmation demandée, ${noReq} page lue`);
  if (noReq) throw new Error('des recherches sont parties sans confirmation');
  await click('[data-act="pending-clear"]');

  // 1. Liste « numéro — nom » (noms français) collée dans le champ de recherche
  const pasted = [
    '001 — Bulbizarre',
    '007 — Carapuce',
    '025 — Pikachu',
    '065 — Alakazam-ex',
    '2x 145 — Électhor-ex',
    '151 — Mew-ex',
    "160 — Invitation d'Érika",
    '999 — Carte fantôme',
  ].join('\n');
  const requestsBefore = await page.evaluate(() => window.__requests.length);
  await page.evaluate((value) => {
    const input = document.getElementById('cmr-host').shadowRoot.querySelector('input[data-model="searchQ"]');
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.focus();
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, composed: true, cancelable: true }));
  }, pasted);
  const tList = Date.now();
  while (
    !(await page.evaluate(() => {
      const b = document.getElementById('cmr-host').shadowRoot.querySelector('[data-act="bulk-add"]');
      return !!b && !b.disabled;
    }))
  ) {
    if (Date.now() - tList > 30000) throw new Error('liste collée non résolue');
    await sleep(300);
  }
  const bulkRequests = (await page.evaluate(() => window.__requests.slice(0))).slice(requestsBefore);
  console.log(`liste collée : ${(await text('.bulk-head')).replace(/\s+/g, ' ')} — ${bulkRequests.length} pages lues`);
  bulkRequests.forEach((r) => console.log('   ', r));
  await shot('01c-liste-collee');
  await click('[data-act="bulk-add"]');

  const search = async (q) => {
    await page.evaluate((value) => {
      const input = document.getElementById('cmr-host').shadowRoot.querySelector('input[data-model="searchQ"]');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }, q);
    await click('[data-act="search"]');
    try {
      await waitFor('[data-act="add-result"], .result .tag.ok', 20000);
    } catch (e) {
      console.log('ÉCRAN :', await text('.body'));
      console.log('REQUÊTES :', (await page.evaluate(() => window.__requests)).slice(-5));
      throw e;
    }
  };

  // 2. Carte gradée : « + PSA » sur Salamèche (MEW 004)
  await search('Salamèche');
  await shot('01d-recherche');
  await page.evaluate(() => {
    const r = document.getElementById('cmr-host').shadowRoot;
    const row = [...r.querySelectorAll('.result')].find((li) => li.textContent.includes('MEW 004'));
    row.querySelector('[data-mode="graded"]').click();
  });
  await sleep(200);

  // 3. Coffret : catégorie « Coffrets », recherche « 151 »
  await click('[data-act="search-kind"][data-kind="sealed"]');
  await search('151');
  await shot('01e-coffrets');
  await click('[data-act="add-result"][data-i="0"]');
  await click('[data-act="search-kind"][data-kind="singles"]');

  const t0 = Date.now();
  while ((await page.evaluate(() => JSON.parse(JSON.stringify(window.__mem['cmr.list'] || [])).length)) < 9) {
    if (Date.now() - t0 > 20000) throw new Error('liste incomplète');
    await sleep(300);
  }
  await sleep(300);
  await shot('02-liste');

  // 3. Analyse complète
  await click('[data-act="analyse"]');
  await sleep(2500);
  await shot('03-progression');
  await waitFor('.answer', 180000);
  await shot('04-resultats');

  // 3 bis. Panier : une offre du plan est vendue entre-temps, puis « Tout ajouter au panier »
  const soldId = await page.evaluate(() => {
    const settings = CMR.store.mergeSettings(window.__mem['cmr.settings']);
    const r = CMR.analyzer.computeResults(window.__mem['cmr.dataset'], window.__mem['cmr.list'], settings);
    const o = r.solved.plans.cheapest.orders[0];
    return r.detail[o.cards[0].cardId][o.sellerId][0].id;
  });
  if (soldId) await page.evaluate((id) => window.__world.sell(id), soldId);
  await click('.answer [data-act="cart-add"][data-plan="cheapest"]:not([data-seller])');
  await sleep(800);
  await shot('04b-panier-en-cours');
  const tCart = Date.now();
  while (await $('.answer .spinner, .answer .cart-row:empty')) {
    if (Date.now() - tCart > 120000) throw new Error('ajout au panier trop long');
    await sleep(300);
  }
  await sleep(300);
  await shot('04c-panier-fait');
  const cartState = await page.evaluate(() => ({
    rows: [...document.getElementById('cmr-host').shadowRoot.querySelectorAll('.answer .cart-row')].map((e) => e.className + ' | ' + e.textContent.trim()),
    worldCart: [...window.__world.cart.entries()],
  }));
  console.log('panier — article vendu entre-temps :', soldId);
  cartState.rows.forEach((r) => console.log('  ', r));
  console.log('   articles dans le faux panier :', cartState.worldCart.length);

  // 3 ter. Déconnecté : message clair
  console.log('bouton principal après ajout :', await text('.answer-actions'));
  if ((await text('.answer-actions')).includes('Tout ajouter')) throw new Error('« Tout ajouter » encore proposé : risque de doublons');
  await page.evaluate(() => window.__world.setLoggedIn(false));
  await click('[data-act="toggle"][data-key="plan:baseline"]');
  await click('.plan [data-act="cart-add"]');
  const tLogin = Date.now();
  while (!(await $('.plan .cart-row.warn'))) {
    if (Date.now() - tLogin > 30000) throw new Error('pas de message « connecte-toi »');
    await sleep(300);
  }
  console.log('déconnecté :', await text('.plan .cart-row.warn'));
  await click('[data-act="toggle"][data-key="plan:baseline"]');
  await page.evaluate(() => window.__world.setLoggedIn(true));

  // 3 quater. Port réel lu au panier, repères sur la page, prix plafonnés
  console.log('port réel :', (await text('.cart-seen')).trim() || '(non lu)');
  const badges = await page.evaluate(() => [...document.querySelectorAll('[data-cmr-badge]')].map((b) => b.textContent));
  console.log(`repères sur la page : ${badges.length} (${[...new Set(badges)].slice(0, 3).join(' | ')})`);
  if (!badges.length) throw new Error('aucun repère « ton plan » sur la page produit');
  console.log('filtres affichés :', (await text('.answer-filters')).replace(/\s+/g, ' ').trim());
  const premiums = await page.evaluate(() => [...document.getElementById('cmr-host').shadowRoot.querySelectorAll('.answer .order li .tag.warn')].map((t) => t.textContent));
  console.log(`surcoûts affichés dans le plan : ${premiums.join(', ') || 'aucun'}`);
  await click('[data-act="premium-strict"]');
  await sleep(400);
  const strictWarn = await page.evaluate(() => document.getElementById('cmr-host').shadowRoot.querySelectorAll('.answer .order li .tag.warn').length);
  console.log(`« Toujours le moins cher » : ${strictWarn} carte au-dessus du minimum, total ${(await text('.answer-total')).replace(/\s+/g, ' ')}`);
  if (strictWarn) throw new Error('des cartes restent au-dessus du prix minimum');
  await click('[data-act="premium-default"]');
  await sleep(300);

  // 3 quinquies. Annuler une suppression, export CSV, plusieurs listes
  await click('[data-act="tab"][data-tab="list"]');
  const count = () => page.evaluate(() => (window.__mem['cmr.list'] || []).length);
  const cardsBefore = await count();
  await click('[data-act="remove"]');
  await sleep(200);
  await click('.toast [data-act="undo"]');
  await sleep(200);
  console.log(`annuler la suppression : ${cardsBefore} → ${await count()} cartes`);
  if ((await count()) !== cardsBefore) throw new Error('annulation de la suppression ratée');
  await click('[data-act="tab"][data-tab="results"]');
  await click('.answer [data-act="export-csv"]');
  await click('[data-act="tab"][data-tab="list"]');
  await page.evaluate(() => {
    const sel = document.getElementById('cmr-host').shadowRoot.querySelector('select[data-model="listId"]');
    sel.value = '__new';
    sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await sleep(600);
  const lists = await page.evaluate(() => window.__mem['cmr.lists']);
  console.log(`listes : ${lists.items.map((l) => l.name).join(', ')} · active = ${lists.items.find((l) => l.id === lists.active).name} · ${await text('.tab[data-tab="list"] .pill')} carte(s)`);
  await shot('07b-nouvelle-liste');
  await page.evaluate(() => {
    const sel = document.getElementById('cmr-host').shadowRoot.querySelector('select[data-model="listId"]');
    sel.value = 'main';
    sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await sleep(600);
  await click('[data-act="tab"][data-tab="results"]');
  await waitFor('.answer', 5000);
  console.log(`retour sur « Ma liste » : ${await text('.tab[data-tab="list"] .pill')} cartes, résultats conservés`);

  // 3 sexies. Test en un clic « sur le vrai site » (ici le faux) depuis les réglages
  await click('[data-act="settings"]');
  await click('[data-act="self-test"]');
  const tTest = Date.now();
  while (await $('.selftest .st-running')) {
    if (Date.now() - tTest > 60000) throw new Error('test trop long');
    await sleep(300);
  }
  console.log('test en un clic :');
  (await page.evaluate(() => [...document.getElementById('cmr-host').shadowRoot.querySelectorAll('.selftest li')].map((li) => li.className + ' ' + li.textContent.replace(/\s+/g, ' ').trim()))).forEach((l) =>
    console.log('   ', l.slice(0, 200))
  );
  await shot('07c-test-en-un-clic');
  await click('[data-act="back"]');
  await click('[data-act="tab"][data-tab="results"]');

  // 4. Vue large, combinaisons, vendeurs
  await click('[data-act="wide"]');
  await shot('05-resultats-large');
  await page.evaluate(() => {
    const r = document.getElementById('cmr-host').shadowRoot;
    r.querySelector('.body').scrollTop = r.querySelector('.segmented').getBoundingClientRect().top - 120;
  });
  await click('tr.clickable[data-key^="combo:2:"]');
  await shot('06-combinaisons');
  await click('tr.clickable[data-key^="seller:"]');
  await page.evaluate(() => {
    const r = document.getElementById('cmr-host').shadowRoot;
    const row = r.querySelector('tr.clickable[data-key^="seller:"]');
    r.querySelector('.body').scrollTop += row.getBoundingClientRect().top - 160;
  });
  await shot('07-vendeurs');

  // 5. Réglage client instantané : exclure le premier vendeur du plan
  const before = await text('.answer-total');
  const firstSeller = await page.evaluate(() => {
    const r = document.getElementById('cmr-host').shadowRoot;
    return r.querySelector('.answer .order .seller').textContent;
  });
  await page.evaluate((name) => {
    const r = document.getElementById('cmr-host').shadowRoot;
    const btn = document.createElement('button');
    btn.setAttribute('data-act', 'exclude');
    btn.setAttribute('data-name', name);
    r.querySelector('.panel').appendChild(btn);
    btn.click();
  }, firstSeller);
  await sleep(600);
  const after = await text('.answer-total');
  console.log(`exclusion de ${firstSeller} : plan ${before} → ${after}`);

  // 6. Réglages, thème sombre, petite largeur
  await click('[data-act="settings"]');
  await shot('08-reglages');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await click('[data-act="tab"][data-tab="results"]');
  await shot('09-sombre');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await click('[data-act="wide"]');
  await page.setViewport({ width: 420, height: 860 });
  await shot('10-etroit');

  const requests = await page.evaluate(() => window.__requests);
  const summary = await page.evaluate(() => {
    const ds = window.__mem['cmr.dataset'];
    return { cards: Object.keys(ds.cards).length, deep: ds.deep, sellers: Object.keys(ds.sellers).length, stop: ds.stopReason };
  });
  console.log('requêtes :', requests.length, '| détail :', JSON.stringify(summary));
  console.log(requests.slice(0, 6).join('\n'));
  console.log(errors.length ? 'ERREURS :\n' + errors.join('\n') : 'Aucune erreur console.');
  await browser.close();
  server.close();
  if (errors.some((e) => e.startsWith('pageerror'))) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
