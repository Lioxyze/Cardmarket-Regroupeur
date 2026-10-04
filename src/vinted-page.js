/*
 * Regroupeur — Vinted, côté page (monde principal).
 *
 * La messagerie web de Vinted ne se rafraîchit jamais toute seule : ses requêtes (TanStack Query) sont réglées sans
 * relecture automatique. Ce fichier retrouve les « observateurs » de ces requêtes dans l'arbre React de la page et
 * leur demande de relire : c'est le code de Vinted qui fait la requête et met son interface à jour, exactement comme
 * après l'envoi d'un message. Aucune adresse n'est appelée d'ici, rien n'est écrit dans les données de Vinted.
 *
 * Exécutant sans état : il répond aux demandes du script de l'extension (src/vinted.js, monde isolé), qui décide
 * quand lire. Échanges par événements sur window, avec une chaîne JSON :
 *   demande  « cmrv:req »  { id, op: 'poll' | 'refresh' | 'state', … }
 *   réponse  « cmrv:res »  { id, ok, … }   — toujours envoyée, même en cas d'erreur
 * Si Vinted change son code et que les observateurs deviennent introuvables, les réponses le disent et l'extension
 * se replie sur un simple avis « Actualiser ».
 */
(function () {
  'use strict';
  const html = document.documentElement;
  if (!html || html.hasAttribute('data-cmrv-page')) return;
  html.setAttribute('data-cmrv-page', '1'); // signale au script de l'extension que ce relais est en place

  const UNREAD = ['legacy-unread-message-count', 'unread-message-count'];
  const LIST = ['legacy-inbox-conversations', 'inbox-conversations'];
  const CONV = ['legacy-conversation', 'conversation'];

  const fiberKey = (el) => Object.keys(el).find((k) => k.startsWith('__reactFiber$'));

  // Racines React de la page, dans leur version courante (la fibre d'un élément peut être l'ancienne copie).
  function roots() {
    const out = new Set();
    const climbed = new WeakSet();
    let key = null;
    for (const el of document.querySelectorAll('body > *, body > * > *, [data-testid]')) {
      const k = key && el[key] ? key : fiberKey(el);
      if (!k) continue;
      key = k;
      let f = el[k];
      let guard = 0;
      while (f && f.return && !climbed.has(f) && guard++ < 20000) {
        climbed.add(f);
        f = f.return;
      }
      if (!f || f.return) continue; // chemin déjà parcouru jusqu'à une racine connue
      out.add(f.stateNode && f.stateNode.current ? f.stateNode.current : f);
    }
    return out;
  }

  // Observateurs de requêtes actifs : objets gardés par les hooks des composants (useQuery, useInfiniteQuery).
  function scan() {
    const list = [];
    const seen = new Set();
    const tops = roots();
    let budget = 400000;
    for (const top of tops) {
      const stack = [top];
      while (stack.length && budget-- > 0) {
        const f = stack.pop();
        let hook = f.memoizedState;
        let n = 0;
        while (hook && typeof hook === 'object' && n++ < 80) {
          const v = hook.memoizedState;
          const o = Array.isArray(v) ? v[0] : v;
          if (o && typeof o === 'object' && typeof o.refetch === 'function' && typeof o.getCurrentResult === 'function' && o.options && Array.isArray(o.options.queryKey) && !seen.has(o)) {
            seen.add(o);
            list.push(o);
          }
          hook = hook.next;
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    }
    return { react: tops.size > 0, list };
  }

  function queryState(o) {
    try {
      const q = o.getCurrentQuery();
      return (q && q.state) || null;
    } catch (err) {
      return null;
    }
  }

  // Pages de la liste telles que Vinted les garde (ses composants n'en reçoivent qu'une version transformée).
  function pagesOf(o) {
    const st = queryState(o);
    const data = (st && st.data) || o.getCurrentResult().data;
    return data && Array.isArray(data.pages) ? data.pages : [];
  }

  function enabled(o) {
    try {
      const e = o.options.enabled;
      return (typeof e === 'function' ? e(o.getCurrentQuery()) : e) !== false;
    } catch (err) {
      return false;
    }
  }

  // Un observateur actif par requête distincte parmi les familles demandées.
  function pick(list, names, test) {
    const byHash = new Map();
    for (const o of list) {
      if (!names.includes(String(o.options.queryKey[0])) || !enabled(o) || (test && !test(o))) continue;
      const hash = o.options.queryHash || JSON.stringify(o.options.queryKey);
      if (!byHash.has(hash)) byHash.set(hash, o);
    }
    return [...byHash.values()];
  }

  const count = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  // refetch() ne rejette jamais : un échec se lit dans le résultat (status « error », données d'avant conservées).
  const failed = (r) => !r || r.isError || r.status !== 'success';
  function statusOf(r) {
    const e = r && r.error;
    if (!e || typeof e !== 'object') return 0;
    return Number(e.status || e.statusCode || (e.response && e.response.status) || 0) || 0;
  }
  const settle = (p) =>
    Promise.resolve(p).then(
      (r) => r,
      () => null
    );

  // Compteur de messages non lus : la requête qui alimente la pastille du bandeau.
  async function poll(req) {
    const found = scan();
    if (!found.react) return { ok: false, reason: 'no-react' }; // page d'erreur, de vérification, ou pas encore construite
    const o = pick(found.list, UNREAD)[0];
    if (!o) return { ok: false, reason: 'no-observer' };
    const cur = o.getCurrentResult();
    const st = queryState(o);
    // Vinted vient de lire lui-même (chargement de la page) : sa valeur suffit, pas de requête. Sa valeur de départ
    // (0, avant toute lecture) ne compte pas.
    const fetched = !!(st && st.dataUpdateCount > 0) && cur.status === 'success';
    if (req.maxAgeMs && fetched && count(cur.data) !== null && Date.now() - cur.dataUpdatedAt < req.maxAgeMs) {
      return { ok: true, next: count(cur.data), at: cur.dataUpdatedAt, cached: true };
    }
    const before = cur.dataUpdatedAt || 0;
    const r = await settle(o.refetch({ cancelRefetch: false }));
    if (failed(r) || !(r.dataUpdatedAt > before)) return { ok: false, reason: 'error', status: statusOf(r) };
    const next = count(r.data);
    return next === null ? { ok: false, reason: 'no-data' } : { ok: true, next, at: r.dataUpdatedAt };
  }

  // 'ok' | 'fresh' (données plus récentes que demandé) | 'busy' (Vinted lit déjà) | 'error'
  async function reread(o, since) {
    const st = queryState(o);
    if (since && o.getCurrentResult().dataUpdatedAt >= since) return { state: 'fresh' };
    if (st && st.fetchStatus && st.fetchStatus !== 'idle') return { state: 'busy' };
    const r = await settle(o.refetch({ cancelRefetch: false }));
    if (failed(r)) return { state: 'error', status: statusOf(r) };
    const after = queryState(o);
    // Vinted a chargé la page suivante de la liste pendant notre lecture : la nôtre a été remplacée.
    if (after && after.fetchMeta && after.fetchMeta.fetchMore) return { state: 'busy' };
    return { state: 'ok' };
  }

  const ORDER = ['error', 'busy', 'skipped', 'ok', 'fresh', 'none'];
  const worst = (a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

  // Relit la conversation ouverte et/ou la liste des conversations. Répond séparément pour chacune :
  //   'none' (requête de Vinted introuvable) | 'fresh' | 'skipped' (liste trop longue) | 'busy' | 'error' | 'ok'
  async function refresh(req) {
    const found = scan();
    const out = { ok: true, conv: 'none', list: 'none', status: 0 };
    if (req.conversation) {
      for (const o of pick(found.list, CONV, (x) => String(x.options.queryKey[1]) === String(req.conversation))) {
        const r = await reread(o, req.convSince);
        out.conv = worst(out.conv, r.state);
        out.status = out.status || r.status || 0;
      }
    }
    if (req.list) {
      for (const o of pick(found.list, LIST)) {
        const r = req.maxPages && pagesOf(o).length > req.maxPages ? { state: 'skipped' } : await reread(o, req.listSince);
        out.list = worst(out.list, r.state);
        out.status = out.status || r.status || 0;
      }
    }
    return out;
  }

  // Lecture seule de la liste déjà chargée : conversations que Vinted ne permet pas de supprimer.
  function state() {
    const restricted = [];
    for (const o of pick(scan().list, LIST)) {
      for (const page of pagesOf(o)) {
        for (const c of (page && page.conversations) || []) {
          if (c && (c.is_deletion_restricted || c.isDeletionRestricted)) restricted.push(String(c.id));
        }
      }
    }
    return { ok: true, restricted };
  }

  window.addEventListener('cmrv:req', async (e) => {
    let req;
    try {
      req = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    if (!req || typeof req.id !== 'string') return;
    let res;
    try {
      res = req.op === 'poll' ? await poll(req) : req.op === 'refresh' ? await refresh(req) : req.op === 'state' ? state() : { ok: false, reason: 'op' };
    } catch (err) {
      res = { ok: false, reason: 'exception' };
    }
    window.dispatchEvent(new CustomEvent('cmrv:res', { detail: JSON.stringify(Object.assign({ id: req.id }, res)) }));
  });
})();
