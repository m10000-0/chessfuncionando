// Classificação de lances e precisão, a partir das avaliações do motor.
// Avaliações sempre do ponto de vista de quem joga na posição: { cp } ou { mate } (mate 0 = já levou mate).
import { Chess, typeOf, colorOf } from './lib/chess.js';

export const CLASSES = {
  brilliant: { label: 'Brilhante', sym: '!!', color: '#a46bff', text: (s) => `${s} é um lance brilhante!` },
  great: { label: 'Ótimo', sym: '!', color: '#4b8ef0', text: (s) => `${s} é um ótimo lance: era praticamente o único bom.` },
  best: { label: 'Melhor', sym: '★', color: '#36b37e', text: (s) => `${s} é o melhor lance.` },
  excellent: { label: 'Excelente', sym: '✓', color: '#6cc08f', text: (s) => `${s} é excelente.` },
  good: { label: 'Bom', sym: '✓', color: '#93ad9c', text: (s) => `${s} é um bom lance.` },
  book: { label: 'Teoria', sym: '≡', color: '#b8905e', text: (s) => `${s} é um lance teórico.` },
  forced: { label: 'Forçado', sym: '→', color: '#8a94a6', text: (s) => `${s} era o único lance possível.` },
  inaccuracy: { label: 'Imprecisão', sym: '?!', color: '#e8c23a', text: (s) => `${s} é uma imprecisão.` },
  mistake: { label: 'Erro', sym: '?', color: '#f0883c', text: (s) => `${s} é um erro.` },
  miss: { label: 'Oportunidade perdida', sym: '✗', color: '#e2607f', text: (s) => `${s} deixa escapar uma oportunidade.` },
  blunder: { label: 'Capivarada', sym: '??', color: '#e5484d', text: (s) => `${s} é uma capivarada.` },
};
export const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const VAL = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 20000 };

// Chance de vitória (0–100). Com rating, a curva fica mais "achatada" para jogadores de rating
// mais baixo (uma vantagem vale menos certeza), como no modelo de "pontos esperados".
export function ratingFactor(rating) {
  if (!rating) return 1;
  return Math.max(0.65, Math.min(1.25, 0.45 + rating / 2600));
}
export function winPercent(score, rating = null) {
  if (!score) return 50;
  if (score.mate != null) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ratingFactor(rating) * score.cp)) - 1);
}

export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

export const negate = (s) => (s.mate != null ? { mate: -s.mate } : { cp: -s.cp });

// Ganho do lado `side` numa sequência de capturas na casa sq (troca estática)
function see(chess, sq, side) {
  const target = chess.board[sq];
  if (!target) return 0;
  const attackers = chess.attackers(sq, side);
  if (!attackers.length) return 0;
  let from = attackers[0];
  for (const a of attackers) if (VAL[typeOf(chess.board[a])] < VAL[typeOf(chess.board[from])]) from = a;
  const piece = chess.board[from];
  chess.board[sq] = piece;
  chess.board[from] = null;
  const gain = VAL[typeOf(target)] - see(chess, sq, side === 'w' ? 'b' : 'w');
  chess.board[from] = piece;
  chess.board[sq] = target;
  return Math.max(0, gain);
}

// O lance entrega material (o adversário ganha >= 2 peões capturando legalmente)?
export function isSacrifice(fen, uci) {
  const c = new Chess(fen);
  const mover = c.turn;
  const rec = c.move(uci);
  if (!rec) return false;
  const opp = mover === 'w' ? 'b' : 'w';
  const gotNow = rec.captured ? VAL[typeOf(rec.captured)] : 0;
  const legalCaptures = new Set(c.legalMoves().filter((m) => m.captured).map((m) => m.to));
  let worst = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = c.board[sq];
    if (!p || colorOf(p) !== mover || typeOf(p) === 'k' || typeOf(p) === 'p') continue;
    if (!legalCaptures.has(sq)) continue;
    worst = Math.max(worst, see(c, sq, opp));
  }
  return worst - gotNow >= 200;
}

// plies: [{ uci, san, fenBefore, legalCount, color }]; evals: avaliação de cada posição (0..N) com { score, best, second }
export function classify(plies, evals, { bookPlies = 0, ratings = {} } = {}) {
  const out = [];
  for (let i = 0; i < plies.length; i++) {
    const before = evals[i], after = evals[i + 1];
    if (!before || !after) { out.push(null); continue; }
    const p = plies[i];
    const rt = ratings[p.color] || null;
    const bestWin = winPercent(before.score, rt);
    const afterWin = 100 - winPercent(after.score, rt);
    const isBest = before.best === p.uci;
    let loss = isBest ? 0 : Math.max(0, bestWin - afterWin);
    let cls;
    const prev = out[i - 1];
    if (p.legalCount === 1) cls = 'forced';
    else if (i < bookPlies && loss < 6) cls = 'book';
    else if (isBest || loss <= 1) {
      const secondWin = before.second ? winPercent(before.second, rt) : null;
      if (loss <= 2 && afterWin >= 45 && isSacrifice(p.fenBefore, p.uci)) cls = 'brilliant';
      else if (isBest && !(after.score.mate === 0) && secondWin != null && bestWin - secondWin >= 18 && afterWin >= 35 && !(plies[i - 1] && plies[i - 1].uci.slice(2, 4) === p.uci.slice(2, 4))) cls = 'great';
      else cls = isBest ? 'best' : 'excellent';
    } else if (prev && (prev.cls === 'mistake' || prev.cls === 'blunder') && loss >= 10 && bestWin >= 60 && afterWin >= 30) cls = 'miss';
    else if (loss <= 2) cls = 'excellent';
    else if (loss <= 5) cls = 'good';
    else if (loss <= 10) cls = 'inaccuracy';
    else if (loss <= 20) cls = 'mistake';
    else if (afterWin >= 70) cls = bestWin >= 90 ? 'miss' : 'mistake';
    else cls = 'blunder';
    if (cls === 'book' || cls === 'forced') loss = 0;
    out.push({ cls, loss, isBest, bestUci: before.best, bestWin, afterWin, accuracy: moveAccuracy(loss) });
  }
  return out;
}

export function summarize(plies, results) {
  const sum = { w: { acc: [], counts: {} }, b: { acc: [], counts: {} } };
  results.forEach((r, i) => {
    if (!r) return;
    const s = sum[plies[i].color];
    s.acc.push(r.accuracy);
    s.counts[r.cls] = (s.counts[r.cls] || 0) + 1;
  });
  for (const c of ['w', 'b']) {
    const a = sum[c].acc;
    sum[c].accuracy = a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  }
  return sum;
}

export function scoreText(score, turn) {
  // Texto do ponto de vista das brancas
  const s = turn === 'w' ? score : negate(score);
  if (s.mate != null) return s.mate === 0 ? (turn === 'w' ? '0-1' : '1-0') : (s.mate > 0 ? 'M' : '-M') + Math.abs(s.mate);
  return (s.cp >= 0 ? '+' : '') + (s.cp / 100).toFixed(1);
}

export function whiteWin(score, turn) {
  return winPercent(turn === 'w' ? score : negate(score));
}
