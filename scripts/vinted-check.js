/*
 * Parcours de la partie Vinted, avec la vraie extension chargée dans Chrome sans fenêtre, sur un faux Vinted :
 * les requêtes vers https://www.vinted.fr sont interceptées et servies d'ici (aucune requête réelle).
 * Le faux site reprend la structure relevée sur Vinted : vignettes « product-item-id-… », liste qui s'allonge par 20,
 * page « Créer un lot » avec item_ids[] et boutons Ajouter / Supprimer, API du dressing et des frais d'envoi.
 * Usage : node scripts/vinted-check.js [dossier-captures]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tests', 'screenshots'));
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'https://www.vinted.fr';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Faux dressing ----------
const NAMES = ['Carapuce', 'Salamèche', 'Bulbizarre', 'Dracaufeu ex', 'Pikachu', 'Évoli', 'Tokotoro', 'Morpheo Forme Solaire', 'Zébibron', 'Démolosse', 'Mew ex', 'Ronflex', 'Léviator', 'Ectoplasma', 'Lokhlass'];
function dressing(seller, count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const name = NAMES[i % NAMES.length];
    const num = String(1 + ((i * 7) % 190)).padStart(3, '0');
    const price = 1 + ((i * 37) % 900) / 100;
    items.push({
      id: seller * 100000 + i,
      title: i % 11 === 0 ? name : `${name} – ${num}/165`,
      brand: 'Pokémon',
      status: i % 3 ? 'Très bon état' : 'Bon état',
      price: { amount: price.toFixed(2), currency_code: 'EUR' },
      total_item_price: { amount: (price * 1.05 + 0.7).toFixed(2), currency_code: 'EUR' },
      photos: [{ url: `${SITE}/img/${i}.png`, thumbnails: [{ type: 'thumb150x210', url: `${SITE}/img/${i}.png` }] }],
      is_reserved: i === 5,
      is_closed: false,
      user: { id: seller, login: 'pok-test' },
    });
  }
  return items;
}
const SELLERS = { 777: dressing(777, 300), 888: dressing(888, 45) };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8fP9/PQAIHgM0cUoqmAAAAABJRU5ErkJggg==', 'base64');

// Script commun aux fausses pages : vignettes au format Vinted, 20 de plus à chaque arrivée en bas de page.
const PAGE_JS = `
  const euro = (n) => Number(n).toFixed(2).replace('.', ',') + '\\u00a0€';
  const selected = new Set(PRESELECTED);
  const order = ITEMS.filter((it) => selected.has(it.id)).concat(ITEMS.filter((it) => !selected.has(it.id)));
  let shown = 0;
  function card(it) {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'grid-item');
    el.className = 'cell';
    const alt = it.title + ', marque: Pokémon, état: ' + it.status + ', ' + euro(it.price.amount) + ', ' + euro(it.total_item_price.amount) + ' Protection acheteurs incluse';
    el.innerHTML = '<div data-testid="product-item-id-' + it.id + '"><div><img alt="" width="150" height="200" src="/img/' + it.id + '.png"></div>'
      + '<a href="/items/' + it.id + '" data-testid="product-item-id-' + it.id + '--overlay-link"></a>'
      + '<div data-testid="product-item-id-' + it.id + '--summary"><p data-testid="product-item-id-' + it.id + '--description-title">Pokémon</p>'
      + '<p data-testid="product-item-id-' + it.id + '--description-subtitle">' + it.status + '</p>'
      + '<div><div data-testid="product-item-id-' + it.id + '--title-container"><p data-testid="product-item-id-' + it.id + '--price-text">' + euro(it.price.amount) + '</p></div>'
      + '<div data-testid="product-item-id-' + it.id + '--breakdown"><button><span data-testid="total-combined-price">' + euro(it.total_item_price.amount) + '</span> incl.</button></div></div></div>'
      + (BUNDLE ? '<div data-testid="product-item-id-' + it.id + '--footer"></div>' : '') + '</div>';
    el.querySelector('img').alt = alt;
    el.querySelector('a').title = alt;
    if (BUNDLE) button(el.querySelector('[data-testid$="--footer"]'), it);
    return el;
  }
  function button(slot, it) {
    const on = selected.has(it.id);
    slot.innerHTML = '<button data-testid="' + (on ? 'remove' : 'add') + '-button">' + (on ? 'Supprimer' : 'Ajouter') + '</button>';
    slot.firstChild.onclick = () => { if (on) selected.delete(it.id); else selected.add(it.id); button(slot, it); footer(); };
  }
  function footer() {
    const sum = ITEMS.filter((it) => selected.has(it.id)).reduce((a, it) => a + Number(it.price.amount), 0);
    document.querySelector('[data-testid="bundle-footer-full-price"]').textContent = euro(sum);
  }
  function more() {
    const grid = document.querySelector('.feed-grid');
    for (const it of order.slice(shown, shown + 20)) grid.appendChild(card(it));
    shown = Math.min(order.length, shown + 20);
  }
  more();
  if (BUNDLE) footer();
  new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < order.length) more(); }).observe(document.querySelector('[data-testid="infinite-scroll"]'));
`;
const CSS = 'body{font-family:sans-serif;margin:0;padding:16px 440px 90px 16px}.feed-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}img{width:100%;height:150px;background:#dde}a{display:none}p{margin:2px 0}.foot{position:fixed;left:0;right:0;bottom:0;padding:14px;background:#fff;border-top:1px solid #ccc;display:flex;justify-content:space-between}';

// Fausse messagerie : même parcours que Vinted (conversation → détails → « Supprimer la conversation » → confirmation).
// La conversation 103 n'a pas d'action « Supprimer » (commande en cours) ; la ligne « promo » n'est pas une conversation.
const INBOX_JS = `
  const $ = (s) => document.querySelector(s);
  const pane = $('#pane');
  let current = null;
  function row(id) {
    const c = document.createElement('div');
    c.setAttribute('data-testid', 'inbox-list-item-' + id + '-container');
    c.innerHTML = '<div role="button" data-testid="inbox-list-item-' + id + '" style="padding:14px;border-bottom:1px solid #ddd">Conversation ' + id + '</div>';
    c.firstChild.onclick = () => { current = id; history.pushState({}, '', '/inbox/' + id); window.opened = (window.opened || 0) + 1;
      pane.innerHTML = '<div data-testid="conversation-header"><button data-testid="details-button">i</button></div>';
      $('[data-testid="details-button"]').onclick = details; };
    return c;
  }
  function details() {
    history.pushState({}, '', '/inbox/' + current + '/details');
    pane.innerHTML = current === '103' ? '<div data-testid="conversation-actions-block">Bloquer</div>'
      : '<div role="button" data-testid="conversation-actions-delete">Supprimer la conversation</div>';
    const del = $('[data-testid="conversation-actions-delete"]');
    if (del) del.onclick = () => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.innerHTML = '<button data-testid="confirm-delete-conversation">Oui, supprimer</button><button>Non, annuler</button>';
      document.body.appendChild(d);
      d.firstChild.onclick = () => { $('[data-testid="inbox-list-item-' + current + '-container"]').remove(); d.remove(); pane.innerHTML = ''; history.pushState({}, '', '/inbox'); window.deleted = (window.deleted || []).concat(current); };
    };
  }
  const list = $('#list');
  const promo = row('UHJvbW8=');
  list.appendChild(promo);
  for (const id of ['101', '102', '103', '104', '105']) list.appendChild(row(id));
`;

function fakePage(url) {
  if (url.pathname === '/') {
    const cards = SELLERS[777].slice(0, 12).map((it) => {
      const alt = `${it.title}, marque: Pokémon, état: ${it.status}, ${it.price.amount} €, ${it.total_item_price.amount} € Protection acheteurs incluse`;
      const total = it.total_item_price.amount.replace('.', ',');
      return `<div data-testid="grid-item" class="cell"><div data-testid="feed-item"><div data-testid="feed-item--image"><img alt="${alt}" width="150" height="200" src="/img/${it.id}.png"></div>
        <a href="/items/${it.id}-carte?homepage_session_id=abc" data-testid="feed-item--overlay-link" title="${alt}"></a>
        <div data-testid="feed-item--summary"><p data-testid="feed-item--description-subtitle">${it.status}</p>
        <div><div data-testid="feed-item--title-container"><p data-testid="feed-item--price-text">${it.price.amount.replace('.', ',')} €</p></div>
        <div data-testid="feed-item--breakdown"><span data-testid="total-combined-price">${total} €</span> incl.</div></div></div></div></div>`;
    });
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Faux Vinted</title><style>${CSS}</style></head><body><h1>Accueil</h1><div class="feed-grid">${cards.join('')}</div></body></html>`;
  }
  if (/^\/inbox(\/|$)/.test(url.pathname)) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Messages</title></head><body style="font-family:sans-serif;display:flex;gap:24px">
      <div style="width:360px"><h2>Messages</h2><div id="list"></div></div><div id="pane"></div><script>${INBOX_JS}</script></body></html>`;
  }
  const m = url.pathname.match(/^\/member\/(\d+)(\/bundles\/new)?$/);
  if (m && SELLERS[m[1]]) {
    const bundle = !!m[2];
    const pre = url.searchParams.getAll('item_ids[]').map(Number);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Faux Vinted</title><style>${CSS}</style></head><body>
      ${bundle ? '<h1 data-testid="bundle-header-title">Crée ton lot !</h1>' : '<h1 data-testid="profile-username">pok-test</h1>'}
      <div class="feed-grid"></div><div data-testid="infinite-scroll" style="height:1px"></div>
      ${bundle ? '<div class="foot"><b data-testid="bundle-footer-full-price"></b><button data-testid="bundle-footer-action-button">Voir le lot</button></div>' : ''}
      <script>const ITEMS=${JSON.stringify(SELLERS[m[1]])};const BUNDLE=${bundle};const PRESELECTED=${JSON.stringify(pre)};${PAGE_JS}</script></body></html>`;
  }
  if (/^\/items\/\d+/.test(url.pathname)) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Annonce</title></head><body>
      <div data-testid="item-sidebar-price-container"><p data-testid="item-price">4,99 €</p><span data-testid="total-combined-price">5,94 €</span></div>
      <div data-testid="item-shipping-banner"><h3>Envoi</h3><span data-testid="item-shipping-banner-price">à partir de 4,35 €</span></div></body></html>`;
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'regroupeur-vinted-'));
  for (const f of ['manifest.json', 'background.js', 'src', 'icons']) fs.cpSync(path.join(ROOT, f), path.join(ext, f), { recursive: true });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, args: ['--no-first-run'] });
  let failed = 0;
  const ok = (cond, msg) => {
    console.log((cond ? '  OK    ' : '  ÉCHEC ') + msg);
    if (!cond) failed++;
  };
  try {
    await browser.installExtension(ext);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    // Les refus 403 simulés et l'icône absente du faux site ne sont pas des erreurs de l'extension.
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
    const hits = { wardrobe: 0, shipping: 0, blocked: false };
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.origin !== SITE) return req.abort();
      let m;
      if ((m = url.pathname.match(/^\/api\/v2\/wardrobe\/(\d+)\/items$/))) {
        hits.wardrobe++;
        if (m[1] === '888' || hits.blocked) return req.respond({ status: 403, contentType: 'application/json', body: '{}' });
        const all = SELLERS[m[1]] || [];
        const per = Number(url.searchParams.get('per_page'));
        const pg = Number(url.searchParams.get('page'));
        const body = { items: all.slice((pg - 1) * per, pg * per), pagination: { current_page: pg, per_page: per, total_entries: all.length, total_pages: Math.ceil(all.length / per) } };
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (/^\/api\/v2\/items\/\d+\/shipping_details$/.test(url.pathname)) {
        hits.shipping++;
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ shipping_details: { pickup_only: false, free_shipping: false, price: { amount: 2.83, currency_code: 'EUR' } } }) });
      }
      if (url.pathname.startsWith('/img/')) return req.respond({ status: 200, contentType: 'image/png', body: PNG });
      const html = fakePage(url);
      return html ? req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : req.respond({ status: 404, body: '' });
    });

    const inPanel = (fn, arg) => page.evaluate(`(${fn})(document.getElementById('cmrv-host').shadowRoot, ${JSON.stringify(arg === undefined ? null : arg)})`);
    const click = (sel) =>
      inPanel((sh, s) => {
        const el = sh.querySelector(s);
        if (el) el.click();
        return !!el;
      }, sel);
    const type = async (sel, value) => {
      await inPanel(
        (sh, a) => {
          const el = sh.querySelector(a.sel);
          el.value = a.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        { sel, value }
      );
      await sleep(350);
    };
    const text = (sel) => inPanel((sh, s) => (sh.querySelector(s) || {}).textContent || '', sel);
    const rows = () => inPanel((sh) => [...sh.querySelectorAll('#results .it')].map((r) => ({ id: r.querySelector('[data-act="lot"]').dataset.id, title: r.querySelector('.t').textContent, btn: r.querySelector('[data-act="lot"]').textContent })));
    const waitFor = async (fn, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await fn().catch(() => false)) return true;
        await sleep(200);
      }
      return false;
    };
    const hostReady = () => waitFor(() => page.evaluate(() => !!document.getElementById('cmrv-host')));
    const shot = (name) => page.screenshot({ path: path.join(OUT, `vinted-${name}.png`) }).then(() => console.log('  capture vinted-' + name));

    console.log('1. Dressing : nom et prix avec envoi sous les annonces');
    await page.goto(`${SITE}/member/777`);
    ok(await hostReady(), 'extension active sur la page');
    ok(await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-label]').length >= 20 && [...document.querySelectorAll('[data-cmrv-label]')].every((l) => /avec envoi/.test(l.textContent)))), 'les 20 annonces affichées ont leur ligne « avec envoi »');
    const first = await page.evaluate(() => document.querySelector('[data-cmrv-label]').innerText);
    ok(/4,58\s€ avec envoi/.test(first) && /Carapuce/.test(first), `première annonce : ${first.replace(/\n/g, ' | ')}`); // 1,00 € → 1,75 € incl. + 2,83 € d'envoi
    ok(hits.shipping === 3 && hits.wardrobe === 0, `3 lectures de frais d’envoi pour tout le dressing, aucune lecture du dressing avant ouverture (${hits.shipping}, ${hits.wardrobe})`);

    console.log('2. Recherche dans le dressing');
    ok((await text('.launch')).includes('Chercher dans ce dressing'), 'bouton « Chercher dans ce dressing »');
    await click('.launch');
    ok(await waitFor(async () => /^300 articles/.test(await text('#status'))), `dressing lu : ${await text('#status')} en ${hits.wardrobe} requêtes`);
    ok(hits.wardrobe === 4, '4 requêtes pour 300 articles');
    ok((await text('#who')).includes('pok-test'), 'nom du vendeur affiché');
    await type('#q', 'dracaufeu');
    let r = await rows();
    ok(r.length === 20 && r.every((x) => /Dracaufeu/.test(x.title)), `« dracaufeu » : ${r.length} annonces`);
    const far = SELLERS[777][248]; // 249ᵉ annonce : il faudrait descendre 12 fois dans la page pour l'atteindre
    await type('#q', 'zebibron 27');
    r = await rows();
    ok(r.length === 1 && r[0].title === far.title, `« zebibron 27 » : ${r.map((x) => x.title).join(', ')}`);
    const deep = r[0].id;
    ok(deep === String(far.id) && !(await page.evaluate((id) => !!document.querySelector(`[data-testid="product-item-id-${id}"]`), deep)), 'annonce n° 249 du dressing, pas encore affichée dans la page');
    await click(`[data-act="lot"][data-id="${deep}"]`);
    await type('#q', 'tokotoro');
    r = await rows();
    await click(`[data-act="lot"][data-id="${r[0].id}"]`);
    const second = r[0].id;
    ok(/Lot : 2 articles/.test(await text('#lot')), `lot : ${(await text('#lot .sum')).trim()}`);
    ok(/avec protection acheteurs et envoi \(à partir de 2,83/.test(await text('#lot .est')), `estimation : ${(await text('#lot .est')).trim()}`);
    await shot('recherche');

    console.log('3. Liste collée');
    await click('[data-act="mode"][data-mode="list"]');
    await type('#ql', '065 Tokotoro\nMew ex\nHoundoom (SFA 066)');
    const groups = await inPanel((sh) => [...sh.querySelectorAll('#results .grp')].map((g) => g.textContent));
    ok(groups.length === 4 && /2 sur 3/.test(groups[0]) && /introuvable/.test(groups[3]), `groupes : ${groups.join(' | ')}`);
    await shot('liste');
    await click('[data-act="mode"][data-mode="one"]');

    console.log('4. « Créer le lot » : la page Vinted s’ouvre déjà remplie');
    await Promise.all([page.waitForNavigation(), click('[data-act="apply"]')]);
    ok(page.url() === `${SITE}/member/777/bundles/new?item_ids[]=${deep}&item_ids[]=${second}`, page.url().replace(SITE, ''));
    await hostReady();
    const removes = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="remove-button"]')].length);
    ok((await removes()) === 2, 'les 2 articles sont dans le lot de Vinted');
    ok(await waitFor(async () => /Lot : 2 articles/.test(await text('#lot'))), `panneau rouvert, ${(await text('#lot .sum')).trim()}`);
    ok(!(await inPanel((sh) => !!sh.querySelector('[data-act="apply"]'))), 'rien en attente');
    ok(hits.wardrobe === 4, 'dressing relu depuis la mémoire (aucune nouvelle requête)');

    console.log('5. Sur la page du lot : ajouter une annonce loin dans la liste');
    await type('#q', 'ectoplasma 082');
    r = await rows();
    ok(r.length === 1 && r[0].btn === '+ Lot' && r[0].id === String(SELLERS[777][283].id), `« ectoplasma 082 » : ${r.map((x) => x.title).join(', ')}`);
    const third = r[0].id;
    await click(`[data-act="lot"][data-id="${third}"]`);
    ok(/1 à ajouter/.test(await text('#lot')) && /Ajouter au lot \(1\)/.test(await text('[data-act="apply"]')), (await text('#lot .sum')).trim());
    await Promise.all([page.waitForNavigation(), click('[data-act="apply"]')]);
    await hostReady();
    ok((await removes()) === 3 && page.url().includes(`item_ids[]=${third}`), '3 articles dans le lot après « Ajouter au lot »');

    console.log('6. Annonce déjà affichée : le bouton « Ajouter » de Vinted est utilisé directement');
    await waitFor(async () => /^300 articles/.test(await text('#status')));
    const visibleId = await page.evaluate(() => document.querySelector('[data-testid="add-button"]').closest('[data-testid="grid-item"]').querySelector('[data-testid^="product-item-id-"]').getAttribute('data-testid').split('-').pop());
    await type('#q', '');
    await click(`[data-act="lot"][data-id="${visibleId}"]`);
    ok(await waitFor(async () => (await removes()) === 4), '4 articles dans le lot, sans rechargement');
    ok(await waitFor(async () => /Lot : 4 articles/.test(await text('#lot'))), (await text('#lot .sum')).trim());
    await click(`[data-act="lot"][data-id="${visibleId}"]`);
    ok(await waitFor(async () => (await removes()) === 3), 'retiré du lot par le même bouton');
    await page.evaluate(() => document.querySelector('[data-testid="remove-button"]').click());
    ok(await waitFor(async () => /Lot : 2 articles/.test(await text('#lot'))), 'un retrait fait avec le bouton de Vinted est suivi par le panneau');
    await shot('lot');

    console.log('7. « Voir » : fait défiler jusqu’à l’annonce affichée');
    await page.evaluate(() => window.scrollTo(0, 0));
    const lastShown = await page.evaluate(() => [...document.querySelectorAll('[data-testid="grid-item"] [data-testid^="product-item-id-"]')].map((e) => e.getAttribute('data-testid')).filter((t) => /-\d+$/.test(t)).pop().split('-').pop());
    await inPanel((sh, id) => {
      const b = document.createElement('button');
      b.dataset.act = 'see';
      b.dataset.id = id;
      sh.querySelector('#results').appendChild(b);
      b.click();
    }, lastShown);
    ok(await waitFor(() => page.evaluate(() => window.scrollY > 100)), 'la page a défilé jusqu’à l’annonce');

    console.log('8. Vinted refuse la lecture du dressing : recherche sur les annonces affichées');
    await page.goto(`${SITE}/member/888`);
    await hostReady();
    ok(await waitFor(async () => /refusé la lecture/.test(await text('#note'))), 'message clair');
    ok(await waitFor(async () => /^20 articles lus/.test(await text('#status'))), await text('#status'));
    await type('#q', 'pikachu');
    ok((await rows()).length > 0, 'la recherche fonctionne sur les annonces affichées');

    console.log('9. Page d’une annonce : total avec envoi');
    await page.goto(`${SITE}/items/77700012-carte`);
    ok(await waitFor(() => page.evaluate(() => !!document.querySelector('[data-cmrv-total]'))), 'ligne ajoutée sous le prix');
    const total = await page.evaluate(() => document.querySelector('[data-cmrv-total]').textContent);
    ok(/10,29\s€ avec envoi \(à partir de 4,35\s€\)/.test(total), total);

    console.log('10. Page d’accueil : prix avec envoi sur les annonces du fil');
    const before = hits.shipping;
    await page.goto(`${SITE}/`);
    await hostReady();
    ok(await waitFor(() => page.evaluate(() => [...document.querySelectorAll('[data-cmrv-label]')].filter((l) => /avec envoi/.test(l.textContent)).length >= 10), 12000), 'les annonces visibles ont leur ligne « avec envoi »');
    const home = await page.evaluate(() => document.querySelector('[data-cmrv-label]').innerText);
    ok(/4,58\s€ avec envoi/.test(home) && /Carapuce/.test(home), `première annonce : ${home.replace(/\n/g, ' | ')}`);
    ok(hits.shipping - before <= 12, `${hits.shipping - before} lectures pour ${await page.evaluate(() => document.querySelectorAll('[data-testid="feed-item"]').length)} annonces`);

    console.log('11. Barre de recherche intégrée à la page du dressing');
    await page.goto(`${SITE}/member/777`);
    await hostReady();
    ok(await waitFor(() => page.evaluate(() => {
      const bar = document.querySelector('[data-cmrv-bar]');
      return !!bar && bar.nextElementSibling === document.querySelector('.feed-grid');
    })), 'barre « Chercher une carte dans ce dressing… » juste au-dessus des annonces');
    await inPanel((sh) => sh.querySelector('.panel').hidden || sh.querySelector('[data-act="toggle"].x').click());
    await page.evaluate(() => document.querySelector('[data-cmrv-bar]').click());
    ok(await waitFor(() => inPanel((sh) => !sh.querySelector('.panel').hidden)), 'un clic ouvre la recherche');
    await shot('barre');

    console.log('12. Messagerie : supprimer une conversation');
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    const dels = () => page.evaluate(() => [...document.querySelectorAll('[data-cmrv-act="del"]')].map((b) => b.dataset.id + ':' + b.textContent));
    ok(await waitFor(async () => (await dels()).length === 5), `un bouton par conversation, aucun sur le message promotionnel : ${(await dels()).join(' ')}`);
    const ibar = () => page.evaluate(() => (document.querySelector('[data-cmrv-ibar]') || {}).innerText || '');
    const press = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
    await press('[data-cmrv-act="del"][data-id="102"]');
    await sleep(300);
    ok((await dels()).includes('102:Supprimer ?') && (await page.evaluate(() => location.pathname + '|' + (window.opened || 0) + '|' + (window.deleted || []).length)) === '/inbox|0|0', 'premier clic : demande de confirmation, rien n’est ouvert ni supprimé');
    await press('[data-cmrv-act="del"][data-id="102"]');
    ok(await waitFor(() => page.evaluate(() => (window.deleted || []).join() === '102')), 'second clic : la conversation 102 est supprimée par le parcours de Vinted');
    ok(await waitFor(async () => /1 conversation supprimée/.test(await ibar())), (await ibar()).replace(/\n/g, ' | '));

    console.log('13. Messagerie : supprimer plusieurs conversations');
    await press('[data-cmrv-act="select"]');
    await press('[data-cmrv-act="del"][data-id="101"]');
    await press('[data-cmrv-act="del"][data-id="103"]');
    await press('[data-cmrv-act="del"][data-id="104"]');
    await sleep(300);
    ok(/3 cochées/.test(await ibar()) && /Supprimer \(3\)/.test(await ibar()), (await ibar()).replace(/\n/g, ' | '));
    await press('[data-cmrv-act="delsel"]');
    await sleep(300);
    ok(/Confirmer : supprimer 3 conversations/.test(await ibar()) && (await page.evaluate(() => (window.deleted || []).length)) === 1, 'une confirmation est demandée avant toute suppression');
    await shot('messages');
    await press('[data-cmrv-act="delsel"]');
    ok(await waitFor(async () => /2 conversations supprimées · 1 non supprimée/.test(await ibar()), 40000), (await ibar()).replace(/\n/g, ' | '));
    ok((await page.evaluate(() => (window.deleted || []).join())) === '102,101,104', 'supprimées : 101 et 104 ; la 103 (sans action « Supprimer ») est laissée');
    ok((await page.evaluate(() => !!document.querySelector('[data-testid="inbox-list-item-105"]') && !!document.querySelector('[data-testid="inbox-list-item-UHJvbW8="]'))), 'les conversations non cochées sont intactes');

    console.log('14. Réglages');
    await page.goto(`${SITE}/member/777`);
    await hostReady();
    await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-label]').length >= 20));
    await inPanel((sh) => {
      for (const id of ['#opt-shipping', '#opt-titles']) {
        sh.querySelector(id).checked = false;
        sh.querySelector(id).dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    ok(await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-label]').length === 0)), 'affichages retirés quand les deux options sont décochées');
    ok(hits.shipping <= 22, `${hits.shipping} lectures de frais d’envoi sur tout le parcours`);

    console.log('15. Clic sur l’icône hors Cardmarket et Vinted : page d’explication');
    const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 10000 })).worker();
    const info = await sw.evaluate(() => ({ name: chrome.runtime.getManifest().name, url: chrome.runtime.getURL('src/accueil.html') }));
    ok(info.name === 'Regroupeur — Cardmarket & Vinted', `nom de l’extension : ${info.name}`);
    const welcome = await browser.newPage();
    await welcome.goto(info.url);
    const seen = await welcome.evaluate(() => ({ h1: document.querySelector('h1').textContent, sites: [...document.querySelectorAll('h2')].map((h) => h.textContent), links: [...document.querySelectorAll('a.go')].map((a) => a.href), icon: document.querySelector('header img').naturalWidth }));
    ok(seen.sites.join() === 'Sur Cardmarket,Sur Vinted' && seen.links.length === 2 && seen.icon > 0, `« ${seen.h1} » : ${seen.sites.join(' / ')}`);
    await welcome.setViewport({ width: 1100, height: 760 });
    await welcome.screenshot({ path: path.join(OUT, 'accueil.png') });
    await welcome.close();

    ok(errors.length === 0, errors.length ? errors.join('\n') : 'aucune erreur dans la console');
  } finally {
    await browser.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} échec(s).` : '\nTout est bon.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
