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
const CM_SITE = 'https://www.cardmarket.com';
const C = require(path.join(ROOT, 'src', 'compare.js'));
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
  function render() { document.querySelector('[data-testid="header-conversations-button"]').textContent = 'Messages ' + (unreadObs.data || 0); }
  mount(document.querySelector('.feed-grid'), [unreadObs]);
  unreadObs.refetch();
  more();
  if (BUNDLE) footer();
  new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < order.length) more(); }).observe(document.querySelector('[data-testid="infinite-scroll"]'));
`;
const CSS = 'body{font-family:sans-serif;margin:0;padding:16px 440px 90px 16px}.feed-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}img{width:100%;height:150px;background:#dde}a{display:none}p{margin:2px 0}.foot{position:fixed;left:0;right:0;bottom:0;padding:14px;background:#fff;border-top:1px solid #ccc;display:flex;justify-content:space-between}';

// Fausse messagerie, côté « serveur » : conversations, messages et compteur de non-lus, que le test fait évoluer.
// 103 : suppression interdite par Vinted (is_deletion_restricted) ; 106 : pas d'action « Supprimer » sans que la liste
// le dise. Lire une conversation la marque comme lue, comme sur Vinted.
function freshInbox() {
  const conv = (id, login, extra) =>
    Object.assign({ id, description: `Dernier message de ${login}`, unread: false, updated_at: '2026-10-04T10:00:00+02:00', is_deletion_restricted: false, opposite_user: { id: id + 1000, login } }, extra);
  return {
    block: false, // 403 sur le compteur
    fail: false, // panne réseau sur le compteur et la tête de liste
    headGone: false, // la lecture « tête de liste » n'existe plus (404)
    convs: [conv(101, 'alice'), conv(102, 'bob'), conv(103, 'chloe', { is_deletion_restricted: true }), conv(104, 'david'), conv(105, 'emma'), conv(106, 'farid')],
    messages: {},
  };
}
let BOX = freshInbox();
const thread = (id) => (BOX.messages[id] = BOX.messages[id] || ['Bonjour', 'Toujours disponible ?']);
function receive(id, text) {
  const c = BOX.convs.find((x) => x.id === id);
  Object.assign(c, { unread: true, description: text, updated_at: new Date().toISOString() });
  thread(id).push(text);
  BOX.convs = [c, ...BOX.convs.filter((x) => x !== c)];
}
// Message envoyé par l'utilisateur lui-même depuis un autre appareil : rien ne devient « non lu ».
function sendFromPhone(id, text) {
  const c = BOX.convs.find((x) => x.id === id);
  Object.assign(c, { description: text, updated_at: new Date().toISOString() });
  thread(id).push(text);
  BOX.convs = [c, ...BOX.convs.filter((x) => x !== c)];
}

// Fausse messagerie, côté page : même parcours que Vinted (conversation → détails → « Supprimer la conversation » →
// confirmation) et mêmes données servies par de faux « observateurs » TanStack Query, rangés comme les garde React
// (élément → fibre → hooks), pour exercer le relais src/vinted-page.js. La ligne « promo » n'est pas une conversation.
const QUERY_JS = `
  window.refetches = [];
  const api = async (u, opt) => { const r = await fetch(u, opt); if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; } return r.json(); };
  const mk = (key, fn, enabled) => {
    // Comme sur Vinted : les données brutes sont dans l'état de la requête, le composant en reçoit une version transformée.
    const o = { options: { queryKey: key, queryHash: JSON.stringify(key), enabled: enabled !== false }, data: undefined, at: 0, count: 0, select: null,
      getCurrentQuery: () => ({ state: { dataUpdateCount: o.count, fetchStatus: 'idle', fetchMeta: null, data: o.data } }),
      getCurrentResult: () => ({ data: o.select && o.data ? o.select(o.data) : o.data, dataUpdatedAt: o.at, isError: false, status: o.count ? 'success' : 'pending' }),
      refetch: async () => {
        window.refetches.push(key[0]);
        try { o.data = await fn(); o.at = Date.now(); o.count++; render(); return { data: o.data, dataUpdatedAt: o.at, isError: false, status: 'success' }; }
        catch (e) { return { data: o.data, dataUpdatedAt: o.at, isError: true, status: 'error', error: { status: e.status || 0 } }; }
      } };
    return o;
  };
  const fiber = { memoizedState: null, child: null, sibling: null, return: null };
  const hostRoot = { memoizedState: null, child: fiber, sibling: null, return: null, stateNode: null };
  hostRoot.stateNode = { current: hostRoot };
  fiber.return = hostRoot;
  const mount = (el, list) => { el['__reactFiber$faux'] = fiber; fiber.memoizedState = list.reduceRight((next, memoizedState) => ({ memoizedState, next }), null); };
  const unreadObs = mk(['legacy-unread-message-count'], async () => (await api('/api/v2/conversations/stats')).unread_msg_count);
  // Pour les tests : fait passer la dernière lecture de Vinted pour ancienne.
  window.ageCache = () => { unreadObs.at -= 70000; };
`;

const INBOX_JS = `
  const $ = (s) => document.querySelector(s);
  const pane = $('#pane'), list = $('#list');
  let current = null;
  const listObs = mk(['legacy-inbox-conversations'], async () => ({ pages: [await api('/api/v2/inbox?page=1&per_page=5')] }));
  listObs.select = (d) => ({ conversations: d.pages.flatMap((p) => p.conversations) });
  const offObs = mk(['inbox-conversations', { isVespaEnabled: false }], async () => ({ pages: [] }), false);
  let convObs = null;
  const setHooks = () => mount(list, [unreadObs, listObs, offObs].concat(convObs ? [[convObs, 0]] : []));
  setHooks();
  function openConversation(id) {
    current = id; history.pushState({}, '', '/inbox/' + id); window.opened = (window.opened || 0) + 1;
    convObs = mk(['legacy-conversation', id], async () => (await api('/api/v2/conversations/' + id)).conversation);
    setHooks();
    pane.innerHTML = '<div data-testid="conversation-header"><button data-testid="details-button">i</button></div>'
      + '<div data-testid="conversation-content" style="height:120px;width:300px;overflow-y:auto;border:1px solid #ccc"></div><textarea data-testid="composer--input"></textarea>';
    $('[data-testid="details-button"]').onclick = details;
    convObs.refetch();
  }
  function row(id) {
    const c = document.createElement('div');
    c.setAttribute('data-testid', 'inbox-list-item-' + id + '-container');
    c.innerHTML = '<div role="button" data-testid="inbox-list-item-' + id + '" style="padding:14px;border-bottom:1px solid #ddd"><span></span></div>';
    c.firstChild.onclick = () => openConversation(String(id));
    return c;
  }
  function render() {
    $('[data-testid="header-conversations-button"]').textContent = 'Messages ' + (unreadObs.data || 0);
    const convs = (listObs.data && listObs.data.pages[0].conversations) || [];
    for (const el of [...list.querySelectorAll('[data-testid$="-container"]')]) {
      const id = el.getAttribute('data-testid').slice(16, -10);
      if (id !== 'UHJvbW8=' && !convs.some((c) => String(c.id) === id)) el.remove();
    }
    for (const c of convs) {
      const el = $('[data-testid="inbox-list-item-' + c.id + '-container"]') || row(c.id);
      list.appendChild(el);
      el.querySelector('span').textContent = (c.unread ? '● ' : '') + c.opposite_user.login + ' — ' + c.description;
    }
    const box = $('[data-testid="conversation-content"]');
    const msgs = (box && convObs && convObs.data && convObs.data.messages) || [];
    while (box && box.children.length < msgs.length) {
      const m = document.createElement('p');
      m.setAttribute('data-testid', 'conversation-message');
      m.style.cssText = 'margin:0;padding:30px 8px';
      m.textContent = msgs[box.children.length];
      box.appendChild(m);
    }
  }
  function details() {
    history.pushState({}, '', '/inbox/' + current + '/details');
    pane.innerHTML = current === '103' || current === '106' ? '<div data-testid="conversation-actions-block">Bloquer</div>'
      : '<div role="button" data-testid="conversation-actions-delete">Supprimer la conversation</div>';
    const del = $('[data-testid="conversation-actions-delete"]');
    if (del) del.onclick = () => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.innerHTML = '<button data-testid="confirm-delete-conversation">Oui, supprimer</button><button>Non, annuler</button>';
      document.body.appendChild(d);
      d.firstChild.onclick = async () => {
        const id = current;
        d.remove(); pane.innerHTML = ''; history.pushState({}, '', '/inbox');
        await api('/api/v2/conversations/' + id, { method: 'DELETE' });
        window.deleted = (window.deleted || []).concat(id);
        await listObs.refetch();
      };
    };
  }
  const promo = row('UHJvbW8=');
  promo.querySelector('span').textContent = 'Vinted — message promotionnel';
  list.appendChild(promo);
  unreadObs.refetch();
  listObs.refetch();
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
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Faux Vinted</title><style>${CSS}</style></head><body><h1>Accueil</h1><div class="feed-grid">${cards.join('')}</div>
      <script>(() => { const f = { memoizedState: null, child: null, sibling: null, return: null }; const r = { memoizedState: null, child: f, sibling: null, return: null, stateNode: null }; r.stateNode = { current: r }; f.return = r; document.querySelector('.feed-grid')['__reactFiber$faux'] = f; })();</script></body></html>`;
  }
  if (/^\/inbox(\/|$)/.test(url.pathname)) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Messages</title></head><body style="font-family:sans-serif;display:flex;gap:24px">
      <a href="/inbox" data-testid="header-conversations-button">Messages 0</a>
      <div style="width:360px"><h2>Messages</h2><div id="list"></div></div><div id="pane"></div><script>${QUERY_JS}${INBOX_JS}</script></body></html>`;
  }
  const m = url.pathname.match(/^\/member\/(\d+)(\/bundles\/new)?$/);
  if (m && SELLERS[m[1]]) {
    const bundle = !!m[2];
    const pre = url.searchParams.getAll('item_ids[]').map(Number);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Faux Vinted</title><style>${CSS}</style></head><body>
      ${bundle ? '<h1 data-testid="bundle-header-title">Crée ton lot !</h1>' : '<h1 data-testid="profile-username">pok-test</h1>'}
      <div class="feed-grid"></div><div data-testid="infinite-scroll" style="height:1px"></div>
      ${bundle ? '<div class="foot"><b data-testid="bundle-footer-full-price"></b><button data-testid="bundle-footer-action-button">Voir le lot</button></div>' : ''}
      <a href="/inbox" data-testid="header-conversations-button" style="display:block;position:absolute;top:0;right:460px">Messages 0</a>
      <script>const ITEMS=${JSON.stringify(SELLERS[m[1]])};const BUNDLE=${bundle};const PRESELECTED=${JSON.stringify(pre)};${QUERY_JS}${PAGE_JS}</script></body></html>`;
  }
  if (/^\/items\/\d+/.test(url.pathname)) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Annonce</title></head><body>
      <header><a href="/member/4242">Mon profil</a></header>
      <div data-testid="item-page-summary-plugin"><h1>Gribouraigne – 297/190</h1><p>Très bon état·Pokémon·Ajouté il y a 3 minutes</p></div>
      <div data-testid="item-sidebar-price-container"><p data-testid="item-price">4,99 €</p><span data-testid="total-combined-price">5,94 €</span></div>
      <div data-testid="item-attributes-status"><div>État</div><div itemprop="status"><span>Très bon état<button aria-label="Condition information"></button></span></div></div>
      <div itemprop="description">KEITOCARDS | Gribouraigne – 297/190\n\n🇯🇵 Carte Japonaise\n✨ État : Voir photos (Recto/Verso)</div>
      <div data-testid="item-shipping-banner"><h3>Envoi</h3><span data-testid="item-shipping-banner-price">à partir de 4,35 €</span></div>
      <a href="/member/777">pok-test</a></body></html>`;
  }
  return null;
}

// ---------- Faux Cardmarket : recherche (mode liste) et fiches, au format que lisent les parseurs de src/cm.js ----------
// La recherche « nom + numéro » de Gribouraigne ne trouve rien (comme si Cardmarket ignorait les numéros) : la
// recherche suivante, par nom seul, doit prendre le relais.
const CM_ROWS = {
  Gribouraigne: [
    ['Gribouraigne (SVI 001)', 'Ecarlate-et-Violet/Gribouraigne-SVI001', '001'],
    ['Gribouraigne (sv4a 297)', 'Shiny-Treasure-ex/Gribouraigne-sv4a297', '297'],
    ['Gribouraigne (PAF 003)', 'Destinees-de-Paldea/Gribouraigne-PAF003', '003'],
  ],
  'Dracaufeu 006': [['Dracaufeu-ex (sv2a 006)', 'Pokemon-Card-151/Dracaufeu-ex-sv2a006', '006']],
  // Carte japonaise connue de Cardmarket sous son nom anglais seulement : le nom français ne trouve que la carte
  // d'une autre extension, dont l'adresse donne le nom anglais (Coalossal).
  Monthracite: [['Monthracite (PAF 148)', 'Paldean-Fates/Coalossal-V1-PAF148', '148']],
  'Coalossal 268': [['Coalossal (sv4a 268)', 'Shiny-Treasure-ex/Coalossal-sv4a268', '268']],
  // Un seul résultat : Cardmarket ouvre la fiche à la place de la liste (redirection).
  'Morpheo Forme Solaire': { redirect: 'Scarlet-Violet/Castform-Sunny-Form-SVI198' },
  'Castform Sunny Form 067': [['Castform Sunny Form (sv6a 067)', 'Night-Wanderer/Castform-Sunny-Form-sv6a067', '067']],
  'Pikachu 999': { redirect: '151/Pikachu-MEW025' },
  Pikachu: { redirect: '151/Pikachu-MEW025' },
  'Pikachu de Sacha': [
    ['Pikachu de Sacha (SMP 108)', 'SM-Promos/Ashs-Pikachu-SMP108', '108'],
    ['Pikachu de Sacha (SMP 109)', 'SM-Promos/Ashs-Pikachu-SMP109', '109'],
  ],
  'Pikachu 025': [
    ['Pikachu (MEW 025)', '151/Pikachu-MEW025', '025'],
    ['Pikachu (sv2a 025)', 'Pokemon-Card-151/Pikachu-sv2a025', '025'],
    ['Pikachu (SVI 063)', 'Ecarlate-et-Violet/Pikachu-SVI063', '063'],
  ],
};
// Offres : [prix, état (code, rang), langue (nom, id), pays du vendeur]
const CM_OFFERS = {
  'Shiny-Treasure-ex/Gribouraigne-sv4a297': [['2,20 €', 'EX', 3, 'Japonais', 7, 'Allemagne'], ['2,50 €', 'NM', 2, 'Japonais', 7, 'France']],
  'Pokemon-Card-151/Dracaufeu-ex-sv2a006': [['30,00 €', 'NM', 2, 'Japonais', 7, 'France']],
  'Shiny-Treasure-ex/Coalossal-sv4a268': [['3,00 €', 'NM', 2, 'Japonais', 7, 'France']],
  'Scarlet-Violet/Castform-Sunny-Form-SVI198': [['0,10 €', 'NM', 2, 'Japonais', 7, 'France']],
  'Night-Wanderer/Castform-Sunny-Form-sv6a067': [['8,00 €', 'NM', 2, 'Japonais', 7, 'France']],
  '151/Pikachu-MEW025': [['0,50 €', 'NM', 2, 'Français', 2, 'France'], ['0,30 €', 'NM', 2, 'Anglais', 1, 'France']],
};
function fakeCardmarket(url) {
  const shell = (title, sub, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title} | Cardmarket</title></head><body style="font-family:sans-serif;padding:16px 440px 16px 16px">
    <main><div class="page-title-container"><h1>${title}<span> ${sub}</span></h1></div>${body}</main></body></html>`;
  const loc = (url.pathname.match(/^\/(fr|en)\//) || [])[1];
  if (!loc) return null;
  if (url.pathname === `/${loc}/Pokemon/Products/Search`) {
    const found = CM_ROWS[url.searchParams.get('searchString')] || [];
    if (found.redirect) return { redirect: `/${loc}/Pokemon/Products/Singles/${found.redirect}` };
    const rows = found.map(([name, slug, num], i) => `<div id="productRow${100 + i}" class="row g-0" style="padding:6px">
      <div data-testid="name"><a href="/${loc}/Pokemon/Products/Singles/${slug}">${name}</a></div><div data-testid="collector_number">${num}</div>
      <div data-testid="availability">12</div><div data-testid="from_price">1,00 €</div></div>`);
    return shell('Rechercher', '', `<div class="table-body">${rows.join('')}</div>`);
  }
  const m = url.pathname.match(/^\/(?:fr|en)\/Pokemon\/Products\/Singles\/([^/]+\/[^/]+)$/);
  if (!m || !CM_OFFERS[m[1]]) return null;
  const langs = (url.searchParams.get('language') || '').split(',').filter(Boolean).map(Number);
  const min = Number(url.searchParams.get('minCondition')) || 7;
  const offers = CM_OFFERS[m[1]].filter(([, , rank, , lang]) => rank <= min && (!langs.length || langs.includes(lang)));
  const rows = offers.map(([price, cond, , lang, , country], i) => `<div id="articleRow${500 + i}" class="row g-0 article-row" style="padding:6px">
    <div class="col-seller"><span title="Emplacement de l'article : ${country}"></span><a href="/fr/Pokemon/Users/vendeur${i}">vendeur${i}</a></div>
    <div class="product-attributes"><a class="article-condition"><span class="badge">${cond}</span></a><span title="${lang}"></span></div>
    <div class="col-offer"><div class="price-container"><span class="color-primary">${price}</span></div><span class="item-count">1</span></div></div>`);
  return shell(decodeURIComponent(m[1].split('/')[1]), `${m[1].split('/')[0]} - Singles`, `<div class="table-body">${rows.join('') || '<p>Aucune offre</p>'}</div>`);
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
    const extId = await browser.installExtension(ext);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    // Les refus 403 simulés et l'icône absente du faux site ne sont pas des erreurs de l'extension.
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
    const hits = { wardrobe: 0, shipping: 0, blocked: false, stats: 0, inbox: 0, conv: 0, head: 0 };
    await page.setRequestInterception(true);
    const handle = (req) => {
      const url = new URL(req.url());
      if (url.origin !== SITE) return req.abort();
      const json = (body, status) => req.respond({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
      let m;
      if (url.pathname === '/api/v2/conversations/stats') {
        hits.stats++;
        if (BOX.fail) return req.abort('failed');
        return BOX.block ? json({}, 403) : json({ unread_msg_count: BOX.convs.filter((c) => c.unread).length, code: 0 });
      }
      if (url.pathname === '/api/v2/inbox' && url.searchParams.get('per_page') === '1') {
        // Tête de liste : la conversation la plus récente, seule.
        hits.head++;
        if (BOX.fail) return req.abort('failed');
        if (BOX.block || BOX.headGone) return json({}, BOX.block ? 403 : 404);
        return json({ conversations: BOX.convs.slice(0, 1), pagination: { current_page: 1, per_page: 1, total_entries: BOX.convs.length, total_pages: BOX.convs.length }, code: 0 });
      }
      if (url.pathname === '/api/v2/inbox') {
        hits.inbox++;
        return json({ conversations: BOX.convs, pagination: { current_page: 1, per_page: 5, total_entries: BOX.convs.length, total_pages: 1 }, code: 0 });
      }
      if ((m = url.pathname.match(/^\/api\/v2\/conversations\/(\d+)$/))) {
        const id = Number(m[1]);
        if (req.method() === 'DELETE') {
          BOX.convs = BOX.convs.filter((c) => c.id !== id);
          return json({ code: 0 });
        }
        hits.conv++;
        const c = BOX.convs.find((x) => x.id === id);
        if (c) c.unread = false;
        return json({ conversation: { id, messages: thread(id) }, code: 0 });
      }
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
    };
    page.on('request', handle);

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

    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('cmrv.block') || '{}').until > Date.now()), 'ce refus met en pause toutes les lectures de l’extension (10 min)');
    await page.evaluate(() => localStorage.removeItem('cmrv.block'));

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

    console.log('12. Annonce de carte : « Voir sur Cardmarket », avec la langue et l’état de l’annonce');
    await page.goto(`${SITE}/items/77700012-carte`);
    await hostReady();
    ok(await waitFor(() => page.evaluate(() => !!document.querySelector('[data-cmrv-cmbtn]'))), 'bouton ajouté sous le prix');
    const btn = await page.evaluate(() => {
      const a = document.querySelector('[data-cmrv-cmbtn]');
      return { text: a.innerText.replace(/\s+/g, ' '), href: a.href, target: a.target, tip: a.title, inBox: !!a.closest('[data-testid="item-sidebar-price-container"]') };
    });
    ok(/Voir sur Cardmarket/.test(btn.text) && /japonais · Excellent ou mieux/.test(btn.text) && btn.target === '_blank' && btn.inBox, btn.text);
    const mark = C.decodeMarker(btn.href.slice(btn.href.indexOf('#'))) || {};
    ok(
      btn.href.startsWith(`${CM_SITE}/fr/Pokemon/Products/Search?searchString=Gribouraigne+297&mode=list&category=1#cmrv=`) && mark.l === 7 && mark.ls === 1 && mark.c === 'EX' && mark.tp === 5.94 && mark.sh === 4.35 && mark.u === '/items/77700012',
      `recherche « Gribouraigne 297 », japonais (lu dans la description), EX, ${mark.tp} € + ${mark.sh} € d’envoi`
    );
    ok(/description/.test(btn.tip) && /Très bon état/.test(btn.tip), `infobulle : ${btn.tip}`);
    await shot('cardmarket-bouton');
    // Sous les vignettes : le même lien ; la langue lue sur cette annonce sert aux autres annonces du vendeur.
    await page.goto(`${SITE}/member/777`);
    await hostReady();
    ok(await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-cm]').length >= 15)), 'lien « Cardmarket » sous les vignettes de cartes');
    const thumbs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="product-item-id-"][data-testid$="--overlay-link"]')].slice(0, 4).map((o) => {
        const a = o.parentElement.querySelector('[data-cmrv-cm]');
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return { href: a.href, onTop: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a };
      })
    );
    const tm = (i) => (thumbs[i] ? C.decodeMarker(thumbs[i].href.slice(thumbs[i].href.indexOf('#'))) : null) || {};
    ok(thumbs[0] === null, 'pas de lien sur « Carapuce » sans numéro ni mot « carte » (peluche, tee-shirt…)');
    ok(thumbs[1] && thumbs[1].onTop && /searchString=Salam%C3%A8che\+008/.test(thumbs[1].href) && tm(1).c === 'EX' && tm(3).c === 'GD', `« Salamèche – 008/165 » : lien cliquable, état Très bon état → ${tm(1).c}, Bon état → ${tm(3).c}`);
    ok(tm(1).l === 7 && tm(1).ls === 0 && tm(1).lf === 'vendeur', `langue reprise de l’annonce déjà vue chez ce vendeur : ${tm(1).l === 7 ? 'japonais' : tm(1).l}, à confirmer`);
    const setCm = (on) =>
      inPanel((sh, v) => {
        const c = sh.querySelector('#opt-cm');
        c.checked = v;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }, on);
    // Dans les résultats du panneau aussi.
    await inPanel((sh) => sh.querySelector('.panel').hidden || sh.querySelector('[data-act="toggle"].x').click());
    await page.evaluate(() => document.querySelector('[data-cmrv-bar]').click());
    await waitFor(async () => /^300 articles/.test(await text('#status')), 15000);
    await type('#q', 'salameche 008');
    const inRow = await inPanel((sh) => {
      const a = sh.querySelector('#results .it a.cm');
      return a ? { href: a.href, target: a.target, text: a.textContent } : null;
    });
    ok(inRow && inRow.target === '_blank' && /searchString=Salam%C3%A8che\+008/.test(inRow.href), `résultats du panneau : ${inRow ? inRow.text : 'pas de lien'}`);
    await inPanel((sh) => sh.querySelector('.panel').hidden || sh.querySelector('[data-act="toggle"].x').click());
    await setCm(false);
    ok(await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-cm]').length === 0)), 'réglage décoché : plus de lien');
    await setCm(true);
    ok(await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-cm]').length >= 15)), 'réglage recoché : les liens reviennent');

    console.log('13. Arrivée sur Cardmarket : la bonne carte, les filtres de l’annonce, les deux prix');
    const cmTab = await browser.newPage();
    await cmTab.setViewport({ width: 1440, height: 900 });
    const cmErrors = [];
    cmTab.on('pageerror', (e) => cmErrors.push(e.message));
    let cmSeen = [];
    await cmTab.setRequestInterception(true);
    cmTab.on('request', (req) => {
      const u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return req.continue();
      if (u.origin !== CM_SITE) return req.abort();
      const html = fakeCardmarket(u);
      if (html) cmSeen.push(u.pathname.split('/')[1] + ':' + u.pathname.split('/').pop() + u.search);
      if (html && html.redirect) return req.respond({ status: 302, headers: { location: html.redirect }, body: '' });
      return html ? req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : req.respond({ status: 404, body: '' });
    });
    const banner = () =>
      cmTab.evaluate(() => {
        const h = document.getElementById('cmrc-host');
        return h ? h.shadowRoot.querySelector('.box').innerText.replace(/\s+/g, ' ') : '';
      });
    const at = () => new URL(cmTab.url());
    await cmTab.goto(btn.href).catch(() => {});
    ok(await waitFor(async () => /sur vinted/i.test(await banner()), 15000), 'bandeau de comparaison affiché');
    ok(at().pathname === '/fr/Pokemon/Products/Singles/Shiny-Treasure-ex/Gribouraigne-sv4a297' && at().search === '?language=7&minCondition=3', `fiche de la carte n° 297, filtres japonais + EX ou mieux : ${at().pathname.split('/').pop()}${at().search}`);
    ok(cmSeen.length === 3, `3 pages affichées, aucune requête cachée : ${cmSeen.join(' → ')}`);
    let b = await banner();
    ok(/10,29 €/.test(b) && /≈ 4,10 €/.test(b) && /Cardmarket moins cher de ≈ 6,19 €/.test(b), b);
    ok(/Langue lue dans la description/.test(b) && /« Très bon état » comparé à « Excellent ou mieux »/.test(b), 'le bandeau dit d’où viennent la langue et l’état');
    ok(await cmTab.evaluate(() => !!document.getElementById('cmr-host')), 'le panneau Cardmarket de l’extension est toujours là');
    await cmTab.screenshot({ path: path.join(OUT, 'vinted-cardmarket-bandeau.png') }).then(() => console.log('  capture vinted-cardmarket-bandeau'));
    await cmTab.evaluate(() => [...document.getElementById('cmrc-host').shadowRoot.querySelectorAll('.chip')].find((c) => c.textContent === 'NM').click());
    ok(await waitFor(async () => at().search === '?language=7&minCondition=2' && /sur vinted/i.test(await banner()), 10000), `un clic sur « NM » : même fiche, état changé, comparaison conservée (${at().search})`);
    // Formulaire de filtres de Cardmarket : l'adresse n'a plus de fragment, la comparaison reste sur cette fiche.
    await cmTab.goto(`${CM_SITE}/fr/Pokemon/Products/Singles/Shiny-Treasure-ex/Gribouraigne-sv4a297?language=7`).catch(() => {});
    ok(await waitFor(async () => /sur vinted/i.test(await banner()), 8000), 'filtre changé avec le formulaire de Cardmarket : le bandeau reste');
    await cmTab.goto(`${CM_SITE}/fr/Pokemon/Products/Singles/151/Pikachu-MEW025`).catch(() => {});
    await sleep(1200);
    ok((await banner()) === '', 'autre fiche ouverte ensuite : pas de bandeau');

    // Langue non précisée dans l'annonce (français supposé) et fiche sans offre française : toutes les langues.
    const listing2 = { title: 'Dracaufeu ex 006/165', brand: 'Pokémon', status: 'Bon état', description: '' };
    cmSeen = [];
    await cmTab.goto(C.cardmarketUrl(C.describeListing(listing2), { title: listing2.title, status: listing2.status, price: 40, total: 42.7, shipping: 2.83, url: '/items/123' })).catch(() => {});
    ok(await waitFor(async () => /toutes les langues sont affichées/.test(await banner()), 15000), 'langue supposée et aucune offre : le filtre de langue est retiré, et c’est dit');
    b = await banner();
    ok(at().pathname.endsWith('/Dracaufeu-ex-sv2a006') && at().search === '?minCondition=4' && /45,53 €/.test(b) && /≈ 33,50 €/.test(b) && /Cardmarket moins cher de ≈ 12,03 €/.test(b), `${at().search} — ${b}`);
    ok(cmSeen.length === 3, `3 pages : ${cmSeen.join(' → ')}`);
    // Un filtre choisi à la main dans le bandeau n'est plus retiré d'office.
    await cmTab.evaluate(() => [...document.getElementById('cmrc-host').shadowRoot.querySelectorAll('.chip')].find((c) => c.textContent === 'français').click());
    ok(await waitFor(async () => at().search === '?language=2&minCondition=4' && /aucune offre/i.test(await banner()), 10000), `« français » choisi à la main : le filtre reste, « aucune offre avec ces filtres » (${at().search})`);
    await sleep(1500);
    ok(at().search === '?language=2&minCondition=4' && !/toutes les langues sont affichées/.test(await banner()), 'pas de retour d’office à toutes les langues');

    // Recherche à un seul résultat : Cardmarket ouvre la fiche directement. Son numéro n'est pas celui de l'annonce :
    // la bonne carte est cherchée par le nom anglais lu dans l'adresse de cette fiche.
    const listing5 = { title: 'Morpheo Forme Solaire – 067/064', brand: 'Pokémon', status: 'Très bon état', description: 'Carte japonaise' };
    cmSeen = [];
    await cmTab.goto(C.cardmarketUrl(C.describeListing(listing5), { title: listing5.title, status: listing5.status, price: 12, total: 13.3, shipping: 2.83, url: '/items/126' })).catch(() => {});
    ok(await waitFor(async () => /sur vinted/i.test(await banner()) && at().pathname.endsWith('/Castform-Sunny-Form-sv6a067'), 15000), `fiche ouverte d’office au mauvais numéro (198) : la carte n° 067 est retrouvée — ${at().pathname.split('/').pop()}${at().search}`);
    ok(at().search === '?language=7&minCondition=3' && /en:Search\?searchString=Castform\+Sunny\+Form\+067/.test(cmSeen.join(' ')) && !/ne porte pas/.test(await banner()), `${cmSeen.join(' → ')}`);
    // Rien d'autre à essayer : la fiche reste, mais le bandeau prévient et ne chiffre pas d'écart.
    const listing6 = { title: 'Pikachu 999/165 FR', brand: 'Pokémon', status: 'Très bon état', description: '' };
    cmSeen = [];
    await cmTab.goto(C.cardmarketUrl(C.describeListing(listing6), { title: listing6.title, status: listing6.status, price: 1, total: 1.75, shipping: 2.83, url: '/items/127' })).catch(() => {});
    ok(await waitFor(async () => /ne porte pas le n° 999\/165/.test(await banner()), 15000), 'fiche au mauvais numéro, rien d’autre à essayer : le bandeau prévient');
    b = await banner();
    ok(at().pathname.endsWith('/Pikachu-MEW025') && !/moins cher/.test(b) && /sur vinted/i.test(b), `pas d’écart chiffré sur une fiche douteuse — ${b.slice(0, 200)}`);
    // Annonce sans numéro : les résultats de la première recherche restent, à choisir à la main.
    const listing7 = { title: 'Carte Pokémon Pikachu de Sacha holo', brand: 'Pokémon', status: 'Très bon état', description: '' };
    cmSeen = [];
    await cmTab.goto(C.cardmarketUrl(C.describeListing(listing7), { title: listing7.title, status: listing7.status, price: 5, total: 5.95, shipping: 2.83, url: '/items/128' })).catch(() => {});
    ok(await waitFor(async () => /choisis la carte/.test(await banner()), 15000), `annonce sans numéro : ${await banner()}`);
    await sleep(1200);
    ok(at().pathname.endsWith('/Search') && cmSeen.length === 1 && at().searchParams.get('searchString') === 'Pikachu de Sacha', 'on reste sur la première recherche qui a des résultats');

    // Carte japonaise au titre français, que Cardmarket ne connaît que sous son nom anglais.
    const listing4 = { title: 'Monthracite – 268/190', brand: 'Pokémon', status: 'Très bon état', description: 'Carte japonaise' };
    cmSeen = [];
    await cmTab.goto(C.cardmarketUrl(C.describeListing(listing4), { title: listing4.title, status: listing4.status, price: 2.99, total: 3.84, shipping: 2.83, url: '/items/125' })).catch(() => {});
    ok(await waitFor(async () => /sur vinted/i.test(await banner()), 15000), 'nom français inconnu pour cette carte : retrouvée par son nom anglais, lu dans l’adresse d’une autre fiche');
    ok(at().pathname === '/fr/Pokemon/Products/Singles/Shiny-Treasure-ex/Coalossal-sv4a268' && at().search === '?language=7&minCondition=3', `fiche ouverte sur le site en français : ${at().pathname.split('/').pop()}${at().search}`);
    ok(cmSeen.length === 4 && /^en:Search\?searchString=Coalossal\+268/.test(cmSeen[2]), `4 pages : ${cmSeen.join(' → ')}`);

    // Deux cartes au même numéro : pas de choix automatique.
    const listing3 = { title: 'Pikachu 025/165 FR', brand: 'Pokémon', status: 'Très bon état', description: '' };
    cmSeen = [];
    await cmTab.goto(C.cardmarketUrl(C.describeListing(listing3), { title: listing3.title, status: listing3.status, price: 1, total: 1.75, shipping: null, url: '/items/124' })).catch(() => {});
    ok(await waitFor(async () => /Plusieurs cartes portent le n° 025\/165/.test(await banner()), 15000), `deux cartes au n° 025 : ${await banner()}`);
    const picks = await cmTab.evaluate(() => [...document.querySelectorAll('[id^="productRow"]')].map((r) => ({ href: r.querySelector('a').getAttribute('href'), marked: /outline/.test(r.getAttribute('style') || '') })));
    ok(at().pathname.endsWith('/Search') && cmSeen.length === 1 && picks.filter((x) => x.marked).length === 2 && picks.every((x) => /\?language=2&minCondition=3#cmrv=/.test(x.href)), 'on reste sur la recherche : les deux cartes sont encadrées, chaque lien mène à la fiche déjà filtrée');
    await cmTab.evaluate(() => document.querySelector('[id^="productRow"] a').click());
    ok(await waitFor(async () => /hors envoi/.test(await banner()), 10000), 'carte choisie à la main : comparaison affichée');
    b = await banner();
    ok(at().search === '?language=2&minCondition=3' && /1,75 € protection incluse, hors envoi/.test(b) && /0,50 € hors port \(≈ 1,60 € en plus, FR\)/.test(b) && /Cardmarket moins cher de ≈ 1,25 € \(hors envoi\)/.test(b), `envoi Vinted inconnu : prix comparés hors envoi des deux côtés — ${b}`);
    ok(cmErrors.length === 0, `aucune erreur sur les pages Cardmarket${cmErrors.length ? ' : ' + cmErrors.join(' | ') : ''}`);
    await cmTab.close();
    await page.bringToFront();

    console.log('14. Messagerie : supprimer une conversation');
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    const dels = () => page.evaluate(() => [...document.querySelectorAll('[data-cmrv-act="del"]')].map((b) => b.dataset.id + ':' + b.textContent));
    ok(await waitFor(async () => (await dels()).length === 6), `un bouton par conversation, aucun sur le message promotionnel : ${(await dels()).map((d) => d.split(':')[0]).join(' ')}`);
    const ibar = () => page.evaluate(() => (document.querySelector('[data-cmrv-ibar]') || {}).innerText || '');
    const press = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
    await press('[data-cmrv-act="del"][data-id="102"]');
    await sleep(300);
    ok((await dels()).includes('102:Supprimer ?') && (await page.evaluate(() => location.pathname + '|' + (window.opened || 0) + '|' + (window.deleted || []).length)) === '/inbox|0|0', 'premier clic : demande de confirmation, rien n’est ouvert ni supprimé');
    await press('[data-cmrv-act="del"][data-id="102"]');
    ok(await waitFor(() => page.evaluate(() => (window.deleted || []).join() === '102')), 'second clic : la conversation 102 est supprimée par le parcours de Vinted');
    ok(await waitFor(async () => /1 conversation supprimée/.test(await ibar())), (await ibar()).replace(/\n/g, ' | '));

    console.log('15. Messagerie : supprimer plusieurs conversations');
    const delBtn = (id) => page.evaluate((i) => {
      const b = document.querySelector(`[data-cmrv-act="del"][data-id="${i}"]`);
      return b ? { disabled: b.disabled, title: b.title } : null;
    }, id);
    ok(await waitFor(async () => ((await delBtn('103')) || {}).disabled === true), `conversation que Vinted interdit de supprimer : corbeille grisée (« ${((await delBtn('103')) || {}).title} »)`);
    await press('[data-cmrv-act="select"]');
    await press('[data-cmrv-act="del"][data-id="101"]');
    await press('[data-cmrv-act="del"][data-id="103"]');
    await press('[data-cmrv-act="del"][data-id="104"]');
    await press('[data-cmrv-act="del"][data-id="106"]');
    await sleep(300);
    ok(/3 cochées/.test(await ibar()) && /Supprimer \(3\)/.test(await ibar()), `la 103 ne se coche pas : ${(await ibar()).replace(/\n/g, ' | ')}`);
    await press('[data-cmrv-act="delsel"]');
    await sleep(300);
    ok(/Confirmer : supprimer 3 conversations/.test(await ibar()) && (await page.evaluate(() => (window.deleted || []).length)) === 1, 'une confirmation est demandée avant toute suppression');
    await shot('messages');
    await press('[data-cmrv-act="delsel"]');
    ok(await waitFor(async () => /2 conversations supprimées · 1 non supprimée/.test(await ibar()), 40000), (await ibar()).replace(/\n/g, ' | '));
    ok((await page.evaluate(() => (window.deleted || []).join())) === '102,101,104', 'supprimées : 101 et 104 ; la 106 (sans action « Supprimer ») est laissée');
    ok((await page.evaluate(() => !!document.querySelector('[data-testid="inbox-list-item-105"]') && !!document.querySelector('[data-testid="inbox-list-item-UHJvbW8="]'))), 'les conversations non cochées sont intactes');

    console.log('16. Messages en direct : nouveau message dans la conversation ouverte');
    BOX = freshInbox();
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    ok(await waitFor(async () => /en direct/.test(await ibar())), `indicateur : ${(await ibar()).replace(/\n/g, ' | ')}`);
    await press('[data-testid="inbox-list-item-104"]');
    const msgs = () => page.evaluate(() => document.querySelectorAll('[data-testid="conversation-message"]').length);
    const badge = () => page.evaluate(() => document.querySelector('[data-testid="header-conversations-button"]').textContent);
    const rowText = (id) => page.evaluate((i) => (document.querySelector(`[data-testid="inbox-list-item-${i}"] span`) || {}).textContent || '', id);
    const dot = (id) => page.evaluate((i) => !!document.querySelector(`[data-testid="inbox-list-item-${i}"] [data-cmrv-new]`), id);
    // L'utilisateur est devant la page : un mouvement de souris.
    let wiggle = 0;
    const here = () => page.mouse.move(300 + (wiggle++ % 40), 300);
    // Rend une lecture du compteur due tout de suite : valeur de Vinted vieillie, heure partagée reculée.
    const rewind = (p, ms) =>
      (p || page).evaluate((back) => {
        if (window.ageCache) window.ageCache();
        const v = JSON.parse(localStorage.getItem('cmrv.live') || '{}');
        localStorage.setItem('cmrv.live', JSON.stringify(Object.assign(v, { t: Date.now() - back })));
      }, ms || 61000);
    ok(await waitFor(async () => (await msgs()) === 2), 'conversation 104 ouverte : 2 messages');
    await page.evaluate(() => {
      document.querySelector('[data-testid="composer--input"]').value = 'brouillon en cours';
    });
    await here();
    await sleep(4000);
    const c0 = { conv: hits.conv, inbox: hits.inbox, stats: hits.stats, head: hits.head };
    let t0 = Date.now();
    receive(104, 'Oui, toujours disponible !');
    ok(await waitFor(async () => (await msgs()) === 3, 9000), `le nouveau message apparaît tout seul, sans recharger, en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    ok(Date.now() - t0 < 6500, 'en moins de 6 secondes');
    ok((await page.evaluate(() => document.querySelector('[data-testid="composer--input"]').value)) === 'brouillon en cours', 'le message en cours de saisie est conservé');
    ok(await waitFor(() => page.evaluate(() => {
      const box = document.querySelector('[data-testid="conversation-content"]');
      return box.scrollHeight - box.scrollTop - box.clientHeight < 5;
    })), 'le fil reste en bas, sur le nouveau message');
    ok(await waitFor(async () => /Messages 0$/.test(await badge()), 9000), `la pastille du bandeau revient à 0 une fois la conversation lue (${await badge()})`);
    await sleep(6000);
    ok(hits.conv - c0.conv <= 2 && hits.inbox === c0.inbox, `pour ce message : ${hits.conv - c0.conv} lecture(s) de la conversation, ${hits.inbox - c0.inbox} de la liste, ${hits.stats - c0.stats} du compteur, ${hits.head - c0.head} de la tête de liste`);
    // Message envoyé par l'utilisateur depuis son téléphone : le compteur de non-lus ne bouge pas.
    await here();
    t0 = Date.now();
    sendFromPhone(104, 'Envoyé depuis mon téléphone');
    ok(await waitFor(async () => (await msgs()) === 4, 9000) && Date.now() - t0 < 6500, `un message envoyé depuis un autre appareil apparaît aussi, en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    console.log('17. Messages en direct : nouveau message dans une autre conversation');
    await here();
    await sleep(4500);
    const c1 = { conv: hits.conv, inbox: hits.inbox };
    t0 = Date.now();
    receive(105, 'Bonjour, je prends le lot');
    ok(await waitFor(() => dot(105), 7000), `pastille « nouveau message » sur la ligne, en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    ok(await waitFor(async () => /^● emma — Bonjour, je prends le lot/.test(await rowText(105)), 9000), `la liste affiche le message, en ${((Date.now() - t0) / 1000).toFixed(1)} s : ${await rowText(105)}`);
    // La marque doit se voir : pastille verte « Nouveau » collée à gauche de la corbeille, ligne teintée et éclat.
    const mark105 = () => page.evaluate(() => {
      const row = document.querySelector('[data-testid="inbox-list-item-105"]');
      const pill = row.querySelector('[data-cmrv-new]');
      const bin = row.querySelector('[data-cmrv-act="del"]');
      if (!pill || !bin) return null;
      const p = pill.getBoundingClientRect();
      const b = bin.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return {
        text: pill.textContent,
        bg: getComputedStyle(pill).backgroundColor,
        gap: Math.round(b.left - p.right),
        level: Math.abs(p.bottom - b.bottom) < 2,
        inside: p.left >= r.left && p.right <= r.right && p.top >= r.top && p.bottom <= r.bottom,
        wide: p.width >= 50 && p.height >= 20,
        tint: row.hasAttribute('data-cmrv-fresh') && /inset/.test(getComputedStyle(row).boxShadow),
        flash: row.hasAttribute('data-cmrv-flash'),
      };
    });
    let seenFlash = false;
    await waitFor(async () => (seenFlash = seenFlash || ((await mark105()) || {}).flash), 5000);
    const m105 = (await mark105()) || {};
    ok(m105.text === 'Nouveau' && m105.bg === 'rgb(18, 161, 80)' && m105.wide && m105.inside, `pastille verte « ${m105.text} » dans la ligne (${m105.bg})`);
    ok(m105.gap >= 2 && m105.gap <= 12 && m105.level, `juste à gauche de la corbeille (${m105.gap} px d’écart)`);
    ok(m105.tint && seenFlash, 'ligne teintée, avec un éclat à l’arrivée du message');
    await shot('nouveau');
    ok(await waitFor(async () => /Messages 1$/.test(await badge()) && /^\(1\) /.test(await page.title()), 9000), `pastille du bandeau et titre de l’onglet : ${await badge()} ; « ${await page.title()} »`);
    ok(hits.inbox - c1.inbox === 1 && (await msgs()) === 4 && !(await dot(104)), `une seule lecture de la liste (${hits.inbox - c1.inbox}), rien sur la conversation ouverte`);
    ok(!(await page.evaluate(() => window.refetches.includes('inbox-conversations'))), 'les requêtes que Vinted a désactivées ne sont pas relancées');
    await sleep(3000);
    const quiet = { stats: hits.stats, inbox: hits.inbox, conv: hits.conv, head: hits.head };
    await sleep(15000);
    ok(hits.head - quiet.head >= 3 && hits.head - quiet.head <= 7 && hits.stats - quiet.stats <= 2 && hits.inbox === quiet.inbox && hits.conv - quiet.conv <= 1, `au repos, en 15 s : ${hits.head - quiet.head} lectures de la tête de liste, ${hits.stats - quiet.stats} du compteur, ${hits.conv - quiet.conv} de la conversation, aucune de la liste`);
    await shot('direct');
    await press('[data-testid="inbox-list-item-105"]');
    await sleep(1500);
    await press('[data-testid="inbox-list-item-104"]');
    await sleep(1500);
    ok(!(await dot(105)) && !(await page.evaluate(() => !!document.querySelector('[data-cmrv-fresh]'))), 'la pastille disparaît une fois la conversation ouverte');
    // Message envoyé par l'utilisateur depuis son téléphone dans une autre conversation : ce n'est pas un message
    // reçu (pas de pastille), mais la ligne qui change s'illumine un instant.
    await here();
    await sleep(3000);
    const flash102 = () => page.evaluate(() => document.querySelector('[data-testid="inbox-list-item-102"]').hasAttribute('data-cmrv-flash'));
    t0 = Date.now();
    sendFromPhone(102, 'Je te l’envoie demain');
    ok(await waitFor(flash102, 7000), `message envoyé d’un autre appareil dans une autre conversation : la ligne s’illumine, en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    ok(/Je te l’envoie demain/.test(await rowText(102)) && !(await dot(102)), `aperçu à jour, sans pastille « Nouveau » : ${await rowText(102)}`);
    ok(await waitFor(async () => !(await flash102()), 6000), 'l’éclat s’éteint tout seul');

    console.log('18. Onglet caché : rien n’est relu, puis rattrapage au retour');
    const other = await browser.newPage();
    await other.bringToFront();
    if (!(await waitFor(() => page.evaluate(() => document.visibilityState === 'hidden'), 4000))) console.log('  (ignoré : ce Chrome ne signale pas l’onglet comme caché)');
    else {
      await sleep(1500);
      const c2 = { conv: hits.conv, head: hits.head };
      const n2 = await msgs();
      receive(104, 'Tu es là ?');
      await sleep(9000);
      ok(hits.conv === c2.conv && hits.head === c2.head && (await msgs()) === n2, 'onglet caché : aucune lecture, la conversation n’est pas relue (elle serait marquée lue sans avoir été vue)');
      await page.bringToFront();
      ok(await waitFor(async () => (await msgs()) === n2 + 1, 9000), 'retour sur l’onglet : le message apparaît');
    }
    await other.close();
    await page.bringToFront();

    console.log('19. Pendant une sélection de suppression, la liste ne bouge pas');
    await sleep(4000);
    await press('[data-cmrv-act="select"]');
    await press('[data-cmrv-act="del"][data-id="101"]');
    await here();
    const i1 = hits.inbox;
    const before102 = await rowText(102);
    receive(102, 'Encore disponible ?');
    ok(await waitFor(async () => /nouveau message/.test(await ibar()), 9000), `prévenu, sans rien déplacer : ${(await ibar()).replace(/\n/g, ' | ')}`);
    await sleep(4000);
    ok(hits.inbox === i1 && (await rowText(102)) === before102, 'liste intacte tant que la sélection est en cours');
    await press('[data-cmrv-act="delsel"]');
    ok(await waitFor(async () => /^● bob — Encore disponible/.test(await rowText(102)) && /vérifie ta sélection/.test(await ibar()), 8000), `avant de confirmer, la liste est relue : ${(await ibar()).replace(/\n/g, ' | ')}`);
    ok(!/Confirmer/.test(await ibar()) && (await page.evaluate(() => (window.deleted || []).length)) === 0, 'aucune suppression n’est armée par ce premier clic');
    await press('[data-cmrv-act="select"]');
    // Même garde-fou quand le message arrive dans la conversation ouverte (elle aussi peut être cochée).
    await sleep(3000);
    await press('[data-cmrv-act="select"]');
    await press('[data-cmrv-act="del"][data-id="104"]');
    await here();
    const n17 = await msgs();
    receive(104, 'Attends, j’ai une question');
    ok(await waitFor(async () => /nouveau message/.test(await ibar()), 9000), `message dans la conversation ouverte : prévenu aussi (${(await ibar()).replace(/\n/g, ' | ')})`);
    await press('[data-cmrv-act="select"]');
    await here();
    ok(await waitFor(async () => (await msgs()) === n17 + 1, 9000), 'sélection annulée : le message s’affiche');

    console.log('20. Deux onglets : une seule lecture du compteur');
    const tab2 = await browser.newPage();
    await tab2.setRequestInterception(true);
    tab2.on('request', handle);
    await tab2.goto(`${SITE}/inbox`);
    await page.reload();
    await waitFor(() => tab2.evaluate(() => !!document.getElementById('cmrv-host')));
    await hostReady();
    await sleep(3500);
    const s4 = hits.stats;
    await page.evaluate(() => window.ageCache());
    await rewind(tab2, 130000);
    await sleep(6000);
    ok(hits.stats - s4 === 1, `${hits.stats - s4} lecture pour deux onglets dont l’échéance tombe en même temps`);
    await tab2.close();
    await page.bringToFront();

    console.log('21. Ailleurs sur Vinted : avis « Nouveau message »');
    await page.goto(`${SITE}/member/777`);
    await hostReady();
    await sleep(2500);
    // Un autre onglet Vinted, ouvert avant l'arrivée du message, puis laissé en arrière-plan.
    const tabB = await browser.newPage();
    await tabB.setRequestInterception(true);
    tabB.on('request', handle);
    await tabB.goto(`${SITE}/member/777`);
    await waitFor(() => tabB.evaluate(() => !!document.getElementById('cmrv-host')));
    await sleep(2500);
    await page.bringToFront();
    await sleep(1500);
    const s1 = { stats: hits.stats, head: hits.head };
    receive(106, 'Dispo pour un échange ?');
    // Hors messagerie, le compteur n'est lu qu'une fois par minute ; revenir sur l'onglet le fait lire tout de suite.
    await page.evaluate(() => window.ageCache());
    await tabB.bringToFront();
    await sleep(900);
    await page.bringToFront();
    ok(await waitFor(() => page.evaluate(() => !!document.querySelector('[data-cmrv-toast="msg"]')), 9000), 'avis affiché');
    const toastText = await page.evaluate(() => (document.querySelector('[data-cmrv-toast]') || {}).innerText || '');
    ok(/Nouveau message de farid/.test(toastText) && /échange/.test(toastText), toastText.replace(/\n/g, ' | '));
    ok(/^\(\d+\) /.test(await page.title()) && hits.stats - s1.stats === 1 && hits.head === s1.head, `titre de l’onglet « ${await page.title()} », ${hits.stats - s1.stats} lecture du compteur, aucune de la tête de liste hors messagerie`);
    await shot('avis');
    await Promise.all([page.waitForNavigation(), page.evaluate(() => document.querySelector('.cmrv-toast-main').click())]);
    ok(page.url() === `${SITE}/inbox/106`, `un clic sur l’avis ouvre la conversation : ${page.url().replace(SITE, '')}`);
    await hostReady();
    await sleep(2000); // la fausse messagerie charge sa liste : à ne pas confondre avec une lecture de l'extension
    const i2 = hits.inbox;
    await tabB.bringToFront();
    await sleep(7000);
    ok(/^\(\d+\) /.test(await tabB.title()) && !(await tabB.evaluate(() => !!document.querySelector('[data-cmrv-toast]'))) && hits.inbox === i2, `dans l’autre onglet : titre à jour (« ${await tabB.title()} »), pas de second avis ni de nouvelle lecture de la liste pour le même message`);
    await tabB.close();
    await page.bringToFront();

    console.log('22. Vinted refuse une lecture : tout se met en pause, partout');
    await hostReady();
    await here();
    ok(await waitFor(async () => /en direct/.test(await ibar())), 'en direct avant le refus');
    BOX.block = true;
    ok(await waitFor(async () => /en pause — Vinted a refusé/.test(await ibar()), 9000), `indicateur : ${(await ibar()).replace(/\n/g, ' | ')}`);
    const s2 = { stats: hits.stats, head: hits.head, conv: hits.conv };
    await sleep(9000);
    ok(hits.stats === s2.stats && hits.head === s2.head && hits.conv === s2.conv, 'plus aucune lecture pendant la pause');
    BOX.block = false;
    const sh0 = hits.shipping;
    await page.goto(`${SITE}/`);
    await hostReady();
    await sleep(5000);
    ok(hits.shipping === sh0, 'après un changement de page, les prix d’envoi ne sont pas demandés non plus');
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    await sleep(3000);
    ok(/en pause — Vinted a refusé/.test(await ibar()), 'et la messagerie reste en pause');

    console.log('23. Lecture en échec sans code (réseau) : un second essai plus tard, puis silence');
    await page.evaluate(() => {
      localStorage.removeItem('cmrv.block');
      localStorage.removeItem('cmrv.live');
    });
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    ok(await waitFor(async () => /en direct/.test(await ibar())), 'en direct au départ');
    await press('[data-testid="inbox-list-item-104"]');
    await here();
    await sleep(4000);
    BOX.fail = true;
    const h5 = hits.head;
    ok(await waitFor(async () => /lecture impossible/.test(await ibar()), 9000), `indicateur honnête dès le premier échec : ${(await ibar()).replace(/\n/g, ' | ')}`);
    ok(await waitFor(async () => hits.head - h5 === 2, 15000), 'un second essai, deux fois plus tard');
    await sleep(3000);
    const c5 = { conv: hits.conv, inbox: hits.inbox, stats: hits.stats, head: hits.head };
    await sleep(12000);
    ok(hits.head === c5.head && hits.stats === c5.stats && hits.conv === c5.conv && hits.inbox === c5.inbox, 'puis silence : plus aucune lecture');
    BOX.fail = false;

    console.log('24. Tête de liste indisponible : retour à la lecture du compteur');
    await page.evaluate(() => {
      localStorage.removeItem('cmrv.block');
      localStorage.removeItem('cmrv.live');
    });
    BOX = freshInbox();
    BOX.headGone = true;
    const h6 = hits.head;
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    await press('[data-testid="inbox-list-item-104"]');
    await here();
    ok(await waitFor(async () => hits.head - h6 === 2, 12000), 'deux essais, puis on n’insiste pas');
    await here();
    receive(104, 'Toujours là ?');
    ok(await waitFor(async () => (await msgs()) === 3, 30000), 'le message apparaît quand même, par le compteur');
    ok(hits.head - h6 === 2 && /en direct/.test(await ibar()), `tête de liste abandonnée (${hits.head - h6} lectures), indicateur : ${(await ibar()).replace(/\n/g, ' | ')}`);
    BOX.headGone = false;

    console.log('25. Page sans pastille de messages : lecture directe, sans insister');
    await page.evaluate(() => {
      localStorage.removeItem('cmrv.block');
      localStorage.removeItem('cmrv.live');
    });
    const s6 = hits.stats;
    await page.goto(`${SITE}/`);
    await hostReady();
    await sleep(6000);
    ok(hits.stats === s6, 'aucune lecture pendant que la page se construit');
    ok(await waitFor(async () => hits.stats - s6 === 1, 14000), 'puis une lecture directe');
    await sleep(8000);
    ok(hits.stats - s6 === 1, 'et une seule');

    console.log('26. Réglage « Messages en direct » décoché');
    await page.goto(`${SITE}/inbox`);
    await hostReady();
    ok(await waitFor(async () => /en direct/.test(await ibar())), 'en direct au départ');
    await inPanel((sh) => {
      sh.querySelector('#opt-live').checked = false;
      sh.querySelector('#opt-live').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(1500);
    const s3 = { stats: hits.stats, head: hits.head };
    await sleep(9000);
    ok(hits.stats === s3.stats && hits.head === s3.head && !/en direct/.test(await ibar()) && !/^\(\d+\) /.test(await page.title()), `plus de lecture, plus d’indicateur, titre « ${await page.title()} »`);

    console.log('27. Réglages');
    await page.goto(`${SITE}/member/777`);
    await hostReady();
    await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-label]').length >= 20));
    await inPanel((sh) => {
      for (const id of ['#opt-shipping', '#opt-titles', '#opt-cm']) {
        sh.querySelector(id).checked = false;
        sh.querySelector(id).dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    ok(await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-cmrv-label]').length === 0)), 'affichages retirés quand les trois options sont décochées');
    ok(hits.shipping <= 40, `${hits.shipping} lectures de frais d’envoi sur tout le parcours`);

    console.log('28. Clic sur l’icône hors Cardmarket et Vinted : page d’explication');
    // Sans passer par le service de fond, qui s'endort pendant un parcours aussi long.
    const welcome = await browser.newPage();
    await welcome.goto(`chrome-extension://${extId}/src/accueil.html`);
    const name = await welcome.evaluate(() => fetch('/manifest.json').then((r) => r.json()).then((m) => m.name));
    ok(name === 'Regroupeur — Cardmarket & Vinted', `nom de l’extension : ${name}`);
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
