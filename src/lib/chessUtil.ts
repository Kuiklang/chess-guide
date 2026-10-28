import { Chess, type Color, type PieceSymbol, type Square, type Move } from 'chess.js';
import type { Score } from './engine';

export const PIECE_NAME: Record<PieceSymbol, string> = {
  k: 'คิง',
  q: 'ควีน',
  r: 'เรือ',
  b: 'บิชอป',
  n: 'ม้า',
  p: 'เบี้ย',
};

export const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

export const COLOR_NAME: Record<Color, string> = { w: 'ฝ่ายขาว', b: 'ฝ่ายดำ' };

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export function squareAt(file: number, rank: number): Square {
  return `${FILES[file]}${rank + 1}` as Square;
}

export function fileOf(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

export function rankOf(sq: Square): number {
  return Number(sq[1]) - 1;
}

export function allSquares(): Square[] {
  const out: Square[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) out.push(squareAt(f, r));
  return out;
}

export function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

export function parseUci(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

export function moveToUci(m: { from: string; to: string; promotion?: string }): string {
  return m.from + m.to + (m.promotion ?? '');
}

/** Play a UCI move on a copy of the position. Returns null if illegal. */
export function tryMove(fen: string, uci: string): { move: Move; after: Chess } | null {
  const game = new Chess(fen);
  try {
    const move = game.move(parseUci(uci));
    return { move, after: game };
  } catch {
    return null;
  }
}

/** "ม้า g1 → f3" style description of a move. */
export function describeMove(fen: string, uci: string): string {
  const r = tryMove(fen, uci);
  if (!r) return uci;
  return describeVerbose(r.move);
}

export function describeVerbose(m: Move): string {
  if (m.flags.includes('k')) return 'เข้าป้อมฝั่งคิง (O-O)';
  if (m.flags.includes('q')) return 'เข้าป้อมฝั่งควีน (O-O-O)';
  let s = `${PIECE_NAME[m.piece]} ${m.from} → ${m.to}`;
  if (m.captured) s += ` กิน${PIECE_NAME[m.captured]}`;
  if (m.promotion) s += ` เลื่อนเป็น${PIECE_NAME[m.promotion]}`;
  return s;
}

/** "ม้าจาก g1 ไป f3" phrasing used in guide suggestions. */
export function describeMoveFromTo(m: Move): string {
  if (m.flags.includes('k')) return 'เข้าป้อมฝั่งคิง';
  if (m.flags.includes('q')) return 'เข้าป้อมฝั่งควีน';
  let s = `${PIECE_NAME[m.piece]}จาก ${m.from} ไป ${m.to}`;
  if (m.captured) s += ` (กิน${PIECE_NAME[m.captured]})`;
  if (m.promotion) s += ` แล้วเลื่อนเป็น${PIECE_NAME[m.promotion]}`;
  return s;
}

/** Describe a principal variation as Thai text, e.g. "ม้า g8 → f6, เบี้ย d2 → d4". */
export function describePv(fen: string, pv: string[], max = 4): string[] {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      const m = game.move(parseUci(uci));
      out.push(`${m.color === 'w' ? 'ขาว' : 'ดำ'}: ${describeVerbose(m)}`);
    } catch {
      break;
    }
  }
  return out;
}

// ---- Scores ----

const MATE_CP = 10000;

/** Convert a score to centipawns (mates become very large numbers). */
export function scoreToCp(s: Score): number {
  if (s.type === 'cp') return s.value;
  if (s.value === 0) return -MATE_CP; // side to move is mated
  return s.value > 0 ? MATE_CP - s.value * 10 : -MATE_CP - s.value * 10;
}

/** Flip a side-to-move score to White's point of view. */
export function toWhite(s: Score, turn: Color): Score {
  return turn === 'w' ? s : { type: s.type, value: -s.value };
}

export function negate(s: Score): Score {
  return { type: s.type, value: -s.value };
}

/** Lichess-style win percentage (0-100) for the side whose view the score is from. */
export function winPercent(s: Score): number {
  const cp = Math.max(-1000, Math.min(1000, scoreToCp(s)));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Short number shown to the user, e.g. "+0.8" or "#3". White's view. */
export function formatScore(white: Score): string {
  if (white.type === 'mate') {
    if (white.value === 0) return '#';
    return (white.value > 0 ? '+' : '-') + 'M' + Math.abs(white.value);
  }
  const v = white.value / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

/** Thai sentence describing who is better, from White's view score. */
export function describeAdvantage(white: Score): string {
  if (white.type === 'mate') {
    if (white.value === 0) return 'จบเกมด้วยการรุกจน';
    const side = white.value > 0 ? 'ฝ่ายขาว' : 'ฝ่ายดำ';
    return `${side}รุกจนได้ภายใน ${Math.abs(white.value)} ตา ถ้าเดินถูกทุกตา`;
  }
  const cp = white.value;
  const side = cp > 0 ? 'ฝ่ายขาว' : 'ฝ่ายดำ';
  const a = Math.abs(cp);
  if (a < 30) return 'สองฝ่ายสูสีกัน';
  if (a < 100) return `${side}ได้เปรียบเล็กน้อย`;
  if (a < 250) return `${side}ได้เปรียบ`;
  if (a < 600) return `${side}ได้เปรียบมาก`;
  return `${side}ได้เปรียบชัดเจน น่าจะชนะ`;
}

export function kingSquare(game: Chess, color: Color): Square | null {
  for (const row of game.board()) {
    for (const p of row) {
      if (p && p.type === 'k' && p.color === color) return p.square;
    }
  }
  return null;
}

export function gameResultText(game: Chess): string | null {
  if (game.isCheckmate()) return `รุกจน! ${COLOR_NAME[opposite(game.turn())]}ชนะ`;
  if (game.isStalemate()) return 'เสมอ: อับ (ไม่มีตาเดินแต่ไม่ถูกรุก)';
  if (game.isThreefoldRepetition()) return 'เสมอ: ตำแหน่งซ้ำ 3 ครั้ง';
  if (game.isInsufficientMaterial()) return 'เสมอ: หมากไม่พอจะรุกจน';
  if (game.isDraw()) return 'เสมอ: กฎ 50 ตา';
  return null;
}

/** PGN result token for a finished position, or null. */
export function pgnResult(game: Chess): '1-0' | '0-1' | '1/2-1/2' | null {
  if (game.isCheckmate()) return game.turn() === 'w' ? '0-1' : '1-0';
  if (game.isDraw()) return '1/2-1/2';
  return null;
}
