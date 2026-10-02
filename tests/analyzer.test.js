const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('linkedom');
const cm = require('../src/cm.js');
const an = require('../src/analyzer.js');
const { DEFAULT_SETTINGS } = loadDefaults();

function loadDefaults() {
  // storage.js s'attache à globalThis.CMR (pas de module.exports) : on le charge tel quel.
  global.chrome = { storage: { local: {} } };
  require('../src/storage.js');
  return globalThis.CMR.store;
}

const settings = (over = {}) => ({
  ...DEFAULT_SETTINGS,
  languages: [],
  minCondition: 'EX',
  shipping: { ...DEFAULT_SETTINGS.shipping, domestic: 2, international: 3, trackedThreshold: 0 },
  ...over,
});

const sellers = {
  A: { name: 'A', countryCode: 'FR', type: 'professional', sales: 5000 },
  B: { name: 'B', countryCode: 'DE', type: 'private', sales: 12 },
  C: { name: 'C', countryCode: 'FR', type: 'private', sales: 300 },
};
const offer = (s, p, extra = {}) => ({ id: s + p, s, p, n: 1, c: 'NM', l: 2, f: {}, m: '', ...extra });
const dataset = {
  createdAt: 1,
  sellers,
  cards: {
    c1: { offers: [offer('A', 1), offer('B', 0.5), offer('C', 0.9, { c: 'PL' })] },
    c2: { offers: [offer('A', 2), offer('B', 1.2, { f: { reverseHolo: true } })] },
    c3: { offers: [offer('A', 1, { n: 1 }), offer('C', 0.4, { n: 3 })] },
  },
};
const cards = [
  { id: 'c1', key: 'k1', name: 'Carte 1' },
  { id: 'c2', key: 'k2', name: 'Carte 2' },
  { id: 'c3', key: 'k3', name: 'Carte 3', qty: 2 },
];

test('filtres client : état, reverse, quantité', () => {
  const r = an.computeResults(dataset, cards, settings());
  const info = r.cardInfo;
  assert.equal(info.c1.rejected.condition, 1); // C en PL
  assert.equal(info.c2.rejected.special, 1); // reverse exclu par défaut
  // c3 ×2 : A n'a qu'un exemplaire → seul C couvre la carte
  assert.deepEqual(Object.keys(r.detail.c3), ['C']);
  assert.equal(r.detail.c3.C[0].n, 2);
  assert.equal(info.c3.cheapest, 0.8);
});

test('sans plafond de surcoût : tout chez A + C plutôt que B pour 0,50 €', () => {
  const r = an.computeResults(dataset, cards, settings({ maxPremiumPct: null, maxPremiumAbs: null }));
  const plan = r.solved.plans.cheapest;
  assert.equal(plan.covered, 3);
  assert.deepEqual(plan.sellers.sort(), ['A', 'C']);
});

test('plafond de surcoût : jamais le double du moins cher en NM pour regrouper', () => {
  // c1 : B 0,50 € (le moins cher en NM) ; A 1,00 € = +100 % → refusé (plafond +10 % ou +0,30 €)
  const r = an.computeResults(dataset, cards, settings());
  assert.equal(r.cardInfo.c1.limit, 0.8);
  assert.equal(r.cardInfo.c1.rejected.premium, 1);
  assert.deepEqual(Object.keys(r.detail.c1), ['B']);
  const plan = r.solved.plans.cheapest;
  const c1 = plan.orders.flatMap((o) => o.cards.map((c) => [o.sellerId, c])).find(([, c]) => c.cardId === 'c1');
  assert.equal(c1[0], 'B');
  // « Toujours le moins cher » : aucun surcoût, seules les offres au prix minimum restent
  const strict = an.computeResults(dataset, cards, settings({ maxPremiumPct: 0, maxPremiumAbs: 0 }));
  for (const id of ['c1', 'c2', 'c3']) for (const seller of Object.keys(strict.detail[id])) assert.equal(strict.solved.sellers.find((s) => s.sellerId === seller) != null, true);
  assert.equal(an.premiumLimit(40, 1, { maxPremiumPct: 10, maxPremiumAbs: 0.3 }), 44);
  assert.equal(an.premiumLimit(0.05, 2, { maxPremiumPct: 10, maxPremiumAbs: 0.3 }), 0.65);
});

test('filtres vendeur : pays, ventes, exclusion', () => {
  const mine = an.computeResults(dataset, cards, settings({ countryMode: 'mine' }));
  assert.ok(!mine.solved.sellers.some((s) => s.sellerId === 'B'));
  const sales = an.computeResults(dataset, cards, settings({ minSales: 100 }));
  assert.ok(!sales.solved.sellers.some((s) => s.sellerId === 'B'));
  const excl = an.computeResults(dataset, cards, settings({ excludedSellers: ['a'] }));
  assert.ok(!excl.solved.sellers.some((s) => s.sellerId === 'A'));
  assert.deepEqual(excl.solved.unavailable, ['c2']);
});

test('réglage par carte prioritaire sur le défaut', () => {
  const withReverse = cards.map((c) => (c.id === 'c2' ? { ...c, special: 'any' } : c));
  const r = an.computeResults(dataset, withReverse, settings());
  assert.equal(r.cardInfo.c2.cheapest, 1.2);
});

test('saisie texte', () => {
  assert.deepEqual(an.parseTextLine('Pikachu | 025/165 | 151 | FR | NM | 2'), {
    name: 'Pikachu',
    number: '025/165',
    expansion: '151',
    languages: [2],
    minCondition: 'NM',
    qty: 2,
  });
  assert.equal(an.parseTextLine('3x Dracaufeu ex').qty, 3);
  assert.equal(an.parseTextLine('3x Dracaufeu ex').name, 'Dracaufeu ex');
  assert.equal(an.parseTextLine('# commentaire'), null);
  assert.equal(an.parseTextLine('Mew | | | Japonais').languages[0], 7);
});

test('recherche : choix automatique par numéro + extension', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'pokemon_list.html'), 'utf8');
  const rows = cm.parseSearchPage(new DOMParser().parseFromString(html, 'text/html'));
  const { auto } = an.rankCandidates(rows, { name: 'Machop', number: '79', expansion: 'Legendary Collection' });
  assert.equal(auto && auto.key, 'Pokemon/Products/Singles/Legendary-Collection/Machop-LC79');
  const vague = an.rankCandidates(rows, { name: 'M' });
  assert.equal(vague.auto, null);
});

test('lecture d’une carte : page produit + « Show more results » (pages enregistrées)', async () => {
  global.DOMParser = DOMParser;
  const read = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
  const calls = [];
  const fetcher = {
    count: 0,
    async getDoc(url) {
      calls.push('GET ' + url);
      return { doc: new DOMParser().parseFromString(read('pokemon_product.html'), 'text/html'), finalUrl: url };
    },
    async postForm(url, fields) {
      calls.push('POST ' + url + ' page=' + fields.page + ' idProduct=' + fields.idProduct);
      return { text: read('pokemon_product_load_more.xml') };
    },
  };
  const memStore = { async getCache() {}, async putCache() {}, async pruneCache() {} };
  const analysis = new an.Analysis({ settings: settings({ pagesPerCard: 3 }), fetcher, store: memStore });
  const card = { id: 'x', key: 'Pokemon/Products/Singles/Legendary-Collection/Snorlax-LC64', qty: 1 };
  const r = await analysis.fetchCard(card);
  assert.equal(r.card.offers.length, 79); // 50 + 29
  assert.equal(r.card.complete, true);
  assert.equal(r.card.product.name, 'Snorlax (LC 64)');
  assert.ok(r.sellers.Lajski && r.sellers.Lajski.countryCode === 'DK');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^POST https:\/\/www\.cardmarket\.com\/en\/Pokemon\/AjaxAction\/Product_LoadMoreArticles page=1 idProduct=274829$/);
});

test('numéros normalisés', () => {
  assert.equal(an.normNumber('025/165'), '25');
  assert.equal(an.normNumber('SVP 012'), 'svp12');
  assert.equal(an.normNumber('LC 64'), 'lc64');
});
