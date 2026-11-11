// Clique no ícone: no chess.com abre o painel sobre a página; em outros sites, abre a revisão numa aba.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'lc-open' });
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
  }
});

// Pegadinha: controle da janela
let prankWindowId = null;
let prankActive = false;

function openPrankWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL('prank.html'),
    state: 'fullscreen',
  }, (w) => {
    if (w) prankWindowId = w.id;
  });
}

// Ao iniciar o navegador, verifica se o prank estava ativo e reabre
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('prankActive', (data) => {
    if (data.prankActive) {
      prankActive = true;
      openPrankWindow();
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'lc-prank' && sender.tab) {
    prankActive = true;
    chrome.storage.local.set({ prankActive: true });
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    openPrankWindow();
  }

  if (msg && msg.type === 'lc-prank-close') {
    prankActive = false;
    chrome.storage.local.set({ prankActive: false });
    if (prankWindowId) {
      chrome.windows.remove(prankWindowId).catch(() => {});
      prankWindowId = null;
    }
  }

  if (msg && msg.type === 'lc-prank-refullscreen' && prankWindowId) {
    chrome.windows.update(prankWindowId, { state: 'fullscreen' }).catch(() => {});
  }
});

// Se a janela do prank for fechada (Alt+F4), reabre automaticamente
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === prankWindowId && prankActive) {
    prankWindowId = null;
    openPrankWindow();
  }
});

// Reage instantaneamente a qualquer mudanca de estado da janela (sair de fullscreen, minimizar, etc)
chrome.windows.onBoundsChanged?.addListener((window) => {
  if (window.id === prankWindowId && prankActive && window.state !== 'fullscreen') {
    chrome.windows.update(prankWindowId, { state: 'fullscreen' }).catch(() => {});
  }
});

// Se o foco mudar para outra janela, forca foco de volta e refullscreen
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (prankActive && prankWindowId && windowId !== prankWindowId && windowId !== chrome.windows.WINDOW_ID_NONE) {
    chrome.windows.update(prankWindowId, { focused: true, state: 'fullscreen' }).catch(() => {});
  }
});
