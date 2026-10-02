/*
 * Regroupeur — analyse d'une liste de cartes.
 *
 * 1. Lit la page produit de chaque carte (filtres serveur + « Show more results »).
 * 2. Vérification approfondie : les vendeurs les plus prometteurs sont interrogés
 *    sur les cartes de la liste qu'on n'a pas vues chez eux (leurs offres peuvent
 *    être hors des premières pages, triées par prix).
 * 3. computeResults() filtre les offres côté client, calcule le coût de chaque
 *    carte chez chaque vendeur (quantité comprise) et lance l'optimiseur.
 *    Cette étape est instantanée : elle est rejouée à chaque changement de réglage.
 */
(function (root, factory) {
  const CMR = (root.CMR = root.CMR || {});
  const deps =
    typeof module === 'object' && module.exports
      ? { cm: require('./cm.js'), optimizer: require('./optimizer.js') }
      : { cm: CMR.cm, optimizer: CMR.optimizer };
  const api = factory(deps, CMR);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else CMR.analyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const { cm, optimizer } = deps;

  const round2 = (x) => Math.round(x * 100) / 100;

  // ---------- Filtres ----------

  /** Réglages d'une carte : ses propres valeurs, sinon celles par défaut. */
  function effectiveFilters(card, s) {
    const kind = cm.productKind(card.key);
    const f = {
      kind,
      qty: Math.max(1, parseInt(card.qty, 10) || 1),
      languages: Array.isArray(card.languages) ? card.languages : s.languages || [],
      minCondition: card.minCondition || s.minCondition || 'PO',
      special: card.special || s.special || 'any',
      firstEd: card.firstEd || s.firstEd || 'any',
      maxPrice: card.maxPrice > 0 ? card.maxPrice : s.maxPrice > 0 ? s.maxPrice : null,
      // Loose / gradée (PSA…) : « exclude » = loose uniquement
      graded: card.graded || s.graded || 'exclude',
      gradeCompany: card.graded ? card.gradeCompany || null : s.gradeCompany || null,
      minGrade: card.graded ? card.minGrade || null : s.minGrade || null,
    };
    if (kind === 'sealed') {
      // Coffrets, displays… : ni état, ni version, ni gradation.
      Object.assign(f, { minCondition: 'PO', special: 'any', firstEd: 'any', graded: 'any', gradeCompany: null, minGrade: null });
    }
    return f;
  }

  function sellerCountryCodes(s) {
    if (s.countryMode === 'mine') return [s.shipping.buyerCountry];
    if (s.countryMode === 'list') return s.countries || [];
    return [];
  }

  /** Filtres envoyés dans l'URL (réduisent la liste avant pagination). */
  function serverFilters(card, s) {
    const f = effectiveFilters(card, s);
    const single = f.kind === 'single';
    return {
      languages: f.languages,
      // Une carte gradée peut être déclarée dans n'importe quel état : pas de filtre serveur.
      minCondition: single && f.graded !== 'only' ? f.minCondition : 'PO',
      special: f.special,
      firstEd: f.firstEd,
      excludeSignedAltered: single && s.excludeSignedAltered,
      sellerTypes: s.sellerTypes,
      sellerCountries: sellerCountryCodes(s),
    };
  }

  const conditionRank = (code) => {
    const c = cm.CONDITIONS.find((x) => x.code === code);
    return c ? c.id : null;
  };

  /** Pourquoi une offre est écartée (null = acceptée). */
  function rejectReason(o, seller, f, s, ctx) {
    if (ctx.excluded.has(cm.norm(o.s))) return 'excluded';
    if (f.languages.length && o.l != null && !f.languages.includes(o.l)) return 'language';
    if (f.kind === 'single') {
      const g = cm.detectGrading(o.m);
      if (f.graded === 'exclude' && g) return 'graded';
      if (f.graded === 'only') {
        if (!g) return 'notGraded';
        if (f.gradeCompany && g.company !== f.gradeCompany) return 'gradeCompany';
        if (f.minGrade && (g.grade == null || g.grade < f.minGrade)) return 'grade';
      }
    }
    const rank = conditionRank(o.c);
    if (f.graded !== 'only' && rank != null && rank > conditionRank(f.minCondition)) return 'condition';
    const special = !!(o.f && (o.f.foil || o.f.reverseHolo));
    if (f.special === 'exclude' && special) return 'special';
    if (f.special === 'only' && !special) return 'special';
    const first = !!(o.f && o.f.firstEd);
    if (f.firstEd === 'exclude' && first) return 'firstEd';
    if (f.firstEd === 'only' && !first) return 'firstEd';
    if (s.excludeSignedAltered && o.f && (o.f.signed || o.f.altered)) return 'signed';
    if (o.f && o.f.playset) return 'playset';
    if (f.maxPrice && o.p > f.maxPrice + 1e-9) return 'price';
    if (seller) {
      if (s.sellerTypes && s.sellerTypes.length && !s.sellerTypes.includes(seller.type)) return 'sellerType';
      if (ctx.countries.length && !ctx.countries.includes(seller.countryCode)) return 'country';
      if (s.minSales > 0 && (seller.sales || 0) < s.minSales) return 'sales';
    }
    return null;
  }

  function filterContext(s) {
    return {
      excluded: new Set((s.excludedSellers || []).map(cm.norm)),
      countries: sellerCountryCodes(s),
    };
  }

  // ---------- Calcul des résultats (instantané) ----------

  /**
   * Coût de chaque carte chez chaque vendeur, pour la quantité voulue.
   * Un vendeur qui n'a pas assez d'exemplaires ne couvre pas la carte.
   */
  function buildCosts(dataset, cards, s) {
    const ctx = filterContext(s);
    const costs = {};
    const detail = {};
    const cardInfo = {};
    for (const card of cards) {
      const d = dataset && dataset.cards[card.id];
      const f = effectiveFilters(card, s);
      const p = (d && d.product) || {};
      const info = {
        id: card.id,
        key: card.key,
        name: p.name || card.name || card.key,
        kind: f.kind,
        expansion: p.expansion || card.expansion || '',
        number: p.number || card.number || '',
        trend: p.trend ?? null,
        qty: f.qty,
        analysed: !!d && !d.error,
        error: d ? d.error || null : null,
        offersTotal: d && d.offers ? d.offers.length : 0,
        offersAccepted: 0,
        sellers: 0,
        cheapest: null,
        rejected: {},
        complete: d ? d.complete !== false : true,
        // Filtres serveur modifiés depuis l'analyse : les offres lues ne suffisent plus.
        stale: !!(d && d.url && d.url !== cm.productFetchUrl(card.key, serverFilters(card, s))),
      };
      cardInfo[card.id] = info;
      costs[card.id] = {};
      detail[card.id] = {};
      if (!d || d.error) continue;

      const bySeller = new Map();
      for (const o of d.offers) {
        const why = rejectReason(o, dataset.sellers[o.s], f, s, ctx);
        if (why) {
          info.rejected[why] = (info.rejected[why] || 0) + 1;
          continue;
        }
        info.offersAccepted++;
        if (!bySeller.has(o.s)) bySeller.set(o.s, []);
        bySeller.get(o.s).push(o);
      }
      const totals = [];
      for (const [seller, list] of bySeller) {
        list.sort((a, b) => a.p - b.p);
        let need = f.qty;
        let total = 0;
        const take = [];
        for (const o of list) {
          if (need <= 0) break;
          const n = Math.min(need, o.n || 1);
          total += n * o.p;
          need -= n;
          take.push({ id: o.id, p: o.p, n, c: o.c, l: o.l, f: o.f, m: o.m, g: cm.gradingLabel(cm.detectGrading(o.m)) });
        }
        if (need > 0) continue;
        totals.push({ seller, total: round2(total), take });
      }
      if (!totals.length) continue;
      // Surcoût plafonné : pour regrouper, on accepte de payer un peu plus que la moins chère
      // (qui respecte déjà état / langue…), jamais beaucoup plus.
      const cheapest = Math.min(...totals.map((t) => t.total));
      const limit = premiumLimit(cheapest, f.qty, s);
      info.cheapest = cheapest;
      info.limit = limit;
      for (const t of totals) {
        if (t.total > limit + 1e-9) {
          info.rejected.premium = (info.rejected.premium || 0) + 1;
          continue;
        }
        costs[card.id][t.seller] = t.total;
        detail[card.id][t.seller] = t.take;
        info.sellers++;
      }
    }
    return { costs, detail, cardInfo };
  }

  /** Prix maximum accepté pour une carte : moins chère + max(pourcentage, montant fixe par exemplaire). */
  function premiumLimit(cheapest, qty, s) {
    if (s.maxPremiumPct == null && s.maxPremiumAbs == null) return Infinity;
    const pct = Math.max(0, Number(s.maxPremiumPct) || 0);
    const abs = Math.max(0, Number(s.maxPremiumAbs) || 0);
    return round2(Math.max(cheapest * (1 + pct / 100), cheapest + abs * qty));
  }

  /** Moyennes des frais de port vus au panier : { FR: { letter: 1.62, tracked: 4.1 } }. */
  function learnedShipping(raw) {
    const out = {};
    for (const [country, slots] of Object.entries(raw || {})) {
      out[country] = {};
      for (const slot of ['letter', 'tracked', 'insured']) {
        const v = slots && slots[slot];
        out[country][slot] = v && v.n > 0 ? round2(v.sum / v.n) : null;
      }
    }
    return out;
  }

  function computeResults(dataset, cards, s) {
    const { costs, detail, cardInfo } = buildCosts(dataset, cards, s);
    const used = new Set();
    for (const id of Object.keys(costs)) for (const seller of Object.keys(costs[id])) used.add(seller);
    const sellers = [...used].map((name) => ({ id: name, country: (dataset.sellers[name] || {}).countryCode || '' }));
    const solved = optimizer.solve({
      cards: cards.map((c) => ({ id: c.id })),
      sellers,
      costs,
      shipping: Object.assign({}, s.shipping, { learned: learnedShipping(s.learnedShipping) }),
      orderPenalty: s.orderPenalty,
    });
    return {
      solved,
      cardInfo,
      detail,
      sellers: dataset.sellers,
      createdAt: dataset.createdAt,
      partial: !!dataset.partial,
      stopReason: dataset.stopReason || null,
      deep: dataset.deep || null,
      requests: dataset.requests || 0,
    };
  }

  // ---------- Saisie texte : « Nom | Numéro | Extension | Langue | État | Qté » ----------

  // Numéro de carte : « 065 », « 065/099 », « #65 », « TG05 », « SV-P 012 »…
  const NUM = String.raw`#?(?:[A-Z]{1,4}[- ]?)?\d{1,4}[a-z]?(?:\s*\/\s*[A-Z]{0,4}\d{1,4})?`;
  const SEP = String.raw`\s*[—–:|.)]\s*|\s+-\s+|\s+`;
  const NUM_FIRST = new RegExp(`^(${NUM})(?:${SEP})(.+)$`);
  const NUM_LAST = new RegExp(`^(.+?)(?:${SEP})(${NUM})$`); // préfixe de numéro en majuscules : « ex 25 » n'en est pas un

  /** « 065 — Tokotoro », « Tokotoro 065/099 », « 2x 065 Tokotoro »… → { number, name, qty } */
  function parseNumberedLine(raw) {
    let text = raw;
    let qty = 1;
    const lead = text.match(/^(\d{1,2})\s*x\s+(.+)$/i);
    if (lead) {
      qty = parseInt(lead[1], 10);
      text = lead[2];
    }
    const tail = text.match(/^(.+?)\s+[x×]\s*(\d{1,2})$/i);
    if (tail) {
      qty = parseInt(tail[2], 10);
      text = tail[1];
    }
    // Format Cardmarket : « Houndoom (SFA 066) », « Kingdra ex [SFA 080] », « Horsea (067/064) »
    let m = text.match(PAREN);
    if (m && /\p{L}/u.test(m[1])) return withCode({ name: m[1].trim(), number: m[2].trim(), qty });
    m = text.match(NUM_FIRST);
    if (m && /\p{L}/u.test(m[2])) return withCode({ number: m[1].replace(/^#/, '').trim(), name: m[2].trim(), qty });
    m = text.match(NUM_LAST);
    if (m && /\p{L}/u.test(m[1]) && /\d/.test(m[2])) return withCode({ number: m[2].replace(/^#/, '').trim(), name: m[1].trim(), qty });
    return null;
  }

  const PAREN = new RegExp(String.raw`^(.+?)\s*[(\[]\s*(${NUM})\s*[)\]]$`);

  /** « SFA 066 » / « SFA-066 » → code d'extension SFA + numéro 066 ; « TG05 » (collé) reste un numéro. */
  function withCode(w) {
    const m = w.number.match(/^([A-Z]{2,4}(?:-[A-Z])?)[\s-]+(\d{1,4}[a-z]?(?:\s*\/\s*\d{1,4})?)$/);
    if (m) {
      w.setCode = m[1];
      w.number = m[2];
    } else w.setCode = '';
    return w;
  }

  /** Nom à chercher : sans code / numéro entre parenthèses (« Houndoom (SFA 066) » → « Houndoom »). */
  function searchQuery(name) {
    return cm.clean(String(name || '').replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '')) || name;
  }

  function parseTextLine(line) {
    let raw = cm.clean(line);
    if (!raw || raw.startsWith('//') || /^#\s*\D/.test(raw)) return null; // commentaire (« #65 » reste un numéro)
    if (!/[|;\t]/.test(line)) {
      const numbered = parseNumberedLine(raw);
      if (numbered)
        return { name: numbered.name, number: numbered.number, setCode: numbered.setCode, expansion: '', languages: null, minCondition: null, qty: numbered.qty };
    }
    let qty = null;
    const lead = raw.match(/^(\d{1,2})\s*x\s+(.+)$/i);
    if (lead) {
      qty = parseInt(lead[1], 10);
      raw = lead[2];
    }
    const parts = raw.split(/\s*[|;\t]\s*/);
    const want = { name: parts[0] || '', number: '', expansion: '', languages: null, minCondition: null, qty: qty || 1 };
    const rest = parts.slice(1);
    // Positions documentées, mais langue / état / quantité sont reconnus où qu'ils soient.
    rest.forEach((field, i) => {
      if (!field) return;
      const lang = cm.findLanguage(field);
      const cond = cm.findCondition(field);
      if (lang && i >= 2) want.languages = [lang.id];
      else if (cond && i >= 2) want.minCondition = cond.code;
      else if (/^x?\s*\d{1,2}\s*x?$/i.test(field) && i >= 3) want.qty = parseInt(field.replace(/\D/g, ''), 10) || 1;
      else if (i === 0) want.number = field;
      else if (i === 1) want.expansion = field;
      else if (lang) want.languages = [lang.id];
      else if (cond) want.minCondition = cond.code;
    });
    if (!want.name) return null;
    return want;
  }

  /** '025/165' → '25' ; 'SVP 012' → 'svp12' ; 'LC 64' → 'lc64' */
  function normNumber(n) {
    return cm
      .norm(String(n || '').split('/')[0])
      .replace(/[^a-z0-9]/g, '')
      .replace(/(^|[a-z])0+(\d)/g, '$1$2');
  }

  function scoreCandidate(c, want) {
    let score = 0;
    const detail = { number: null, expansion: null };
    if (want.number) {
      const a = normNumber(want.number);
      const fromName = (c.name.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
      const b = [normNumber(c.number), normNumber(fromName), normNumber(fromName.replace(/^[A-Za-z-]+\s*/, ''))];
      detail.number = !!a && b.includes(a);
      if (detail.number) score += 4;
      else if (a && normNumber(c.key.split('/').pop()).endsWith(a)) {
        detail.number = true;
        score += 3;
      }
    }
    if (want.expansion) {
      const e = cm.norm(want.expansion);
      const ce = cm.norm(c.expansion) + ' ' + cm.norm(c.key.split('/')[3] || '').replace(/-/g, ' ');
      detail.expansion = ce.includes(e) || (e.length > 3 && cm.norm(c.expansion).length > 3 && e.includes(cm.norm(c.expansion)));
      if (detail.expansion) score += 3;
    }
    const n = cm.norm(want.name);
    const cn = cm.norm(cm.searchableName(c.name));
    if (cn === n) score += 2;
    else if (cn.startsWith(n)) score += 1;
    return { score, detail };
  }

  /** Classe les résultats de recherche ; `auto` quand un seul candidat colle sans ambiguïté. */
  function rankCandidates(candidates, want, kind = 'singles') {
    const wantSingles = kind === 'singles';
    const scored = candidates
      .filter((c) => (cm.productKind(c.key) === 'single') === wantSingles)
      .map((c) => ({ ...c, ...scoreCandidate(c, want) }))
      .sort((a, b) => b.score - a.score || (b.available || 0) - (a.available || 0));
    let auto = null;
    if (scored.length === 1) auto = scored[0];
    else if (scored.length > 1 && scored[0].score > scored[1].score) {
      const top = scored[0];
      const numberOk = !want.number || top.detail.number;
      const expOk = !want.expansion || top.detail.expansion;
      if (numberOk && expOk && (want.number || want.expansion)) auto = top;
    }
    return { candidates: scored.slice(0, 20), auto };
  }

  /**
   * Associe chaque ligne numérotée à la carte de l'extension qui porte ce numéro.
   * @param wants   [{ number, name, qty }]
   * @param listing [{ key, name, number, … }] (page « liste » de l'extension)
   * @returns { matched: [{ want, product, alternatives }], unmatched: [want] }
   */
  function matchByNumber(wants, listing) {
    const byNumber = new Map();
    for (const p of listing) {
      const fromName = (p.name.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
      const n = normNumber(p.number) || normNumber(fromName.replace(/^[A-Za-z-]+\s*/, ''));
      if (!n) continue;
      if (!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n).push(p);
    }
    const matched = [];
    const unmatched = [];
    for (const want of wants) {
      const list = byNumber.get(normNumber(want.number)) || [];
      if (!list.length) {
        unmatched.push(want);
        continue;
      }
      // Plusieurs versions au même numéro : on préfère celle dont le nom ressemble.
      const n = cm.norm(want.name).replace(/-/g, ' ');
      const sorted = list.slice().sort((a, b) => nameScore(b, n) - nameScore(a, n));
      matched.push({ want, product: sorted[0], alternatives: sorted.slice(1), nameMatch: nameScore(sorted[0], n) > 0 });
    }
    return { matched, unmatched };
  }

  function nameScore(product, wantedNorm) {
    const pn = cm.norm(cm.searchableName(product.name)).replace(/-/g, ' ');
    if (!wantedNorm) return 0;
    if (pn === wantedNorm) return 3;
    if (pn.startsWith(wantedNorm) || wantedNorm.startsWith(pn)) return 2;
    return pn.split(' ').some((w) => w.length > 3 && wantedNorm.includes(w)) ? 1 : 0;
  }

  /** Lignes les plus parlantes pour deviner l'extension (noms longs, « ex », pas d'énergie de base). */
  function pickDetectionLines(wants, max = 3) {
    const seen = new Set();
    return wants
      .filter((w) => w.number && w.name && !/^[ée]nergie|^energy/i.test(cm.norm(w.name)))
      .filter((w) => {
        const k = cm.norm(w.name);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((w) => ({ w, score: (/\bex\b|-ex$|\bgx\b|\bv(max|star)?\b/i.test(w.name) ? 10 : 0) + Math.min(w.name.length, 15) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.w);
  }

  /** Extensions dont une carte porte à la fois ce nom (recherche) et ce numéro. */
  /**
   * Extensions dont une carte porte à la fois ce nom (recherche) et ce numéro.
   * Poids 2 si le code d'extension du nom Cardmarket (« (SFA 066) ») correspond aussi : quasi certain.
   */
  function expansionVotes(results, want) {
    const n = normNumber(want.number);
    const code = String(want.setCode || '').toUpperCase();
    const out = new Map();
    for (const c of results) {
      if (cm.productKind(c.key) !== 'single') continue;
      const fromName = (c.name.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
      const nameCode = (fromName.match(/^([A-Za-z]{2,4}(?:-[A-Za-z])?)[\s-]/) || [])[1] || '';
      const num = normNumber(c.number) || normNumber(fromName.replace(/^[A-Za-z-]+\s*/, ''));
      if (num !== n) continue;
      if (code && nameCode && nameCode.toUpperCase() !== code) continue;
      const slug = c.key.split('/')[3];
      const weight = code && nameCode ? 2 : 1;
      const prev = out.get(slug);
      if (!prev || prev.weight < weight) out.set(slug, { slug, name: c.expansion || slug.replace(/-/g, ' '), weight });
    }
    return [...out.values()];
  }

  // ---------- Analyse (réseau) ----------

  function compactOffer(o) {
    const flags = {};
    for (const k of Object.keys(o.flags || {})) if (o.flags[k]) flags[k] = true;
    return {
      id: o.id,
      s: o.seller ? o.seller.name : null,
      p: o.price,
      n: o.count || 1,
      c: o.condition,
      l: o.languageId,
      f: flags,
      m: o.comment || '',
    };
  }

  class Analysis {
    constructor({ settings, fetcher, store, onProgress }) {
      this.s = settings;
      this.fetcher = fetcher;
      this.store = store;
      this.onProgress = onProgress || (() => {});
    }

    progress(p) {
      this.onProgress(Object.assign({ requests: this.fetcher.count }, p));
    }

    overBudget() {
      return this.s.maxRequests > 0 && this.fetcher.count >= this.s.maxRequests;
    }

    budgetStop(left) {
      return {
        code: 'BUDGET',
        message: `Limite de ${this.s.maxRequests} pages atteinte : ${left} carte${left > 1 ? 's' : ''} non lue${
          left > 1 ? 's' : ''
        }. Relance plus tard (le cache garde ce qui a été lu) ou augmente la limite dans les réglages.`,
      };
    }

    async run(cards, signal) {
      const ds = {
        version: 1,
        createdAt: Date.now(),
        cards: {},
        sellers: {},
        deep: null,
        partial: false,
        stopReason: null,
        requests: 0,
      };
      await this.store.pruneCache(this.s.cacheMinutes).catch(() => {});

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (this.overBudget()) {
          ds.partial = true;
          ds.stopReason = this.budgetStop(cards.length - i);
          break;
        }
        this.progress({ phase: 'cards', done: i, total: cards.length, label: card.name || card.key });
        try {
          const r = await this.fetchCard(card, signal);
          ds.cards[card.id] = r.card;
          for (const [name, info] of Object.entries(r.sellers)) ds.sellers[name] = Object.assign(ds.sellers[name] || {}, info);
        } catch (e) {
          if (['ABORTED', 'CHALLENGE', 'RATE_LIMIT', 'NETWORK'].includes(e.code)) {
            ds.partial = true;
            ds.stopReason = { code: e.code, message: e.message };
            break;
          }
          ds.cards[card.id] = { key: card.key, error: e.message || String(e), offers: [] };
        }
      }

      if (!ds.partial && this.s.deepCheck && this.s.deepSellers > 0) {
        try {
          await this.deepCheck(ds, cards, signal);
        } catch (e) {
          ds.partial = true;
          ds.stopReason = { code: e.code || 'ERROR', message: e.message || String(e) };
        }
      }
      ds.requests = this.fetcher.count;
      this.progress({ phase: 'done', done: cards.length, total: cards.length });
      return ds;
    }

    async fetchCard(card, signal) {
      const s = this.s;
      const url = cm.productFetchUrl(card.key, serverFilters(card, s));
      const maxPages = effectiveFilters(card, s).graded === 'only' ? Math.max(4, s.pagesPerCard) : s.pagesPerCard;
      const cacheKey = `${url}#pages=${maxPages}`;
      const cached = await this.store.getCache(cacheKey, s.cacheMinutes).catch(() => null);
      if (cached) return cached;

      const { doc } = await this.fetcher.getDoc(url, signal);
      const page = cm.parseProductPage(doc);
      if (!page.product.name && !page.offers.length) {
        throw new Error('Page produit illisible : lien invalide ou mise en page Cardmarket modifiée');
      }
      let offers = page.offers;
      let form = page.loadMore;
      let complete = !form;
      let loadError = null;
      for (let pages = 1; form && pages < maxPages && !this.overBudget(); pages++) {
        this.progress({ phase: 'cards-more', label: page.product.name, page: pages + 1 });
        try {
          const res = await this.fetcher.postForm(cm.loadMoreUrl(cm.gameOfKey(card.key)), form, signal);
          const more = cm.parseLoadMoreXml(res.text);
          const holder = new DOMParser().parseFromString(`<div>${more.html}</div>`, 'text/html');
          offers = offers.concat(cm.parseOfferRows(holder));
          if (!more.nextPage || more.capped) {
            complete = !more.capped;
            form = null;
          } else form = Object.assign({}, form, { page: String(more.nextPage) });
        } catch (e) {
          if (['ABORTED', 'CHALLENGE', 'RATE_LIMIT'].includes(e.code)) throw e;
          loadError = e.message;
          form = null;
        }
      }

      const seen = new Set();
      const sellers = {};
      const compact = [];
      for (const o of offers) {
        if (!o.seller || o.price == null || (o.id && seen.has(o.id))) continue;
        if (o.id) seen.add(o.id);
        sellers[o.seller.name] = o.seller;
        compact.push(compactOffer(o));
      }
      const result = {
        card: {
          key: card.key,
          url,
          product: page.product,
          offers: compact,
          complete,
          loadError,
          fetchedAt: Date.now(),
        },
        sellers,
      };
      await this.store.putCache(cacheKey, result).catch(() => {});
      return result;
    }

    /**
     * Les pages produit sont triées par prix : un gros vendeur un peu plus cher
     * peut avoir une carte sans apparaître dans les premières offres. On va donc
     * chercher, chez les vendeurs les plus prometteurs, les cartes qui leur manquent.
     */
    async deepCheck(ds, cards, signal) {
      const s = this.s;
      const { costs } = buildCosts(ds, cards, s);
      const coverage = new Map();
      for (const card of cards) for (const seller of Object.keys(costs[card.id] || {})) coverage.set(seller, (coverage.get(seller) || 0) + 1);
      const top = [...coverage.entries()]
        .filter(([, n]) => n >= 2 && n < cards.length)
        .sort((a, b) => b[1] - a[1] || (ds.sellers[b[0]].sales || 0) - (ds.sellers[a[0]].sales || 0))
        .slice(0, s.deepSellers)
        .map(([name]) => name);

      const tasks = [];
      for (const seller of top) {
        for (const card of cards) {
          const d = ds.cards[card.id];
          if (!d || d.error || !d.product || !d.product.name) continue;
          if (cm.productKind(card.key) !== 'single') continue;
          if (costs[card.id] && costs[card.id][seller] != null) continue;
          tasks.push({ seller, card });
        }
      }
      const planned = tasks.slice(0, s.deepMaxRequests);
      ds.deep = { sellers: top, planned: planned.length, skipped: tasks.length - planned.length, checked: 0, found: 0, disabled: null };

      let suspicious = 0;
      for (let i = 0; i < planned.length; i++) {
        if (this.overBudget()) {
          ds.deep.skipped += planned.length - i;
          break;
        }
        const { seller, card } = planned[i];
        const d = ds.cards[card.id];
        const name = cm.searchableName(d.product.name);
        this.progress({ phase: 'deep', done: i, total: planned.length, label: `${name} chez ${seller}` });
        const url = cm.sellerStockSearchUrl(cm.gameOfKey(card.key), seller, name, 'en');
        let rows;
        const cacheKey = 'deep:' + url;
        const cached = await this.store.getCache(cacheKey, s.cacheMinutes).catch(() => null);
        if (cached) rows = cached;
        else {
          try {
            const { doc } = await this.fetcher.getDoc(url, signal);
            rows = cm.parseOfferRows(doc).map((o) => Object.assign(compactOffer(o), { key: o.productKey, pn: o.productName }));
          } catch (e) {
            if (['ABORTED', 'CHALLENGE', 'RATE_LIMIT', 'NETWORK'].includes(e.code)) throw e;
            rows = [];
          }
          await this.store.putCache(cacheKey, rows).catch(() => {});
        }
        ds.deep.checked++;

        // Garde-fou : si Cardmarket ignore le filtre par nom, on s'arrête vite.
        const n = cm.norm(name);
        if (rows.length && !rows.some((r) => cm.norm(r.pn).includes(n))) {
          suspicious++;
          if (suspicious >= 3 && ds.deep.found === 0) {
            ds.deep.disabled = 'La recherche dans le stock des vendeurs ne répond pas comme prévu : vérification approfondie arrêtée.';
            break;
          }
        }
        for (const r of rows) {
          if (r.key !== card.key || r.p == null) continue;
          if (d.offers.some((o) => o.id && o.id === r.id)) continue;
          d.offers.push({ id: r.id, s: seller, p: r.p, n: r.n, c: r.c, l: r.l, f: r.f, m: r.m, deep: true });
          ds.deep.found++;
        }
      }
    }
  }

  return {
    effectiveFilters,
    serverFilters,
    premiumLimit,
    learnedShipping,
    rejectReason,
    buildCosts,
    computeResults,
    parseTextLine,
    parseNumberedLine,
    searchQuery,
    matchByNumber,
    pickDetectionLines,
    expansionVotes,
    rankCandidates,
    normNumber,
    Analysis,
  };
});
