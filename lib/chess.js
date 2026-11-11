// Motor de regras de xadrez (sem dependências).
// Casas indexadas de 0 a 63: a8 = 0, h8 = 7, a1 = 56, h1 = 63.
// Peças: 'P','N','B','R','Q','K' (brancas) e minúsculas (pretas); vazio = null.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

export const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
export const sqIndex = (s) => (8 - parseInt(s[1], 10)) * 8 + FILES.indexOf(s[0]);
export const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
export const typeOf = (p) => (p ? p.toLowerCase() : null);

const KNIGHT_TARGETS = [];
const KING_TARGETS = [];
(function precompute() {
  const kn = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const kg = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  for (let i = 0; i < 64; i++) {
    const r = i >> 3, f = i & 7;
    KNIGHT_TARGETS[i] = kn.filter(([dr, df]) => r + dr >= 0 && r + dr < 8 && f + df >= 0 && f + df < 8).map(([dr, df]) => (r + dr) * 8 + f + df);
    KING_TARGETS[i] = kg.filter(([dr, df]) => r + dr >= 0 && r + dr < 8 && f + df >= 0 && f + df < 8).map(([dr, df]) => (r + dr) * 8 + f + df);
  }
})();
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export class Chess {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) throw new Error('FEN inválida: ' + fen);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN inválida: ' + fen);
    this.board = new Array(64).fill(null);
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += parseInt(ch, 10);
        else {
          if (!/[pnbrqkPNBRQK]/.test(ch) || f > 7) throw new Error('FEN inválida: ' + fen);
          this.board[r * 8 + f] = ch;
          f++;
        }
      }
      if (f !== 8) throw new Error('FEN inválida: ' + fen);
    });
    this.turn = parts[1] === 'b' ? 'b' : 'w';
    const c = parts[2] || '-';
    this.castling = { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') };
    // Corrige direitos de roque impossíveis
    if (this.board[60] !== 'K') { this.castling.K = this.castling.Q = false; }
    if (this.board[63] !== 'R') this.castling.K = false;
    if (this.board[56] !== 'R') this.castling.Q = false;
    if (this.board[4] !== 'k') { this.castling.k = this.castling.q = false; }
    if (this.board[7] !== 'r') this.castling.k = false;
    if (this.board[0] !== 'r') this.castling.q = false;
    this.ep = parts[3] && parts[3] !== '-' ? sqIndex(parts[3]) : -1;
    this.halfmove = parseInt(parts[4] || '0', 10) || 0;
    this.fullmove = parseInt(parts[5] || '1', 10) || 1;
    this.stack = [];
    this.history = [];
    this.positions = [this.positionKey()];
    return this;
  }

  clone() {
    const c = new Chess(this.fen());
    return c;
  }

  get(sq) {
    return this.board[typeof sq === 'string' ? sqIndex(sq) : sq];
  }

  put(piece, sq) {
    this.board[typeof sq === 'string' ? sqIndex(sq) : sq] = piece;
  }

  fen() {
    let s = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) empty++;
        else {
          if (empty) { s += empty; empty = 0; }
          s += p;
        }
      }
      if (empty) s += empty;
      if (r < 7) s += '/';
    }
    let c = (this.castling.K ? 'K' : '') + (this.castling.Q ? 'Q' : '') + (this.castling.k ? 'k' : '') + (this.castling.q ? 'q' : '');
    return `${s} ${this.turn} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  positionKey() {
    // Considera en passant apenas se houver captura possível (simplificação: inclui sempre)
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  kingSquare(color) {
    const k = color === 'w' ? 'K' : 'k';
    for (let i = 0; i < 64; i++) if (this.board[i] === k) return i;
    return -1;
  }

  isAttacked(sq, by) {
    const b = this.board;
    const r = sq >> 3, f = sq & 7;
    // Peões
    if (by === 'w') {
      if (r < 7) {
        if (f > 0 && b[sq + 7] === 'P') return true;
        if (f < 7 && b[sq + 9] === 'P') return true;
      }
    } else if (r > 0) {
      if (f > 0 && b[sq - 9] === 'p') return true;
      if (f < 7 && b[sq - 7] === 'p') return true;
    }
    const N = by === 'w' ? 'N' : 'n', K = by === 'w' ? 'K' : 'k';
    const B = by === 'w' ? 'B' : 'b', R = by === 'w' ? 'R' : 'r', Q = by === 'w' ? 'Q' : 'q';
    for (const t of KNIGHT_TARGETS[sq]) if (b[t] === N) return true;
    for (const t of KING_TARGETS[sq]) if (b[t] === K) return true;
    for (const [dr, df] of DIAG) {
      let rr = r + dr, ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        const p = b[rr * 8 + ff];
        if (p) { if (p === B || p === Q) return true; break; }
        rr += dr; ff += df;
      }
    }
    for (const [dr, df] of ORTH) {
      let rr = r + dr, ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        const p = b[rr * 8 + ff];
        if (p) { if (p === R || p === Q) return true; break; }
        rr += dr; ff += df;
      }
    }
    return false;
  }

  attackers(sq, by) {
    // Lista de casas com peças de `by` atacando `sq` (usado em lições/heurísticas)
    const res = [];
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (!p || colorOf(p) !== by) continue;
      if (this.pieceAttacks(i).includes(sq)) res.push(i);
    }
    return res;
  }

  pieceAttacks(from) {
    // Casas atacadas por uma peça (independente de legalidade)
    const b = this.board, p = b[from];
    if (!p) return [];
    const t = typeOf(p), c = colorOf(p);
    const r = from >> 3, f = from & 7;
    const out = [];
    if (t === 'p') {
      const dr = c === 'w' ? -1 : 1;
      const rr = r + dr;
      if (rr >= 0 && rr < 8) {
        if (f > 0) out.push(rr * 8 + f - 1);
        if (f < 7) out.push(rr * 8 + f + 1);
      }
      return out;
    }
    if (t === 'n') return KNIGHT_TARGETS[from].slice();
    if (t === 'k') return KING_TARGETS[from].slice();
    const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
    for (const [dr, df] of dirs) {
      let rr = r + dr, ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        out.push(rr * 8 + ff);
        if (b[rr * 8 + ff]) break;
        rr += dr; ff += df;
      }
    }
    return out;
  }

  inCheck(color = this.turn) {
    const k = this.kingSquare(color);
    return k >= 0 && this.isAttacked(k, color === 'w' ? 'b' : 'w');
  }

  // Lances pseudo-legais (podem deixar o rei em xeque)
  pseudoMoves(onlyCaptures = false) {
    const b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
    const moves = [];
    const add = (from, to, flags, promotion) => {
      moves.push({ from, to, piece: b[from], captured: flags === 'e' ? (us === 'w' ? 'p' : 'P') : b[to], flags, promotion: promotion || null });
    };
    for (let from = 0; from < 64; from++) {
      const p = b[from];
      if (!p || colorOf(p) !== us) continue;
      const t = typeOf(p);
      const r = from >> 3, f = from & 7;
      if (t === 'p') {
        const dr = us === 'w' ? -1 : 1;
        const startRank = us === 'w' ? 6 : 1;
        const promoRank = us === 'w' ? 0 : 7;
        const r1 = r + dr;
        if (r1 < 0 || r1 > 7) continue;
        const one = r1 * 8 + f;
        const pushPromo = (to, flags) => {
          if (r1 === promoRank) for (const pr of ['q', 'r', 'b', 'n']) add(from, to, flags, pr);
          else add(from, to, flags);
        };
        if (!onlyCaptures || r1 === promoRank) {
          if (!b[one]) {
            pushPromo(one, 'n');
            if (!onlyCaptures && r === startRank) {
              const two = (r + 2 * dr) * 8 + f;
              if (!b[two]) add(from, two, 'b');
            }
          }
        }
        for (const df of [-1, 1]) {
          const ff = f + df;
          if (ff < 0 || ff > 7) continue;
          const to = r1 * 8 + ff;
          if (b[to] && colorOf(b[to]) === them) pushPromo(to, 'c');
          else if (to === this.ep && !b[to]) add(from, to, 'e');
        }
        continue;
      }
      if (t === 'n' || t === 'k') {
        const targets = t === 'n' ? KNIGHT_TARGETS[from] : KING_TARGETS[from];
        for (const to of targets) {
          const q = b[to];
          if (!q) { if (!onlyCaptures) add(from, to, 'n'); }
          else if (colorOf(q) === them) add(from, to, 'c');
        }
        if (t === 'k' && !onlyCaptures) this._castles(from, add);
        continue;
      }
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
      for (const [dr, df] of dirs) {
        let rr = r + dr, ff = f + df;
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
          const to = rr * 8 + ff;
          const q = b[to];
          if (!q) { if (!onlyCaptures) add(from, to, 'n'); }
          else { if (colorOf(q) === them) add(from, to, 'c'); break; }
          rr += dr; ff += df;
        }
      }
    }
    return moves;
  }

  _castles(from, add) {
    const b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
    if (us === 'w' && from === 60) {
      if (this.castling.K && b[63] === 'R' && !b[61] && !b[62] && !this.isAttacked(60, them) && !this.isAttacked(61, them) && !this.isAttacked(62, them)) add(60, 62, 'k');
      if (this.castling.Q && b[56] === 'R' && !b[59] && !b[58] && !b[57] && !this.isAttacked(60, them) && !this.isAttacked(59, them) && !this.isAttacked(58, them)) add(60, 58, 'q');
    } else if (us === 'b' && from === 4) {
      if (this.castling.k && b[7] === 'r' && !b[5] && !b[6] && !this.isAttacked(4, them) && !this.isAttacked(5, them) && !this.isAttacked(6, them)) add(4, 6, 'k');
      if (this.castling.q && b[0] === 'r' && !b[3] && !b[2] && !b[1] && !this.isAttacked(4, them) && !this.isAttacked(3, them) && !this.isAttacked(2, them)) add(4, 2, 'q');
    }
  }

  // Aplica um lance de baixo nível (sem validação). Retorna true se legal (rei não fica em xeque).
  makeMove(m) {
    const b = this.board, us = this.turn;
    this.stack.push({ castling: { ...this.castling }, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove, move: m });
    b[m.to] = m.promotion ? (us === 'w' ? m.promotion.toUpperCase() : m.promotion) : m.piece;
    b[m.from] = null;
    if (m.flags === 'e') b[us === 'w' ? m.to + 8 : m.to - 8] = null;
    else if (m.flags === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    else if (m.flags === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
    // Direitos de roque
    if (m.piece === 'K') { this.castling.K = this.castling.Q = false; }
    else if (m.piece === 'k') { this.castling.k = this.castling.q = false; }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) this.castling.K = false;
      else if (sq === 56) this.castling.Q = false;
      else if (sq === 7) this.castling.k = false;
      else if (sq === 0) this.castling.q = false;
    }
    this.ep = m.flags === 'b' ? (m.from + m.to) >> 1 : -1;
    this.halfmove = typeOf(m.piece) === 'p' || m.captured ? 0 : this.halfmove + 1;
    if (us === 'b') this.fullmove++;
    this.turn = us === 'w' ? 'b' : 'w';
    const k = this.kingSquare(us);
    return k < 0 || !this.isAttacked(k, this.turn);
  }

  unmakeMove() {
    const st = this.stack.pop();
    if (!st) return null;
    const m = st.move, b = this.board;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    const us = this.turn;
    b[m.from] = m.piece;
    if (m.flags === 'e') { b[m.to] = null; b[us === 'w' ? m.to + 8 : m.to - 8] = m.captured; }
    else b[m.to] = m.flags === 'c' ? m.captured : null;
    if (m.flags === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
    else if (m.flags === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
    this.castling = st.castling; this.ep = st.ep; this.halfmove = st.halfmove; this.fullmove = st.fullmove;
    return m;
  }

  legalMoves(onlyCaptures = false) {
    const out = [];
    for (const m of this.pseudoMoves(onlyCaptures)) {
      if (this.makeMove(m)) out.push(m);
      this.unmakeMove();
    }
    return out;
  }

  // API de alto nível ------------------------------------------------------
  moves(opts = {}) {
    let list = this.legalMoves();
    if (opts.square) {
      const s = typeof opts.square === 'string' ? sqIndex(opts.square) : opts.square;
      list = list.filter((m) => m.from === s);
    }
    if (opts.verbose === false) return list.map((m) => this.san(m, list));
    return list.map((m) => this.decorate(m, list));
  }

  decorate(m, list) {
    return { ...m, fromSq: sqName(m.from), toSq: sqName(m.to), uci: toUci(m), san: this.san(m, list) };
  }

  san(m, list = this.legalMoves()) {
    let s;
    if (m.flags === 'k') s = 'O-O';
    else if (m.flags === 'q') s = 'O-O-O';
    else {
      const t = typeOf(m.piece);
      const cap = m.flags === 'c' || m.flags === 'e';
      if (t === 'p') {
        s = (cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
        if (m.promotion) s += '=' + m.promotion.toUpperCase();
      } else {
        s = t.toUpperCase();
        const rivals = list.filter((o) => o.to === m.to && o.piece === m.piece && o.from !== m.from);
        if (rivals.length) {
          const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
          const sameRank = rivals.some((o) => (o.from >> 3) === (m.from >> 3));
          if (!sameFile) s += FILES[m.from & 7];
          else if (!sameRank) s += 8 - (m.from >> 3);
          else s += sqName(m.from);
        }
        s += (cap ? 'x' : '') + sqName(m.to);
      }
    }
    this.makeMove(m);
    if (this.inCheck()) s += this.legalMoves().length === 0 ? '#' : '+';
    this.unmakeMove();
    return s;
  }

  // Aceita 'e2e4', 'e7e8q', SAN ('Nf3') ou {from,to,promotion}
  findMove(input) {
    const list = this.legalMoves();
    if (typeof input === 'string') {
      const uci = input.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
      if (uci) input = { from: uci[1], to: uci[2], promotion: uci[3] };
      else {
        const clean = (x) => x.replace(/[+#!?]/g, '').replace('0-0-0', 'O-O-O').replace('0-0', 'O-O');
        const target = clean(input);
        return list.find((m) => clean(this.san(m, list)) === target) || null;
      }
    }
    const from = typeof input.from === 'string' ? sqIndex(input.from) : input.from;
    const to = typeof input.to === 'string' ? sqIndex(input.to) : input.to;
    const cands = list.filter((m) => m.from === from && m.to === to);
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    const pr = (input.promotion || 'q').toLowerCase();
    return cands.find((m) => m.promotion === pr) || null;
  }

  move(input) {
    const list = this.legalMoves();
    const m = this.findMove(input);
    if (!m) return null;
    const rec = this.decorate(m, list);
    rec.color = this.turn;
    rec.moveNumber = this.fullmove;
    rec.fenBefore = this.fen();
    this.makeMove(m);
    rec.fenAfter = this.fen();
    this.history.push(rec);
    this.positions.push(this.positionKey());
    return rec;
  }

  undo() {
    if (!this.history.length) return null;
    this.unmakeMove();
    this.positions.pop();
    return this.history.pop();
  }

  isCheckmate() { return this.inCheck() && this.legalMoves().length === 0; }
  isStalemate() { return !this.inCheck() && this.legalMoves().length === 0; }
  isInsufficientMaterial() {
    const pieces = this.board.filter(Boolean).filter((p) => typeOf(p) !== 'k');
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && ['n', 'b'].includes(typeOf(pieces[0]))) return true;
    if (pieces.every((p) => typeOf(p) === 'b')) {
      const colors = new Set();
      this.board.forEach((p, i) => { if (p && typeOf(p) === 'b') colors.add(((i >> 3) + (i & 7)) % 2); });
      return colors.size === 1;
    }
    return false;
  }
  isThreefold() {
    const key = this.positions[this.positions.length - 1];
    return this.positions.filter((k) => k === key).length >= 3;
  }
  isDraw() { return this.isStalemate() || this.isInsufficientMaterial() || this.halfmove >= 100 || this.isThreefold(); }
  isGameOver() { return this.legalMoves().length === 0 || this.isDraw(); }

  result() {
    if (this.isCheckmate()) return { over: true, winner: this.turn === 'w' ? 'b' : 'w', reason: 'xeque-mate' };
    if (this.isStalemate()) return { over: true, winner: null, reason: 'afogamento' };
    if (this.isInsufficientMaterial()) return { over: true, winner: null, reason: 'material insuficiente' };
    if (this.halfmove >= 100) return { over: true, winner: null, reason: 'regra dos 50 lances' };
    if (this.isThreefold()) return { over: true, winner: null, reason: 'repetição tripla' };
    return { over: false };
  }

  pgnMoves() {
    return this.history.map((m, i) => (m.color === 'w' ? `${m.moveNumber}. ` : i === 0 ? `${m.moveNumber}... ` : '') + m.san).join(' ');
  }
}

export function toUci(m) {
  return sqName(m.from) + sqName(m.to) + (m.promotion || '');
}

export function perft(chess, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of chess.pseudoMoves()) {
    if (chess.makeMove(m)) n += depth === 1 ? 1 : perft(chess, depth - 1);
    chess.unmakeMove();
  }
  return n;
}
