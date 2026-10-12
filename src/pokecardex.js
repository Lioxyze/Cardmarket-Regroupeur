// Lecteur Pokécardex : relève les cartes affichées à l'écran (collection) et les garde en local.
// Pas de réseau : seul ce qui est affiché dans ton navigateur (connecté) est lu. Clé : code-langue-version-numéro.
(function () {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  const KEY = 'cmr.pokecardex';
  const SERIES = 'cmr.pcxSeries';
  const SEEN = 'cmr.pcxSeen'; // « SFA|FR » → date de la dernière lecture
  const SRC = /\/sets\/(([A-Za-z0-9.-]+)\/([A-Za-z]{2})\/[^?#]+)/; // …/sets/SFA/FR/2/10.jpg ou …/sets/SFA/FR/69.jpg
  const ALT = /^(.+?)\s+([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)$/;

  // Une carte = le bloc arrondi qui contient l'image et la case à cocher.
  function readCards() {
    const out = {};
    for (const img of document.querySelectorAll('img[alt][src*="/sets/"]')) {
      const box = img.closest('.rounded-t-2xl') || img.closest('.w-full');
      const alt = (img.getAttribute('alt') || '').match(ALT);
      const src = (img.getAttribute('src') || '').match(SRC);
      if (!box || !alt || !src) continue;
      const code = src[2].toUpperCase();
      const lang = src[3].toUpperCase();
      // Master set : seulement Standard et Reverse, en français ou en japonais. Le reste (tampons, staff,
      // holo cosmos, non-holo, autres langues) est ignoré ; sans étiquette lisible, la carte compte comme standard.
      const tag = box.querySelector('.pointer-events-auto span');
      const kind = tag ? tag.textContent.trim().toLowerCase() : 'standard';
      if (kind !== 'standard' && kind !== 'reverse') continue;
      if (lang !== 'FR' && lang !== 'JP') continue;
      const version = kind === 'reverse' ? 'R' : 'S';
      const number = String(parseInt(alt[2].replace(/\D+/g, ''), 10));
      const owned = !!box.querySelector('svg.lucide-square-check');
      out[[code, lang, version, number].join('-')] = { name: alt[1].trim(), code, lang, version, number, owned, i: src[1] };
    }
    return out;
  }

  // Séries visibles dans les menus du site : logo « symboles/SFA.png » + nom, rangées sous le titre de leur bloc.
  // Avancement affiché dans la liste des séries : <p><span>ME05</span><span><span>113</span><span>/120</span>…
  // → nombre de cartes possédées, ou null si la ligne n'en montre pas.
  function ownedCount(item) {
    for (const sp of item.querySelectorAll('p span span')) {
      const next = sp.nextElementSibling;
      if (/^\s*\d[\d\s]*$/.test(sp.textContent) && next && /^\s*\//.test(next.textContent)) return parseInt(sp.textContent.replace(/\s+/g, ''), 10);
    }
    return null;
  }

  // Séries de la liste du site : symbole « symboles/PBL.png », nom sur le logo (« Nuit Noire »), bloc en tête de groupe.
  function readSeries() {
    const out = {};
    let order = 0;
    for (const img of document.querySelectorAll('img[src*="/symboles/"]')) {
      const m = (img.getAttribute('src') || '').match(/\/symboles\/([A-Za-z0-9.-]+)\.(?:png|webp|svg|jpg)/);
      if (!m) continue;
      const item = img.closest('a,button') || img.parentElement;
      const logo = item.querySelector('img[src*="/logos/"][alt]');
      const span = item.querySelector('span.flex-1');
      const name = ((logo && logo.getAttribute('alt')) || (span && span.textContent) || img.getAttribute('alt') || '').trim();
      if (!name) continue;
      // Le groupe : premier parent qui contient d'autres séries ; son texte commence par le nom du bloc
      // (« Méga-Évolution347/1 297 | 27% »).
      let block = '';
      for (let el = item.parentElement, i = 0; el && i < 4; el = el.parentElement, i++) {
        if (el.querySelectorAll('img[src*="/symboles/"]').length < 2) continue;
        const h = el.querySelector('h2, h3, h4');
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const head = t.match(/^(\D{3,40}?)\s*\d[\d\s]*\/[\d\s]+\|/);
        block = h ? h.textContent.trim() : head && !(item.textContent || '').trim().startsWith(head[1]) ? head[1].trim() : '';
        break;
      }
      const entry = { name, block, order: order++ };
      const n = ownedCount(item);
      if (n != null) entry.owned = n;
      out[m[1].toUpperCase()] = entry;
    }
    return out;
  }

  let timer;
  let observer;
  let scrolling = false;
  let stop = false;
  let progress = '';
  // Après un rechargement de l'extension, cet ancien script reste dans l'onglet : il s'arrête proprement.
  const alive = () => !!(chrome.runtime && chrome.runtime.id);

  function save() {
    if (!alive()) {
      if (observer) observer.disconnect();
      if (badge) badge.remove();
      return Promise.resolve();
    }
    const cards = readCards();
    const codes = {};
    for (const c of Object.values(cards)) codes[c.code] = (codes[c.code] || 0) + 1;
    const code = Object.keys(codes).sort((a, b) => codes[b] - codes[a])[0] || null;
    return chrome.storage.local
      .get([KEY, SERIES, SEEN])
      .then((d) => {
        const all = (d && d[KEY]) || {};
        Object.assign(all, cards);
        show(code, all);
        const series = readSeries();
        const known = (d && d[SERIES]) || {};
        // Une série déjà rangée dans un bloc garde son bloc si elle réapparaît ailleurs sans titre.
        for (const [k, v] of Object.entries(series)) known[k] = Object.assign({}, known[k], v, { block: v.block || (known[k] && known[k].block) || '' });
        const out = {};
        if (Object.keys(cards).length) {
          out[KEY] = all;
          const seen = (d && d[SEEN]) || {};
          for (const c of Object.values(cards)) seen[c.code + '|' + c.lang] = Date.now();
          out[SEEN] = seen;
        }
        if (Object.keys(series).length) out[SERIES] = known;
        return Object.keys(out).length ? chrome.storage.local.set(out) : null;
      })
      .catch(() => {});
  }

  // ---------- Pastille : ce qui a été lu pour la série affichée ----------

  let badge;
  let label;
  let button;
  let diag;
  let pending = '';
  let allBtn;
  let wipe;
  // Structure de la page (sans tes données de compte) pour régler le lecteur : à coller dans la conversation.
  async function copyDiag() {
    // Le lecteur ouvre lui-même la liste des séries, puis relève ce que ses lignes affichent.
    diag.textContent = 'Lecture de la liste…';
    const opened = await openPicker();
    const strip = (el) => (el ? el.outerHTML.replace(/\s+/g, ' ').replace(/ class="[^"]*"/g, '').replace(/<svg.*?<\/svg>/g, '<svg/>').slice(0, 700) : '');
    const items = logos().filter((l) => !(picker && picker.contains(l)));
    const pick = items.slice(0, 5).concat(items.slice(40, 43));
    const first = items[0];
    const up = (el, n) => {
      for (let i = 0; i < n && el && el.parentElement; i++) el = el.parentElement;
      return el;
    };
    const text = JSON.stringify({
      opened,
      series: items.length,
      rows: pick.map((l) => ({ text: (clickable(l).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160), html: strip(clickable(l)) })),
      around: first ? (up(clickable(first), 2).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500) : '',
      panel: first ? [...up(clickable(first), 6).querySelectorAll('button, input, label, [role="tab"], [role="switch"]')].slice(0, 30).map((e) => (e.textContent || e.getAttribute('placeholder') || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean) : [],
    });
    const done = (ok) => (diag.textContent = ok ? 'Copié : colle-le dans la conversation' : 'Copie refusée : reclique');
    try {
      await navigator.clipboard.writeText(text);
      done(true);
    } catch (e) {
      // Trop de temps depuis le clic : on garde le texte, le prochain clic le copie tout de suite.
      pending = text;
      done(false);
    }
  }
  function show(code, all) {
    if (!badge) {
      badge = document.createElement('div');
      Object.assign(badge.style, {
        position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483000', background: '#1f4fd1', color: '#fff',
        font: '600 12px/1.3 system-ui, sans-serif', padding: '8px 10px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,.3)', maxWidth: '260px',
      });
      label = document.createElement('div');
      button = document.createElement('button');
      Object.assign(button.style, { marginTop: '6px', padding: '4px 8px', border: '0', borderRadius: '6px', background: '#fff', color: '#1f4fd1', font: 'inherit', cursor: 'pointer' });
      button.addEventListener('click', readAll);
      allBtn = document.createElement('button');
      Object.assign(allBtn.style, { display: 'block', marginTop: '6px', padding: '4px 8px', border: '0', borderRadius: '6px', background: '#fff', color: '#1f4fd1', font: 'inherit', cursor: 'pointer' });
      allBtn.addEventListener('click', () => (scrolling ? (stop = true) : scanAll(false, false)));
      diag = document.createElement('button');
      Object.assign(diag.style, { display: 'block', marginTop: '6px', padding: '0', border: '0', background: 'none', color: '#fff', font: '400 11px system-ui, sans-serif', textDecoration: 'underline', cursor: 'pointer' });
      diag.textContent = 'Copier le diagnostic';
      diag.addEventListener('click', () => {
        if (!pending) return copyDiag();
        navigator.clipboard.writeText(pending).then(() => (diag.textContent = 'Copié : colle-le dans la conversation'));
        pending = '';
      });
      wipe = document.createElement('button');
      Object.assign(wipe.style, { display: 'block', marginTop: '4px', padding: '0', border: '0', background: 'none', color: '#fff', font: '400 11px system-ui, sans-serif', textDecoration: 'underline', cursor: 'pointer' });
      wipe.textContent = 'Effacer les séries gardées';
      wipe.addEventListener('click', () => {
        if (scrolling || !confirm('Effacer tout ce que le Regroupeur a lu sur Pokécardex ? (ta collection Pokécardex n’est pas touchée)')) return;
        chrome.storage.local.remove(['cmr.pokecardex', 'cmr.pcxSeries', 'cmr.pcxSeen', 'cmr.pcxDone', 'cmr.pcxScan']).then(save).catch(() => {});
      });
      badge.append(label, button, allBtn, diag, wipe);
      document.body.appendChild(badge);
    }
    badge.style.display = '';
    const mine = Object.values(all).filter((c) => c.code === code);
    const nums = new Set(mine.map((c) => c.number));
    const owned = new Set(mine.filter((c) => c.owned).map((c) => c.number));
    const total = new Set(Object.values(all).map((c) => c.code + c.lang)).size;
    label.textContent = code
      ? `Regroupeur · ${code} : ${nums.size} cartes lues, ${owned.size} possédées (${total} séries gardées)`
      : `Regroupeur · ${total} séries gardées. Ouvre une série pour la lire.`;
    button.style.display = code && !scrolling ? '' : 'none';
    if (scrolling && progress) label.textContent = `Regroupeur · lecture de ta collection : ${progress}`;
    allBtn.textContent = scrolling ? 'Arrêter' : 'Scanner mes séries commencées';
    button.textContent = scrolling ? 'Lecture en cours…' : 'Lire toute la série';
    button.disabled = scrolling;
  }

  // La page n'affiche que les cartes proches de l'écran : on la fait défiler jusqu'en bas pour tout relever.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function scrollRead(stepMs) {
    window.scrollTo(0, 0);
    await sleep(stepMs);
    let still = 0;
    for (let i = 0; i < 600 && still < 3 && alive() && !stop; i++) {
      await save();
      const before = window.scrollY;
      window.scrollBy(0, Math.max(300, window.innerHeight * 0.85));
      await sleep(stepMs);
      still = window.scrollY === before ? still + 1 : 0;
    }
    await save();
  }

  async function readAll() {
    if (scrolling) return;
    scrolling = true;
    stop = false;
    const start = window.scrollY;
    await scrollRead(350);
    scrolling = false;
    window.scrollTo(0, start);
    await save();
  }

  // ---------- Toute la collection : on passe de série en série par le sélecteur de la page ----------

  const SCAN = 'cmr.pcxScan';
  const DONE = 'cmr.pcxDone'; // séries déjà passées en revue en entier
  // Bandeau bien visible pendant la mise à jour : ce qui se passe, où on en est, et comment arrêter.
  let panel;
  function banner(o) {
    if (o.state !== 'run') {
      if (panel) panel.remove();
      panel = null;
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      Object.assign(panel.style, {
        position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483001', width: 'min(440px, calc(100vw - 32px))',
        background: '#fff', color: '#16213a', borderRadius: '14px', boxShadow: '0 10px 40px rgba(0,0,0,.35)', border: '2px solid #1f4fd1',
        padding: '14px 16px', font: '14px/1.35 system-ui, sans-serif',
      });
      const el = (tag, style, text) => {
        const e = document.createElement(tag);
        Object.assign(e.style, style);
        if (text) e.textContent = text;
        panel.appendChild(e);
        return e;
      };
      el('div', { font: '700 15px system-ui, sans-serif', color: '#1f4fd1' }, 'Regroupeur · mise à jour de ta collection');
      panel.line = el('div', { marginTop: '4px' });
      const track = el('div', { marginTop: '10px', height: '10px', borderRadius: '999px', background: '#e3e9f8', overflow: 'hidden' });
      panel.bar = document.createElement('div');
      Object.assign(panel.bar.style, { height: '100%', width: '0%', borderRadius: '999px', background: 'linear-gradient(90deg,#1f4fd1,#22a55b)', transition: 'width .3s' });
      track.appendChild(panel.bar);
      el('div', { marginTop: '8px', fontSize: '12px', color: '#5a6478' }, 'Laisse cet onglet affiché : il se ferme tout seul à la fin.');
      const stopBtn = el('button', { marginTop: '10px', padding: '6px 12px', border: '0', borderRadius: '8px', background: '#c62828', color: '#fff', font: '600 13px system-ui, sans-serif', cursor: 'pointer' }, 'Arrêter');
      stopBtn.addEventListener('click', () => (stop = true));
      document.body.appendChild(panel);
    }
    panel.line.textContent = `Série ${Math.min(o.done + 1, o.total)} sur ${o.total} : ${o.name || o.code}`;
    panel.bar.style.width = `${Math.round((100 * o.done) / Math.max(1, o.total))}%`;
  }

  const status = (o) => {
    banner(o);
    progress = o.state === 'run' ? `${o.done} / ${o.total} séries (${o.code})` : '';
    return chrome.storage.local.set({ [SCAN]: Object.assign({ t: Date.now() }, o) }).catch(() => {});
  };
  const logos = () => [...document.querySelectorAll('img[src*="/symboles/"]')];
  const codeOf = (img) => (((img.getAttribute('src') || '').match(/\/symboles\/([A-Za-z0-9.-]+)\./) || [])[1] || '').toUpperCase();
  const clickable = (el) => el.closest('a,button,[role="button"],li') || el;
  const expandAll = () => [...document.querySelectorAll('button')].find((b) => /tout d[ée]plier/i.test(b.textContent));
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(150);
    }
    return null;
  }

  let picker = null; // le bouton qui affiche la série en cours et ouvre la liste
  async function openPicker() {
    if (logos().length <= 3) {
      const one = logos()[0];
      if (!one) return false;
      picker = clickable(one);
      picker.click();
      await waitFor(() => logos().length > 3 || expandAll(), 4000);
    }
    const all = expandAll();
    if (all) {
      all.click();
      await sleep(500);
    }
    return !!(await waitFor(() => logos().length > 3, 3000));
  }

  // Faut-il rouvrir cette série ? La liste du site donne le nombre de cartes possédées :
  // 0 → jamais ouverte ; même nombre qu'à la dernière lecture → rien n'a changé, on passe.
  // Sans ce nombre, on relit ce qu'on n'a jamais lu et ce qui contenait au moins une carte.
  function mustRead(item, code, known) {
    const n = ownedCount(item);
    if (n != null) return n > 0 && known.count[code] !== n;
    return !(code in known.count) || known.owned.has(code);
  }

  async function scanAll(auto, full) {
    if (scrolling) return;
    scrolling = true;
    stop = false;
    const fail = (note) => {
      scrolling = false;
      status({ state: 'error', note });
      save();
    };
    if (!(await waitFor(() => logos().length, 15000))) return fail('Collection introuvable : es-tu connecté à Pokécardex ?');
    if (!(await openPicker())) return fail('Liste des séries introuvable sur la page.');
    await save();
    const codes = [...new Set(logos().filter((l) => !picker || !picker.contains(l)).map(codeOf).filter(Boolean))];
    const d = await chrome.storage.local.get([KEY, DONE]).catch(() => ({}));
    const stored = Object.values((d && d[KEY]) || {});
    const saved = d && d[DONE];
    const count = saved && !Array.isArray(saved) ? saved : {}; // série → cartes possédées à la dernière lecture
    const known = { count, owned: new Set(stored.filter((c) => c.owned).map((c) => c.code)) };
    const sample = [];
    const names = readSeries();
    let done = 0;
    let read = 0;
    // La liste est triée d'avance : seules les séries à lire comptent dans l'avancement affiché.
    const todo = full
      ? codes
      : codes.filter((code) => {
          const l = logos().find((x) => codeOf(x) === code && !(picker && picker.contains(x)));
          return l && mustRead(clickable(l), code, known);
        });
    const skipped = codes.length - todo.length;
    if (!todo.length) {
      scrolling = false;
      await status({ state: 'done', done: 0, total: 0, read: 0, skipped, upToDate: true });
      await save();
      if (auto) window.close();
      return;
    }
    for (const code of todo) {
      if (stop || !alive()) break;
      status({ state: 'run', done, total: todo.length, code, name: (names[code] || {}).name });
      if (!(await openPicker())) break;
      const img = logos().find((l) => codeOf(l) === code && !(picker && picker.contains(l)));
      done++;
      if (!img) continue;
      if (sample.length < 6) sample.push((clickable(img).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120));
      const had = ownedCount(clickable(img));
      clickable(img).click();
      const shown = await waitFor(() => Object.values(readCards()).some((c) => c.code === code), 5000);
      if (shown) {
        await sleep(300);
        await scrollRead(220);
        read++;
      }
      if (!stop) {
        count[code] = had == null ? -1 : had;
        await chrome.storage.local.set({ [DONE]: count }).catch(() => {});
      }
    }
    scrolling = false;
    window.scrollTo(0, 0);
    await save();
    await status({ state: stop ? 'stopped' : 'done', done, total: todo.length, read, skipped, sample });
    if (auto && !stop && read) window.close();
  }

  // La page change sans changer d'adresse (on clique sur une série) : on relit à chaque changement.
  observer = new MutationObserver((list) => {
    if (list.every((m) => (badge && badge.contains(m.target)) || (panel && panel.contains(m.target)))) return; // nos propres retouches
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  save();
  // Ouvert par le bouton « Actualiser » du Regroupeur (Cardmarket) : on scanne tout puis l'onglet se referme.
  if (/^#cmr-scan(-all)?$/.test(location.hash)) {
    const full = location.hash === '#cmr-scan-all';
    history.replaceState(null, '', location.pathname + location.search);
    scanAll(true, full);
  }
})();
