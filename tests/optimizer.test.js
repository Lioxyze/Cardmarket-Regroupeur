// Lancer : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { solve, createContext, evaluate } = require('../src/optimizer.js');

const SHIP = {
  buyerCountry: 'FR',
  domestic: 2,
  international: 3,
  trackedThreshold: 0,
  trackedDomestic: 5,
  trackedInternational: 8,
};

function problem(costs, sellers, extra = {}) {
  const cardIds = Object.keys(costs);
  return {
    cards: cardIds.map((id) => ({ id })),
    sellers: sellers.map((s) => (typeof s === 'string' ? { id: s, country: 'FR' } : s)),
    costs,
    shipping: SHIP,
    ...extra,
  };
}

test('préfère payer une carte un peu plus cher plutôt que d’ajouter une commande', () => {
  const r = solve(
    problem(
      {
        c1: { A: 1.0, B: 0.8 },
        c2: { A: 1.0 },
        c3: { A: 1.0 },
      },
      ['A', 'B']
    )
  );
  // Référence « chaque carte au moins cher » : A + B = 2.8 + 4 de port
  assert.equal(r.plans.baseline.orders.length, 2);
  assert.equal(r.plans.baseline.total, 6.8);
  // Optimal : tout chez A = 3 + 2 de port
  assert.deepEqual(r.plans.cheapest.sellers, ['A']);
  assert.equal(r.plans.cheapest.total, 5);
});

test('accepte deux commandes quand l’écart de prix dépasse le port', () => {
  const r = solve(
    problem(
      {
        c1: { A: 10, B: 1 },
        c2: { A: 1 },
      },
      ['A', 'B']
    )
  );
  assert.deepEqual(r.plans.cheapest.sellers.sort(), ['A', 'B']);
  assert.equal(r.plans.cheapest.total, 6);
  assert.deepEqual(r.plans.fewest.sellers, ['A']);
});

test('signale les cartes introuvables sans bloquer le reste', () => {
  const r = solve(problem({ c1: { A: 1 }, c2: {}, c3: { B: 1 } }, ['A', 'B']));
  assert.deepEqual(r.unavailable, ['c2']);
  assert.equal(r.coverableCount, 2);
  assert.equal(r.plans.cheapest.covered, 2);
  assert.equal(r.plans.cheapest.missing.length, 0);
});

test('le port international et le seuil d’envoi suivi sont appliqués', () => {
  const p = problem({ c1: { DE: 1 }, c2: { DE: 30 } }, [{ id: 'DE', country: 'DE' }]);
  p.shipping = { ...SHIP, trackedThreshold: 25 };
  const r = solve(p);
  assert.equal(r.plans.cheapest.shipCost, 8); // 31 € ≥ 25 € → suivi international
});

test('la pénalité par commande pousse vers moins de vendeurs', () => {
  const costs = { c1: { A: 5, B: 1 }, c2: { A: 1 } };
  const sans = solve(problem(costs, ['A', 'B']));
  const avec = solve(problem(costs, ['A', 'B'], { orderPenalty: 5 }));
  assert.equal(sans.plans.cheapest.sellers.length, 2);
  assert.equal(avec.plans.cheapest.sellers.length, 1);
  // La pénalité n'apparaît pas dans le total affiché
  assert.equal(avec.plans.cheapest.total, 8);
});

test('combinaisons : classées par couverture puis coût, sans vendeur inutile', () => {
  const r = solve(
    problem(
      {
        c1: { A: 1, B: 1 },
        c2: { A: 1, C: 1 },
        c3: { B: 1, C: 1 },
        c4: { C: 1 },
      },
      ['A', 'B', 'C']
    )
  );
  assert.deepEqual(r.combos[1][0].sellers, ['C']);
  assert.equal(r.combos[1][0].covered, 3);
  assert.equal(r.combos[2][0].covered, 4);
  for (const combo of r.combos[2]) assert.equal(combo.orders.length, 2);
});

test('statistiques vendeur : couverture et score', () => {
  const r = solve(problem({ c1: { A: 1, B: 2 }, c2: { A: 1 } }, ['A', 'B']));
  const a = r.sellers.find((s) => s.sellerId === 'A');
  const b = r.sellers.find((s) => s.sellerId === 'B');
  assert.equal(a.covered, 2);
  assert.equal(a.score, 100);
  assert.equal(b.covered, 1);
  assert.ok(b.score < a.score);
});

// Graine fixe pour des tests reproductibles.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('la recherche locale trouve l’optimum exact sur 200 petits cas aléatoires', () => {
  const rand = rng(42);
  let worst = 0;
  for (let t = 0; t < 200; t++) {
    const M = 3 + Math.floor(rand() * 8);
    const N = 3 + Math.floor(rand() * 10);
    const sellers = Array.from({ length: M }, (_, j) => ({ id: 's' + j, country: rand() < 0.6 ? 'FR' : 'DE' }));
    const costs = {};
    for (let i = 0; i < N; i++) {
      costs['c' + i] = {};
      for (let j = 0; j < M; j++) if (rand() < 0.45) costs['c' + i]['s' + j] = Math.round(rand() * 800) / 100 + 0.02;
    }
    const p = { cards: Object.keys(costs).map((id) => ({ id })), sellers, costs, shipping: { ...SHIP, trackedThreshold: 12 } };
    const r = solve(p);
    if (!r.plans) continue;

    // Force brute sur tous les sous-ensembles de vendeurs.
    const ctx = createContext(p);
    let opt = Infinity;
    for (let mask = 1; mask < 1 << M; mask++) {
      const S = [];
      for (let j = 0; j < M; j++) if (mask & (1 << j)) S.push(j);
      const e = evaluate(ctx, S, 0);
      if (e.uncovered === 0) opt = Math.min(opt, e.total);
    }
    worst = Math.max(worst, r.plans.cheapest.total - opt);
    assert.ok(r.plans.cheapest.total <= r.plans.baseline.total + 1e-9, 'jamais pire que la référence');
  }
  assert.ok(worst < 0.011, `écart max à l’optimum : ${worst}`);
});

test('tient la charge : 40 cartes × 1500 vendeurs en moins de 5 s', () => {
  const rand = rng(7);
  const N = 40;
  const M = 1500;
  const sellers = Array.from({ length: M }, (_, j) => ({ id: 's' + j, country: rand() < 0.3 ? 'FR' : 'DE' }));
  const costs = {};
  for (let i = 0; i < N; i++) {
    costs['c' + i] = {};
    for (let n = 0; n < 50; n++) costs['c' + i]['s' + Math.floor(rand() * M)] = Math.round(rand() * 300) / 100 + 0.02;
  }
  // Quelques gros vendeurs qui ont beaucoup de cartes de la liste
  for (let g = 0; g < 5; g++)
    for (let i = 0; i < N; i++) if (rand() < 0.7) costs['c' + i]['s' + g] = Math.round(rand() * 400) / 100 + 0.1;
  const t0 = Date.now();
  const r = solve({ cards: Object.keys(costs).map((id) => ({ id })), sellers, costs, shipping: SHIP });
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `${ms} ms`);
  assert.equal(r.plans.cheapest.missing.length, 0);
  assert.ok(r.plans.cheapest.total <= r.plans.baseline.total);
});
