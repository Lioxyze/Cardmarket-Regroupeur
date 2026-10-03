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
    .launch.mini { padding: 9px 11px; opacity: .85; }
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
      settings: { titles: true, shipping: true },
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

    // ---------- Vignettes d'annonces de la page ----------

    const cardEls = () => [...doc.querySelectorAll('[data-testid^="product-item-id-"]')].filter((el) => /^product-item-id-\d+$/.test(el.getAttribute('data-testid')));
    const cardId = (el) => el.getAttribute('data-testid').slice('product-item-id-'.length);
    const cardEl = (id) => doc.querySelector(`[data-testid="product-item-id-${id}"]`);
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
          if (now < ship.pausedUntil) break;
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
              break;
            }
            if (r.ok) {
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
        if (ship.queue.length && ship.pausedUntil > Date.now()) {
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
      const autoShip = showShip && S.ctx.kind !== 'home';
      for (const el of cardEls()) {
        let lab = el.querySelector('[data-cmrv-label]');
        if (!on) {
          if (lab) lab.remove();
          continue;
        }
        const card = cardInfo(el);
        const info = showShip ? shipFor(card.id) : null;
        if (autoShip && !info && visible(el)) wantShip(card.id);
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
      if (S.items[0] && s && !s.samples.length) {
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
      launch.hidden = S.open;
      launch.classList.toggle('mini', !seller);
      launch.textContent = seller ? '🔎 Chercher dans ce dressing' : '🔎';
      launch.title = seller ? 'Regroupeur : chercher un article chez ce vendeur et préparer un lot' : 'Regroupeur : réglages Vinted';
      $('.panel').hidden = !S.open;
      if (!S.open) return;
      $('#seller').hidden = !seller;
      $('#hint').hidden = seller;
      $('#opt-shipping').checked = S.settings.shipping;
      $('#opt-titles').checked = S.settings.titles;
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
      } else if (t.id === 'opt-shipping' || t.id === 'opt-titles') {
        S.settings[t.id === 'opt-shipping' ? 'shipping' : 'titles'] = t.checked;
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

    // ---------- Navigation (Vinted change de page sans recharger) ----------

    function onNav() {
      S.href = loc.href;
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

    function tick() {
      if (!host.isConnected) (doc.body || doc.documentElement).appendChild(host);
      if (loc.href !== S.href) onNav();
      decorate();
      if (S.load.state === 'blocked' || S.load.state === 'error') if (harvestDom() && S.open) renderAll();
      if (syncPage() && S.open) renderAll();
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
      setInterval(tick, 800);
      tick();
    })();
  }

  return { norm, tokens, near, scoreItem, searchItems, searchList, parseEuro, euro, cardTitleFromAlt, pageContext, bundleUrl, bundleEstimate, fromApiItem, start };
});
