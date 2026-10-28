// Whole-game analysis: evaluate every position, then grade each move.

import { Chess } from 'chess.js';
import { engine, type Score } from './engine';
import { negate, parseUci, toWhite, winPercent } from './chessUtil';
import { gradeFromDrop, moveAccuracy } from './explain';
import type { GameAnalysis, PlyAnalysis } from './storage';

interface PositionEval {
  /** Side-to-move view. */
  score: Score;
  pv: string[];
  bestmove: string | null;
}

async function evalPosition(game: Chess): Promise<PositionEval> {
  if (game.isCheckmate()) return { score: { type: 'mate', value: 0 }, pv: [], bestmove: null };
  if (game.isDraw()) return { score: { type: 'cp', value: 0 }, pv: [], bestmove: null };
  const res = await engine.search(game.fen(), { depth: 12, movetime: 700, multipv: 1 });
  const line = res.lines[0];
  return {
    score: line?.score ?? { type: 'cp', value: 0 },
    pv: line?.pv ?? [],
    bestmove: res.bestmove,
  };
}

/** Mean of arithmetic and harmonic means, a simplified take on Lichess game accuracy. */
function gameAccuracy(values: number[]): number {
  if (values.length === 0) return 100;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const harmonic = values.length / values.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.round((mean + harmonic) / 2);
}

export async function analyseGame(
  moves: string[],
  onProgress: (done: number, total: number) => void,
): Promise<GameAnalysis> {
  const game = new Chess();
  const evals: PositionEval[] = [];
  const turns: ('w' | 'b')[] = [];
  const total = moves.length + 1;
  for (let i = 0; i <= moves.length; i++) {
    turns.push(game.turn());
    evals.push(await evalPosition(game));
    onProgress(i + 1, total);
    if (i < moves.length) game.move(parseUci(moves[i]));
  }

  const plies: PlyAnalysis[] = [];
  const acc: { w: number[]; b: number[] } = { w: [], b: [] };
  for (let i = 0; i < moves.length; i++) {
    const mover = turns[i];
    const before = evals[i];
    const after = evals[i + 1];
    // Mover's view before and after the move.
    const moverBefore = before.score;
    const moverAfter = negate(after.score);
    const isBest = before.bestmove === moves[i];
    const drop = isBest ? 0 : Math.max(0, winPercent(moverBefore) - winPercent(moverAfter));
    const accuracy = moveAccuracy(drop);
    acc[mover].push(accuracy);
    plies.push({
      evalBefore: toWhite(before.score, mover),
      bestUci: before.bestmove,
      bestPv: before.pv,
      bestScore: before.score,
      grade: gradeFromDrop(drop, isBest),
      accuracy,
      drop,
    });
  }
  const last = evals[evals.length - 1];
  return {
    plies,
    finalEval: toWhite(last.score, turns[turns.length - 1]),
    accuracy: { w: gameAccuracy(acc.w), b: gameAccuracy(acc.b) },
  };
}
