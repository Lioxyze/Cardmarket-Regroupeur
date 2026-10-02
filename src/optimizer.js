/*
 * Regroupeur — optimiseur de commandes multi-vendeurs.
 *
 * Le problème : chaque carte doit être achetée chez un vendeur, chaque vendeur
 * retenu coûte des frais de port. Minimiser (prix des cartes + port) revient à
 * un « problème de localisation d'entrepôts » (UFL), NP-difficile en général
 * mais très bien traité sur nos tailles (quelques dizaines de cartes, quelques
 * centaines de vendeurs) par glouton + recherche locale (ajout / retrait / échange).
 *
 * Aucune dépendance au DOM : le même fichier tourne dans l'extension et sous Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.CMR = root.CMR || {}).optimizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Une carte non couverte « coûte » plus que n'importe quel panier réel :
  // la couverture passe toujours avant le prix.
  const UNCOVERED_PENALTY = 1e6;
  const EPS = 1e-9;

  // Trois paliers selon la valeur de la commande : lettre, envoi suivi, recommandé / assuré.
  const DEFAULT_SHIPPING = {
    buyerCountry: 'FR',
    domestic: 1.6,
    international: 2.2,
    trackedThreshold: 25,
    trackedDomestic: 3.5,
    trackedInternational: 5.5,
    insuredThreshold: 100,
    insuredDomestic: 7,
    insuredInternational: 12,
  };

  /**
   * @param {object} problem
   *   cards:    [{ id }]
   *   sellers:  [{ id, country }]           country = code ISO (FR, DE…) ou ''
   *   costs:    { [cardId]: { [sellerId]: prix total pour la quantité voulue } }
   *   shipping: voir DEFAULT_SHIPPING
   *   orderPenalty: € ajoutés par commande dans l'objectif (préférence, pas un coût réel)
   */
  function createContext(problem) {
    const cardIds = problem.cards.map((c) => c.id);
    const sellerIds = problem.sellers.map((s) => s.id);
    const N = cardIds.length;
    const M = sellerIds.length;
    const sellerIndex = new Map(sellerIds.map((id, j) => [id, j]));

    const cost = new Float64Array(N * M).fill(Infinity);
    const coverLists = Array.from({ length: M }, () => []);
    const cheapest = new Float64Array(N).fill(Infinity);
    const cheapestSeller = new Int32Array(N).fill(-1);

    for (let i = 0; i < N; i++) {
      const row = problem.costs[cardIds[i]];
      if (!row) continue;
      for (const sid of Object.keys(row)) {
        const j = sellerIndex.get(sid);
        const p = row[sid];
        if (j === undefined || !Number.isFinite(p) || p < 0) continue;
        cost[i * M + j] = p;
        coverLists[j].push(i);
        if (p < cheapest[i]) {
          cheapest[i] = p;
          cheapestSeller[i] = j;
        }
      }
    }

    const coverable = [];
    for (let i = 0; i < N; i++) if (cheapestSeller[i] >= 0) coverable.push(i);

    return {
      N,
      M,
      cardIds,
      sellerIds,
      cost,
      coverLists,
      cheapest,
      cheapestSeller,
      coverable,
      ship: makeShipping(problem.shipping, problem.sellers),
      orderPenalty: Math.max(0, Number(problem.orderPenalty) || 0),
    };
  }

  function makeShipping(cfg, sellers) {
    const c = Object.assign({}, DEFAULT_SHIPPING, cfg || {});
    // Pays inconnu : on suppose un envoi international (estimation prudente).
    const domestic = sellers.map((s) => !!c.buyerCountry && s.country === c.buyerCountry);
    // Frais réellement vus au panier Cardmarket, par pays d'expédition : prioritaires sur l'estimation.
    const learned = sellers.map((s) => (c.learned && s.country && c.learned[s.country]) || null);
    return function ship(j, orderValue) {
      const tier = shippingTier(c, orderValue);
      const seen = learned[j] && learned[j][tier];
      if (seen != null) return seen;
      const dom = domestic[j];
      if (tier === 'insured') return dom ? c.insuredDomestic : c.insuredInternational;
      if (tier === 'tracked') return dom ? c.trackedDomestic : c.trackedInternational;
      return dom ? c.domestic : c.international;
    };
  }

  /** « letter » | « tracked » | « insured » selon la valeur de la commande. */
  function shippingTier(cfg, orderValue) {
    const c = Object.assign({}, DEFAULT_SHIPPING, cfg || {});
    if (c.insuredThreshold > 0 && orderValue >= c.insuredThreshold) return 'insured';
    if (c.trackedThreshold > 0 && orderValue >= c.trackedThreshold) return 'tracked';
    return 'letter';
  }

  /** Coût d'un ensemble de vendeurs : chaque carte part chez le moins cher de l'ensemble. */
  function evaluate(ctx, S, orderPenalty = ctx.orderPenalty) {
    const { M, cost, coverable } = ctx;
    const k = S.length;
    const value = new Float64Array(k);
    const count = new Int32Array(k);
    let cardsCost = 0;
    let uncovered = 0;
    for (let x = 0; x < coverable.length; x++) {
      const base = coverable[x] * M;
      let best = Infinity;
      let bt = -1;
      for (let t = 0; t < k; t++) {
        const p = cost[base + S[t]];
        if (p < best) {
          best = p;
          bt = t;
        }
      }
      if (bt < 0) {
        uncovered++;
        continue;
      }
      cardsCost += best;
      value[bt] += best;
      count[bt]++;
    }
    let shipCost = 0;
    let orders = 0;
    for (let t = 0; t < k; t++) {
      if (count[t] === 0) continue;
      orders++;
      shipCost += ctx.ship(S[t], value[t]);
    }
    return {
      uncovered,
      orders,
      cardsCost,
      shipCost,
      total: cardsCost + shipCost,
      objective: uncovered * UNCOVERED_PENALTY + cardsCost + shipCost + orders * orderPenalty,
      unused: orders < k,
    };
  }

  /** Détail lisible d'un ensemble de vendeurs (commandes, cartes affectées, manquantes). */
  function describe(ctx, S) {
    const { M, cost, coverable, cardIds, sellerIds } = ctx;
    const orders = new Map();
    const missing = [];
    for (const i of coverable) {
      let best = Infinity;
      let bj = -1;
      for (const j of S) {
        const p = cost[i * M + j];
        if (p < best) {
          best = p;
          bj = j;
        }
      }
      if (bj < 0) {
        missing.push(cardIds[i]);
        continue;
      }
      if (!orders.has(bj)) orders.set(bj, { sellerId: sellerIds[bj], cards: [], cardsCost: 0, shipCost: 0 });
      const o = orders.get(bj);
      o.cards.push({ cardId: cardIds[i], price: best });
      o.cardsCost += best;
    }
    const list = [...orders.entries()].map(([j, o]) => {
      o.shipCost = ctx.ship(j, o.cardsCost);
      return o;
    });
    list.sort((a, b) => b.cards.length - a.cards.length || a.cardsCost - b.cardsCost);
    const cardsCost = list.reduce((s, o) => s + o.cardsCost, 0);
    const shipCost = list.reduce((s, o) => s + o.shipCost, 0);
    return {
      sellers: list.map((o) => o.sellerId),
      orders: list,
      covered: coverable.length - missing.length,
      missing,
      cardsCost: round2(cardsCost),
      shipCost: round2(shipCost),
      total: round2(cardsCost + shipCost),
    };
  }

  /** Vendeurs utiles pour la recherche locale : les plus gros stocks + les moins chers par carte. */
  function candidateSellers(ctx, limit = 250) {
    const { M, coverLists, cost, cheapest, coverable } = ctx;
    const byCoverage = [];
    for (let j = 0; j < M; j++) {
      if (coverLists[j].length === 0) continue;
      let ratio = 0;
      for (const i of coverLists[j]) ratio += cheapest[i] / Math.max(cost[i * M + j], 0.01);
      byCoverage.push({ j, n: coverLists[j].length, ratio });
    }
    byCoverage.sort((a, b) => b.n - a.n || b.ratio - a.ratio);
    const set = new Set(byCoverage.slice(0, limit).map((x) => x.j));
    // Les 3 offres les moins chères de chaque carte restent candidates quoi qu'il arrive.
    for (const i of coverable) {
      const row = [];
      for (let j = 0; j < M; j++) if (cost[i * M + j] < Infinity) row.push(j);
      row.sort((a, b) => cost[i * M + a] - cost[i * M + b]);
      for (const j of row.slice(0, 3)) set.add(j);
    }
    return { list: [...set], ranked: byCoverage.map((x) => x.j) };
  }

  function greedy(ctx, seed, candidates, penalty) {
    const S = seed.slice();
    let cur = evaluate(ctx, S, penalty).objective;
    for (;;) {
      let best = cur - EPS;
      let bj = -1;
      for (const j of candidates) {
        if (S.includes(j)) continue;
        S.push(j);
        const o = evaluate(ctx, S, penalty).objective;
        S.pop();
        if (o < best) {
          best = o;
          bj = j;
        }
      }
      if (bj < 0) return S;
      S.push(bj);
      cur = best;
    }
  }

  function localSearch(ctx, start, candidates, penalty) {
    let S = start.slice();
    let cur = evaluate(ctx, S, penalty).objective;
    for (let iter = 0; iter < 100; iter++) {
      let bestObj = cur - EPS;
      let bestS = null;
      const inS = new Set(S);
      for (let a = 0; a < S.length; a++) {
        const T = S.filter((_, x) => x !== a);
        const o = evaluate(ctx, T, penalty).objective;
        if (o < bestObj) {
          bestObj = o;
          bestS = T;
        }
      }
      for (const j of candidates) {
        if (inS.has(j)) continue;
        const T = S.concat(j);
        const o = evaluate(ctx, T, penalty).objective;
        if (o < bestObj) {
          bestObj = o;
          bestS = T;
        }
        for (let a = 0; a < S.length; a++) {
          const U = S.slice();
          U[a] = j;
          const o2 = evaluate(ctx, U, penalty).objective;
          if (o2 < bestObj) {
            bestObj = o2;
            bestS = U;
          }
        }
      }
      if (!bestS) break;
      S = bestS;
      cur = bestObj;
    }
    return S;
  }

  function solveUFL(ctx, cand, penalty) {
    const starts = [[]];
    for (const j of cand.ranked.slice(0, 8)) starts.push([j]);
    let best = null;
    let bestObj = Infinity;
    const seen = new Set();
    for (const seed of starts) {
      const S = localSearch(ctx, greedy(ctx, seed, cand.list, penalty), cand.list, penalty);
      const key = S.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const o = evaluate(ctx, S, penalty).objective;
      if (o < bestObj - EPS) {
        bestObj = o;
        best = S;
      }
    }
    return best || [];
  }

  // ---------- Couverture exacte à 1 ou 2 vendeurs (bitsets) ----------

  function bitsets(ctx) {
    const W = Math.ceil(ctx.N / 32) || 1;
    const sets = Array.from({ length: ctx.M }, () => new Uint32Array(W));
    ctx.coverLists.forEach((list, j) => {
      for (const i of list) sets[j][i >>> 5] |= 1 << (i & 31);
    });
    const all = new Uint32Array(W);
    for (const i of ctx.coverable) all[i >>> 5] |= 1 << (i & 31);
    return { W, sets, all };
  }

  function exactSmallCover(ctx, maxK = 2) {
    const U = ctx.coverable.length;
    if (U === 0) return null;
    const { W, sets, all } = bitsets(ctx);
    const pick = (combos) => {
      let best = null;
      let bestTotal = Infinity;
      for (const S of combos) {
        const e = evaluate(ctx, S, 0);
        if (e.uncovered === 0 && !e.unused && e.total < bestTotal) {
          bestTotal = e.total;
          best = S;
        }
      }
      return best;
    };
    const full = [];
    for (let j = 0; j < ctx.M; j++) if (ctx.coverLists[j].length === U) full.push([j]);
    if (full.length) return pick(full);
    if (maxK < 2) return null;

    const half = Math.ceil(U / 2);
    const big = [];
    const any = [];
    for (let j = 0; j < ctx.M; j++) {
      const n = ctx.coverLists[j].length;
      if (n === 0) continue;
      any.push(j);
      if (n >= half) big.push(j);
    }
    const pairs = [];
    for (const a of big) {
      for (const b of any) {
        if (b === a || (ctx.coverLists[b].length >= half && b < a)) continue;
        let ok = true;
        for (let w = 0; w < W && ok; w++) if ((sets[a][w] | sets[b][w]) !== all[w]) ok = false;
        if (ok) pairs.push([a, b]);
      }
    }
    return pairs.length ? pick(pairs) : null;
  }

  // ---------- Classement des combinaisons de 1 à 3 vendeurs ----------

  function topCombos(ctx, cand, { maxSize = 3, limit = 25 } = {}) {
    const ranked = cand.ranked;
    const out = {};
    const better = (a, b) => b.covered - a.covered || a.total - b.total;
    const push = (bucket, S) => {
      const e = evaluate(ctx, S, 0);
      if (e.unused) return; // un vendeur ne sert à rien : combinaison redondante
      bucket.push({ S: S.slice(), covered: ctx.coverable.length - e.uncovered, total: e.total });
    };
    const finish = (bucket) =>
      bucket
        .sort(better)
        .slice(0, limit)
        .map((x) => describe(ctx, x.S));

    const b1 = [];
    for (const j of ranked) push(b1, [j]);
    out[1] = finish(b1);

    if (maxSize >= 2) {
      const P = ranked.slice(0, 150);
      const b2 = [];
      for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) push(b2, [P[a], P[b]]);
      out[2] = finish(b2);
    }
    if (maxSize >= 3) {
      const P = ranked.slice(0, 40);
      const b3 = [];
      for (let a = 0; a < P.length; a++)
        for (let b = a + 1; b < P.length; b++)
          for (let c = b + 1; c < P.length; c++) push(b3, [P[a], P[b], P[c]]);
      out[3] = finish(b3);
    }
    return out;
  }

  // ---------- Statistiques par vendeur ----------

  function sellerStats(ctx) {
    const { M, coverLists, cost, cheapest, cardIds, sellerIds } = ctx;
    const U = ctx.coverable.length || 1;
    const stats = [];
    for (let j = 0; j < M; j++) {
      const list = coverLists[j];
      if (!list.length) continue;
      let sum = 0;
      let ref = 0;
      let cheapestCount = 0;
      for (const i of list) {
        const p = cost[i * M + j];
        sum += p;
        ref += cheapest[i];
        if (p <= cheapest[i] + 0.005) cheapestCount++;
      }
      const coverage = list.length / U;
      const priceIndex = sum > 0 ? ref / sum : 1;
      stats.push({
        sellerId: sellerIds[j],
        covered: list.length,
        cards: list.map((i) => ({ cardId: cardIds[i], price: cost[i * M + j] })),
        cardsCost: round2(sum),
        cheapestCount,
        priceIndex: Math.round(priceIndex * 100) / 100,
        // Pertinence : 70 % couverture de la liste, 30 % compétitivité prix
        // (100 = le moins cher du marché sur toutes ses cartes).
        score: Math.round(100 * (0.7 * coverage + 0.3 * priceIndex)),
      });
    }
    stats.sort((a, b) => b.covered - a.covered || b.score - a.score || a.cardsCost - b.cardsCost);
    return stats;
  }

  // ---------- Point d'entrée ----------

  function solve(problem, opts = {}) {
    const ctx = createContext(problem);
    const unavailable = ctx.cardIds.filter((_, i) => ctx.cheapestSeller[i] < 0);
    const result = {
      cardCount: ctx.N,
      coverableCount: ctx.coverable.length,
      unavailable,
      sellerCount: ctx.coverLists.filter((l) => l.length).length,
      plans: null,
      combos: { 1: [], 2: [], 3: [] },
      sellers: [],
    };
    if (!ctx.coverable.length) return result;

    const cand = candidateSellers(ctx, opts.candidateLimit || 250);

    // 1. Référence : chaque carte chez son vendeur le moins cher, sans regarder le port.
    const baselineSet = [...new Set(ctx.coverable.map((i) => ctx.cheapestSeller[i]))];
    const baseline = describe(ctx, baselineSet);

    // 2. Coût total minimal (cartes + port + préférence « moins de commandes »).
    const cheapestSet = solveUFL(ctx, cand, ctx.orderPenalty);
    const cheapestPlan = describe(ctx, cheapestSet);

    // 3. Nombre de commandes minimal, puis coût minimal à nombre égal.
    const bigPenalty = 10 * (baseline.total + 100);
    let fewestSet = solveUFL(ctx, cand, bigPenalty);
    const exact = exactSmallCover(ctx, 2);
    if (exact && exact.length <= fewestSet.length) {
      const a = evaluate(ctx, exact, 0);
      const b = evaluate(ctx, fewestSet, 0);
      if (exact.length < fewestSet.length || a.total < b.total) fewestSet = exact;
    }
    const fewestPlan = describe(ctx, fewestSet);

    result.plans = { cheapest: cheapestPlan, fewest: fewestPlan, baseline };
    result.combos = topCombos(ctx, cand, { maxSize: opts.maxComboSize || 3, limit: opts.comboLimit || 25 });
    result.sellers = sellerStats(ctx);
    return result;
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  return { solve, createContext, evaluate, describe, shippingTier, DEFAULT_SHIPPING };
});
