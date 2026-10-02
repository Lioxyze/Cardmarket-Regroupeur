/*
 * Regroupeur — persistance (chrome.storage.local) : liste, réglages,
 * dernière analyse et cache des pages lues.
 */
(function (root) {
  'use strict';
  const CMR = (root.CMR = root.CMR || {});

  const KEYS = {
    list: 'cmr.list',
    settings: 'cmr.settings',
    dataset: 'cmr.dataset',
    ui: 'cmr.ui',
    lists: 'cmr.lists',
  };
  // La première liste garde les clés d'origine (données déjà enregistrées intactes).
  const listKey = (id) => (id === 'main' ? KEYS.list : `${KEYS.list}.${id}`);
  const datasetKey = (id) => (id === 'main' ? KEYS.dataset : `${KEYS.dataset}.${id}`);
  const DEFAULT_LISTS = { active: 'main', items: [{ id: 'main', name: 'Ma liste' }] };
  const CACHE_PREFIX = 'cmr.c:';

  const DEFAULT_SETTINGS = {
    // Cartes (valeurs par défaut, modifiables carte par carte)
    languages: [2, 7], // français + japonais (ids Cardmarket) ; [] = toutes les langues
    minCondition: 'NM',
    special: 'exclude', // reverse holo / foil : exclude | any | only
    firstEd: 'any', // any | exclude | only
    excludeSignedAltered: true,
    maxPrice: null,
    graded: 'exclude', // cartes gradées (PSA…) : exclude = loose uniquement | only | any
    gradeCompany: null, // PSA, BGS, CGC… ; null = toutes
    minGrade: null,
    // Vendeurs
    sellerTypes: ['private', 'professional', 'powerseller'],
    countryMode: 'all', // all | mine | list
    countries: [], // codes ISO quand countryMode = list
    minSales: 0,
    excludedSellers: [],
    // Livraison (estimations, € par commande)
    // Estimations par commande, en 3 paliers selon sa valeur ; remplacées par le port réel lu au panier.
    shipping: {
      buyerCountry: 'FR',
      domestic: 1.6,
      international: 2.2,
      trackedThreshold: 25,
      trackedDomestic: 3.5,
      trackedInternational: 5.5,
      insuredThreshold: 100,
      insuredDomestic: 7,
      insuredInternational: 12,
    },
    orderPenalty: 0,
    // Regroupement : surcoût maximum accepté par carte par rapport à la moins chère (NM, langue…)
    maxPremiumPct: 10,
    maxPremiumAbs: 0.3,
    learnedShipping: {}, // frais de port lus au panier, par pays : { FR: { letter: { sum, n }, tracked: { sum, n } } }
    // Analyse — réglages sobres : peu de pages, bien espacées, gardées en cache
    pagesPerCard: 1, // 1 page = les 50 offres les moins chères
    deepCheck: true,
    deepSellers: 4,
    deepMaxRequests: 20,
    delayMs: 3000,
    cacheMinutes: 60,
    maxRequests: 120, // plafond de pages lues par analyse
    settingsVersion: 3,
  };

  const area = () => chrome.storage.local;

  async function get(key, fallback) {
    const r = await area().get(key);
    return r[key] === undefined ? fallback : r[key];
  }

  function set(key, value) {
    return area().set({ [key]: value });
  }

  // Anciennes valeurs par défaut (v1), remplacées par des réglages plus économes en requêtes.
  const V1_DEFAULTS = { pagesPerCard: 2, deepSellers: 5, deepMaxRequests: 40, delayMs: 2500, cacheMinutes: 30 };
  // v2 → v3 : port en 3 paliers (les anciennes valeurs sous-estimaient les envois suivis / assurés).
  const V2_SHIPPING = { domestic: 1.5, international: 2.0, trackedDomestic: 4.0, trackedInternational: 6.5 };

  function mergeSettings(saved) {
    const s = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    s.shipping = Object.assign({}, DEFAULT_SETTINGS.shipping, (saved && saved.shipping) || {});
    const version = (saved && saved.settingsVersion) || 1;
    if (saved && version < 2) for (const [k, old] of Object.entries(V1_DEFAULTS)) if (saved[k] === old) s[k] = DEFAULT_SETTINGS[k];
    if (saved && version < 3) {
      if (JSON.stringify(saved.languages) === '[2]') s.languages = DEFAULT_SETTINGS.languages.slice();
      for (const [k, old] of Object.entries(V2_SHIPPING)) if (s.shipping[k] === old) s.shipping[k] = DEFAULT_SETTINGS.shipping[k];
    }
    if (saved) s.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    return s;
  }

  // ---------- Cache des pages (une entrée par URL) ----------

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36) + str.length.toString(36);
  }

  async function getCache(url, ttlMinutes) {
    const key = CACHE_PREFIX + hash(url);
    const entry = await get(key, null);
    if (!entry || entry.url !== url) return null;
    if (Date.now() - entry.t > ttlMinutes * 60000) return null;
    return entry.data;
  }

  function putCache(url, data) {
    return set(CACHE_PREFIX + hash(url), { url, t: Date.now(), data });
  }

  async function pruneCache(ttlMinutes, all = false) {
    const everything = await area().get(null);
    const stale = Object.keys(everything).filter(
      (k) => k.startsWith(CACHE_PREFIX) && (all || Date.now() - (everything[k].t || 0) > ttlMinutes * 60000)
    );
    if (stale.length) await area().remove(stale);
    return stale.length;
  }

  CMR.store = {
    KEYS,
    DEFAULT_SETTINGS,
    get,
    set,
    mergeSettings,
    getCache,
    putCache,
    pruneCache,
    listKey,
    datasetKey,
    async loadLists() {
      const lists = await get(KEYS.lists, null);
      return lists && Array.isArray(lists.items) && lists.items.length ? lists : JSON.parse(JSON.stringify(DEFAULT_LISTS));
    },
    async loadList(id) {
      const r = await area().get([listKey(id), datasetKey(id)]);
      return { list: Array.isArray(r[listKey(id)]) ? r[listKey(id)] : [], dataset: r[datasetKey(id)] || null };
    },
    async loadAll() {
      const lists = await this.loadLists();
      if (!lists.items.some((l) => l.id === lists.active)) lists.active = lists.items[0].id;
      const r = await area().get([KEYS.settings, KEYS.ui]);
      const current = await this.loadList(lists.active);
      return { lists, list: current.list, dataset: current.dataset, settings: mergeSettings(r[KEYS.settings]), ui: r[KEYS.ui] || {} };
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
