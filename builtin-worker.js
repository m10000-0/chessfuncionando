// Worker do motor interno: avalia todos os lances da raiz e devolve melhor e segundo melhor.
import { Chess, toUci } from './lib/chess.js';
import { Searcher, MATE } from './lib/engine.js';

const conv = (s) => (Math.abs(s) > MATE - 1000 ? { mate: Math.sign(s) * Math.ceil((MATE - Math.abs(s)) / 2) } : { cp: s });

self.onmessage = (e) => {
  const { id, fen, depth, timeMs } = e.data;
  const c = new Chess(fen);
  const res = new Searcher(c).analyse({ depth, timeMs, multi: true });
  const result = res.length
    ? { score: conv(res[0].score), best: toUci(res[0].move), second: res[1] ? conv(res[1].score) : null, pv: [toUci(res[0].move)] }
    : { score: c.inCheck() ? { mate: 0 } : { cp: 0 }, best: null, second: null, pv: [] };
  self.postMessage({ id, result });
};
