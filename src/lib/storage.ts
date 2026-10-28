// Saved games live in this browser's localStorage (last 20 games).

import type { Score } from './engine';
import type { Grade } from './explain';

export type Mode = 'bot' | 'pvp' | 'guide';

export interface PlyAnalysis {
  /** Eval of the position before this ply, White's view. */
  evalBefore: Score;
  /** Engine's best move in the position before this ply, and its line. */
  bestUci: string | null;
  bestPv: string[];
  /** Score of the best line from the mover's view. */
  bestScore: Score;
  grade: Grade;
  accuracy: number;
  drop: number;
}

export interface GameAnalysis {
  plies: PlyAnalysis[];
  /** Eval of the final position, White's view. */
  finalEval: Score;
  accuracy: { w: number; b: number };
}

export interface SavedGame {
  id: string;
  date: string;
  mode: Mode;
  /** The user's side in bot/guide mode. */
  playerColor?: 'w' | 'b';
  botLevel?: number;
  /** UCI moves from the start position. */
  moves: string[];
  /** PGN result token. */
  result: string;
  resultText: string;
  analysis?: GameAnalysis;
}

const KEY = 'chess-guide.games.v1';
const MAX_GAMES = 20;

export function loadGames(): SavedGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const games = JSON.parse(raw);
    return Array.isArray(games) ? games : [];
  } catch {
    return [];
  }
}

function writeGames(games: SavedGame[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(games.slice(0, MAX_GAMES)));
  } catch {
    // Storage full or blocked: the game simply is not kept.
  }
}

export function saveGame(game: SavedGame): void {
  const games = loadGames().filter((g) => g.id !== game.id);
  games.unshift(game);
  writeGames(games);
}

export function getGame(id: string): SavedGame | undefined {
  return loadGames().find((g) => g.id === id);
}

export function deleteGame(id: string): void {
  writeGames(loadGames().filter((g) => g.id !== id));
}

export function newGameId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const MODE_NAME: Record<Mode, string> = {
  bot: 'เล่นกับบอท',
  pvp: 'เล่น 2 คน',
  guide: 'โหมดไกด์',
};
