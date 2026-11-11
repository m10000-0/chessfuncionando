// Componente de tabuleiro interativo: clique ou arraste, promoção, destaques, setas e estrelas.
import { sqName, sqIndex, colorOf, typeOf } from './chess.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
export const pieceGlyph = (p) => GLYPH[typeOf(p)] + '︎';

// Peças em SVG (conjunto cburnett, em pieces/)
export const PIECE_SETS = ['gioco', 'staunty', 'tatiana', 'caliente', 'dubrovny', 'maestro', 'cardinal', 'merida', 'cburnett'];
let pieceSet = 'gioco';
// 'site': usa as imagens do tema do próprio site (modelo com {c} = cor e {t} = tipo da peça)
let siteTemplate = null;
export function setSiteTemplate(t) { siteTemplate = t || null; }
export const hasSiteTemplate = () => !!siteTemplate;
export function setPieceSet(s) { if (PIECE_SETS.includes(s) || (s === 'site' && siteTemplate)) pieceSet = s; }
export const getPieceSet = () => pieceSet;
export const pieceUrl = (p, set = pieceSet) => (set === 'site' && siteTemplate
  ? siteTemplate.replace('{c}', colorOf(p)).replace('{t}', typeOf(p))
  : `pieces/${set}/${colorOf(p)}${typeOf(p).toUpperCase()}.svg`);

function paint(el, p) {
  el.style.backgroundImage = `url(${pieceUrl(p)})`;
  el.setAttribute('aria-label', p);
}

export function pieceEl(p) {
  const el = document.createElement('div');
  el.className = `piece ${colorOf(p) === 'w' ? 'white' : 'black'}`;
  paint(el, p);
  el.dataset.piece = p;
  return el;
}

export class Board {
  constructor(container, opts = {}) {
    this.opts = {
      orientation: 'w',
      coords: true,
      movable: null, // 'w' | 'b' | 'both' | null
      dests: () => [], // (sq) => ['e4', ...]
      onMove: () => {}, // (from, to, promotion)
      onSquareClick: null, // (sq) => void (modo "clique em casas")
      ...opts,
    };
    this.root = document.createElement('div');
    this.root.className = 'board';
    this.root.innerHTML = '<div class="squares"></div><div class="pieces"></div><svg class="arrows" viewBox="0 0 800 800"></svg><div class="board-overlay"></div>';
    container.appendChild(this.root);
    this.squaresEl = this.root.querySelector('.squares');
    this.piecesEl = this.root.querySelector('.pieces');
    this.arrowsEl = this.root.querySelector('.arrows');
    this.overlayEl = this.root.querySelector('.board-overlay');
    this.pieceEls = new Map(); // índice -> el
    this.position = new Array(64).fill(null);
    this.marks = {};
    this.selected = null;
    this.drag = null;
    this.buildSquares();
    this.bindEvents();
  }

  destroy() {
    this.root.remove();
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
  }

  // ---------- Geometria ----------
  viewIndex(i) {
    // posição visual (0 = canto superior esquerdo) de uma casa
    return this.opts.orientation === 'w' ? i : 63 - i;
  }

  placeEl(el, i) {
    const v = this.viewIndex(i);
    el.style.transform = `translate(${(v & 7) * 100}%, ${(v >> 3) * 100}%)`;
  }

  squareAt(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * 8);
    const y = Math.floor(((clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
    const v = y * 8 + x;
    return this.opts.orientation === 'w' ? v : 63 - v;
  }

  buildSquares() {
    this.squaresEl.innerHTML = '';
    this.squareEls = [];
    for (let v = 0; v < 64; v++) {
      const i = this.opts.orientation === 'w' ? v : 63 - v;
      const d = document.createElement('div');
      const light = ((i >> 3) + (i & 7)) % 2 === 0;
      d.className = 'sq ' + (light ? 'light' : 'dark');
      d.dataset.sq = sqName(i);
      if (this.opts.coords) {
        if ((v >> 3) === 7) d.insertAdjacentHTML('beforeend', `<span class="coord file">${sqName(i)[0]}</span>`);
        if ((v & 7) === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${sqName(i)[1]}</span>`);
      }
      this.squaresEl.appendChild(d);
      this.squareEls[i] = d;
    }
    this.applyMarks();
  }

  setOrientation(color) {
    if (this.opts.orientation === color) return;
    this.opts.orientation = color;
    this.buildSquares();
    for (const [i, el] of this.pieceEls) { el.style.transition = 'none'; this.placeEl(el, i); }
    requestAnimationFrame(() => { for (const el of this.pieceEls.values()) el.style.transition = ''; });
    this.drawArrows();
  }

  flip() { this.setOrientation(this.opts.orientation === 'w' ? 'b' : 'w'); }

  set movable(c) { this.opts.movable = c; if (!c) this.deselect(); }
  get movable() { return this.opts.movable; }

  // ---------- Posição ----------
  // board: array de 64 (ou objeto Chess)
  setPosition(boardOrChess, { lastMove = null, check = null, animate = true } = {}) {
    if (!animate) {
      // Troca direta (saltos de vários lances): sem deslizar as peças
      this.root.classList.add('no-anim');
      clearTimeout(this._noAnim);
      this._noAnim = setTimeout(() => this.root.classList.remove('no-anim'), 60);
    }
    const target = Array.isArray(boardOrChess) ? boardOrChess.slice() : boardOrChess.board.slice();
    const oldEls = this.pieceEls;
    const next = new Map();
    const unmatchedOld = [];
    for (const [i, el] of oldEls) {
      if (target[i] === el.dataset.piece) next.set(i, el);
      else unmatchedOld.push([i, el]);
    }
    const needed = [];
    for (let i = 0; i < 64; i++) if (target[i] && !next.has(i)) needed.push(i);
    // Reaproveita elementos (anima o deslocamento) — inclusive promoção a partir do peão
    for (const i of needed) {
      let bestK = -1, bestD = 99;
      unmatchedOld.forEach(([j, el], k) => {
        let same = el.dataset.piece === target[i];
        if (!same && lastMove && j === lastMove.from && i === lastMove.to && typeOf(el.dataset.piece) === 'p') same = true;
        if (!same) return;
        const d = Math.abs((i >> 3) - (j >> 3)) + Math.abs((i & 7) - (j & 7));
        if (d < bestD) { bestD = d; bestK = k; }
      });
      let el;
      if (bestK >= 0) {
        el = unmatchedOld.splice(bestK, 1)[0][1];
        if (el.dataset.piece !== target[i]) {
          el.dataset.piece = target[i];
          paint(el, target[i]);
          el.className = `piece ${colorOf(target[i]) === 'w' ? 'white' : 'black'}`;
        }
      } else {
        el = pieceEl(target[i]);
        el.classList.add('appear');
        el.style.transition = 'none';
        this.placeEl(el, i);
        this.piecesEl.appendChild(el);
        void el.offsetWidth;
        el.style.transition = '';
      }
      this.placeEl(el, i);
      next.set(i, el);
    }
    for (const [, el] of unmatchedOld) {
      el.classList.add('vanish');
      setTimeout(() => el.remove(), 180);
    }
    this.pieceEls = next;
    this.position = target;
    this.marks.last = lastMove ? [lastMove.from, lastMove.to].map((s) => (typeof s === 'string' ? sqIndex(s) : s)) : [];
    this.marks.check = check != null ? [typeof check === 'string' ? sqIndex(check) : check] : [];
    this.deselect();
  }

  repaint() {
    for (const el of this.pieceEls.values()) paint(el, el.dataset.piece);
  }

  // ---------- Marcações ----------
  // tipos: last, check, selected, dest, capture, star, hint, good, bad, target, premark
  setMarks(type, squares) {
    this.marks[type] = (squares || []).map((s) => (typeof s === 'string' ? sqIndex(s) : s));
    this.applyMarks();
  }

  applyMarks() {
    if (!this.squareEls) return;
    for (let i = 0; i < 64; i++) {
      const el = this.squareEls[i];
      const cls = ['sq', ((i >> 3) + (i & 7)) % 2 === 0 ? 'light' : 'dark'];
      for (const [type, list] of Object.entries(this.marks)) if (list && list.includes(i)) cls.push('m-' + type);
      el.className = cls.join(' ');
    }
  }

  flash(sq, type = 'bad', ms = 600) {
    const i = typeof sq === 'string' ? sqIndex(sq) : sq;
    const cur = this.marks[type] || [];
    this.setMarks(type, cur.concat(i));
    setTimeout(() => this.setMarks(type, (this.marks[type] || []).filter((x) => x !== i)), ms);
  }

  // setas: [['e2','e4','green'], ...]
  setArrows(list = []) {
    this.arrows = list;
    this.drawArrows();
  }

  drawArrows() {
    const list = this.arrows || [];
    const center = (s) => {
      const v = this.viewIndex(sqIndex(s));
      return [(v & 7) * 100 + 50, (v >> 3) * 100 + 50];
    };
    const colors = { green: 'var(--arrow-green)', red: 'var(--arrow-red)', blue: 'var(--arrow-blue)', yellow: 'var(--arrow-yellow)' };
    let html = '<defs>' + Object.entries(colors).map(([k, c]) => `<marker id="ah-${k}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${c}"/></marker>`).join('') + '</defs>';
    for (const [a, b, color = 'green'] of list) {
      const [x1, y1] = center(a), [x2, y2] = center(b);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ex = x2 - ((x2 - x1) / len) * 28, ey = y2 - ((y2 - y1) / len) * 28;
      html += `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${colors[color] || color}" stroke-width="16" stroke-linecap="round" marker-end="url(#ah-${color})" opacity="0.85"/>`;
    }
    this.arrowsEl.innerHTML = html;
  }

  // ---------- Interação ----------
  bindEvents() {
    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this._move = (e) => this.onMoveEvt(e);
    this._up = (e) => this.onUp(e);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  canMove(i) {
    const p = this.position[i];
    if (!p || !this.opts.movable) return false;
    return this.opts.movable === 'both' || colorOf(p) === this.opts.movable;
  }

  select(i) {
    this.selected = i;
    const dests = this.opts.dests(sqName(i)) || [];
    this.currentDests = dests.map(sqIndex);
    this.marks.selected = [i];
    this.marks.dest = this.currentDests.filter((d) => !this.position[d]);
    this.marks.capture = this.currentDests.filter((d) => this.position[d]);
    this.applyMarks();
  }

  deselect() {
    this.selected = null;
    this.currentDests = [];
    this.marks.selected = [];
    this.marks.dest = [];
    this.marks.capture = [];
    this.applyMarks();
  }

  onDown(e) {
    if (e.button !== 0 || this.promoting) return;
    const i = this.squareAt(e.clientX, e.clientY);
    if (i < 0) return;
    if (this.opts.onSquareClick) { this.opts.onSquareClick(sqName(i)); return; }
    if (this.selected != null && this.currentDests.includes(i)) {
      e.preventDefault();
      this.tryMove(this.selected, i);
      return;
    }
    if (this.canMove(i)) {
      e.preventDefault();
      const wasSelected = this.selected === i;
      this.select(i);
      const el = this.pieceEls.get(i);
      if (el) {
        const r = this.root.getBoundingClientRect();
        this.drag = { from: i, el, rect: r, startX: e.clientX, startY: e.clientY, moved: false, wasSelected };
      }
    } else {
      this.deselect();
    }
  }

  onMoveEvt(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    d.moved = true;
    const size = d.rect.width / 8;
    d.el.classList.add('dragging');
    const x = e.clientX - d.rect.left - size / 2, y = e.clientY - d.rect.top - size / 2;
    d.el.style.transform = `translate(${(x / size) * 100}%, ${(y / size) * 100}%)`;
    const over = this.squareAt(e.clientX, e.clientY);
    this.marks.hover = over >= 0 && this.currentDests.includes(over) ? [over] : [];
    this.applyMarks();
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.marks.hover = [];
    d.el.classList.remove('dragging');
    if (!d.moved) {
      if (d.wasSelected) this.deselect();
      return;
    }
    const to = this.squareAt(e.clientX, e.clientY);
    d.el.style.transition = 'none';
    this.placeEl(d.el, d.from);
    void d.el.offsetWidth;
    d.el.style.transition = '';
    if (to >= 0 && to !== d.from && this.currentDests.includes(to)) this.tryMove(d.from, to, true);
    else this.applyMarks();
  }

  async tryMove(from, to, dragged = false) {
    const p = this.position[from];
    let promotion;
    if (typeOf(p) === 'p' && ((to >> 3) === 0 || (to >> 3) === 7)) {
      if (dragged) { const el = this.pieceEls.get(from); if (el) { el.style.transition = 'none'; this.placeEl(el, to); } }
      promotion = await this.askPromotion(to, colorOf(p));
      if (!promotion) {
        const el = this.pieceEls.get(from);
        if (el) { this.placeEl(el, from); void el.offsetWidth; el.style.transition = ''; }
        this.deselect();
        return;
      }
    } else if (dragged) {
      // Coloca a peça no destino sem animar (já foi arrastada)
      const el = this.pieceEls.get(from);
      if (el) { el.style.transition = 'none'; this.placeEl(el, to); void el.offsetWidth; requestAnimationFrame(() => (el.style.transition = '')); }
    }
    this.deselect();
    this.opts.onMove(sqName(from), sqName(to), promotion);
  }

  askPromotion(to, color) {
    return new Promise((resolve) => {
      this.promoting = true;
      const v = this.viewIndex(to);
      const col = v & 7, top = (v >> 3) === 0;
      const box = document.createElement('div');
      box.className = 'promo';
      box.style.left = `${col * 12.5}%`;
      box.style[top ? 'top' : 'bottom'] = '0';
      for (const t of ['q', 'n', 'r', 'b']) {
        const p = color === 'w' ? t.toUpperCase() : t;
        const btn = document.createElement('button');
        btn.className = 'promo-btn';
        btn.title = { q: 'Dama', n: 'Cavalo', r: 'Torre', b: 'Bispo' }[t];
        btn.appendChild(pieceEl(p));
        btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); done(t); });
        box.appendChild(btn);
      }
      const shade = document.createElement('div');
      shade.className = 'promo-shade';
      shade.addEventListener('pointerdown', (e) => { e.stopPropagation(); done(null); });
      const done = (t) => {
        this.promoting = false;
        shade.remove();
        box.remove();
        resolve(t);
      };
      this.overlayEl.append(shade, box);
    });
  }
}
