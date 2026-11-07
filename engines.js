// Motores de análise: Stockfish (WASM) e, como reserva, o motor interno do Lance Certo.
// analyse(fen) -> { score: {cp}|{mate}, best: 'e2e4', second: score|null }, do ponto de vista de quem joga.

export class StockfishEngine {
  constructor(url, depth = 14) {
    this.url = url;
    this.depth = depth;
    this.name = 'Stockfish 19 Lite';
  }

  init(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      try { this.worker = new Worker(this.url); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => reject(new Error('Stockfish não respondeu')), timeoutMs);
      this.worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'erro no Stockfish')); };
      let stage = 0;
      this.worker.onmessage = (e) => {
        const line = String(e.data);
        if (stage === 0 && line === 'uciok') { stage = 1; this.send('setoption name MultiPV value 2'); this.send('isready'); }
        else if (stage === 1 && line === 'readyok') { clearTimeout(timer); this.worker.onmessage = (ev) => this.onLine(String(ev.data)); resolve(this); }
      };
      this.send('uci');
    });
  }

  send(cmd) { this.worker.postMessage(cmd); }

  onLine(line) {
    const job = this.job;
    if (!job) return;
    if (line.startsWith('info') && line.includes(' pv ') && !/ (lower|upper)bound/.test(line)) {
      const depth = +(line.match(/ depth (\d+)/) || [])[1];
      const mpv = +(line.match(/ multipv (\d+)/) || [0, 1])[1];
      const cp = line.match(/ score cp (-?\d+)/), mate = line.match(/ score mate (-?\d+)/);
      const pv = line.split(' pv ')[1].trim().split(' ');
      const score = mate ? { mate: +mate[1] } : cp ? { cp: +cp[1] } : null;
      if (score) job.lines[mpv] = { depth, score, pv };
    } else if (line.startsWith('bestmove')) {
      this.job = null;
      const best = line.split(' ')[1];
      const l1 = job.lines[1], l2 = job.lines[2];
      job.resolve({ score: l1 ? l1.score : { cp: 0 }, best: l1 ? l1.pv[0] : best, second: l2 ? l2.score : null, pv: l1 ? l1.pv : [best] });
    }
  }

  analyse(fen) {
    return new Promise((resolve) => {
      this.job = { resolve, lines: {} };
      this.send('position fen ' + fen);
      this.send('go depth ' + this.depth);
    });
  }

  stop() { try { this.send('quit'); this.worker.terminate(); } catch { /* já encerrado */ } }
}

export class BuiltinEngine {
  constructor(url, depth = 4) {
    this.url = url;
    this.depth = depth;
    this.name = 'Motor Lance Certo';
    this.seq = 0;
    this.pending = new Map();
  }

  async init() {
    this.worker = new Worker(this.url, { type: 'module' });
    this.worker.onmessage = (e) => { const p = this.pending.get(e.data.id); if (p) { this.pending.delete(e.data.id); p(e.data.result); } };
    return this;
  }

  analyse(fen) {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, fen, depth: this.depth, timeMs: 1500 });
    });
  }

  stop() { this.worker?.terminate(); }
}
