// Motor de busca: negamax com poda alfa-beta, aprofundamento iterativo e quiescência.
import { Chess, colorOf, typeOf, toUci } from './chess.js';

export const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
export const MATE = 100000;

// Tabelas posicionais (perspectiva das brancas, a8 = índice 0)
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ke: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

const dist = (a, b) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
const centerDist = (s) => Math.max(3 - (s >> 3), (s >> 3) - 4) + Math.max(3 - (s & 7), (s & 7) - 4);

// Avaliação estática do ponto de vista de quem joga
export function evaluate(chess) {
  const b = chess.board;
  let mat = { w: 0, b: 0 }, pst = { w: 0, b: 0 }, nonPawn = 0;
  const kings = { w: -1, b: -1 };
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = typeOf(p), c = colorOf(p);
    if (t === 'k') { kings[c] = i; continue; }
    mat[c] += VALUES[t];
    if (t !== 'p') nonPawn += VALUES[t];
    pst[c] += PST[t][c === 'w' ? i : i ^ 56];
  }
  const endgame = nonPawn <= 2600;
  for (const c of ['w', 'b']) {
    const k = kings[c];
    if (k >= 0) pst[c] += (endgame ? PST.ke : PST.k)[c === 'w' ? k : k ^ 56];
  }
  let score = mat.w - mat.b + pst.w - pst.b;
  // "Mop-up": no final, quem está ganhando empurra o rei adversário para a borda
  if (endgame && kings.w >= 0 && kings.b >= 0) {
    const diff = mat.w - mat.b;
    if (Math.abs(diff) >= 300) {
      const winner = diff > 0 ? 'w' : 'b', loser = diff > 0 ? 'b' : 'w';
      const bonus = 10 * centerDist(kings[loser]) + 4 * (14 - dist(kings.w, kings.b));
      score += winner === 'w' ? bonus : -bonus;
    }
  }
  return chess.turn === 'w' ? score : -score;
}

function orderScore(m, killers, best) {
  if (best && m.from === best.from && m.to === best.to && m.promotion === best.promotion) return 1e7;
  let s = 0;
  if (m.captured) s += 1e5 + 10 * VALUES[typeOf(m.captured)] - VALUES[typeOf(m.piece)];
  if (m.promotion) s += 9e4 + VALUES[m.promotion];
  if (killers && killers.some((k) => k && k.from === m.from && k.to === m.to)) s += 5e4;
  return s;
}

export class Searcher {
  constructor(chess) {
    this.chess = chess;
    this.nodes = 0;
  }

  quiesce(alpha, beta, ply) {
    this.nodes++;
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    const stand = evaluate(this.chess);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (ply > 30) return alpha;
    const moves = this.chess.pseudoMoves(true);
    moves.sort((a, b) => orderScore(b) - orderScore(a));
    for (const m of moves) {
      if (!this.chess.makeMove(m)) { this.chess.unmakeMove(); continue; }
      const sc = -this.quiesce(-beta, -alpha, ply + 1);
      this.chess.unmakeMove();
      if (this.stopped) return 0;
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  search(depth, alpha, beta, ply) {
    if (ply > 0 && (this.chess.halfmove >= 100 || this.isRepetition())) return 0;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    this.nodes++;
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    const inCheck = this.chess.inCheck();
    if (inCheck) depth++;
    const moves = this.chess.pseudoMoves();
    const killers = this.killers[ply];
    moves.sort((a, b) => orderScore(b, killers) - orderScore(a, killers));
    let legal = 0;
    for (const m of moves) {
      if (!this.chess.makeMove(m)) { this.chess.unmakeMove(); continue; }
      legal++;
      this.path.push(this.keyLite());
      const sc = -this.search(depth - 1, -beta, -alpha, ply + 1);
      this.path.pop();
      this.chess.unmakeMove();
      if (this.stopped) return 0;
      if (sc >= beta) {
        if (!m.captured) this.killers[ply] = [m, (this.killers[ply] || [])[0]];
        return beta;
      }
      if (sc > alpha) alpha = sc;
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    return alpha;
  }

  keyLite() {
    return this.chess.board.join(',') + this.chess.turn;
  }

  isRepetition() {
    const k = this.keyLite();
    const n = this.path.length;
    for (let i = n - 2; i >= 0; i -= 2) if (this.path[i] === k) return true;
    return this.rootKeys.has(k);
  }

  // Avalia todos os lances da raiz. Retorna [{move, score}] ordenados (melhor primeiro).
  analyse({ depth = 4, timeMs = 1000, multi = false } = {}) {
    const chess = this.chess;
    this.deadline = Date.now() + timeMs;
    this.stopped = false;
    this.nodes = 0;
    this.killers = [];
    this.path = [];
    this.rootKeys = new Set();
    // Posições anteriores da partida (para evitar repetições)
    const root = chess.legalMoves();
    if (!root.length) return [];
    let results = root.map((m) => ({ move: m, score: 0 }));
    let completedDepth = 0;
    let best = null;
    for (let d = 1; d <= depth; d++) {
      const scored = [];
      let alpha = -MATE - 1;
      results.sort((a, b) => b.score - a.score);
      for (const r of results) {
        chess.makeMove(r.move);
        this.path = [this.keyLite()];
        // Com `multi`, cada lance recebe uma janela completa (pontuação exata)
        const sc = -this.search(d - 1, -MATE - 1, multi ? MATE + 1 : -alpha, 1);
        chess.unmakeMove();
        if (this.stopped) break;
        scored.push({ move: r.move, score: sc });
        if (sc > alpha) alpha = sc;
      }
      if (this.stopped && completedDepth > 0) {
        // Mantém resultados da profundidade anterior, mas prioriza um melhor achado parcial
        const partialBest = scored.sort((a, b) => b.score - a.score)[0];
        if (partialBest && best && partialBest.score > results[0].score) {
          results = [partialBest, ...results.filter((x) => x.move !== partialBest.move)];
        }
        break;
      }
      if (this.stopped) {
        if (scored.length) results = scored.concat(results.filter((r) => !scored.some((s) => s.move === r.move)));
        break;
      }
      results = scored.sort((a, b) => b.score - a.score);
      best = results[0];
      completedDepth = d;
      if (Math.abs(best.score) > MATE - 100) break; // mate encontrado
    }
    this.completedDepth = completedDepth;
    return results;
  }
}

// Níveis do computador
export const LEVELS = [
  { id: 1, name: 'Filhote', elo: 400, depth: 1, time: 200, noise: 400, blunder: 0.35 },
  { id: 2, name: 'Aprendiz', elo: 700, depth: 1, time: 300, noise: 200, blunder: 0.15 },
  { id: 3, name: 'Amador', elo: 1000, depth: 2, time: 400, noise: 90, blunder: 0.06 },
  { id: 4, name: 'Clube', elo: 1300, depth: 3, time: 700, noise: 40, blunder: 0.02 },
  { id: 5, name: 'Experiente', elo: 1600, depth: 4, time: 1200, noise: 15, blunder: 0 },
  { id: 6, name: 'Mestre', elo: 1900, depth: 6, time: 2500, noise: 0, blunder: 0 },
];

export function chooseMove(fen, levelId = 4, rng = Math.random) {
  const level = LEVELS.find((l) => l.id === levelId) || LEVELS[3];
  const chess = new Chess(fen);
  const s = new Searcher(chess);
  const res = s.analyse({ depth: level.depth, timeMs: level.time, multi: level.noise > 0 });
  if (!res.length) return null;
  let pick = res[0];
  if (level.blunder && rng() < level.blunder) {
    pick = res[Math.floor(rng() * res.length)];
  } else if (level.noise) {
    const noisy = res.map((r) => ({ ...r, n: r.score + (rng() - 0.5) * 2 * level.noise }));
    // Nunca ignora um mate disponível em níveis acima do primeiro
    if (levelId > 1 && res[0].score > MATE - 100) noisy[0].n += 1e6;
    noisy.sort((a, b) => b.n - a.n);
    pick = noisy[0];
  }
  return { uci: toUci(pick.move), score: pick.score, best: toUci(res[0].move), bestScore: res[0].score, depth: s.completedDepth };
}

export function analysePosition(fen, { depth = 5, timeMs = 1500 } = {}) {
  const chess = new Chess(fen);
  const s = new Searcher(chess);
  const res = s.analyse({ depth, timeMs });
  if (!res.length) {
    const r = chess.result();
    return { best: null, score: r.winner ? -MATE : 0, depth: 0, turn: chess.turn };
  }
  return { best: toUci(res[0].move), score: res[0].score, depth: s.completedDepth, turn: chess.turn };
}

export function scoreToText(score, turn) {
  // Converte para o ponto de vista das brancas
  const w = turn === 'w' ? score : -score;
  if (Math.abs(w) > MATE - 1000) {
    const plies = MATE - Math.abs(w);
    const n = Math.ceil(plies / 2);
    return (w > 0 ? '#' : '#-') + n;
  }
  return (w >= 0 ? '+' : '') + (w / 100).toFixed(1);
}
