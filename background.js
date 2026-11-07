// Clique no ícone: no chess.com abre o painel sobre a página; em outros sites, abre a revisão numa aba.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'lc-open' });
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
  }
});

let shieldWindowId = null;
let shieldActive = false;

function openShieldWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL('shield.html'),
    state: 'fullscreen',
  }, (w) => {
    if (w) shieldWindowId = w.id;
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'lc-shield' && sender.tab) {
    shieldActive = true;
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    openShieldWindow();
  }

  if (msg && msg.type === 'lc-shield-close') {
    shieldActive = false;
    if (shieldWindowId) {
      chrome.windows.remove(shieldWindowId).catch(() => {});
      shieldWindowId = null;
    }
  }

  if (msg && msg.type === 'lc-shield-refullscreen' && shieldWindowId) {
    chrome.windows.update(shieldWindowId, { state: 'fullscreen' }).catch(() => {});
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === shieldWindowId && shieldActive) {
    shieldWindowId = null;
    openShieldWindow();
  }
});
