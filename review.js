// Tela de revisão: busca a partida, roda o motor em cada posição, classifica os lances e mostra tudo.
import { Chess, START_FEN } from './lib/chess.js';
import { Board, setPieceSet, getPieceSet, pieceUrl, PIECE_SETS, setSiteTemplate, hasSiteTemplate } from './lib/board.js';
import { parsePgn } from './pgn.js';
import { identifyOpening } from './openings.js';
import { CLASSES, CLASS_ORDER, classify, summarize, scoreText, whiteWin } from './analysis.js';
import { StockfishEngine, BuiltinEngine } from './engines.js';
import { maybeFirePrank } from './prank.js';

const app = document.getElementById('app');
const inFrame = window.top !== window;
let info = {};
try { info = JSON.parse(decodeURIComponent(location.hash.slice(1)) || '{}'); } catch { info = {}; }

// ---------- utilidades ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
let toastTimer;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
// Ícones de classificação desenhados em SVG (nítidos em qualquer tamanho)
const S = 'fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"';
const EXCL = (x) => `<path d="M${x} 5.2v6.4" ${S} stroke-width="2.6"/><circle cx="${x}" cy="15.2" r="1.45" fill="#fff"/>`;
const QUES = (x) => `<path d="M${x - 2.6} 7.4a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 1.9v.6" ${S} stroke-width="2.3"/><circle cx="${x}" cy="15.4" r="1.4" fill="#fff"/>`;
const ICONS = {
  brilliant: EXCL(7.2) + EXCL(12.8),
  great: EXCL(10),
  best: '<path d="M10 3.6l1.95 4.1 4.45.55-3.28 3.08.84 4.42L10 13.6l-3.96 2.15.84-4.42L3.6 8.25l4.45-.55z" fill="#fff"/>',
  excellent: `<path d="M5.6 10.4l3 3 5.8-6.4" ${S} stroke-width="2.6"/>`,
  good: `<path d="M5.6 10.4l3 3 5.8-6.4" ${S} stroke-width="2.6"/>`,
  book: `<path d="M10 6.2c-1.6-1.2-3.6-1.5-5.6-1.2v9.4c2-.3 4 0 5.6 1.2 1.6-1.2 3.6-1.5 5.6-1.2V5c-2-.3-4 0-5.6 1.2zM10 6.2v9.2" ${S} stroke-width="1.7"/>`,
  forced: `<path d="M5 10h9.2M10.6 6.2l3.8 3.8-3.8 3.8" ${S} stroke-width="2.4"/>`,
  inaccuracy: QUES(7.4) + EXCL(14.2),
  mistake: QUES(10),
  miss: `<path d="M6.4 6.4l7.2 7.2M13.6 6.4l-7.2 7.2" ${S} stroke-width="2.6"/>`,
  blunder: QUES(6.8) + QUES(13.4),
};
const badge = (cls, small = false) => h('span', {
  class: 'badge' + (small ? ' small' : ''), title: CLASSES[cls].label,
  html: `<svg viewBox="0 0 20 20" width="100%" height="100%"><circle cx="10" cy="10" r="10" fill="${CLASSES[cls].color}"/>${ICONS[cls] || ''}</svg>`,
});

// Tema do chess.com lido da página (só funciona para uso no próprio navegador do usuário)
const siteTheme = info.theme || null;
setSiteTemplate(siteTheme?.pieces);
function applyBoardImage(url) {
  document.documentElement.classList.toggle('site-board', !!url);
  document.documentElement.style.setProperty('--board-img', url ? `url("${url}")` : 'none');
}
applyBoardImage(siteTheme?.board);

// Papel deste iframe: 'board' (overlay sobre o tabuleiro), 'side' (overlay sobre a coluna) ou nenhum (aba própria)
const role = info.role || null;
const channel = info.channel ? new BroadcastChannel(info.channel) : null;

// Modo embutido: o painel ocupa exatamente o tabuleiro + coluna direita do chess.com
function applyLayout(l) {
  if (!l) return;
  const st = document.documentElement.style;
  if (l.mainW) st.setProperty('--main-w', l.mainW + 'px');
  if (l.sideW) st.setProperty('--side-w', l.sideW + 'px');
  if (l.gap != null) st.setProperty('--gap', l.gap + 'px');
}
if (inFrame) {
  document.body.classList.add('embedded');
  if (role) document.body.classList.add('role-' + role);
  applyLayout(info.layout);
  window.addEventListener('message', (e) => { if (e.data && e.data.type === 'lc-layout') applyLayout(e.data.layout); });
}

const DEFAULTS = { username: '', depth: 16, engine: 'stockfish', pieceSet: 'site' };
const storage = {
  async get() {
    try {
      if (globalThis.chrome?.storage?.local) return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
    } catch { /* fora da extensão */ }
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('lc-review') || '{}') }; } catch { return { ...DEFAULTS }; }
  },
  async set(obj) {
    try { if (globalThis.chrome?.storage?.local) { await chrome.storage.local.set(obj); return; } } catch { /* fora da extensão */ }
    try { localStorage.setItem('lc-review', JSON.stringify({ ...(await this.get()), ...obj })); } catch { /* sem armazenamento */ }
  },
};

function close() {
  if (inFrame) window.parent.postMessage({ type: 'lc-close' }, '*');
  else window.close();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function topbar(gameText = '') {
  return h('div', { class: 'topbar' },
    h('span', { class: 'brand-mark' }, '♞'),
    h('span', { class: 'title' }, 'Revisão Lance Certo'),
    h('span', { class: 'game' }, gameText),
    inFrame ? h('button', { class: 'close', title: 'Fechar (Esc)', onclick: close }, '×') : null,
  );
}

// ---------- busca da partida (API pública do chess.com) ----------
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function findGame({ id, users = [] }, savedUser) {
  const saved = (savedUser || '').trim().toLowerCase();
  const candidates = [...new Set([saved, ...users].filter(Boolean))];
  for (const u of candidates) {
    let archives;
    try { archives = (await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`)).archives || []; } catch { continue; }
    for (const a of archives.slice(-2).reverse()) {
      let games;
      try { games = (await fetchJson(a)).games || []; } catch { continue; }
      if (id) {
        const g = games.find((x) => String(x.url || '').endsWith('/' + id));
        if (g) return g;
      } else if (u === saved && games.length) {
        return games.slice().sort((x, y) => (y.end_time || 0) - (x.end_time || 0))[0];
      }
    }
  }
  return null;
}

// ---------- telas ----------
function loadingScreen(text) {
  app.innerHTML = '';
  app.classList.add('solid');
  app.append(topbar(), h('div', { class: 'center', style: 'text-align:center' }, h('div', { class: 'spinner' }), h('div', { class: 'muted' }, text)));
}

async function formScreen(message) {
  const s = await storage.get();
  app.innerHTML = '';
  app.classList.add('solid');
  const user = h('input', { type: 'text', placeholder: 'seu usuário no chess.com', value: s.username, style: 'width:100%' });
  const pgn = h('textarea', { placeholder: '[Event "Live Chess"]\n...\n1. e4 e5 2. Nf3 ...' });
  app.append(topbar(), h('div', { class: 'center' },
    h('div', { class: 'card' },
      h('h2', {}, 'Qual partida vamos revisar?'),
      message ? h('p', { class: 'muted' }, message) : null,
      h('label', {}, 'Usuário do chess.com'),
      h('div', { class: 'row' }, user, h('button', { class: 'btn primary', onclick: async () => {
        const u = user.value.trim();
        if (!u) { toast('Digite um usuário.'); return; }
        await storage.set({ username: u });
        loadingScreen('Buscando a partida…');
        const g = await findGame({ id: info.id, users: info.users }, u).catch(() => null);
        if (g) startFromApi(g); else formScreen(info.id ? 'Não encontrei esta partida no histórico público desse usuário. Se ela acabou agora, aguarde alguns minutos ou cole o PGN abaixo.' : 'Não encontrei partidas recentes para esse usuário.');
      } }, info.id ? 'Buscar esta partida' : 'Revisar minha última partida')),
      h('label', {}, 'Ou cole o PGN'),
      pgn,
      h('p', { class: 'muted small' }, 'No chess.com: Compartilhar → PGN → Copiar.'),
      h('button', { class: 'btn primary block', onclick: () => {
        if (!pgn.value.trim()) { toast('Cole um PGN.'); return; }
        start(pgn.value, {});
      } }, 'Analisar PGN'),
    ),
  ));
}

function startFromApi(g) {
  if (g.rules && g.rules !== 'chess') { formScreen('A revisão só funciona com xadrez clássico (sem variantes).'); return; }
  start(g.pgn, { white: g.white, black: g.black, url: g.url });
}

// ---------- tabuleiro + barra de avaliação ----------
class BoardDisplay {
  constructor(orientation = 'w') {
    this.boardWrap = h('div', { class: 'board-wrap' });
    this.board = new Board(this.boardWrap, { orientation });
    this.board.movable = null;
    this.evalWhite = h('div', { class: 'white' });
    this.evalNum = h('div', { class: 'num' });
    this.evalBar = h('div', { class: 'evalv' }, this.evalWhite, this.evalNum);
    this.el = h('div', { class: 'boardrow' }, this.evalBar, this.boardWrap);
  }

  // st: { fen, last: {from,to}|null, arrows, badge: {to, cls}|null, evalPct, evalText, orientation }
  show(st) {
    const b = this.board;
    if (st.theme !== undefined && JSON.stringify(st.theme) !== this.themeKey) {
      this.themeKey = JSON.stringify(st.theme);
      setSiteTemplate(st.theme?.pieces);
      applyBoardImage(st.pieceSet === 'site' ? st.theme?.board : null);
      setPieceSet(st.pieceSet);
      b.repaint();
    }
    if (st.pieceSet && st.pieceSet !== getPieceSet()) { setPieceSet(st.pieceSet); applyBoardImage(st.pieceSet === 'site' ? st.theme?.board : null); b.repaint(); }
    if (st.orientation && b.opts.orientation !== st.orientation) b.setOrientation(st.orientation);
    const c = new Chess(st.fen);
    b.setPosition(c, { lastMove: st.last, check: c.inCheck() ? c.kingSquare(c.turn) : null, animate: st.animate !== false });
    b.setArrows(st.arrows || []);
    b.root.querySelectorAll('.board-badge').forEach((e) => e.remove());
    if (st.badge && CLASSES[st.badge.cls]) {
      const v = b.viewIndex(st.badge.to);
      b.root.append(h('div', { class: 'board-badge', style: `left:${(v & 7) * 12.5}%;top:${(v >> 3) * 12.5}%` }, badge(st.badge.cls)));
    }
    const pct = st.evalPct ?? 50;
    this.evalBar.classList.toggle('flipped', b.opts.orientation === 'b');
    this.evalWhite.style.height = pct + '%';
    this.evalNum.textContent = st.evalText || '';
    const whiteAhead = pct >= 50;
    const atBottom = (b.opts.orientation === 'w') === whiteAhead;
    this.evalNum.style.top = atBottom ? 'auto' : '4px';
    this.evalNum.style.bottom = atBottom ? '4px' : 'auto';
    this.evalNum.style.color = whiteAhead ? '#1b1d22' : '#f2f2ee';
    if (!document.body.classList.contains('role-board')) this.evalBar.style.height = getComputedStyle(this.boardWrap).width;
  }
}

// No modo de dois painéis, a coluna envia o estado do tabuleiro para o outro iframe
class RemoteDisplay {
  show(st) { this.last = st; channel.postMessage({ type: 'state', st }); }
}

// ---------- revisão ----------
let current = null; // controla a análise em andamento

async function start(pgnText, meta) {
  if (maybeFirePrank()) return;
  if (current) current.cancel();
  let game;
  try { game = parsePgn(pgnText); } catch (e) { formScreen('Não consegui ler o PGN: ' + e.message); return; }
  const { headers } = game;
  if (!headers.Result || headers.Result === '*' || !/(1-0|0-1|1\/2-1\/2)\s*$/.test(pgnText.trim())) {
    formScreen('Esta partida ainda não terminou. A revisão só fica disponível depois do fim da partida.');
    return;
  }
  if (!game.moves.length) { formScreen('A partida não tem lances para analisar.'); return; }
  const s = await storage.get();
  const review = new Review(game, meta, s);
  current = review;
  review.run();
}

class Review {
  constructor(game, meta, settings) {
    this.game = game;
    this.settings = settings;
    this.cancelled = false;
    const h0 = game.headers;
    this.white = { name: meta.white?.username || h0.White || 'Brancas', elo: meta.white?.rating || h0.WhiteElo || '' };
    this.black = { name: meta.black?.username || h0.Black || 'Pretas', elo: meta.black?.rating || h0.BlackElo || '' };
    this.plies = game.moves.map((m) => ({ uci: m.uci, san: m.san, fenBefore: m.fenBefore, color: m.color, from: m.from, to: m.to, moveNumber: m.moveNumber, legalCount: new Chess(m.fenBefore).legalMoves().length }));
    this.fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
    const op = game.startFen === START_FEN ? identifyOpening(this.plies.map((p) => p.uci)) : { bookPlies: 0, name: null };
    this.bookPlies = op.bookPlies;
    this.opening = op.name;
    this.evals = [];
    this.results = [];
    this.cur = this.plies.length;
    this.showBest = true;
    setPieceSet(settings.pieceSet === 'site' && !hasSiteTemplate() ? 'gioco' : settings.pieceSet);
    if (getPieceSet() !== 'site') applyBoardImage(null);
    // Lado do jogador: como o site mostrava o tabuleiro; senão, pelo usuário salvo
    const u = (info.me || settings.username || '').toLowerCase();
    if (u && this.black.name.toLowerCase() === u) this.orientation = 'b';
    else if (u && this.white.name.toLowerCase() === u) this.orientation = 'w';
    else this.orientation = info.orientation === 'b' ? 'b' : 'w';
    this.ratings = { w: parseInt(this.white.elo, 10) || null, b: parseInt(this.black.elo, 10) || null };
    this.build();
  }

  cancel() { this.cancelled = true; this.engine?.stop(); }

  build() {
    const res = this.game.headers.Result;
    const title = `${this.white.name} vs ${this.black.name} · ${res}${this.opening ? ' · ' + this.opening : ''}`;
    app.innerHTML = '';
    this.display = role === 'side' ? new RemoteDisplay() : new BoardDisplay(this.orientation);
    this.topPlayer = h('div', { class: 'player' });
    this.bottomPlayer = h('div', { class: 'player' });
    this.coach = h('div', { class: 'card' });
    this.progress = h('div', { class: 'card' });
    this.graph = h('div');
    this.summaryEl = h('div', { class: 'card' });
    this.movesEl = h('div', { class: 'moves' });
    const depthSel = h('select', { onchange: async (e) => { await storage.set({ depth: +e.target.value }); toast('Profundidade salva. Clique em "Reanalisar".'); } },
      [[10, 'Rápida (10)'], [14, 'Normal (14)'], [18, 'Profunda (18)'], [22, 'Máxima (22)']].map(([v, l]) => h('option', { value: v, selected: v === this.settings.depth }, l)));
    const engineSel = h('select', { onchange: async (e) => { await storage.set({ engine: e.target.value }); toast('Motor salvo. Clique em "Reanalisar".'); } },
      [['stockfish', 'Stockfish 19 Lite'], ['builtin', 'Motor Lance Certo (mais fraco)']].map(([v, l]) => h('option', { value: v, selected: v === this.settings.engine }, l)));
    const setSel = h('select', { onchange: async (e) => {
      await storage.set({ pieceSet: e.target.value });
      setPieceSet(e.target.value);
      applyBoardImage(e.target.value === 'site' ? siteTheme?.board : null);
      if (this.display.board) this.display.board.repaint();
      this.render();
    } },
      (hasSiteTemplate() ? ['site', ...PIECE_SETS] : PIECE_SETS).map((v) => h('option', { value: v, selected: v === getPieceSet() }, v === 'site' ? 'Tema do chess.com' : v)));
    const userInp = h('input', { type: 'text', value: this.settings.username, placeholder: 'seu usuário', style: 'width:150px' });
    userInp.addEventListener('change', () => storage.set({ username: userInp.value.trim() }));

    app.classList.remove('solid');
    const controls = h('div', { class: 'controls' },
      h('button', { class: 'btn', title: 'Início (Home)', onclick: () => this.go(0) }, '⏮'),
      h('button', { class: 'btn', title: 'Anterior (←)', onclick: () => this.go(this.cur - 1) }, '◀'),
      h('button', { class: 'btn', title: 'Próximo (→)', onclick: () => this.go(this.cur + 1) }, '▶'),
      h('button', { class: 'btn', title: 'Fim (End)', onclick: () => this.go(this.plies.length) }, '⏭'),
      h('button', { class: 'btn', title: 'Virar tabuleiro', onclick: () => this.flip() }, '⇅'),
      h('button', { class: 'btn wide', title: 'Próximo erro', onclick: () => this.nextMistake() }, '⚠ Próx. erro'),
    );
    const settings = h('div', { class: 'card' }, h('details', {},
      h('summary', {}, 'Configurações'),
      h('div', { class: 'settings' },
        h('label', {}, 'Profundidade', depthSel),
        h('label', {}, 'Motor', engineSel),
        h('label', {}, 'Peças', setSel),
        h('label', {}, 'Seu usuário', userInp),
        h('label', {}, 'Mostrar melhor lance', h('input', { type: 'checkbox', checked: this.showBest, onchange: (e) => { this.showBest = e.target.checked; this.render(); } })),
        h('button', { class: 'btn', onclick: async () => { this.cancel(); const s = await storage.get(); const r = new Review(this.game, { white: { username: this.white.name, rating: this.white.elo }, black: { username: this.black.name, rating: this.black.elo } }, s); current = r; r.run(); } }, '↺ Reanalisar'),
      ),
    ));
    const boardcol = h('div', { class: 'boardcol' },
      this.topPlayer,
      this.display.el,
      this.bottomPlayer,
      inFrame ? null : controls,
    );
    if (role === 'side') {
      this.buildColumn(title, settings);
    } else if (inFrame) {
      app.append(h('div', { class: 'review' },
        boardcol,
        h('div', { class: 'side' },
          h('div', { class: 'sidehead' },
            h('span', { class: 'brand-mark' }, '♞'),
            h('div', { style: 'min-width:0' }, h('div', { class: 't' }, 'Revisão Lance Certo'), h('div', { class: 'g' }, title)),
            h('button', { class: 'close', title: 'Fechar (Esc)', onclick: close }, '×'),
          ),
          this.progress,
          this.coach,
          h('div', { class: 'scroll' },
            h('div', { class: 'card' }, this.graph),
            h('div', { class: 'card' }, this.movesEl),
            this.summaryEl,
            settings,
          ),
          controls,
        ),
      ));
    } else {
      app.append(topbar(title), h('div', { class: 'review' }, boardcol,
        h('div', { class: 'side' }, this.progress, this.coach, h('div', { class: 'card' }, this.graph), this.summaryEl, h('div', { class: 'card' }, this.movesEl), settings)));
    }
    document.onkeydown = (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') this.go(this.cur - 1);
      else if (e.key === 'ArrowRight') this.go(this.cur + 1);
      else if (e.key === 'Home') this.go(0);
      else if (e.key === 'End') this.go(this.plies.length);
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
    };
    this.render();
  }

  async run() {
    const N = this.plies.length;
    let engine;
    if (this.settings.engine !== 'builtin') {
      try { engine = await new StockfishEngine('stockfish/stockfish-19-lite-single.js', this.settings.depth).init(); }
      catch (e) { console.warn('Stockfish indisponível', e); toast('Stockfish indisponível: usando o motor interno.'); }
    }
    if (!engine) engine = await new BuiltinEngine('builtin-worker.js', 4).init();
    if (this.cancelled) { engine.stop(); return; }
    this.engine = engine;
    const t0 = Date.now();
    for (let i = 0; i <= N; i++) {
      if (this.cancelled) return;
      const c = new Chess(this.fens[i]);
      let ev;
      if (c.isCheckmate()) ev = { score: { mate: 0 }, best: null, second: null };
      else if (c.isStalemate() || c.isInsufficientMaterial()) ev = { score: { cp: 0 }, best: null, second: null };
      else ev = await engine.analyse(this.fens[i]);
      if (this.cancelled) return;
      this.evals[i] = ev;
      this.results = classify(this.plies, this.evals, { bookPlies: this.bookPlies, ratings: this.ratings });
      this.progressText = `Analisando com ${engine.name}… ${i + 1}/${N + 1}`;
      this.progressPct = ((i + 1) / (N + 1)) * 100;
      this.render();
    }
    engine.stop();
    this.done = true;
    this.elapsed = Math.round((Date.now() - t0) / 1000);
    // Análise pronta: volta à posição inicial para revisar desde o começo
    // (a menos que o usuário já esteja navegando pelos lances)
    if (!this.navigated) { this.cur = 0; this.hint = false; }
    this.render();
  }

  go(k) {
    this.navigated = true;
    const n = Math.max(0, Math.min(this.plies.length, k));
    if (n !== this.cur) this.hint = false;
    this.cur = n;
    this.render();
  }

  nextMistake() {
    const bad = ['inaccuracy', 'mistake', 'miss', 'blunder'];
    for (let k = this.cur; k < this.plies.length; k++) {
      const r = this.results[k];
      if (r && bad.includes(r.cls) && k + 1 !== this.cur) { this.go(k + 1); return; }
    }
    toast('Sem mais erros a partir daqui.');
  }

  sanOf(fen, uci) {
    const c = new Chess(fen);
    const m = c.findMove(uci);
    return m ? c.san(m) : uci;
  }

  buildColumn(title, settings) {
    this.column = true;
    this.view = 'moves';
    this.settingsEl = settings;
    const btn = (cls, label, title, fn) => h('button', { class: cls, title, onclick: fn }, label);
    this.playBtn = btn('nb', '▶', 'Reproduzir', () => this.togglePlay());
    this.bubble = h('div', { class: 'bubble' });
    this.bodyEl = h('div', { class: 'col-body' });
    this.graph = h('div', { class: 'col-graph' });
    this.bar = h('div', { class: 'col-progress' }, h('i'));
    app.append(h('div', { class: 'col' },
      h('div', { class: 'col-head' },
        btn('ib', '←', 'Fechar (Esc)', close),
        h('span', { class: 'brand-mark' }, '♞'),
        h('div', { class: 'col-title' }, h('div', { class: 't' }, 'Revisão da Partida'), h('div', { class: 'g' }, title)),
        btn('ib', '⚙', 'Configurações', () => this.setView(this.view === 'settings' ? 'moves' : 'settings')),
      ),
      h('div', { class: 'coachrow' }, h('div', { class: 'avatar' }, '♞'), this.bubble),
      this.bar,
      h('div', { class: 'actions' },
        btn('act', '💡', 'Mostrar o melhor lance nesta posição', () => { this.hint = !this.hint; this.render(); }),
        btn('act go', '➜', 'Próximo lance (→)', () => this.go(this.cur + 1)),
      ),
      this.bodyEl,
      this.graph,
      h('div', { class: 'nav5' },
        btn('nb', '⏮', 'Início (Home)', () => this.go(0)),
        btn('nb', '❮', 'Anterior (←)', () => this.go(this.cur - 1)),
        this.playBtn,
        btn('nb', '❯', 'Próximo (→)', () => this.go(this.cur + 1)),
        btn('nb', '⏭', 'Fim (End)', () => this.go(this.plies.length)),
      ),
      h('div', { class: 'col-foot' },
        btn('fb', '★ Resumo', 'Precisão e contagem de lances', () => this.setView(this.view === 'summary' ? 'moves' : 'summary')),
        btn('fb', '⚠ Próximo erro', 'Ir para o próximo erro', () => this.nextMistake()),
        btn('fb', '⇅ Virar', 'Virar tabuleiro', () => this.flip()),
      ),
    ));
    this.setView('moves');
  }

  setView(v) {
    this.view = v;
    this.bodyEl.replaceChildren(v === 'summary' ? this.summaryEl : v === 'settings' ? this.settingsEl : this.movesEl);
    this.movesEl.className = 'moves2';
    this.summaryEl.className = 'col-summary';
    this.render();
  }

  togglePlay() {
    if (this.playing) { clearInterval(this.playing); this.playing = null; this.playBtn.textContent = '▶'; return; }
    if (this.cur >= this.plies.length) this.go(0);
    this.playBtn.textContent = '❚❚';
    this.playing = setInterval(() => {
      if (this.cur >= this.plies.length) { this.togglePlay(); return; }
      this.go(this.cur + 1);
    }, 1100);
  }

  renderColumn() {
    const k = this.cur;
    this.bar.style.display = this.done ? 'none' : '';
    this.bar.firstChild.style.width = (this.progressPct || 0) + '%';
    this.bar.title = this.progressText || '';
    this.renderBubble(k);
    this.renderGraph();
    if (this.view === 'summary') this.renderSummary();
    if (this.view === 'moves') this.renderMoves2();
  }

  renderBubble(k) {
    const b = this.bubble;
    if (k === 0) {
      const sum = summarize(this.plies, this.results);
      const acc = (c) => (sum[c].accuracy == null ? '–' : sum[c].accuracy.toFixed(1));
      b.replaceChildren(
        h('div', { class: 'bh' }, h('b', {}, this.done ? 'Revisão pronta!' : 'Analisando a partida…')),
        h('div', { class: 'bt' }, this.done
          ? `Precisão: ${this.white.name} ${acc('w')} · ${this.black.name} ${acc('b')}. Use ➜ para revisar lance a lance.`
          : (this.progressText || 'Preparando o motor…')),
        this.opening ? h('div', { class: 'bs' }, this.opening) : null,
      );
      return;
    }
    const p = this.plies[k - 1], r = this.results[k - 1], ev = this.evals[k];
    if (!r || !ev) {
      b.replaceChildren(h('div', { class: 'bh' }, h('b', {}, p.san)), h('div', { class: 'bt' }, 'Analisando este lance…'));
      return;
    }
    const turn = this.fens[k].split(' ')[1];
    const num = `${p.moveNumber}${p.color === 'w' ? '.' : '...'} `;
    const subs = [];
    const bestSan = r.bestUci ? this.sanOf(p.fenBefore, r.bestUci) : null;
    if (!r.isBest && bestSan && !['book', 'forced'].includes(r.cls)) subs.push(`O melhor era ${bestSan}.`);
    const before = this.evals[k - 1];
    if (before?.score.mate > 0 && !(ev.score.mate < 0) && r.cls !== 'best') subs.push(`Havia mate em ${before.score.mate}.`);
    const mover = p.color === 'w' ? 'As brancas' : 'As pretas', other = p.color === 'w' ? 'As pretas' : 'As brancas';
    if (ev.score.mate < 0) subs.push(`${mover} têm mate em ${-ev.score.mate}.`);
    else if (ev.score.mate > 0) subs.push(`${other} têm mate em ${ev.score.mate}.`);
    if (r.cls === 'book' && this.opening) subs.push(this.opening);
    b.replaceChildren(
      h('div', { class: 'bh' }, badge(r.cls), h('b', { style: `color:${CLASSES[r.cls].color}` }, CLASSES[r.cls].label), h('span', { class: 'chip-eval' }, scoreText(ev.score, turn))),
      h('div', { class: 'bt' }, CLASSES[r.cls].text(num + p.san)),
      subs.length ? h('div', { class: 'bs' }, subs.join(' ')) : null,
    );
  }

  renderMoves2() {
    const el = this.movesEl;
    const scroll = el.scrollTop;
    el.replaceChildren();
    const NOTABLE = ['brilliant', 'great', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
    const cell = (i) => {
      const p = this.plies[i];
      if (!p) return h('span', { class: 'm2' });
      const r = this.results[i];
      const notable = r && NOTABLE.includes(r.cls);
      const piece = /^[KQRBN]/.test(p.san) ? h('img', { class: 'fig', src: pieceUrl(p.san[0]), alt: '' }) : null;
      return h('span', { class: 'm2' + (this.cur === i + 1 ? ' cur' : ''), onclick: () => this.go(i + 1), style: notable && r.cls !== 'book' ? `color:${CLASSES[r.cls].color}` : null },
        h('span', { class: 'bslot' }, notable ? badge(r.cls, true) : null), piece, piece ? p.san.slice(1) : p.san);
    };
    let i = 0, row = 0;
    const addRow = (n, a, b) => el.append(h('div', { class: 'row2' + (row++ % 2 ? ' alt' : '') }, h('span', { class: 'n' }, n + '.'), a, b));
    if (this.plies[0]?.color === 'b') { addRow(this.plies[0].moveNumber, h('span', { class: 'm2' }, '…'), cell(0)); i = 1; }
    for (; i < this.plies.length; i += 2) addRow(this.plies[i].moveNumber, cell(i), cell(i + 1));
    el.scrollTop = this.cur === 0 ? 0 : scroll;
    const cur = el.querySelector('.m2.cur');
    if (cur) {
      const top = cur.parentElement.offsetTop;
      if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 34) el.scrollTop = top - el.clientHeight / 2;
    }
  }

  flip() {
    this.orientation = this.orientation === 'w' ? 'b' : 'w';
    this.render();
  }

  boardState() {
    const k = this.cur;
    const last = this.plies[k - 1];
    const r = this.results[k - 1];
    const arrows = [];
    // Seta do melhor lance que deveria ter sido jogado
    if (this.showBest && r && !r.isBest && r.bestUci && !['book', 'forced'].includes(r.cls)) arrows.push([r.bestUci.slice(0, 2), r.bestUci.slice(2, 4), 'green']);
    const ev = this.evals[k];
    if (this.hint && ev?.best) arrows.push([ev.best.slice(0, 2), ev.best.slice(2, 4), 'blue']);
    const turn = this.fens[k].split(' ')[1];
    return {
      fen: this.fens[k],
      last: last ? { from: last.from, to: last.to } : null,
      arrows,
      badge: r && last ? { to: last.to, cls: r.cls } : null,
      evalPct: ev ? whiteWin(ev.score, turn) : 50,
      evalText: ev ? scoreText(ev.score, turn).replace(/^\+/, '') : '',
      orientation: this.orientation,
      pieceSet: getPieceSet(),
      theme: siteTheme,
      // Só anima avanço/retrocesso de um lance; saltos maiores trocam direto
      animate: this.shownPly == null || Math.abs(this.shownPly - k) <= 1,
    };
  }

  render() {
    const k = this.cur;
    this.display.show(this.boardState());
    this.shownPly = k;
    if (this.column) { this.renderColumn(); return; }
    if (role !== 'side') this.renderPlayers();
    this.renderProgress();
    this.renderCoach(k);
    this.renderGraph();
    this.renderSummary();
    this.renderMoves();
  }

  renderPlayers() {
    const sum = summarize(this.plies, this.results);
    const row = (p, color) => [h('span', { class: 'dot ' + color }), p.name, p.elo ? h('span', { class: 'elo' }, `(${p.elo})`) : null,
      h('span', { class: 'acc' }, sum[color].accuracy != null && this.done ? `Precisão ${sum[color].accuracy.toFixed(1)}` : '')];
    const top = this.orientation === 'w' ? ['b', this.black] : ['w', this.white];
    const bottom = this.orientation === 'w' ? ['w', this.white] : ['b', this.black];
    this.topPlayer.replaceChildren(...row(top[1], top[0]).filter(Boolean));
    this.bottomPlayer.replaceChildren(...row(bottom[1], bottom[0]).filter(Boolean));
  }

  renderProgress() {
    if (this.done) {
      this.progress.style.display = 'none';
      return;
    }
    this.progress.style.display = '';
    this.progress.replaceChildren(
      h('div', { class: 'progress-text' }, h('span', {}, this.progressText || 'Preparando o motor…'), h('span', {}, `${Math.round(this.progressPct || 0)}%`)),
      h('div', { class: 'progress' }, h('i', { style: `width:${this.progressPct || 0}%` })),
    );
  }

  renderCoach(k) {
    if (k === 0) {
      this.coach.replaceChildren(h('div', { class: 'coach' }, h('div', {},
        h('div', { class: 'text' }, 'Posição inicial'),
        h('div', { class: 'sub' }, this.opening ? `Abertura: ${this.opening}` : 'Use ◀ ▶ ou as setas do teclado para navegar.'))));
      return;
    }
    const p = this.plies[k - 1];
    const r = this.results[k - 1];
    const num = `${p.moveNumber}${p.color === 'w' ? '.' : '...'} `;
    if (!r) {
      this.coach.replaceChildren(h('div', { class: 'coach' }, h('div', { class: 'text' }, `${num}${p.san}`), h('span', { class: 'evalchip' }, '…')));
      return;
    }
    const ev = this.evals[k];
    const turn = this.fens[k].split(' ')[1];
    const bestSan = r.bestUci ? this.sanOf(p.fenBefore, r.bestUci) : null;
    const subs = [];
    if (r.cls === 'book' && this.opening) subs.push(`Abertura: ${this.opening}`);
    if (!r.isBest && bestSan && !['book', 'forced'].includes(r.cls)) subs.push(`O melhor era ${bestSan}.`);
    const before = this.evals[k - 1];
    if (before?.score.mate > 0 && !(ev.score.mate < 0) && r.cls !== 'best') subs.push(`Havia mate em ${before.score.mate}.`);
    const mover = p.color === 'w' ? 'As brancas' : 'As pretas', other = p.color === 'w' ? 'As pretas' : 'As brancas';
    if (ev.score.mate < 0) subs.push(`${mover} têm mate em ${-ev.score.mate}.`);
    else if (ev.score.mate > 0) subs.push(`${other} têm mate em ${ev.score.mate}.`);
    this.coach.replaceChildren(h('div', { class: 'coach' },
      badge(r.cls),
      h('div', {}, h('div', { class: 'text' }, CLASSES[r.cls].text(num + p.san)), subs.length ? h('div', { class: 'sub' }, subs.join(' ')) : null),
      h('span', { class: 'evalchip' }, scoreText(ev.score, turn)),
    ));
  }

  renderGraph() {
    const W = 400, H = 90, N = this.plies.length;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const ev = this.evals[i];
      if (!ev) break;
      const pct = whiteWin(ev.score, this.fens[i].split(' ')[1]);
      pts.push([(i / Math.max(1, N)) * W, H - (pct / 100) * H]);
    }
    let svg = `<svg class="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    if (pts.length > 1) {
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      svg += `<path d="${d} L${pts.at(-1)[0]},${H} L0,${H} Z" fill="#f2f2ee"/>`;
    }
    svg += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#7f8796" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    this.results.forEach((r, i) => {
      if (!r || !['brilliant', 'great', 'mistake', 'miss', 'blunder'].includes(r.cls) || !pts[i + 1]) return;
      svg += `<circle cx="${pts[i + 1][0]}" cy="${pts[i + 1][1]}" r="4" fill="${CLASSES[r.cls].color}" stroke="#121722" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    });
    const x = (this.cur / Math.max(1, N)) * W;
    svg += `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="#f2b33d" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
    this.graph.innerHTML = svg;
    this.graph.firstChild.onclick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      this.go(Math.round(((e.clientX - rect.left) / rect.width) * N));
    };
  }

  renderSummary() {
    const sum = summarize(this.plies, this.results);
    const fmt = (a) => (a == null ? '–' : a.toFixed(1));
    const rows = [
      h('div', { class: 'l head' }, this.white.name), h('div', { class: 'mid head' }, ''), h('div', { class: 'r head' }, this.black.name),
      h('div', { class: 'l accrow' }, fmt(sum.w.accuracy)), h('div', { class: 'mid' }, 'Precisão'), h('div', { class: 'r accrow' }, fmt(sum.b.accuracy)),
    ];
    for (const cls of CLASS_ORDER) {
      rows.push(
        h('div', { class: 'l', style: `color:${CLASSES[cls].color}` }, sum.w.counts[cls] || 0),
        h('div', { class: 'mid' }, badge(cls, true), h('span', { style: 'min-width:120px' }, CLASSES[cls].label)),
        h('div', { class: 'r', style: `color:${CLASSES[cls].color}` }, sum.b.counts[cls] || 0),
      );
    }
    this.summaryEl.replaceChildren(h('div', { class: 'summary' }, rows), this.done ? h('div', { class: 'muted small', style: 'margin-top:10px;text-align:center' }, `Análise concluída em ${this.elapsed}s · ${this.engine?.name || ''}`) : null);
  }

  renderMoves() {
    const el = this.movesEl;
    const scroll = el.scrollTop;
    el.replaceChildren();
    const cell = (i) => {
      const p = this.plies[i];
      if (!p) return h('span');
      const r = this.results[i];
      return h('span', { class: 'mv' + (this.cur === i + 1 ? ' cur' : ''), onclick: () => this.go(i + 1) }, r ? badge(r.cls, true) : null, p.san);
    };
    let i = 0;
    if (this.plies[0]?.color === 'b') { el.append(h('span', { class: 'n' }, this.plies[0].moveNumber + '.'), h('span', { class: 'mv' }, '…'), cell(0)); i = 1; }
    for (; i < this.plies.length; i += 2) el.append(h('span', { class: 'n' }, this.plies[i].moveNumber + '.'), cell(i), cell(i + 1));
    el.scrollTop = scroll;
    const cur = el.querySelector('.mv.cur');
    if (cur) {
      const top = cur.offsetTop - el.offsetTop;
      if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2;
    }
  }
}

// ---------- comunicação entre os dois painéis ----------
function navKey(key) {
  const r = current;
  if (!r) return;
  if (key === 'ArrowLeft') r.go(r.cur - 1);
  else if (key === 'ArrowRight') r.go(r.cur + 1);
  else if (key === 'Home') r.go(0);
  else if (key === 'End') r.go(r.plies.length);
}

function startBoardRole() {
  // Overlay do tabuleiro: só exibe o que a coluna mandar
  app.innerHTML = '';
  const d = new BoardDisplay('w');
  app.append(h('div', { class: 'bv' }, d.el));
  d.show({ fen: START_FEN, evalPct: 50, evalText: '' });
  channel.onmessage = (e) => { if (e.data?.type === 'state') d.show(e.data.st); };
  channel.postMessage({ type: 'hello' });
  document.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { channel.postMessage({ type: 'nav', key: e.key }); e.preventDefault(); }
  });
}

if (role === 'side' && channel) {
  channel.onmessage = (e) => {
    if (e.data?.type === 'nav') navKey(e.data.key);
    else if (e.data?.type === 'hello' && current?.display?.last) current.display.show(current.display.last);
  };
}

// ---------- onboarding: pede para ativar Chrome na inicialização ----------
function onboardingScreen() {
  return new Promise((resolve) => {
    app.innerHTML = '';
    app.classList.add('solid');
    const cmdStyle = 'background:#1a1a2e;color:#0f0;padding:10px 14px;border-radius:6px;font-family:monospace;font-size:0.88em;word-break:break-all;position:relative;cursor:pointer;border:1px solid #333;margin:6px 0 12px';
    const copyHint = 'color:#666;font-size:0.8em;text-align:right;margin-top:2px';
    function cmdBox(text) {
      const box = h('div', { style: cmdStyle, title: 'Clique para copiar', onclick: () => {
        navigator.clipboard.writeText(text).then(() => {
          box.style.borderColor = '#0f0';
          setTimeout(() => { box.style.borderColor = '#333'; }, 800);
        });
      } }, text);
      return h('div', {}, box, h('div', { style: copyHint }, 'clique para copiar'));
    }

    const winCmd = 'powershell -command "& {$paths=@(\'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\',\'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe\',\\"$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe\\",\\"$env:PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe\\");$found=$null;foreach($p in $paths){if(Test-Path $p){$found=$p;break}};if(-not $found){$reg=Get-ItemProperty \'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\' -ErrorAction SilentlyContinue;if($reg){$found=$reg.\'(default)\'}};if($found){$s=(New-Object -COM WScript.Shell).CreateShortcut(\\"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Chrome.lnk\\");$s.TargetPath=$found;$s.Save()}}"';
    const macCmd = 'osascript -e \'tell application "System Events" to make login item at end with properties {path:"/Applications/Google Chrome.app", hidden:false}\'';
    const linuxCmd = 'mkdir -p ~/.config/autostart && echo \'[Desktop Entry]\\nType=Application\\nName=Google Chrome\\nExec=google-chrome\' > ~/.config/autostart/chrome.desktop';

    app.append(topbar(), h('div', { class: 'center' },
      h('div', { class: 'card' },
        h('h2', {}, 'Configuração do Stockfish (única vez)'),
        h('p', { class: 'muted' }, 'O motor Stockfish WASM precisa que o Chrome esteja em execução desde a inicialização do sistema para manter o cache de tabelas de avaliação (NNUE) pré-carregado. Sem isso, cada análise precisaria recarregar ~40 MB de dados, deixando a revisão muito lenta.'),
        h('p', { class: 'muted', style: 'margin-top:8px' }, 'Essa configuração é feita uma única vez. Copie o comando do seu sistema e cole onde indicado:'),
        h('details', { style: 'text-align:left;margin:14px 0;color:#ccc;font-size:0.93em;line-height:1.8', open: true },
          h('summary', { style: 'cursor:pointer;font-weight:bold;color:#fff;margin-bottom:6px' }, 'Windows'),
          h('p', { style: 'margin:4px 0;color:#aaa' }, '1. Pressione Win + R para abrir o Executar'),
          h('p', { style: 'margin:4px 0;color:#aaa' }, '2. Cole este comando e pressione Enter:'),
          cmdBox(winCmd),
          h('p', { style: 'margin:2px 0;color:#888;font-size:0.85em' }, 'Isso cria um atalho do Chrome na pasta de Inicialização do Windows. O Chrome vai abrir automaticamente quando o computador ligar, antes mesmo do desktop carregar por completo.'),
        ),
        h('details', { style: 'text-align:left;margin:8px 0;color:#ccc;font-size:0.93em;line-height:1.8' },
          h('summary', { style: 'cursor:pointer;font-weight:bold;color:#fff;margin-bottom:6px' }, 'Mac'),
          h('p', { style: 'margin:4px 0;color:#aaa' }, '1. Abra o Terminal (Aplicativos → Utilitários → Terminal)'),
          h('p', { style: 'margin:4px 0;color:#aaa' }, '2. Cole este comando e pressione Enter:'),
          cmdBox(macCmd),
        ),
        h('details', { style: 'text-align:left;margin:8px 0;color:#ccc;font-size:0.93em;line-height:1.8' },
          h('summary', { style: 'cursor:pointer;font-weight:bold;color:#fff;margin-bottom:6px' }, 'Linux'),
          h('p', { style: 'margin:4px 0;color:#aaa' }, '1. Abra o Terminal'),
          h('p', { style: 'margin:4px 0;color:#aaa' }, '2. Cole este comando e pressione Enter:'),
          cmdBox(linuxCmd),
        ),
        h('p', { class: 'muted small', style: 'margin-top:14px' }, 'Após executar o comando, reinicie o computador para aplicar. A análise não funciona sem essa configuração.'),
        h('button', { class: 'btn primary block', onclick: () => {
          chrome.storage.local.set({ onboardingDone: true });
          resolve();
        } }, 'Pronto, já executei o comando'),
      ),
    ));
  });
}

// ---------- início ----------
(async () => {
  if (role === 'board' && channel) { startBoardRole(); return; }
  // Verifica se o onboarding já foi feito
  const ob = await chrome.storage.local.get('onboardingDone').catch(() => ({}));
  if (!ob.onboardingDone) await onboardingScreen();
  const s = await storage.get();
  if (!s.username && info.me) { s.username = info.me; storage.set({ username: info.me }); }
  if (info.pgn) { start(info.pgn, {}); return; }
  if (!info.id && !s.username) { formScreen(info.url ? 'Não identifiquei a partida nesta página. Informe seu usuário para revisar sua última partida, ou cole o PGN.' : ''); return; }
  loadingScreen('Buscando a partida no chess.com…');
  const g = await findGame(info, s.username).catch(() => null);
  if (g) startFromApi(g);
  else formScreen(info.id ? 'Não encontrei esta partida automaticamente. Informe seu usuário do chess.com ou cole o PGN.' : 'Não encontrei partidas recentes.');
})();
