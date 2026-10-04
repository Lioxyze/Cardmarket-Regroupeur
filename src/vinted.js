/*
 * Regroupeur — Vinted.
 *
 *   1. Recherche dans le dressing d'un vendeur (Vinted n'en propose pas) : le dressing est lu par pages de 96
 *      articles, puis filtré sur place. Les articles cochés ouvrent la page « Créer un lot » déjà remplie
 *      (paramètre item_ids[] de Vinted), sans faire défiler des centaines d'annonces.
 *   2. Sur les vignettes d'annonces : le nom de l'annonce (Vinted ne l'affiche pas) et le prix avec l'envoi
 *      (protection acheteurs + envoi le moins cher vers le compte connecté).
 *
 * Sobriété : rien n'est lu tant que le panneau n'est pas ouvert ; les prix d'envoi ne sont demandés que pour les
 * annonces visibles, une à la fois, gardés en mémoire 24 h ; dans un dressing, 3 lectures suffisent si le vendeur
 * a le même tarif partout. Un refus de Vinted (403 / 429) met tout en pause.
 *
 * Les fonctions de recherche n'utilisent pas le DOM : le même fichier est testé sous Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.CMRV = api;
    if (root.document && root.top === root && /(^|\.)vinted\.fr$/.test(root.location.hostname)) api.start(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- Recherche (sans DOM) ----------

  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const tokens = (s) => {
    const n = norm(s);
    return n ? n.split(' ') : [];
  };

  const isNum = (t) => /^\d+$/.test(t);

  // Une faute de frappe tolérée (lettre en trop, en moins ou changée) pour les mots d'au moins 5 lettres.
  function near(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i === a.length && i === b.length) return true;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }

  function prepare(item) {
    if (!item._n) {
      item._n = norm(`${item.title} ${item.brand || ''}`);
      item._w = item._n ? item._n.split(' ') : [];
    }
    return item;
  }

  // 0 = l'article ne correspond pas ; sinon, plus c'est haut, mieux il correspond.
  function scoreItem(item, toks) {
    prepare(item);
    let total = 0;
    for (const t of toks) {
      let best = 0;
      if (isNum(t)) {
        const v = parseInt(t, 10);
        for (const w of item._w) {
          if (w === t || (isNum(w) && parseInt(w, 10) === v)) best = 3;
          else if (best < 1 && w.includes(t)) best = 1;
        }
      } else {
        for (const w of item._w) {
          if (w === t) best = 3;
          else if (best < 2 && w.startsWith(t)) best = 2;
          else if (best < 1 && w.includes(t)) best = 1;
        }
        if (!best && t.length >= 5 && item._w.some((w) => near(w, t))) best = 0.5;
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  }

  function searchItems(items, query, opts) {
    const sort = (opts && opts.sort) || 'relevance';
    const toks = tokens(query);
    let found = toks.length ? [] : items.map((item, i) => ({ item, score: 0, i }));
    if (toks.length) {
      items.forEach((item, i) => {
        const score = scoreItem(item, toks);
        if (score) found.push({ item, score, i });
      });
    }
    const byPrice = (a, b) => a.item.price - b.item.price;
    if (sort === 'price') found.sort((a, b) => byPrice(a, b) || a.i - b.i);
    else if (sort === 'price-desc') found.sort((a, b) => byPrice(b, a) || a.i - b.i);
    else if (toks.length) found.sort((a, b) => b.score - a.score || byPrice(a, b) || a.i - b.i);
    return found.map((f) => f.item);
  }

  // Une recherche par ligne (« 065 — Tokotoro », « Houndoom (SFA 066) », « - dracaufeu »…).
  function searchList(items, text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/^\s*(?:[-*•]|\d+\s*[x×]\s)\s*/i, '').trim();
      if (!line) continue;
      let results = searchItems(items, line);
      let approx = false;
      if (!results.length) {
        // Sans les numéros ni ce qui est entre parenthèses : le vendeur n'écrit pas toujours le numéro de la carte.
        const nameOnly = tokens(line.replace(/\([^)]*\)/g, ' '))
          .filter((t) => !isNum(t))
          .join(' ');
        if (nameOnly && nameOnly !== norm(line)) {
          results = searchItems(items, nameOnly);
          approx = results.length > 0;
        }
      }
      out.push({ line, results, approx });
    }
    return out;
  }

  // ---------- Lecture des données Vinted (sans DOM) ----------

  function parseEuro(text) {
    const m = String(text || '')
      .replace(/[  \s]/g, '')
      .match(/(\d+(?:[.,]\d{1,2})?)/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }

  const euro = (n) => `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  // « Carapuce – 012/059, marque: Pokémon, état: Très bon état, 4,99 €, 5,94 € Protection acheteurs incluse »
  function cardTitleFromAlt(alt) {
    const s = String(alt || '');
    const cut = s.search(/, (?:marque|état|taille|etat) ?: /i);
    if (cut > 0) return s.slice(0, cut).trim();
    return s.replace(/, \d[\d\s  ]*,\d{2}\s?€.*$/, '').trim();
  }

  function pageContext(pathname) {
    const p = String(pathname || '');
    let m = p.match(/^\/member\/(\d+)\/bundles\/new/);
    if (m) return { kind: 'bundle', sellerId: m[1] };
    m = p.match(/^\/member\/(\d+)(?:[/-]|$)/);
    if (m) return { kind: 'member', sellerId: m[1] };
    m = p.match(/^\/items\/(\d+)/);
    if (m) return { kind: 'item', itemId: m[1] };
    return { kind: p === '/' ? 'home' : 'other' };
  }

  const bundleUrl = (sellerId, ids) => `/member/${sellerId}/bundles/new${ids.length ? '?' + ids.map((id) => `item_ids[]=${id}`).join('&') : ''}`;

  // Protection acheteurs : 0,70 € + 5 % du total des articles (une seule fois pour un lot).
  function bundleEstimate(prices, shipping) {
    const items = Math.round(prices.reduce((a, b) => a + b, 0) * 100) / 100;
    const withFee = prices.length ? Math.round((items * 1.05 + 0.7) * 100) / 100 : 0;
    const total = prices.length && shipping != null ? Math.round((withFee + shipping) * 100) / 100 : null;
    return { items, withFee, total };
  }

  const MINUTE = 60000;
  const fin = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  // Délai entre deux lectures du compteur de messages non lus, en ms ; 0 = ne pas lire.
  //   conversation ouverte, utilisateur actif : 7 s ; messagerie sans conversation ouverte : 15 s
  //   3 à 15 min sans activité : 20 s ; 15 à 30 min : 60 s ; au-delà : arrêt jusqu'au prochain geste
  //   autre page de Vinted : 60 s, puis 3 min, puis arrêt
  //   onglet caché : 60 s pendant 10 min, 2 min jusqu'à 30 min (titre de l'onglet), puis arrêt
  function liveInterval(c) {
    if (!c.visible) return c.hiddenMs < 10 * MINUTE ? MINUTE : c.hiddenMs < 30 * MINUTE ? 2 * MINUTE : 0;
    if (c.idleMs >= 30 * MINUTE) return 0;
    if (c.inbox) return c.idleMs < 3 * MINUTE ? (c.conv ? 7000 : 15000) : c.idleMs < 15 * MINUTE ? 20000 : MINUTE;
    return c.idleMs < 15 * MINUTE ? MINUTE : 3 * MINUTE;
  }

  // L'utilisateur regarde-t-il la page ? Relire une conversation la marque comme lue : on ne le fait que s'il est là.
  // Fenêtre au premier plan et signe de présence depuis moins de 3 min, ou action dans la page depuis moins de 30 s
  // (fenêtre posée à côté d'une autre, survolée à la souris).
  function liveWatched(c) {
    return !!c.visible && ((!!c.focused && c.idleMs < 3 * MINUTE) || c.inputMs < 30000);
  }

  // Que faire d'une nouvelle valeur du compteur : 'first' (référence), 'up' (nouveau message : relire), 'down' (lu
  // quelque part : rien à relire), 'same'.
  function liveDecide(prev, next) {
    if (prev === null || prev === undefined) return 'first';
    return next > prev ? 'up' : next < prev ? 'down' : 'same';
  }

  const amount = (v) => (v && v.amount != null ? Number(v.amount) : v != null && !isNaN(Number(v)) ? Number(v) : null);

  function fromApiItem(raw) {
    const photo = (raw.photos && raw.photos[0]) || raw.photo || null;
    const thumb = photo && ((photo.thumbnails || []).find((t) => t.type === 'thumb150x210') || photo);
    return {
      id: String(raw.id),
      title: raw.title || '',
      brand: raw.brand || '',
      status: raw.status || '',
      price: amount(raw.price) || 0,
      total: amount(raw.total_item_price),
      thumb: (thumb && thumb.url) || '',
      reserved: !!raw.is_reserved,
      unavailable: !!(raw.is_closed || raw.is_hidden || raw.is_draft),
      seller: (raw.user && raw.user.login) || '',
    };
  }

  // ---------- Dans la page ----------

  const PER_PAGE = 96;
  const MAX_PAGES = 40; // 3 840 articles
  const INDEX_TTL = 15 * 60 * 1000;
  const SHIP_TTL = 24 * 3600 * 1000;
  const SHIP_GAP = 450; // ms entre deux lectures de prix d'envoi
  const SHIP_CAP = 150; // lectures par tranche de 10 minutes
  const PAUSE = 10 * 60 * 1000;
  const SHOWN = 60;

  const CSS = `
    :host { all: initial; --bg:#fff; --surface:#f6f7f9; --ink:#1b2130; --ink-2:#5b6475; --line:#dde1e8; --accent:#1f4fd1; --accent-ink:#fff; --ok:#117a55; --ok-soft:#e3f4ec; --warn:#a35a00; --warn-soft:#fdf1df;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.4; color: var(--ink); }
    @media (prefers-color-scheme: dark) { :host { --bg:#171b24; --surface:#1f2430; --ink:#e8ebf1; --ink-2:#a9b1c1; --line:#333a4a; --accent:#7d9bff; --accent-ink:#0d1222; --ok:#4cc08f; --ok-soft:#1b3329; --warn:#f0a74a; --warn-soft:#3a2c17; } }
    *, *::before, *::after { box-sizing: border-box; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    [hidden] { display: none !important; }
    .launch { position: fixed; right: 16px; bottom: 84px; z-index: 2147483000; display: flex; align-items: center; gap: 6px; padding: 9px 14px; border: 0; border-radius: 999px;
      background: var(--accent); color: var(--accent-ink); font-weight: 600; box-shadow: 0 6px 20px rgba(15,23,42,.28); }
    .launch.mini { bottom: 16px; padding: 7px 9px; opacity: .8; }
    .panel { position: fixed; top: 64px; right: 16px; bottom: 84px; width: 400px; max-width: calc(100vw - 32px); z-index: 2147483000; display: flex; flex-direction: column;
      background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 18px 50px rgba(15,23,42,.28); overflow: hidden; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    header .ttl { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    header .ttl span { color: var(--ink-2); }
    .x { border: 0; background: none; font-size: 20px; line-height: 1; padding: 2px 6px; color: var(--ink-2); }
    .body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .find { padding: 10px 12px 6px; display: grid; gap: 8px; }
    .tabs { display: flex; gap: 4px; }
    .tabs button { flex: 1; padding: 5px 8px; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; color: var(--ink-2); }
    .tabs button.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
    input[type=search], textarea, select { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); outline: none; }
    input[type=search]:focus, textarea:focus { border-color: var(--accent); }
    textarea { min-height: 96px; resize: vertical; }
    .bar { display: flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: 12px; }
    .bar .st { flex: 1; min-width: 0; }
    .bar select { width: auto; padding: 3px 6px; font-size: 12px; }
    .link { border: 0; background: none; padding: 0; color: var(--accent); text-decoration: underline; font-size: 12px; }
    .note { margin: 0 12px 6px; padding: 7px 9px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 12px; }
    .res { flex: 1; min-height: 60px; overflow-y: auto; padding: 0 6px 6px; }
    .grp { display: flex; justify-content: space-between; gap: 8px; margin: 10px 6px 2px; font-weight: 600; }
    .grp span { font-weight: 400; color: var(--ink-2); white-space: nowrap; }
    .grp.none { color: var(--warn); }
    .it { display: flex; align-items: center; gap: 9px; padding: 6px; border-radius: 8px; }
    .it:hover { background: var(--surface); }
    .it.in { background: var(--ok-soft); }
    .it img, .it .ph { width: 40px; height: 54px; border-radius: 5px; object-fit: cover; background: var(--surface); flex: none; }
    .it .tx { flex: 1; min-width: 0; }
    .it .t { font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .it .m { color: var(--ink-2); font-size: 12px; }
    .it .m b { color: var(--ink); }
    .tag { display: inline-block; padding: 0 5px; border-radius: 4px; background: var(--warn-soft); color: var(--warn); font-size: 11px; }
    .it .bt { display: flex; flex-direction: column; gap: 4px; flex: none; }
    .btn { padding: 4px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); font-size: 12px; white-space: nowrap; }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
    .btn.on { background: var(--ok); border-color: var(--ok); color: #fff; font-weight: 600; }
    .btn:disabled { opacity: .5; cursor: default; }
    .more { display: block; margin: 8px auto; }
    .empty { padding: 18px 12px; color: var(--ink-2); text-align: center; }
    .lot { border-top: 1px solid var(--line); padding: 9px 12px; display: grid; gap: 6px; background: var(--surface); }
    .lot .sum b { font-size: 14px; }
    .lot .est { color: var(--ink-2); font-size: 12px; }
    .lot .acts { display: flex; gap: 6px; justify-content: flex-end; }
    .lot .acts .btn { padding: 7px 12px; font-size: 13px; }
    .opts { border-top: 1px solid var(--line); padding: 8px 12px; display: grid; gap: 4px; font-size: 12px; color: var(--ink-2); }
    .opts label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .hint { padding: 14px 12px; color: var(--ink-2); }
  `;

  function start(root) {
    const doc = root.document;
    const loc = root.location;
    const cs = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    const S = {
      ctx: { kind: 'other' },
      href: '',
      open: false,
      mode: 'one',
      q: '',
      listText: '',
      sort: 'relevance',
      limit: SHOWN,
      items: [],
      byId: new Map(),
      load: { state: 'idle' },
      wanted: new Set(), // articles cochés (page du vendeur) ou en attente d'ajout (page du lot)
      pageSel: new Set(), // articles déjà dans le lot affiché par Vinted
      settings: { titles: true, shipping: true, live: true },
      cmList: 0,
    };

    // --- petits rangements : sessionStorage pour la visite en cours, chrome.storage pour le reste ---
    const ssGet = (k) => {
      try {
        return JSON.parse(root.sessionStorage.getItem(k));
      } catch (e) {
        return null;
      }
    };
    const ssSet = (k, v) => {
      try {
        root.sessionStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* quota : tant pis, on relira */
      }
    };
    const csGet = async (keys) => {
      try {
        return cs ? await cs.get(keys) : {};
      } catch (e) {
        return {};
      }
    };
    const csSet = (obj) => {
      try {
        if (cs) Promise.resolve(cs.set(obj)).catch(() => {});
      } catch (e) {
        /* extension rechargée */
      }
    };

    // ---------- Refus de Vinted (403 / 429) ----------
    // Un refus met en pause TOUTES les lectures de l'extension (direct, prix d'envoi, dressing), dans tous les onglets
    // et après un rechargement : insister pendant un blocage le prolonge. 10 min, doublées si la reprise est encore
    // refusée (30 min au plus).
    const BLOCK_KEY = 'cmrv.block';
    const block = { until: 0 };
    function readBlock() {
      try {
        const v = JSON.parse(root.localStorage.getItem(BLOCK_KEY));
        return v && typeof v === 'object' ? { until: fin(v.until), n: fin(v.n) } : { until: 0, n: 0 };
      } catch (e) {
        return { until: 0, n: 0 };
      }
    }
    const blockedUntil = () => Math.max(block.until, Math.min(readBlock().until, Date.now() + 30 * MINUTE));
    // Les lectures secondaires (prix d'envoi, dressing) ne reprennent que 15 s après la fin de la pause : la
    // première lecture du direct sert de test.
    const refused = () => {
      const until = blockedUntil();
      return until > 0 && Date.now() < until + 15000;
    };
    function noteRefusal() {
      const now = Date.now();
      const b = readBlock();
      if (now < Math.max(block.until, b.until)) return; // déjà en pause : un refus ne compte qu'une fois
      const n = Math.min(b.n + 1, 3);
      block.until = now + Math.min(PAUSE * 2 ** (n - 1), 30 * MINUTE);
      try {
        root.localStorage.setItem(BLOCK_KEY, JSON.stringify({ until: block.until, n }));
      } catch (e) {
        /* stockage indisponible : la pause vaut pour cet onglet */
      }
    }
    function noteSuccess() {
      const b = readBlock();
      if (!b.n || Date.now() < b.until) return;
      try {
        root.localStorage.removeItem(BLOCK_KEY);
      } catch (e) {
        /* sans importance */
      }
    }
    // Le vrai code de réponse des lectures de l'extension et de celles qu'elle fait faire à Vinted, quelle que soit
    // la façon dont le code de Vinted présente ses erreurs.
    const WATCHED = /\/api\/v2\/(conversations\/stats|inbox\b|conversations\/\d+|wardrobe\/|items\/\d+\/shipping_details)|\/messaging\/main\//;
    try {
      new root.PerformanceObserver((list) => {
        for (const e of list.getEntries()) if ((e.responseStatus === 403 || e.responseStatus === 429) && WATCHED.test(e.name)) noteRefusal();
      }).observe({ type: 'resource', buffered: false });
    } catch (e) {
      /* navigateur sans cette mesure : les codes lus directement suffisent */
    }

    // ---------- Vignettes d'annonces de la page ----------

    // Deux formats : « product-item-id-123 » (dressing, recherche, lot) et « feed-item » (page d'accueil).
    // Dans les deux, le lien « …--overlay-link » porte l'identifiant de l'annonce.
    const LINK = 'a[data-testid$="--overlay-link"]';
    const linkId = (a) => ((a && a.getAttribute('href')) || '').match(/\/items\/(\d+)/);
    const cardId = (el) => {
      const m = linkId(el.querySelector(LINK)) || (el.getAttribute('data-testid') || '').match(/^product-item-id-(\d+)$/);
      return m ? m[1] : null;
    };
    const cardOf = (a) => a.closest(`[data-testid="${a.getAttribute('data-testid').slice(0, -'--overlay-link'.length)}"]`);
    const cardEls = () => [...doc.querySelectorAll(LINK)].filter(linkId).map(cardOf).filter(Boolean);
    const cardEl = (id) => {
      const el = doc.querySelector(`[data-testid="product-item-id-${id}"]`);
      if (el) return el;
      const a = [...doc.querySelectorAll(`${LINK}[href^="/items/${id}"]`)].find((x) => linkId(x)[1] === String(id));
      return a ? cardOf(a) : null;
    };
    const cardBox = (el) => el.closest('[data-testid="grid-item"]') || el;

    function cardInfo(el) {
      const img = el.querySelector('img');
      const link = el.querySelector('a[title]');
      const price = parseEuro((el.querySelector('[data-testid$="--price-text"]') || {}).textContent);
      const total = parseEuro((el.querySelector('[data-testid="total-combined-price"]') || {}).textContent);
      return {
        id: cardId(el),
        title: cardTitleFromAlt((img && img.alt) || (link && link.title) || ''),
        brand: '',
        status: ((el.querySelector('[data-testid$="--description-subtitle"]') || {}).textContent || '').trim(),
        price: price || 0,
        total: total != null ? total : price != null ? Math.round((price * 1.05 + 0.7) * 100) / 100 : null,
        thumb: (img && img.src) || '',
        reserved: false,
        unavailable: false,
        seller: '',
      };
    }

    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < root.innerHeight && r.width > 0;
    };

    // ---------- Prix d'envoi ----------

    const ship = { cache: new Map(), queue: [], queued: new Set(), busy: false, pausedUntil: 0, stamps: [], seller: null, saveTimer: 0 };

    async function loadShipCache() {
      const r = await csGet(['cmrv.ship', 'cmrv.settings']);
      const now = Date.now();
      for (const [id, v] of Object.entries(r['cmrv.ship'] || {})) if (now - v[2] < SHIP_TTL) ship.cache.set(id, { amount: v[0], kind: v[1], at: v[2] });
      Object.assign(S.settings, r['cmrv.settings'] || {});
    }

    function saveShipSoon() {
      clearTimeout(ship.saveTimer);
      ship.saveTimer = setTimeout(() => {
        const entries = [...ship.cache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 1500);
        csSet({ 'cmrv.ship': Object.fromEntries(entries.map(([id, v]) => [id, [v.amount, v.kind, v.at]])) });
      }, 2000);
    }

    // Dans un dressing, le tarif est en général le même partout : 3 annonces identiques suffisent.
    function sellerShip() {
      if (!S.ctx.sellerId) return null;
      if (!ship.seller || ship.seller.id !== S.ctx.sellerId) ship.seller = Object.assign({ id: S.ctx.sellerId, samples: [] }, ssGet(`cmrv.ship.${S.ctx.sellerId}`) || {});
      return ship.seller;
    }

    function noteSellerSample(id, info) {
      const s = sellerShip();
      if (!s || info.kind !== 'price' || s.samples.some((x) => x[0] === id)) return;
      s.samples.push([id, info.amount]);
      if (s.samples.length >= 3 && s.uniform == null) {
        s.uniform = s.samples.every((x) => x[1] === s.samples[0][1]);
        if (s.uniform) s.amount = s.samples[0][1];
      }
      ssSet(`cmrv.ship.${s.id}`, { samples: s.samples, uniform: s.uniform, amount: s.amount });
    }

    // { amount, kind: 'price' | 'free' | 'pickup' | 'none', est } ou null si pas encore connu.
    function shipFor(id) {
      const hit = ship.cache.get(id);
      if (hit) return hit;
      const s = sellerShip();
      if (s && s.uniform) return { amount: s.amount, kind: 'price', est: true };
      return null;
    }

    function wantShip(id, front) {
      if (ship.cache.has(id) || ship.queued.has(id)) return;
      ship.queued.add(id);
      if (front) ship.queue.unshift(id);
      else ship.queue.push(id);
      pumpShip();
    }

    async function pumpShip() {
      if (ship.busy) return;
      ship.busy = true;
      try {
        while (ship.queue.length) {
          const now = Date.now();
          if (now < ship.pausedUntil || refused()) break;
          ship.stamps = ship.stamps.filter((t) => now - t < PAUSE);
          if (ship.stamps.length >= SHIP_CAP) {
            ship.pausedUntil = ship.stamps[0] + PAUSE;
            break;
          }
          const id = ship.queue.shift();
          ship.queued.delete(id);
          if (ship.cache.has(id)) continue;
          const el = cardEl(id);
          const s = sellerShip();
          // L'annonce n'est plus à l'écran (ou le vendeur est déjà connu) : inutile de la demander.
          if (!ship.force.has(id) && (!el || !visible(el) || (s && s.uniform))) continue;
          ship.force.delete(id);
          ship.stamps.push(now);
          let info = { amount: null, kind: 'none', at: now };
          try {
            const r = await root.fetch(`/api/v2/items/${id}/shipping_details`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
            if (r.status === 403 || r.status === 429 || r.status === 401) {
              ship.pausedUntil = Date.now() + PAUSE;
              if (r.status !== 401) noteRefusal();
              break;
            }
            if (r.ok) {
              noteSuccess();
              const d = (await r.json()).shipping_details || {};
              if (d.pickup_only) info.kind = 'pickup';
              else if (d.free_shipping) Object.assign(info, { kind: 'free', amount: 0 });
              else if (amount(d.price) != null) Object.assign(info, { kind: 'price', amount: amount(d.price) });
            }
          } catch (e) {
            /* réseau : on garde « inconnu » */
          }
          ship.cache.set(id, info);
          noteSellerSample(id, info);
          saveShipSoon();
          decorate();
          renderLot();
          await sleep(SHIP_GAP);
        }
      } finally {
        ship.busy = false;
        ship.queue = ship.queue.filter((id) => !ship.cache.has(id));
        if (ship.queue.length && (ship.pausedUntil > Date.now() || refused())) {
          ship.queue = [];
          ship.queued.clear();
        }
      }
    }
    ship.force = new Set();

    // ---------- Nom de l'annonce et prix avec envoi, sous chaque vignette ----------

    function shipLine(card, info) {
      if (!info) return null;
      if (info.kind === 'pickup') return { text: 'Remise en main propre', tip: 'Ce vendeur ne propose pas d’envoi pour cette annonce.' };
      if (info.kind === 'free') return { text: 'Envoi offert', tip: 'Envoi offert sur cette annonce.' };
      if (info.kind !== 'price' || card.total == null) return null;
      const dear = info.amount >= 4;
      return {
        text: `${info.est ? '≈ ' : ''}${euro(card.total + info.amount)} avec envoi${dear ? ` (dont ${euro(info.amount)} d’envoi)` : ''}`,
        tip: `Protection acheteurs incluse + envoi à partir de ${euro(info.amount)} (option la moins chère vers ton compte)${info.est ? ' — estimé d’après les autres annonces de ce vendeur' : ''}.`,
        dear,
      };
    }

    function decorate() {
      const on = S.settings.titles || S.settings.shipping;
      // Page d'un lot : l'envoi n'est payé qu'une fois, il est compté dans l'estimation du panneau.
      const showShip = S.settings.shipping && S.ctx.kind !== 'bundle';
      for (const el of cardEls()) {
        let lab = el.querySelector('[data-cmrv-label]');
        if (!on) {
          if (lab) lab.remove();
          continue;
        }
        const card = cardInfo(el);
        const info = showShip ? shipFor(card.id) : null;
        if (showShip && !info && visible(el)) wantShip(card.id);
        const line = shipLine(card, info);
        const key = `${S.settings.titles ? card.title : ''}|${line ? line.text : ''}`;
        if (lab && lab.dataset.k === key) continue;
        if (!lab) {
          lab = doc.createElement('div');
          lab.setAttribute('data-cmrv-label', '');
          lab.style.cssText = 'margin-top:4px;font-size:12px;line-height:1.3;text-align:left;';
          const anchor = el.querySelector('[data-testid$="--breakdown"]') || el.querySelector('[data-testid$="--title-container"]');
          (anchor ? anchor.parentElement : el).appendChild(lab);
        }
        lab.dataset.k = key;
        lab.textContent = '';
        if (line) {
          const p = doc.createElement('div');
          p.textContent = line.text;
          p.title = line.tip;
          p.style.cssText = `font-weight:600;${line.dear ? 'color:#c2410c;' : 'opacity:.8;'}`;
          lab.appendChild(p);
        }
        if (S.settings.titles && card.title) {
          const p = doc.createElement('div');
          p.textContent = card.title;
          p.title = card.title;
          p.style.cssText = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;opacity:.9;';
          lab.appendChild(p);
        }
      }
      decorateItemPage();
    }

    // Page d'une annonce : Vinted affiche l'envoi à part ; on l'additionne.
    function decorateItemPage() {
      const old = doc.querySelector('[data-cmrv-total]');
      if (S.ctx.kind !== 'item' || !S.settings.shipping) {
        if (old) old.remove();
        return;
      }
      const box = doc.querySelector('[data-testid="item-sidebar-price-container"]');
      const banner = doc.querySelector('[data-testid="item-shipping-banner-price"]');
      if (!box || !banner) return;
      const total = parseEuro((box.querySelector('[data-testid="total-combined-price"]') || {}).textContent);
      const send = parseEuro(banner.textContent);
      if (total == null || send == null) return;
      const text = `${euro(total + send)} avec envoi (à partir de ${euro(send)})`;
      if (old && old.textContent === text && old.parentElement === box) return;
      if (old) old.remove();
      const p = doc.createElement('div');
      p.setAttribute('data-cmrv-total', '');
      p.textContent = text;
      p.title = 'Protection acheteurs incluse + envoi le moins cher vers ton compte.';
      p.style.cssText = `margin-top:6px;font-size:14px;font-weight:600;${send >= 4 ? 'color:#c2410c;' : ''}`;
      box.appendChild(p);
    }

    // ---------- Lecture du dressing ----------

    function setItems(list) {
      S.items = list;
      S.byId = new Map(list.map((it) => [it.id, it]));
    }

    function addItems(list) {
      let added = 0;
      for (const it of list) {
        if (it.unavailable || S.byId.has(it.id)) continue;
        S.items.push(it);
        S.byId.set(it.id, it);
        added++;
      }
      return added;
    }

    // Secours si Vinted refuse la lecture complète : les annonces déjà affichées dans la page.
    const harvestDom = () => addItems(cardEls().map(cardInfo).filter((c) => c.title));

    async function loadIndex(force) {
      const seller = S.ctx.sellerId;
      if (!seller) return;
      if (!force && S.load.seller === seller && S.load.state !== 'idle') return;
      const cached = !force && ssGet(`cmrv.idx.${seller}`);
      if (cached && Date.now() - cached.at < INDEX_TTL) {
        setItems(cached.items);
        S.load = { seller, state: 'done', total: cached.items.length };
        return renderAll();
      }
      setItems([]);
      if (!force && refused()) {
        S.load = { seller, state: 'blocked', total: 0 };
        harvestDom();
        return renderAll();
      }
      S.load = { seller, state: 'loading', page: 0, pages: 1, total: 0 };
      renderAll();
      let pages = 1;
      for (let page = 1; page <= pages && page <= MAX_PAGES; page++) {
        if (S.ctx.sellerId !== seller) return;
        let data = null;
        try {
          const r = await root.fetch(`/api/v2/wardrobe/${seller}/items?page=${page}&per_page=${PER_PAGE}&order=relevance`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
          if (!r.ok) {
            S.load.state = r.status === 403 || r.status === 429 ? 'blocked' : 'error';
            if (S.load.state === 'blocked') noteRefusal();
            break;
          }
          data = await r.json();
        } catch (e) {
          S.load.state = 'error';
          break;
        }
        if (S.ctx.sellerId !== seller) return;
        addItems((data.items || []).map(fromApiItem));
        const pg = data.pagination || {};
        pages = pg.total_pages || 1;
        Object.assign(S.load, { page, pages, total: pg.total_entries || S.items.length });
        renderAll();
        if (page < pages) await sleep(700);
      }
      if (S.load.state === 'loading') {
        S.load.state = 'done';
        S.load.capped = pages > MAX_PAGES;
        ssSet(`cmrv.idx.${seller}`, { at: Date.now(), items: S.items.map(({ _n, _w, ...it }) => it) });
      } else harvestDom();
      renderAll();
      // Un prix d'envoi pour l'estimation du lot, même si les vignettes ne l'affichent pas.
      const s = sellerShip();
      if (S.load.state === 'done' && S.items[0] && s && !s.samples.length) {
        ship.force.add(S.items[0].id);
        wantShip(S.items[0].id, true);
      }
    }

    // ---------- Le lot ----------

    const wantedKey = () => `cmrv.lot.${S.ctx.sellerId}`;
    const saveWanted = () => ssSet(wantedKey(), [...S.wanted]);

    function syncPage() {
      if (S.ctx.kind !== 'bundle') return false;
      const sel = new Set();
      for (const btn of doc.querySelectorAll('[data-testid="remove-button"]')) {
        const el = cardBox(btn).querySelector('[data-testid^="product-item-id-"]');
        if (el) sel.add(cardId(el));
      }
      let changed = sel.size !== S.pageSel.size || [...sel].some((id) => !S.pageSel.has(id));
      S.pageSel = sel;
      for (const id of sel) if (S.wanted.delete(id)) changed = true;
      if (changed) saveWanted();
      return changed;
    }

    function toggleLot(id) {
      if (S.ctx.kind === 'bundle') {
        const el = cardEl(id);
        const btn = el && cardBox(el).querySelector(S.pageSel.has(id) ? '[data-testid="remove-button"]' : '[data-testid="add-button"]');
        if (btn) btn.click();
        else if (S.wanted.has(id)) S.wanted.delete(id);
        else if (!S.pageSel.has(id)) S.wanted.add(id);
        setTimeout(() => syncPage() && renderAll(), 250);
      } else if (S.wanted.has(id)) S.wanted.delete(id);
      else S.wanted.add(id);
      saveWanted();
      renderResults();
      renderLot();
    }

    function applyLot() {
      const ids = S.ctx.kind === 'bundle' ? [...S.pageSel, ...S.wanted] : [...S.wanted];
      if (!ids.length) return;
      loc.assign(bundleUrl(S.ctx.sellerId, ids));
    }

    function see(id) {
      const el = cardEl(id);
      if (!el) return root.open(`/items/${id}`, '_blank', 'noopener');
      const box = cardBox(el);
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = box.style.cssText;
      box.style.cssText += ';outline:3px solid #1f4fd1;outline-offset:2px;border-radius:8px;transition:outline-color .4s;';
      setTimeout(() => (box.style.cssText = prev), 2500);
    }

    // ---------- Panneau ----------

    const host = doc.createElement('div');
    host.id = 'cmrv-host';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${CSS}</style>
      <button class="launch" data-act="toggle"></button>
      <section class="panel" hidden>
        <header><div class="ttl"><b>Regroupeur</b> <span id="who"></span></div><button class="x" data-act="toggle" aria-label="Fermer">×</button></header>
        <div class="body" id="seller">
          <div class="find">
            <div class="tabs"><button data-act="mode" data-mode="one">Une recherche</button><button data-act="mode" data-mode="list">Une liste</button></div>
            <input id="q" type="search" placeholder="Nom, numéro… ex. dracaufeu 006" autocomplete="off" />
            <div id="listbox" hidden>
              <textarea id="ql" placeholder="Une carte par ligne :&#10;065 Tokotoro&#10;Carapuce 012&#10;dracaufeu ex"></textarea>
              <button class="link" data-act="import" id="import" hidden></button>
            </div>
            <div class="bar"><span class="st" id="status"></span>
              <select id="sort" aria-label="Tri"><option value="relevance">Pertinence</option><option value="price">Prix croissant</option><option value="price-desc">Prix décroissant</option></select></div>
          </div>
          <div id="note"></div>
          <div class="res" id="results"></div>
          <div class="lot" id="lot" hidden></div>
        </div>
        <div class="hint" id="hint" hidden>Ouvre le dressing d’un vendeur (ou sa page « Créer un lot ») pour chercher dans ses articles et préparer un lot.</div>
        <div class="opts">
          <label><input type="checkbox" id="opt-shipping" /> Prix avec envoi sous les annonces</label>
          <label><input type="checkbox" id="opt-titles" /> Nom de l’annonce sous les annonces</label>
          <label><input type="checkbox" id="opt-live" /> Messages en direct (messagerie, pastille, titre de l’onglet)</label>
        </div>
      </section>`;
    const $ = (sel) => sh.querySelector(sel);

    function itemRow(it) {
      const inLot = S.pageSel.has(it.id);
      const pending = S.wanted.has(it.id);
      const bundle = S.ctx.kind === 'bundle';
      const label = inLot ? '✓ Dans le lot' : pending ? (bundle ? '✓ À ajouter' : '✓ Dans le lot') : '+ Lot';
      const price = `<b>${esc(euro(it.price))}</b>${it.total != null ? ` · ${esc(euro(it.total))} incl.` : ''}`;
      return `<div class="it${inLot || pending ? ' in' : ''}">
        ${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy" />` : '<div class="ph"></div>'}
        <div class="tx"><div class="t" title="${esc(it.title)}">${esc(it.title)}</div>
          <div class="m">${price}${it.status ? ` · ${esc(it.status)}` : ''}${it.reserved ? ' <span class="tag">Réservé</span>' : ''}</div></div>
        <div class="bt"><button class="btn${inLot || pending ? ' on' : ' primary'}" data-act="lot" data-id="${esc(it.id)}"${it.reserved && !inLot && !pending ? ' disabled' : ''}>${label}</button>
          <button class="btn" data-act="see" data-id="${esc(it.id)}" title="Montrer l’annonce dans la page, ou l’ouvrir dans un nouvel onglet">Voir</button></div>
      </div>`;
    }

    function renderStatus() {
      const l = S.load;
      let text = '';
      if (l.state === 'loading') text = `Lecture du dressing… ${S.items.length}${l.total ? ` / ${l.total}` : ''}`;
      else if (l.state === 'done') text = `${S.items.length} article${S.items.length > 1 ? 's' : ''}${l.capped ? ' (dressing très grand : début seulement)' : ''}`;
      else if (l.state === 'blocked' || l.state === 'error') text = `${S.items.length} article${S.items.length > 1 ? 's' : ''} lus`;
      $('#status').textContent = text;
      $('#note').innerHTML =
        l.state === 'blocked' || l.state === 'error'
          ? `<div class="note">${l.state === 'blocked' ? 'Vinted a refusé la lecture complète du dressing pour le moment.' : 'Lecture du dressing interrompue.'} La recherche porte sur les articles déjà lus et sur ceux affichés dans la page. <button class="link" data-act="reload">Réessayer</button></div>`
          : '';
      const first = S.items.find((it) => it.seller);
      const name = (doc.querySelector('[data-testid="profile-username"]') || {}).textContent || (first && first.seller) || '';
      $('#who').textContent = name ? `· dressing de ${name.trim()}` : '';
    }

    function renderResults() {
      const box = $('#results');
      if (S.mode === 'list') {
        const groups = searchList(S.items, S.listText);
        if (!groups.length) {
          box.innerHTML = '<div class="empty">Colle ta liste : une carte par ligne. Chaque ligne est cherchée dans ce dressing.</div>';
          return;
        }
        const found = groups.filter((g) => g.results.length).length;
        box.innerHTML =
          `<div class="grp"><span>${found} sur ${groups.length} trouvée${found > 1 ? 's' : ''} chez ce vendeur</span></div>` +
          groups
            .map((g) => {
              const n = g.results.length;
              const head = `<div class="grp${n ? '' : ' none'}">${esc(g.line)}<span>${n ? `${n} annonce${n > 1 ? 's' : ''}${g.approx ? ' (nom seul)' : ''}` : 'introuvable'}</span></div>`;
              const sorted = S.sort === 'relevance' ? g.results : searchItems(g.results, '', { sort: S.sort });
              return head + sorted.slice(0, 6).map(itemRow).join('') + (n > 6 ? `<div class="empty" style="padding:2px">+ ${n - 6} autres : cherche « ${esc(g.line)} » dans « Une recherche »</div>` : '');
            })
            .join('');
        return;
      }
      let results = searchItems(S.items, S.q, { sort: S.sort });
      // Sans recherche : les articles du lot d'abord, pour les retrouver et les retirer facilement.
      if (!tokens(S.q).length) {
        const mine = (it) => S.pageSel.has(it.id) || S.wanted.has(it.id);
        results = results.filter(mine).concat(results.filter((it) => !mine(it)));
      }
      if (!results.length) {
        box.innerHTML = `<div class="empty">${S.load.state === 'loading' ? 'Lecture en cours…' : S.q ? `Aucune annonce pour « ${esc(S.q)} » chez ce vendeur.` : 'Aucun article.'}</div>`;
        return;
      }
      const head = S.q ? `<div class="grp"><span>${results.length} annonce${results.length > 1 ? 's' : ''}</span></div>` : '';
      box.innerHTML = head + results.slice(0, S.limit).map(itemRow).join('') + (results.length > S.limit ? `<button class="btn more" data-act="more">Afficher la suite (${results.length - S.limit})</button>` : '');
    }

    function renderLot() {
      const box = $('#lot');
      const bundle = S.ctx.kind === 'bundle';
      const ids = bundle ? [...S.pageSel, ...S.wanted] : [...S.wanted];
      if (!ids.length) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      const prices = ids.map((id) => {
        const it = S.byId.get(id);
        if (it) return it.price;
        const el = cardEl(id);
        return el ? cardInfo(el).price : 0;
      });
      const s = sellerShip();
      const known = ids.map((id) => ship.cache.get(id)).filter((x) => x && x.kind === 'price');
      const send = known.length ? Math.max(...known.map((x) => x.amount)) : s && s.samples.length ? Math.max(...s.samples.map((x) => x[1])) : null;
      const est = bundleEstimate(prices, send);
      const pend = bundle ? S.wanted.size : 0;
      box.innerHTML = `<div class="sum">Lot : <b>${ids.length} article${ids.length > 1 ? 's' : ''} · ${esc(euro(est.items))}</b>${pend ? ` <span class="tag">${pend} à ajouter</span>` : ''}</div>
        <div class="est">${
          est.total != null
            ? `≈ <b>${esc(euro(est.total))}</b> avec protection acheteurs et envoi (à partir de ${esc(euro(send))}), hors réduction de lot du vendeur`
            : `≈ ${esc(euro(est.withFee))} avec protection acheteurs, envoi en plus`
        }</div>
        <div class="acts"><button class="btn" data-act="clear">${bundle ? 'Annuler les ajouts' : 'Vider'}</button>
          ${bundle ? (pend ? `<button class="btn primary" data-act="apply">Ajouter au lot (${pend})</button>` : '') : `<button class="btn primary" data-act="apply">Créer le lot →</button>`}</div>`;
      if (bundle && !pend) box.querySelector('[data-act="clear"]').hidden = true;
    }

    function renderAll() {
      const seller = !!S.ctx.sellerId;
      const launch = $('.launch');
      const bar = doc.querySelector('[data-cmrv-bar]');
      launch.hidden = S.open || !!(bar && visible(bar));
      launch.classList.toggle('mini', !seller);
      launch.textContent = seller ? '🔎 Chercher dans ce dressing' : '🔎';
      launch.title = seller ? 'Regroupeur : chercher un article chez ce vendeur et préparer un lot' : 'Regroupeur : réglages Vinted';
      $('.panel').hidden = !S.open;
      if (!S.open) return;
      $('#seller').hidden = !seller;
      $('#hint').hidden = seller;
      $('#opt-shipping').checked = S.settings.shipping;
      $('#opt-titles').checked = S.settings.titles;
      $('#opt-live').checked = S.settings.live;
      if (!seller) return;
      for (const b of sh.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.mode === S.mode);
      $('#q').hidden = S.mode !== 'one';
      $('#listbox').hidden = S.mode !== 'list';
      $('#import').hidden = !S.cmList;
      $('#import').textContent = `Reprendre ma liste Cardmarket (${S.cmList} carte${S.cmList > 1 ? 's' : ''})`;
      renderStatus();
      renderResults();
      renderLot();
    }

    async function cardmarketList() {
      const r = await csGet(['cmr.lists']);
      const active = (r['cmr.lists'] && r['cmr.lists'].active) || 'main';
      const key = active === 'main' ? 'cmr.list' : `cmr.list.${active}`;
      return ((await csGet([key]))[key] || []).filter((c) => c && c.name);
    }

    function setOpen(open) {
      S.open = open;
      csSet({ 'cmrv.ui': { open } });
      renderAll();
      if (open && S.ctx.sellerId) {
        loadIndex();
        cardmarketList().then((list) => {
          S.cmList = list.length;
          if (S.open) $('#import').hidden = !S.cmList || S.mode !== 'list';
          $('#import').textContent = `Reprendre ma liste Cardmarket (${S.cmList} carte${S.cmList > 1 ? 's' : ''})`;
        });
        if (S.mode === 'one') setTimeout(() => $('#q').focus(), 50);
      }
    }

    let typing = 0;
    sh.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'q' || t.id === 'ql') {
        clearTimeout(typing);
        typing = setTimeout(() => {
          if (t.id === 'q') S.q = t.value;
          else S.listText = t.value;
          S.limit = SHOWN;
          renderResults();
        }, 120);
      }
    });
    sh.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'sort') {
        S.sort = t.value;
        renderResults();
      } else if (t.id === 'opt-shipping' || t.id === 'opt-titles' || t.id === 'opt-live') {
        S.settings[t.id.slice(4)] = t.checked;
        csSet({ 'cmrv.settings': S.settings });
        decorate();
      }
    });
    sh.addEventListener('keydown', (e) => {
      e.stopPropagation(); // les raccourcis clavier de Vinted ne doivent pas réagir à la saisie
      if (e.key === 'Escape') setOpen(false);
    });
    sh.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'toggle') setOpen(!S.open);
      else if (act === 'mode') {
        S.mode = b.dataset.mode;
        renderAll();
      } else if (act === 'lot') toggleLot(b.dataset.id);
      else if (act === 'see') see(b.dataset.id);
      else if (act === 'more') {
        S.limit += SHOWN;
        renderResults();
      } else if (act === 'apply') applyLot();
      else if (act === 'clear') {
        S.wanted.clear();
        saveWanted();
        renderResults();
        renderLot();
      } else if (act === 'reload') loadIndex(true);
      else if (act === 'import') {
        const list = await cardmarketList();
        S.listText = list.map((c) => `${String(c.name).replace(/\([^)]*\)/g, ' ').trim()} ${c.number || ''}`.trim()).join('\n');
        $('#ql').value = S.listText;
        renderResults();
      }
    });

    // ---------- Éléments ajoutés dans la page de Vinted (hors panneau) ----------

    const PAGE_CSS = `
      .cmrv-bar{display:flex;align-items:center;gap:10px;width:100%;margin:0 0 16px;padding:12px 16px;border:1px solid #007782;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:16px;text-align:left;cursor:pointer}
      .cmrv-bar:hover{background:rgba(0,119,130,.08)}
      .cmrv-bar span:nth-child(2){flex:1;opacity:.7}
      .cmrv-bar b{font-size:12px;color:#007782;white-space:nowrap}
      .cmrv-ibar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;font-size:13px;border-bottom:1px solid rgba(128,128,128,.25)}
      .cmrv-ibar b{color:#007782}
      .cmrv-ibar span{flex:1;min-width:0;opacity:.8}
      .cmrv-btn{padding:4px 10px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.4;cursor:pointer}
      .cmrv-btn.danger{border-color:#d04555;color:#d04555}
      .cmrv-btn.armed,.cmrv-btn.on{background:#d04555;border-color:#d04555;color:#fff;font-weight:600}
      .cmrv-btn:disabled{opacity:.5;cursor:default}
      .cmrv-del{position:absolute;right:8px;bottom:6px;z-index:2;opacity:.55}
      .cmrv-del:hover,.cmrv-del.armed,.cmrv-del.on{opacity:1}
      .cmrv-live{font-style:normal;font-size:12px;opacity:.75;white-space:nowrap}
      .cmrv-live.on::before{content:'';display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:50%;background:#1a9c5b;vertical-align:1px}
      .cmrv-live.new{opacity:1;font-weight:600;color:#007782}
      .cmrv-toast{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;align-items:flex-start;gap:4px;max-width:340px;padding:4px;border-radius:10px;background:#1b2130;color:#fff;box-shadow:0 10px 30px rgba(15,23,42,.35);font:13px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
      .cmrv-toast button{border:0;background:none;color:inherit;font:inherit;cursor:pointer}
      .cmrv-toast-main{display:grid;gap:2px;padding:8px 10px;text-align:left}
      .cmrv-toast-main span{opacity:.8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .cmrv-toast-x{padding:4px 8px;font-size:16px;opacity:.7}
    `;

    function ensurePageCss() {
      if (doc.getElementById('cmrv-style')) return;
      const st = doc.createElement('style');
      st.id = 'cmrv-style';
      st.textContent = PAGE_CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }

    // Dressing et page du lot : une barre de recherche juste au-dessus des annonces, comme si Vinted la proposait.
    function ensureSearchBar() {
      let bar = doc.querySelector('[data-cmrv-bar]');
      const first = S.ctx.sellerId && cardEls()[0];
      const grid = first && cardBox(first).parentElement;
      if (!grid || !grid.parentElement) {
        if (bar && !S.ctx.sellerId) bar.remove();
        return;
      }
      if (bar && bar.nextElementSibling === grid) return;
      if (bar) bar.remove();
      bar = doc.createElement('button');
      bar.type = 'button';
      bar.className = 'cmrv-bar';
      bar.setAttribute('data-cmrv-bar', '');
      bar.innerHTML = '<span>🔎</span><span>Chercher une carte dans ce dressing…</span><b>Regroupeur</b>';
      bar.title = 'Chercher dans tous les articles de ce vendeur et préparer un lot';
      bar.addEventListener('click', () => setOpen(true));
      grid.parentElement.insertBefore(bar, grid);
    }

    // ---------- Messagerie : supprimer des conversations ----------
    // L'extension déroule le parcours de Vinted à ta place, avec ses propres boutons : ouvrir la conversation,
    // « détails », « Supprimer la conversation », « Oui, supprimer ». Rien n'est supprimé sans une confirmation.

    const TRASH =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="display:block"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.5h6.8l.6-8.5M6.7 7v4M9.3 7v4"/></svg>';
    const inbox = { busy: false, select: false, picked: new Set(), armed: null, timer: 0, msg: '', note: '', restricted: new Set() };
    const convRow = (id) => doc.querySelector(`[data-testid="inbox-list-item-${id}"]`);
    const convRows = () => [...doc.querySelectorAll('[data-testid^="inbox-list-item-"]')].filter((el) => /^inbox-list-item-\d+$/.test(el.getAttribute('data-testid')));
    const convId = (el) => el.getAttribute('data-testid').slice('inbox-list-item-'.length);

    async function until(fn, ms) {
      const t0 = Date.now();
      for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() - t0 > ms) return null;
        await sleep(150);
      }
    }

    // Renvoie null si la conversation a été supprimée, sinon la raison de l'échec.
    async function deleteConversation(id) {
      const row = convRow(id);
      if (!row) return 'conversation introuvable';
      const path = () => loc.pathname.replace(/\/$/, '');
      const here = () => path() === `/inbox/${id}` || path() === `/inbox/${id}/details`;
      const onDetails = () => path() === `/inbox/${id}/details`;
      row.click();
      if (!(await until(here, 8000))) return 'conversation non ouverte';
      // L'en-tête de la conversation précédente reste affiché un instant : on attend le nouveau, puis on clique
      // « détails » jusqu'à ce que l'adresse soit bien celle des détails de CETTE conversation.
      await sleep(500);
      const opened = await until(() => {
        if (onDetails()) return true;
        const b = here() && doc.querySelector('[data-testid="details-button"]');
        if (b) b.click();
        return false;
      }, 8000);
      if (!opened) return 'détails de la conversation non ouverts';
      // Vinted ne propose pas « Supprimer » pour toutes les conversations (commande en cours…).
      const actions = await until(() => onDetails() && doc.querySelectorAll('[data-testid^="conversation-actions-"]').length, 8000);
      if (actions) await sleep(300);
      const del = onDetails() && doc.querySelector('[data-testid="conversation-actions-delete"]');
      if (!del) return 'Vinted ne propose pas de supprimer cette conversation';
      del.click();
      const yes = await until(() => doc.querySelector('[data-testid="confirm-delete-conversation"]'), 5000);
      if (!yes || !onDetails()) return 'confirmation de Vinted introuvable';
      yes.click();
      const gone = await until(() => !convRow(id) || (!here() && !doc.querySelector('[data-testid="confirm-delete-conversation"]')), 10000);
      return gone ? null : 'Vinted n’a pas confirmé la suppression';
    }

    async function deleteMany(ids) {
      inbox.busy = true;
      inbox.armed = null;
      let done = 0;
      const failed = [];
      for (let i = 0; i < ids.length; i++) {
        inbox.msg = `Suppression ${i + 1} / ${ids.length}…`;
        decorateInbox();
        const err = await deleteConversation(ids[i]).catch(() => 'erreur inattendue');
        if (err) failed.push(err);
        else done++;
        await sleep(700);
      }
      inbox.busy = false;
      inbox.select = false;
      inbox.picked.clear();
      inbox.msg = `${done} conversation${done > 1 ? 's' : ''} supprimée${done > 1 ? 's' : ''}${failed.length ? ` · ${failed.length} non supprimée${failed.length > 1 ? 's' : ''} (${failed[0]})` : ''}`;
      decorateInbox();
    }

    function arm(key) {
      inbox.armed = key;
      clearTimeout(inbox.timer);
      inbox.timer = setTimeout(() => {
        inbox.armed = null;
        decorateInbox();
      }, 4000);
    }

    function inboxAct(act, id) {
      if (inbox.busy) return;
      if (act === 'reload') {
        // Recharger efface le message en cours de saisie : un second clic le confirme.
        const draft = (doc.querySelector('[data-testid="composer--input"]') || {}).value;
        if (!draft || inbox.armed === 'reload') return void loc.reload();
        arm('reload');
        return void decorateInbox();
      }
      if (act === 'relist') return void step(() => showNewInList(0));
      if (act === 'del' && inbox.restricted.has(id)) return;
      if (act === 'del') {
        if (inbox.select) {
          if (!inbox.picked.delete(id)) inbox.picked.add(id);
          inbox.armed = null;
        } else if (inbox.armed === id) return void deleteMany([id]);
        else arm(id);
      } else if (act === 'select') {
        inbox.select = !inbox.select;
        inbox.picked.clear();
        inbox.armed = null;
        inbox.msg = inbox.note = '';
      } else if (act === 'all') {
        for (const r of convRows()) if (!inbox.restricted.has(convId(r))) inbox.picked.add(convId(r));
        inbox.armed = null;
      } else if (act === 'delsel') {
        const ids = [...inbox.picked].filter(convRow);
        if (!ids.length) return;
        if (inbox.armed === 'sel') return void deleteMany(ids);
        if (live.listDirty) {
          // Un message est arrivé pendant la sélection : la liste est relue maintenant, avant de confirmer.
          inbox.note = 'liste actualisée : vérifie ta sélection';
          return void step(() => showNewInList(0));
        }
        arm('sel');
      }
      decorateInbox();
    }

    function decorateInbox() {
      if (!/^\/inbox(\/|$)/.test(loc.pathname)) return;
      const rows = convRows();
      const anchor = doc.querySelector('[data-testid^="inbox-list-item-"][data-testid$="-container"]');
      if (!rows.length || !anchor || !anchor.parentElement) return;
      let bar = doc.querySelector('[data-cmrv-ibar]');
      if (!bar || bar.parentElement !== anchor.parentElement) {
        if (bar) bar.remove();
        bar = doc.createElement('div');
        bar.className = 'cmrv-ibar';
        bar.setAttribute('data-cmrv-ibar', '');
        anchor.parentElement.insertBefore(bar, anchor.parentElement.firstChild);
      }
      const n = [...inbox.picked].filter(convRow).length;
      const s = (k) => (k > 1 ? 's' : '');
      const liveHtml = liveBadge();
      const note = inbox.note || (live.listDirty ? 'nouveau message : liste actualisée après la sélection' : '');
      const html = inbox.busy
        ? `<b>Regroupeur</b><span>${esc(inbox.msg)}</span>`
        : inbox.select
          ? `<b>Regroupeur</b><span>${n} cochée${s(n)}${note ? ` · ${esc(note)}` : ''}</span><button class="cmrv-btn" data-cmrv-act="all">Tout cocher</button>
             <button class="cmrv-btn danger${inbox.armed === 'sel' ? ' armed' : ''}" data-cmrv-act="delsel"${n ? '' : ' disabled'}>${inbox.armed === 'sel' ? `Confirmer : supprimer ${n} conversation${s(n)}` : `Supprimer (${n})`}</button>
             <button class="cmrv-btn" data-cmrv-act="select">Annuler</button>`
          : `<b>Regroupeur</b>${liveHtml}<span>${esc(inbox.msg)}</span><button class="cmrv-btn" data-cmrv-act="select">Supprimer plusieurs conversations</button>`;
      if (bar.dataset.k !== html) {
        bar.dataset.k = html;
        bar.innerHTML = html;
      }
      for (const row of rows) {
        const id = convId(row);
        let b = row.querySelector('[data-cmrv-act="del"]');
        if (!b) {
          if (root.getComputedStyle(row).position === 'static') row.style.position = 'relative';
          b = doc.createElement('button');
          b.type = 'button';
          b.setAttribute('data-cmrv-act', 'del');
          row.appendChild(b);
        }
        if (b.dataset.id !== id) b.dataset.id = id; // React peut réutiliser une ligne pour une autre conversation
        const locked = inbox.restricted.has(id);
        const on = inbox.select && !locked && inbox.picked.has(id);
        const armed = !inbox.select && !locked && inbox.armed === id;
        const text = locked ? '' : inbox.select ? (on ? '☑ À supprimer' : '☐ Cocher') : armed ? 'Supprimer ?' : '';
        const cls = `cmrv-btn danger cmrv-del${armed ? ' armed' : ''}${on ? ' on' : ''}`;
        if (b.dataset.t !== text) {
          b.dataset.t = text;
          if (text) b.textContent = text;
          else b.innerHTML = TRASH;
        }
        if (b.className !== cls) b.className = cls;
        b.setAttribute('aria-label', 'Supprimer cette conversation');
        b.title = locked
          ? 'Vinted ne permet pas de supprimer cette conversation pour le moment (commande en cours).'
          : inbox.select
            ? 'Cocher cette conversation'
            : armed
              ? 'Clique encore pour supprimer définitivement cette conversation'
              : 'Supprimer cette conversation';
        b.disabled = inbox.busy || locked;
      }
    }

    // Les clics sur nos boutons ne doivent pas ouvrir la conversation sur laquelle ils sont posés.
    doc.addEventListener(
      'click',
      (e) => {
        const b = e.target && e.target.closest && e.target.closest('[data-cmrv-act]');
        if (!b || b.getRootNode() !== doc) return;
        e.preventDefault();
        e.stopPropagation();
        inboxAct(b.getAttribute('data-cmrv-act'), b.dataset.id);
      },
      true
    );

    // ---------- Messages en direct ----------
    // Vinted ne relit jamais sa messagerie. Ici : lecture régulière du compteur de messages non lus (la requête de la
    // pastille du bandeau, quelques octets). Quand il AUGMENTE, Vinted relit avec son propre code (src/vinted-page.js)
    // la conversation ouverte — seulement si l'utilisateur est devant, car la lire la marque comme lue — puis la
    // liste si le message était ailleurs. Une baisse (conversation lue) ne déclenche aucune requête.
    // Un seul onglet lit à la fois (verrou + heure partagée dans localStorage).

    const LIVE_KEY = 'cmrv.live';
    const LIVE_BUDGET = 700; // lectures par heure, tous onglets confondus
    const started = Date.now();
    const live = {
      busy: false, // lecture du compteur en cours
      refreshing: false, // relecture de la messagerie en cours
      stopped: false, // session expirée : plus rien jusqu'au prochain chargement
      localPauseUntil: 0, // lectures en échec sans code connu
      errors: 0,
      unread: null, // dernière valeur lue par cet onglet
      t: 0, // heure de cette lecture
      preUp: null, // valeur d'avant la dernière hausse
      listDirty: false, // la liste affichée n'est plus à jour
      convDirty: false, // la conversation ouverte non plus
      heal: false, // une relecture a échoué : à refaire après la prochaine lecture réussie
      tries: 0,
      manual: false, // relecture impossible : proposer « Actualiser »
      skipped: false, // liste trop longue pour être relue d'office
      force: false, // lire dès que possible (retour sur l'onglet, entrée dans la messagerie)
      navAt: 0,
      wasInbox: false,
      retryAt: 0,
      fallbackAt: 0,
      jitter: 1,
      listAt: started, // dernière relecture de la liste
      lastRefresh: started,
      lastVisible: started,
      visibleAt: 0,
      lastActive: started, // dernier signe de présence (saisie, souris, retour sur la fenêtre)
      lastInput: 0, // dernière action réelle dans la page (souris, clavier)
      pendingToast: false,
      prefix: '',
      stateAt: 0,
      draft: 0, // longueur du message en cours de saisie
      sentAt: 0, // dernière fois que la zone de saisie s'est vidée : un message vient de partir
    };
    const onInbox = () => /^\/inbox(\/|$)/.test(loc.pathname);
    const openConv = () => {
      const m = loc.pathname.match(/^\/inbox\/([^/]+)/);
      if (!m || m[1] === 'want_it') return null;
      try {
        return decodeURIComponent(m[1]);
      } catch (e) {
        return m[1];
      }
    };

    // --- relais vers la page (src/vinted-page.js) ---
    const bridge = () => doc.documentElement.hasAttribute('data-cmrv-page');
    const pending = new Map();
    root.addEventListener('cmrv:res', (e) => {
      let r;
      try {
        r = JSON.parse(e.detail);
      } catch (err) {
        return;
      }
      const p = r && pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      clearTimeout(p.timer);
      p.resolve(r);
    });
    function ask(op, payload, ms) {
      return new Promise((resolve) => {
        if (!bridge()) return resolve({ ok: false, reason: 'no-bridge' });
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, reason: 'timeout' });
        }, ms);
        pending.set(id, { resolve, timer });
        root.dispatchEvent(new CustomEvent('cmrv:req', { detail: JSON.stringify(Object.assign({ id, op }, payload)) }));
      });
    }

    // --- état partagé entre onglets et entre chargements de page (jamais d'exception, valeurs assainies) ---
    function shared() {
      let v = null;
      try {
        v = JSON.parse(root.localStorage.getItem(LIVE_KEY));
      } catch (e) {
        /* stockage indisponible ou valeur abîmée */
      }
      v = v && typeof v === 'object' ? v : {};
      const now = Date.now();
      return {
        t: Math.min(fin(v.t), now), // dernière lecture du compteur, tous onglets confondus
        unread: typeof v.unread === 'number' && isFinite(v.unread) ? v.unread : null,
        changedAt: Math.min(fin(v.changedAt), now), // dernière hausse observée
        ann: Math.min(fin(v.ann), now), // dernier avis « Nouveau message » affiché
        h: fin(v.h), // heure en cours et nombre de requêtes du direct, pour le plafond horaire
        n: fin(v.n),
      };
    }
    function share(patch) {
      try {
        root.localStorage.setItem(LIVE_KEY, JSON.stringify(Object.assign(shared(), patch)));
      } catch (e) {
        /* stockage indisponible : chaque onglet lit pour lui, à sa cadence */
      }
    }
    const hour = () => Math.floor(Date.now() / 3600000);
    function spend() {
      const s = shared();
      share(s.h === hour() ? { n: s.n + 1 } : { h: hour(), n: 1 });
    }
    const overBudget = () => {
      const s = shared();
      return s.h === hour() && s.n >= LIVE_BUDGET;
    };

    // Repli quand la pastille de Vinted est introuvable dans la page : lecture directe du compteur.
    async function fetchUnread() {
      try {
        const signal = root.AbortSignal && root.AbortSignal.timeout ? root.AbortSignal.timeout(10000) : undefined;
        const r = await root.fetch('/api/v2/conversations/stats', { headers: { accept: 'application/json' }, credentials: 'same-origin', signal });
        if (!r.ok) return { ok: false, reason: 'error', status: r.status };
        const n = Number((await r.json()).unread_msg_count);
        return isFinite(n) ? { ok: true, next: n } : { ok: false, reason: 'error', status: 0 };
      } catch (e) {
        return { ok: false, reason: 'error', status: 0 };
      }
    }

    async function readUnread(maxAgeMs) {
      const res = await ask('poll', { maxAgeMs }, 12000);
      if (res.ok || !(res.reason === 'no-observer' || res.reason === 'no-data')) return res;
      // La page est bien celle de Vinted mais sa pastille est introuvable : lecture directe, après un délai de grâce
      // (page en cours de construction) et jamais plus d'une fois par minute.
      const now = Date.now();
      if (now - started < 10000 || now - live.fallbackAt < MINUTE) return { ok: false, reason: 'wait' };
      live.fallbackAt = now;
      return fetchUnread();
    }

    function dropToast(kind) {
      for (const el of doc.querySelectorAll(kind ? `[data-cmrv-toast="${kind}"]` : '[data-cmrv-toast]')) el.remove();
    }

    // Lit le compteur. « adopt » : relecture juste après avoir lu une conversation, dont la valeur devient la référence
    // sans être traitée comme un changement. Renvoie la valeur lue, ou undefined.
    async function pollUnread(every, adopt) {
      live.busy = true;
      try {
        const run = async () => {
          const s = shared();
          if (!adopt && Date.now() - Math.max(live.t, s.t) < 2500) return undefined; // un autre onglet vient de lire
          const res = await readUnread(adopt ? 0 : every);
          const now = Date.now();
          live.jitter = 0.8 + Math.random() * 0.4;
          if (!res.ok) {
            if (res.reason === 'no-bridge' || res.reason === 'no-react' || res.reason === 'wait') {
              live.retryAt = now + 5000; // aucune requête n'est partie
              return undefined;
            }
            live.t = now;
            spend();
            share({ t: now });
            if (res.status === 403 || res.status === 429) noteRefusal();
            else if (res.status === 401) live.stopped = true;
            else if (++live.errors >= 2) live.localPauseUntil = now + PAUSE; // sans code connu : on double, puis on se tait
            return undefined;
          }
          const at = res.cached ? Math.min(fin(res.at) || now, now) : now;
          if (!res.cached) spend();
          live.errors = 0;
          live.t = at;
          noteSuccess();
          const kind = adopt ? 'adopt' : liveDecide(live.unread, res.next);
          const prev = live.unread;
          live.unread = res.next;
          share(kind === 'up' ? { t: at, unread: res.next, changedAt: now } : { t: at, unread: res.next });
          if (live.heal) {
            live.heal = false;
            live.listDirty = live.convDirty = true;
          }
          if (kind === 'up') {
            live.preUp = prev;
            live.listDirty = live.convDirty = true;
            live.tries = 0;
            if (!onInbox()) live.pendingToast = true;
          } else if (kind === 'down') {
            // Lu entre-temps (ici ou sur un autre appareil) : l'avis n'a plus lieu d'être. Aucune requête.
            live.pendingToast = false;
            dropToast('msg');
          }
          return res.next;
        };
        if (root.navigator.locks && root.navigator.locks.request) {
          return await root.navigator.locks.request('cmrv-live', { ifAvailable: true }, (lock) => (lock ? run() : undefined));
        }
        return await run();
      } catch (e) {
        return undefined;
      } finally {
        live.busy = false;
      }
    }

    // Fil de la conversation ouverte : élément qui défile, pour rester en bas quand un message arrive.
    function convView() {
      let el = doc.querySelector('[data-testid="conversation-content"]');
      while (el && el !== doc.body) {
        if (/(auto|scroll)/.test(root.getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4) break;
        el = el.parentElement;
      }
      if (!el || el === doc.body) return null;
      return { el, height: el.scrollHeight, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 120 };
    }

    // Avis ou défilement seulement si le fil a réellement grandi par rapport à la mesure prise avant la relecture.
    async function follow(before) {
      if (!before) return;
      const grown = await until(() => !before.el.isConnected || before.el.scrollHeight > before.height + 20, 2000);
      if (!grown || !before.el.isConnected) return;
      const down = () => {
        before.el.scrollTop = before.el.scrollHeight;
      };
      if (!before.atBottom) return void toast('Nouveau message ↓', '', down, 'conv');
      down();
      // Une photo qui finit de charger rallonge le fil : on reste en bas quelques secondes, sauf si l'utilisateur
      // reprend la main.
      const stop = () => {
        before.el.removeEventListener('load', down, true);
        before.el.removeEventListener('wheel', stop);
        before.el.removeEventListener('pointerdown', stop);
      };
      before.el.addEventListener('load', down, true);
      before.el.addEventListener('wheel', stop, { passive: true });
      before.el.addEventListener('pointerdown', stop, { passive: true });
      setTimeout(stop, 5000);
    }

    async function callRefresh(what) {
      const res = await ask('refresh', what, 20000);
      if (res.reason !== 'no-bridge') spend();
      if (res.status === 403 || res.status === 429) noteRefusal();
      if (res.conv === 'error' || res.list === 'error') live.heal = true;
      return res;
    }

    // Une seule relecture à la fois ; rien ne s'intercale tant qu'elle n'est pas terminée.
    async function step(fn) {
      live.refreshing = true;
      live.lastRefresh = Date.now();
      try {
        await fn();
      } catch (e) {
        /* la prochaine passe réessaiera */
      } finally {
        live.refreshing = false;
        decorateInbox();
      }
    }

    // Les requêtes de Vinted sont introuvables ou en erreur : trois essais, puis un simple avis « Actualiser ».
    function giveUp() {
      if (++live.tries < 3) return;
      live.listDirty = live.convDirty = false;
      live.manual = true;
    }

    // L'utilisateur a envoyé un message pendant notre lecture : la réponse, partie avant, peut avoir recouvert le
    // message que Vinted venait d'ajouter à l'écran. On relit une fois. (Signal pris dans la page : la zone de saisie
    // qui se vide. Compter les écritures de Vinted dans ses données ne marche pas, il en fait après chaque lecture.)
    async function rereadIfSent(conv, since) {
      await sleep(1200);
      if (live.sentAt >= since - 800 && openConv() === conv && !inbox.busy) await callRefresh({ conversation: conv });
    }

    // Hausse du compteur, conversation ouverte et utilisateur présent : on la relit (1 requête).
    async function showNewInConversation() {
      const conv = openConv();
      const before = convView();
      const t0 = Date.now();
      const res = await callRefresh({ conversation: conv });
      if (res.conv === 'busy') return; // Vinted lit déjà : on repasse dans quelques secondes
      if (res.conv !== 'ok' && res.conv !== 'fresh') return void giveUp();
      live.convDirty = live.manual = false;
      live.tries = 0;
      if (openConv() === conv && !inbox.busy) follow(before);
      // La lire l'a marquée comme lue : si le compteur est revenu à sa valeur d'avant la hausse, le message était
      // ici et la liste n'a pas besoin d'être relue.
      const n = await pollUnread(0, true);
      if (typeof n === 'number' && live.preUp !== null && n <= live.preUp) live.listDirty = false;
      live.preUp = null;
      await rereadIfSent(conv, t0);
    }

    // Hausse du compteur pour un message arrivé ailleurs : on relit la liste (au plus toutes les 30 s).
    async function showNewInList(maxPages) {
      const res = await callRefresh({ list: true, maxPages });
      if (res.list === 'busy') return;
      if (res.list === 'ok' || res.list === 'fresh') {
        live.listDirty = live.manual = live.skipped = false;
        live.listAt = Date.now();
        live.tries = 0;
      } else if (res.list === 'skipped') {
        live.listDirty = false;
        live.skipped = true;
      } else if (res.list === 'none' && res.reason !== 'no-bridge' && !convRows().length) {
        live.listDirty = false; // fenêtre étroite : la liste n'est pas affichée, rien à relire
      } else giveUp();
    }

    // Après un changement de conversation ou une entrée dans la messagerie : Vinted réaffiche ce qu'il a gardé en
    // mémoire ; on relit ce qui date d'avant le dernier changement connu. Passe silencieuse.
    async function afterNavigation(watched) {
      const changedAt = shared().changedAt;
      const res = await callRefresh({ list: true, maxPages: 8, listSince: changedAt || 1, conversation: watched ? openConv() : null, convSince: Math.max(changedAt, Date.now() - 2 * MINUTE) });
      if (res.list === 'ok') live.listAt = Date.now();
    }

    // Filet de sécurité, utilisateur présent : ce que le compteur ne voit pas (2ᵉ message d'une conversation déjà non
    // lue, message envoyé depuis un autre appareil). Passe silencieuse, sauf pour suivre un message arrivé.
    async function safetyPass() {
      const conv = openConv();
      const before = convView();
      const t0 = Date.now();
      const since = t0 - 100000;
      const res = await callRefresh({ list: true, maxPages: 2, listSince: since, conversation: conv, convSince: since });
      if (res.list === 'ok') live.listAt = Date.now();
      if (res.conv !== 'ok') return;
      if (openConv() === conv && !inbox.busy) follow(before);
      await rereadIfSent(conv, t0);
    }

    // Avis discret, en bas à gauche de la page. action : adresse à ouvrir (vrai lien) ou fonction.
    function toast(title, text, action, kind) {
      ensurePageCss();
      dropToast();
      const box = doc.createElement('div');
      box.className = 'cmrv-toast';
      box.setAttribute('data-cmrv-toast', kind);
      box.setAttribute('role', 'status');
      const link = typeof action === 'string';
      const main = doc.createElement(link ? 'a' : 'button');
      main.className = 'cmrv-toast-main';
      if (link) {
        main.href = action;
        // En pleine mise en vente, ne pas faire quitter le formulaire.
        if (/^\/items\/(new|\d+\/edit)/.test(loc.pathname)) Object.assign(main, { target: '_blank', rel: 'noopener' });
      } else {
        main.type = 'button';
        main.addEventListener('click', action);
      }
      main.addEventListener('click', () => box.remove());
      const b = doc.createElement('b');
      b.textContent = title;
      main.appendChild(b);
      if (text) {
        const span = doc.createElement('span');
        span.textContent = text.length > 90 ? `${text.slice(0, 90)}…` : text;
        main.appendChild(span);
      }
      const x = doc.createElement('button');
      x.type = 'button';
      x.className = 'cmrv-toast-x';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Fermer');
      x.addEventListener('click', () => box.remove());
      box.append(main, x);
      doc.body.appendChild(box);
      setTimeout(() => box.remove(), 12000);
    }

    // Hors messagerie : « Nouveau message de X » (une lecture de la première page de la liste pour savoir de qui).
    async function announce() {
      const s = shared();
      if (s.changedAt && s.ann >= s.changedAt) return; // déjà annoncé, ici ou dans un autre onglet
      share({ ann: Date.now() });
      let found = null;
      let read = false;
      try {
        const r = await root.fetch('/api/v2/inbox?page=1&per_page=5', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
        spend();
        if (r.status === 403 || r.status === 429) noteRefusal();
        if (r.ok) {
          read = true;
          found = ((await r.json()).conversations || []).find((c) => c && c.unread) || null;
        }
      } catch (e) {
        /* avis sans nom */
      }
      if ((read && !found) || onInbox()) return; // lu entre-temps, ou l'utilisateur est déjà dans la messagerie
      const who = found && found.opposite_user && found.opposite_user.login;
      toast(who ? `Nouveau message de ${who}` : 'Nouveau message', (found && found.description) || '', found ? `/inbox/${found.id}` : '/inbox', 'msg');
    }

    // « (2) Messages | Vinted » dans le titre de l'onglet tant qu'il reste des messages non lus. La valeur vient de
    // la lecture la plus récente, de cet onglet ou d'un autre ; elle disparaît si plus personne ne lit.
    function applyTitle(s, now) {
      const own = live.unread !== null ? { n: live.unread, t: live.t } : null;
      const other = s.unread !== null ? { n: s.unread, t: s.t } : null;
      const best = own && other ? (own.t >= other.t ? own : other) : own || other;
      const n = S.settings.live && !live.stopped && best && now - best.t < 15 * MINUTE ? best.n : 0;
      const want = n > 0 ? `(${n}) ` : '';
      const cur = doc.title;
      const base = live.prefix && cur.startsWith(live.prefix) ? cur.slice(live.prefix.length) : cur;
      if (cur !== want + base) doc.title = want + base;
      live.prefix = want;
    }

    // Texte de l'indicateur, dans la barre « Regroupeur » de la messagerie.
    function liveBadge() {
      if (!S.settings.live) return '';
      if (live.stopped) return '<em class="cmrv-live">session expirée — recharge la page</em>';
      if (live.manual) {
        const lose = inbox.armed === 'reload';
        return `<em class="cmrv-live new">Nouveau message</em><button class="cmrv-btn${lose ? ' armed' : ''}" data-cmrv-act="reload">${lose ? 'Actualiser (le message en cours sera perdu)' : 'Actualiser'}</button>`;
      }
      if (live.skipped) return '<em class="cmrv-live new">Nouveaux messages</em><button class="cmrv-btn" data-cmrv-act="relist">Actualiser la liste</button>';
      const until = blockedUntil();
      if (Date.now() < until) {
        const at = new Date(until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return `<em class="cmrv-live">en pause — Vinted a refusé une lecture, reprise à ${at}</em>`;
      }
      if (Date.now() < live.localPauseUntil || live.errors || overBudget()) return '<em class="cmrv-live">direct en pause — lecture impossible pour le moment</em>';
      return '<em class="cmrv-live on" title="Les nouveaux messages s’affichent tout seuls, sans recharger la page.">en direct</em>';
    }

    function liveTick() {
      const now = Date.now();
      const vis = doc.visibilityState === 'visible';
      if (vis) live.lastVisible = now;
      const s = shared();
      applyTitle(s, now);
      const inboxPage = onInbox();
      if (inboxPage) {
        const draft = ((doc.querySelector('[data-testid="composer--input"]') || {}).value || '').length;
        if (live.draft > 0 && draft === 0) live.sentAt = now;
        live.draft = draft;
      }
      // Sans requête : conversations que Vinted ne permet pas de supprimer (lues dans sa liste déjà chargée).
      if (inboxPage && bridge() && now - live.stateAt > 3000) {
        live.stateAt = now;
        ask('state', {}, 3000).then((r) => {
          if (r.ok && Array.isArray(r.restricted)) inbox.restricted = new Set(r.restricted);
        });
      }
      if (!S.settings.live || live.stopped || inbox.busy) return;
      if (now < blockedUntil() || now < live.localPauseUntil || root.navigator.onLine === false) return;
      if (doc.querySelector('[data-testid="header--login-button"]')) return; // déconnecté
      if (doc.querySelector('iframe[src*="captcha-delivery"],script[src*="captcha-delivery"]')) return; // page de vérification

      const idleMs = now - live.lastActive;
      const watched = liveWatched({ visible: vis, focused: doc.hasFocus(), idleMs, inputMs: now - live.lastInput });

      // 1. Mettre à jour ce qui est affiché. Jamais pendant une sélection ou une confirmation de suppression (la
      //    liste ne doit pas bouger sous le curseur), ni après une lecture du compteur en échec.
      if (vis && inboxPage && !live.refreshing && !live.busy && !live.errors && !inbox.select && !inbox.armed && now - live.lastRefresh > 3000) {
        if (live.convDirty && !openConv()) live.convDirty = false;
        if (live.convDirty && watched) return void step(showNewInConversation);
        if (live.listDirty && now - live.listAt >= 30000) return void step(() => showNewInList(8));
        if (live.navAt && now - live.navAt > 1200) {
          live.navAt = 0;
          return void step(() => afterNavigation(watched));
        }
        if (watched && now - live.lastRefresh > 3 * MINUTE) return void step(safetyPass);
      }
      if (live.navAt && now - live.navAt > 30000) live.navAt = 0;
      if (inboxPage) live.pendingToast = false;
      else if (vis && live.pendingToast && now - live.visibleAt > 700) {
        live.pendingToast = false;
        announce();
      }

      // 2. Lire le compteur quand c'est le moment.
      if (live.busy || live.refreshing || now < live.retryAt || overBudget()) return;
      let every = liveInterval({ inbox: inboxPage, conv: !!openConv(), visible: vis, idleMs, hiddenMs: now - live.lastVisible });
      if (!every) return;
      every *= (live.errors ? 2 : 1) * live.jitter;
      const last = Math.max(live.t, s.t);
      if (live.unread === null && s.unread !== null && now - last < every) live.unread = s.unread; // valeur lue par un autre onglet ou par la page précédente
      const stale = vis && s.unread !== null && live.unread !== null && s.unread !== live.unread && now - live.t > 2500;
      const forced = live.force && vis && now - last > 5000 && now - live.visibleAt > 700;
      // Onglet caché : Chrome ne réveille la page qu'une fois par minute, d'où la tolérance.
      if (now - last >= every - (vis ? 0 : 1500) || stale || forced) {
        live.force = false;
        pollUnread(every);
      }
    }

    function present(e) {
      live.lastActive = Date.now();
      if (e && e.isTrusted && e.type !== 'focus') live.lastInput = live.lastActive;
    }
    for (const type of ['pointerdown', 'keydown', 'wheel', 'mousemove', 'touchstart']) doc.addEventListener(type, present, { capture: true, passive: true });
    root.addEventListener('focus', present);
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState !== 'visible') return;
      live.visibleAt = live.lastActive = Date.now();
      live.force = true;
    });
    root.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      live.visibleAt = Date.now();
      live.force = true;
    });

    // ---------- Navigation (Vinted change de page sans recharger) ----------

    function onNav() {
      const firstNav = !S.href;
      S.href = loc.href;
      const wasInbox = live.wasInbox;
      live.wasInbox = onInbox();
      live.manual = live.skipped = false;
      dropToast('conv');
      if (live.wasInbox) {
        // Conversation ou liste gardées en mémoire par Vinted : à relire si elles datent.
        live.navAt = Date.now();
        if (!wasInbox && !firstNav) live.force = true;
      }
      const ctx = pageContext(loc.pathname);
      const changed = ctx.sellerId !== S.ctx.sellerId;
      S.ctx = ctx;
      if (changed) {
        setItems([]);
        S.load = { state: 'idle' };
        S.q = S.listText = '';
        $('#q').value = $('#ql').value = '';
        S.limit = SHOWN;
        S.wanted = new Set(ctx.sellerId ? ssGet(wantedKey()) || [] : []);
      }
      S.pageSel = new Set();
      if (ctx.kind === 'bundle') {
        // Les articles passés dans l'adresse sont déjà dans le lot affiché par Vinted.
        const inUrl = new URLSearchParams(loc.search).getAll('item_ids[]');
        for (const id of inUrl) S.wanted.delete(id);
        saveWanted();
      }
      renderAll();
      if (S.open && ctx.sellerId) loadIndex();
    }

    let timer = 0;
    // L'extension a été rechargée ou mise à jour : cette copie du script n'a plus accès à rien et une nouvelle a pris
    // le relais. Elle s'arrête et retire ce qu'elle avait ajouté à la page.
    function shutdown() {
      clearInterval(timer);
      for (const el of doc.querySelectorAll('[data-cmrv-bar],[data-cmrv-ibar],[data-cmrv-label],[data-cmrv-total],[data-cmrv-toast],[data-cmrv-act]')) el.remove();
      host.remove();
      S.settings.live = false;
    }

    function tick() {
      if (typeof chrome !== 'undefined' && chrome.runtime && !chrome.runtime.id) return void shutdown();
      if (!host.isConnected) (doc.body || doc.documentElement).appendChild(host);
      if (loc.href !== S.href) onNav();
      ensurePageCss();
      ensureSearchBar();
      const bar = doc.querySelector('[data-cmrv-bar]');
      $('.launch').hidden = S.open || !!(bar && visible(bar));
      liveTick();
      decorateInbox();
      decorate();
      if (S.load.state === 'blocked' || S.load.state === 'error') if (harvestDom() && S.open) renderAll();
      if (syncPage() && S.open) renderAll();
    }

    // Réglage modifié dans un autre onglet : appliqué ici tout de suite (un onglet caché n'est réveillé qu'une fois
    // par minute).
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes['cmrv.settings']) return;
        Object.assign(S.settings, changes['cmrv.settings'].newValue || {});
        applyTitle(shared(), Date.now());
        decorateInbox();
        decorate();
        if (S.open) renderAll();
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === 'cmr:toggle') {
          setOpen(!S.open);
          sendResponse({ ok: true });
        }
      });
    }

    (async () => {
      await loadShipCache();
      const ui = (await csGet(['cmrv.ui']))['cmrv.ui'] || {};
      (doc.body || doc.documentElement).appendChild(host);
      onNav();
      if (ui.open && S.ctx.sellerId) setOpen(true);
      timer = setInterval(tick, 800);
      tick();
    })();
  }

  return { norm, tokens, near, scoreItem, searchItems, searchList, parseEuro, euro, cardTitleFromAlt, pageContext, bundleUrl, bundleEstimate, fromApiItem, liveInterval, liveWatched, liveDecide, start };
});
