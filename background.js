/* Regroupeur — clic sur l'icône : ouvre / ferme le panneau sur Cardmarket ; mises à jour hors store. */
const CARDMARKET = /^https:\/\/www\.cardmarket\.com\//;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  if (tab.url && CARDMARKET.test(tab.url)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'cmr:toggle' });
    } catch (e) {
      // Onglet ouvert avant l'installation : le script n'y tourne pas encore.
      const saved = await chrome.storage.local.get('cmr.ui');
      await chrome.storage.local.set({ 'cmr.ui': Object.assign({}, saved['cmr.ui'], { open: true }) });
      await chrome.tabs.reload(tab.id);
    }
    return;
  }
  await chrome.tabs.create({ url: 'https://www.cardmarket.com/fr/Pokemon' });
});

// ---------- Mises à jour (version distribuée hors store) ----------
// Le programme de mise à jour installé sur le PC remplace les fichiers de l'extension sur le disque.
// Chrome continue d'exécuter l'ancienne version jusqu'au rechargement : on compare donc la version
// en cours avec celle du manifest.json présent sur le disque, et on recharge à la demande.

const ONLINE_CHECK_MS = 6 * 3600 * 1000;

function newer(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function readJson(url, opts) {
  try {
    const res = await fetch(url, Object.assign({ cache: 'no-store' }, opts || {}));
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

async function updateStatus(checkOnline) {
  const running = chrome.runtime.getManifest().version;
  const disk = await readJson(chrome.runtime.getURL('manifest.json'));
  // distribution.json n'existe que dans le paquet distribué par GitHub (pas en développement ni sur un store).
  const dist = await readJson(chrome.runtime.getURL('distribution.json'));
  const status = { running, disk: disk ? disk.version : running, distributed: !!dist, online: null, page: dist ? dist.page : null };
  if (dist && dist.versionUrl) {
    const { cmrOnline } = await chrome.storage.local.get('cmrOnline');
    if (cmrOnline && Date.now() - cmrOnline.at < ONLINE_CHECK_MS && !checkOnline) status.online = cmrOnline.version;
    else {
      const info = await readJson(`${dist.versionUrl}?t=${Date.now()}`);
      if (info && info.version) {
        status.online = info.version;
        await chrome.storage.local.set({ cmrOnline: { at: Date.now(), version: info.version } });
      }
    }
  }
  status.readyToActivate = newer(status.disk, running); // nouvelle version déjà sur le disque
  status.available = !status.readyToActivate && status.online && newer(status.online, status.disk) ? status.online : null;
  return status;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'cmr:update-status') {
    updateStatus(!!msg.checkOnline).then(sendResponse);
    return true;
  }
  if (msg.type === 'cmr:apply-update') {
    // Recharge l'extension depuis le disque ; l'onglet Cardmarket se recharge de son côté.
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 100);
    return false;
  }
  return false;
});
