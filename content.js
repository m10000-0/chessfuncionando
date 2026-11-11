// Injeta o botão "Revisão Lance Certo" nas páginas de partida do chess.com e abre o painel de revisão.
(() => {
  if (window.__lanceCerto) return;
  window.__lanceCerto = true;

  const GAME_RE = /\/game\/(?:(live|daily|computer)\/)?(\d+)/;
  const LABEL_RE = /^(game review|review|revis[aã]o( da| de)? partida|revisar( partida)?|analy[sz]e|analis(ar|e)( partida)?)$/i;
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  function gameInfo() {
    let id = null, type = null;
    const m = location.pathname.match(GAME_RE);
    if (m) { id = m[2]; type = m[1] || 'live'; }
    if (!id) {
      // Ex.: modal de fim de partida com link para a página do jogo
      const links = [...document.querySelectorAll('a[href*="/game/"]')].map((a) => (a.getAttribute('href') || '').match(GAME_RE)).filter(Boolean);
      if (links.length) { const l = links[links.length - 1]; id = l[2]; type = l[1] || 'live'; }
    }
    const users = [];
    const add = (name) => { name = (name || '').trim().toLowerCase(); if (/^[a-z0-9_-]{3,25}$/.test(name) && !users.includes(name)) users.push(name); };
    document.querySelectorAll('[data-test-element="user-tagline-username"], .user-tagline-username, .cc-user-username-component').forEach((el) => add(el.textContent));
    document.querySelectorAll('.board-layout-top a[href*="/member/"], .board-layout-bottom a[href*="/member/"], [class*="player"] a[href*="/member/"]').forEach((a) => add((a.getAttribute('href').match(/\/member\/([\w-]+)/) || [])[1]));
    // Lado do jogador: o site mostra o tabuleiro invertido ("flipped") quando você joga de pretas,
    // e o seu nome fica na barra de baixo
    const board = document.querySelector('wc-chess-board#board-single, wc-chess-board, chess-board');
    const orientation = board && board.classList.contains('flipped') ? 'b' : 'w';
    const bottom = document.querySelector('#board-layout-player-bottom, .board-layout-bottom, .player-bottom');
    let me = null;
    if (bottom) {
      const el = bottom.querySelector('[data-test-element="user-tagline-username"], .user-tagline-username, .cc-user-username-component, a[href*="/member/"]');
      const href = el && el.getAttribute('href');
      me = ((href && (href.match(/\/member\/([\w-]+)/) || [])[1]) || (el && el.textContent) || '').trim().toLowerCase() || null;
      if (me && !/^[a-z0-9_-]{3,25}$/.test(me)) me = null;
      if (me && !users.includes(me)) users.unshift(me);
    }
    return { id, type, users: users.slice(0, 6), url: location.href, orientation, me, theme: siteTheme(board) };
  }

  // Tema do site (peças e tabuleiro que o seu navegador já carrega), para usar no overlay
  function siteTheme(board) {
    if (!board) return null;
    let pieces = null, boardImg = null;
    const urlOf = (el) => { const m = el && getComputedStyle(el).backgroundImage.match(/url\(["']?(https:[^"')]+)["']?\)/); return m ? m[1] : null; };
    for (const el of board.querySelectorAll('.piece')) {
      const u = urlOf(el);
      const m = u && u.match(/^(.*\/)([wb])([pnbrqk])\.(png|svg|webp)(\?.*)?$/i);
      if (m) { pieces = `${m[1]}{c}{t}.${m[4]}${m[5] || ''}`; break; }
    }
    boardImg = urlOf(board);
    return pieces || boardImg ? { pieces, board: boardImg } : null;
  }

  function boardEl() {
    return document.querySelector('wc-chess-board, chess-board, #board-layout-chessboard, .board');
  }
  function hasBoard() { return !!boardEl(); }
  // Ignora o menu lateral do site (fica à esquerda do tabuleiro); aceita o painel da partida
  function nearBoard(el) {
    const b = boardEl();
    if (!b) return false;
    const br = b.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return r.right > br.left + 20;
  }

  function makeButton(base) {
    const b = document.createElement('button');
    b.type = 'button';
    // Herda as classes do botão vizinho para combinar com o visual da página
    b.className = (base ? base.className + ' ' : 'lc-plain ') + 'lc-review-btn';
    b.innerHTML = '<span class="lc-knight">♞</span><span>Revisão Lance Certo</span>';
    b.title = 'Revisão gratuita e ilimitada, rodando no seu navegador';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openReview(); }, true);
    return b;
  }

  function inject() {
    if (!hasBoard()) { document.querySelector('.lc-float')?.remove(); return; }
    let injected = !!document.querySelector('.lc-review-btn:not(.lc-float)');
    for (const el of document.querySelectorAll('button, a')) {
      if (el.dataset.lcSeen || el.classList.contains('lc-review-btn')) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 40 || !LABEL_RE.test(text)) continue;
      if (el.closest('.lc-ov') || !nearBoard(el)) continue;
      el.dataset.lcSeen = '1';
      el.parentNode.insertBefore(makeButton(el), el);
      injected = true;
    }
    // Botão flutuante em qualquer página com tabuleiro (inclusive /play/online após a partida),
    // caso o botão de revisão do site não seja encontrado
    const floating = document.querySelector('.lc-float');
    if (!injected && !floating) {
      const b = makeButton(null);
      b.classList.add('lc-float');
      document.body.append(b);
    } else if (floating && injected) floating.remove();
  }

  // ---------- Dois overlays: um sobre o tabuleiro, outro sobre a coluna ----------
  const visible = (r) => r && r.width > 40 && r.height > 40 && r.bottom > 0 && r.right > 0 && r.left < innerWidth && r.top < innerHeight;

  // Tabuleiro (casas) + faixa da barra de avaliação à esquerda, se existir
  function boardArea() {
    const board = document.querySelector('wc-chess-board#board-single, #board-layout-chessboard wc-chess-board, wc-chess-board, chess-board');
    if (!board) return null;
    const b = board.getBoundingClientRect();
    if (!visible(b)) return null;
    let left = b.left;
    const ev = document.querySelector('#board-layout-evaluation');
    if (ev) {
      const e = ev.getBoundingClientRect();
      if (e.width > 4 && e.right <= b.left + 2 && b.left - e.left < 80 && e.bottom > b.top && e.top < b.bottom) left = e.left;
    }
    return { left, top: b.top, width: b.right - left, height: b.height, board: b };
  }

  // Coluna da direita (ou abaixo, em telas estreitas); se não houver, cria uma área ao lado do tabuleiro
  function sideArea(ba) {
    const side = document.querySelector('#board-layout-sidebar, .board-layout-sidebar');
    if (side) {
      const r = side.getBoundingClientRect();
      if (r.width > 150 && r.height > 120 && r.right > 0 && r.left < innerWidth) {
        const top = Math.max(r.top, 8);
        const bottom = Math.min(r.bottom, innerHeight - 8);
        if (bottom - top > 200) return { left: r.left, top, width: r.width, height: bottom - top };
      }
    }
    if (!ba) return null;
    const free = innerWidth - ba.board.right - 16;
    if (free >= 320) return { left: ba.board.right + 16, top: ba.top, width: Math.min(440, free - 8), height: Math.max(ba.height, 420) };
    // Sem espaço ao lado: painel na parte de baixo da tela
    return { left: 8, top: Math.max(innerHeight * 0.45, 8), width: innerWidth - 16, height: innerHeight * 0.55 - 8 };
  }

  let posTimer = null;
  const setBox = (el, r) => {
    if (!el) return;
    if (!r) { el.style.display = 'none'; return; }
    el.style.display = '';
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  function place() {
    const bo = document.getElementById('lc-ov-board'), so = document.getElementById('lc-ov-side');
    if (!bo && !so) return;
    const ba = boardArea();
    setBox(bo, ba);
    setBox(so, sideArea(ba) || { left: 16, top: 16, width: innerWidth - 32, height: innerHeight - 32 });
  }

  function overlay(id, info) {
    const ov = document.createElement('div');
    ov.id = id;
    ov.className = 'lc-ov';
    const fr = document.createElement('iframe');
    fr.src = chrome.runtime.getURL('review.html') + '#' + encodeURIComponent(JSON.stringify(info));
    fr.allow = 'clipboard-write';
    ov.append(fr);
    document.documentElement.append(ov);
    return fr;
  }

  function openReview() {
    if (document.getElementById('lc-ov-side')) return;
    const info = gameInfo();
    const channel = 'lc-' + Math.random().toString(36).slice(2);
    overlay('lc-ov-board', { role: 'board', channel });
    const side = overlay('lc-ov-side', { ...info, role: 'side', channel });
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    posTimer = setInterval(place, 300);
    side.focus();
  }

  function closeReview() {
    document.querySelectorAll('.lc-ov').forEach((e) => e.remove());
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    clearInterval(posTimer);
  }

  // Clique no ícone da extensão: abre o painel sobre a página
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'lc-open') { openReview(); reply({ ok: true }); }
  });

  window.addEventListener('message', (e) => {
    if (e.origin === EXT_ORIGIN && e.data && e.data.type === 'lc-close') closeReview();
    if (e.origin === EXT_ORIGIN && e.data && e.data.type === 'lc-prank') launchPrank();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReview(); });

  // ========== PEGADINHA ==========
  function launchPrank() {
    chrome.runtime.sendMessage({ type: 'lc-prank' });
  }

  let t = null;
  const schedule = () => { clearTimeout(t); t = setTimeout(inject, 300); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  inject();
})();
