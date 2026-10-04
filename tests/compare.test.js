// Passerelle Vinted → Cardmarket : lecture d'une annonce (carte, langue, état), adresse et comparaison des prix.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/compare.js');

const listing = (title, extra) => C.describeListing(Object.assign({ title, brand: 'Pokémon', status: 'Très bon état', description: '' }, extra));

test('carte : nom et numéro tirés du titre de l’annonce', () => {
  const p = (t) => C.parseCardTitle(t);
  assert.deepEqual(p('Gribouraigne – 297/190'), { name: 'Gribouraigne', number: '297/190' });
  assert.deepEqual(p('Carte Pokémon Tokotoro 065/64 SV6a JP – Illustration rare'), { name: 'Tokotoro', number: '065/64' });
  assert.deepEqual(p('Morpheo Forme Solaire – 067/064'), { name: 'Morpheo Forme Solaire', number: '067/064' });
  assert.deepEqual(p('Pikachu VMAX holo rainbow 188/185 Voltage Éclatant FR'), { name: 'Pikachu VMAX', number: '188/185' });
  assert.deepEqual(p('065/064 Tokotoro'), { name: 'Tokotoro', number: '065/064' }); // numéro en tête
  assert.deepEqual(p('Pokémon - Dracaufeu ex - 151 - 006/165'), { name: 'Dracaufeu ex', number: '006/165' });
  assert.deepEqual(p('Pikachu de Sacha TG12/TG30'), { name: 'Pikachu de Sacha', number: 'TG12/TG30' }); // l'article fait partie du nom
  assert.deepEqual(p('M. Mime de Galar 080/203'), { name: 'M. Mime de Galar', number: '080/203' });
  assert.deepEqual(p('Mew ex SVP 053 promo'), { name: 'Mew ex', number: 'SVP 053' });
  assert.deepEqual(p('Evoli n°133 carte holo'), { name: 'Evoli', number: '133' });
  assert.deepEqual(p('Carte Pokémon Dracaufeu très bon état'), { name: 'Dracaufeu', number: '' });
  assert.deepEqual(p('Robe taille 36/38'), { name: 'Robe taille', number: '36/38' }); // écarté plus loin : pas une carte
});

test('carte : recherches de la plus précise à la plus large', () => {
  assert.deepEqual(C.queriesFor('Gribouraigne', '297/190'), ['Gribouraigne 297', 'Gribouraigne']);
  // « ex », « V »… retirés : Cardmarket écrit tantôt « -ex », tantôt « ex » ; le numéro départage
  assert.deepEqual(C.queriesFor('Dracaufeu ex', '006/165'), ['Dracaufeu 006', 'Dracaufeu']);
  assert.deepEqual(C.queriesFor('Morpheo Forme Solaire', '067/064'), ['Morpheo Forme Solaire 067', 'Morpheo Forme Solaire', 'Morpheo 067', 'Morpheo']);
  assert.deepEqual(C.queriesFor('Dracaufeu', ''), ['Dracaufeu']);
  assert.deepEqual(C.queriesFor('M. Mime', '080/203'), ['M. Mime 080', 'M. Mime']); // « M. » seul ne se cherche pas
});

test('nom anglais lu dans l’adresse d’une fiche Cardmarket', () => {
  const e = (slug) => C.englishFromKey('Pokemon/Products/Singles/' + slug);
  assert.equal(e('Paldean-Fates/Coalossal-V1-PAF148'), 'Coalossal');
  assert.equal(e('Legendary-Collection/Machop-LC79'), 'Machop');
  assert.equal(e('Obsidian-Flames/Charizard-ex-V2-OBF215'), 'Charizard ex');
  assert.equal(e('Shiny-Treasure-ex/Coalossal-sv4a268'), 'Coalossal');
  assert.equal(e('151/Mr-Mime-V1-MEW122'), 'Mr Mime');
  assert.equal(e('Promos/Pikachu'), ''); // pas de code : rien à en tirer
  assert.equal(C.englishFromKey(''), '');
});

test('annonces écartées : lots, objets qui ne sont pas des cartes, autres marques', () => {
  assert.deepEqual(listing('Lot de 3 cartes, holo, rares'), { ok: false, reason: 'lot' });
  assert.deepEqual(listing('Peluche Pikachu 20 cm'), { ok: false, reason: 'carte' });
  assert.deepEqual(listing('Robe taille 36/38', { brand: 'Zara' }), { ok: false, reason: 'jeu' });
  assert.equal(listing('Dracaufeu ex').ok, true); // « ex » suffit comme indice de carte
  assert.equal(listing('Pikachu', { description: 'Carte en très bon état' }).ok, true);
  assert.equal(listing('Magicien Sombre LOB-FR005', { brand: 'Yu-Gi-Oh!', description: 'carte' }).game, 'YuGiOh');
  const sealed = listing('Display Pokémon EV4.5 Destinées de Paldea');
  assert.equal(sealed.kind, 'sealed');
  assert.equal(sealed.cond.code, null); // pas d'échelle d'états pour du scellé
});

test('langue : titre d’abord, puis description ; « en » et « de » ne sont pas des langues', () => {
  const l = (t, d) => C.detectLanguage(t, d);
  assert.deepEqual(l('Tokotoro 065/64 SV6a JP', ''), { id: 7, sure: true, from: 'titre' });
  assert.deepEqual(l('Gribouraigne – 297/190', 'KEITOCARDS\n\n🇯🇵 Carte Japonaise\n✨ État : Voir photos'), { id: 7, sure: true, from: 'description' });
  assert.deepEqual(l('Pikachu 188/185 FR', 'j’ai aussi des cartes japonaises'), { id: 2, sure: true, from: 'titre' }); // le titre l'emporte
  assert.deepEqual(l('Dracaufeu ex 006/165', 'Carte en très bon état, envoi de France'), { id: null, sure: false, from: '' });
  assert.deepEqual(l('CARTE EN TRES BON ETAT', 'VENDU DE PARTICULIER'), { id: null, sure: false, from: '' });
  assert.equal(l('Charizard ex 006/165 (EN)', '').id, 1);
  assert.equal(l('Dracaufeu version anglaise', '').id, 1);
  assert.equal(l('Dracaufeu EV3.5 006/165', '').id, 2); // code d'extension français
  assert.equal(l('Dracaufeu sv2a 006/165', '').id, 7); // code d'extension japonais
  assert.equal(l('ピカチュウ 025/165', '').id, 7);
  assert.equal(l('Glurak deutsch 006/165', '').id, 3);
  assert.equal(l('Pikachu coréen', '').id, 10);
  assert.deepEqual(l('Dracaufeu', 'Dispo en français et en japonais'), { id: 2, sure: false, from: 'description' }); // deux langues : pas sûr
});

test('langue : celle du vendeur à défaut, sinon français supposé', () => {
  assert.deepEqual(listing('Gribouraigne – 297/190').lang, { id: 2, sure: false, from: '' });
  assert.deepEqual(listing('Gribouraigne – 297/190', { sellerLang: 7 }).lang, { id: 7, sure: false, from: 'vendeur' });
  assert.deepEqual(listing('Gribouraigne – 297/190 FR', { sellerLang: 7 }).lang, { id: 2, sure: true, from: 'titre' });
  assert.equal(C.summary(listing('Gribouraigne – 297/190')), 'français (supposé) · Excellent ou mieux');
});

test('état : menu de Vinted, sauf si le vendeur écrit lui-même un état de carte', () => {
  const c = (s, t) => C.conditionFor(s, t || '');
  assert.deepEqual(c('Neuf avec étiquette'), { code: 'NM', from: 'état Vinted' });
  assert.deepEqual(c('Neuf sans étiquette'), { code: 'NM', from: 'état Vinted' });
  assert.deepEqual(c('Très bon état'), { code: 'EX', from: 'état Vinted' });
  assert.deepEqual(c('Bon état'), { code: 'GD', from: 'état Vinted' });
  assert.deepEqual(c('Satisfaisant'), { code: 'LP', from: 'état Vinted' });
  assert.deepEqual(c(''), { code: null, from: '' });
  assert.deepEqual(c('Bon état', 'Carte NM, sortie de booster'), { code: 'NM', from: 'annonce' });
  assert.deepEqual(c('Très bon état', 'Near Mint'), { code: 'NM', from: 'annonce' });
  assert.deepEqual(c('Très bon état', 'light played'), { code: 'LP', from: 'annonce' });
  assert.deepEqual(c('Très bon état', 'Dracaufeu EX'), { code: 'EX', from: 'état Vinted' }); // « EX » est un nom de carte
  assert.deepEqual(c('Très bon état', 'État : NM ou played selon la carte'), { code: 'EX', from: 'état Vinted' }); // deux états : on garde Vinted
  const graded = listing('Dracaufeu ex 006/165 PSA 10', { description: 'GEM MINT' });
  assert.equal(graded.graded, 'PSA 10');
  assert.equal(graded.cond.code, null);
  assert.equal(C.summary(graded), 'français (supposé) · gradée PSA 10');
});

test('adresse Cardmarket : recherche + fragment relu tel quel', () => {
  const d = listing('Gribouraigne – 297/190', { description: '🇯🇵 Carte Japonaise' });
  const url = C.cardmarketUrl(d, { title: 'Gribouraigne – 297/190', status: 'Très bon état', price: 2.99, total: 3.84, shipping: 2.83, url: '/items/10236224735-gribouraigne-297190?x=1' });
  assert.ok(url.startsWith('https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=Gribouraigne+297&mode=list&category=1#cmrv='));
  const m = C.decodeMarker(url.slice(url.indexOf('#')));
  assert.deepEqual(
    { g: m.g, n: m.n, num: m.num, qs: m.qs, l: m.l, ls: m.ls, lf: m.lf, c: m.c, st: m.st, tp: m.tp, sh: m.sh, u: m.u, a: m.a, h: m.h },
    { g: 'Pokemon', n: 'Gribouraigne', num: '297/190', qs: ['Gribouraigne 297', 'Gribouraigne'], l: 7, ls: 1, lf: 'description', c: 'EX', st: 'Très bon état', tp: 3.84, sh: 2.83, u: '/items/10236224735', a: 0, h: 0 }
  );
  // envoi inconnu : champ absent, pas « 0 »
  assert.equal(C.decodeMarker(C.cardmarketUrl(d, { total: 3.84 }).replace(/^[^#]*/, '')).sh, null);
  // scellé : toutes catégories
  assert.ok(!C.cardmarketUrl(listing('Display Pokémon EV4.5 Destinées de Paldea'), {}).includes('category='));
});

test('fragment fabriqué par quelqu’un d’autre : valeurs vérifiées, rien d’exécutable', () => {
  const mk = (v) => C.decodeMarker('#cmrv=' + encodeURIComponent(JSON.stringify(v)));
  assert.equal(C.decodeMarker('#autre'), null);
  assert.equal(C.decodeMarker('#cmrv=%7Bpas-du-json'), null);
  assert.equal(mk({ v: 2, g: 'Pokemon', n: 'x' }), null);
  assert.equal(mk({ v: 1, g: '../../evil', n: 'x' }), null); // jeu hors liste
  assert.equal(mk({ v: 1, g: 'Pokemon', n: '' }), null);
  const m = mk({ v: 1, g: 'Pokemon', n: 'Pikachu', num: '<img src=x>', l: 99, c: 'ZZ', u: 'https://evil.example/items/1', qs: ['a', 5, 'b'.repeat(200)], h: 1e9, qi: -4, p: 'cher', tp: -3, lf: 'ailleurs', k: 'autre' });
  assert.deepEqual(
    { num: m.num, l: m.l, c: m.c, u: m.u, qs: m.qs, h: m.h, qi: m.qi, p: m.p, tp: m.tp, lf: m.lf, k: m.k },
    { num: '', l: 0, c: '', u: '', qs: ['a', 'b'.repeat(80)], h: 9, qi: 0, p: null, tp: null, lf: '', k: 'singles' }
  );
});

test('Cardmarket : port estimé, meilleure offre et écart avec Vinted', () => {
  assert.equal(C.shipEstimate(null, 'FR', 2.5), 1.6);
  assert.equal(C.shipEstimate(null, 'DE', 2.5), 2.2);
  assert.equal(C.shipEstimate(null, '', 2.5), 2.2); // pays inconnu : envoi international supposé
  assert.equal(C.shipEstimate(null, 'FR', 30), 3.5); // suivi à partir de 25 €
  assert.equal(C.shipEstimate(null, 'DE', 120), 12); // assuré à partir de 100 €
  assert.equal(C.shipEstimate({ buyerCountry: 'BE', domestic: 1 }, 'BE', 2), 1);
  const offers = [
    { price: 2.2, seller: { countryCode: 'DE' } },
    { price: 2.5, seller: { countryCode: 'FR' } },
    { price: null, seller: { countryCode: 'FR' } },
  ];
  // la moins chère une fois le port ajouté n'est pas la première de la liste
  assert.deepEqual(C.bestOffer(offers, null), { price: 2.5, ship: 1.6, total: 4.1, country: 'FR' });
  assert.deepEqual(C.bestOffer(offers, null, true), { price: 2.2, ship: 2.2, total: 4.4, country: 'DE' }); // prix seuls
  assert.equal(C.bestOffer([], null), null);
  const best = C.bestOffer(offers, null);
  assert.deepEqual(C.verdict({ tp: 3.84, sh: 2.83 }, best), { vinted: 6.67, cardmarket: 4.1, withShipping: true, diff: 2.57 });
  assert.deepEqual(C.verdict({ tp: 3.84, sh: null }, best), { vinted: 3.84, cardmarket: 2.5, withShipping: false, diff: 1.34 }); // envoi inconnu : hors envoi des deux côtés
  assert.equal(C.verdict({ tp: null, sh: 1 }, best), null);
  assert.equal(C.verdict({ tp: 3.84, sh: 2.83 }, null), null);
});

// ---------- Constats de la relecture ----------

test('langue : une phrase sur le vendeur, l’envoi ou ses autres annonces ne dit rien de la carte', () => {
  const l = (d) => C.detectLanguage('Charizard ex 199/165', d);
  assert.deepEqual(l('Carte en très bon état.\nVendeur français sérieux, envoi rapide et soigné'), { id: 2, sure: false, from: 'description' });
  assert.deepEqual(l('Envoi rapide et soigné depuis la France 🇫🇷'), { id: 2, sure: false, from: 'description' });
  assert.deepEqual(l('N’hésitez pas à regarder mes autres cartes japonaises'), { id: 7, sure: false, from: 'description' });
  assert.deepEqual(l('Envoi suivi US possible'), { id: 1, sure: false, from: 'description' });
  // ce qui précède ces mots parle bien de la carte
  assert.deepEqual(l('Carte japonaise envoi sous toploader'), { id: 7, sure: true, from: 'description' });
  assert.deepEqual(l('Carte anglaise, envoi depuis la France 🇫🇷'), { id: 1, sure: true, from: 'description' });
  assert.deepEqual(l('Extension EV4.5, envoi suivi'), { id: 2, sure: true, from: 'description' });
  const d = listing('Charizard ex 199/165', { description: 'Vendeur français sérieux' });
  assert.equal(C.summary(d), 'français (supposé) · Excellent ou mieux');
  assert.match(C.explain(d, 'Très bon état'), /Langue incertaine dans la description : français supposé\./);
});

test('carte promo ou « sortie de booster » : une carte, pas un produit scellé', () => {
  for (const t of ['Carte Pokémon Mewtwo ex promo coffret', 'Carte Pokémon Dracaufeu holo sortie de booster', 'Carte Pokémon Évoli promo blister', 'Mewtwo ex promo coffret', 'Carte Pokémon Pikachu tin promo']) {
    const d = listing(t);
    assert.equal(d.kind, 'singles', t);
    assert.equal(d.cond.code, 'EX', t);
  }
  for (const t of ['Display Pokémon EV4.5 Destinées de Paldea', 'Coffret Dresseur d’Élite Évolutions Prismatiques', 'Booster Pokémon Flammes Obsidiennes', 'Coffret Pokémon avec carte promo']) {
    assert.equal(listing(t).kind, 'sealed', t);
  }
});

test('gradée : « potentiel PSA 10 » n’est pas une carte gradée', () => {
  const nu = (description, title) => listing(title || 'Dracaufeu ex 199/165', { status: 'Neuf sans étiquette', description });
  for (const d of ['Carte sortie de booster, potentiel PSA 10', 'Non gradée. Digne d’un PSA 10 !', 'Candidate PSA 10', 'Carte à faire grader, PSA 9 ou 10 possible']) {
    assert.equal(nu(d).graded, '', d);
    assert.equal(nu(d).cond.code, 'NM', d);
  }
  assert.equal(nu('', 'Dracaufeu ex 199/165 potentiel PSA 10').graded, '');
  assert.equal(nu('Carte gradée PSA 9').graded, 'PSA 9');
  assert.equal(nu('', 'Dracaufeu ex 199/165 PSA 10').graded, 'PSA 10');
});

test('objets de la même marque : ni carte, ni lien', () => {
  for (const t of ['T-shirt Pokémon Pikachu 12/14 ans', 'Pyjama Pokémon 8/10 ans', 'Peluche Pikachu rare', 'Coffret DVD Pokémon saison 1', 'Casquette Pokémon rare', 'Robe Pokémon taille 36/38']) {
    assert.deepEqual(listing(t), { ok: false, reason: 'carte' }, t);
  }
  assert.deepEqual(listing('Figurine Dragon Ball Z Son Goku sous blister', { brand: 'Dragon Ball' }), { ok: false, reason: 'carte' });
  for (const t of ['Carte Pokémon Pikachu 25/25 célébrations 25 ans', 'Dracaufeu ultra rare', 'Mew illustration spéciale rare', 'Carte Pokémon Ronflex jumbo grande taille']) {
    assert.equal(listing(t).ok, true, t);
  }
});

test('titre : note d’une carte gradée et promo japonaise « 001/SV-P »', () => {
  assert.deepEqual(C.parseCardTitle('Carte Pokémon PCA 9.5 Dracaufeu 199/165'), { name: 'Dracaufeu', number: '199/165' });
  assert.deepEqual(C.parseCardTitle('Pikachu 001/SV-P promo japonaise'), { name: 'Pikachu', number: '001/SV-P' });
  const d = listing('Pikachu 001/SV-P promo japonaise');
  assert.deepEqual(d.queries, ['Pikachu 001', 'Pikachu']);
  const url = C.cardmarketUrl(d, { total: 3 });
  assert.equal(C.decodeMarker(url.slice(url.indexOf('#'))).num, '001/SV-P'); // le numéro survit au fragment
});

test('fragment : envoi offert gardé, langue du site stricte, nouveaux drapeaux', () => {
  const d = listing('Gribouraigne – 297/190');
  const read = (extra) => {
    const url = C.cardmarketUrl(d, extra);
    return C.decodeMarker(url.slice(url.indexOf('#')));
  };
  const free = read({ price: 2.99, total: 3.84, shipping: 0 });
  assert.equal(free.sh, 0); // envoi offert : connu, et nul
  assert.deepEqual(C.verdict(free, { price: 2.5, ship: 1.6, total: 4.1, country: 'FR' }), { vinted: 3.84, cardmarket: 4.1, withShipping: true, diff: -0.26 });
  assert.equal(read({ total: 3.84 }).sh, null);
  const mk = (v) => C.decodeMarker('#cmrv=' + encodeURIComponent(JSON.stringify(Object.assign({ v: 1, g: 'Pokemon', n: 'Pikachu' }, v))));
  assert.equal(mk({ lo: 'en/Pokemon/Users/Quelquun/Offers?x=' }).lo, ''); // pas un chemin
  assert.equal(mk({ lo: 'en' }).lo, 'en');
  assert.equal(mk({ lo: 12 }).lo, '');
  assert.deepEqual([mk({ d: 7 }).d, mk({ d: 99 }).d, mk({ d: 1 }).d], [7, 0, 1]); // langue du filtre retiré : un identifiant connu
  assert.deepEqual([mk({ x: 1, w: 'oui' }).x, mk({ x: 1, w: 'oui' }).w, mk({}).x, mk({}).w], [1, 1, 0, 0]);
});

test('numéro lu dans l’adresse d’une fiche : entier, pas la fin d’un numéro plus long', () => {
  const an = require('../src/analyzer.js');
  const c = (slug, number) => ({ key: 'Pokemon/Products/Singles/' + slug, name: slug.split('/')[1], number: number || '', expansion: '', available: 1 });
  const want = { name: 'Dracaufeu', number: '006/165', expansion: '' };
  const rank = an.rankCandidates([c('Promos/Charizard-ex-SVP056'), c('Obsidian-Flames/Charizard-ex-V1-OBF125'), c('Paldean-Fates/Charizard-ex-V1-PAF054')], want);
  assert.equal(rank.auto, null); // « 6 » ne colle pas à « …SVP056 »
  assert.ok(rank.candidates.every((x) => !x.detail.number));
  const ok = an.rankCandidates([c('Pokemon-Card-151/Charizard-ex-sv2a006'), c('Obsidian-Flames/Charizard-ex-V1-OBF125')], want);
  assert.equal(ok.auto.key, 'Pokemon/Products/Singles/Pokemon-Card-151/Charizard-ex-sv2a006'); // « …sv2a006 » : bien le n° 6
});
