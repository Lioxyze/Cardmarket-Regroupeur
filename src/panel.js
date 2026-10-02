/*
 * Regroupeur — panneau intégré aux pages Cardmarket (shadow DOM).
 *
 * Tout le texte affiché passe par le gabarit `html` qui échappe les valeurs :
 * noms de vendeurs et commentaires viennent du site et ne sont jamais
 * injectés tels quels.
 */
(function (root) {
  'use strict';
  const CMR = root.CMR;
  const { cm, store, analyzer } = CMR;
  const { Fetcher } = CMR.fetcher;
  const { KEYS } = store;

  // ---------- Gabarits ----------

  class Raw {
    constructor(s) {
      this.s = s;
    }
  }
  const raw = (s) => new Raw(s);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  function show(v) {
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(show).join('');
    if (v === false || v === null || v === undefined) return '';
    return esc(v);
  }
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += show(vals[i]) + strings[i + 1];
    return raw(out);
  }
  const attr = (cond, name) => (cond ? raw(name) : '');

  function safeHref(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && /(^|\.)cardmarket\.com$/.test(u.hostname)) return u.href;
    } catch (e) {
      /* lien invalide */
    }
    return '#';
  }

  const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const eur = (x) => (x == null || !Number.isFinite(x) ? '—' : eurFmt.format(x));
  const intFmt = new Intl.NumberFormat('fr-FR');
  const plural = (n, one, many) => `${intFmt.format(n)} ${n > 1 ? many : one}`;
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const ICON = {
    logo:
      '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="8" width="15" height="20" rx="3" fill="#1f4fd1" transform="rotate(-9 10 18)"/><rect x="13" y="4" width="15" height="20" rx="3" fill="#f0a23a" transform="rotate(7 20 14)"/><path d="M15.5 14.5l3 3 5.5-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    expand:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>',
    collapse:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14"/></svg>',
    close:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
    cart:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 2h2l1.6 8h7.4l1.5-5.5H4.3"/><circle cx="6.5" cy="13" r="1"/><circle cx="12" cy="13" r="1"/></svg>',
    trash:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9"/></svg>',
  };

  const GAMES = [
    ['Pokemon', 'Pokémon'],
    ['OnePiece', 'One Piece'],
    ['Magic', 'Magic'],
    ['YuGiOh', 'Yu-Gi-Oh!'],
    ['Lorcana', 'Lorcana'],
    ['DragonBallSuper', 'Dragon Ball Super'],
    ['Digimon', 'Digimon'],
    ['FleshAndBlood', 'Flesh and Blood'],
    ['StarWarsUnlimited', 'Star Wars Unlimited'],
    ['Riftbound', 'Riftbound'],
    ['Gundam', 'Gundam'],
  ];

  const SPECIAL_LABELS = { exclude: 'Normale uniquement', any: 'Indifférent', only: 'Reverse / foil uniquement' };
  const FIRST_ED_LABELS = { any: 'Indifférent', exclude: 'Exclure', only: 'Uniquement' };
  const REJECT_LABELS = {
    language: 'langue',
    condition: 'état',
    special: 'version',
    firstEd: '1re édition',
    signed: 'signée/altérée',
    playset: 'playset',
    price: 'prix max',
    sellerType: 'type de vendeur',
    country: 'pays',
    sales: 'ventes',
    excluded: 'vendeur exclu',
    graded: 'gradée (PSA…)',
    notGraded: 'non gradée',
    gradeCompany: 'autre gradation',
    grade: 'note trop basse',
    premium: 'trop chère vs la moins chère',
  };
  const GRADED_LABELS = { exclude: 'Loose (non gradée)', only: 'Gradée (PSA, CGC…)', any: 'Loose ou gradée' };
  const GRADE_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'PCA', 'Collect Aura', 'AOG'];
  const MIN_GRADES = [10, 9.5, 9, 8.5, 8, 7];
  const STOP_CODES = ['ABORTED', 'CHALLENGE', 'RATE_LIMIT', 'NETWORK'];

  // ---------- État ----------

  const state = {
    ready: false,
    open: false,
    wide: false,
    tab: 'list',
    cards: [],
    lists: { active: 'main', items: [{ id: 'main', name: 'Ma liste' }] },
    listId: 'main',
    settings: store.mergeSettings(null),
    dataset: null,
    results: null,
    interrupted: false,
    running: false,
    abort: null,
    progress: null,
    resolving: false,
    pending: [],
    addText: '',
    addGame: 'Pokemon',
    search: { q: '', status: 'idle', results: [], error: null, last: '' },
    searchKind: 'singles',
    bulk: null, // liste numérotée en cours (« 065 — Tokotoro ») : détection de l'extension, aperçu
    expansions: {}, // « Pokemon|fr » → [{ id, name }]
    cart: {},
    cartBusy: false,
    context: { kind: 'other', locale: 'fr', game: 'Pokemon' },
    view: {
      comboSize: 2,
      sort: 'covered',
      dir: -1,
      country: '',
      type: '',
      minCards: 1,
      q: '',
      limit: 40,
      expanded: {},
    },
    toast: null,
  };

  let host;
  let shadow;
  let mountEl;
  let toastTimer;

  // ---------- Contexte de la page ----------

  function detectContext() {
    const here = CMR.testPageUrl || location.href; // surchargé par la page de test (tests/harness)
    const p = cm.parseUrl(here) || { locale: 'fr', game: 'Pokemon', rest: [] };
    const base = { locale: p.locale, game: p.game };
    const key = cm.productKey(here);
    if (key && document.querySelector('h1')) {
      return Object.assign(base, { kind: 'product', key, info: cm.parseProductInfo(document) });
    }
    if (p.rest[0] === 'Users' && p.rest[1]) {
      return Object.assign(base, { kind: 'seller', seller: p.rest[1] });
    }
    if (p.rest[0] === 'Wants' && p.rest[1]) {
      return Object.assign(base, { kind: 'wants', items: cm.parseWantsPage(document) });
    }
    return Object.assign(base, { kind: 'other' });
  }

  const locale = () => state.context.locale || 'fr';
  const productHref = (key) => safeHref(cm.keyToUrl(key, locale()));
  const sellerHref = (game, name) => safeHref(cm.sellerUrl(game, name, locale()));

  function nameFromKey(key) {
    const last = key.split('/').pop() || key;
    return last.replace(/-/g, ' ');
  }

  // ---------- Persistance ----------

  const saveList = () => store.set(store.listKey(state.listId), state.cards);
  const saveLists = () => store.set(KEYS.lists, state.lists);

  // ---------- Plusieurs listes ----------

  async function switchList(id) {
    if (id === state.listId || state.running) return;
    const target = state.lists.items.find((l) => l.id === id);
    if (!target) return;
    const data = await store.loadList(id);
    Object.assign(state, { listId: id, cards: data.list, dataset: data.dataset, cart: {}, cartSeen: null, bulk: null, undo: null });
    state.lists.active = id;
    saveLists();
    recompute();
    toast(`Liste « ${target.name} »`);
  }

  function newList() {
    const name = (prompt('Nom de la nouvelle liste :', `Liste ${state.lists.items.length + 1}`) || '').trim();
    if (!name) return render();
    const id = uid();
    state.lists.items.push({ id, name: name.slice(0, 40) });
    saveLists();
    store.set(store.listKey(id), []);
    switchList(id);
  }

  function renameList() {
    const cur = state.lists.items.find((l) => l.id === state.listId);
    const name = (prompt('Nouveau nom de la liste :', cur ? cur.name : '') || '').trim();
    if (!cur || !name) return;
    cur.name = name.slice(0, 40);
    saveLists();
    render();
  }

  async function deleteList() {
    const cur = state.lists.items.find((l) => l.id === state.listId);
    if (!cur || state.lists.items.length < 2 || state.running) return;
    if (!confirm(`Supprimer la liste « ${cur.name} » (${plural(state.cards.length, 'carte', 'cartes')}) ?`)) return;
    state.lists.items = state.lists.items.filter((l) => l.id !== cur.id);
    await chrome.storage.local.remove([store.listKey(cur.id), store.datasetKey(cur.id)]);
    state.listId = null;
    await switchList(state.lists.items[0].id);
  }

  function renderListPicker() {
    const items = state.lists.items;
    return html`<div class="list-picker">
      <label class="small muted" for="cmr-list-select">Liste</label>
      <select id="cmr-list-select" class="compact" data-model="listId" aria-label="Liste de cartes">
        ${items.map((l) => html`<option value="${l.id}" ${attr(l.id === state.listId, 'selected')}>${l.name}</option>`)}
        <option value="__new">＋ Nouvelle liste…</option>
      </select>
      <button class="btn link small" data-act="list-rename">Renommer</button>
      ${items.length > 1 ? html`<button class="btn link small danger" data-act="list-delete">Supprimer</button>` : ''}
    </div>`;
  }
  const saveSettings = () => store.set(KEYS.settings, state.settings);
  const saveUi = () =>
    store.set(KEYS.ui, { open: state.open, wide: state.wide, tab: state.tab, interrupted: state.running || state.interrupted });

  function recompute() {
    if (!state.dataset) {
      state.results = null;
      return;
    }
    try {
      state.results = analyzer.computeResults(state.dataset, state.cards, state.settings);
    } catch (e) {
      console.error('[Regroupeur]', e);
      state.results = null;
    }
    decoratePage();
  }

  // ---------- Repères sur les pages Cardmarket (aucune requête : on relit les derniers résultats) ----------

  let decorateTimer;
  function decoratePage() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(applyBadges, 120);
  }

  function sellerCoverage(name) {
    const r = state.results;
    if (!r || !r.solved || !r.solved.plans) return null;
    const stats = r.solved.sellers.find((x) => x.sellerId === name);
    return {
      covered: stats ? stats.covered : 0,
      cost: stats ? stats.cardsCost : 0,
      inPlan: r.solved.plans.cheapest.sellers.includes(name),
      total: r.solved.coverableCount,
    };
  }

  function applyBadges() {
    for (const el of document.querySelectorAll('[data-cmr-badge]')) el.remove();
    const r = state.results;
    const listKeys = new Set(state.cards.map((c) => c.key));
    const hasPlan = r && r.solved && r.solved.plans;
    const coverage = hasPlan ? new Map(r.solved.sellers.map((x) => [x.sellerId, x.covered])) : new Map();
    const inPlan = new Set(hasPlan ? r.solved.plans.cheapest.sellers : []);
    for (const row of document.querySelectorAll('.article-row')) {
      // Page d'une carte : vendeurs de ton plan / qui ont plusieurs cartes de ta liste
      const sellerLink = row.querySelector('.col-seller a[href*="/Users/"]');
      if (sellerLink && hasPlan) {
        const name = sellerLink.textContent.trim();
        const n = coverage.get(name) || 0;
        if (inPlan.has(name)) sellerLink.after(badge(`★ ton plan · ${plural(n, 'carte', 'cartes')}`, true));
        else if (n >= 2) sellerLink.after(badge(`${n} cartes de ta liste`, false));
      }
      // Stock d'un vendeur : cartes de ta liste
      const productLink = row.querySelector('.col-seller a[href*="/Products/"]');
      if (productLink && listKeys.has(cm.productKey(productLink.getAttribute('href')))) productLink.after(badge('✓ dans ta liste', true));
    }
  }

  function badge(label, strong) {
    const b = document.createElement('span');
    b.setAttribute('data-cmr-badge', '');
    b.textContent = label;
    // Styles posés via le CSSOM : compatibles avec la politique de sécurité (CSP) de Cardmarket.
    Object.assign(b.style, {
      display: 'inline-block',
      marginLeft: '6px',
      padding: '0 7px',
      borderRadius: '999px',
      font: '600 11px/17px system-ui, sans-serif',
      whiteSpace: 'nowrap',
      verticalAlign: 'middle',
      background: strong ? '#1f4fd1' : '#e7edfc',
      color: strong ? '#ffffff' : '#1f4fd1',
    });
    return b;
  }

  let recomputeTimer;
  function recomputeSoon() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => {
      recompute();
      render();
    }, 120);
  }

  function toast(msg, action) {
    state.toast = { msg, action: action || null };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        state.toast = null;
        render();
      },
      action ? 6000 : 2600
    );
    render();
  }

  // ---------- Liste ----------

  function addCard(card, { silent = false } = {}) {
    const existing = state.cards.find((c) => c.key === card.key);
    if (existing) {
      if (!silent) toast('Déjà dans la liste');
      return false;
    }
    state.cards.push(
      Object.assign(
        {
          id: uid(),
          qty: 1,
          languages: null,
          minCondition: null,
          special: null,
          firstEd: null,
          maxPrice: null,
          graded: null,
          gradeCompany: null,
          minGrade: null,
          image: '',
          addedAt: Date.now(),
        },
        card
      )
    );
    saveList();
    recomputeSoon();
    return true;
  }

  function addCurrent() {
    const ctx = state.context;
    if (ctx.kind !== 'product') return;
    const info = cm.parseProductInfo(document);
    const sealed = cm.productKind(ctx.key) === 'sealed';
    if (addCard({ key: ctx.key, name: info.name || nameFromKey(ctx.key), expansion: info.expansion, number: info.number, image: info.image })) {
      toast(sealed ? 'Produit ajouté à ta liste' : 'Carte ajoutée à ta liste');
    }
  }

  function importWants() {
    const items = state.context.items || [];
    let n = 0;
    for (const it of items) if (addCard({ key: it.key, name: it.name || nameFromKey(it.key), qty: it.qty, autoName: !it.name }, { silent: true })) n++;
    toast(n ? `${plural(n, 'carte importée', 'cartes importées')}` : 'Toutes ces cartes sont déjà dans la liste');
  }

  function addFromText() {
    const lines = state.addText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let added = 0;
    let invalid = 0;
    const numbered = [];
    for (const line of lines) {
      if (/cardmarket\.com|^\/[a-z]{2}\//i.test(line)) {
        const key = cm.productKey(line.split(/\s+/)[0]);
        if (key && addCard({ key, name: nameFromKey(key), autoName: true }, { silent: true })) added++;
        else if (!key) invalid++;
        continue;
      }
      const want = analyzer.parseTextLine(line);
      if (!want) continue;
      if (want.number && !want.expansion && !/[|;\t]/.test(line)) numbered.push(want);
      else state.pending.push({ id: uid(), line, want, game: state.addGame, kind: state.searchKind, status: 'queued' });
    }
    // Liste numérotée : on reconnaît l'extension, puis tout se fait par numéro (quelques pages au lieu d'une par carte).
    // Avec un code d'extension (« (SFA 066) ») même une seule ligne suffit ; sans code, il en faut au moins 3.
    const plain = numbered.filter((w) => !w.setCode);
    const bySet = numbered.filter((w) => w.setCode).concat(plain.length >= 3 ? plain : []);
    if (bySet.length) resolveNumberedList(bySet);
    if (plain.length < 3) for (const want of plain) state.pending.push({ id: uid(), line: want.name, want, game: state.addGame, kind: 'singles', status: 'queued' });
    state.addText = '';
    if (added) toast(`${plural(added, 'carte ajoutée', 'cartes ajoutées')}`);
    else if (invalid) toast(`${plural(invalid, 'lien non reconnu', 'liens non reconnus')}`);
    render();
    processPending();
  }

  function cardFromCandidate(c, want) {
    return {
      key: c.key,
      name: c.name || nameFromKey(c.key),
      expansion: c.expansion || '',
      number: c.number || '',
      image: c.image || '',
      qty: want.qty || 1,
      languages: want.languages || null,
      minCondition: want.minCondition || null,
    };
  }

  const PENDING_CONFIRM = 8;

  async function processPending() {
    if (state.resolving || state.running) return;
    const queued = state.pending.filter((p) => p.status === 'queued').length;
    if (!queued) return;
    // Beaucoup de recherches une par une = beaucoup de pages : on demande d'abord.
    if (queued > PENDING_CONFIRM && !state.pendingApproved) {
      state.pendingNeedsOk = true;
      render();
      return;
    }
    state.pendingNeedsOk = false;
    state.resolving = true;
    const fetcher = new Fetcher({ delayMs: Math.min(state.settings.delayMs, 2000) });
    try {
      for (const p of state.pending) {
        if (p.status !== 'queued') continue;
        p.status = 'searching';
        render();
        try {
          const query = analyzer.searchQuery(p.want.name);
          const { doc, finalUrl } = await fetcher.getDoc(cm.searchUrl(p.game, query, locale(), p.kind || 'singles'));
          const directKey = cm.productKey(finalUrl);
          let candidates;
          if (directKey) {
            const info = cm.parseProductInfo(doc);
            candidates = [{ key: directKey, name: info.name, expansion: info.expansion, number: info.number, from: info.from }];
          } else candidates = cm.parseSearchPage(doc);
          const ranked = analyzer.rankCandidates(candidates, p.want, p.kind || 'singles');
          if (ranked.auto) {
            addCard(cardFromCandidate(ranked.auto, p.want), { silent: true });
            p.status = 'done';
          } else if (!ranked.candidates.length) p.status = 'none';
          else {
            p.status = 'choose';
            p.candidates = ranked.candidates;
          }
        } catch (e) {
          p.status = 'error';
          p.error = e.message;
          if (e.code === 'CHALLENGE' || e.code === 'RATE_LIMIT') {
            for (const q of state.pending) if (q.status === 'queued') q.status = 'error';
            break;
          }
        }
        render();
      }
    } finally {
      state.pending = state.pending.filter((p) => p.status !== 'done');
      state.resolving = false;
      state.pendingApproved = false;
      render();
    }
  }

  async function runSearch() {
    const sr = state.search;
    const q = sr.q.trim();
    if (!q) return;
    // Un lien collé dans la recherche : ajout direct.
    const key = /cardmarket\.com/i.test(q) ? cm.productKey(q.split(/\s+/)[0]) : null;
    if (key) {
      if (addCard({ key, name: nameFromKey(key), autoName: true })) toast('Carte ajoutée à ta liste');
      sr.q = '';
      render();
      return;
    }
    const want = analyzer.parseTextLine(q) || { name: q };
    const kind = state.searchKind;
    const seq = (sr.seq = (sr.seq || 0) + 1); // la dernière recherche lancée gagne toujours
    const same = sr.status === 'loading' && sr.last === want.name && sr.kind === kind;
    sr.status = 'loading';
    sr.last = want.name;
    sr.kind = kind;
    sr.want = want;
    render();
    if (same) return; // même recherche déjà en cours : pas de page en double
    try {
      const fetcher = new Fetcher({ delayMs: Math.min(state.settings.delayMs, 2000) });
      const { doc, finalUrl } = await fetcher.getDoc(cm.searchUrl(state.addGame, want.name, locale(), kind));
      if (seq !== sr.seq) return; // une autre recherche a été lancée entre-temps
      const directKey = cm.productKey(finalUrl);
      let candidates;
      if (directKey) {
        const info = cm.parseProductInfo(doc);
        candidates = [
          { key: directKey, name: info.name || nameFromKey(directKey), expansion: info.expansion, number: info.number, from: info.from, image: info.image },
        ];
      } else candidates = cm.parseSearchPage(doc);
      sr.results = analyzer.rankCandidates(candidates, want, kind).candidates;
      sr.status = 'done';
    } catch (e) {
      if (seq !== sr.seq) return;
      sr.status = 'error';
      sr.error = e.message || 'Recherche impossible';
    }
    render();
  }

  function addSearchResult(i, mode) {
    const sr = state.search;
    const c = sr.results[i];
    if (!c) return;
    const card = cardFromCandidate(c, sr.want || { qty: 1 });
    if (mode === 'graded') Object.assign(card, { graded: 'only', gradeCompany: 'PSA' });
    if (addCard(card)) toast(`${c.name}${mode === 'graded' ? ' (PSA)' : ''} ajoutée à ta liste`);
    render();
  }

  // ---------- Liste numérotée (« 065 — Tokotoro ») ----------

  function expansionsKey(game) {
    return `${game}|${locale()}`;
  }

  function rememberExpansions(game, list) {
    if (!list || !list.length) return;
    state.expansions[expansionsKey(game)] = list;
    store.set('cmr.expansions', { t: Date.now(), lists: state.expansions }).catch(() => {});
  }

  /** Une liste peut mélanger plusieurs extensions : un groupe par code (« SFA », « TWM »…), sinon un seul. */
  function groupWants(wants) {
    const byCode = new Map();
    for (const w of wants) {
      const k = String(w.setCode || '').toUpperCase();
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k).push(w);
    }
    return [...byCode.entries()].map(([code, list], i) => ({
      i,
      code,
      wants: list,
      status: 'waiting',
      expansion: null,
      matched: [],
      unmatched: [],
      suggestions: [],
      note: 'En attente…',
      pickText: '',
    }));
  }

  const bulkGroup = (i) => (state.bulk ? state.bulk.groups[+i] : null);

  async function resolveNumberedList(wants) {
    const bulk = { game: state.addGame, groups: groupWants(wants) };
    state.bulk = bulk;
    state.view.expanded.bulk = true;
    state.tab = 'list';
    state.scrollTo = '.bulk';
    render();
    const fetcher = new Fetcher({ delayMs: state.settings.delayMs });
    for (const g of bulk.groups) {
      if (state.bulk !== bulk) return;
      await detectGroup(g, fetcher);
    }
  }

  async function detectGroup(g, fetcher) {
    const bulk = state.bulk;
    Object.assign(g, { status: 'detecting', note: 'Recherche de l’extension…' });
    render();
    try {
      // 1 à 3 cartes cherchées ; l'extension qui a la bonne carte au bon numéro (et au bon code) l'emporte.
      const votes = new Map();
      const ranking = () => [...votes.values()].sort((x, y) => y.n - x.n);
      g.log = [];
      // Noms français → site en français ; noms anglais (« Houndoom (SFA 066) ») → aussi en anglais si besoin.
      const locales = [...new Set([locale(), 'en'])];
      for (const w of analyzer.pickDetectionLines(g.wants, 3)) {
        // « Hyporoi-ex » → « Hyporoi » : marche que le site écrive « -ex » ou « ex » ; le numéro départage.
        const query = analyzer.searchQuery(w.name).replace(/[\s-]+(?:ex|gx|v|vmax|vstar)$/i, '').trim() || w.name;
        let found = 0;
        for (const loc of locales) {
          g.note = `Recherche de l’extension (« ${query} »)…`;
          render();
          const { doc, finalUrl } = await fetcher.getDoc(cm.searchUrl(bulk.game, query, loc, 'singles'));
          if (state.bulk !== bulk) return; // annulé entre-temps
          rememberExpansions(bulk.game, cm.parseExpansionOptions(doc));
          const directKey = cm.productKey(finalUrl);
          const results = directKey ? [Object.assign({ key: directKey }, cm.parseProductInfo(doc))] : cm.parseSearchPage(doc);
          const hits = analyzer.expansionVotes(results, w);
          g.log.push(`« ${query} » (${loc}) : ${plural(results.length, 'résultat', 'résultats')}, ${hits.length ? hits.map((h) => h.name).join(', ') : 'aucune au n° ' + w.number}`);
          for (const e of hits) {
            const v = votes.get(e.slug) || Object.assign({ n: 0 }, e);
            v.n += e.weight;
            votes.set(e.slug, v);
          }
          found = results.length;
          if (hits.length || found) break; // la langue du site suffit ; l'anglais seulement si rien trouvé
        }
        const r = ranking();
        if (r[0] && r[0].n >= 2) break;
      }
      const r = ranking();
      if (!r.length || (r[1] && r[1].n === r[0].n)) {
        Object.assign(g, {
          status: 'choose',
          suggestions: r,
          note: r.length ? 'Plusieurs extensions possibles : choisis la bonne.' : 'Extension non reconnue automatiquement : choisis-la ci-dessous.',
        });
        render();
        return;
      }
      await loadGroupExpansion(g, { slug: r[0].slug, name: r[0].name }, fetcher);
    } catch (e) {
      Object.assign(g, { status: 'error', note: e.message || String(e) });
      render();
    }
  }

  async function loadGroupExpansion(g, exp, fetcher) {
    const bulk = state.bulk;
    if (!bulk || !g) return;
    fetcher = fetcher || new Fetcher({ delayMs: state.settings.delayMs });
    Object.assign(g, { status: 'loading', expansion: exp, changing: false, note: `Lecture de la liste « ${exp.name} »…` });
    render();
    try {
      let listing = [];
      for (let page = 1; page <= 4; page++) {
        const { doc } = await fetcher.getDoc(cm.expansionListUrl(bulk.game, exp, locale(), page));
        if (state.bulk !== bulk) return;
        rememberExpansions(bulk.game, cm.parseExpansionOptions(doc));
        listing = listing.concat(cm.parseSearchPage(doc));
        if (page >= cm.parsePagination(doc).pages) break;
      }
      const { matched, unmatched } = analyzer.matchByNumber(g.wants, listing);
      Object.assign(g, { status: 'preview', matched, unmatched, note: '', listingSize: listing.length });
      if (!listing.length) Object.assign(g, { status: 'choose', note: 'Aucune carte lue dans cette extension : choisis-en une autre.' });
      state.scrollTo = '.bulk';
    } catch (e) {
      Object.assign(g, { status: 'error', note: e.message || String(e) });
    }
    render();
  }

  async function loadExpansionOptions(g) {
    const bulk = state.bulk;
    if (!bulk || !g) return;
    g.note = 'Chargement de la liste des extensions…';
    render();
    try {
      const url = `${cm.ORIGIN}/${locale()}/${encodeURIComponent(bulk.game)}/Products/Singles?mode=list&perSite=20`;
      const { doc } = await new Fetcher({ delayMs: state.settings.delayMs }).getDoc(url);
      rememberExpansions(bulk.game, cm.parseExpansionOptions(doc));
      g.note = 'Choisis l’extension :';
    } catch (e) {
      g.note = e.message || String(e);
    }
    render();
  }

  function pickExpansion(g) {
    const bulk = state.bulk;
    if (!bulk || !g) return;
    const list = state.expansions[expansionsKey(bulk.game)] || [];
    const q = cm.norm(g.pickText);
    const exp = list.find((e) => cm.norm(e.name) === q) || list.find((e) => cm.norm(e.name).includes(q));
    if (!q || !exp) {
      g.note = 'Extension inconnue : choisis-la dans la liste proposée.';
      render();
      return;
    }
    loadGroupExpansion(g, { id: exp.id, name: exp.name });
  }

  function addBulkMatches() {
    const bulk = state.bulk;
    if (!bulk) return;
    // Même carte sur plusieurs lignes = plusieurs exemplaires.
    const qty = new Map();
    const products = [];
    for (const g of bulk.groups) {
      if (g.status !== 'preview') continue;
      for (const m of g.matched) {
        if (!qty.has(m.product.key)) products.push({ p: m.product, exp: g.expansion });
        qty.set(m.product.key, (qty.get(m.product.key) || 0) + (m.want.qty || 1));
      }
    }
    let added = 0;
    for (const { p, exp } of products) {
      const n = qty.get(p.key);
      const existing = state.cards.find((c) => c.key === p.key);
      if (existing) {
        existing.qty = Math.min(99, (existing.qty || 1) + n);
        continue;
      }
      if (addCard({ key: p.key, name: p.name, expansion: exp ? exp.name : '', number: p.number, image: p.image || '', qty: n }, { silent: true })) added++;
    }
    saveList();
    const left = bulk.groups.reduce((n, g) => n + (g.status === 'preview' ? g.unmatched.length : g.wants.length), 0);
    state.bulk = null;
    toast(`${plural(added, 'carte ajoutée', 'cartes ajoutées')} à ta liste${left ? ` · ${left} non trouvée${left > 1 ? 's' : ''}` : ''}`);
    render();
  }

  function searchLeftoversByName(g) {
    if (!g) return;
    for (const want of g.unmatched) state.pending.push({ id: uid(), line: want.name, want: Object.assign({}, want), game: state.bulk.game, kind: 'singles', status: 'queued' });
    g.unmatched = [];
    render();
    processPending();
  }

  // ---------- Panier ----------

  function getPlan(planKey) {
    const S = state.results && state.results.solved;
    if (!S || !S.plans) return null;
    if (S.plans[planKey]) return S.plans[planKey];
    const m = String(planKey).match(/^combo:(\d):(\d+)$/);
    return m ? (S.combos[m[1]] || [])[+m[2]] || null : null;
  }

  const cartKey = (planKey, seller) => `${planKey}|${seller}`;

  async function addPlanToCart(planKey, sellerId) {
    if (state.cartBusy || state.running) return;
    const plan = getPlan(planKey);
    if (!plan) return;
    // « Tout ajouter » ne renvoie jamais ce qui est déjà dans le panier (pas de doublons).
    const orders = sellerId ? plan.orders.filter((o) => o.sellerId === sellerId) : plan.orders.filter((o) => !orderInCart(planKey, o));
    state.cartBusy = true;
    const fetcher = new Fetcher({ delayMs: Math.max(1500, Math.min(state.settings.delayMs, 2500)) });
    try {
      for (const order of orders) {
        const k = cartKey(planKey, order.sellerId);
        const items = CMR.cart.planItems({ orders: [order] }, state.results, state.cards);
        const total = items.reduce((n, it) => n + it.take.length, 0);
        state.cart[k] = { status: 'running', done: 0, total, label: '' };
        render();
        try {
          const out = await CMR.cart.addToCart(items, {
            fetcher,
            settings: state.settings,
            onProgress: (done, tot, label) => {
              Object.assign(state.cart[k], { done, total: tot, label });
              render();
            },
          });
          if (out.loginRequired) {
            state.cart[k] = { status: 'login' };
            break;
          }
          state.cart[k] = { status: 'done', results: out.results, cartChecked: out.cartChecked };
          if (out.cart) state.cartSeen = Object.assign({ at: Date.now() }, out.cart, { learned: learnShipping(out.cart) });
        } catch (e) {
          state.cart[k] = { status: 'error', message: e.message || String(e), results: e.partial || [] };
          if (STOP_CODES.includes(e.code)) break;
        }
        render();
      }
    } finally {
      state.cartBusy = false;
      render();
    }
  }

  function orderInCart(planKey, order) {
    const entry = state.cart[cartKey(planKey, order.sellerId)];
    return !!entry && entry.status === 'done' && !cartSummary(entry).problems.length;
  }

  /** Frais de port lus au panier → moyenne par pays d'expédition, utilisée par les calculs suivants. */
  function learnShipping(cart) {
    if (!cart || !cart.sellers) return 0;
    const L = (state.settings.learnedShipping = state.settings.learnedShipping || {});
    const threshold = state.settings.shipping.trackedThreshold;
    let n = 0;
    for (const c of cart.sellers) {
      if (c.shipping == null || c.shipping < 0.3 || c.shipping > 15) continue; // lecture douteuse : ignorée
      const info = (state.results && state.results.sellers[c.name]) || {};
      if (!info.countryCode) continue;
      const slot = CMR.optimizer.shippingTier(state.settings.shipping, c.value || 0);
      const entry = (L[info.countryCode] = L[info.countryCode] || {});
      const v = (entry[slot] = entry[slot] || { sum: 0, n: 0 });
      v.sum = Math.round((v.sum + c.shipping) * 100) / 100;
      v.n++;
      n++;
    }
    // Pas de recalcul immédiat : le plan affiché ne change pas sous les yeux juste après l'ajout au panier.
    if (n) saveSettings();
    return n;
  }

  /** Ce que Cardmarket affiche vraiment au panier, comparé au plan estimé. */
  function renderCartSeen() {
    const c = state.cartSeen;
    const plan = state.results && state.results.solved.plans && state.results.solved.plans.cheapest;
    if (!c || !plan || !c.sellers.length) return '';
    const inPlan = new Map(plan.orders.map((o) => [o.sellerId, o]));
    const mine = c.sellers.filter((x) => inPlan.has(x.name));
    const others = c.sellers.filter((x) => !inPlan.has(x.name));
    const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0);
    const hasValues = mine.some((x) => x.value != null);
    const hasShip = mine.some((x) => x.shipping != null);
    if (!hasValues && !hasShip) return '';
    const real = { cards: sum(mine, 'value'), ship: sum(mine, 'shipping') };
    const est = mine.reduce((t, x) => ({ cards: t.cards + inPlan.get(x.name).cardsCost, ship: t.ship + inPlan.get(x.name).shipCost }), { cards: 0, ship: 0 });
    // Plus d'articles au panier que prévu chez un vendeur : doublons ou reste d'un ancien panier.
    const extra = mine.filter((x) => {
      const expected = inPlan.get(x.name).cards.reduce((t, card) => t + ((state.results.cardInfo[card.cardId] || {}).qty || 1), 0);
      return x.articles > expected;
    });
    const diff = real.cards + real.ship - (est.cards + est.ship);
    return html`<div class="cart-seen box">
      <p><b>Panier Cardmarket (vendeurs du plan) :</b> ${eur(real.cards + real.ship)} = cartes ${eur(real.cards)} + port ${eur(real.ship)}</p>
      <p class="small muted">Estimé : ${eur(est.cards + est.ship)} = cartes ${eur(est.cards)} + port ${eur(est.ship)}${
      Math.abs(diff) > 0.5 ? html` · <b class="${diff > 0 ? 'warn-text' : 'ok-text'}">écart ${diff > 0 ? '+' : ''}${eur(diff)}</b>` : ''
    }${c.learned ? ' · port réel retenu pour les prochains calculs' : ''}</p>
      ${
        extra.length
          ? html`<p class="small warn-text">Plus d’articles que prévu chez ${extra.map((x) => x.name).join(', ')} : doublons ou reste d’un ancien panier ? Vérifie ton panier.</p>`
          : ''
      }
      ${
        others.length
          ? html`<p class="small muted">Ton panier contient aussi ${plural(others.length, 'autre vendeur', 'autres vendeurs')} (${eur(
              sum(others, 'value') + sum(others, 'shipping')
            )}), hors de ce plan.</p>`
          : ''
      }
    </div>`;
  }

  // ---------- Test sur le vrai site ----------

  async function runSelfTest() {
    if ((state.selfTest && state.selfTest.running) || state.running) return;
    const game = GAMES.some(([g]) => g === state.context.game) ? state.context.game : 'Pokemon';
    const loc = locale();
    const T = (state.selfTest = { running: true, steps: [] });
    const step = (label) => {
      const st = { label, status: 'running', detail: '', diag: '' };
      T.steps.push(st);
      render();
      return st;
    };
    const done = (st, status, detail, diag) => {
      Object.assign(st, { status, detail, diag: diag || '' });
      render();
    };
    const pct = (n, of) => (of ? Math.round((100 * n) / of) + ' %' : '—');
    const fetcher = new Fetcher({ delayMs: state.settings.delayMs });
    let current = null;
    try {
      let key = state.context.kind === 'product' ? state.context.key : (state.cards.find((c) => cm.productKind(c.key) === 'single') || {}).key;

      current = step('Recherche avec un nom français');
      const fr = game === 'Pokemon' ? 'Dracaufeu' : 'a';
      const { doc: sdoc, finalUrl } = await fetcher.getDoc(cm.searchUrl(game, fr, loc, 'singles'));
      const found = cm.productKey(finalUrl) ? [{ key: cm.productKey(finalUrl) }] : cm.parseSearchPage(sdoc);
      if (game !== 'Pokemon') done(current, 'skip', 'Test prévu pour Pokémon.');
      else
        done(
          current,
          found.length ? 'ok' : 'warn',
          found.length
            ? `${found.length} résultats pour « Dracaufeu » : les noms français sont reconnus.`
            : 'Aucun résultat pour « Dracaufeu » : utilise les noms anglais ou les numéros (« Houndoom (SFA 066) »).'
        );
      if (!key && found.length) key = found[0].key;
      if (!key) throw new Error('Aucune carte pour continuer : ajoute une carte à ta liste puis relance le test.');

      current = step('Lecture des offres d’une carte');
      const url = cm.keyToUrl(key, 'en');
      const { doc: pdoc } = await fetcher.getDoc(url);
      const page = cm.parseProductPage(pdoc);
      const offers = page.offers;
      const n = offers.length;
      const sorted = offers.every((o, i) => i === 0 || o.price >= offers[i - 1].price - 0.001);
      const fields = [
        ['vendeur', offers.filter((o) => o.seller && o.seller.name).length],
        ['pays', offers.filter((o) => o.seller && o.seller.countryCode).length],
        ['état', offers.filter((o) => o.condition).length],
        ['langue', offers.filter((o) => o.languageId).length],
      ];
      const weak = fields.filter(([, k]) => k < n * 0.9);
      done(
        current,
        !n ? 'bad' : weak.length || !sorted ? 'warn' : 'ok',
        `${page.product.name || key} : ${n} offres lues · ${fields.map(([l, k]) => `${l} ${pct(k, n)}`).join(' · ')} · ${
          sorted ? 'triées du moins cher au plus cher' : 'PAS triées par prix : les « moins chères » peuvent manquer'
        }${page.loadMore ? ' · « Afficher plus » disponible' : ''}`,
        n ? '' : cm.cartDiagnostic(pdoc, 0)
      );

      current = step('Bouton « ajouter au panier »');
      const loggedOut = cm.isLoggedOut(pdoc);
      if (loggedOut) done(current, 'warn', 'Tu n’es pas connecté à Cardmarket : connecte-toi puis relance le test pour vérifier le panier.');
      else if (!n) done(current, 'skip', 'Pas d’offre à tester.');
      else {
        const req = cm.cartRequest(pdoc, offers[0].id, 1, url);
        if (req.error) done(current, 'bad', `Formulaire panier introuvable (${req.error}).`, cm.cartDiagnostic(pdoc, offers[0].id));
        else
          done(
            current,
            'ok',
            `Formulaire trouvé (${req.ajax ? 'action AJAX' : 'formulaire classique'} « ${decodeURIComponent(new URL(req.url).pathname.split('/').pop())} », champs : ${req.fields
              .map(([k]) => k)
              .join(', ')}). Rien n’a été ajouté.`
          );
      }

      current = step('Recherche dans le stock d’un vendeur');
      const seller = (offers.find((o) => o.seller) || {}).seller;
      if (!seller) done(current, 'skip', 'Pas de vendeur à tester.');
      else {
        const name = cm.searchableName(page.product.name);
        const { doc: stock } = await fetcher.getDoc(cm.sellerStockSearchUrl(game, seller.name, name, 'en'));
        const rows = cm.parseOfferRows(stock);
        const has = rows.some((r) => r.productKey === key);
        const filtered = rows.length && rows.every((r) => cm.norm(r.productName).includes(cm.norm(name)));
        done(
          current,
          has && filtered ? 'ok' : has ? 'warn' : 'bad',
          has
            ? `${rows.length} offres « ${name} » chez ${seller.name}${filtered ? '' : ' (filtre par nom partiel)'} : la vérification approfondie fonctionne.`
            : `Carte non retrouvée chez ${seller.name} (${rows.length} lignes lues) : la vérification approfondie ne marchera pas.`,
          has ? '' : rows.slice(0, 3).map((r) => r.productName).join(' | ')
        );
      }

      current = step('Liste d’une extension, par numéro');
      const slug = key.split('/')[3];
      const { doc: ldoc } = await fetcher.getDoc(cm.expansionListUrl(game, { slug }, loc));
      const list = cm.parseSearchPage(ldoc);
      const numbered = list.filter((r) => r.number).length;
      done(
        current,
        list.length && numbered >= list.length * 0.9 ? 'ok' : list.length ? 'warn' : 'bad',
        `${list.length} cartes lues pour « ${slug.replace(/-/g, ' ')} » · ${pct(numbered, list.length)} avec numéro · ${cm.parsePagination(ldoc).pages} page(s)`
      );

      current = step('Page panier et frais de port réels');
      if (loggedOut) done(current, 'skip', 'Nécessite d’être connecté.');
      else {
        const html = (await fetcher.request(cm.cartUrl(game, 'en'))).text;
        const c = cm.parseCartPage(new DOMParser().parseFromString(html, 'text/html'));
        const withShip = c.sellers.filter((x) => x.shipping != null).length;
        done(
          current,
          !c.blocks ? 'warn' : withShip ? 'ok' : 'warn',
          !c.blocks
            ? 'Panier vide (ou non reconnu) : mets une carte au panier et relance pour vérifier la lecture du port réel.'
            : `${c.sellers.length} vendeur(s) au panier · port lu pour ${withShip}${withShip ? '' : ' : le port réel ne sera pas appris'}`,
          withShip ? '' : html.replace(/\s+/g, ' ').match(/.{0,200}(shipping|Shipping).{0,300}/) ? html.replace(/\s+/g, ' ').match(/.{0,200}(shipping|Shipping).{0,300}/)[0] : ''
        );
      }
    } catch (e) {
      if (current && current.status === 'running') done(current, 'bad', e.message || String(e));
    } finally {
      T.running = false;
      T.at = Date.now();
      render();
    }
  }

  function selfTestReport() {
    const T = state.selfTest;
    const icon = { ok: '✓', warn: '!', bad: '✗', skip: '–', running: '…' };
    const lines = [`Regroupeur ${chrome.runtime.getManifest ? chrome.runtime.getManifest().version : ''} — test Cardmarket (${location.pathname})`];
    for (const st of T.steps) {
      lines.push(`${icon[st.status]} ${st.label} : ${st.detail}`);
      if (st.diag) lines.push('    ' + st.diag.replace(/(value=")[a-f0-9]{24,}(")/gi, '$1…$2').slice(0, 1500));
    }
    return lines.join('\n');
  }

  function renderSelfTest() {
    const T = state.selfTest;
    const icon = { ok: '✓', warn: '!', bad: '✗', skip: '–' };
    return html`<div class="section">
      <h3>Tester sur Cardmarket</h3>
      <p class="help">Vérifie en ≈ 5 pages ce qui dépend du vrai site : recherche en français, lecture des offres, bouton panier (sans rien ajouter), stock vendeur, liste d’extension, page panier. Sois connecté pour tout tester.</p>
      ${
        T
          ? html`<ul class="selftest">${T.steps.map(
              (st) => html`<li class="st-${st.status}"><span class="st-icon">${st.status === 'running' ? html`<span class="spinner"></span>` : icon[st.status]}</span><span><b>${
                st.label
              }</b>${st.detail ? html`<br><span class="small muted">${st.detail}</span>` : ''}</span></li>`
            )}</ul>`
          : ''
      }
      <div class="row-actions spaced">
        <button class="btn small primary" data-act="self-test" ${attr((T && T.running) || state.running, 'disabled')}>${T ? 'Relancer le test' : 'Lancer le test'}</button>
        ${T && !T.running ? html`<button class="btn small" data-act="self-test-copy">Copier le rapport</button>` : ''}
      </div>
    </div>`;
  }

  function cartSummary(entry) {
    const results = entry.results || [];
    const ok = results.filter((r) => (r.status === 'added' || r.status === 'replaced') && r.inCart !== false);
    const problems = results.filter((r) => !ok.includes(r));
    return { ok, problems };
  }

  async function copyCartDiagnostic(k) {
    const entry = state.cart[k] || {};
    const lines = [`Regroupeur ${chrome.runtime.getManifest ? chrome.runtime.getManifest().version : ''} — diagnostic panier`, `page : ${location.pathname}`];
    for (const r of entry.results || []) {
      lines.push(`- article ${r.articleId} : ${r.status}${r.inCart === false ? ' (absent du panier)' : ''} ${r.message || ''}`);
      if (r.request) lines.push(`  POST ${r.request.url} champs=${r.request.fields.join(',')}`);
      if (r.diag) lines.push('  ' + r.diag);
    }
    if (entry.message) lines.push('erreur : ' + entry.message);
    await copyText(lines.join('\n'), 'Diagnostic copié : colle-le dans la conversation');
  }

  // ---------- Analyse ----------

  function estimate() {
    const s = state.settings;
    let pages = 0;
    for (const c of state.cards) {
      const f = analyzer.effectiveFilters(c, s);
      pages += f.graded === 'only' ? Math.max(4, s.pagesPerCard) * 0.8 : 1 + (s.pagesPerCard - 1) * 0.6;
    }
    const singles = state.cards.filter((c) => cm.productKind(c.key) === 'single').length;
    pages += s.deepCheck ? Math.min(s.deepMaxRequests, s.deepSellers * singles * 0.4) : 0;
    const requests = Math.round(pages);
    const capped = s.maxRequests > 0 && requests > s.maxRequests;
    const seconds = Math.min(requests, capped ? s.maxRequests : requests) * (s.delayMs / 1000 * 1.2 + 0.8);
    return { requests, capped, minutes: Math.max(1, Math.round(seconds / 60)) };
  }

  async function startAnalysis() {
    if (state.running || state.resolving || !state.cards.length) return;
    const abort = new AbortController();
    const settings = JSON.parse(JSON.stringify(state.settings));
    const cards = state.cards.map((c) => Object.assign({}, c));
    const listId = state.listId;
    state.running = true;
    state.cart = {}; // nouveaux résultats : les états « ajouté au panier » ne s’appliquent plus
    state.abort = abort;
    state.tab = 'results';
    state.progress = { phase: 'cards', done: 0, total: cards.length, requests: 0, startedAt: Date.now(), label: '' };
    saveUi();
    render();

    const fetcher = new Fetcher({
      delayMs: settings.delayMs,
      onWait: (seconds) => {
        state.progress.wait = seconds;
        render();
      },
    });
    const analysis = new analyzer.Analysis({
      settings,
      fetcher,
      store,
      onProgress: (p) => {
        Object.assign(state.progress, p);
        render();
      },
    });
    try {
      const ds = await analysis.run(cards, abort.signal);
      state.interrupted = false;
      try {
        await store.set(store.datasetKey(listId), ds);
      } catch (e) {
        console.warn('[Regroupeur] résultats non sauvegardés', e);
      }
      if (state.listId === listId) {
        state.dataset = ds;
        adoptProductNames(ds);
      }
      recompute();
      if (ds.stopReason && ds.stopReason.code !== 'ABORTED') toast('Analyse interrompue');
      else if (ds.stopReason) toast('Analyse arrêtée');
      else toast('Analyse terminée');
    } catch (e) {
      console.error('[Regroupeur]', e);
      toast('Erreur pendant l’analyse : ' + e.message);
    } finally {
      state.running = false;
      state.abort = null;
      state.progress = null;
      saveUi();
      render();
    }
  }

  /** Les cartes ajoutées par lien prennent le vrai nom lu sur leur page produit. */
  function adoptProductNames(ds) {
    let changed = false;
    for (const card of state.cards) {
      const d = ds.cards[card.id];
      if (!card.autoName || !d || !d.product || !d.product.name) continue;
      card.name = d.product.name;
      card.expansion = d.product.expansion || card.expansion || '';
      card.number = d.product.number || card.number || '';
      card.autoName = false;
      changed = true;
    }
    if (changed) saveList();
  }

  function stopAnalysis() {
    if (state.abort) state.abort.abort();
  }

  // ---------- Rendu : lanceur ----------

  function renderLauncher() {
    if (state.open) return '';
    const ctx = state.context;
    let add = '';
    if (ctx.kind === 'product') {
      const inList = state.cards.some((c) => c.key === ctx.key);
      add = inList
        ? html`<button class="add done" data-act="open-list">✓ Dans ta liste</button>`
        : html`<button class="add" data-act="add-current">+ Ajouter ${cm.productKind(ctx.key) === 'sealed' ? 'ce produit' : 'cette carte'}</button>`;
    }
    if (ctx.kind === 'seller') {
      const cov = sellerCoverage(ctx.seller);
      if (cov && cov.covered) {
        add = html`<button class="add ${cov.inPlan ? 'done' : ''}" data-act="open-results" title="Voir les résultats">${cov.inPlan ? '★ Dans ton plan · ' : ''}${plural(
          cov.covered,
          'carte',
          'cartes'
        )} de ta liste ici</button>`;
      }
    }
    let badge = html`<span class="count">${state.cards.length}</span>`;
    if (state.running && state.progress) {
      const p = state.progress;
      badge = html`<span class="count">${p.total ? Math.round((100 * (p.done || 0)) / p.total) : 0} %</span>`;
    }
    const upd = state.update && state.update.readyToActivate
      ? html`<button class="add" data-act="apply-update" title="Installer la nouvelle version du Regroupeur">⟳ Mise à jour prête</button>`
      : '';
    return html`<div class="launcher">${upd}${add}<button data-act="open" aria-label="Ouvrir le Regroupeur">${raw(ICON.logo)} Regroupeur ${badge}</button></div>`;
  }

  // ---------- Rendu : panneau ----------

  function tabButton(id, label, pill) {
    return html`<button class="tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}${
      pill != null && pill !== '' ? html`<span class="pill">${pill}</span>` : ''
    }</button>`;
  }

  function renderPanel() {
    if (!state.open) return '';
    const body = state.tab === 'settings' ? renderSettings() : state.tab === 'results' ? renderResults() : renderList();
    return html`<section class="panel ${state.wide ? 'wide' : ''}" role="dialog" aria-label="Regroupeur Cardmarket">
      <header class="head">
        <div class="brand">${raw(ICON.logo)}<div><strong>Regroupeur</strong><span>Moins de vendeurs, moins de frais de port</span></div></div>
        <button class="btn small ${state.tab === 'settings' ? 'active' : ''}" data-act="settings">Réglages</button>
        <button class="icon-btn" data-act="wide" title="${state.wide ? 'Réduire' : 'Agrandir'}" aria-label="${state.wide ? 'Réduire le panneau' : 'Agrandir le panneau'}">${raw(
      state.wide ? ICON.collapse : ICON.expand
    )}</button>
        <button class="icon-btn" data-act="close" title="Fermer" aria-label="Fermer le panneau">${raw(ICON.close)}</button>
      </header>
      <nav class="tabs" role="tablist">
        ${tabButton('list', '1 · Mes cartes', state.cards.length)}
        ${tabButton('results', '2 · Résultats', state.running ? '…' : null)}
        ${state.tab === 'settings' ? tabButton('settings', 'Réglages') : ''}
      </nav>
      ${renderUpdateBanner()}
      <div class="body">${body}</div>
      ${renderFooter()}
      ${
        state.toast
          ? html`<div class="toast ${state.toast.action ? 'has-action' : ''}" role="status">${state.toast.msg}${
              state.toast.action ? html`<button class="btn link small" data-act="${state.toast.action.act}">${state.toast.action.label}</button>` : ''
            }</div>`
          : ''
      }
    </section>`;
  }

  function renderFooter() {
    if (state.running) {
      return html`<footer class="foot"><span class="hint">Recherche en cours : garde cet onglet ouvert.</span><button class="btn danger" data-act="stop">Arrêter</button></footer>`;
    }
    if (state.tab === 'settings') {
      return html`<footer class="foot"><span class="hint">Enregistré automatiquement.</span><button class="btn primary" data-act="back">Retour à mes cartes</button></footer>`;
    }
    const n = state.cards.length;
    const est = estimate();
    let hint;
    if (!n) hint = 'Ajoute au moins une carte pour commencer.';
    else if (state.resolving) hint = 'Recherche des cartes en cours…';
    else if (est.capped) hint = html`<span class="warn-text">≈ ${est.requests} pages : au-delà de la limite de ${state.settings.maxRequests} (Réglages)</span>`;
    else hint = `${plural(n, 'carte', 'cartes')} · ≈ ${est.requests} pages · environ ${est.minutes} min`;
    const label = state.tab === 'results' && state.results ? 'Relancer la recherche' : 'Trouver les vendeurs →';
    return html`<footer class="foot"><span class="hint">${hint}</span><button class="btn primary" data-act="analyse" ${attr(
      !n || state.resolving,
      'disabled'
    )}>${label}</button></footer>`;
  }

  // ---------- Onglet « Ma liste » ----------

  function renderContextBanner() {
    const ctx = state.context;
    if (ctx.kind === 'seller') {
      const cov = sellerCoverage(ctx.seller);
      if (!cov || !cov.covered) return '';
      return html`<div class="banner">
        <div class="grow"><p class="title truncate">${ctx.seller}${cov.inPlan ? ' ★' : ''}</p><p class="small muted">${plural(
        cov.covered,
        'carte',
        'cartes'
      )} de ta liste sur ${cov.total} · ${eur(cov.cost)}${cov.inPlan ? ' · fait partie de ton plan' : ''}</p></div>
        <button class="btn small" data-act="open-results">Résultats</button>
      </div>`;
    }
    if (ctx.kind === 'product') {
      const inList = state.cards.some((c) => c.key === ctx.key);
      const info = ctx.info || {};
      return html`<div class="banner">
        <div class="grow"><p class="title truncate">${info.name || nameFromKey(ctx.key)}</p><p class="small muted truncate">${[
        info.expansion,
        info.number && 'n° ' + info.number,
      ]
        .filter(Boolean)
        .join(' · ')}</p></div>
        ${inList ? html`<span class="tag ok">Dans la liste</span>` : html`<button class="btn primary small" data-act="add-current">Ajouter</button>`}
      </div>`;
    }
    if (ctx.kind === 'wants') {
      const n = (ctx.items || []).length;
      return html`<div class="banner">
        <div class="grow"><p class="title">Wants list détectée</p><p class="small muted">${
          n ? plural(n, 'carte lisible sur cette page', 'cartes lisibles sur cette page') : 'Aucune carte lisible sur cette page'
        }</p></div>
        <button class="btn primary small" data-act="import-wants" ${attr(!n, 'disabled')}>Importer</button>
      </div>`;
    }
    return '';
  }

  function languageLabel(ids) {
    if (!ids || !ids.length) return 'toutes';
    return ids.map((id) => (cm.LANGUAGES.find((l) => l.id === id) || {}).short || id).join(', ');
  }

  function cardStatus(card) {
    const info = state.results && state.results.cardInfo[card.id];
    if (!state.dataset) return '';
    if (!info || (!info.analysed && !info.error)) return html`<span class="tag">à analyser</span>`;
    if (info.error) return html`<span class="tag bad" title="${info.error}">erreur</span>`;
    if (!info.sellers) return html`<span class="tag warn">introuvable</span>`;
    return html`<span class="tag" title="${plural(info.sellers, 'vendeur', 'vendeurs')}">${info.sellers} vend. · dès ${eur(info.cheapest)}</span>`;
  }

  function gradedText(f) {
    if (f.graded === 'exclude') return 'loose';
    if (f.graded === 'any') return 'loose ou gradée';
    const who = f.gradeCompany || 'gradée';
    return f.minGrade ? `${who} ${String(f.minGrade).replace('.', ',')}${f.minGrade < 10 ? '+' : ''}` : who;
  }

  function cardSummary(card) {
    const s = state.settings;
    const f = analyzer.effectiveFilters(card, s);
    const parts = [languageLabel(f.languages)];
    if (f.kind === 'single') {
      parts.push(gradedText(f));
      if (f.graded !== 'only') parts.push(`${f.minCondition}+`);
      if (f.special !== 'exclude') parts.push(f.special === 'only' ? 'reverse/foil' : 'toutes versions');
    }
    if (f.maxPrice) parts.push(`≤ ${eur(f.maxPrice)}`);
    const custom = card.languages != null || card.minCondition || card.special || card.maxPrice || card.graded;
    return { text: parts.join(' · '), custom, f };
  }

  function renderCardRow(card) {
    const s = state.settings;
    const open = !!state.view.expanded['card:' + card.id];
    const langValue = card.languages == null ? '' : card.languages.length ? String(card.languages[0]) : 'all';
    const meta = [card.expansion, card.number && 'n° ' + card.number].filter(Boolean).join(' · ');
    const summary = cardSummary(card);
    const f = summary.f;
    const single = f.kind === 'single';
    const qty = card.qty || 1;
    return html`<li class="card-row">
      <div class="card-line">
        ${thumb(card.image)}
        <div class="grow card-main">
          <div class="card-top">
            <a class="name truncate" href="${productHref(card.key)}" target="_blank" rel="noopener" title="${card.name}">${card.name}</a>
            ${!single ? html`<span class="tag">Scellé</span>` : f.graded === 'only' ? html`<span class="tag accent">${gradedText(f)}</span>` : ''}
            ${cardStatus(card)}
          </div>
          ${meta ? html`<div class="card-meta truncate">${meta}</div>` : ''}
          <div class="card-meta">
            <span class="${summary.custom ? 'custom' : ''}">${summary.text}</span>
            <button class="btn link small" data-act="toggle" data-key="card:${card.id}" aria-expanded="${open}">${open ? 'Fermer' : 'Modifier'}</button>
          </div>
        </div>
        <div class="stepper" role="group" aria-label="Quantité">
          <button data-act="qty" data-id="${card.id}" data-d="-1" aria-label="Une de moins" ${attr(qty <= 1, 'disabled')}>−</button>
          <span>${qty}</span>
          <button data-act="qty" data-id="${card.id}" data-d="1" aria-label="Une de plus">+</button>
        </div>
        <button class="icon-btn" data-act="remove" data-id="${card.id}" title="Retirer" aria-label="Retirer ${card.name}">${raw(ICON.trash)}</button>
      </div>
      ${
        open
          ? html`<div class="card-controls">
        <label>Langue <select class="compact" data-card="${card.id}" data-field="languages">
          <option value="" ${attr(langValue === '', 'selected')}>Défaut (${languageLabel(s.languages)})</option>
          <option value="all" ${attr(langValue === 'all', 'selected')}>Toutes</option>
          ${cm.LANGUAGES.map((l) => html`<option value="${l.id}" ${attr(langValue === String(l.id), 'selected')}>${l.fr}</option>`)}
        </select></label>
        ${
          single
            ? html`<label>Type <select class="compact" data-card="${card.id}" data-field="graded">
          <option value="" ${attr(!card.graded, 'selected')}>Défaut (${GRADED_LABELS[s.graded]})</option>
          ${Object.entries(GRADED_LABELS).map(([v, l]) => html`<option value="${v}" ${attr(card.graded === v, 'selected')}>${l}</option>`)}
        </select></label>
        ${
          f.graded === 'only'
            ? html`<label>Gradation <select class="compact" data-card="${card.id}" data-field="gradeCompany">
          <option value="" ${attr(!f.gradeCompany, 'selected')}>Toutes</option>
          ${GRADE_COMPANIES.map((g) => html`<option value="${g}" ${attr(f.gradeCompany === g, 'selected')}>${g}</option>`)}
        </select></label>
        <label>Note min. <select class="compact" data-card="${card.id}" data-field="minGrade">
          <option value="" ${attr(!f.minGrade, 'selected')}>Toutes</option>
          ${MIN_GRADES.map((g) => html`<option value="${g}" ${attr(f.minGrade === g, 'selected')}>${String(g).replace('.', ',')}${g < 10 ? ' ou +' : ''}</option>`)}
        </select></label>`
            : html`<label>État min. <select class="compact" data-card="${card.id}" data-field="minCondition">
          <option value="" ${attr(!card.minCondition, 'selected')}>Défaut (${s.minCondition})</option>
          ${cm.CONDITIONS.map((c) => html`<option value="${c.code}" ${attr(card.minCondition === c.code, 'selected')}>${c.code} · ${c.fr}</option>`)}
        </select></label>`
        }
        <label>Version <select class="compact" data-card="${card.id}" data-field="special">
          <option value="" ${attr(!card.special, 'selected')}>Défaut</option>
          ${Object.entries(SPECIAL_LABELS).map(([v, l]) => html`<option value="${v}" ${attr(card.special === v, 'selected')}>${l}</option>`)}
        </select></label>`
            : ''
        }
        <label>Prix max <input class="compact" type="number" min="0" step="0.01" placeholder="—" value="${card.maxPrice || ''}" data-card="${
              card.id
            }" data-field="maxPrice"> €</label>
      </div>`
          : ''
      }
    </li>`;
  }

  function renderPending() {
    const pending = state.pending.filter((p) => p.status !== 'done');
    if (!pending.length) return '';
    const queued = pending.filter((p) => p.status === 'queued').length;
    const head = html`<div class="pending-head">
      <span class="grow small"><b>${plural(pending.length, 'carte cherchée par nom', 'cartes cherchées par nom')}</b>${
      state.pendingNeedsOk ? html` · ${queued} recherches = ${queued} pages lues` : ''
    }</span>
      ${state.pendingNeedsOk ? html`<button class="btn small primary" data-act="pending-go">Lancer les ${queued} recherches</button>` : ''}
      <button class="btn link small" data-act="pending-clear">Tout effacer</button>
    </div>`;
    return html`${head}<div class="pending">${pending.map((p) => {
      let body;
      if (p.status === 'queued' || p.status === 'searching')
        body = html`<span class="muted small">${p.status === 'searching' ? 'Recherche sur Cardmarket…' : 'En attente…'}</span>`;
      else if (p.status === 'none') body = html`<span class="small">Aucun résultat : vérifie le nom (tel qu’affiché sur Cardmarket).</span>`;
      else if (p.status === 'error') body = html`<span class="small">${p.error || 'Recherche impossible'}</span>`;
      else
        body = html`<select data-pending="${p.id}" aria-label="Choisir la bonne carte">${p.candidates.map(
          (c, i) =>
            html`<option value="${i}">${c.name} — ${c.expansion || '?'}${c.number ? ' · n° ' + c.number : ''}${
              c.from != null ? ' · dès ' + eur(c.from) : ''
            }</option>`
        )}</select>`;
      return html`<div class="pending-item">
        <div class="grow"><div class="truncate"><b>${p.want.name}</b> <span class="muted small">${[p.want.number, p.want.expansion]
        .filter(Boolean)
        .join(' · ')}</span></div>${body}</div>
        ${p.status === 'choose' ? html`<button class="btn small primary" data-act="pick" data-id="${p.id}">Ajouter</button>` : ''}
        ${p.status === 'error' ? html`<button class="btn small" data-act="retry" data-id="${p.id}">Réessayer</button>` : ''}
        <button class="icon-btn" data-act="drop-pending" data-id="${p.id}" aria-label="Ignorer">${raw(ICON.close)}</button>
      </div>`;
    })}</div>`;
  }

  function renderHowTo() {
    return html`<div class="howto box section">
      <p class="howto-title">Comment ça marche</p>
      <ol class="steps">
        <li><b>Ajoute les cartes que tu veux acheter</b> : tape leur nom ci-dessous, ou clique « + Ajouter cette carte » sur leur page Cardmarket.</li>
        <li><b>Clique « Trouver les vendeurs »</b> : l’extension regarde les vendeurs de chaque carte à ta place.</li>
        <li><b>Elle te dit chez qui commander</b> pour avoir toutes tes cartes en un minimum de colis, au meilleur prix port compris.</li>
      </ol>
    </div>`;
  }

  function renderSearch() {
    const sr = state.search;
    const inList = new Set(state.cards.map((c) => c.key));
    const kindLabel = (cm.SEARCH_KINDS.find((k) => k.key === state.searchKind) || {}).fr || 'Cartes';
    const singles = state.searchKind === 'singles';
    let results = '';
    if (sr.status === 'loading') results = html`<p class="muted small search-note">Recherche de « ${sr.last} » sur Cardmarket…</p>`;
    else if (sr.status === 'error') results = html`<div class="banner bad search-note"><p>${sr.error}</p></div>`;
    else if (sr.status === 'done' && !sr.results.length)
      results = html`<p class="muted small search-note">Rien trouvé pour « ${sr.last} » dans « ${kindLabel} ». Essaie le nom exact affiché sur Cardmarket (français ou anglais), ou une autre catégorie.</p>`;
    else if (sr.status === 'done')
      results = html`<p class="small muted search-note">${plural(sr.results.length, 'résultat', 'résultats')} pour « ${sr.last} » : ajoute la bonne version.</p>
        <ul class="results box">${sr.results.map((c, i) => {
          const added = inList.has(c.key);
          const meta = [c.expansion, c.number && 'n° ' + c.number, c.from != null && 'dès ' + eur(c.from)].filter(Boolean).join(' · ');
          const isSingle = cm.productKind(c.key) === 'single';
          return html`<li class="result">
            ${thumb(c.image)}
            <div class="grow"><a class="truncate result-name" href="${productHref(c.key)}" target="_blank" rel="noopener" title="Voir sur Cardmarket">${c.name}</a><div class="small muted truncate">${meta}</div></div>
            ${
              added
                ? html`<span class="tag ok">✓ Ajoutée</span>`
                : html`<span class="result-actions">${
                    isSingle ? html`<button class="btn small" data-act="add-result" data-i="${i}" data-mode="graded" title="Ajouter en version gradée PSA">+ PSA</button>` : ''
                  }<button class="btn small primary" data-act="add-result" data-i="${i}">+ Ajouter</button></span>`
            }
          </li>`;
        })}</ul>`;
    return html`<div class="section">
      <h3>Ajouter une carte ou un coffret</h3>
      <div class="search-row">
        <input type="search" class="grow" data-model="searchQ" value="${sr.q}" placeholder="${
          singles ? 'Nom de la carte, ex. Pikachu ex' : 'Nom du produit, ex. Évolutions Prismatiques'
        }" aria-label="Nom à chercher" autocomplete="off">
        <button class="btn primary" data-act="search">Chercher</button>
      </div>
      <div class="search-opts">
        <div class="segmented" role="group" aria-label="Type de produit">${cm.SEARCH_KINDS.slice(0, 3).map(
          (k) => html`<button data-act="search-kind" data-kind="${k.key}" aria-pressed="${state.searchKind === k.key}">${k.fr}</button>`
        )}</div>
        <select class="compact" data-model="searchKind" aria-label="Autres catégories">
          <option value="" ${attr(['singles', 'sealed', 'boxes'].includes(state.searchKind), 'selected')}>Autres…</option>
          ${cm.SEARCH_KINDS.slice(3).map((k) => html`<option value="${k.key}" ${attr(state.searchKind === k.key, 'selected')}>${k.fr}</option>`)}
        </select>
        <select class="compact" data-model="addGame" aria-label="Jeu">${GAMES.map(
          ([id, label]) => html`<option value="${id}" ${attr(state.addGame === id, 'selected')}>${label}</option>`
        )}</select>
      </div>
      ${results}
    </div>`;
  }

  const failedThumbs = new Set();
  function thumb(src) {
    return src && !failedThumbs.has(src)
      ? html`<img class="thumb" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : html`<span class="thumb empty"></span>`;
  }

  function renderBulkGroup(g, many) {
    const busy = g.status === 'detecting' || g.status === 'loading' || g.status === 'waiting';
    const head = html`<div class="bulk-head">
      <div class="grow">
        ${g.code ? html`<span class="tag">${g.code}</span> ` : ''}<b>${plural(g.wants.length, 'ligne', 'lignes')}</b>
        ${g.expansion ? html` · <b>${g.expansion.name}</b>` : ''}
        ${
          g.status === 'preview'
            ? html` · <span class="${g.unmatched.length ? 'warn-text' : 'ok-text'}">${g.matched.length}/${g.wants.length} trouvées</span>`
            : ''
        }
      </div>
      ${g.status === 'preview' ? html`<button class="btn link small" data-act="bulk-change" data-g="${g.i}">Autre extension</button>` : ''}
    </div>`;
    if (busy) return html`<div class="bulk-group">${head}<p class="small muted bulk-note">${g.status === 'waiting' ? '' : html`<span class="spinner"></span>`} ${g.note}</p></div>`;
    if (g.status === 'error') {
      return html`<div class="bulk-group">${head}<div class="banner bad"><p>${g.note}</p></div><button class="btn small" data-act="bulk-retry" data-g="${g.i}">Réessayer</button></div>`;
    }
    if (g.status === 'choose' || g.changing) {
      const list = state.expansions[expansionsKey(state.bulk.game)] || [];
      return html`<div class="bulk-group">${head}
        <p class="small bulk-note">${g.note || 'Choisis l’extension :'}</p>
        ${g.log && g.log.length ? html`<p class="help">${g.log.join(' · ')}</p>` : ''}
        ${
          g.suggestions && g.suggestions.length
            ? html`<div class="chips">${g.suggestions.map(
                (e) => html`<button class="chip" data-act="bulk-exp" data-g="${g.i}" data-slug="${e.slug}" data-name="${e.name}">${e.name}</button>`
              )}</div>`
            : ''
        }
        ${
          list.length
            ? html`<div class="search-row spaced"><input class="grow" list="cmr-expansions" data-exp-pick="${g.i}" value="${g.pickText}" placeholder="Nom de l’extension, ex. Fable Nébuleuse" autocomplete="off">
                <button class="btn primary small" data-act="exp-pick" data-g="${g.i}">Utiliser</button></div>`
            : html`<button class="btn small" data-act="exp-options" data-g="${g.i}">Afficher la liste des extensions</button>`
        }
      </div>`;
    }
    const rows = g.matched.map((m, i) => {
      const options = [m.product].concat(m.alternatives);
      return html`<li class="bulk-row">
        <span class="bulk-num">${m.want.number}</span>
        <span class="bulk-want truncate" title="${m.want.name}">${m.want.name}${m.want.qty > 1 ? html` <b>×${m.want.qty}</b>` : ''}</span>
        <span class="bulk-arrow" aria-hidden="true">→</span>
        ${
          options.length > 1
            ? html`<select class="compact bulk-pick" data-bulk-alt="${g.i}:${i}" aria-label="Version">${options.map((p, j) => html`<option value="${j}">${p.name}</option>`)}</select>`
            : html`<a class="bulk-found truncate" href="${productHref(m.product.key)}" target="_blank" rel="noopener" title="${m.product.name}">${m.product.name}</a>`
        }
        ${m.nameMatch ? html`<span class="tag ok" title="Même nom">✓</span>` : html`<span></span>`}
      </li>`;
    });
    const missing = g.unmatched.map(
      (w) => html`<li class="bulk-row missing"><span class="bulk-num">${w.number}</span><span class="bulk-want truncate">${w.name}</span><span class="small">numéro absent de cette extension</span></li>`
    );
    return html`<div class="bulk-group">${head}
      <ul class="bulk-list ${many ? 'short' : ''}">${rows}${missing}</ul>
      ${
        g.unmatched.length
          ? html`<button class="btn small spaced" data-act="bulk-byname" data-g="${g.i}">${
              g.unmatched.length > 1 ? `Chercher les ${g.unmatched.length} autres par nom` : 'Chercher l’autre par nom'
            }</button>`
          : ''
      }
    </div>`;
  }

  function renderBulk() {
    const b = state.bulk;
    if (!b) return '';
    const list = state.expansions[expansionsKey(b.game)] || [];
    const ready = b.groups.filter((g) => g.status === 'preview');
    const count = ready.reduce((n, g) => n + g.matched.length, 0);
    const busy = b.groups.some((g) => ['waiting', 'detecting', 'loading'].includes(g.status));
    return html`<div class="bulk box">
      <p class="help bulk-note">Chaque ligne est associée à la carte qui porte ce numéro dans son extension : vérifie d’un coup d’œil, puis ajoute.</p>
      ${b.groups.map((g) => renderBulkGroup(g, b.groups.length > 1))}
      <datalist id="cmr-expansions">${list.map((e) => html`<option value="${e.name}"></option>`)}</datalist>
      <div class="row-actions spaced">
        <button class="btn primary small" data-act="bulk-add" ${attr(!count || busy, 'disabled')}>${
      busy && !count ? 'Lecture en cours…' : `Ajouter ${plural(count, 'carte', 'cartes')} à ma liste`
    }</button>
        <button class="btn small" data-act="bulk-cancel">Annuler</button>
      </div>
    </div>`;
  }

  function renderList() {
    const cards = state.cards;
    const s = state.settings;
    const list = cards.length
      ? html`<div class="section">
          <div class="section-head"><h3>Ma liste (${cards.length})</h3><button class="btn link small" data-act="clear-list">Tout retirer</button></div>
          ${renderActiveFilters()}
          <p class="help list-defaults">« Modifier » sur une carte pour lui donner d’autres critères · <button class="btn link small" data-act="settings">tous les réglages</button></p>
          <ul class="cards box">${cards.map(renderCardRow)}</ul>
        </div>`
      : '';
    return html`${renderListPicker()}${renderContextBanner()}${cards.length ? '' : renderHowTo()}${renderSearch()}${list}
      <details class="section disclosure" data-details="bulk" ${attr(!!state.view.expanded.bulk || state.pending.length > 0 || !!state.bulk, 'open')}>
        <summary>Coller une liste de cartes</summary>
        <div class="spaced">
          ${renderBulk()}
          <textarea data-model="addText" spellcheck="false" placeholder="${
            'Une carte par ligne, par exemple :\n065 — Tokotoro\nHoundoom (SFA 066)\n2x 085 Pêchaminus-ex\nhttps://www.cardmarket.com/fr/Pokemon/Products/Singles/…'
          }">${state.addText}</textarea>
          <p class="help">Le plus fiable : avec le numéro, <b>« 065 — Tokotoro »</b> ou comme sur Cardmarket <b>« Houndoom (SFA 066) »</b>. L’extension est reconnue toute seule et chaque carte est retrouvée par son numéro : quelques pages lues pour toute la liste. Sans numéro, chaque nom est cherché un par un (on te demande avant d’en lancer beaucoup). Format détaillé possible : <b>Nom | Numéro | Extension | Langue | État | Qté</b>.</p>
          <div class="card-controls"><span class="grow"></span><button class="btn primary small" data-act="add-text">Lire la liste</button></div>
          ${renderPending()}
        </div>
      </details>`;
  }

  // ---------- Onglet « Réglages » ----------

  function numberField(path, value, { step = '0.01', min = '0', suffix = '€' } = {}) {
    return html`<span><input type="number" step="${step}" min="${min}" value="${value ?? ''}" data-setting="${path}" data-type="number"> ${suffix}</span>`;
  }

  function renderLearnedShipping() {
    const L = analyzer.learnedShipping(state.settings.learnedShipping);
    const rows = Object.entries(L).filter(([, v]) => v.letter != null || v.tracked != null || v.insured != null);
    if (!rows.length) return html`<div class="full help">Après un ajout au panier, les frais de port réels lus sur Cardmarket remplacent ces estimations pour les pays concernés.</div>`;
    return html`<div class="label">Frais vus au panier</div>
      <div class="small">${rows.map(([country, v]) => {
        const c = cm.findCountry(country);
        return html`<span class="tag">${c ? c.fr : country} : ${[
          v.letter != null && 'lettre ' + eur(v.letter),
          v.tracked != null && 'suivi ' + eur(v.tracked),
          v.insured != null && 'assuré ' + eur(v.insured),
        ]
          .filter(Boolean)
          .join(' · ')}</span> `;
      })}<button class="btn link small" data-act="forget-shipping">Oublier</button></div>`;
  }

  function renderSettings() {
    const s = state.settings;
    const sh = s.shipping;
    const countryOptions = (selected) =>
      cm.COUNTRIES.slice()
        .sort((a, b) => a.fr.localeCompare(b.fr, 'fr'))
        .map((c) => html`<option value="${c.code}" ${attr(c.code === selected, 'selected')}>${c.fr}</option>`);
    return html`
      ${renderSelfTest()}
      <div class="section">
        <h3>Cartes recherchées — par défaut</h3>
        <div class="form-grid">
          <div class="label">Langues acceptées</div>
          <div class="chips">${cm.LANGUAGES.map(
            (l) =>
              html`<button class="chip" data-act="toggle-lang" data-id="${l.id}" aria-pressed="${s.languages.includes(l.id)}" title="${l.fr}">${l.short}</button>`
          )}</div>
          <div class="full help">Aucune langue cochée = toutes les langues. Chaque carte peut avoir sa propre langue dans « Ma liste ».</div>
          <div class="label">État minimum</div>
          <select data-setting="minCondition">${cm.CONDITIONS.map(
            (c) => html`<option value="${c.code}" ${attr(s.minCondition === c.code, 'selected')}>${c.code} · ${c.fr} ou mieux</option>`
          )}</select>
          <div class="label">Reverse / foil</div>
          <select data-setting="special">${Object.entries(SPECIAL_LABELS).map(
            ([v, l]) => html`<option value="${v}" ${attr(s.special === v, 'selected')}>${l}</option>`
          )}</select>
          <div class="label">1re édition</div>
          <select data-setting="firstEd">${Object.entries(FIRST_ED_LABELS).map(
            ([v, l]) => html`<option value="${v}" ${attr(s.firstEd === v, 'selected')}>${l}</option>`
          )}</select>
          <div class="label">Loose ou gradée</div>
          <select data-setting="graded">${Object.entries(GRADED_LABELS).map(
            ([v, l]) => html`<option value="${v}" ${attr(s.graded === v, 'selected')}>${l}</option>`
          )}</select>
          ${
            s.graded === 'only'
              ? html`<div class="label">Gradation</div>
          <select data-setting="gradeCompany" data-type="nullable"><option value="">Toutes</option>${GRADE_COMPANIES.map(
            (g) => html`<option value="${g}" ${attr(s.gradeCompany === g, 'selected')}>${g}</option>`
          )}</select>
          <div class="label">Note minimum</div>
          <select data-setting="minGrade" data-type="number"><option value="">Toutes</option>${MIN_GRADES.map(
            (g) => html`<option value="${g}" ${attr(s.minGrade === g, 'selected')}>${String(g).replace('.', ',')}${g < 10 ? ' ou +' : ''}</option>`
          )}</select>`
              : ''
          }
          <div class="full help">Cardmarket n’a pas de case « gradée » : l’extension la déduit du commentaire du vendeur (« PSA 10 », « CGC 9.5 »…). Les annonces « PSA ready » ou « candidate PSA » restent considérées comme loose.</div>
          <div class="label">Prix max par carte</div>
          ${numberField('maxPrice', s.maxPrice)}
          <div class="full"><label class="check"><input type="checkbox" data-setting="excludeSignedAltered" data-type="bool" ${attr(
            s.excludeSignedAltered,
            'checked'
          )}> Exclure les cartes signées ou altérées</label></div>
        </div>
      </div>

      <div class="section">
        <h3>Vendeurs</h3>
        <div class="form-grid">
          <div class="label">Types</div>
          <div class="chips">${cm.SELLER_TYPES.map(
            (t) => html`<button class="chip" data-act="toggle-type" data-key="${t.key}" aria-pressed="${s.sellerTypes.includes(t.key)}">${t.fr}</button>`
          )}</div>
          <div class="label">Pays d’expédition</div>
          <select data-setting="countryMode">
            <option value="all" ${attr(s.countryMode === 'all', 'selected')}>Tous les pays</option>
            <option value="mine" ${attr(s.countryMode === 'mine', 'selected')}>Uniquement mon pays</option>
            <option value="list" ${attr(s.countryMode === 'list', 'selected')}>Pays choisis…</option>
          </select>
          ${
            s.countryMode === 'list'
              ? html`<div class="full chips">${cm.COUNTRIES.map(
                  (c) =>
                    html`<button class="chip" data-act="toggle-country" data-code="${c.code}" aria-pressed="${s.countries.includes(c.code)}">${c.fr}</button>`
                )}</div>`
              : ''
          }
          <div class="label">Ventes minimum</div>
          ${numberField('minSales', s.minSales, { step: '1', suffix: 'ventes' })}
          <div class="full help">Le nombre de ventes sert de mesure de réputation (affiché à côté de chaque vendeur sur Cardmarket).</div>
          ${
            s.excludedSellers.length
              ? html`<div class="label">Vendeurs exclus</div><div class="chips">${s.excludedSellers.map(
                  (name) => html`<button class="chip" data-act="unexclude" data-name="${name}" title="Réautoriser">${name} ✕</button>`
                )}</div>`
              : ''
          }
        </div>
      </div>

      <div class="section">
        <h3>Livraison (estimations)</h3>
        <div class="form-grid">
          <div class="label">Mon pays</div>
          <select data-setting="shipping.buyerCountry">${countryOptions(sh.buyerCountry)}</select>
          <div class="label">Lettre, même pays</div>
          ${numberField('shipping.domestic', sh.domestic)}
          <div class="label">Lettre, autre pays</div>
          ${numberField('shipping.international', sh.international)}
          <div class="label">Envoi suivi dès</div>
          ${numberField('shipping.trackedThreshold', sh.trackedThreshold, { suffix: '€ de commande' })}
          <div class="label">Suivi, même pays</div>
          ${numberField('shipping.trackedDomestic', sh.trackedDomestic)}
          <div class="label">Suivi, autre pays</div>
          ${numberField('shipping.trackedInternational', sh.trackedInternational)}
          <div class="label">Recommandé / assuré dès</div>
          ${numberField('shipping.insuredThreshold', sh.insuredThreshold, { suffix: '€ de commande' })}
          <div class="label">Assuré, même pays</div>
          ${numberField('shipping.insuredDomestic', sh.insuredDomestic)}
          <div class="label">Assuré, autre pays</div>
          ${numberField('shipping.insuredInternational', sh.insuredInternational)}
          <div class="full help">Frais réels : ceux affichés au panier Cardmarket (ils dépendent du vendeur, du poids et de la valeur). Mets 0 dans « Envoi suivi dès » pour ignorer le seuil.</div>
          ${renderLearnedShipping()}
          <div class="label">Surcoût max pour regrouper</div>
          <span><input type="number" step="1" min="0" value="${s.maxPremiumPct ?? ''}" data-setting="maxPremiumPct" data-type="number"> % ou <input type="number" step="0.05" min="0" value="${
            s.maxPremiumAbs ?? ''
          }" data-setting="maxPremiumAbs" data-type="number"> € par carte</span>
          <div class="full help">Une carte n’est jamais prise plus chère que la moins chère (même état, même langue) + ce surcoût, même pour éviter un colis. Mets 0 et 0 pour toujours prendre la moins chère. Le montant en € sert pour les petites cartes (10 % de 0,10 € ne ferait qu’1 centime).</div>
          <div class="label">Pénalité par commande en plus</div>
          ${numberField('orderPenalty', s.orderPenalty)}
          <div class="full help">Préférence personnelle, non comptée dans les totaux : à 1 €, une commande de plus doit faire économiser plus d’1 € (au-delà du port) pour être retenue.</div>
        </div>
      </div>

      <div class="section">
        <h3>Analyse</h3>
        <div class="form-grid">
          <div class="label">Offres lues par carte</div>
          <select data-setting="pagesPerCard" data-type="number">${[1, 2, 3, 4, 6].map(
            (n) => html`<option value="${n}" ${attr(s.pagesPerCard === n, 'selected')}>${n * 50} offres les moins chères</option>`
          )}</select>
          <div class="full"><label class="check"><input type="checkbox" data-setting="deepCheck" data-type="bool" ${attr(
            s.deepCheck,
            'checked'
          )}> Vérification approfondie des meilleurs vendeurs</label>
            <p class="help">Cherche dans le stock des vendeurs les plus prometteurs les cartes de ta liste qu’ils n’affichaient pas parmi les offres les moins chères.</p></div>
          ${
            s.deepCheck
              ? html`<div class="label">Vendeurs vérifiés</div>${numberField('deepSellers', s.deepSellers, { step: '1', suffix: 'vendeurs' })}
                  <div class="label">Pages de stock max</div>${numberField('deepMaxRequests', s.deepMaxRequests, { step: '1', suffix: 'pages' })}`
              : ''
          }
          <div class="label">Délai entre deux pages</div>
          <span><input type="number" step="0.5" min="2" value="${s.delayMs / 1000}" data-setting="delayMs" data-type="seconds"> s</span>
          <div class="label">Pages max par analyse</div>
          ${numberField('maxRequests', s.maxRequests, { step: '10', suffix: 'pages' })}
          <div class="label">Garder les pages en cache</div>
          ${numberField('cacheMinutes', s.cacheMinutes, { step: '5', suffix: 'min' })}
          <div class="full help">Une seule page à la fois pour tout l’onglet (recherche, analyse, panier), avec un écart d’au moins ${
            s.delayMs / 1000
          } s, comme si tu naviguais toi-même. Si Cardmarket demande de ralentir, l’extension fait une pause et reste plus lente jusqu’au rechargement de la page. Les pages lues restent en cache : relancer ou changer un réglage ne les relit pas.</div>
        </div>
      </div>

      <div class="section row-actions">
        <button class="btn small" data-act="clear-cache">Vider le cache</button>
        <button class="btn small danger" data-act="reset-settings">Réglages par défaut</button>
      </div>`;
  }

  // ---------- Onglet « Résultats » ----------

  function renderProgress() {
    const p = state.progress || {};
    const phaseLabel =
      p.phase === 'deep' ? 'Vérification approfondie' : p.phase === 'done' ? 'Calcul des combinaisons' : 'Lecture des offres';
    const pct = p.total ? Math.min(100, Math.round((100 * (p.done || 0)) / p.total)) : 0;
    const elapsed = (Date.now() - (p.startedAt || Date.now())) / 1000;
    let remaining = '';
    if (p.phase === 'cards' && p.done > 0) {
      const perCard = elapsed / p.done;
      const left = Math.round((perCard * (p.total - p.done)) / 60);
      remaining = left < 1 ? ' · moins d’1 min restante' : ` · environ ${left} min restante${left > 1 ? 's' : ''}`;
    }
    return html`<div class="progress box">
      <b>${phaseLabel}</b>
      <p class="muted small truncate">${p.label || '…'}${p.page ? ` — page ${p.page}` : ''}</p>
      <div class="bar"><i data-width="${pct}"></i></div>
      <p class="small">${p.phase === 'deep' ? `${p.done || 0} / ${p.total || 0} recherches` : `${p.done || 0} / ${p.total || 0} cartes`} · ${plural(
      p.requests || 0,
      'page lue',
      'pages lues'
    )}${remaining}</p>
      ${
        p.wait
          ? html`<div class="banner warn"><p>Cardmarket demande de ralentir : reprise dans ${p.wait} s.</p></div>`
          : ''
      }
      <p class="help">Les pages sont lues une par une avec ta session Cardmarket. Si tu changes de page, l’analyse s’arrête ; les cartes déjà lues restent en cache.</p>
    </div>`;
  }

  function sellerInfo(name) {
    return (state.results && state.results.sellers[name]) || { name };
  }

  function countryTag(info) {
    if (!info.countryCode && !info.country) return '';
    const c = cm.findCountry(info.countryCode) || cm.findCountry(info.country);
    const isMine = info.countryCode === state.settings.shipping.buyerCountry;
    return html`<span class="tag ${isMine ? 'ok' : ''}" title="${c ? c.fr : info.country}">${info.countryCode || info.country}</span>`;
  }

  function typeLabel(type) {
    const t = cm.SELLER_TYPES.find((x) => x.key === type);
    return t ? t.fr : '';
  }

  function offerLabel(take) {
    if (!take || !take.length) return '';
    const o = take[0];
    const lang = cm.LANGUAGES.find((l) => l.id === o.l);
    const flags = [];
    if (o.f && o.f.reverseHolo) flags.push('reverse');
    if (o.f && o.f.foil) flags.push('foil');
    if (o.f && o.f.firstEd) flags.push('1re éd.');
    return [o.g, o.g ? '' : o.c, lang && lang.short, ...flags].filter(Boolean).join(' · ') + (take.length > 1 ? ` (+${take.length - 1} offre)` : '');
  }

  function renderCartState(planKey, order) {
    const k = cartKey(planKey, order.sellerId);
    const entry = state.cart[k];
    const game = cm.gameOfKey((state.cards[0] || {}).key);
    const cartLink = html`<a class="small" href="${safeHref(cm.cartUrl(game, locale()))}" target="_blank" rel="noopener">Voir mon panier ↗</a>`;
    const n = order.cards.length;
    const button = (label) =>
      html`<button class="btn small cart-btn" data-act="cart-add" data-plan="${planKey}" data-seller="${order.sellerId}" ${attr(
        state.cartBusy || state.running,
        'disabled'
      )}>${raw(ICON.cart)} ${label}</button>`;
    if (!entry) return html`<div class="cart-row">${button(`Ajouter ${n > 1 ? `ces ${n} cartes` : 'cette carte'} au panier`)}</div>`;
    if (entry.status === 'running') {
      return html`<div class="cart-row"><span class="spinner" aria-hidden="true"></span><span class="small muted">Ajout au panier… ${entry.done}/${entry.total}</span></div>`;
    }
    if (entry.status === 'login') {
      return html`<div class="cart-row warn"><span class="small">Connecte-toi à Cardmarket (en haut de la page), puis réessaie.</span>${button('Réessayer')}</div>`;
    }
    if (entry.status === 'error') {
      return html`<div class="cart-row bad"><span class="small">${entry.message}</span>${button('Réessayer')}<button class="btn link small" data-act="cart-diag" data-k="${k}">Copier le diagnostic</button></div>`;
    }
    const { ok, problems } = cartSummary(entry);
    const names = (list) => list.map((r) => ((state.results.cardInfo[r.cardId] || {}).name || r.articleId) + (r.message ? ` (${r.message})` : r.inCart === false ? ' (pas retrouvée dans le panier)' : '')).join(', ');
    if (!problems.length) {
      return html`<div class="cart-row ok"><span class="small"><b>✓ ${plural(ok.length, 'article ajouté', 'articles ajoutés')} au panier</b>${
        entry.cartChecked ? '' : ' (non vérifié)'
      }</span>${cartLink}</div>`;
    }
    return html`<div class="cart-row warn">
      <span class="small">${ok.length ? html`<b>${plural(ok.length, 'article ajouté', 'articles ajoutés')}.</b> ` : ''}Problème pour : ${names(problems)}.${
        problems.some((r) => r.status === 'gone') ? ' Relance la recherche pour trouver une autre offre pour cette carte.' : ''
      }</span>
      ${button('Réessayer')}
      <button class="btn link small" data-act="cart-diag" data-k="${k}">Copier le diagnostic</button>
      ${ok.length ? cartLink : ''}
    </div>`;
  }

  function renderOrders(plan, planKey) {
    const r = state.results;
    return html`<div class="orders">${plan.orders.map((o) => {
      const info = sellerInfo(o.sellerId);
      const game = cm.gameOfKey((state.cards[0] || {}).key);
      return html`<div class="order">
        <div class="order-head">
          <a class="seller" href="${sellerHref(game, o.sellerId)}" target="_blank" rel="noopener">${o.sellerId}</a>
          ${countryTag(info)}
          ${info.type && info.type !== 'private' ? html`<span class="tag">${typeLabel(info.type)}</span>` : ''}
          ${info.sales != null ? html`<span class="faint small">${plural(info.sales, 'vente', 'ventes')}</span>` : ''}
          <span class="grow"></span>
          <span class="num"><b>${eur(o.cardsCost)}</b> <span class="muted small">+ port ~${eur(o.shipCost)}</span></span>
        </div>
        <ul>${o.cards.map((c) => {
          const ci = r.cardInfo[c.cardId] || {};
          const take = (r.detail[c.cardId] || {})[o.sellerId];
          const stockUrl = safeHref(cm.sellerStockSearchUrl(cm.gameOfKey(ci.key), o.sellerId, cm.searchableName(ci.name), locale()));
          return html`<li>
            <span class="grow truncate"><a href="${productHref(ci.key)}" target="_blank" rel="noopener" title="${ci.name}">${ci.name}</a>${
            ci.qty > 1 ? html` <b>×${ci.qty}</b>` : ''
          } <span class="faint">${offerLabel(take)}</span></span>
            ${ci.kind === 'single' ? html`<a class="small nowrap" href="${stockUrl}" target="_blank" rel="noopener" title="Voir cette carte dans le stock de ${o.sellerId}">chez lui ↗</a>` : ''}
            ${
              ci.cheapest != null && c.price > ci.cheapest + 0.005
                ? html`<span class="tag warn" title="La moins chère (mêmes critères) est à ${eur(ci.cheapest)} ailleurs">+${eur(c.price - ci.cheapest)}</span>`
                : html`<span class="tag ok" title="Prix le plus bas pour ces critères">min</span>`
            }
            <span class="num">${eur(c.price)}</span>
          </li>`;
        })}</ul>
        ${planKey ? renderCartState(planKey, o) : ''}
      </div>`;
    })}</div>`;
  }

  function missingNames(ids) {
    const r = state.results;
    return ids.map((id) => (r.cardInfo[id] || {}).name || id);
  }

  function renderPlanCard(p) {
    const plan = p.plan;
    const open = !!state.view.expanded['plan:' + p.key];
    return html`<div class="plan ${p.best ? 'best' : ''}">
      <div class="plan-head">
        <div class="grow">
          <div class="plan-title">${p.title} ${p.tags.map((t) => html`<span class="tag ${t.cls}">${t.label}</span>`)}</div>
          <div class="plan-sub">${p.sub}</div>
        </div>
        <div class="plan-total">${eur(plan.total)}</div>
      </div>
      <div class="plan-figures">
        <span><b>${plural(plan.orders.length, 'commande', 'commandes')}</b></span>
        <span>cartes <b>${eur(plan.cardsCost)}</b></span>
        <span>port ~<b>${eur(plan.shipCost)}</b></span>
        ${plan.missing.length ? html`<span class="tag warn">${plural(plan.missing.length, 'carte manquante', 'cartes manquantes')}</span>` : ''}
      </div>
      <div class="plan-actions">
        <button class="btn small" data-act="toggle" data-key="plan:${p.key}" aria-expanded="${open}">${open ? 'Masquer le détail' : 'Voir le détail'}</button>
        <button class="btn small" data-act="copy-plan" data-plan="${p.key}">Copier</button>
        <button class="btn small" data-act="export-csv" data-plan="${p.key}">CSV</button>
      </div>
      ${open ? renderOrders(plan, p.key) : ''}
    </div>`;
  }

  function sameSellers(a, b) {
    return a.sellers.length === b.sellers.length && a.sellers.every((s) => b.sellers.includes(s));
  }

  function renderAnswer(analysed, unavailable) {
    const P = state.results.solved.plans;
    const best = P.cheapest;
    const n = best.orders.length;
    const allFound = !unavailable.length;
    const title =
      n === 1
        ? html`<b>${best.orders[0].sellerId}</b> a ${allFound ? 'toutes tes cartes' : `${best.covered} de tes ${analysed} cartes`}`
        : html`Commande chez <b>${n} vendeurs</b>${allFound ? ' pour tout avoir' : ''}`;
    const savings = P.baseline.total - best.total;
    return html`<div class="answer">
      <p class="answer-kicker">Le meilleur choix</p>
      <div class="answer-head">
        <div class="grow">
          <div class="answer-title">${title}</div>
          <div class="answer-sub">${plural(best.covered, 'carte', 'cartes')} : ${eur(best.cardsCost)} + port estimé ${eur(best.shipCost)}</div>
        </div>
        <div class="answer-total">${eur(best.total)}<span>port compris</span></div>
      </div>
      ${
        savings > 0.005
          ? html`<p class="answer-save">${eur(savings)} de moins qu’en achetant chaque carte au moins cher (${plural(
              P.baseline.orders.length,
              'commande',
              'commandes'
            )}, ${eur(P.baseline.total)}).</p>`
          : ''
      }
      ${renderActiveFilters()}
      ${
        unavailable.length
          ? html`<div class="banner warn"><p>Introuvable avec tes filtres (langue, état…) : ${missingNames(unavailable).join(', ')}.</p></div>`
          : ''
      }
      <div class="answer-actions">
        ${renderCartAllButton(best)}
        <button class="btn small" data-act="copy-plan" data-plan="cheapest">Copier la liste</button>
        <button class="btn small" data-act="export-csv" data-plan="cheapest">Exporter (CSV)</button>
        <a class="small" href="${safeHref(cm.cartUrl(cm.gameOfKey((state.cards[0] || {}).key), locale()))}" target="_blank" rel="noopener">Voir mon panier ↗</a>
      </div>
      ${renderCartSeen()}
      ${renderOrders(best, 'cheapest')}
      <p class="help">Il faut être connecté à Cardmarket. Rien n’est acheté : les cartes vont dans ton panier, tu vérifies et tu paies toi-même.</p>
    </div>`;
  }

  /** Filtres qui fixent les prix, affichés en clair avec les réglages les plus utiles à portée de clic. */
  /** Les réglages qui font le prix, modifiables en un clic : état minimum, langues, surcoût. */
  function renderActiveFilters() {
    const s = state.settings;
    const strict = !s.maxPremiumPct && !s.maxPremiumAbs;
    const QUICK_LANGS = [2, 7, 1];
    return html`<div class="answer-filters quick-filters small">
      <div class="qf-row"><span class="qf-label">État</span>
        <div class="segmented" role="group" aria-label="État minimum">${['NM', 'EX', 'GD'].map(
          (code) =>
            html`<button data-act="quick-condition" data-code="${code}" aria-pressed="${s.minCondition === code}" title="${
              (cm.CONDITIONS.find((c) => c.code === code) || {}).fr
            } ou mieux">${code}${code === 'NM' ? '' : ' ou mieux'}</button>`
        )}</div>
      </div>
      <div class="qf-row"><span class="qf-label">Langues</span>
        <div class="chips">${QUICK_LANGS.map((id) => {
          const l = cm.LANGUAGES.find((x) => x.id === id);
          return html`<button class="chip" data-act="toggle-lang" data-id="${id}" aria-pressed="${s.languages.includes(id)}" title="${l.fr}">${l.fr}</button>`;
        })}<button class="chip" data-act="all-languages" aria-pressed="${!s.languages.length}">Toutes</button></div>
      </div>
      <div class="qf-row"><span class="qf-label">Prix</span>
        <div class="segmented" role="group" aria-label="Surcoût pour regrouper">
          <button data-act="premium-strict" aria-pressed="${strict}" title="Chaque carte au prix le plus bas">Toujours le moins cher</button>
          <button data-act="premium-default" aria-pressed="${!strict}" title="Jusqu’à +${s.maxPremiumPct || 10} % (ou +${eur(
      s.maxPremiumAbs || 0.3
    )}) pour éviter un colis">Regrouper (+${s.maxPremiumPct || 10} % max)</button>
        </div>
      </div>
    </div>`;
  }

  function renderCartAllButton(plan) {
    const done = plan.orders.filter((o) => orderInCart('cheapest', o)).length;
    if (done === plan.orders.length) return html`<span class="tag ok cart-all-done">✓ Tout est dans ton panier</span>`;
    const label = done ? `Ajouter le reste au panier (${plan.orders.length - done} vendeur${plan.orders.length - done > 1 ? 's' : ''})` : 'Tout ajouter au panier';
    return html`<button class="btn primary cart-btn" data-act="cart-add" data-plan="cheapest" ${attr(state.cartBusy || state.running, 'disabled')}>${raw(
      ICON.cart
    )} ${label}</button>`;
  }

  function renderAlternatives() {
    const P = state.results.solved.plans;
    const cards = [];
    if (!sameSellers(P.cheapest, P.fewest)) {
      const extra = P.fewest.total - P.cheapest.total;
      cards.push({
        key: 'fewest',
        title: `Encore moins de colis : ${plural(P.fewest.orders.length, 'vendeur', 'vendeurs')}`,
        sub:
          extra > 0.005
            ? `${eur(extra)} de plus que le meilleur choix, mais ${plural(P.cheapest.orders.length - P.fewest.orders.length, 'commande', 'commandes')} en moins.`
            : 'Même prix, moins de colis.',
        plan: P.fewest,
        best: false,
        tags: [],
      });
    }
    cards.push({
      key: 'baseline',
      title: 'Pour comparer : chaque carte au moins cher',
      sub: 'Ce que tu paierais en prenant la moins chère de chaque carte, sans regarder le port.',
      plan: P.baseline,
      best: false,
      tags: [],
    });
    return html`<div class="section"><h3>Autres options</h3><div class="plans">${cards.map(renderPlanCard)}</div></div>`;
  }

  function renderCombos() {
    const r = state.results;
    const size = state.view.comboSize;
    const list = (r.solved.combos[size] || []).slice(0, state.wide ? 20 : 10);
    const total = r.solved.coverableCount;
    const rows = list.map((c, i) => {
      const key = `combo:${size}:${c.sellers.join('+')}`;
      const open = !!state.view.expanded[key];
      return html`<tr class="clickable ${open ? 'expanded' : ''}" data-act="toggle" data-key="${key}">
        <td class="num faint">${i + 1}</td>
        <td>${c.sellers.map((s) => html`<div class="nowrap"><b>${s}</b> ${countryTag(sellerInfo(s))}</div>`)}</td>
        <td class="num">${c.covered}/${total}</td>
        <td class="num hide-narrow">${c.missing.length || '—'}</td>
        <td class="num hide-narrow">${eur(c.cardsCost)}</td>
        <td class="num">${eur(c.shipCost)}</td>
        <td class="num"><b>${eur(c.total)}</b></td>
      </tr>
      ${
        open
          ? html`<tr class="detail"><td></td><td colspan="6">${renderOrders(c, `combo:${size}:${i}`)}${
              c.missing.length ? html`<p class="small muted">Manquantes : ${missingNames(c.missing).join(', ')}</p>` : ''
            }</td></tr>`
          : ''
      }`;
    });
    return html`<div class="section">
      <div class="section-head"><h3>Combinaisons de vendeurs</h3>
        <div class="segmented" role="group" aria-label="Nombre de vendeurs">${[1, 2, 3].map(
          (n) => html`<button data-act="combo-size" data-n="${n}" aria-pressed="${size === n}">${n} vendeur${n > 1 ? 's' : ''}</button>`
        )}</div>
      </div>
      ${
        list.length
          ? html`<div class="table-wrap"><table>
              <thead><tr><th>#</th><th>Vendeurs</th><th class="num">Cartes</th><th class="num hide-narrow">Manq.</th><th class="num hide-narrow">Cartes €</th><th class="num">Port</th><th class="num">Total</th></tr></thead>
              <tbody>${rows}</tbody></table></div>
              <p class="help">Classées par nombre de cartes couvertes, puis par total. Le total ne compte que les cartes couvertes.</p>`
          : html`<p class="muted small">Aucune combinaison de ${size} vendeurs utile.</p>`
      }
    </div>`;
  }

  function sortedSellers() {
    const r = state.results;
    const v = state.view;
    const q = cm.norm(v.q);
    let list = r.solved.sellers.filter((s) => {
      const info = sellerInfo(s.sellerId);
      if (s.covered < v.minCards) return false;
      if (v.country && info.countryCode !== v.country) return false;
      if (v.type && info.type !== v.type) return false;
      if (q && !cm.norm(s.sellerId).includes(q)) return false;
      return true;
    });
    const total = r.solved.coverableCount;
    const val = {
      covered: (s) => s.covered,
      missing: (s) => total - s.covered,
      cost: (s) => s.cardsCost,
      score: (s) => s.score,
      sales: (s) => sellerInfo(s.sellerId).sales || 0,
      name: (s) => s.sellerId.toLowerCase(),
    }[v.sort];
    list = list.slice().sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x < y) return -v.dir;
      if (x > y) return v.dir;
      return b.covered - a.covered || a.cardsCost - b.cardsCost;
    });
    return list;
  }

  function sortHeader(col, label, cls = '') {
    const v = state.view;
    const dir = v.sort === col ? (v.dir > 0 ? '▲' : '▼') : null;
    return html`<th class="${cls}"><button data-act="sort" data-col="${col}" ${dir ? raw(`data-dir="${dir}"`) : ''}>${label}</button></th>`;
  }

  function renderSellers() {
    const r = state.results;
    const v = state.view;
    const all = sortedSellers();
    const list = all.slice(0, v.limit);
    const total = r.solved.coverableCount;
    const countries = [...new Set(r.solved.sellers.map((s) => sellerInfo(s.sellerId).countryCode).filter(Boolean))].sort();
    const game = cm.gameOfKey((state.cards[0] || {}).key);
    const rows = list.map((s) => {
      const info = sellerInfo(s.sellerId);
      const key = 'seller:' + s.sellerId;
      const open = !!v.expanded[key];
      const pct = total ? Math.round((100 * s.covered) / total) : 0;
      let detail = '';
      if (open) {
        const have = new Set(s.cards.map((c) => c.cardId));
        const missing = state.cards.filter((c) => r.cardInfo[c.id] && r.cardInfo[c.id].sellers && !have.has(c.id));
        detail = html`<tr class="detail"><td colspan="8">
          <div class="orders"><div class="order"><ul>${s.cards.map((c) => {
            const ci = r.cardInfo[c.cardId];
            const cheapest = ci.cheapest != null && c.price <= ci.cheapest + 0.005;
            return html`<li><span class="grow truncate"><a href="${productHref(ci.key)}" target="_blank" rel="noopener">${ci.name}</a> <span class="faint">${offerLabel(
              (r.detail[c.cardId] || {})[s.sellerId]
            )}</span></span>${cheapest ? html`<span class="tag ok">le moins cher</span>` : html`<span class="faint small">+${eur(c.price - ci.cheapest)}</span>`}<span class="num">${eur(
              c.price
            )}</span></li>`;
          })}</ul></div></div>
          ${missing.length ? html`<p class="small muted">Il lui manque : ${missing.map((c) => r.cardInfo[c.id].name).join(', ')}</p>` : ''}
          <div class="plan-actions"><a class="btn small" href="${sellerHref(game, s.sellerId)}" target="_blank" rel="noopener">Voir sa boutique ↗</a>
          <button class="btn small danger" data-act="exclude" data-name="${s.sellerId}">Exclure ce vendeur</button></div>
        </td></tr>`;
      }
      return html`<tr class="clickable ${open ? 'expanded' : ''}" data-act="toggle" data-key="${key}">
        <td><b>${s.sellerId}</b></td>
        <td>${countryTag(info)}</td>
        <td class="small hide-narrow">${typeLabel(info.type)}</td>
        <td class="num hide-narrow">${info.sales != null ? intFmt.format(info.sales) : '—'}</td>
        <td><span class="coverage"><span class="meter"><i data-width="${pct}"></i></span><b>${s.covered}/${total}</b></span></td>
        <td class="num hide-narrow">${total - s.covered}</td>
        <td class="num">${eur(s.cardsCost)}</td>
        <td class="num" title="70 % couverture de ta liste, 30 % prix (100 = le moins cher partout)">${s.score}</td>
      </tr>${detail}`;
    });
    return html`<div class="section">
      <div class="section-head"><h3>Vendeurs (${all.length})</h3></div>
      <div class="filters">
        <input type="text" class="compact" placeholder="Nom du vendeur" value="${v.q}" data-view="q" aria-label="Filtrer par nom">
        <label>Pays <select class="compact" data-view="country"><option value="">Tous</option>${countries.map(
          (c) => html`<option value="${c}" ${attr(v.country === c, 'selected')}>${(cm.findCountry(c) || {}).fr || c}</option>`
        )}</select></label>
        <label>Type <select class="compact" data-view="type"><option value="">Tous</option>${cm.SELLER_TYPES.map(
          (t) => html`<option value="${t.key}" ${attr(v.type === t.key, 'selected')}>${t.fr}</option>`
        )}</select></label>
        <label>Au moins <input class="compact" type="number" min="1" value="${v.minCards}" data-view="minCards"> carte(s)</label>
      </div>
      ${
        list.length
          ? html`<div class="table-wrap"><table>
          <thead><tr>${sortHeader('name', 'Vendeur')}<th>Pays</th><th class="hide-narrow">Type</th>${sortHeader('sales', 'Ventes', 'num hide-narrow')}${sortHeader(
              'covered',
              'Cartes'
            )}${sortHeader('missing', 'Manq.', 'num hide-narrow')}${sortHeader('cost', 'Prix cartes', 'num')}${sortHeader('score', 'Score', 'num')}</tr></thead>
          <tbody>${rows}</tbody></table></div>
          ${all.length > list.length ? html`<p><button class="btn small" data-act="more-sellers">Afficher plus (${all.length - list.length})</button></p>` : ''}`
          : html`<p class="muted small">Aucun vendeur ne correspond à ces filtres.</p>`
      }
    </div>`;
  }

  function renderCardsTable() {
    const r = state.results;
    const rows = state.cards.map((c) => {
      const i = r.cardInfo[c.id];
      if (!i) return '';
      const rejected = Object.entries(i.rejected || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${REJECT_LABELS[k] || k} ${n}`)
        .join(', ');
      let status;
      if (!i.analysed && !i.error) status = html`<span class="tag">non analysée</span>`;
      else if (i.error) status = html`<span class="tag bad" title="${i.error}">erreur</span>`;
      else if (!i.sellers) status = html`<span class="tag warn">introuvable</span>`;
      else status = html`<span class="tag ok">${plural(i.sellers, 'vendeur', 'vendeurs')}</span>`;
      return html`<tr>
        <td><a href="${productHref(i.key)}" target="_blank" rel="noopener">${i.name}</a>${i.qty > 1 ? html` <b>×${i.qty}</b>` : ''}<div class="faint small">${i.expansion}</div></td>
        <td>${status}</td>
        <td class="num">${i.offersAccepted}/${i.offersTotal}${i.complete ? '' : '+'}</td>
        <td class="num">${eur(i.cheapest)}</td>
        <td class="num">${eur(i.trend)}</td>
        <td class="small muted">${i.error || (rejected ? 'Écartées : ' + rejected : '')}</td>
      </tr>`;
    });
    return html`<details class="section disclosure" ${attr(!!state.view.expanded.cards, 'open')} data-details="cards">
      <summary>Détail par carte</summary>
      <div class="table-wrap spaced"><table>
        <thead><tr><th>Carte</th><th>Statut</th><th class="num">Offres retenues</th><th class="num">Dès</th><th class="num">Tendance</th><th>Remarques</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="help">« Offres retenues » : offres qui passent tes filtres, sur celles lues (+ = il en existe d’autres, plus chères).</p>
    </details>`;
  }

  function renderResults() {
    if (state.running) return renderProgress();
    const r = state.results;
    const notices = [];
    if (state.interrupted) {
      notices.push(html`<div class="banner warn"><p>L’analyse précédente a été interrompue (changement de page). Relance-la : les cartes déjà lues viennent du cache.</p></div>`);
    }
    if (!r) {
      return html`${notices}<div class="empty"><strong>Pas encore de résultats</strong>Ajoute tes cartes dans « 1 · Mes cartes », puis clique « Trouver les vendeurs ».<p><button class="btn small" data-act="tab" data-tab="list">Aller à mes cartes</button></p></div>`;
    }
    const S = r.solved;
    if (r.stopReason && r.stopReason.code !== 'ABORTED') notices.push(html`<div class="banner bad"><p>${r.stopReason.message}</p></div>`);
    else if (r.stopReason) notices.push(html`<div class="banner warn"><p>Analyse arrêtée avant la fin : résultats partiels.</p></div>`);
    if (r.deep && r.deep.disabled) notices.push(html`<div class="banner warn"><p>${r.deep.disabled}</p></div>`);
    const notAnalysed = state.cards.filter((c) => !r.cardInfo[c.id] || (!r.cardInfo[c.id].analysed && !r.cardInfo[c.id].error));
    if (notAnalysed.length) {
      notices.push(
        html`<div class="banner warn"><p>${plural(notAnalysed.length, 'carte ajoutée ou modifiée depuis l’analyse', 'cartes ajoutées ou modifiées depuis l’analyse')} : relance pour les inclure.</p></div>`
      );
    }
    const stale = state.cards.filter((c) => r.cardInfo[c.id] && r.cardInfo[c.id].stale);
    if (stale.length) {
      notices.push(
        html`<div class="banner warn"><p>Filtres modifiés depuis l’analyse (langue, état, pays, type de vendeur…) pour ${plural(
          stale.length,
          'carte',
          'cartes'
        )} : les résultats n’utilisent que les offres déjà lues.</p><button class="btn small primary" data-act="analyse">Relancer la recherche</button></div>`
      );
    }
    const analysed = state.cards.length - notAnalysed.length;
    const unavailable = S.unavailable.filter((id) => r.cardInfo[id] && (r.cardInfo[id].analysed || r.cardInfo[id].error));
    const when = new Date(r.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const deepInfo = r.deep && !r.deep.disabled && r.deep.checked ? ` · vérification approfondie : ${plural(r.deep.found, 'offre trouvée', 'offres trouvées')}` : '';

    if (!S.plans) {
      return html`${notices}<div class="empty"><strong>Aucune carte trouvée avec ces filtres</strong>Élargis la langue, l’état ou les pays dans les réglages.</div>${renderCardsTable()}`;
    }
    return html`${notices}
      ${renderAnswer(analysed, unavailable)}
      ${renderAlternatives()}
      ${renderCombos()}
      ${renderSellers()}
      ${renderCardsTable()}
      <p class="help">Analyse du ${when} · ${plural(S.sellerCount, 'vendeur', 'vendeurs')} · ${plural(r.requests, 'page lue', 'pages lues')}${deepInfo}. Prix et stocks évoluent : vérifie au panier.</p>`;
  }

  // ---------- Copie texte d'un plan ----------

  function planText(key) {
    const r = state.results;
    const plan = r.solved.plans[key];
    const titles = { cheapest: 'Le moins cher, port compris', fewest: 'Le moins de commandes', baseline: 'Chaque carte au prix le plus bas' };
    const lines = [
      `${titles[key]} — ${plural(plan.orders.length, 'commande', 'commandes')} — ${eur(plan.total)} (cartes ${eur(plan.cardsCost)} + port ~${eur(plan.shipCost)})`,
    ];
    plan.orders.forEach((o, i) => {
      const info = sellerInfo(o.sellerId);
      lines.push('');
      lines.push(`${i + 1}. ${o.sellerId}${info.countryCode ? ' (' + info.countryCode + ')' : ''} — ${plural(o.cards.length, 'carte', 'cartes')} — ${eur(o.cardsCost)} + port ~${eur(o.shipCost)}`);
      for (const c of o.cards) {
        const ci = r.cardInfo[c.cardId];
        lines.push(`   - ${ci.name}${ci.qty > 1 ? ' ×' + ci.qty : ''} — ${offerLabel((r.detail[c.cardId] || {})[o.sellerId])} — ${eur(c.price)}`);
      }
    });
    if (plan.missing.length) lines.push('', 'Manquantes : ' + missingNames(plan.missing).join(', '));
    return lines.join('\n');
  }

  const csvNum = (x) => (x == null || !Number.isFinite(x) ? '' : x.toFixed(2).replace('.', ','));
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // pas de formule exécutée à l'ouverture dans un tableur
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** Plan d'achat au format tableur (séparateur « ; », accents conservés pour Excel). */
  function planCsv(key) {
    const r = state.results;
    const plan = r.solved.plans[key];
    const rows = [['Vendeur', 'Pays', 'Carte', 'Extension', 'Numéro', 'Quantité', 'État / gradation', 'Langue', 'Prix', 'Moins chère', 'Lien']];
    for (const o of plan.orders) {
      const info = sellerInfo(o.sellerId);
      for (const c of o.cards) {
        const ci = r.cardInfo[c.cardId] || {};
        const t = ((r.detail[c.cardId] || {})[o.sellerId] || [])[0] || {};
        const lang = cm.LANGUAGES.find((l) => l.id === t.l);
        rows.push([o.sellerId, info.countryCode || '', ci.name, ci.expansion, ci.number, ci.qty, t.g || t.c || '', lang ? lang.fr : '', csvNum(c.price), csvNum(ci.cheapest), cm.keyToUrl(ci.key, locale())]);
      }
      rows.push([o.sellerId, info.countryCode || '', 'Frais de port (estimation)', '', '', '', '', '', csvNum(o.shipCost), '', '']);
    }
    rows.push(['TOTAL', '', '', '', '', '', '', '', csvNum(plan.total), '', '']);
    return '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  }

  function downloadCsv(key) {
    if (!state.results || !state.results.solved.plans || !state.results.solved.plans[key]) return;
    const url = URL.createObjectURL(new Blob([planCsv(key)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `regroupeur-${new Date().toISOString().slice(0, 10)}.csv`;
    shadow.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Plan exporté (CSV)');
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      shadow.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(message);
  }

  function copyPlan(key) {
    return copyText(planText(key), 'Liste copiée');
  }

  // ---------- Rendu global ----------

  function focusKey(el) {
    if (!el || !el.getAttribute) return null;
    for (const a of ['data-setting', 'data-view', 'data-model', 'data-pending', 'data-exp-pick']) if (el.hasAttribute(a)) return `[${a}="${el.getAttribute(a)}"]`;
    if (el.hasAttribute('data-card')) return `[data-card="${el.getAttribute('data-card')}"][data-field="${el.getAttribute('data-field')}"]`;
    return null;
  }

  function render() {
    if (!mountEl) return;
    const body = shadow.querySelector('.body');
    const scroll = body ? body.scrollTop : 0;
    const active = shadow.activeElement;
    const fk = focusKey(active);
    let sel = null;
    try {
      sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    } catch (e) {
      sel = null;
    }
    mountEl.innerHTML = show(renderLauncher()) + show(renderPanel());
    // Largeurs posées via le CSSOM (compatible avec une CSP stricte).
    for (const el of shadow.querySelectorAll('[data-width]')) el.style.width = el.getAttribute('data-width') + '%';
    const newBody = shadow.querySelector('.body');
    if (newBody) newBody.scrollTop = scroll;
    if (state.scrollTo) {
      const target = shadow.querySelector(state.scrollTo);
      if (target && newBody) newBody.scrollTop += target.getBoundingClientRect().top - newBody.getBoundingClientRect().top - 8;
      state.scrollTo = null;
    }
    if (fk) {
      const el = shadow.querySelector(fk);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel) {
          try {
            el.setSelectionRange(sel[0], sel[1]);
          } catch (e) {
            /* champ sans sélection (number, select) */
          }
        }
      }
    }
  }

  // ---------- Événements ----------

  function setOpen(open) {
    state.open = open;
    if (open) state.context = detectContext();
    saveUi();
    render();
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  function onSettingChange(el) {
    const path = el.getAttribute('data-setting');
    const type = el.getAttribute('data-type');
    let value;
    if (type === 'bool') value = el.checked;
    else if (type === 'number') value = el.value === '' ? null : Math.max(0, parseFloat(el.value));
    else if (type === 'seconds') value = Math.round(Math.max(2, parseFloat(el.value) || 3) * 1000);
    else if (type === 'nullable') value = el.value || null;
    else value = el.value;
    if (value !== null && typeof value === 'number' && !Number.isFinite(value)) value = null;
    if (['deepSellers', 'deepMaxRequests', 'pagesPerCard', 'minSales', 'cacheMinutes', 'maxRequests'].includes(path)) value = Math.round(value || 0);
    if (path.startsWith('shipping.') && value === null) value = 0;
    setPath(state.settings, path, value);
    saveSettings();
    recompute();
    render();
  }

  function onCardChange(el) {
    const card = state.cards.find((c) => c.id === el.getAttribute('data-card'));
    if (!card) return;
    const field = el.getAttribute('data-field');
    const v = el.value;
    if (field === 'qty') card.qty = Math.min(99, Math.max(1, parseInt(v, 10) || 1));
    else if (field === 'maxPrice') card.maxPrice = v === '' ? null : Math.max(0, parseFloat(v)) || null;
    else if (field === 'languages') card.languages = v === '' ? null : v === 'all' ? [] : [parseInt(v, 10)];
    else if (field === 'minGrade') card.minGrade = v === '' ? null : parseFloat(v);
    else if (field === 'graded') {
      card.graded = v || null;
      if (card.graded !== 'only') {
        card.gradeCompany = null;
        card.minGrade = null;
      }
    }
    else card[field] = v || null;
    saveList();
    recompute();
    render();
  }

  function toggleIn(arr, value) {
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(value);
  }

  function onClick(e) {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    // Un lien ou un bouton dans une ligne dépliable garde son propre comportement.
    const inner = e.target.closest('a, button, input, select');
    if (target.tagName === 'TR' && inner && inner !== target) return;
    const act = target.getAttribute('data-act');
    const id = target.getAttribute('data-id');
    switch (act) {
      case 'open':
        setOpen(true);
        break;
      case 'open-list':
        state.tab = 'list';
        setOpen(true);
        break;
      case 'close':
        setOpen(false);
        break;
      case 'wide':
        state.wide = !state.wide;
        saveUi();
        render();
        break;
      case 'tab':
        state.tab = target.getAttribute('data-tab');
        saveUi();
        render();
        break;
      case 'add-current':
        addCurrent();
        break;
      case 'settings':
        state.tab = state.tab === 'settings' ? 'list' : 'settings';
        saveUi();
        render();
        break;
      case 'back':
        state.tab = 'list';
        saveUi();
        render();
        break;
      case 'search':
        runSearch();
        break;
      case 'add-result':
        addSearchResult(parseInt(target.getAttribute('data-i'), 10), target.getAttribute('data-mode'));
        break;
      case 'search-kind':
        // Pas de recherche relancée d'office : une page lue seulement quand on clique « Chercher ».
        state.searchKind = target.getAttribute('data-kind');
        Object.assign(state.search, { status: 'idle', results: [] });
        render();
        break;
      case 'qty': {
        const card = state.cards.find((c) => c.id === id);
        if (card) {
          card.qty = Math.min(99, Math.max(1, (card.qty || 1) + parseInt(target.getAttribute('data-d'), 10)));
          saveList();
          recompute();
          render();
        }
        break;
      }
      case 'bulk-add':
        addBulkMatches();
        break;
      case 'bulk-cancel':
        state.bulk = null;
        render();
        break;
      case 'bulk-retry': {
        const g = bulkGroup(target.getAttribute('data-g'));
        if (g && g.expansion) loadGroupExpansion(g, g.expansion);
        else if (g) detectGroup(g, new Fetcher({ delayMs: state.settings.delayMs }));
        break;
      }
      case 'bulk-change': {
        const g = bulkGroup(target.getAttribute('data-g'));
        if (g) {
          g.changing = true;
          g.note = 'Choisis l’extension :';
          render();
        }
        break;
      }
      case 'bulk-exp': {
        const g = bulkGroup(target.getAttribute('data-g'));
        if (g) loadGroupExpansion(g, { slug: target.getAttribute('data-slug'), name: target.getAttribute('data-name') });
        break;
      }
      case 'exp-pick':
        pickExpansion(bulkGroup(target.getAttribute('data-g')));
        break;
      case 'exp-options':
        loadExpansionOptions(bulkGroup(target.getAttribute('data-g')));
        break;
      case 'bulk-byname':
        searchLeftoversByName(bulkGroup(target.getAttribute('data-g')));
        break;
      case 'pending-go':
        state.pendingApproved = true;
        processPending();
        break;
      case 'pending-clear':
        state.pending = state.pending.filter((p) => p.status === 'searching');
        state.pendingNeedsOk = false;
        render();
        break;
      case 'apply-update':
        applyUpdate();
        break;
      case 'self-test':
        runSelfTest();
        break;
      case 'self-test-copy':
        copyText(selfTestReport(), 'Rapport copié : colle-le dans la conversation');
        break;
      case 'forget-shipping':
        state.settings.learnedShipping = {};
        saveSettings();
        recompute();
        render();
        break;
      case 'list-rename':
        renameList();
        break;
      case 'list-delete':
        deleteList();
        break;
      case 'premium-strict':
        state.settings.maxPremiumPct = 0;
        state.settings.maxPremiumAbs = 0;
        saveSettings();
        recompute();
        render();
        break;
      case 'premium-default':
        state.settings.maxPremiumPct = store.DEFAULT_SETTINGS.maxPremiumPct;
        state.settings.maxPremiumAbs = store.DEFAULT_SETTINGS.maxPremiumAbs;
        saveSettings();
        recompute();
        render();
        break;
      case 'all-languages':
        state.settings.languages = [];
        saveSettings();
        recompute();
        render();
        break;
      case 'quick-condition':
        state.settings.minCondition = target.getAttribute('data-code');
        saveSettings();
        recompute();
        render();
        break;
      case 'cart-add':
        addPlanToCart(target.getAttribute('data-plan'), target.getAttribute('data-seller'));
        break;
      case 'cart-diag':
        copyCartDiagnostic(target.getAttribute('data-k'));
        break;
      case 'import-wants':
        importWants();
        break;
      case 'remove': {
        const idx = state.cards.findIndex((c) => c.id === id);
        if (idx < 0) break;
        const [card] = state.cards.splice(idx, 1);
        state.undo = [{ card, idx }];
        saveList();
        recompute();
        toast(`${card.name} retirée`, { label: 'Annuler', act: 'undo' });
        break;
      }
      case 'clear-list':
        state.undo = state.cards.map((card, idx) => ({ card, idx }));
        state.cards = [];
        saveList();
        recompute();
        toast('Liste vidée', { label: 'Annuler', act: 'undo' });
        break;
      case 'undo':
        if (state.undo) {
          for (const { card, idx } of state.undo) if (!state.cards.some((c) => c.key === card.key)) state.cards.splice(Math.min(idx, state.cards.length), 0, card);
          state.undo = null;
          saveList();
          recompute();
          toast('C’est rétabli');
        }
        break;
      case 'open-results':
        state.tab = 'results';
        setOpen(true);
        break;
      case 'export-csv':
        downloadCsv(target.getAttribute('data-plan'));
        break;
      case 'add-text':
        addFromText();
        break;
      case 'pick': {
        const p = state.pending.find((x) => x.id === id);
        const select = shadow.querySelector(`[data-pending="${id}"]`);
        if (p && select) {
          addCard(cardFromCandidate(p.candidates[parseInt(select.value, 10)], p.want));
          state.pending = state.pending.filter((x) => x.id !== id);
          render();
        }
        break;
      }
      case 'retry': {
        const p = state.pending.find((x) => x.id === id);
        if (p) p.status = 'queued';
        processPending();
        break;
      }
      case 'drop-pending':
        state.pending = state.pending.filter((x) => x.id !== id);
        render();
        break;
      case 'analyse':
        startAnalysis();
        break;
      case 'stop':
        stopAnalysis();
        break;
      case 'toggle': {
        const key = target.getAttribute('data-key');
        state.view.expanded[key] = !state.view.expanded[key];
        render();
        break;
      }
      case 'combo-size':
        state.view.comboSize = parseInt(target.getAttribute('data-n'), 10);
        render();
        break;
      case 'sort': {
        const col = target.getAttribute('data-col');
        if (state.view.sort === col) state.view.dir = -state.view.dir;
        else {
          state.view.sort = col;
          state.view.dir = col === 'name' || col === 'missing' || col === 'cost' ? 1 : -1;
        }
        render();
        break;
      }
      case 'more-sellers':
        state.view.limit += 40;
        render();
        break;
      case 'exclude': {
        const name = target.getAttribute('data-name');
        if (!state.settings.excludedSellers.includes(name)) state.settings.excludedSellers.push(name);
        saveSettings();
        recompute();
        toast(`${name} exclu (réversible dans Réglages)`);
        break;
      }
      case 'unexclude': {
        const name = target.getAttribute('data-name');
        state.settings.excludedSellers = state.settings.excludedSellers.filter((n) => n !== name);
        saveSettings();
        recompute();
        render();
        break;
      }
      case 'copy-plan':
        copyPlan(target.getAttribute('data-plan'));
        break;
      case 'toggle-lang':
        toggleIn(state.settings.languages, parseInt(id, 10));
        saveSettings();
        recompute();
        render();
        break;
      case 'toggle-type': {
        const key = target.getAttribute('data-key');
        toggleIn(state.settings.sellerTypes, key);
        if (!state.settings.sellerTypes.length) state.settings.sellerTypes.push(key);
        saveSettings();
        recompute();
        render();
        break;
      }
      case 'toggle-country':
        toggleIn(state.settings.countries, target.getAttribute('data-code'));
        saveSettings();
        recompute();
        render();
        break;
      case 'clear-cache':
        store.pruneCache(0, true).then((n) => toast(`Cache vidé (${n} page${n > 1 ? 's' : ''})`));
        break;
      case 'reset-settings':
        if (confirm('Revenir aux réglages par défaut ?')) {
          state.settings = store.mergeSettings(null);
          saveSettings();
          recompute();
          render();
        }
        break;
      default:
        break;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.hasAttribute('data-setting')) onSettingChange(el);
    else if (el.hasAttribute('data-card')) onCardChange(el);
    else if (el.hasAttribute('data-view')) {
      const k = el.getAttribute('data-view');
      state.view[k] = k === 'minCards' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value;
      state.view.limit = 40;
      render();
    } else if (el.getAttribute('data-model') === 'addGame') state.addGame = el.value;
    else if (el.getAttribute('data-model') === 'listId') {
      if (el.value === '__new') newList();
      else switchList(el.value);
    } else if (el.hasAttribute('data-bulk-alt') && state.bulk) {
      const [gi, mi] = el.getAttribute('data-bulk-alt').split(':');
      const g = bulkGroup(gi);
      const m = g && g.matched[parseInt(mi, 10)];
      if (m) {
        const options = [m.product].concat(m.alternatives);
        const chosen = options[parseInt(el.value, 10)];
        m.alternatives = options.filter((p) => p !== chosen);
        m.product = chosen;
        render();
      }
    } else if (el.getAttribute('data-model') === 'searchKind' && el.value) {
      state.searchKind = el.value;
      Object.assign(state.search, { status: 'idle', results: [] });
      render();
    }
  }

  let viewTimer;
  function onInput(e) {
    const el = e.target;
    if (el.getAttribute('data-model') === 'addText') state.addText = el.value;
    else if (el.getAttribute('data-model') === 'searchQ') state.search.q = el.value;
    else if (el.hasAttribute('data-exp-pick')) {
      const g = bulkGroup(el.getAttribute('data-exp-pick'));
      if (g) g.pickText = el.value;
    }
    else if (el.getAttribute('data-view') === 'q') {
      state.view.q = el.value;
      clearTimeout(viewTimer);
      viewTimer = setTimeout(render, 200);
    }
  }

  function onToggleDetails(e) {
    const d = e.target;
    if (d && d.getAttribute && d.getAttribute('data-details')) state.view.expanded[d.getAttribute('data-details')] = d.open;
  }

  // ---------- Démarrage ----------

  async function loadCss() {
    const url = chrome.runtime.getURL('src/panel.css');
    const css = await (await fetch(url)).text();
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);
    }
  }

  async function mount() {
    if (document.getElementById('cmr-host')) return;
    host = document.createElement('div');
    host.id = 'cmr-host';
    shadow = host.attachShadow({ mode: 'open' });
    mountEl = document.createElement('div');
    shadow.appendChild(mountEl);
    document.documentElement.appendChild(host);
    await loadCss();

    const saved = await store.loadAll();
    state.lists = saved.lists;
    state.listId = saved.lists.active;
    state.cards = saved.list;
    state.settings = saved.settings;
    state.dataset = saved.dataset;
    state.open = !!saved.ui.open;
    state.wide = !!saved.ui.wide;
    state.tab = saved.ui.tab || 'list';
    state.interrupted = !!saved.ui.interrupted;
    state.context = detectContext();
    state.addGame = GAMES.some(([g]) => g === state.context.game) ? state.context.game : 'Pokemon';
    const savedExp = await store.get('cmr.expansions', null).catch(() => null);
    if (savedExp && Date.now() - savedExp.t < 7 * 86400000) state.expansions = savedExp.lists || {};
    recompute();
    state.ready = true;
    // Nouvelles offres chargées par Cardmarket (« Afficher plus ») : on repose les repères.
    new MutationObserver((muts) => {
      if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.article-row') || n.querySelector('.article-row'))))) decoratePage();
    }).observe(document.body, { childList: true, subtree: true });

    shadow.addEventListener('click', onClick);
    shadow.addEventListener('change', onChange);
    shadow.addEventListener('input', onInput);
    shadow.addEventListener('toggle', onToggleDetails, true);
    shadow.addEventListener(
      'paste',
      (e) => {
        const el = e.target;
        if (!el.getAttribute || el.getAttribute('data-model') !== 'searchQ') return;
        const pasted = (e.clipboardData && e.clipboardData.getData('text')) || '';
        if (pasted.trim().split(/\r?\n/).length < 2) return;
        e.preventDefault();
        state.addText = pasted;
        state.view.expanded.bulk = true;
        addFromText();
      },
      true
    );
    // Vignette qui ne charge pas (réseau, CSP) : on garde juste l'emplacement.
    shadow.addEventListener(
      'error',
      (e) => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG') return;
        failedThumbs.add(img.getAttribute('src'));
        const box = document.createElement('span');
        box.className = 'thumb empty';
        img.replaceWith(box);
      },
      true
    );
    shadow.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) setOpen(false);
      else if (e.key === 'Enter' && e.target.getAttribute && e.target.hasAttribute('data-exp-pick')) {
        e.preventDefault();
        pickExpansion(bulkGroup(e.target.getAttribute('data-exp-pick')));
      } else if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('data-model') === 'searchQ') {
        e.preventDefault();
        runSearch();
      } else if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('data-model') === 'addText' && (e.ctrlKey || e.metaKey)) addFromText();
      e.stopPropagation(); // pas de raccourcis Cardmarket pendant la saisie
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let dirty = false;
      const lk = store.listKey(state.listId);
      const dk = store.datasetKey(state.listId);
      if (changes[KEYS.lists] && changes[KEYS.lists].newValue && JSON.stringify(changes[KEYS.lists].newValue) !== JSON.stringify(state.lists)) {
        state.lists = changes[KEYS.lists].newValue;
        dirty = true;
      }
      if (changes[lk] && JSON.stringify(changes[lk].newValue || []) !== JSON.stringify(state.cards)) {
        state.cards = changes[lk].newValue || [];
        dirty = true;
      }
      if (changes[KEYS.settings] && JSON.stringify(changes[KEYS.settings].newValue) !== JSON.stringify(state.settings)) {
        state.settings = store.mergeSettings(changes[KEYS.settings].newValue);
        dirty = true;
      }
      if (changes[dk] && !state.running) {
        state.dataset = changes[dk].newValue || null;
        dirty = true;
      }
      if (dirty) {
        recompute();
        render();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.running) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    render();
    checkUpdate(false);
    setInterval(() => checkUpdate(false), 15 * 60 * 1000);
  }

  // ---------- Mises à jour (version distribuée par GitHub) ----------

  function askBackground(msg) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res || null));
      } catch (e) {
        resolve(null); // contexte d'extension invalidé (extension rechargée entre-temps)
      }
    });
  }

  async function checkUpdate(checkOnline) {
    const res = await askBackground({ type: 'cmr:update-status', checkOnline: !!checkOnline });
    if (!res) return;
    const before = JSON.stringify(state.update);
    state.update = res;
    if (JSON.stringify(res) !== before) render();
  }

  function applyUpdate() {
    if (state.running || state.cartBusy) {
      toast('Attends la fin de l’opération en cours, puis active la mise à jour.');
      return;
    }
    state.updating = true;
    render();
    askBackground({ type: 'cmr:apply-update' });
    // L'extension redémarre avec les nouveaux fichiers : on recharge la page pour reprendre avec elle.
    setTimeout(() => location.reload(), 1200);
  }

  function renderUpdateBanner() {
    const u = state.update;
    if (!u) return '';
    if (u.readyToActivate) {
      return html`<div class="update-banner ready">
        <span class="grow"><b>Nouvelle version ${u.disk} prête</b> (tu as la ${u.running}).</span>
        <button class="btn small primary" data-act="apply-update" ${attr(state.updating, 'disabled')}>${state.updating ? 'Activation…' : 'Activer maintenant'}</button>
      </div>`;
    }
    if (u.available) {
      return html`<div class="update-banner">
        <span class="grow">Version ${u.available} disponible : elle s’installe toute seule dans les prochaines heures.</span>
        ${u.page ? html`<a class="small" href="${u.page}" target="_blank" rel="noopener">Détails</a>` : ''}
      </div>`;
    }
    return '';
  }

  CMR.panel = {
    mount,
    toggle() {
      if (!state.ready) return;
      setOpen(!state.open);
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
