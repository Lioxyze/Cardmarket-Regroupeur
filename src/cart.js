/*
 * Regroupeur — ajout des offres retenues au panier Cardmarket.
 *
 * Pour chaque offre : on ouvre la page où elle se trouve (stock du vendeur filtré
 * par nom, sinon page produit), on retrouve sa ligne et on rejoue le formulaire
 * « ajouter au panier » que Cardmarket y affiche. Si l'offre a été vendue entre-temps,
 * on prend chez le même vendeur une offre équivalente (mêmes critères, prix proche).
 * À la fin, la page panier est relue pour confirmer la présence de chaque article.
 */
(function (root, factory) {
  const CMR = (root.CMR = root.CMR || {});
  const deps =
    typeof module === 'object' && module.exports
      ? { cm: require('./cm.js'), analyzer: require('./analyzer.js') }
      : { cm: CMR.cm, analyzer: CMR.analyzer };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else CMR.cart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const { cm, analyzer } = deps;

  const STOP = ['ABORTED', 'CHALLENGE', 'RATE_LIMIT', 'NETWORK'];
  // Remplaçant accepté dans la même limite de surcoût que le plan (+10 % ou +0,30 € par défaut).
  const replacementLimit = (p, settings) => Math.min(analyzer.premiumLimit(p, 1, settings), p * 1.25 + 0.1);

  const n = (art) => art.n || 1;

  function loginError() {
    const e = new Error('Connecte-toi à Cardmarket pour ajouter des articles au panier.');
    e.code = 'LOGIN';
    return e;
  }

  /**
   * @param items [{ card, seller, productName, take: [{ id, n, p }] }]
   * @param opts  { fetcher, settings, locale, signal, onProgress(done, total, label) }
   * @returns { results: [...], cartChecked, loginRequired }
   *   résultat par offre : { cardId, seller, articleId, qty, price, status, message, inCart, diag }
   *   status : added | replaced | gone | error
   */
  async function addToCart(items, opts) {
    const { fetcher, settings, signal } = opts;
    const progress = opts.onProgress || (() => {});
    const pages = new Map();
    const results = [];
    const total = items.reduce((n, it) => n + it.take.length, 0);
    let done = 0;

    async function load(url) {
      if (!pages.has(url)) {
        const { doc, finalUrl } = await fetcher.getDoc(url, signal);
        if (/\/Login\b/.test(finalUrl) || cm.isLoggedOut(doc)) throw loginError();
        pages.set(url, { doc, url });
      }
      return pages.get(url);
    }

    try {
      for (const it of items) {
        const game = cm.gameOfKey(it.card.key);
        const name = cm.searchableName(it.productName || it.card.name);
        const urls = [];
        if (cm.productKind(it.card.key) === 'single') urls.push(cm.sellerStockSearchUrl(game, it.seller, name, 'en'));
        urls.push(cm.productFetchUrl(it.card.key, analyzer.serverFilters(it.card, settings)));

        for (const art of it.take) {
          progress(done, total, `${name} chez ${it.seller}`);
          const res = { cardId: it.card.id, seller: it.seller, articleId: art.id, qty: art.n, price: art.p, status: 'error', message: '' };
          try {
            let page = null;
            for (const url of urls) {
              let p;
              try {
                p = await load(url);
              } catch (e) {
                if (e.code === 'LOGIN' || STOP.includes(e.code)) throw e;
                continue; // page absente (404…) : on tente la suivante
              }
              if (cm.findArticleRow(p.doc, art.id)) {
                page = p;
                break;
              }
            }
            let articleId = art.id;
            let qty = art.n;
            if (!page) {
              const alt = findReplacement(pages, it, art, settings);
              if (!alt) {
                res.status = 'gone';
                res.message = 'plus disponible chez ce vendeur';
                results.push(res);
                done++;
                continue;
              }
              page = alt.page;
              articleId = alt.offer.id;
              qty = Math.min(art.n, alt.offer.count || 1);
              res.status = 'replaced';
              const delta = alt.offer.price - art.p;
              res.message = `remplacée par une offre équivalente à ${alt.offer.price.toFixed(2).replace('.', ',')} €${
                delta > 0.005 ? ` (+${delta.toFixed(2).replace('.', ',')} €)` : ''
              }`;
              res.delta = Math.round(delta * n(art) * 100) / 100;
              res.articleId = articleId;
              res.price = alt.offer.price;
              res.qty = qty;
            }
            const req = cm.cartRequest(page.doc, articleId, qty, page.url);
            if (req.error === 'LOGIN') throw loginError();
            if (req.error) {
              res.status = 'error';
              res.message = 'bouton « panier » introuvable sur la page';
              res.diag = cm.cartDiagnostic(page.doc, articleId);
            } else {
              const r = await fetcher.postFields(req.url, req.fields, req.ajax, signal);
              if (/\/Login\b/.test(r.url || '')) throw loginError();
              if (res.status !== 'replaced') res.status = 'added';
              res.request = { url: req.url, fields: req.fields.map(([k]) => k) };
            }
          } catch (e) {
            if (e.code === 'LOGIN' || STOP.includes(e.code)) throw e;
            res.status = 'error';
            res.message = e.message || String(e);
          }
          results.push(res);
          done++;
        }
      }
    } catch (e) {
      if (e.code === 'LOGIN') return { results, cartChecked: false, loginRequired: true };
      e.partial = results;
      throw e;
    }
    progress(total, total, 'Vérification du panier');

    // Vérification : chaque article ajouté doit apparaître dans la page panier.
    let cartChecked = false;
    let cart = null;
    const sent = results.filter((r) => r.status === 'added' || r.status === 'replaced');
    if (sent.length) {
      try {
        const games = [...new Set(items.map((it) => cm.gameOfKey(it.card.key)))];
        let html = '';
        cart = { blocks: 0, sellers: [] };
        for (const g of games) {
          const page = (await fetcher.request(cm.cartUrl(g, 'en'), {}, signal)).text;
          html += page;
          const parsed = cm.parseCartPage(new DOMParser().parseFromString(page, 'text/html'));
          cart.blocks += parsed.blocks;
          cart.sellers.push(...parsed.sellers);
        }
        for (const r of sent) r.inCart = html.includes(String(r.articleId));
        cartChecked = true;
      } catch (e) {
        if (STOP.includes(e.code) && e.code !== 'NETWORK') throw e;
      }
    }
    progress(total, total, '');
    return { results, cartChecked, cart, loginRequired: false };
  }

  /** Une autre offre du même vendeur pour la même carte, qui respecte les mêmes critères. */
  function findReplacement(pages, it, art, settings) {
    const f = analyzer.effectiveFilters(it.card, settings);
    const ctx = { excluded: new Set(), countries: [] };
    let best = null;
    for (const page of pages.values()) {
      for (const o of cm.parseOfferRows(page.doc)) {
        const sameProduct = o.productKey ? o.productKey === it.card.key : true;
        const sameSeller = o.seller ? o.seller.name === it.seller : page.url.includes('/Users/');
        if (!sameProduct || !sameSeller || !o.id || o.id === String(art.id)) continue;
        const compact = { s: it.seller, p: o.price, n: o.count, c: o.condition, l: o.languageId, f: o.flags, m: o.comment };
        if (analyzer.rejectReason(compact, null, f, settings, ctx)) continue;
        if (o.price > replacementLimit(art.p, settings) + 1e-9) continue;
        if (!best || o.price < best.offer.price) best = { page, offer: o };
      }
    }
    return best;
  }

  /** Offres à ajouter pour un plan : une entrée par (carte, vendeur). */
  function planItems(plan, results, cards) {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const items = [];
    for (const order of plan.orders) {
      for (const c of order.cards) {
        const card = byId.get(c.cardId);
        const take = (results.detail[c.cardId] || {})[order.sellerId];
        if (!card || !take) continue;
        items.push({
          card,
          seller: order.sellerId,
          productName: (results.cardInfo[c.cardId] || {}).name,
          take: take.map((t) => ({ id: t.id, n: t.n, p: t.p })),
        });
      }
    }
    return items;
  }

  return { addToCart, planItems, findReplacement };
});
