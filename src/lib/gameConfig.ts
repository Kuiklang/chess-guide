import { Chess } from 'chess.js';
import type { Mode } from './storage';
import { parseUci } from './chessUtil';

export interface GameConfig {
  mode: Mode;
  /** User's side in bot and guide mode. White in 2-player mode. */
  playerColor: 'w' | 'b';
  botLevel: number;
}

export interface BotLevel {
  name: string;
  skill: number;
  depth: number;
  movetime?: number;
}

export const BOT_LEVELS: BotLevel[] = [
  { name: 'มือใหม่', skill: 0, depth: 1 },
  { name: 'ง่าย', skill: 4, depth: 3 },
  { name: 'ปานกลาง', skill: 9, depth: 7 },
  { name: 'ยาก', skill: 15, depth: 12, movetime: 1000 },
  { name: 'ยากมาก', skill: 20, depth: 18, movetime: 1500 },
];

/** Build a PGN with Thai-friendly headers from UCI moves. */
export function buildPgn(opts: {
  moves: string[];
  mode: Mode;
  playerColor?: 'w' | 'b';
  botLevel?: number;
  date: string;
  result: string;
}): string {
  const game = new Chess();
  for (const m of opts.moves) game.move(parseUci(m));
  const d = new Date(opts.date);
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  let white = 'White';
  let black = 'Black';
  if (opts.mode === 'bot') {
    const bot = `Stockfish (${BOT_LEVELS[(opts.botLevel ?? 1) - 1]?.name ?? ''})`;
    white = opts.playerColor === 'w' ? 'Player' : bot;
    black = opts.playerColor === 'w' ? bot : 'Player';
  } else if (opts.mode === 'guide') {
    white = opts.playerColor === 'w' ? 'Player' : 'Opponent';
    black = opts.playerColor === 'w' ? 'Opponent' : 'Player';
  }
  game.setHeader('Event', 'Chess Guide');
  game.setHeader('Date', date);
  game.setHeader('White', white);
  game.setHeader('Black', black);
  game.setHeader('Result', opts.result);
  return game.pgn();
}
