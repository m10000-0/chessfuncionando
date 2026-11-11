// Leitor de PGN: cabeçalhos + lances da linha principal (ignora comentários, variantes e NAGs).
import { Chess, START_FEN } from './lib/chess.js';

export function parsePgn(text) {
  const headers = {};
  const body = text.replace(/\r/g, '').replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k, v) => {
    headers[k] = v.replace(/\\"/g, '"');
    return '';
  });
  // Remove comentários, variantes (aninhadas) e NAGs
  let s = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  let prev;
  do { prev = s; s = s.replace(/\([^()]*\)/g, ' '); } while (s !== prev);
  s = s.replace(/\$\d+/g, ' ');
  const tokens = s.split(/\s+/).filter(Boolean);
  const sans = [];
  for (let t of tokens) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
    t = t.replace(/^\d+\.+/, '');
    if (!t) continue;
    sans.push(t);
  }
  const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : START_FEN;
  const chess = new Chess(startFen);
  const moves = [];
  for (const san of sans) {
    const rec = chess.move(san);
    if (!rec) throw new Error(`Lance inválido no PGN: ${san}`);
    moves.push(rec);
  }
  return { headers, startFen, moves, chess };
}
