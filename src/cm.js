/*
 * Regroupeur — tout ce qui dépend de Cardmarket : identifiants des filtres,
 * construction des URL et lecture des pages (DOM).
 *
 * Les pages sont toujours lues en anglais (/en/) : les infobulles (« Item
 * location: France », « Professional »…) y ont un libellé stable. Les liens
 * affichés à l'utilisateur reprennent ensuite la langue de son site.
 *
 * Cardmarket ignore silencieusement les filtres d'URL qu'il ne comprend pas :
 * chaque offre est donc revérifiée côté client (voir analyzer.js).
 */
(function (root) {
  'use strict';
  const CMR = (root.CMR = root.CMR || {});

  const ORIGIN = 'https://www.cardmarket.com';

  const LANGUAGES = [
    { id: 1, en: 'English', fr: 'Anglais', short: 'EN' },
    { id: 2, en: 'French', fr: 'Français', short: 'FR' },
    { id: 3, en: 'German', fr: 'Allemand', short: 'DE' },
    { id: 4, en: 'Spanish', fr: 'Espagnol', short: 'ES' },
    { id: 5, en: 'Italian', fr: 'Italien', short: 'IT' },
    { id: 6, en: 'S-Chinese', fr: 'Chinois simplifié', short: 'ZH', alias: ['Simplified Chinese', 'Chinese'] },
    { id: 7, en: 'Japanese', fr: 'Japonais', short: 'JP', alias: ['JA'] },
    { id: 8, en: 'Portuguese', fr: 'Portugais', short: 'PT' },
    { id: 9, en: 'Russian', fr: 'Russe', short: 'RU' },
    { id: 10, en: 'Korean', fr: 'Coréen', short: 'KO', alias: ['KR'] },
    { id: 11, en: 'T-Chinese', fr: 'Chinois traditionnel', short: 'TW', alias: ['Traditional Chinese'] },
  ];

  // Du meilleur au pire : minCondition=2 signifie « Near Mint ou mieux ».
  const CONDITIONS = [
    { code: 'MT', id: 1, en: 'Mint', fr: 'Mint' },
    { code: 'NM', id: 2, en: 'Near Mint', fr: 'Near Mint' },
    { code: 'EX', id: 3, en: 'Excellent', fr: 'Excellent' },
    { code: 'GD', id: 4, en: 'Good', fr: 'Good' },
    { code: 'LP', id: 5, en: 'Light Played', fr: 'Light Played' },
    { code: 'PL', id: 6, en: 'Played', fr: 'Played' },
    { code: 'PO', id: 7, en: 'Poor', fr: 'Poor' },
  ];

  // Identifiants du filtre « sellerCountry » (32 et 34 n'existent pas).
  const COUNTRIES = [
    [1, 'AT', 'Austria', 'Autriche'],
    [2, 'BE', 'Belgium', 'Belgique'],
    [3, 'BG', 'Bulgaria', 'Bulgarie'],
    [4, 'CH', 'Switzerland', 'Suisse'],
    [5, 'CY', 'Cyprus', 'Chypre'],
    [6, 'CZ', 'Czech Republic', 'Tchéquie'],
    [7, 'DE', 'Germany', 'Allemagne'],
    [8, 'DK', 'Denmark', 'Danemark'],
    [9, 'EE', 'Estonia', 'Estonie'],
    [10, 'ES', 'Spain', 'Espagne'],
    [11, 'FI', 'Finland', 'Finlande'],
    [12, 'FR', 'France', 'France'],
    [13, 'GB', 'United Kingdom', 'Royaume-Uni'],
    [14, 'GR', 'Greece', 'Grèce'],
    [15, 'HU', 'Hungary', 'Hongrie'],
    [16, 'IE', 'Ireland', 'Irlande'],
    [17, 'IT', 'Italy', 'Italie'],
    [18, 'LI', 'Liechtenstein', 'Liechtenstein'],
    [19, 'LT', 'Lithuania', 'Lituanie'],
    [20, 'LU', 'Luxembourg', 'Luxembourg'],
    [21, 'LV', 'Latvia', 'Lettonie'],
    [22, 'MT', 'Malta', 'Malte'],
    [23, 'NL', 'Netherlands', 'Pays-Bas'],
    [24, 'NO', 'Norway', 'Norvège'],
    [25, 'PL', 'Poland', 'Pologne'],
    [26, 'PT', 'Portugal', 'Portugal'],
    [27, 'RO', 'Romania', 'Roumanie'],
    [28, 'SE', 'Sweden', 'Suède'],
    [29, 'SG', 'Singapore', 'Singapour'],
    [30, 'SI', 'Slovenia', 'Slovénie'],
    [31, 'SK', 'Slovakia', 'Slovaquie'],
    [33, 'CA', 'Canada', 'Canada'],
    [35, 'HR', 'Croatia', 'Croatie'],
    [36, 'JP', 'Japan', 'Japon'],
    [37, 'IS', 'Iceland', 'Islande'],
  ].map(([id, code, en, fr]) => ({ id, code, en, fr }));

  const SELLER_TYPES = [
    { key: 'private', id: 0, fr: 'Particulier' },
    { key: 'professional', id: 1, fr: 'Professionnel' },
    { key: 'powerseller', id: 2, fr: 'Powerseller' },
  ];

  // ---------- Petits utilitaires ----------

  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ /g, ' ')
      .toLowerCase()
      .trim();

  const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  function text(el) {
    return el ? clean(el.textContent) : '';
  }

  /** Texte d'infobulle, qu'il soit brut (HTML servi) ou déjà transformé par Bootstrap (DOM vivant). */
  function tip(el) {
    if (!el || !el.getAttribute) return '';
    return clean(
      el.getAttribute('title') ||
        el.getAttribute('data-bs-original-title') ||
        el.getAttribute('data-original-title') ||
        el.getAttribute('data-bs-title') ||
        el.getAttribute('aria-label') ||
        ''
    );
  }

  const TIP_SELECTOR = '[title], [data-bs-original-title], [data-original-title], [data-bs-title], [aria-label]';

  /** '1,95 €' → 1.95 ; '1.234,56 €' → 1234.56 ; '12.50' → 12.5 */
  function parsePrice(value) {
    const m = String(value || '')
      .replace(/ /g, ' ')
      .match(/-?\d[\d.,\s]*/);
    if (!m) return null;
    let num = m[0].replace(/\s/g, '');
    if (num.includes(',')) num = num.replace(/\./g, '').replace(',', '.');
    else if (!/\.\d{1,2}$/.test(num)) num = num.replace(/\./g, '');
    const n = parseFloat(num);
    return Number.isFinite(n) ? n : null;
  }

  function parseIntLoose(value) {
    const m = String(value || '')
      .replace(/ /g, ' ')
      .match(/\d[\d.,]*/);
    if (!m) return null;
    const n = parseInt(m[0].replace(/[.,]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function findLanguage(label) {
    const n = norm(label);
    if (!n) return null;
    return (
      LANGUAGES.find(
        (l) =>
          norm(l.en) === n ||
          norm(l.fr) === n ||
          norm(l.short) === n ||
          (l.alias || []).some((a) => norm(a) === n)
      ) || null
    );
  }

  function findCondition(label) {
    const n = norm(label);
    if (!n) return null;
    return CONDITIONS.find((c) => norm(c.code) === n || norm(c.en) === n) || null;
  }

  function findCountry(label) {
    const n = norm(label);
    if (!n) return null;
    return COUNTRIES.find((c) => norm(c.en) === n || norm(c.fr) === n || norm(c.code) === n) || null;
  }

  // ---------- URL ----------

  /** Découpe une URL Cardmarket : { locale, game, rest: [...] } ou null. */
  function parseUrl(url) {
    let u;
    try {
      u = new URL(url, ORIGIN);
    } catch (e) {
      return null;
    }
    if (!/(^|\.)cardmarket\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2 || !/^[a-z]{2}$/.test(parts[0])) return null;
    return { locale: parts[0], game: parts[1], rest: parts.slice(2), search: u.searchParams };
  }

  /** Identifiant stable d'un produit : « Pokemon/Products/Singles/Extension/Carte ». */
  function productKey(url) {
    const p = parseUrl(url);
    if (!p || p.rest[0] !== 'Products' || p.rest.length < 3 || p.rest[1] === 'Search') return null;
    return [p.game, ...p.rest].join('/');
  }

  function keyToUrl(key, locale = 'en') {
    return `${ORIGIN}/${locale}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  function gameOfKey(key) {
    return String(key || '').split('/')[0] || 'Pokemon';
  }

  /** Paramètres serveur des pages produit (la vérification finale reste côté client). */
  function productFilterParams(f) {
    const q = new URLSearchParams();
    if (f.languages && f.languages.length) q.set('language', [...f.languages].sort((a, b) => a - b).join(','));
    const cond = CONDITIONS.find((c) => c.code === f.minCondition);
    if (cond && cond.id > 1 && cond.id < 7) q.set('minCondition', String(cond.id)); // « Poor ou mieux » = aucun filtre
    if (f.sellerTypes && f.sellerTypes.length && f.sellerTypes.length < SELLER_TYPES.length) {
      const ids = f.sellerTypes.map((k) => SELLER_TYPES.find((t) => t.key === k)).filter(Boolean).map((t) => t.id);
      q.set('sellerType', ids.sort((a, b) => a - b).join(','));
    }
    if (f.sellerCountries && f.sellerCountries.length) {
      const ids = f.sellerCountries.map((c) => findCountry(c)).filter(Boolean).map((c) => c.id);
      if (ids.length) q.set('sellerCountry', ids.sort((a, b) => a - b).join(','));
    }
    // Versions spéciales : le site a connu les deux écritures, on envoie les deux.
    const flag = (name, v) => {
      if (v === 'only' || v === 'exclude') {
        const yn = v === 'only' ? 'Y' : 'N';
        q.set(name, yn);
        q.set(`extra[${name}]`, yn);
      }
    };
    if (f.special === 'exclude') {
      flag('isFoil', 'exclude');
      flag('isReverseHolo', 'exclude');
    }
    flag('isFirstEd', f.firstEd);
    if (f.excludeSignedAltered) {
      flag('isSigned', 'exclude');
      flag('isAltered', 'exclude');
    }
    return q;
  }

  function productFetchUrl(key, filters) {
    const q = productFilterParams(filters || {});
    const s = q.toString();
    return keyToUrl(key, 'en') + (s ? '?' + s : '');
  }

  // Catégories de la barre de recherche Cardmarket (select name="category").
  const SEARCH_KINDS = [
    { key: 'singles', category: 1, fr: 'Cartes' },
    { key: 'sealed', category: 4, fr: 'Coffrets, ETB, tins' },
    { key: 'boxes', category: 3, fr: 'Displays' },
    { key: 'boosters', category: 2, fr: 'Boosters' },
    { key: 'lots', category: 6, fr: 'Lots et collections' },
  ];

  function searchUrl(game, query, locale = 'en', kind = 'singles') {
    const q = new URLSearchParams({ searchString: query, mode: 'list' });
    const k = SEARCH_KINDS.find((x) => x.key === kind);
    // « category » = liste du champ de recherche (1 = cartes, 4 = scellé…), identique pour tous les jeux.
    // Surtout pas « idCategory » : sa numérotation change selon le jeu (51 = cartes Pokémon).
    if (k) q.set('category', String(k.category));
    return `${ORIGIN}/${locale}/${encodeURIComponent(game)}/Products/Search?${q}`;
  }

  /** « single » pour une carte à l'unité, « sealed » pour tout le reste (coffrets, displays…). */
  function productKind(key) {
    const parts = String(key || '').split('/');
    return parts[1] === 'Products' && parts[2] && parts[2] !== 'Singles' ? 'sealed' : 'single';
  }

  /**
   * Toutes les cartes d'une extension, triées par numéro, 100 par page.
   * @param exp { slug } (ex. « Shrouded-Fable ») ou { id } (identifiant du filtre idExpansion)
   */
  function expansionListUrl(game, exp, locale = 'en', page = 1) {
    const q = new URLSearchParams({ mode: 'list', perSite: '100', sortBy: 'collectorsnumber_asc' });
    if (page > 1) q.set('site', String(page));
    let path = `${ORIGIN}/${locale}/${encodeURIComponent(game)}/Products/Singles`;
    if (exp.slug) path += '/' + encodeURIComponent(exp.slug);
    else q.set('idExpansion', String(exp.id));
    return `${path}?${q}`;
  }

  /** Extensions proposées dans le filtre des pages de liste / recherche : [{ id, name }]. */
  function parseExpansionOptions(doc) {
    const sel = doc.querySelector('select[name="idExpansion"]');
    if (!sel) return [];
    return [...sel.querySelectorAll('option')]
      .map((o) => ({ id: parseInt(o.getAttribute('value'), 10), name: text(o) }))
      .filter((o) => o.id > 0 && o.name);
  }

  /** « Page 1 of 2 » → { page: 1, pages: 2 } (1 page si pas de pagination). */
  function parsePagination(doc) {
    const box = doc.querySelector('#pagination') || (doc.querySelector('.pagination-control') || {}).parentElement;
    const m = box ? text(box).match(/(\d+)\D+(\d+)\+?\s*$/) || text(box).match(/(\d+)\s*(?:of|sur|von|de|di)\s*(\d+)/i) : null;
    return m ? { page: parseInt(m[1], 10), pages: parseInt(m[2], 10) } : { page: 1, pages: 1 };
  }

  function cartUrl(game, locale = 'en') {
    return `${ORIGIN}/${locale}/${encodeURIComponent(game)}/ShoppingCart`;
  }

  function sellerUrl(game, seller, locale = 'en') {
    return `${ORIGIN}/${locale}/${encodeURIComponent(game)}/Users/${encodeURIComponent(seller)}`;
  }

  /** Recherche d'une carte dans le stock d'un vendeur (filtre par nom). */
  function sellerStockSearchUrl(game, seller, name, locale = 'en') {
    const q = new URLSearchParams({ name });
    return `${sellerUrl(game, seller, locale)}/Offers/Singles?${q}`;
  }

  function loadMoreUrl(game) {
    return `${ORIGIN}/en/${encodeURIComponent(game)}/AjaxAction/Product_LoadMoreArticles`;
  }

  // ---------- Lecture des pages ----------

  const FLAG_TITLES = {
    foil: 'foil',
    'reverse holo': 'reverseHolo',
    'first edition': 'firstEd',
    '1st edition': 'firstEd',
    signed: 'signed',
    altered: 'altered',
    playset: 'playset',
  };

  function parseSeller(row) {
    const col = row.querySelector('.col-seller') || row;
    const link = col.querySelector('a[href*="/Users/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const fromHref = decodeURIComponent((href.split('/Users/')[1] || '').split(/[/?#]/)[0]);
    const seller = {
      name: text(link) || fromHref,
      country: '',
      countryCode: '',
      type: 'private',
      sales: null,
      available: null,
    };
    for (const el of col.querySelectorAll(TIP_SELECTOR)) {
      const t = tip(el);
      const loc = t.match(/^(?:Item location|Emplacement de l.article|Artikelstandort|Ubicación del artículo|Posizione dell.oggetto)\s*:\s*(.+)$/i);
      if (loc) {
        const c = findCountry(loc[1]);
        seller.country = c ? c.en : loc[1];
        seller.countryCode = c ? c.code : '';
        continue;
      }
      const sales = t.match(/([\d.,]+)\s*(?:Sales|Ventes|Verkäufe).*?([\d.,]+)\s*(?:Available|disponibles|verfügbar)/i);
      if (sales) {
        seller.sales = parseIntLoose(sales[1]);
        seller.available = parseIntLoose(sales[2]);
      }
    }
    if (seller.sales == null) {
      const badge = col.querySelector('.sell-count');
      if (badge) seller.sales = parseIntLoose(tip(badge)) ?? parseIntLoose(text(badge));
    }
    if (col.querySelector('.fonticon-users-powerseller')) seller.type = 'powerseller';
    else if (col.querySelector('.fonticon-users-professional')) seller.type = 'professional';
    return seller;
  }

  function parseOfferRow(row) {
    const id = (row.getAttribute('id') || '').replace(/\D+/g, '') || null;
    const attrs = row.querySelector('.product-attributes');
    const offer = {
      id,
      seller: parseSeller(row),
      productKey: null,
      productName: null,
      condition: null,
      languageId: null,
      language: null,
      flags: {},
      price: null,
      count: 1,
      comment: '',
    };

    // Sur la page stock d'un vendeur, la 1re colonne contient le produit.
    const productLink = row.querySelector('.col-seller a[href*="/Products/"]');
    if (productLink) {
      offer.productKey = productKey(productLink.getAttribute('href'));
      offer.productName = text(productLink);
    }

    if (attrs) {
      const cond = attrs.querySelector('.article-condition');
      if (cond) {
        const c = findCondition(text(cond)) || findCondition(tip(cond));
        const cls = (cond.getAttribute('class') || '').match(/condition-([a-z]{2})/);
        offer.condition = c ? c.code : cls ? cls[1].toUpperCase() : null;
      }
      for (const el of attrs.querySelectorAll(TIP_SELECTOR)) {
        if (el === cond || (cond && cond.contains(el))) continue;
        const cls = el.getAttribute('class') || '';
        if (cls.includes('expansion-symbol')) continue;
        const t = tip(el);
        if (!t || t.includes('<')) continue;
        const flag = FLAG_TITLES[norm(t)];
        if (flag) {
          offer.flags[flag] = true;
          continue;
        }
        if (!offer.language) {
          const l = findLanguage(t);
          if (l) {
            offer.language = l.en;
            offer.languageId = l.id;
          }
        }
      }
    }

    const comment = row.querySelector('.product-comments .text-truncate');
    if (comment) offer.comment = text(comment).slice(0, 160);

    const priceBox = row.querySelector('.col-offer .price-container') || row.querySelector('.price-container');
    if (priceBox) {
      // Prix barré éventuel (promotion) : on prend le premier prix non barré.
      for (const s of priceBox.querySelectorAll('span.color-primary, span.text-nowrap')) {
        if (s.closest('del, s, .text-decoration-line-through')) continue;
        const p = parsePrice(text(s));
        if (p != null) {
          offer.price = p;
          break;
        }
      }
    }
    if (offer.price == null) {
      const m = text(row.querySelector('.col-offer') || row).match(/\d[\d.,]*\s*€/);
      if (m) offer.price = parsePrice(m[0]);
    }
    const count = row.querySelector('.col-offer .item-count') || row.querySelector('.item-count');
    if (count) offer.count = parseIntLoose(text(count)) || 1;
    return offer;
  }

  function parseOfferRows(root) {
    const rows = root.querySelectorAll('div.article-row');
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      if (seen.has(row)) continue;
      seen.add(row);
      const o = parseOfferRow(row);
      if (o.price != null) out.push(o);
    }
    return out;
  }

  /** Infos produit (titre, extension, numéro, prix de tendance) — marche aussi sur le DOM vivant. */
  function parseProductInfo(doc) {
    const h1 = doc.querySelector('.page-title-container h1') || doc.querySelector('h1');
    let name = '';
    let subtitle = '';
    if (h1) {
      const sub = h1.querySelector('span');
      subtitle = text(sub);
      name = text(h1);
      if (subtitle && name.endsWith(subtitle)) name = name.slice(0, name.length - subtitle.length).trim();
    }
    const info = {
      name,
      expansion: subtitle.replace(/\s+-\s+[^-]+$/, '').trim(),
      category: (subtitle.match(/-\s+([^-]+)$/) || [])[1] || '',
      number: '',
      rarity: '',
      idProduct: null,
      trend: null,
      from: null,
      available: null,
      image: '',
    };
    const dl = doc.querySelector('#tabContent-info dl') || doc.querySelector('.info-list-container dl') || doc.querySelector('dl.labeled');
    if (dl) {
      for (const dt of dl.querySelectorAll('dt')) {
        const dd = dt.nextElementSibling;
        if (!dd || dd.tagName.toLowerCase() !== 'dd') continue;
        const label = norm(text(dt));
        const value = text(dd);
        if (/^(number|numero|nummer)$/.test(label)) info.number = value;
        else if (/^(rarity|rarete|seltenheit)$/.test(label)) {
          const svg = dd.querySelector('svg');
          info.rarity = tip(svg) || value;
        } else if (/^(printed in|extension|erschienen in|edicion)$/.test(label)) {
          const a = dd.querySelector('a[href*="/Expansions/"]');
          info.expansion = value || tip(a) || info.expansion;
        } else if (/^(available items|articles disponibles|verfugbare artikel)$/.test(label)) info.available = parseIntLoose(value);
        else if (/^(from|a partir de|ab)$/.test(label)) info.from = parsePrice(value);
        else if (/^(price trend|tendance des prix|preis-trend)$/.test(label)) info.trend = parsePrice(value);
      }
    }
    const idInput =
      doc.querySelector('form.article-filter-form input[name="idProduct"]') ||
      doc.querySelector('input[name="idProduct"]');
    if (idInput) info.idProduct = parseIntLoose(idInput.getAttribute('value'));
    const img = doc.querySelector('#image img.is-front') || doc.querySelector('#image img');
    if (img) {
      const src = img.getAttribute('src') || img.getAttribute('data-echo') || '';
      if (/^(https?:)?\/\//.test(src) && !src.endsWith('transparent.gif')) info.image = src.startsWith('//') ? 'https:' + src : src;
    }
    return info;
  }

  function parseLoadMoreForm(doc) {
    const form = doc.querySelector('form[data-ajax-action="Product_LoadMoreArticles"]');
    if (!form || !doc.querySelector('#loadMoreButton')) return null;
    const fields = {};
    for (const i of form.querySelectorAll('input[type="hidden"][name]')) fields[i.getAttribute('name')] = i.getAttribute('value') || '';
    return fields;
  }

  function parseProductPage(doc) {
    return {
      product: parseProductInfo(doc),
      offers: parseOfferRows(doc),
      loadMore: parseLoadMoreForm(doc),
    };
  }

  function b64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** Réponse XML du bouton « Show more results ». */
  function parseLoadMoreXml(xml) {
    const field = (tag) => {
      const m = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? m[1] : null;
    };
    const rows = field('rows');
    if (rows == null) {
      const msg = field('systemMessage');
      let detail = '';
      try {
        detail = msg ? b64ToUtf8(msg).replace(/<[^>]+>/g, ' ') : '';
      } catch (e) {
        detail = '';
      }
      const err = new Error(clean(detail) || 'Réponse inattendue au chargement des offres suivantes');
      err.code = 'LOAD_MORE_REFUSED';
      throw err;
    }
    const nextPage = parseInt(field('newPage') || '0', 10);
    return {
      html: b64ToUtf8(rows),
      nextPage: nextPage > 0 ? nextPage : null,
      capped: field('maxPaginatedResultsReached') === '1',
    };
  }

  /** Résultats d'une recherche produit (mode liste). */
  function parseSearchPage(doc) {
    const out = [];
    const seen = new Set();
    for (const row of doc.querySelectorAll('[id^="productRow"]')) {
      const a = row.querySelector('[data-testid="name"] a[href*="/Products/"]') || row.querySelector('a[href*="/Products/"]');
      if (!a) continue;
      const key = productKey(a.getAttribute('href'));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const exp = row.querySelector('[data-testid="expansion"] [title], a.expansion-symbol');
      out.push({
        key,
        image: thumbnail(row.querySelector('.thumbnail-icon')),
        name: text(a),
        expansion: tip(exp),
        number: text(row.querySelector('[data-testid="collector_number"]')).replace(/^#\s*/, ''),
        from: parsePrice(text(row.querySelector('[data-testid="from_price"]'))),
        available: parseIntLoose(text(row.querySelector('[data-testid="availability"]'))),
      });
    }
    return out;
  }

  /** Wants list (DOM vivant, connecté) : liens produits + quantités quand elles sont lisibles. */
  function parseWantsPage(doc) {
    const out = [];
    const seen = new Map();
    const scope = doc.querySelector('#WantsListTable, .wants-list, main') || doc.body;
    for (const a of scope.querySelectorAll('a[href*="/Products/"]')) {
      const key = productKey(a.getAttribute('href'));
      if (!key || !key.includes('/Products/Singles/')) continue;
      const row = a.closest('tr, [id^="wantRow"], .row, .article-row') || a.parentElement;
      let qty = 1;
      const amount = row && row.querySelector('.amount, [class*="amount"], [data-testid="amount"], input[name*="amount"]');
      if (amount) qty = parseIntLoose(amount.value || text(amount)) || 1;
      if (seen.has(key)) continue;
      const item = { key, name: text(a) || tip(a), qty: Math.min(Math.max(qty, 1), 99) };
      seen.set(key, item);
      out.push(item);
    }
    return out;
  }

  /** Image d'aperçu rangée dans l'infobulle : data-bs-title="<img src=&quot;…&quot;>". */
  function thumbnail(el) {
    if (!el) return '';
    const raw = el.getAttribute('data-bs-title') || el.getAttribute('title') || el.getAttribute('data-bs-original-title') || '';
    const m = raw.match(/src=["']([^"']+)["']/);
    if (!m) return '';
    const src = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
    return /^https:\/\/[a-z0-9.-]*cardmarket\.com\//i.test(src) ? src : '';
  }

  // ---------- Cartes gradées (PSA, CGC…) ----------
  // Cardmarket n'a pas d'attribut « gradée » : les vendeurs l'écrivent dans le commentaire.

  const GRADERS = [
    ['PSA', /\bPSA(?![a-z])/i],
    ['BGS', /\b(?:BGS|BECKETT)(?![a-z])/i],
    ['CGC', /\bCGC(?![a-z])/i],
    ['SGC', /\bSGC(?![a-z])/i],
    ['PCA', /\bPCA(?![a-z])/i],
    ['Collect Aura', /\bCOLLECT\s*AURA\b/i],
    ['AOG', /\bAOG\b/i],
  ];
  // « PSA ready », « candidate PSA 10 », « parfaite pour grading », « non gradée »… = carte loose.
  const NOT_GRADED = [
    /\b(?:ready|candidate|candidat|potential|potentiel|worthy|quality|qualit[ée]|perfect|parfaite?|id[ée]ale?|possible|like|comme|pour|for|vers)\s+(?:a\s+|un\s+|une\s+|le\s+|du\s+)?(?:psa|bgs|cgc|beckett|grad)/i,
    /\b(?:psa|bgs|cgc|grad\w*)\s*[-:]?\s*(?:\d+\s*)?(?:ready|candidate|candidat\w*|worthy|potential|potentiel\w*|quality|possible|material|prospect)/i,
    /\b(?:no|not|non|pas|un|sans|without|ohne|nicht)[\s-]*(?:grad|slab|psa)/i,
    /\bungraded\b/i,
  ];

  /** { company, grade } si le commentaire décrit une carte gradée, sinon null. */
  function detectGrading(comment) {
    const c = String(comment || '');
    if (!c || NOT_GRADED.some((re) => re.test(c))) return null;
    for (const [company, re] of GRADERS) {
      if (!re.test(c)) continue;
      const near = c.match(new RegExp(re.source + String.raw`[\s:#.-]*(?:gem\s*mint|mint|nm-mt|pristine|black\s*label)?\s*(10|[1-9](?:[.,]5)?)(?![\d/])`, 'i'));
      const grade = near ? parseFloat(near[1].replace(',', '.')) : null;
      return { company, grade };
    }
    if (/\b(?:graded|grad[ée]e?|slab|slabbed|gegradet)\b/i.test(c)) return { company: 'Autre', grade: null };
    return null;
  }

  function gradingLabel(g) {
    if (!g) return '';
    if (g.grade != null) return `${g.company} ${String(g.grade).replace('.', ',')}`;
    return g.company === 'Autre' ? 'gradée' : g.company;
  }

  // ---------- Panier ----------
  // Pas d'adresse devinée : on rejoue le formulaire « ajouter au panier » que Cardmarket
  // affiche lui-même dans la ligne de l'offre (visible seulement une fois connecté).

  function findArticleRow(doc, articleId) {
    const id = String(articleId);
    return doc.getElementById('articleRow' + id) || doc.getElementById('stockRow' + id) || doc.querySelector(`[id$="Row${id}"]`);
  }

  function isLoggedOut(doc) {
    return !!doc.querySelector('form[action*="User_Login"], #header-login');
  }

  function pickAmount(el, qty) {
    if (el.tagName.toLowerCase() === 'select') {
      const values = [...el.querySelectorAll('option')].map((o) => parseInt(o.getAttribute('value'), 10)).filter((n) => n > 0);
      const ok = values.filter((n) => n <= qty);
      return ok.length ? Math.max(...ok) : values[0] || qty;
    }
    const max = parseInt(el.getAttribute('max'), 10);
    return max > 0 ? Math.min(qty, max) : qty;
  }

  /**
   * Requête d'ajout au panier pour une offre, reconstruite depuis le formulaire de sa ligne.
   * → { url, fields: [[nom, valeur]], ajax } ou { error: 'LOGIN' | 'NOT_FOUND' | 'NO_FORM' }
   */
  function cartRequest(doc, articleId, qty, pageUrl) {
    const row = findArticleRow(doc, articleId);
    if (!row) return { error: isLoggedOut(doc) ? 'LOGIN' : 'NOT_FOUND' };
    let form = row.querySelector('form');
    if (!form) {
      const ref = row.querySelector('[form]');
      if (ref) form = doc.getElementById(ref.getAttribute('form'));
    }
    if (!form) return { error: isLoggedOut(doc) || row.querySelector('a[href*="/Login"]') ? 'LOGIN' : 'NO_FORM' };

    const controls = [...form.querySelectorAll('input[name], select[name], textarea[name]')];
    if (form.id) for (const el of doc.querySelectorAll(`[form="${form.id}"]`)) if (!controls.includes(el) && el.getAttribute('name')) controls.push(el);
    // Champ quantité posé dans la ligne mais hors du formulaire.
    for (const el of row.querySelectorAll('select[name], input[name]')) if (!controls.includes(el) && /amount/i.test(el.getAttribute('name'))) controls.push(el);

    const id = String(articleId);
    const fields = [];
    let amountSet = false;
    for (const el of controls) {
      const name = el.getAttribute('name');
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'file') continue;
      const index = name.match(/\[(\d+)\]/);
      if (index && index[1] !== id) continue; // formulaire commun à toute la page : autres offres
      let value;
      if (type === 'checkbox' || type === 'radio') {
        if (!(index || row.contains(el) || el.hasAttribute('checked'))) continue;
        value = el.getAttribute('value') || 'on';
      } else if (tag === 'select') {
        const opt = el.querySelector('option[selected]') || el.querySelector('option');
        value = opt ? opt.getAttribute('value') || '' : '';
      } else value = tag === 'textarea' ? el.textContent : el.getAttribute('value') || '';
      if (/amount/i.test(name)) {
        value = String(pickAmount(el, qty));
        amountSet = true;
      }
      fields.push([name, value]);
    }
    if (!amountSet) fields.push(['amount', String(qty)]);
    if (!fields.some(([n, v]) => /idArticle/i.test(n) || v === id)) fields.push(['idArticle', id]);

    const ajax = form.getAttribute('data-ajax-action');
    const p = parseUrl(pageUrl) || { locale: 'en', game: 'Pokemon' };
    let url;
    if (ajax) url = `${ORIGIN}/${p.locale}/${encodeURIComponent(p.game)}/AjaxAction/${encodeURIComponent(ajax)}`;
    else url = new URL(form.getAttribute('action') || pageUrl, ORIGIN).href;
    if (!/^https:\/\/www\.cardmarket\.com\//.test(url)) return { error: 'NO_FORM' };
    return { url, fields, ajax: !!ajax };
  }

  /** Aperçu anonymisé du bloc « panier » d'une ligne, à envoyer pour diagnostic. */
  function cartDiagnostic(doc, articleId) {
    const row = findArticleRow(doc, articleId);
    if (!row) return `ligne ${articleId} introuvable · connecté : ${!isLoggedOut(doc)}`;
    const box = row.querySelector('.col-offer') || row;
    return box.outerHTML
      .replace(/(name="__cmtkn"[^>]*value=")[^"]*/g, '$1…')
      .replace(/(value=")[a-f0-9]{24,}(")/gi, '$1…$2')
      .replace(/\s+/g, ' ')
      .slice(0, 3000);
  }

  // ---------- Page panier (lecture au mieux : structure vue connecté, non garantie) ----------

  const priceIn = (str) => {
    const m = String(str || '').match(/\d[\d.,\s]*\s*€|€\s*\d[\d.,]*/);
    return m ? parsePrice(m[0].replace('€', '')) : null;
  };

  function moneyNear(block, selector, labelRe) {
    const el = selector && block.querySelector(selector);
    if (el) {
      const v = priceIn(text(el));
      if (v != null) return v;
    }
    // Étiquette seule (élément sans enfant) : sinon on attraperait la ligne entière, voire le total voisin.
    for (const lab of block.querySelectorAll('span, dt, td, th, div, p, strong, label')) {
      if (lab.children.length) continue;
      const t = text(lab);
      if (!t || t.length > 40 || !labelRe.test(t)) continue;
      const row = lab.parentElement;
      if (!row) continue;
      const rowText = text(row);
      const v = priceIn(rowText.slice(rowText.indexOf(t) + t.length));
      if (v != null) return v;
    }
    return null;
  }

  /** Commandes du panier : [{ name, value, shipping, total }] (valeurs null si illisibles). */
  function parseCartPage(doc) {
    const blocks = [...doc.querySelectorAll('.shipment-block, section[id^="shipment"], [id^="shipmentBlock"]')];
    const sellers = [];
    for (const block of blocks) {
      const link = block.querySelector('a[href*="/Users/"]');
      if (!link) continue;
      // Lignes d'articles : data-amount / data-price (structure utilisée par d'autres extensions Cardmarket).
      let articles = 0;
      let rowsValue = 0;
      for (const tr of block.querySelectorAll('tr[data-amount]')) {
        const n = parseInt(tr.getAttribute('data-amount'), 10) || 0;
        articles += n;
        rowsValue += n * (parseFloat(String(tr.getAttribute('data-price') || '0').replace(',', '.')) || 0);
      }
      const value = moneyNear(block, '.item-value', /^(article value|articles?|valeur|artikelwert|valor|valore)/i);
      sellers.push({
        name: text(link),
        articles,
        value: value != null ? value : articles ? Math.round(rowsValue * 100) / 100 : null,
        shipping: moneyNear(block, '.shipping-price, .shipping-cost', /^(shipping|envoi|frais d.envoi|frais de port|port|versand|porto|gastos de env|spedizione)/i),
        total: moneyNear(block, '.total-price, .total', /^(total|gesamt|totale)/i),
      });
    }
    return { blocks: blocks.length, sellers };
  }

  /** Page de vérification anti-robot (Cloudflare) plutôt que la page demandée. */
  function isChallenge(status, html, headers) {
    if (headers && headers.get && headers.get('cf-mitigated') === 'challenge') return true;
    if (status !== 403 && status !== 503 && status !== 200) return false;
    const head = String(html || '').slice(0, 6000);
    return (
      /challenge-platform|cf-chl-|cf_chl_|__cf_chl/i.test(head) ||
      /<title>\s*(Just a moment|Un instant|Einen Moment|Un momento)/i.test(head)
    );
  }

  /** Nom simplifié pour la recherche dans le stock d'un vendeur : « Snorlax (LC 64) » → « Snorlax ». */
  function searchableName(name) {
    return clean(String(name || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, ''));
  }

  CMR.cm = {
    ORIGIN,
    LANGUAGES,
    CONDITIONS,
    COUNTRIES,
    SELLER_TYPES,
    norm,
    clean,
    parsePrice,
    parseIntLoose,
    findLanguage,
    findCondition,
    findCountry,
    parseUrl,
    productKey,
    keyToUrl,
    gameOfKey,
    productFilterParams,
    productFetchUrl,
    searchUrl,
    SEARCH_KINDS,
    expansionListUrl,
    parseExpansionOptions,
    parsePagination,
    productKind,
    cartUrl,
    thumbnail,
    detectGrading,
    gradingLabel,
    findArticleRow,
    isLoggedOut,
    cartRequest,
    cartDiagnostic,
    parseCartPage,
    sellerUrl,
    sellerStockSearchUrl,
    loadMoreUrl,
    parseOfferRows,
    parseProductInfo,
    parseProductPage,
    parseLoadMoreXml,
    parseSearchPage,
    parseWantsPage,
    isChallenge,
    searchableName,
  };
  if (typeof module === 'object' && module.exports) module.exports = CMR.cm;
})(typeof globalThis !== 'undefined' ? globalThis : this);
