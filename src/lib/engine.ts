// Thin wrapper around the Stockfish web worker (UCI protocol).
// Jobs run one at a time; `cancelAll` stops the current search and drops queued jobs.

export type Score = { type: 'cp' | 'mate'; value: number };

export interface PvLine {
  multipv: number;
  depth: number;
  /** Score from the point of view of the side to move. */
  score: Score;
  pv: string[];
}

export interface SearchOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
  /** Stockfish "Skill Level" 0-20. Defaults to 20 (full strength). */
  skill?: number;
}

export interface SearchResult {
  bestmove: string | null;
  lines: PvLine[];
}

const ENGINE_FILE = 'engine/stockfish-17.1-lite-single-03e3232.js';

class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

export function isCancelled(e: unknown): boolean {
  return e instanceof CancelledError;
}

interface Job {
  fen: string;
  opts: SearchOptions;
  resolve: (r: SearchResult) => void;
  reject: (e: unknown) => void;
}

class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private running: Job | null = null;
  private lines = new Map<number, PvLine>();
  private listener: ((line: string) => void) | null = null;

  private init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(import.meta.env.BASE_URL + ENGINE_FILE);
      } catch (e) {
        reject(e);
        return;
      }
      this.worker.onmessage = (ev: MessageEvent) => {
        const text = String(ev.data);
        if (this.listener) this.listener(text);
      };
      this.worker.onerror = (ev) => reject(ev);
      this.listener = (line) => {
        if (line === 'uciok') {
          this.send('setoption name Hash value 16');
          this.send('isready');
        } else if (line === 'readyok') {
          this.listener = (l) => this.onLine(l);
          resolve();
        }
      };
      this.send('uci');
    });
    return this.ready;
  }

  /** Start loading the engine early so the first search is quick. */
  warmUp(): void {
    this.init().catch(() => undefined);
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  search(fen: string, opts: SearchOptions = {}): Promise<SearchResult> {
    return new Promise<SearchResult>((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject });
      this.init()
        .then(() => this.pump())
        .catch(reject);
    });
  }

  /** Stop the running search and drop everything queued. Their promises reject with a cancel error. */
  cancelAll(): void {
    const queued = this.queue;
    this.queue = [];
    queued.forEach((j) => j.reject(new CancelledError()));
    if (this.running) {
      // The worker still answers with "bestmove"; the next job starts after that.
      this.running.reject(new CancelledError());
      this.send('stop');
    }
  }

  private pump() {
    if (this.running || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.running = job;
    this.lines.clear();
    const { opts } = job;
    this.send(`setoption name MultiPV value ${opts.multipv ?? 1}`);
    this.send(`setoption name Skill Level value ${opts.skill ?? 20}`);
    this.send(`position fen ${job.fen}`);
    const parts = ['go'];
    if (opts.depth) parts.push(`depth ${opts.depth}`);
    if (opts.movetime) parts.push(`movetime ${opts.movetime}`);
    if (!opts.depth && !opts.movetime) parts.push('depth 12');
    this.send(parts.join(' '));
  }

  private onLine(line: string) {
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const parsed = parseInfo(line);
      if (parsed) this.lines.set(parsed.multipv, parsed);
    } else if (line.startsWith('bestmove')) {
      const job = this.running;
      this.running = null;
      const token = line.split(/\s+/)[1];
      const bestmove = token && token !== '(none)' ? token : null;
      const lines = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
      // Resolving after a cancel-reject is a no-op for the promise.
      job?.resolve({ bestmove, lines });
      this.pump();
    }
  }
}

function parseInfo(line: string): PvLine | null {
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'multipv') multipv = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i] as 'cp' | 'mate';
      const value = Number(tokens[++i]);
      score = { type: kind, value };
      // "lowerbound"/"upperbound" may follow; ignore.
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!score || pv.length === 0) return null;
  return { depth, multipv, score, pv };
}

export const engine = new Engine();
