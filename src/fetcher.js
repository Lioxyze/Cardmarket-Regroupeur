/*
 * Regroupeur — file de requêtes vers Cardmarket.
 *
 * Les requêtes partent du navigateur de l'utilisateur, avec sa session : une à
 * la fois, espacées (délai + aléa), avec des pauses croissantes si le site
 * répond 429 (trop de requêtes). Une page de vérification Cloudflare arrête
 * tout : c'est à l'utilisateur de la passer lui-même dans l'onglet.
 */
(function (root) {
  'use strict';
  const CMR = (root.CMR = root.CMR || {});

  class FetchError extends Error {
    constructor(code, message, extra) {
      super(message);
      this.name = 'FetchError';
      this.code = code;
      Object.assign(this, extra || {});
    }
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const t = setTimeout(done, ms);
      function done() {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }
      function onAbort() {
        clearTimeout(t);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function abortError() {
    return new FetchError('ABORTED', 'Analyse interrompue');
  }

  const BACKOFF_SECONDS = [30, 60, 120, 240];
  const TIMEOUT_MS = 30000;

  // File commune à tout l'onglet : recherche, analyse et panier ne se chevauchent jamais,
  // et deux requêtes sont toujours espacées, quelle que soit l'opération qui les envoie.
  const gate = { chain: Promise.resolve(), last: 0, minDelay: 0, total: 0 };

  class Fetcher {
    /**
     * @param {object} opts
     *   delayMs: pause minimale entre deux requêtes
     *   onWait(seconds, reason): appelé chaque seconde pendant une pause forcée
     */
    constructor(opts = {}) {
      this.delayMs = Math.max(1000, opts.delayMs || 3000);
      this.timeoutMs = opts.timeoutMs || TIMEOUT_MS;
      this.onWait = opts.onWait || (() => {});
      this.count = 0;
    }

    get delay() {
      return Math.max(this.delayMs, gate.minDelay);
    }

    /** Attend son tour dans la file commune ; renvoie la fonction qui libère la place. */
    async _acquire(signal) {
      const prev = gate.chain;
      let release;
      gate.chain = new Promise((r) => (release = r));
      try {
        await prev;
        await this._spacing(signal);
      } catch (e) {
        release();
        throw e;
      }
      return release;
    }

    async _spacing(signal) {
      const jitter = Math.random() * this.delay * 0.4;
      const wait = gate.last + this.delay + jitter - Date.now();
      if (wait > 0) await sleep(wait, signal);
    }

    async _countdown(seconds, reason, signal) {
      for (let s = seconds; s > 0; s--) {
        this.onWait(s, reason);
        await sleep(1000, signal);
      }
      this.onWait(0, reason);
    }

    async request(url, init = {}, signal) {
      const release = await this._acquire(signal);
      try {
        return await this._send(url, init, signal);
      } finally {
        gate.last = Date.now(); // l'écart suivant part de la fin de cette requête
        release();
      }
    }

    async _send(url, init, signal) {
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await this._spacing(signal);
        gate.last = Date.now();
        let res;
        let body;
        // Délai maximum : une page qui ne répond pas ne doit jamais bloquer la file de tout l'onglet.
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
          res = await fetch(url, { credentials: 'include', redirect: 'follow', ...init, signal: ctrl.signal });
          body = await res.text();
        } catch (e) {
          if (signal && signal.aborted) throw abortError();
          if (attempt < 2) {
            await sleep(Math.min(3000, this.timeoutMs), signal);
            continue;
          }
          throw new FetchError('NETWORK', 'Cardmarket ne répond pas (connexion lente ou coupée) : réessaie dans un instant.');
        } finally {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
        }
        this.count++;
        gate.total++;

        if (res.status === 429) {
          if (attempt >= BACKOFF_SECONDS.length) {
            throw new FetchError('RATE_LIMIT', 'Cardmarket limite les requêtes : réessaie dans quelques minutes.');
          }
          // Tout l'onglet ralentit durablement (jusqu'au rechargement de la page).
          gate.minDelay = Math.min(Math.max(gate.minDelay, this.delay) * 1.5, 15000);
          await this._countdown(BACKOFF_SECONDS[attempt], 'rate-limit', signal);
          continue;
        }
        if (CMR.cm.isChallenge(res.status, body, res.headers)) {
          throw new FetchError(
            'CHALLENGE',
            'Cardmarket demande une vérification anti-robot. Recharge la page, passe la vérification, puis relance : les cartes déjà lues sont gardées en cache.'
          );
        }
        if (res.status === 404) throw new FetchError('NOT_FOUND', 'Page introuvable sur Cardmarket', { status: 404 });
        if (!res.ok) {
          if (res.status >= 500 && attempt < 2) {
            await sleep(5000, signal);
            continue;
          }
          throw new FetchError('HTTP', `Erreur Cardmarket (HTTP ${res.status})`, { status: res.status });
        }
        return { text: body, url: res.url, status: res.status };
      }
    }

    async getDoc(url, signal) {
      const r = await this.request(url, { headers: { Accept: 'text/html,application/xhtml+xml' } }, signal);
      return { doc: new DOMParser().parseFromString(r.text, 'text/html'), finalUrl: r.url };
    }

    /** Envoie des champs de formulaire : multipart + en-tête AJAX pour les actions « data-ajax-action », classique sinon. */
    async postFields(url, fields, ajax, signal) {
      let body;
      if (ajax) {
        body = new FormData();
        for (const [k, v] of fields) body.append(k, v);
      } else {
        body = new URLSearchParams();
        for (const [k, v] of fields) body.append(k, v);
      }
      const headers = ajax ? { 'X-Requested-With': 'XMLHttpRequest' } : {};
      return this.request(url, { method: 'POST', body, headers }, signal);
    }

    async postForm(url, fields, signal) {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.append(k, v);
      return this.request(url, { method: 'POST', body, headers: { 'X-Requested-With': 'XMLHttpRequest' } }, signal);
    }
  }

  /** Nombre total de pages demandées à Cardmarket depuis l'ouverture de l'onglet. */
  const sessionRequests = () => gate.total;

  CMR.fetcher = { Fetcher, FetchError, sleep, sessionRequests };
})(typeof globalThis !== 'undefined' ? globalThis : this);
