// Cartes gradées (PSA…), produits scellés et reconstruction des requêtes panier.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('linkedom');
const cm = require('../src/cm.js');
const an = require('../src/analyzer.js');
const cart = require('../src/cart.js');

global.chrome = { storage: { local: {} } };
require('../src/storage.js');
const { DEFAULT_SETTINGS } = globalThis.CMR.store;
global.DOMParser = DOMParser;

const doc = (html) => new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');

test('gradées : détection dans le commentaire du vendeur', () => {
  const cases = {
    'PSA 10': { company: 'PSA', grade: 10 },
    'psa10 gem mint': { company: 'PSA', grade: 10 },
    'PSA GEM MINT 10': { company: 'PSA', grade: 10 },
    'CGC 9.5 pristine': { company: 'CGC', grade: 9.5 },
    'BGS 9,5': { company: 'BGS', grade: 9.5 },
    'Carte gradée PCA 9': { company: 'PCA', grade: 9 },
    'slabbed card': { company: 'Autre', grade: null },
  };
  for (const [comment, expected] of Object.entries(cases)) assert.deepEqual(cm.detectGrading(comment), expected, comment);
  // Cartes loose présentées comme « bonnes pour le grading »
  for (const comment of ['PSA ready!', 'Perfect for PSA', 'candidate PSA 10', 'PSA 10 candidate', 'parfaite pour grading', 'non gradée', 'ungraded', 'cgc potential', 'Pokemon Center', ''])
    assert.equal(cm.detectGrading(comment), null, comment);
  assert.equal(cm.gradingLabel({ company: 'CGC', grade: 9.5 }), 'CGC 9,5');
});

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, languages: [], minCondition: 'NM', shipping: { ...DEFAULT_SETTINGS.shipping, trackedThreshold: 0 }, ...over });
const sellers = { A: { countryCode: 'FR', type: 'private', sales: 10 }, B: { countryCode: 'FR', type: 'professional', sales: 900 }, C: { countryCode: 'FR', type: 'private', sales: 10 } };
const key = 'Pokemon/Products/Singles/151/Mew-ex-MEW151';
const o = (s, p, m, c = 'NM') => ({ id: s + p, s, p, n: 1, c, l: 2, f: {}, m });
const ds = {
  createdAt: 1,
  sellers,
  cards: { m: { offers: [o('A', 2, 'PSA ready'), o('B', 60, 'PSA 10'), o('C', 25, 'CGC 9', 'EX'), o('B', 30, 'PSA 9')] } },
};

test('loose uniquement par défaut : les gradées sont écartées', () => {
  const r = an.computeResults(ds, [{ id: 'm', key }], settings());
  assert.equal(r.cardInfo.m.cheapest, 2);
  assert.equal(r.cardInfo.m.rejected.graded, 3);
});

test('gradée uniquement : société et note minimum', () => {
  const psa10 = an.computeResults(ds, [{ id: 'm', key, graded: 'only', gradeCompany: 'PSA', minGrade: 10 }], settings());
  assert.equal(psa10.cardInfo.m.cheapest, 60);
  const any9 = an.computeResults(ds, [{ id: 'm', key, graded: 'only', minGrade: 9 }], settings());
  // CGC 9 en « EX » reste acceptée : l'état ne compte pas pour une carte gradée
  assert.equal(any9.cardInfo.m.cheapest, 25);
  assert.equal(any9.detail.m.C[0].g, 'CGC 9');
});

test('coffrets : ni état, ni version, ni gradation ; pas de minCondition envoyé', () => {
  const etb = 'Pokemon/Products/Sealed-Products/151/Elite-Trainer-Box';
  assert.equal(cm.productKind(etb), 'sealed');
  assert.equal(cm.productKind(key), 'single');
  const f = an.effectiveFilters({ key: etb }, settings({ minCondition: 'MT', special: 'exclude' }));
  assert.equal(f.graded, 'any');
  assert.equal(f.minCondition, 'PO');
  const url = new URL(cm.productFetchUrl(etb, an.serverFilters({ key: etb }, settings({ minCondition: 'MT' }))));
  assert.equal(url.searchParams.get('minCondition'), null);
  const sealed = { createdAt: 1, sellers, cards: { e: { offers: [{ id: 'x', s: 'A', p: 60, n: 1, c: null, l: 2, f: {}, m: 'PSA' }] } } };
  assert.equal(an.computeResults(sealed, [{ id: 'e', key: etb }], settings()).cardInfo.e.cheapest, 60);
});

test('recherche : URL par catégorie et filtrage cartes / scellé', () => {
  const u = new URL(cm.searchUrl('Pokemon', '151', 'fr', 'sealed'));
  assert.equal(u.pathname, '/fr/Pokemon/Products/Search');
  assert.equal(u.searchParams.get('category'), '4');
  const list = [{ key, name: 'Mew ex', expansion: '' }, { key: 'Pokemon/Products/Sealed-Products/151/ETB', name: '151 ETB', expansion: '' }];
  assert.deepEqual(an.rankCandidates(list, { name: '151' }, 'sealed').candidates.map((c) => c.key), ['Pokemon/Products/Sealed-Products/151/ETB']);
  assert.deepEqual(an.rankCandidates(list, { name: 'Mew' }, 'singles').candidates.map((c) => c.key), [key]);
});

// ---------- Panier ----------

const PAGE = 'https://www.cardmarket.com/en/Pokemon/Products/Singles/151/Mew-ex-MEW151';

test('panier : formulaire dans la ligne (action AJAX)', () => {
  const d = doc(`<div id="articleRow42" class="article-row"><div class="col-offer"><div class="actions-container">
    <form method="POST" data-ajax-action="ShoppingCart_AddArticle"><input type="hidden" name="__cmtkn" value="tok"><input type="hidden" name="idArticle" value="42">
    <select name="amount"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select><button type="submit">+</button></form></div></div></div>`);
  const r = cm.cartRequest(d, 42, 2, PAGE);
  assert.equal(r.url, 'https://www.cardmarket.com/en/Pokemon/AjaxAction/ShoppingCart_AddArticle');
  assert.equal(r.ajax, true);
  assert.deepEqual(r.fields, [['__cmtkn', 'tok'], ['idArticle', '42'], ['amount', '2']]);
  // Quantité demandée > stock : on prend le maximum proposé
  assert.deepEqual(cm.cartRequest(d, 42, 7, PAGE).fields.find(([n]) => n === 'amount'), ['amount', '3']);
});

test('panier : formulaire commun de la page (cases à cocher « BuyAllForm »)', () => {
  const d = doc(`
    <div id="stockRow7" class="article-row"><input type="checkbox" name="idArticle[7]" form="BuyAllForm"><div class="col-offer"><select name="amount[7]" form="BuyAllForm"><option value="1">1</option><option value="2">2</option></select></div></div>
    <div id="stockRow8" class="article-row"><input type="checkbox" name="idArticle[8]" form="BuyAllForm"><div class="col-offer"><select name="amount[8]" form="BuyAllForm"><option value="1">1</option></select></div></div>
    <form id="BuyAllForm" method="POST" action="/en/Pokemon/PostGetAction/ShoppingCart_AddArticles"><input type="hidden" name="__cmtkn" value="tok"></form>`);
  const r = cm.cartRequest(d, 7, 2, 'https://www.cardmarket.com/en/Pokemon/Users/X/Offers/Singles?name=Mew');
  assert.equal(r.url, 'https://www.cardmarket.com/en/Pokemon/PostGetAction/ShoppingCart_AddArticles');
  assert.equal(r.ajax, false);
  // Seule l'offre 7 est envoyée, jamais celles des autres lignes
  assert.deepEqual(r.fields, [['__cmtkn', 'tok'], ['idArticle[7]', 'on'], ['amount[7]', '2']]);
});

test('panier : non connecté, offre disparue, formulaire inconnu', () => {
  const loggedOut = doc(`<form id="header-login" action="/en/Pokemon/PostGetAction/User_Login"></form>
    <div id="articleRow5" class="article-row"><div class="col-offer"><a href="/en/Pokemon/Login?x"><span class="fonticon-cart"></span></a></div></div>`);
  assert.equal(cm.cartRequest(loggedOut, 5, 1, PAGE).error, 'LOGIN');
  assert.equal(cm.cartRequest(doc('<div id="articleRow1" class="article-row"></div>'), 99, 1, PAGE).error, 'NOT_FOUND');
  const odd = doc('<div id="articleRow3" class="article-row"><div class="col-offer"><button onclick="x()">+</button></div></div>');
  assert.equal(cm.cartRequest(odd, 3, 1, PAGE).error, 'NO_FORM');
  assert.match(cm.cartDiagnostic(odd, 3), /onclick/);
});

test('panier : ajout, remplacement d’une offre vendue, vérification du panier', async () => {
  const row = (id, price, cond = 'NM') => `<div id="stockRow${id}" class="article-row"><div class="col-seller"><a href="/en/${key}">Mew ex</a></div>
    <div class="product-attributes"><a class="article-condition"><span class="badge">${cond}</span></a><span title="French" class="icon"></span></div>
    <div class="col-offer"><div class="price-container"><span class="color-primary">${price} €</span></div><span class="item-count">1</span>
    <form method="POST" data-ajax-action="ShoppingCart_AddArticle"><input type="hidden" name="idArticle" value="${id}"><select name="amount"><option value="1">1</option></select></form></div></div>`;
  // L'offre 100 a été vendue ; le vendeur en a une autre (101) au même prix, et une abîmée (102).
  const stock = `<!doctype html><html><body>${row(101, '2,10')}${row(102, '1,50', 'PL')}</body></html>`;
  const posted = [];
  const fetcher = {
    async getDoc(url) {
      return { doc: new DOMParser().parseFromString(url.includes('/Users/') ? stock : '<html><body></body></html>', 'text/html'), finalUrl: url };
    },
    async postFields(url, fields) {
      posted.push(fields);
      return { url, text: '<ajaxResponse/>' };
    },
    async request() {
      return { text: '<table><tr data-article-id="101"></tr></table>' };
    },
  };
  const items = [{ card: { id: 'm', key, name: 'Mew ex (MEW 151)' }, seller: 'X', productName: 'Mew ex (MEW 151)', take: [{ id: 100, n: 1, p: 2 }] }];
  const out = await cart.addToCart(items, { fetcher, settings: settings() });
  assert.equal(out.loginRequired, false);
  assert.equal(out.cartChecked, true);
  assert.equal(out.results[0].status, 'replaced');
  assert.equal(out.results[0].articleId, '101');
  assert.equal(out.results[0].inCart, true);
  assert.deepEqual(posted[0].find(([n]) => n === 'idArticle'), ['idArticle', '101']);
});
