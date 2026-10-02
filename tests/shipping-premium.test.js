// Port réel lu au panier, frais appris par pays, plafond de surcoût.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('linkedom');
const cm = require('../src/cm.js');
const an = require('../src/analyzer.js');
const { solve } = require('../src/optimizer.js');

test('page panier : valeur, port et total par vendeur, sans confondre les lignes', () => {
  const html = `<!doctype html><html><body>
    <section class="shipment-block"><div><h3>Seller <a href="/en/Pokemon/Users/Alpha">Alpha</a></h3></div>
      <table id="ArticleTableAlpha"><tr data-article-id="11" data-amount="1" data-price="3.2"><td>1x</td></tr></table>
      <div class="summary"><div class="d-flex"><span>Article value</span><span class="item-value">3,20 €</span></div>
      <div class="d-flex"><span>Shipping costs</span><span>1,35 €</span></div><div class="d-flex"><span>Total</span><span>4,55 €</span></div></div></section>
    <section class="shipment-block"><div><h3><a href="/en/Pokemon/Users/Beta">Beta</a></h3></div>
      <div class="d-flex"><span>Article value</span><span class="item-value">30,00 €</span></div>
      <div class="d-flex"><span>Shipping costs</span><span>4,90 €</span></div></section>
  </body></html>`;
  const cart = cm.parseCartPage(new DOMParser().parseFromString(html, 'text/html'));
  assert.equal(cart.blocks, 2);
  assert.deepEqual(cart.sellers[0], { name: 'Alpha', articles: 1, value: 3.2, shipping: 1.35, total: 4.55 });
  assert.equal(cart.sellers[1].shipping, 4.9);
  assert.equal(cart.sellers[1].total, null);
  // Sans « Article value » lisible : valeur recalculée depuis les lignes data-amount × data-price
  const rows = cm.parseCartPage(
    new DOMParser().parseFromString(
      '<section class="shipment-block"><a href="/en/Pokemon/Users/G">G</a><table><tr data-amount="2" data-price="1.5"></tr><tr data-amount="1" data-price="4"></tr></table></section>',
      'text/html'
    )
  );
  assert.deepEqual([rows.sellers[0].articles, rows.sellers[0].value], [3, 7]);
  const empty = cm.parseCartPage(new DOMParser().parseFromString('<html><body><p>Your cart is empty</p></body></html>', 'text/html'));
  assert.deepEqual(empty, { blocks: 0, sellers: [] });
});

test('frais appris : moyenne par pays, prioritaire sur l’estimation', () => {
  const learned = an.learnedShipping({ DE: { letter: { sum: 3.6, n: 2 } }, FR: { tracked: { sum: 4.2, n: 1 } } });
  assert.deepEqual(learned, { DE: { letter: 1.8, tracked: null, insured: null }, FR: { letter: null, tracked: 4.2, insured: null } });
  const shipping = { buyerCountry: 'FR', domestic: 2, international: 3, trackedThreshold: 25, trackedDomestic: 5, trackedInternational: 8, learned };
  const r = solve({
    cards: [{ id: 'a' }, { id: 'b' }],
    sellers: [
      { id: 'DE1', country: 'DE' },
      { id: 'FR1', country: 'FR' },
    ],
    costs: { a: { DE1: 1 }, b: { FR1: 30 } },
    shipping,
  });
  const byId = Object.fromEntries(r.plans.cheapest.orders.map((o) => [o.sellerId, o.shipCost]));
  assert.equal(byId.DE1, 1.8); // lettre DE apprise (au lieu de 3 € estimés)
  assert.equal(byId.FR1, 4.2); // suivi FR appris (au lieu de 5 €)
});

test('plafond de surcoût : pourcentage pour les cartes chères, montant fixe pour les petites', () => {
  const s = { maxPremiumPct: 10, maxPremiumAbs: 0.3 };
  assert.equal(an.premiumLimit(40, 1, s), 44); // +10 %
  assert.equal(an.premiumLimit(0.1, 1, s), 0.4); // +0,30 €
  assert.equal(an.premiumLimit(2, 3, s), 2.9); // 3 exemplaires : +0,30 € chacun
  assert.equal(an.premiumLimit(5, 1, { maxPremiumPct: 0, maxPremiumAbs: 0 }), 5); // toujours la moins chère
  assert.equal(an.premiumLimit(5, 1, {}), Infinity); // anciens réglages : pas de plafond
});

test('port en 3 paliers : lettre, suivi dès 25 €, recommandé / assuré dès 100 €', () => {
  const { shippingTier } = require('../src/optimizer.js');
  const cfg = { trackedThreshold: 25, insuredThreshold: 100 };
  assert.equal(shippingTier(cfg, 12), 'letter');
  assert.equal(shippingTier(cfg, 25), 'tracked');
  assert.equal(shippingTier(cfg, 99.99), 'tracked');
  assert.equal(shippingTier(cfg, 140), 'insured');
  assert.equal(shippingTier({ trackedThreshold: 0, insuredThreshold: 0 }, 500), 'letter');
  // Une commande de 150 € depuis l'Allemagne : envoi assuré international (12 € par défaut), pas 2,20 €
  const r = solve({ cards: [{ id: 'x' }], sellers: [{ id: 'DE1', country: 'DE' }], costs: { x: { DE1: 150 } }, shipping: { buyerCountry: 'FR' } });
  assert.equal(r.plans.cheapest.shipCost, 12);
});

test('réglages enregistrés avant la v3 : français seul → français + japonais, anciens ports relevés', () => {
  global.chrome = { storage: { local: {} } };
  require('../src/storage.js');
  const { mergeSettings } = globalThis.CMR.store;
  const s = mergeSettings({ settingsVersion: 2, languages: [2], shipping: { domestic: 1.5, trackedDomestic: 4.0, international: 3.1 } });
  assert.deepEqual(s.languages, [2, 7]);
  assert.equal(s.shipping.domestic, 1.6);
  assert.equal(s.shipping.trackedDomestic, 3.5);
  assert.equal(s.shipping.international, 3.1); // valeur changée par l'utilisateur : conservée
  assert.equal(s.shipping.insuredInternational, 12);
  assert.deepEqual(mergeSettings({ settingsVersion: 2, languages: [1] }).languages, [1]); // choix perso conservé
});
