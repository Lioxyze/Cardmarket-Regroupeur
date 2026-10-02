// Parseurs Cardmarket testés sur de vraies pages enregistrées (voir tests/fixtures/README.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('linkedom');
const cm = require('../src/cm.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const doc = (name) => new DOMParser().parseFromString(fixture(name), 'text/html');

test('page produit : infos de la carte', () => {
  const { product } = cm.parseProductPage(doc('pokemon_product.html'));
  assert.equal(product.name, 'Snorlax (LC 64)');
  assert.equal(product.expansion, 'Legendary Collection');
  assert.equal(product.number, '64');
  assert.equal(product.rarity, 'Uncommon');
  assert.equal(product.idProduct, 274829);
  assert.equal(product.trend, 6.47);
  assert.equal(product.available, 81);
});

test('page produit : offres, vendeurs, pays, type, état, langue', () => {
  const { offers, loadMore } = cm.parseProductPage(doc('pokemon_product.html'));
  assert.equal(offers.length, 50);
  const first = offers[0];
  assert.equal(first.id, '2116752350');
  assert.equal(first.seller.name, 'Lajski');
  assert.equal(first.seller.country, 'Denmark');
  assert.equal(first.seller.countryCode, 'DK');
  assert.equal(first.seller.type, 'professional');
  assert.equal(first.seller.sales, 2130);
  assert.equal(first.seller.available, 5138);
  assert.equal(first.condition, 'PL');
  assert.equal(first.languageId, 1);
  assert.equal(first.price, 1.95);
  assert.equal(first.count, 3);
  assert.equal(first.comment, ':-)');
  for (const o of offers) {
    assert.ok(o.seller && o.seller.name, 'chaque offre a un vendeur');
    assert.ok(o.price > 0);
    assert.ok(cm.CONDITIONS.some((c) => c.code === o.condition), `état lu : ${o.condition}`);
  }
  // Formulaire « Show more results »
  assert.equal(loadMore.idProduct, '274829');
  assert.equal(loadMore.page, '1');
  assert.ok(loadMore.__cmtkn.length > 20);
});

test('réponse « Show more results » (XML base64)', () => {
  const r = cm.parseLoadMoreXml(fixture('pokemon_product_load_more.xml'));
  assert.equal(r.nextPage, null);
  assert.equal(r.capped, false);
  const rows = cm.parseOfferRows(new DOMParser().parseFromString(`<div>${r.html}</div>`, 'text/html'));
  assert.equal(rows.length, 29);
  assert.ok(rows.every((o) => o.seller && o.price > 0));
});

test('réponse « Show more results » refusée → erreur explicite', () => {
  assert.throws(() => cm.parseLoadMoreXml('<ajaxResponse><error>1</error></ajaxResponse>'), /LOAD_MORE|inattendue/);
});

test('stock d’un vendeur : produit lu à la place du vendeur', () => {
  const offers = cm.parseOfferRows(doc('magic_user_offers.html'));
  assert.equal(offers.length, 20);
  const o = offers[0];
  assert.equal(o.seller, null);
  assert.equal(o.productKey, 'Magic/Products/Singles/Unfinity/Brims-Barone-Midway-Mobster');
  assert.equal(o.condition, 'NM');
  assert.equal(o.languageId, 1);
  assert.equal(o.price, 0.02);
});

test('liste / recherche de produits', () => {
  const rows = cm.parseSearchPage(doc('pokemon_list.html'));
  assert.equal(rows.length, 100);
  assert.deepEqual(rows[0], {
    key: 'Pokemon/Products/Singles/Legendary-Collection/Machop-LC79',
    image: 'https://product-images.s3.cardmarket.com/51/LC/274844/274844.jpg',
    name: 'Machop (LC 79)',
    expansion: 'Legendary Collection',
    number: '79',
    from: 0.1,
    available: 235,
  });
});

test('URL : clé produit, filtres serveur', () => {
  assert.equal(
    cm.productKey('https://www.cardmarket.com/fr/Pokemon/Products/Singles/Scarlet-Violet-151/Pikachu-MEW025?language=2'),
    'Pokemon/Products/Singles/Scarlet-Violet-151/Pikachu-MEW025'
  );
  assert.equal(cm.productKey('https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=x'), null);
  assert.equal(cm.productKey('https://example.com/fr/Pokemon/Products/Singles/A/B'), null);
  const url = cm.productFetchUrl('Pokemon/Products/Singles/Scarlet-Violet-151/Pikachu-MEW025', {
    languages: [7, 2],
    minCondition: 'NM',
    sellerTypes: ['professional', 'powerseller'],
    sellerCountries: ['FR', 'DE'],
    special: 'exclude',
  });
  const u = new URL(url);
  assert.equal(u.pathname, '/en/Pokemon/Products/Singles/Scarlet-Violet-151/Pikachu-MEW025');
  assert.equal(u.searchParams.get('language'), '2,7');
  assert.equal(u.searchParams.get('minCondition'), '2');
  assert.equal(u.searchParams.get('sellerType'), '1,2');
  assert.equal(u.searchParams.get('sellerCountry'), '7,12');
  assert.equal(u.searchParams.get('isReverseHolo'), 'N');
});

test('prix : formats européen et anglais', () => {
  assert.equal(cm.parsePrice('1,95 €'), 1.95);
  assert.equal(cm.parsePrice('1.234,56 €'), 1234.56);
  assert.equal(cm.parsePrice('12.50'), 12.5);
  assert.equal(cm.parsePrice('1.234 €'), 1234);
  assert.equal(cm.parsePrice('N/A'), null);
});

test('détection de la page Cloudflare', () => {
  assert.ok(cm.isChallenge(403, '<html><head><title>Just a moment...</title>'));
  assert.ok(cm.isChallenge(200, '<title>Un instant…</title>'));
  assert.ok(!cm.isChallenge(200, fixture('pokemon_product.html')));
});

test('nom simplifié pour chercher dans un stock vendeur', () => {
  assert.equal(cm.searchableName('Snorlax  (LC 64)'), 'Snorlax');
  assert.equal(cm.searchableName('Pikachu ex'), 'Pikachu ex');
});
