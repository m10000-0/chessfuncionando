// Testes da extensão: PGN, aberturas e classificação de lances.
import { Chess } from '../lib/chess.js';
import { Searcher, MATE } from '../lib/engine.js';
import { parsePgn } from '../pgn.js';
import { OPENINGS, identifyOpening } from '../openings.js';
import { classify, summarize, isSacrifice, winPercent, scoreText } from '../analysis.js';

const SAMPLE = `[Event "Live Chess"]
[Site "Chess.com"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[WhiteElo "1200"]
[BlackElo "1180"]

1. e4 {[%clk 0:09:58.1]} 1... e5 {[%clk 0:09:57.2]} 2. Bc4 {[%clk 0:09:55]} 2... Nc6 (2... Nf6 3. d3) 3. Qh5 $1 3... Nf6?? 4. Qxf7# 1-0
`;

const conv = (s) => (Math.abs(s) > MATE - 1000 ? { mate: Math.sign(s) * Math.ceil((MATE - Math.abs(s)) / 2) } : { cp: s });
function evalFen(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { score: { mate: 0 }, best: null, second: null };
  const res = new Searcher(c).analyse({ depth: 3, timeMs: 3000, multi: true });
  return { score: conv(res[0].score), best: toUci(res[0].move), second: res[1] ? conv(res[1].score) : null };
}
function toUci(m) { const f = 'abcdefgh'; const n = (i) => f[i & 7] + (8 - (i >> 3)); return n(m.from) + n(m.to) + (m.promotion || ''); }

export function runExtension(assert) {
  // Aberturas: todas as linhas são legais
  for (const o of OPENINGS) {
    const c = new Chess();
    for (const u of o.moves) assert(c.move(u), `abertura ${o.name}: lance ilegal ${u}`);
  }
  const op = identifyOpening(['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6', 'c1e3']);
  assert(op.name === 'Siciliana Najdorf' && op.bookPlies === 10, 'identifica Najdorf: ' + JSON.stringify(op));

  // PGN com relógio, variantes e NAGs
  const g = parsePgn(SAMPLE);
  assert(g.moves.map((m) => m.san).join(' ') === 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#', 'PGN lido: ' + g.moves.map((m) => m.san).join(' '));
  assert(g.headers.White === 'alice' && g.headers.Result === '1-0', 'cabeçalhos do PGN');

  // Classificação com o motor interno
  const plies = g.moves.map((m) => ({ uci: m.uci, san: m.san, fenBefore: m.fenBefore, color: m.color, legalCount: new Chess(m.fenBefore).legalMoves().length }));
  const fens = [g.startFen, ...g.moves.map((m) => m.fenAfter)];
  const evals = fens.map(evalFen);
  const res = classify(plies, evals, { bookPlies: identifyOpening(plies.map((p) => p.uci)).bookPlies });
  assert(res[0].cls === 'book', 'e4 é teoria: ' + res[0].cls);
  assert(res[5].cls === 'blunder', '...Cf6?? é capivarada: ' + JSON.stringify(res[5]));
  assert(['best', 'great'].includes(res[6].cls), 'Dxf7# é o melhor: ' + res[6].cls);
  const sum = summarize(plies, res);
  assert(sum.w.accuracy > sum.b.accuracy, 'precisão das brancas maior');

  // Sacrifício: Bxh7+ entregando o bispo (Grego) e dama pendurada não é sacrifício se ninguém pode capturar
  assert(isSacrifice('r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R2QK2R w KQ - 0 1', 'd3h7'), 'Bxh7+ é sacrifício');
  assert(!isSacrifice('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3'), 'Cf3 não é sacrifício');
  assert(winPercent({ mate: 3 }) === 100 && winPercent({ mate: 0 }) === 0 && Math.abs(winPercent({ cp: 0 }) - 50) < 1e-9, 'win%');
  assert(scoreText({ cp: 150 }, 'b') === '-1.5' && scoreText({ mate: 2 }, 'w') === 'M2', 'texto da avaliação');
}

let fails = 0, passes = 0;
runExtension((cond, msg) => { if (cond) passes++; else { fails++; console.error('FALHOU:', msg); } });
console.log(`${passes} verificações, ${fails} falhas`);
process.exit(fails ? 1 : 0);
