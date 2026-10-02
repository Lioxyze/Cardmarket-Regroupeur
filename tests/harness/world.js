/*
 * Faux Cardmarket pour tester l'extension hors ligne (page tests/harness/index.html).
 * - chrome.storage / chrome.runtime simulés en mémoire ;
 * - fetch() vers www.cardmarket.com servi par un petit « marché » généré (graine fixe),
 *   avec le même HTML que le vrai site (voir tests/fixtures) : pages produit paginées,
 *   « Show more results », stock d'un vendeur, recherche par catégorie, panier.
 *
 * Options d'URL : ?fast (délais courts) · ?loggedout (visiteur non connecté).
 * Le formulaire panier des vraies pages n'est visible que connecté : ici on simule deux
 * variantes plausibles (formulaire dans la ligne, formulaire commun « BuyAllForm »).
 */
(function () {
  'use strict';

  // ---------- chrome.* ----------
  const mem = {};
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return JSON.parse(JSON.stringify(mem));
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in mem) out[k] = JSON.parse(JSON.stringify(mem[k]));
          return out;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: mem[k], newValue: JSON.parse(JSON.stringify(v)) };
            mem[k] = JSON.parse(JSON.stringify(v));
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete mem[k];
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      getURL: (p) => '/' + p,
      getManifest: () => ({ version: 'test' }),
      onMessage: { addListener() {} },
    },
  };
  window.__mem = mem;
  let LOGGED_IN = !location.search.includes('loggedout');
  const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

  // ---------- Marché simulé ----------
  let seed = 20260929;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const EXP = 'Scarlet-Violet-151';
  const IMG = [274844, 274858, 274803, 274860, 274855, 274811, 274829, 274809, 274815, 274808, 274816, 274838].map(
    (id) => `https://product-images.s3.cardmarket.com/51/LC/${id}/${id}.jpg`
  );
  // Deux extensions : les mêmes Pokémon existent aussi dans « Paldean Fates », à d'autres numéros.
  const EXPANSIONS = [
    { id: 5402, slug: EXP, en: '151', fr: 'Écarlate et Violet 151' },
    { id: 5605, slug: 'Paldean-Fates', en: 'Paldean Fates', fr: 'Destinées de Paldea' },
    { id: 5760, slug: 'Shrouded-Fable', en: 'Shrouded Fable', fr: 'Fable Nébuleuse' },
  ];
  // [catégorie, extension, slug, nom anglais, nom français, numéro, prix de base]
  const PRODUCTS = [
    ['Singles', EXP, 'Bulbasaur-MEW001', 'Bulbasaur (MEW 001)', 'Bulbizarre (MEW 001)', '001', 0.12],
    ['Singles', EXP, 'Charmander-MEW004', 'Charmander (MEW 004)', 'Salamèche (MEW 004)', '004', 0.2],
    ['Singles', EXP, 'Squirtle-MEW007', 'Squirtle (MEW 007)', 'Carapuce (MEW 007)', '007', 0.15],
    ['Singles', EXP, 'Pikachu-MEW025', 'Pikachu (MEW 025)', 'Pikachu (MEW 025)', '025', 0.35],
    ['Singles', EXP, 'Alakazam-ex-MEW065', 'Alakazam ex (MEW 065)', 'Alakazam-ex (MEW 065)', '065', 1.1],
    ['Singles', EXP, 'Zapdos-ex-MEW145', 'Zapdos ex (MEW 145)', 'Électhor-ex (MEW 145)', '145', 0.9],
    ['Singles', EXP, 'Mew-ex-MEW151', 'Mew ex (MEW 151)', 'Mew-ex (MEW 151)', '151', 2.4],
    ['Singles', EXP, 'Erikas-Invitation-MEW160', "Erika's Invitation (MEW 160)", "Invitation d'Érika (MEW 160)", '160', 0.6],
    ['Singles', 'Paldean-Fates', 'Mew-ex-PAF053', 'Mew ex (PAF 053)', 'Mew-ex (PAF 053)', '053', 1.5],
    ['Singles', 'Paldean-Fates', 'Charmander-PAF007', 'Charmander (PAF 007)', 'Salamèche (PAF 007)', '007', 0.3],
    ['Sealed-Products', EXP, '151-Elite-Trainer-Box', 'Scarlet & Violet: 151 Elite Trainer Box', 'Coffret Dresseur d’élite 151', '', 62],
    ['Sealed-Products', EXP, '151-Booster-Bundle', 'Scarlet & Violet: 151 Booster Bundle', 'Bundle de boosters 151', '', 38],
    ['Booster-Boxes', EXP, '151-Display-JP', 'Pokemon Card 151 Booster Box (JP)', 'Display 151 (JP)', '', 95],
  ].map(([category, exp, slug, name, fr, number, base], i) => ({
    key: `Pokemon/Products/${category}/${exp}/${slug}`,
    category,
    exp,
    slug,
    name,
    fr,
    number,
    base,
    image: IMG[i % IMG.length],
  }));
  const nameIn = (p, locale) => (locale === 'fr' ? p.fr : p.name);
  const CARDS = PRODUCTS.filter((p) => p.category === 'Singles' && p.exp === EXP).map((p) => [p.slug, p.name, p.number, p.base]);
  const COUNTRIES = ['France', 'France', 'France', 'Germany', 'Germany', 'Italy', 'Spain', 'Belgium', 'Netherlands'];
  const LANGS = ['French', 'French', 'French', 'English', 'English', 'Japanese', 'German'];
  const CONDS = ['NM', 'NM', 'NM', 'EX', 'MT', 'GD', 'LP'];
  const CONDNAME = { MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };
  const LOOSE_COMMENTS = ['', '', '', '', 'Direct from booster', 'PSA ready !', 'Top centrage, candidate PSA 10', 'Envoi soigné', ':-)'];

  const sellers = [];
  const BIG = [
    ['CartesDuNord', 'France', 'professional', 18450],
    ['PokeStock-Lyon', 'France', 'powerseller', 42100],
    ['MunichCards', 'Germany', 'powerseller', 88000],
  ];
  for (const [name, country, type, sales] of BIG) sellers.push({ name, country, type, sales, big: true });
  const syll = ['ka', 'ri', 'mo', 'zu', 'lu', 'te', 'shi', 'no', 'ba', 'ro', 'vi', 'el'];
  for (let i = 0; i < 70; i++) {
    const name = pick(syll) + pick(syll) + pick(syll) + '_' + Math.floor(rand() * 90 + 10);
    sellers.push({ name, country: pick(COUNTRIES), type: rand() < 0.2 ? 'professional' : 'private', sales: Math.floor(rand() * 900 + 3) });
  }
  const GRADERS = [
    { name: 'SlabHouse', country: 'France', type: 'professional', sales: 2400 },
    { name: 'GradedGermany', country: 'Germany', type: 'professional', sales: 5100 },
  ];
  sellers.push(...GRADERS);

  // Offres : les gros vendeurs ont presque tout un peu plus cher, les petits 1-2 cartes pas cher.
  const offers = {}; // key -> [offer]
  const byId = new Map();
  let articleId = 1000000;
  const add = (key, o) => {
    o.id = articleId++;
    offers[key].push(o);
    byId.set(o.id, Object.assign(o, { key }));
  };
  for (const p of PRODUCTS) {
    offers[p.key] = [];
    const sealed = p.category !== 'Singles';
    for (const s of sellers) {
      if (GRADERS.includes(s)) continue;
      const has = s.big ? rand() < 0.85 : rand() < (sealed ? 0.15 : 0.35);
      if (!has) continue;
      const n = s.big ? 1 + Math.floor(rand() * 2) : 1;
      for (let k = 0; k < n; k++) {
        const price = Math.max(0.02, Math.round(p.base * (s.big ? 1.1 + rand() * 0.5 : 0.7 + rand() * 0.8) * 100) / 100);
        add(p.key, {
          seller: s,
          price,
          count: 1 + Math.floor(rand() * 3),
          cond: sealed ? null : s.big ? 'NM' : pick(CONDS),
          lang: s.big ? 'French' : sealed ? pick(['French', 'English']) : pick(LANGS),
          reverse: !sealed && rand() < 0.12,
          comment: sealed ? '' : pick(LOOSE_COMMENTS),
        });
      }
    }
    // Cartes gradées : chères, commentaire « PSA 10 », « CGC 9.5 »…
    if (!sealed) {
      add(p.key, { seller: GRADERS[0], price: Math.round(p.base * 32 * 100) / 100, count: 1, cond: 'MT', lang: 'French', comment: 'PSA 10 GEM MINT' });
      add(p.key, { seller: GRADERS[0], price: Math.round(p.base * 11 * 100) / 100, count: 1, cond: 'NM', lang: 'French', comment: 'PSA 9' });
      add(p.key, { seller: GRADERS[1], price: Math.round(p.base * 14 * 100) / 100, count: 1, cond: 'MT', lang: 'French', comment: 'CGC 9.5' });
    }
    offers[p.key].sort((a, b) => a.price - b.price);
  }

  const cart = new Map(); // idArticle -> quantité
  window.__world = {
    /** Les offres d'une carte, pour afficher une vraie « page produit » dans le banc de test. */
    productRowsHtml: (key) => offers[key].slice(0, 25).map((o) => productRow(o)).join(''),
    offers,
    sellers,
    CARDS,
    PRODUCTS,
    EXPANSIONS,
    EXP,
    cart,
    setLoggedIn(v) {
      LOGGED_IN = !!v;
    },
    /** Simule une vente entre l'analyse et l'ajout au panier. */
    sell(id) {
      const o = byId.get(+id);
      if (!o) return false;
      offers[o.key] = offers[o.key].filter((x) => x !== o);
      byId.delete(+id);
      return true;
    },
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const eur = (p) => p.toFixed(2).replace('.', ',') + ' €';
  const productOf = (key) => PRODUCTS.find((p) => p.key === key);

  function attributes(o) {
    return (
      '<div class="product-attributes col">' +
      (o.cond
        ? `<a href="https://help.cardmarket.com/en/CardCondition" title="${CONDNAME[o.cond]}" class="article-condition condition-${o.cond.toLowerCase()} me-1"><span class="badge">${o.cond}</span></a>`
        : '') +
      `<span onmouseover="showMsgBox(this,\`${o.lang}\`)" title="${o.lang}" class="icon me-2"></span>` +
      (o.reverse ? '<span title="Reverse Holo" class="icon"></span>' : '') +
      '</div>' +
      (o.comment ? `<div class="product-comments me-1 col"><div class="d-none d-lg-block w-100"><span class="d-block text-truncate text-muted fst-italic small">${esc(o.comment)}</span></div></div>` : '')
    );
  }
  const amountOptions = (o) => Array.from({ length: o.count }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  function offerCol(o, cartHtml) {
    return (
      `<div class="col-offer col-auto"><div class="price-container d-none d-md-flex"><div class="d-flex flex-column"><div class="d-flex"><span class="color-primary small text-end text-nowrap fw-bold">${eur(
        o.price
      )}</span></div></div></div><div class="amount-container"><span class="item-count small text-end">${o.count}</span></div>` +
      `<div class="actions-container d-flex">${cartHtml}</div></div>`
    );
  }
  function productCart(o) {
    if (!LOGGED_IN) return '<a href="/en/Pokemon/Login?redirectTo=x" role="button" class="btn btn-sm btn-grey"><span class="fonticon-cart"></span></a>';
    return `<form method="POST" data-ajax-action="ShoppingCart_AddArticle" class="d-flex"><input type="hidden" name="__cmtkn" value="${TOKEN}"><input type="hidden" name="idArticle" value="${o.id}"><select name="amount" class="form-select form-select-sm">${amountOptions(
      o
    )}</select><button type="submit" class="btn btn-sm btn-primary"><span class="fonticon-cart"></span></button></form>`;
  }
  function stockCart(o) {
    if (!LOGGED_IN) return '';
    return `<select name="amount[${o.id}]" form="BuyAllForm" class="form-select form-select-sm">${amountOptions(o)}</select>`;
  }
  function productRow(o) {
    const s = o.seller;
    const type =
      s.type === 'professional'
        ? '<span title="Professional" class="fonticon-users-professional"></span>'
        : s.type === 'powerseller'
        ? '<span title="Powerseller" class="fonticon-users-powerseller"></span>'
        : '';
    return (
      `<div id="articleRow${o.id}" class="row g-0 article-row"><div class="col-sellerProductInfo col"><div class="row g-0"><div class="col-seller col-12 col-lg-auto"><span class="seller-info"><span class="seller-name d-flex">` +
      `<span title="${s.sales}&nbsp;Sales&nbsp;|&nbsp;${s.sales * 3}&nbsp;Available items" class="badge sell-count">${s.sales}</span>` +
      `<span title="Item location: ${s.country}" class="icon"></span><span class="d-flex"><a href="/en/Pokemon/Users/${esc(s.name)}">${esc(s.name)}</a></span>${type}</span></span></div>` +
      `<div class="col-product col-12 col-lg"><div class="row g-0">${attributes(o)}</div></div></div></div>${offerCol(o, productCart(o))}</div>`
    );
  }
  function stockRow(o, p) {
    const check = LOGGED_IN ? `<div class="col-checkbox"><input type="checkbox" name="idArticle[${o.id}]" form="BuyAllForm" class="form-check-input"></div>` : '';
    return (
      `<div id="stockRow${o.id}" class="row g-0 article-row">${check}<div class="col-sellerProductInfo col"><div class="row g-0"><div class="col-seller col-12 col-lg-auto"><a href="/en/${p.key}">${esc(p.name)}</a></div>` +
      `<div class="col-product col-12 col-lg"><div class="row g-0">${attributes(o)}</div></div></div></div>${offerCol(o, stockCart(o))}</div>`
    );
  }

  const header = () =>
    LOGGED_IN
      ? '<header><a href="/en/Pokemon/ShoppingCart" id="cart">Panier</a></header>'
      : `<header><form method="POST" action="/en/Pokemon/PostGetAction/User_Login" id="header-login"><input type="hidden" name="__cmtkn" value="${TOKEN}"></form></header>`;

  function matchesFilters(o, q) {
    const langIds = { English: 1, French: 2, German: 3, Japanese: 7 };
    const condIds = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 };
    if (q.get('language') && !q.get('language').split(',').includes(String(langIds[o.lang]))) return false;
    if (o.cond && q.get('minCondition') && condIds[o.cond] > +q.get('minCondition')) return false;
    if (q.get('isReverseHolo') === 'N' && o.reverse) return false;
    return true;
  }

  const PAGE = 50;
  function productPage(key, q) {
    const p = productOf(key);
    const list = offers[key].filter((o) => matchesFilters(o, q));
    const first = list.slice(0, PAGE);
    const more = list.length > PAGE;
    const form = more
      ? `<form method="POST" data-ajax-action="Product_LoadMoreArticles"><input type="hidden" name="__cmtkn" value="${TOKEN}"><input type="hidden" name="page" value="1"><input type="hidden" name="filterSettings" value="${esc(
          q.toString()
        )}"><input type="hidden" name="idProduct" value="${esc(key)}"><button type="submit" id="loadMoreButton">Show more results</button></form>`
      : '';
    const category = p.category === 'Singles' ? 'Singles' : p.category.replace(/-/g, ' ');
    return `<!doctype html><html><head><title>${esc(p.name)}</title></head><body>${header()}
      <div class="page-title-container"><h1>${esc(p.name)}<span class="h4 text-muted"> Scarlet &amp; Violet 151 - ${category}</span></h1></div>
      <div class="info-list-container"><dl class="labeled">${p.number ? `<dt>Number</dt><dd>${p.number}</dd>` : ''}<dt>Printed in</dt><dd><a href="/en/Pokemon/Expansions/${EXP}">151</a></dd><dt>Available items</dt><dd>${
      list.length
    }</dd><dt>Price Trend</dt><dd><span>${eur(p.base * 1.2)}</span></dd></dl></div>
      <div id="image"><img class="is-front" src="${p.image}"></div>
      <div class="table article-table"><div class="table-body">${first.map(productRow).join('')}</div></div>${form}</body></html>`;
  }

  function loadMore(body) {
    const key = body.get('idProduct');
    const page = +body.get('page');
    const q = new URLSearchParams(body.get('filterSettings'));
    const list = offers[key].filter((o) => matchesFilters(o, q));
    const chunk = list.slice(page * PAGE, (page + 1) * PAGE);
    const next = (page + 1) * PAGE < list.length ? page + 1 : -1;
    const b64 = btoa(unescape(encodeURIComponent(chunk.map(productRow).join(''))));
    return `<?xml version="1.0" encoding="UTF-8"?><ajaxResponse><rows>${b64}</rows><newPage>${next}</newPage><maxPaginatedResultsReached>0</maxPaginatedResultsReached></ajaxResponse>`;
  }

  function stockPage(sellerName, name) {
    const rows = [];
    for (const p of PRODUCTS) {
      if (p.category !== 'Singles' || !p.name.toLowerCase().startsWith(name.toLowerCase())) continue;
      for (const o of offers[p.key]) if (o.seller.name === sellerName) rows.push(stockRow(o, p));
    }
    const buyAll = LOGGED_IN
      ? `<form id="BuyAllForm" method="POST" action="/en/Pokemon/PostGetAction/ShoppingCart_AddArticles"><input type="hidden" name="__cmtkn" value="${TOKEN}"><button type="submit">Put selected in cart</button></form>`
      : '';
    return `<!doctype html><html><head><title>Singles | Cardmarket</title></head><body>${header()}<div class="table-body">${rows.join('')}</div>${buyAll}</body></html>`;
  }

  const CATEGORY_IDS = { 1: ['Singles'], 2: ['Boosters'], 3: ['Booster-Boxes'], 4: ['Sealed-Products'], 6: ['Sets-Lots-Collections'] };
  const fold = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function productListRow(p, locale) {
    const exp = EXPANSIONS.find((e) => e.slug === p.exp);
    return `<div id="productRow${p.slug}" class="row g-0"><div data-testid="preview" class="col-icon"><span data-bs-title="<img src=&quot;${
      p.image
    }&quot; alt=&quot;&quot;>" class="thumbnail-icon"></span></div><div data-testid="expansion" class="col-icon"><a href="/${locale}/Pokemon/Expansions/${p.exp}" title="${esc(
      exp[locale === 'fr' ? 'fr' : 'en']
    )}" class="expansion-symbol"></a></div><div class="col"><div data-testid="name"><a href="/${locale}/${p.key}">${esc(nameIn(p, locale))}</a></div><div data-testid="collector_number">${
      p.number
    }</div></div><div data-testid="availability"><span>${offers[p.key].length}</span></div><div data-testid="from_price"><span>${eur(offers[p.key][0].price)}</span></div></div>`;
  }

  // Formulaire de filtre présent sur les pages de liste : toutes les extensions (id → nom).
  const filterForm = (locale) =>
    `<form method="GET" class="filter"><select name="idExpansion"><option value="0">All</option>${EXPANSIONS.map(
      (e) => `<option value="${e.id}">${esc(e[locale === 'fr' ? 'fr' : 'en'])}</option>`
    ).join('')}</select></form>`;

  function searchPage(query, category, locale) {
    const q = fold(query);
    const allowed = CATEGORY_IDS[category];
    const rows = PRODUCTS.filter((p) => (fold(p.name).includes(q) || fold(p.fr).includes(q)) && (!allowed || allowed.includes(p.category))).map((p) =>
      productListRow(p, locale)
    );
    return `<!doctype html><html><head><title>Search</title></head><body>${header()}${filterForm(locale)}<div class="table-body">${rows.join('')}</div></body></html>`;
  }

  /** Liste d'une extension, triée par numéro, avec pagination « Page x of y ». */
  function listingPage(exp, locale, site, perSite) {
    const list = PRODUCTS.filter((p) => p.category === 'Singles' && (!exp || p.exp === exp.slug)).sort((a, b) => a.number.localeCompare(b.number));
    const pages = Math.max(1, Math.ceil(list.length / perSite));
    const rows = list.slice((site - 1) * perSite, site * perSite).map((p) => productListRow(p, locale));
    return `<!doctype html><html><head><title>Singles</title></head><body>${header()}${filterForm(locale)}<div class="table-body">${rows.join(
      ''
    )}</div><div id="pagination"><span>Page ${site} of ${pages}</span></div></body></html>`;
  }

  function addToCart(id, amount) {
    const o = byId.get(+id);
    if (!o || amount < 1 || amount > o.count) return false;
    cart.set(+id, (cart.get(+id) || 0) + amount);
    return true;
  }

  // Une section par vendeur, avec valeur des articles, frais de port et total (libellés anglais).
  const SHIP = { France: 1.35, Germany: 2.2 };
  function cartPage() {
    const bySeller = new Map();
    for (const [id, n] of cart.entries()) {
      const o = byId.get(id);
      const name = o ? o.seller.name : '?';
      if (!bySeller.has(name)) bySeller.set(name, { seller: o && o.seller, rows: [] });
      bySeller.get(name).rows.push({ id, n, price: o ? o.price : 0 });
    }
    const blocks = [...bySeller.values()].map(({ seller, rows }) => {
      const value = rows.reduce((t, r) => t + r.n * r.price, 0);
      const ship = SHIP[seller && seller.country] || 2.6;
      return `<section class="shipment-block"><div><h3>Seller <a href="/en/Pokemon/Users/${esc(seller ? seller.name : '?')}">${esc(
        seller ? seller.name : '?'
      )}</a></h3></div><table id="ArticleTable${esc(seller ? seller.name : 'x')}">${rows
        .map((r) => `<tr data-article-id="${r.id}" data-amount="${r.n}" data-price="${r.price}"><td>${r.n}x</td></tr>`)
        .join('')}</table><div class="summary"><div class="d-flex"><span>Article value</span><span class="item-value">${eur(value)}</span></div><div class="d-flex"><span>Shipping costs</span><span>${eur(
        ship
      )}</span></div><div class="d-flex"><span>Total</span><span>${eur(value + ship)}</span></div></div></section>`;
    });
    return `<!doctype html><html><head><title>Shopping Cart</title></head><body>${header()}${blocks.join('')}</body></html>`;
  }

  // Réglages rapides pour les tests automatisés (tests/harness/index.html?fast)
  if (location.search.includes('fast')) {
    mem['cmr.settings'] = { delayMs: 1000, deepMaxRequests: 15, deepSellers: 4 };
  }

  window.__requests = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.hostname !== 'www.cardmarket.com') return realFetch(input, init);
    window.__requests.push((init.method || 'GET') + ' ' + url.pathname + url.search);
    await new Promise((r) => setTimeout(r, 40));
    const path = decodeURIComponent(url.pathname);
    const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
    const body = init.body;
    if (path.includes('/AjaxAction/Product_LoadMoreArticles')) return html(loadMore(body));
    if (path.includes('/AjaxAction/ShoppingCart_AddArticle')) {
      if (!LOGGED_IN || body.get('__cmtkn') !== TOKEN) return html('<ajaxResponse><error>1</error></ajaxResponse>');
      const ok = addToCart(body.get('idArticle'), +body.get('amount'));
      return html(`<ajaxResponse><success>${ok ? 1 : 0}</success></ajaxResponse>`);
    }
    if (path.includes('/PostGetAction/ShoppingCart_AddArticles')) {
      const params = new URLSearchParams(body);
      if (params.get('__cmtkn') !== TOKEN) return html('bad token', 400);
      for (const [k] of params) {
        const m = k.match(/^idArticle\[(\d+)\]$/);
        if (m) addToCart(m[1], +(params.get(`amount[${m[1]}]`) || 1));
      }
      return html(cartPage());
    }
    if (path.endsWith('/ShoppingCart')) return html(cartPage());
    const locale = (path.match(/^\/([a-z]{2})\//) || [])[1] || 'en';
    const listing = path.match(/\/Products\/Singles(?:\/([^/]+))?$/);
    if (listing) {
      const id = +url.searchParams.get('idExpansion');
      const exp = listing[1] ? EXPANSIONS.find((e) => e.slug === listing[1]) : EXPANSIONS.find((e) => e.id === id);
      return html(listingPage(exp, locale, +(url.searchParams.get('site') || 1), +(url.searchParams.get('perSite') || 20)));
    }
    const stock = path.match(/\/Users\/([^/]+)\/Offers\/Singles$/);
    if (stock) return html(stockPage(stock[1], url.searchParams.get('name') || ''));
    if (path.endsWith('/Products/Search')) {
      // idCategory est propre au jeu (51 = cartes Pokémon) : une autre valeur ne renvoie rien.
      const idCat = url.searchParams.get('idCategory');
      if (idCat && !['0', '51', '52', '53', '1016', '1015', '1014'].includes(idCat)) return html(searchPage('zzz-aucun-produit', null, locale));
      return html(searchPage(url.searchParams.get('searchString') || '', url.searchParams.get('category'), locale));
    }
    const key = path.replace(/^\/[a-z]{2}\//, '');
    if (offers[key]) return html(productPage(key, url.searchParams));
    return html('<html><head><title>Not found</title></head><body></body></html>', 404);
  };
})();
