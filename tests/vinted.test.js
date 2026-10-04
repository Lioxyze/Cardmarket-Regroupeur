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

// ---------- Messages en direct ----------
const MIN = 60000;

test('direct : cadence des lectures du compteur', () => {
  const at = (c) => V.liveInterval(Object.assign({ inbox: false, conv: false, visible: true, idleMs: 0, hiddenMs: 0 }, c));
  assert.equal(at({ inbox: true, conv: true }), 7000); // conversation ouverte, utilisateur actif
  assert.equal(at({ inbox: true }), 15000); // messagerie, aucune conversation ouverte
  assert.equal(at({ inbox: true, conv: true, idleMs: 5 * MIN }), 20000);
  assert.equal(at({ inbox: true, conv: true, idleMs: 20 * MIN }), MIN);
  assert.equal(at({ inbox: true, conv: true, idleMs: 31 * MIN }), 0); // onglet oublié : arrêt
  assert.equal(at({}), MIN); // autre page de Vinted
  assert.equal(at({ idleMs: 20 * MIN }), 3 * MIN);
  assert.equal(at({ idleMs: 31 * MIN }), 0);
  assert.equal(at({ visible: false, inbox: true, conv: true }), MIN); // onglet caché : jamais la cadence rapide
  assert.equal(at({ visible: false, hiddenMs: 15 * MIN }), 2 * MIN);
  assert.equal(at({ visible: false, hiddenMs: 31 * MIN }), 0);
});

test('direct : la conversation n’est relue que si l’utilisateur est devant', () => {
  const w = (c) => V.liveWatched(Object.assign({ visible: true, focused: true, idleMs: 0, inputMs: Infinity }, c));
  assert.equal(w({}), true);
  assert.equal(w({ visible: false }), false);
  assert.equal(w({ idleMs: 4 * MIN }), false); // parti déjeuner, fenêtre au premier plan
  assert.equal(w({ focused: false }), false); // fenêtre visible sur un second écran, personne devant
  assert.equal(w({ focused: false, inputMs: 5000 }), true); // fenêtre à côté d'une autre, survolée à l'instant
  assert.equal(w({ focused: false, inputMs: 40000 }), false);
});

test('direct : seule une hausse du compteur déclenche une relecture', () => {
  assert.equal(V.liveDecide(null, 3), 'first'); // première valeur : simple référence, pas d'avis
  assert.equal(V.liveDecide(0, 1), 'up');
  assert.equal(V.liveDecide(1, 0), 'down'); // lu ici ou ailleurs : aucune requête
  assert.equal(V.liveDecide(2, 2), 'same');
  // message reçu puis lu : une seule relecture pour la suite 0 → 1 → 0
  const seq = [0, 1, 0];
  assert.equal(seq.slice(1).filter((n, i) => V.liveDecide(seq[i], n) === 'up').length, 1);
});

test('direct : tête de liste, cadence et changements', () => {
  assert.equal(V.liveHeadInterval(0), 3000); // utilisateur actif
  assert.equal(V.liveHeadInterval(3 * MIN), 6000);
  assert.equal(V.liveHeadInterval(10 * MIN), 20000);
  assert.equal(V.liveHeadInterval(20 * MIN), MIN);
  assert.equal(V.liveHeadInterval(31 * MIN), 0); // onglet oublié : arrêt
  const a = { id: '1', at: '2026-10-04T10:00:00Z', unread: false };
  assert.equal(V.liveHeadChange(null, a), 'first');
  assert.equal(V.liveHeadChange(a, { ...a }), 'same');
  assert.equal(V.liveHeadChange({ ...a, unread: true }, a), 'read'); // lue : rien à relire
  assert.equal(V.liveHeadChange(a, { ...a, at: '2026-10-04T10:00:05Z' }), 'new'); // message dans la même conversation
  assert.equal(V.liveHeadChange(a, { id: '2', at: '2026-10-04T10:00:05Z', unread: true }), 'new'); // message ailleurs
  // dans la messagerie, tête de liste suivie : le compteur ne sert plus qu'à la pastille
  assert.equal(V.liveInterval({ inbox: true, head: true, conv: true, visible: true, idleMs: 0, hiddenMs: 0 }), 30000);
});
