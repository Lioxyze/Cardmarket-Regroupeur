// Listes collées « 065 — Tokotoro » et sobriété des requêtes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('linkedom');
const cm = require('../src/cm.js');
const an = require('../src/analyzer.js');

const fixture = (name) => new DOMParser().parseFromString(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'), 'text/html');

test('lignes « numéro — nom » : toutes les écritures courantes', () => {
  const cases = [
    ['065 — Tokotoro', '065', 'Tokotoro', 1],
    ['080 — Hyporoi-ex', '080', 'Hyporoi-ex', 1],
    ['087 — Ténacité de Nikolaï', '087', 'Ténacité de Nikolaï', 1],
    ['098 — Énergie Darkness de base', '098', 'Énergie Darkness de base', 1],
    ['065 - Tokotoro', '065', 'Tokotoro', 1],
    ['065: Tokotoro', '065', 'Tokotoro', 1],
    ['Tokotoro 065/099', '065/099', 'Tokotoro', 1],
    ['#65 Tokotoro', '65', 'Tokotoro', 1],
    ['2x 085 — Pêchaminus-ex', '085', 'Pêchaminus-ex', 2],
    ['085 Pêchaminus-ex x2', '085', 'Pêchaminus-ex', 2],
    ['TG05 - Pikachu', 'TG05', 'Pikachu', 1],
    ['Pikachu ex 25', '25', 'Pikachu ex', 1],
  ];
  for (const [line, number, name, qty] of cases) {
    const w = an.parseTextLine(line);
    assert.deepEqual([w.number, w.name, w.qty], [number, name, qty], line);
  }
  // Sans numéro : juste un nom
  assert.equal(an.parseTextLine('Dracaufeu ex').number, '');
  assert.equal(an.parseTextLine('3x Dracaufeu ex').qty, 3);
});

test('correspondance par numéro : doublons de nom, numéros absents, zéros', () => {
  const listing = [
    { key: 'P/Products/Singles/SF/Pecharunt-ex-V1', name: 'Pêchaminus-ex (SFA 039)', number: '039' },
    { key: 'P/Products/Singles/SF/Pecharunt-ex-V2', name: 'Pêchaminus-ex (SFA 085)', number: '085' },
    { key: 'P/Products/Singles/SF/Pecharunt-ex-V3', name: 'Pêchaminus-ex (SFA 093)', number: '093' },
    { key: 'P/Products/Singles/SF/Pecharunt-ex-V4', name: 'Pêchaminus-ex (SFA 095)', number: '95' },
    { key: 'P/Products/Singles/SF/Okidogi-ex-V2', name: 'Okidogi ex (SFA 090)', number: '090' },
  ];
  const wants = ['085 — Pêchaminus-ex', '093 — Pêchaminus-ex', '095 — Pêchaminus-ex', '090 — Félicanis-ex', '120 — Inconnue'].map(an.parseTextLine);
  const { matched, unmatched } = an.matchByNumber(wants, listing);
  assert.deepEqual(
    matched.map((m) => [m.want.number, m.product.key.split('/').pop(), m.nameMatch]),
    [
      ['085', 'Pecharunt-ex-V2', true],
      ['093', 'Pecharunt-ex-V3', true],
      ['095', 'Pecharunt-ex-V4', true],
      ['090', 'Okidogi-ex-V2', false], // nom anglais : trouvé au numéro, pas de ✓ de nom
    ]
  );
  assert.deepEqual(unmatched.map((w) => w.number), ['120']);
});

test('détection de l’extension : lignes parlantes et votes par numéro', () => {
  const wants = ['065 — Tokotoro', '085 — Pêchaminus-ex', '093 — Pêchaminus-ex', '098 — Énergie Darkness de base', '086 — Cassiopée', '080 — Hyporoi-ex'].map(
    an.parseTextLine
  );
  const picked = an.pickDetectionLines(wants, 3).map((w) => w.number);
  assert.deepEqual(picked, ['085', '080', '086']); // « ex » d'abord, puis noms longs ; pas de doublon, pas d'énergie
  const results = [
    { key: 'Pokemon/Products/Singles/Shrouded-Fable/Pecharunt-ex-V2', name: 'Pêchaminus-ex (SFA 085)', number: '085', expansion: 'Fable Nébuleuse' },
    { key: 'Pokemon/Products/Singles/Shrouded-Fable/Pecharunt-ex-V1', name: 'Pêchaminus-ex (SFA 039)', number: '039', expansion: 'Fable Nébuleuse' },
    { key: 'Pokemon/Products/Singles/SV-Promos/Pecharunt-ex', name: 'Pêchaminus-ex (SVP 149)', number: '149', expansion: 'Promos' },
  ];
  assert.deepEqual(an.expansionVotes(results, wants[1]), [{ slug: 'Shrouded-Fable', name: 'Fable Nébuleuse', weight: 1 }]);
  // Avec le code d'extension (« Houndoom (SFA 066) ») : un seul résultat suffit à conclure
  const coded = an.parseTextLine('Pecharunt ex (SFA 085)');
  assert.deepEqual(an.expansionVotes(results, coded).map((v) => v.weight), [2]);
  assert.deepEqual(an.expansionVotes(results, an.parseTextLine('Pecharunt ex (TWM 085)')), []);
});

test('page de liste d’une extension : pagination, extensions du filtre, URL', () => {
  const doc = fixture('pokemon_list.html');
  assert.deepEqual(cm.parsePagination(doc), { page: 1, pages: 2 });
  const exps = cm.parseExpansionOptions(doc);
  assert.ok(exps.length > 700);
  assert.deepEqual(exps.find((e) => e.name === 'Shrouded Fable'), { id: 5760, name: 'Shrouded Fable' });
  const u = new URL(cm.expansionListUrl('Pokemon', { slug: 'Shrouded-Fable' }, 'fr', 2));
  assert.equal(u.pathname, '/fr/Pokemon/Products/Singles/Shrouded-Fable');
  assert.equal(u.searchParams.get('perSite'), '100');
  assert.equal(u.searchParams.get('sortBy'), 'collectorsnumber_asc');
  assert.equal(u.searchParams.get('site'), '2');
  assert.equal(new URL(cm.expansionListUrl('Pokemon', { id: 5760 })).searchParams.get('idExpansion'), '5760');
});

test('file de requêtes : une seule à la fois pour tout l’onglet, toujours espacées', async () => {
  global.DOMParser = DOMParser;
  require('../src/fetcher.js');
  const { Fetcher } = globalThis.CMR.fetcher;
  const log = [];
  let inFlight = 0;
  global.fetch = async (url) => {
    inFlight++;
    assert.equal(inFlight, 1, 'deux requêtes en même temps');
    log.push({ url, t: Date.now() });
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    return new Response('<html><body>ok</body></html>', { status: 200 });
  };
  // Deux opérations indépendantes (ex. une recherche pendant l'analyse)
  const a = new Fetcher({ delayMs: 1000 });
  const b = new Fetcher({ delayMs: 1000 });
  await Promise.all([a.request('https://www.cardmarket.com/1'), b.request('https://www.cardmarket.com/2'), a.request('https://www.cardmarket.com/3')]);
  assert.equal(log.length, 3);
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t - log[i - 1].t >= 1000, `écart ${log[i].t - log[i - 1].t} ms`);
});

test('plafond de pages par analyse', async () => {
  global.chrome = { storage: { local: {} } };
  require('../src/storage.js');
  const settings = { ...globalThis.CMR.store.DEFAULT_SETTINGS, maxRequests: 2, deepCheck: false };
  let count = 0;
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'pokemon_product.html'), 'utf8');
  const fetcher = {
    get count() {
      return count;
    },
    async getDoc() {
      count++;
      return { doc: new DOMParser().parseFromString(html, 'text/html') };
    },
  };
  const store = { async getCache() {}, async putCache() {}, async pruneCache() {} };
  const cards = [1, 2, 3, 4].map((i) => ({ id: 'c' + i, key: `Pokemon/Products/Singles/LC/Card-${i}` }));
  const ds = await new an.Analysis({ settings, fetcher, store }).run(cards);
  assert.equal(count, 2);
  assert.equal(ds.stopReason.code, 'BUDGET');
  assert.match(ds.stopReason.message, /2 cartes non lues/);
});

test('recherche : jamais de « idCategory » (numérotation propre à chaque jeu)', () => {
  for (const kind of ['singles', 'sealed', 'boxes', 'boosters', 'lots']) {
    const u = new URL(cm.searchUrl('Pokemon', 'Houndoom', 'fr', kind));
    assert.equal(u.searchParams.get('idCategory'), null, kind);
    assert.ok(u.searchParams.get('category'));
  }
});

test('file de requêtes : une page qui ne répond pas ne bloque pas les suivantes', async () => {
  global.DOMParser = DOMParser;
  require('../src/fetcher.js');
  const { Fetcher } = globalThis.CMR.fetcher;
  let calls = 0;
  global.fetch = (url, init) => {
    calls++;
    if (url.includes('/lente'))
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))); // ne répond jamais
    return Promise.resolve(new Response('<html><body>ok</body></html>', { status: 200 }));
  };
  const f = new Fetcher({ delayMs: 1000, timeoutMs: 150 });
  const slow = f.request('https://www.cardmarket.com/lente').catch((e) => e.code);
  const next = f.request('https://www.cardmarket.com/rapide').then((r) => r.status);
  assert.equal(await slow, 'NETWORK');
  assert.equal(await next, 200);
  assert.equal(calls, 4); // 3 essais pour la page lente, puis la suivante
});
