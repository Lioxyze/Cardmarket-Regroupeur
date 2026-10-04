/*
 * Regroupeur — passerelle Vinted → Cardmarket (« Voir sur Cardmarket »).
 *
 * Côté Vinted : à partir du titre, de la description et de l'état d'une annonce, décrit la carte (nom, numéro, jeu),
 * la langue et l'état à comparer, puis construit l'adresse d'une recherche Cardmarket.
 * Côté Cardmarket : à l'arrivée, choisit la carte au bon numéro, applique les filtres langue / état sur sa fiche et
 * affiche un bandeau qui met les deux prix côte à côte.
 *
 * Ce que l'annonce a appris voyage dans le fragment de l'adresse (#cmrv=…), qui n'est jamais envoyé au serveur.
 * Tout ce qui en est relu ici est traité comme du texte quelconque : valeurs vérifiées, jamais de HTML.
 * Aucune requête n'est faite en arrière-plan : seulement les pages que le navigateur affiche.
 *
 * Les fonctions de description n'utilisent pas le DOM : le même fichier est testé sous Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.CMRC = api;
    if (root.document && root.top === root && root.location && /(^|\.)cardmarket\.com$/.test(root.location.hostname)) {
      try {
        api.land(root);
      } catch (e) {
        /* la passerelle ne doit jamais gêner la page */
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ORIGIN = 'https://www.cardmarket.com';
  const VINTED = 'https://www.vinted.fr';
  const MARK = '#cmrv=';

  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const euro = (n) => `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const round2 = (x) => Math.round(x * 100) / 100;

  // ---------- Jeu ----------

  // Nom du jeu dans les adresses Cardmarket, reconnu dans la marque ou le texte de l'annonce (sans accents).
  const GAMES = [
    ['Pokemon', /pokemon/],
    ['YuGiOh', /yu[\s-]?gi[\s-]?oh/],
    ['Magic', /magic\s*:?\s*the gathering|\bmtg\b/],
    ['OnePiece', /one piece/],
    ['Lorcana', /lorcana/],
    ['DragonBallSuper', /dragon ball/],
  ];

  function detectGame(brand, text) {
    const b = norm(brand);
    const t = norm(text);
    for (const [game, re] of GAMES) if (re.test(b)) return game;
    for (const [game, re] of GAMES) if (re.test(t)) return game;
    return null;
  }

  // ---------- Langue ----------

  // id : identifiant du filtre « language » de Cardmarket. words : sur le texte sans accents, en minuscules.
  // caps : abréviations, en majuscules seulement (« en » et « de » sont des mots français). sets : codes d'extension
  // propres à une langue (EV4.5, EB07 : français ; SV6a, s12a : japonais).
  const LANGS = [
    { id: 2, code: 'FR', fr: 'français', words: /\b(?:francais(?:e|es)?|french|vf)\b/, caps: /\b(?:FR|FRA|VF)\b/, sets: /\b(?:EV|EB|SL)\s?\d{1,2}(?:[.,]5)?\b/, flag: /🇫🇷/ },
    { id: 7, code: 'JP', fr: 'japonais', words: /\b(?:japonais(?:e|es)?|japanese|japon|japan|jap|jpn)\b/, caps: /\b(?:JP|JAP|JPN)\b/, sets: /\b(?:sv\d{1,2}[a-z]|s\d{1,2}[a-z]|sm\d{1,2}[a-z])\b/i, flag: /🇯🇵/ },
    { id: 1, code: 'EN', fr: 'anglais', words: /\b(?:anglais(?:e|es)?|english)\b/, caps: /\b(?:ENG|US|UK)\b|[([]\s*EN\s*[)\]]/, flag: /🇬🇧|🇺🇸/ },
    { id: 3, code: 'DE', fr: 'allemand', words: /\b(?:allemand(?:e|es)?|german|deutsch)\b/, caps: /\b(?:GER|DEU)\b|[([]\s*DE\s*[)\]]/, flag: /🇩🇪/ },
    { id: 5, code: 'IT', fr: 'italien', words: /\b(?:italien(?:ne|nes|s)?|italian)\b/, caps: /\bITA\b/, flag: /🇮🇹/ },
    { id: 4, code: 'ES', fr: 'espagnol', words: /\b(?:espagnol(?:e|es|s)?|spanish)\b/, caps: /\bESP\b/, flag: /🇪🇸/ },
    { id: 10, code: 'KO', fr: 'coréen', words: /\b(?:coreen(?:ne|nes|s)?|korean)\b/, caps: /\b(?:KR|KOR)\b/, flag: /🇰🇷/ },
    { id: 6, code: 'ZH', fr: 'chinois', words: /\b(?:chinois(?:e|es)?|chinese)\b/, caps: /\b(?:CN|CHN)\b/, flag: /🇨🇳/ },
    { id: 8, code: 'PT', fr: 'portugais', words: /\b(?:portugais(?:e|es)?|portuguese)\b/, caps: /\bPOR\b/, flag: /🇵🇹|🇧🇷/ },
  ];
  const langOf = (id) => LANGS.find((l) => l.id === id) || null;
  const KANA = /[぀-ヿ]/;

  /** Langues citées dans un texte, dans l'ordre où elles apparaissent : [id, …]. */
  function languagesIn(text) {
    const raw = String(text || '');
    const low = norm(raw);
    const hits = [];
    for (const l of LANGS) {
      let at = -1;
      for (const [re, s] of [
        [l.words, low],
        [l.caps, raw],
        [l.sets, raw],
        [l.flag, raw],
      ]) {
        const m = re && re.exec(s);
        if (m && (at < 0 || m.index < at)) at = m.index;
      }
      if (l.id === 7) {
        const k = raw.search(KANA);
        if (k >= 0 && (at < 0 || k < at)) at = k;
      }
      if (at >= 0) hits.push({ id: l.id, at });
    }
    return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
  }

  /**
   * Langue de la carte : le titre d'abord, puis la description. « sure » : une seule langue citée.
   * @returns {{ id: number|null, sure: boolean, from: ''|'titre'|'description' }}
   */
  function detectLanguage(title, description) {
    const t = languagesIn(title);
    if (t.length) return { id: t[0], sure: t.length === 1, from: 'titre' };
    const d = languagesIn(description);
    if (!d.length) return { id: null, sure: false, from: '' };
    // Dans chaque phrase, seul ce qui précède « envoi », « vendeur », « autres »… décrit la carte : « Vendeur
    // français », « envoi depuis la France 🇫🇷 », « mes autres cartes japonaises » ne disent rien de sa langue.
    const own = languagesIn(
      String(description || '')
        .split(/[\n.!?;,]+/)
        .map((p) => p.slice(0, (ABOUT_SELLER.exec(norm(p)) || { index: p.length }).index))
        .join('\n')
    );
    return own.length ? { id: own[0], sure: own.length === 1, from: 'description' } : { id: d[0], sure: false, from: 'description' };
  }
  const ABOUT_SELLER = /\b(?:envoi\w*|expedi\w*|livr\w*|vendeu(?:r|se)s?|depuis|autres?|aussi|profil|dressing)\b/;

  // ---------- État ----------

  // Échelle Cardmarket, du meilleur au pire. Le filtre « minCondition » veut dire « cet état ou mieux ».
  const CONDS = [
    { code: 'MT', id: 1, label: 'Mint' },
    { code: 'NM', id: 2, label: 'Near Mint' },
    { code: 'EX', id: 3, label: 'Excellent' },
    { code: 'GD', id: 4, label: 'Good' },
    { code: 'LP', id: 5, label: 'Light Played' },
    { code: 'PL', id: 6, label: 'Played' },
    { code: 'PO', id: 7, label: 'Poor' },
  ];
  const condOf = (code) => CONDS.find((c) => c.code === code) || null;

  // États de Vinted (5 niveaux) → état Cardmarket comparable.
  const STATUS = [
    [/neuf avec etiquette/, 'NM'],
    [/neuf sans etiquette|^neuf$/, 'NM'],
    [/tres bon etat/, 'EX'],
    [/bon etat/, 'GD'],
    [/satisfaisant/, 'LP'],
  ];
  // État écrit par le vendeur lui-même, dans le vocabulaire des cartes : plus précis que le menu de Vinted.
  const WRITTEN = [
    ['NM', /\bnear[\s-]*mint\b|\bnm\b|\bmint\b/],
    ['EX', /\bexcellent etat\b|\betat excellent\b|\bexc\b/],
    ['LP', /\blight(?:ly)?[\s-]*played\b/],
    ['PL', /(?<!light |lightly |light-)\bplayed\b/],
    ['PO', /\bpoor\b|\bmauvais etat\b/],
  ];

  /** @returns {{ code: string|null, from: ''|'état Vinted'|'annonce' }} */
  function conditionFor(status, text) {
    const t = norm(text);
    const written = WRITTEN.filter(([, re]) => re.test(t)).map(([code]) => code);
    if (written.length === 1) return { code: written[0], from: 'annonce' };
    const s = norm(status);
    const hit = STATUS.find(([re]) => re.test(s));
    return hit ? { code: hit[1], from: 'état Vinted' } : { code: null, from: '' };
  }

  // ---------- Carte ----------

  const GRADED = /\b(PSA|BGS|CGC|PCA|SGC|AOG|CCC)\s*:?\s*(10|[1-9](?:[.,]5)?)(?![\d/])/i;
  const SEALED = /\b(?:display|booster|boosters|coffret|etb|elite trainer|tripack|duopack|tin|pokebox|blister|bundle|deck|upc|portfolio|classeur)\b/;
  const LOT = /^\s*lots?\b|\blots? de\b|\b\d+\s*cartes\b|\bcartes?\s*x\s*\d+\b|\bx\s*\d+\s*cartes\b/;
  const CARDISH = /\b(?:carte|card|tcg|jcc|holo|reverse|ex|gx|vmax|vstar|full art|promo|psa|(?:illustration|speciale|ultra|secrete?|hyper|double) rare)\b/;
  // Vêtements, peluches, DVD… de la même marque : « 12/14 ans » n'est pas un numéro de carte.
  const OBJECT = /\d\s*\/\s*\d+\s*(?:ans|mois|cm)\b|\btaille\s*(?:\d|[xsml]{1,3}\b)|\b(?:t-?shirt|tee-?shirt|sweat|pull|pyjama|peluche|figurine|tomes?|dvd|blu-?ray|game ?boy|mug|puzzle|poster)\b/;

  // 297/190, 065/64, TG12/TG30, GG35/GG70 ; à défaut un numéro de promo (SWSH123, SVP 045) ou « n° 65 ».
  const NUMBER = /(?<![A-Za-z0-9])((?:[A-Z]{1,4})?\d{1,3}[a-z]?)\s*\/\s*((?:[A-Z]{1,4})?\d{1,3}|[A-Z]{1,3}-P)(?![A-Za-z0-9])/;
  const PROMO = /(?<![A-Za-z0-9])((?:SWSH|SVP|SMP|SM|XY|BW|HGSS|DP|MEP)\s?-?\s?\d{1,3})(?![A-Za-z0-9])/;
  const HASH = /(?:n[°o]\s*|#\s*)(\d{1,3})(?![\d/])/i;

  // Mots qui décrivent l'annonce et non la carte. Les articles (« de », « la ») restent : ils font partie de noms
  // comme « Pikachu de Sacha ».
  const NOISE = new Set(
    (
      'carte cartes card cards pokemon tcg jcc holo holographique reverse rare ultra hyper secret secrete full art alt ' +
      'alternative alternatif illustration speciale special sar sir ir ar sr ur hr chr csr rr gold doree or rainbow ' +
      'shiny chromatique brillante promo neuf neuve mint nm fr vf francais francaise jp jap jpn japonais japonaise ' +
      'anglais anglaise eng edition 1ere first 1st officielle officiel authentique original originale tbe nintendo ' +
      'psa pca cgc bgs graded gradee tres bon etat excellent parfait parfaite'
    ).split(' ')
  );
  const SET_CODE = /^(?:sv|s|sm|ev|eb|sl|xy|bw|me)\d{1,2}[a-z]?(?:[.,]\d)?$/;
  const SUFFIX = /[\s-]+(?:ex|gx|v|vmax|vstar|v-union)$/i;

  // Premier morceau du texte qui garde un nom une fois les mots d'annonce retirés.
  function nameIn(text) {
    for (const part of String(text || '').split(/\s+[–—|•·:]\s*|\s+-\s+|[–—|•·]\s*|,\s+|\(|\)|\[|\]/)) {
      const words = clean(part.replace(/[^\p{L}\p{N}\s'’.:\-&♀♂%]/gu, ' '))
        .split(' ')
        .filter((w) => {
          const n = norm(w).replace(/^[.:\-]+|[.:\-]+$/g, '');
          return n && !NOISE.has(n) && !/^\d+(?:[.,]\d+)?$/.test(n) && !SET_CODE.test(n);
        });
      if (words.some((w) => /\p{L}{2}/u.test(w))) return words.join(' ');
    }
    return '';
  }

  /** « Carte Pokémon Tokotoro 065/64 SV6a JP – Illustration rare » → { name: 'Tokotoro', number: '065/64' } */
  function parseCardTitle(title) {
    const t = clean(title);
    let number = '';
    let before = t;
    let after = '';
    const m = NUMBER.exec(t) || PROMO.exec(t) || HASH.exec(t);
    if (m) {
      number = m[2] !== undefined && NUMBER.test(m[0]) ? `${m[1]}/${m[2]}` : m[1].replace(/[\s-]+/g, ' ');
      before = t.slice(0, m.index);
      after = t.slice(m.index + m[0].length);
    }
    return { name: nameIn(before) || nameIn(after), number };
  }

  /** Recherches à essayer, de la plus précise à la plus large. */
  function queriesFor(name, number) {
    const base = clean(name.replace(SUFFIX, '')) || name;
    const first = base.split(' ')[0];
    const short = first.length >= 3 && first !== base ? first : '';
    const num = number ? number.split('/')[0] : '';
    const out = [];
    if (num) out.push(`${base} ${num}`);
    out.push(base);
    if (num && short) out.push(`${short} ${num}`);
    if (short) out.push(short);
    return [...new Set(out)].slice(0, 4);
  }

  /** Note d'une carte gradée, sauf quand le texte n'en parle que comme d'un espoir (« potentiel PSA 10 »). */
  function gradedIn(text) {
    const s = String(text || '');
    const g = GRADED.exec(s);
    if (!g) return null;
    const before = norm(s.slice(0, g.index)).split(/[\n.!?;]/).pop(); // la phrase en cours, avant la note
    return /\b(?:potenti\w*|digne|candidat\w*|non grad\w*|pas grad\w*|a (?:faire )?grad\w*)\b/.test(before) ? null : g;
  }

  /**
   * Nom anglais d'une carte, lu dans l'adresse de sa fiche Cardmarket (les adresses sont en anglais quelle que soit
   * la langue du site) : « …/Paldean-Fates/Coalossal-V1-PAF148 » → « Coalossal ».
   */
  function englishFromKey(key) {
    const slug = String(key || '').split('/').pop() || '';
    const name = slug.replace(/(?:-V\d+)?-[A-Za-z]*\d+[A-Za-z0-9]*$/, '');
    return name && name !== slug ? clean(name.replace(/-/g, ' ')) : '';
  }

  /**
   * Décrit une annonce Vinted pour la comparer sur Cardmarket.
   * @param a { title, description, status, brand, sellerLang }
   * @returns {{ ok: false, reason: string } | { ok: true, game, kind, name, number, queries, lang, cond, graded }}
   */
  function describeListing(a) {
    const title = clean(a.title);
    const text = `${title}\n${a.description || ''}`;
    const game = detectGame(a.brand, text);
    if (!game) return { ok: false, reason: 'jeu' };
    const low = norm(title);
    if (LOT.test(low)) return { ok: false, reason: 'lot' };
    if (OBJECT.test(low)) return { ok: false, reason: 'carte' };
    const { name, number } = parseCardTitle(title);
    if (!name) return { ok: false, reason: 'nom' };
    // Scellé : un mot de produit scellé, sans numéro de carte — sauf « Carte … promo coffret », « sortie de booster ».
    const at = low.search(SEALED);
    const single = /^\s*cartes?\b|\b(?:sorti|issu|tire)e?s? d[eu]\b/.test(low) || (at > 0 && /\bpromo\b/.test(low.slice(0, at)));
    const sealed = at >= 0 && !number && !single;
    // Marque « Pokémon » sur une peluche ou un tee-shirt : il faut un indice de carte.
    if (!sealed && !number && !CARDISH.test(norm(text))) return { ok: false, reason: 'carte' };
    let lang = detectLanguage(title, a.description);
    if (!lang.id && a.sellerLang && langOf(a.sellerLang)) lang = { id: a.sellerLang, sure: false, from: 'vendeur' };
    if (!lang.id) lang = { id: 2, sure: false, from: '' }; // vinted.fr : le plus souvent des cartes françaises
    const g = gradedIn(title) || gradedIn(a.description);
    const graded = g ? `${g[1].toUpperCase()} ${g[2].replace('.', ',')}` : '';
    // Scellé ou carte gradée : l'échelle d'états ne s'applique pas.
    const cond = sealed || graded ? { code: null, from: '' } : conditionFor(a.status, text);
    return { ok: true, game, kind: sealed ? 'sealed' : 'singles', name, number, queries: queriesFor(name, number), lang, cond, graded };
  }

  const langLabel = (lang) => {
    const l = langOf(lang.id);
    return l ? l.fr + (lang.sure ? '' : ' (supposé)') : 'toutes langues';
  };
  const condLabel = (code) => {
    const c = condOf(code);
    return c ? (c.id > 1 ? `${c.label} ou mieux` : c.label) : 'tous états';
  };

  /** Texte court sous le bouton : « japonais · Excellent ou mieux ». */
  function summary(d) {
    return [langLabel(d.lang), d.graded ? `gradée ${d.graded}` : d.kind === 'sealed' ? 'scellé' : condLabel(d.cond.code)].join(' · ');
  }

  /** Explication complète, pour l'infobulle. */
  function explain(d, status) {
    const out = [];
    const where = d.lang.from === 'titre' ? 'le titre' : 'la description';
    if (d.lang.from === 'vendeur') out.push('Langue lue dans une autre annonce de ce vendeur.');
    else if (!d.lang.from) out.push('Langue non précisée dans l’annonce : français supposé.');
    else out.push(d.lang.sure ? `Langue lue dans ${where}.` : `Langue incertaine dans ${where} : ${langOf(d.lang.id).fr} supposé.`);
    if (d.graded) out.push('Carte gradée : Cardmarket vend surtout des cartes non gradées, la comparaison est indicative.');
    else if (d.cond.code && d.cond.from === 'annonce') out.push(`État écrit par le vendeur : ${condOf(d.cond.code).label}.`);
    else if (d.cond.code) out.push(`État Vinted « ${clean(status)} » → Cardmarket « ${condLabel(d.cond.code)} ».`);
    out.push('Les deux se changent en un clic sur Cardmarket.');
    return out.join(' ');
  }

  // ---------- Adresse et fragment ----------

  function searchUrl(game, query, kind) {
    const q = new URLSearchParams({ searchString: query, mode: 'list' });
    if (kind === 'singles') q.set('category', '1');
    return `${ORIGIN}/fr/${encodeURIComponent(game)}/Products/Search?${q}`;
  }

  const encodeMarker = (m) => MARK + encodeURIComponent(JSON.stringify(m));

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e6 ? v : null);

  /** Relit le fragment d'une adresse. Tout y est vérifié : n'importe qui peut fabriquer un tel lien. */
  function decodeMarker(hash) {
    const h = String(hash || '');
    if (!h.startsWith(MARK)) return null;
    let v;
    try {
      v = JSON.parse(decodeURIComponent(h.slice(MARK.length)));
    } catch (e) {
      return null;
    }
    if (!v || typeof v !== 'object' || v.v !== 1) return null;
    return checkMarker(v);
  }

  function checkMarker(v) {
    if (!v || typeof v !== 'object') return null;
    const game = GAMES.some(([g]) => g === v.g) ? v.g : null;
    const n = clean(str(v.n, 80));
    if (!game || !n) return null;
    const qs = (Array.isArray(v.qs) ? v.qs : []).map((q) => clean(str(q, 80))).filter(Boolean).slice(0, 4);
    return {
      v: 1,
      g: game,
      k: v.k === 'sealed' ? 'sealed' : 'singles',
      t: clean(str(v.t, 120)), // titre de l'annonce
      n, // nom de la carte
      num: /^[A-Za-z0-9 ]{1,10}(?:\/[A-Za-z0-9-]{1,8})?$/.test(str(v.num, 20)) ? v.num : '',
      qs: qs.length ? qs : [n],
      qi: Math.min(Math.max(parseInt(v.qi, 10) || 0, 0), 3), // recherche en cours
      l: langOf(v.l) ? v.l : 0, // langue (0 = toutes)
      ls: v.ls ? 1 : 0, // langue sûre
      lf: ['titre', 'description', 'vendeur'].includes(v.lf) ? v.lf : '',
      c: condOf(v.c) ? v.c : '', // état minimum
      st: clean(str(v.st, 40)), // état affiché par Vinted
      gr: clean(str(v.gr, 12)), // gradée
      p: num(v.p), // prix de l'annonce
      tp: num(v.tp), // avec la protection acheteurs
      sh: num(v.sh), // envoi (absent : inconnu)
      u: /^\/items\/\d{1,15}$/.test(str(v.u, 40)) ? v.u : '', // annonce d'origine
      en: v.en ? 1 : 0, // recherche par le nom anglais déjà tentée
      lo: typeof v.lo === 'string' && /^[a-z]{2}$/.test(v.lo) ? v.lo : '', // langue du site à retrouver après une recherche en anglais
      a: v.a ? 1 : 0, // filtres déjà posés sur la fiche
      d: langOf(v.d) ? v.d : 0, // langue du filtre retiré faute d'offres
      x: v.x ? 1 : 0, // filtre choisi à la main dans le bandeau
      w: v.w ? 1 : 0, // fiche ouverte sans que son numéro soit celui de l'annonce
      h: Math.min(Math.max(parseInt(v.h, 10) || 0, 0), 9), // redirections déjà faites
    };
  }

  /**
   * Adresse Cardmarket pour une annonce décrite par describeListing.
   * @param extra { title, status, price, total, shipping, url }
   */
  function cardmarketUrl(d, extra) {
    const x = extra || {};
    const path = (String(x.url || '').match(/\/items\/\d+/) || [''])[0];
    const m = checkMarker({
      v: 1,
      g: d.game,
      k: d.kind,
      t: x.title || d.name,
      n: d.name,
      num: d.number,
      qs: d.queries,
      qi: 0,
      l: d.lang.id,
      ls: d.lang.sure,
      lf: d.lang.from,
      c: d.cond.code || '',
      st: x.status || '',
      gr: d.graded,
      p: x.price,
      tp: x.total,
      sh: x.shipping,
      u: path,
    });
    if (!m) return '';
    // Champs vides retirés : l'adresse reste courte.
    for (const k of Object.keys(m)) if (m[k] === '' || m[k] === null || (m[k] === 0 && k !== 'sh')) delete m[k]; // envoi offert : 0 se garde
    m.v = 1;
    return searchUrl(d.game, d.queries[0], d.kind) + encodeMarker(m);
  }

  // ---------- Cardmarket : port et meilleure offre ----------

  const SHIPPING = { buyerCountry: 'FR', domestic: 1.6, international: 2.2, trackedThreshold: 25, trackedDomestic: 3.5, trackedInternational: 5.5, insuredThreshold: 100, insuredDomestic: 7, insuredInternational: 12 };

  /** Port estimé d'une commande d'une seule carte (mêmes paliers que le reste de l'extension). */
  function shipEstimate(cfg, countryCode, price) {
    const c = Object.assign({}, SHIPPING, cfg || {});
    const dom = !!countryCode && countryCode === c.buyerCountry;
    if (c.insuredThreshold > 0 && price >= c.insuredThreshold) return dom ? c.insuredDomestic : c.insuredInternational;
    if (c.trackedThreshold > 0 && price >= c.trackedThreshold) return dom ? c.trackedDomestic : c.trackedInternational;
    return dom ? c.domestic : c.international;
  }

  /**
   * Offre la moins chère : { price, ship, total, country } ou null. Port compris, sauf « byPrice » (envoi Vinted
   * inconnu : on compare alors les prix seuls).
   */
  function bestOffer(offers, cfg, byPrice) {
    let best = null;
    for (const o of offers || []) {
      if (!o || typeof o.price !== 'number') continue;
      const code = (o.seller && o.seller.countryCode) || '';
      const ship = shipEstimate(cfg, code, o.price);
      const total = round2(o.price + ship);
      if (!best || (byPrice ? o.price < best.price : total < best.total)) best = { price: o.price, ship, total, country: code };
    }
    return best;
  }

  /** Les deux totaux et l'écart : { vinted, cardmarket, withShipping, diff } (diff > 0 : Cardmarket moins cher). */
  function verdict(m, best) {
    if (!best || m.tp == null) return null;
    const withShipping = m.sh != null;
    const vinted = round2(m.tp + (withShipping ? m.sh : 0));
    const cardmarket = withShipping ? best.total : best.price;
    return { vinted, cardmarket, withShipping, diff: round2(vinted - cardmarket) };
  }

  // ---------- Cardmarket : arrivée ----------

  const STORE = 'cmrv.compare';

  function land(root) {
    const doc = root.document;
    const loc = root.location;
    const CMR = root.CMR;
    if (!CMR || !CMR.cm || !CMR.analyzer) return;
    const cm = CMR.cm;
    const here = cm.parseUrl(loc.href);
    if (!here) return;
    const key = cm.productKey(loc.href);
    const isSearch = here.rest[0] === 'Products' && here.rest[1] === 'Search';

    const read = () => {
      try {
        const v = JSON.parse(root.sessionStorage.getItem(STORE));
        // En attente (recherche en cours) : dix minutes ; fiche choisie : une demi-heure.
        return v && Date.now() - v.t < (v.pending ? 10 : 30) * 60000 ? v : null;
      } catch (e) {
        return null;
      }
    };
    const write = (v) => {
      try {
        if (v) root.sessionStorage.setItem(STORE, JSON.stringify(Object.assign({ t: Date.now() }, v)));
        else root.sessionStorage.removeItem(STORE);
      } catch (e) {
        /* stockage indisponible : le fragment de l'adresse suffit */
      }
    };

    // Le fragment d'abord ; à défaut ce que cet onglet a gardé (page de vérification passée entre-temps, filtre
    // changé avec le formulaire de Cardmarket : l'adresse n'a plus de fragment).
    let m = decodeMarker(loc.hash);
    const fromHash = !!m;
    const kept = read();
    if (!m && kept) {
      const k = checkMarker(kept.m);
      if (k && (kept.pending || (key && key === kept.key))) m = k;
    }
    if (!m) return;
    if (/^(Just a moment|Un instant|Einen Moment|Un momento)/i.test(doc.title) || doc.querySelector('#challenge-form, #challenge-running')) {
      return void write({ m, pending: true, key: '' }); // vérification de Cardmarket : on reprendra sur la vraie page
    }
    // Une fois lu, le fragment quitte la barre d'adresse : l'onglet garde la comparaison de son côté.
    if (fromHash) {
      try {
        root.history.replaceState(root.history.state, '', loc.pathname + loc.search);
      } catch (e) {
        /* sans importance */
      }
    }

    const productUrl = (k, mark) => {
      const q = new URLSearchParams();
      if (mark.l) q.set('language', String(mark.l));
      const c = condOf(mark.c);
      if (c && c.id > 1 && c.id < 7 && cm.productKind(k) === 'single') q.set('minCondition', String(c.id));
      const s = q.toString();
      return cm.keyToUrl(k, mark.lo || here.locale) + (s ? '?' + s : '') + encodeMarker(mark);
    };
    const go = (url, mark) => {
      write({ m: mark, pending: true, key: '' });
      loc.replace(url);
    };

    // Recherche suivante quand rien ne porte le bon numéro : par le nom anglais lu dans l'adresse d'une fiche du même
    // nom (Cardmarket ne range peut-être cette carte que sous ce nom : extensions japonaises), sinon la requête
    // suivante, plus large. Trois recherches de plus au maximum. Renvoie true si une page est en train de s'ouvrir.
    const base = (s) => norm(clean(String(s).replace(SUFFIX, '')));
    const search = (mark, locale) => go(searchUrl(mark.g, mark.qs[mark.qi], mark.k).replace('/fr/', `/${locale}/`) + encodeMarker(mark), mark);
    function widen(sameName) {
      if (m.h >= 3) return false;
      const en = !m.en && m.num && sameName ? englishFromKey(sameName.key) : '';
      if (en && base(en) !== base(m.n)) {
        const qs = [...new Set([`${clean(en.replace(SUFFIX, '')) || en} ${m.num.split('/')[0]}`, en])];
        search(Object.assign({}, m, { en: 1, lo: here.locale, n: en, qs, qi: 0, h: m.h + 1 }), 'en');
        return true;
      }
      if (m.qi + 1 >= m.qs.length) return false;
      search(Object.assign({}, m, { qi: m.qi + 1, h: m.h + 1 }), here.locale);
      return true;
    }

    if (isSearch) return void onSearch();
    if (key && doc.querySelector('h1')) return void onProduct();
    write({ m, pending: false, key: (kept && kept.key) || '' });

    function onSearch() {
      const rank = CMR.analyzer.rankCandidates(cm.parseSearchPage(doc), { name: m.n, number: m.num, expansion: '' }, m.k === 'sealed' ? 'sealed' : 'singles');
      const hit = (c) => !m.num || (c.detail && c.detail.number);
      const sure = rank.auto && hit(rank.auto) ? rank.auto : null;
      if (sure && m.h < 4) {
        const mark = Object.assign({}, m, { a: 1, h: m.h + 1 });
        return go(productUrl(sure.key, mark), mark);
      }
      const matches = rank.candidates.filter((c) => m.num && c.detail && c.detail.number);
      // Rien au bon numéro — ou, pour une annonce sans numéro, rien du tout : on élargit. Des résultats sans numéro
      // à comparer se choisissent à la main.
      if (m.num ? !matches.length : !rank.candidates.length) {
        if (widen(rank.candidates.find((c) => base(cm.searchableName(c.name)) === base(m.n)))) return;
      }
      write({ m, pending: true, key: '' }); // le choix à la main garde la comparaison
      // Les liens des résultats mènent à la fiche déjà filtrée ; ceux au bon numéro sont mis en avant.
      const good = new Set(matches.map((c) => c.key));
      for (const row of doc.querySelectorAll('[id^="productRow"]')) {
        for (const a of row.querySelectorAll('a[href*="/Products/"]')) {
          const k = cm.productKey(a.getAttribute('href'));
          if (!k) continue;
          a.setAttribute('href', productUrl(k, Object.assign({}, m, { a: 1 })));
          if (good.has(k)) row.style.cssText += ';outline:2px solid #12a150;outline-offset:-2px;background:rgba(18,161,80,.08)';
        }
      }
      banner({ search: true, found: rank.candidates.length, matches: matches.length });
    }

    function onProduct() {
      const cur = new URLSearchParams(loc.search);
      if (!m.a) {
        // Arrivée directe sur la fiche (recherche à un seul résultat). Même exigence que dans une liste : son numéro
        // doit être celui de l'annonce. Sinon on élargit la recherche ; à défaut, le bandeau prévient sans comparer.
        const nb = CMR.analyzer.normNumber(m.num);
        const fits = !nb || CMR.analyzer.normNumber(cm.parseProductInfo(doc).number) === nb || new RegExp(`(^|[^0-9])${nb}$`).test(CMR.analyzer.normNumber(key.split('/').pop()));
        if (!fits) {
          if (fromHash && widen({ key })) return;
          m = Object.assign({}, m, { w: 1 });
        }
        // Les filtres n'y sont pas encore.
        const mark = Object.assign({}, m, { a: 1, h: m.h + 1 });
        const want = new URL(productUrl(key, mark));
        const same = (want.searchParams.get('language') || '') === (cur.get('language') || '') && (want.searchParams.get('minCondition') || '') === (cur.get('minCondition') || '');
        m = mark;
        if (!same && mark.h <= 4) return go(want.href, mark);
      }
      const offers = cm.parseOfferRows(doc);
      // Langue seulement supposée et aucune offre : c'est sans doute une autre langue (fiche japonaise…).
      const own = (fromHash || (kept && kept.pending)) && !m.x && cur.get('language') === String(m.l);
      if (!offers.length && m.l && !m.ls && !m.d && own && m.h < 6) {
        const mark = Object.assign({}, m, { l: 0, d: m.l, h: m.h + 1 });
        return go(productUrl(key, mark), mark);
      }
      write({ m, pending: false, key });
      const render = (cfg) => banner({ offers, cfg, cur });
      render(null);
      // Estimation du port : celle des réglages de l'extension, s'ils sont lisibles.
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get('cmr.settings').then(
        (r) => {
          const s = r && r['cmr.settings'];
          if (s && s.shipping) render(s.shipping);
        },
        () => {}
      );
    }

    // ----- bandeau -----

    function banner(ctx) {
      let host = doc.getElementById('cmrc-host');
      if (!host) {
        host = doc.createElement('div');
        host.id = 'cmrc-host';
        host.attachShadow({ mode: 'open' });
        const anchor = doc.querySelector('.page-title-container') || doc.querySelector('main h1, section h1') || doc.querySelector('h1');
        if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(host, anchor);
        else (doc.body || doc.documentElement).prepend(host);
      }
      const sh = host.shadowRoot;
      sh.textContent = '';
      const el = (tag, cls, text) => {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
      };
      const style = el('style');
      style.textContent = `
        :host{all:initial}
        .box{margin:0 0 14px;padding:12px 14px;border:2px solid #12a150;border-radius:10px;background:#f2fbf6;color:#14251b;font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
        .head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}
        .head b{color:#0b7a3b}
        .head .t{flex:1;min-width:180px;font-weight:600}
        .head a,.head button{font:inherit;font-size:12px;color:#0b7a3b;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
        .cols{display:flex;flex-wrap:wrap;gap:8px 28px;margin:6px 0}
        .col small{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.4px;opacity:.65}
        .col strong{font-size:18px}
        .col span{font-size:12px;opacity:.8}
        .verdict{font-weight:700;padding:3px 10px;border-radius:999px;align-self:center}
        .verdict.cm{background:#12a150;color:#fff}
        .verdict.vi{background:#007782;color:#fff}
        .verdict.eq{background:#e5e7eb;color:#111}
        .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;font-size:12px}
        .row>span{opacity:.75;min-width:52px}
        .chip{padding:2px 9px;border:1px solid #9ad3b2;border-radius:999px;color:#0b5a2d;text-decoration:none;background:#fff}
        .chip.on{background:#12a150;border-color:#12a150;color:#fff;font-weight:700}
        .note{margin-top:6px;font-size:12px;opacity:.8}
      `;
      sh.appendChild(style);
      const box = el('div', 'box');
      sh.appendChild(box);

      const head = el('div', 'head');
      head.appendChild(el('b', '', 'Regroupeur'));
      head.appendChild(el('span', 't', `Annonce Vinted : « ${m.t || m.n} »`));
      if (m.u) {
        const back = el('a', '', 'Revoir l’annonce');
        back.href = VINTED + m.u;
        back.target = '_blank';
        back.rel = 'noopener';
        head.appendChild(back);
      }
      const close = el('button', '', 'Fermer');
      close.type = 'button';
      close.addEventListener('click', () => {
        write(null);
        host.remove();
      });
      head.appendChild(close);
      box.appendChild(head);

      if (ctx.search) {
        const what = m.num ? `n° ${m.num}` : 'cette carte';
        box.appendChild(
          el(
            'div',
            '',
            !ctx.found
              ? `Aucune carte trouvée pour « ${m.qs[m.qi] || m.n} ». Essaie une autre recherche : la comparaison suivra.`
              : ctx.matches
                ? `Plusieurs cartes portent le ${what} (encadrées en vert) : choisis la bonne.`
                : `Je n’ai pas reconnu ${what} dans ces résultats : choisis la carte.`
          )
        );
        box.appendChild(el('div', 'note', `La fiche s’ouvrira avec les filtres de l’annonce : ${[m.l ? langOf(m.l).fr : 'toutes langues', m.gr ? `gradée ${m.gr}` : condLabel(m.c)].join(' · ')}.`));
        return;
      }

      const best = bestOffer(ctx.offers, ctx.cfg, m.sh == null);
      const v = m.w ? null : verdict(m, best); // fiche au mauvais numéro : pas d'écart chiffré
      const cols = el('div', 'cols');
      const col = (title, big, small) => {
        const c = el('div', 'col');
        c.appendChild(el('small', '', title));
        c.appendChild(el('strong', '', big));
        if (small) c.appendChild(el('span', '', ' ' + small));
        cols.appendChild(c);
      };
      if (m.tp != null) {
        col('Sur Vinted', euro(m.tp + (m.sh || 0)), m.sh != null ? `avec envoi (${euro(m.sh)}) et protection${m.st ? ` · ${m.st}` : ''}` : `protection incluse, hors envoi${m.st ? ` · ${m.st}` : ''}`);
      }
      if (best && m.sh == null) col('Ici, la moins chère', euro(best.price), `hors port (≈ ${euro(best.ship)} en plus${best.country ? `, ${best.country}` : ''})`);
      else if (best) col('Ici, la moins chère', `≈ ${euro(best.total)}`, `${euro(best.price)} + ≈ ${euro(best.ship)} de port${best.country ? ` (${best.country})` : ''}`);
      else col('Ici', 'aucune offre', 'avec ces filtres');
      if (v) {
        const gap = Math.abs(v.diff);
        const cls = gap < 0.1 ? 'eq' : v.diff > 0 ? 'cm' : 'vi';
        const text = gap < 0.1 ? 'Prix équivalents' : `${v.diff > 0 ? 'Cardmarket' : 'Vinted'} moins cher de ≈ ${euro(gap)}${v.withShipping ? '' : ' (hors envoi)'}`;
        cols.appendChild(el('div', `verdict ${cls}`, text));
      }
      box.appendChild(cols);

      // Filtres réellement posés sur la page (ceux de l'annonce, ou ceux choisis depuis).
      const curLang = (ctx.cur.get('language') || '').split(',').filter(Boolean).map(Number);
      const curCond = Number(ctx.cur.get('minCondition')) || 0;
      const single = cm.productKind(key) === 'single';
      const link = (label, on, mark) => {
        const a = el('a', `chip${on ? ' on' : ''}`, label);
        a.href = productUrl(key, mark);
        return a;
      };
      const langs = el('div', 'row');
      langs.appendChild(el('span', '', 'Langue'));
      const shown = [...new Set([2, 7, 1, m.l].filter(Boolean))];
      // Un choix fait ici est celui de l'utilisateur (x) : plus de langue « supposée », plus de filtre retiré d'office.
      const chosen = (l) => Object.assign({}, m, { l, ls: 1, lf: '', a: 1, d: 0, x: 1 });
      for (const id of shown) langs.appendChild(link(langOf(id).fr, curLang.length === 1 && curLang[0] === id, chosen(id)));
      langs.appendChild(link('toutes', !curLang.length, chosen(0)));
      box.appendChild(langs);
      if (single) {
        const conds = el('div', 'row');
        conds.appendChild(el('span', '', 'État'));
        for (const c of CONDS.slice(1, 6)) conds.appendChild(link(c.code, curCond === c.id, Object.assign({}, m, { c: c.code, a: 1, x: 1 })));
        conds.appendChild(link('tous', !curCond, Object.assign({}, m, { c: '', a: 1, x: 1 })));
        conds.appendChild(el('span', '', '(cet état ou mieux)'));
        box.appendChild(conds);
      }

      const notes = [];
      if (m.w) notes.push(`Cette fiche ne porte pas le n° ${m.num} de l’annonce : vérifie que c’est la bonne carte avant de comparer.`);
      if (m.d) notes.push(`Aucune offre en ${langOf(m.d).fr} avec ces filtres : toutes les langues sont affichées (la langue de l’annonce n’était pas sûre).`);
      else if (m.l && !m.ls) {
        const why = m.lf === 'vendeur' ? 'reprise d’une autre annonce du vendeur' : m.lf ? `incertaine dans ${m.lf === 'titre' ? 'le titre' : 'la description'} de l’annonce : ${langOf(m.l).fr} supposé` : 'non précisée dans l’annonce : français supposé';
        notes.push(`Langue ${why} — vérifie sur les photos.`);
      }
      else if (m.l && m.lf) notes.push(`Langue lue dans ${m.lf === 'titre' ? 'le titre' : 'la description'} de l’annonce.`);
      if (m.gr) notes.push(`Carte gradée ${m.gr} sur Vinted : ici ce sont surtout des cartes non gradées.`);
      else if (m.c && m.st) notes.push(`État Vinted « ${m.st} » comparé à « ${condLabel(m.c)} ».`);
      notes.push('Port estimé pour une carte seule.');
      box.appendChild(el('div', 'note', notes.join(' ')));
    }
  }

  return {
    LANGS,
    CONDS,
    norm,
    detectGame,
    languagesIn,
    detectLanguage,
    conditionFor,
    parseCardTitle,
    queriesFor,
    englishFromKey,
    describeListing,
    summary,
    explain,
    langLabel,
    condLabel,
    searchUrl,
    encodeMarker,
    decodeMarker,
    cardmarketUrl,
    shipEstimate,
    bestOffer,
    verdict,
    land,
  };
});
