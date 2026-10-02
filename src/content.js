/* Regroupeur — point d'entrée sur les pages Cardmarket. */
(function (root) {
  'use strict';
  const CMR = root.CMR;
  if (!CMR || !CMR.panel || window.top !== window) return;

  CMR.panel.mount().catch((e) => console.error('[Regroupeur] démarrage impossible', e));

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'cmr:toggle') {
      CMR.panel.toggle();
      sendResponse({ ok: true });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
