// Vinted : recherche dans un dressing, lecture des vignettes, adresse du lot.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/vinted.js');

const item = (id, title, price, extra) => Object.assign({ id: String(id), title, price, brand: 'Pokémon' }, extra);
const DRESSING = [
  item(1, 'Carapuce', 4.99),
  item(2, 'Carapuce – 012/059', 7.99),
  item(3, 'Carapuce – 012/059', 6.5),
  item(4, 'Salamèche – 015/090', 2.59),
  item(5, 'Morpheo Forme Solaire – 067/064', 3.59),
  item(6, 'Zébibron – 072/066', 3.99),
  item(7, 'Carte Pokémon Tokotoro 065/64 SV6a JP – Illustration rare', 12),
  item(8, 'Dracaufeu ex 006/165', 45),
  item(9, 'Carabaffe 166/165', 9),
];
const ids = (list) => list.map((it) => it.id);

test('recherche : accents, casse et ponctuation ignorés', () => {
  assert.deepEqual(ids(V.searchItems(DRESSING, 'salameche')), ['4']);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'ZEBIBRON')), ['6']);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'morphéo solaire')), ['5']);
});

test('recherche : plusieurs annonces de la même carte, la moins chère d’abord', () => {
  assert.deepEqual(ids(V.searchItems(DRESSING, 'carapuce 012')), ['3', '2']);
  // « carapuce » seul : les trois annonces, par prix
  assert.deepEqual(ids(V.searchItems(DRESSING, 'carapuce')), ['1', '3', '2']);
});

test('recherche : numéros avec ou sans zéros, numéro exact avant numéro contenu', () => {
  assert.deepEqual(ids(V.searchItems(DRESSING, '67')), ['5']);
  assert.deepEqual(ids(V.searchItems(DRESSING, '067/064')), ['5']);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'tokotoro 065')), ['7']);
  assert.deepEqual(ids(V.searchItems(DRESSING, '66')), ['6', '9']); // 066 exact, puis 166 qui le contient
});

test('recherche : début de mot et faute de frappe', () => {
  assert.deepEqual(ids(V.searchItems(DRESSING, 'draca')), ['8']);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'dracaufeux')), ['8']);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'salamche')), ['4']);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'dracofeu')), []); // deux fautes : trop loin
  assert.deepEqual(ids(V.searchItems(DRESSING, 'pikachu')), []);
});

test('recherche : tri par prix et recherche vide', () => {
  assert.equal(V.searchItems(DRESSING, '').length, DRESSING.length);
  assert.deepEqual(ids(V.searchItems(DRESSING, 'carapuce', { sort: 'price-desc' })), ['2', '3', '1']);
  assert.equal(V.searchItems(DRESSING, '', { sort: 'price' })[0].id, '4');
});

test('liste collée : une recherche par ligne, repli sur le nom seul', () => {
  const groups = V.searchList(DRESSING, '065 — Tokotoro\n\n- Carapuce 012\nHoundoom (SFA 066)\nSalamèche 999\n2x Zébibron');
  assert.deepEqual(
    groups.map((g) => g.line),
    ['065 — Tokotoro', 'Carapuce 012', 'Houndoom (SFA 066)', 'Salamèche 999', 'Zébibron']
  );
  assert.deepEqual(ids(groups[0].results), ['7']);
  assert.deepEqual(ids(groups[1].results), ['3', '2']);
  assert.equal(groups[2].results.length, 0); // nom anglais : introuvable, et pas de faux résultat sur le seul numéro
  assert.deepEqual(ids(groups[3].results), ['4']);
  assert.equal(groups[3].approx, true);
  assert.deepEqual(ids(groups[4].results), ['6']);
});

test('vignette : nom de l’annonce tiré du texte de l’image', () => {
  assert.equal(V.cardTitleFromAlt('Carapuce – 012/059, marque: Pokémon, état: Très bon état, 4,99 €, 5,94 € Protection acheteurs (Pro) incluse'), 'Carapuce – 012/059');
  assert.equal(V.cardTitleFromAlt('Lot de 3 cartes, holo, rares, état: Bon état, 3,00 €, 3,85 € Protection acheteurs incluse'), 'Lot de 3 cartes, holo, rares');
  assert.equal(V.cardTitleFromAlt('Robe, taille: M, 12,00 €'), 'Robe');
  assert.equal(V.cardTitleFromAlt('Carte seule, 1 234,00 €, 1 296,40 € Protection acheteurs incluse'), 'Carte seule');
  assert.equal(V.cardTitleFromAlt(''), '');
});

test('prix : lecture et affichage', () => {
  assert.equal(V.parseEuro('4,99 €'), 4.99);
  assert.equal(V.parseEuro('à partir de 2,83 €'), 2.83);
  assert.equal(V.parseEuro('1 234,50 €'), 1234.5);
  assert.equal(V.parseEuro('12 €'), 12);
  assert.equal(V.parseEuro(''), null);
  assert.equal(V.euro(8.77).replace(/\s/g, ' '), '8,77 €');
});

test('pages Vinted reconnues', () => {
  assert.deepEqual(V.pageContext('/member/69887319'), { kind: 'member', sellerId: '69887319' });
  assert.deepEqual(V.pageContext('/member/69887319-pok-investt'), { kind: 'member', sellerId: '69887319' });
  assert.deepEqual(V.pageContext('/member/69887319/bundles/new'), { kind: 'bundle', sellerId: '69887319' });
  assert.deepEqual(V.pageContext('/items/10215621813-morpheo'), { kind: 'item', itemId: '10215621813' });
  assert.equal(V.pageContext('/member/signup/select_type').kind, 'other');
  assert.equal(V.pageContext('/catalog').kind, 'other');
  assert.equal(V.pageContext('/').kind, 'home');
});

test('lot : adresse préremplie et estimation', () => {
  assert.equal(V.bundleUrl('69887319', ['10215621813', '10214798845']), '/member/69887319/bundles/new?item_ids[]=10215621813&item_ids[]=10214798845');
  assert.equal(V.bundleUrl('69887319', []), '/member/69887319/bundles/new');
  // Vérifié sur Vinted : 3,59 + 3,99 = 7,58 € → 8,66 € avec protection acheteurs
  assert.deepEqual(V.bundleEstimate([3.59, 3.99], 2.83), { items: 7.58, withFee: 8.66, total: 11.49 });
  assert.deepEqual(V.bundleEstimate([4.99], null), { items: 4.99, withFee: 5.94, total: null });
  assert.deepEqual(V.bundleEstimate([], 2.83), { items: 0, withFee: 0, total: null });
});

test('article lu depuis Vinted', () => {
  const it = V.fromApiItem({
    id: 10215621813,
    title: 'Morpheo Forme Solaire – 067/064',
    brand: 'Pokémon',
    status: 'Très bon état',
    price: { amount: '3.59', currency_code: 'EUR' },
    total_item_price: { amount: '4.47', currency_code: 'EUR' },
    photos: [{ url: 'full.webp', thumbnails: [{ type: 'thumb70x100', url: 'small.webp' }, { type: 'thumb150x210', url: 'thumb.webp' }] }],
    is_reserved: true,
    user: { login: 'pok-investt' },
  });
  assert.deepEqual(it, {
    id: '10215621813',
    title: 'Morpheo Forme Solaire – 067/064',
    brand: 'Pokémon',
    status: 'Très bon état',
    price: 3.59,
    total: 4.47,
    thumb: 'thumb.webp',
    reserved: true,
    unavailable: false,
    seller: 'pok-investt',
  });
  assert.equal(V.fromApiItem({ id: 1, title: 'x', price: { amount: '1.0' }, is_closed: true }).unavailable, true);
});
