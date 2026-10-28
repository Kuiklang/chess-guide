// Rule-based Thai explanations of chess moves.
// Looks at what a move does on the board (captures, threats, forks, pins, development...)
// and combines that with Stockfish's evaluation to say why a move is good or bad.

import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { PvLine, Score } from './engine';
import {
  PIECE_NAME,
  PIECE_VALUE,
  allSquares,
  describeMoveFromTo,
  describePv,
  describeAdvantage,
  fileOf,
  negate,
  opposite,
  parseUci,
  rankOf,
  scoreToCp,
  squareAt,
  toWhite,
  tryMove,
  winPercent,
} from './chessUtil';

// ---------- Board helpers ----------

/** A piece is "threatened" if an enemy attacks it and it is undefended or attacked by something cheaper. */
function isThreatened(game: Chess, sq: Square): boolean {
  const p = game.get(sq);
  if (!p || p.type === 'k') return false;
  const enemy = opposite(p.color);
  const attackers = game.attackers(sq, enemy);
  if (attackers.length === 0) return false;
  const cheapest = Math.min(...attackers.map((a) => PIECE_VALUE[game.get(a)!.type]));
  if (cheapest < PIECE_VALUE[p.type]) return true;
  return game.attackers(sq, p.color).length === 0;
}

function threatenedPieces(game: Chess, color: Color): Square[] {
  const out: Square[] = [];
  for (const sq of allSquares()) {
    const p = game.get(sq);
    if (p && p.color === color && isThreatened(game, sq)) out.push(sq);
  }
  return out;
}

const CENTER: Square[] = ['d4', 'e4', 'd5', 'e5'];

const DIRS: Record<'b' | 'r' | 'q', [number, number][]> = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
};

/** Pins created by a sliding piece standing on `from`. */
function findPins(game: Chess, from: Square): { pinned: Square; behind: Square }[] {
  const p = game.get(from);
  if (!p || !(p.type === 'b' || p.type === 'r' || p.type === 'q')) return [];
  const out: { pinned: Square; behind: Square }[] = [];
  for (const [df, dr] of DIRS[p.type]) {
    let f = fileOf(from) + df;
    let r = rankOf(from) + dr;
    let first: Square | null = null;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = squareAt(f, r);
      const q = game.get(sq);
      if (q) {
        if (q.color === p.color) break;
        if (!first) first = sq;
        else {
          const firstPiece = game.get(first)!;
          // Only pins that matter for a learner: something valuable behind, and pawns only against the king.
          const worthy = q.type === 'k' || ((q.type === 'q' || q.type === 'r') && firstPiece.type !== 'p');
          if (worthy && PIECE_VALUE[q.type] > PIECE_VALUE[firstPiece.type]) out.push({ pinned: first, behind: sq });
          break;
        }
      }
      f += df;
      r += dr;
    }
  }
  return out;
}

function isPassedPawn(game: Chess, sq: Square, color: Color): boolean {
  const f = fileOf(sq);
  const r = rankOf(sq);
  for (let ff = f - 1; ff <= f + 1; ff++) {
    if (ff < 0 || ff > 7) continue;
    for (let rr = 0; rr < 8; rr++) {
      const ahead = color === 'w' ? rr > r : rr < r;
      if (!ahead) continue;
      const q = game.get(squareAt(ff, rr));
      if (q && q.type === 'p' && q.color !== color) return false;
    }
  }
  return true;
}

function fileHasPawn(game: Chess, file: number, color?: Color): boolean {
  for (let r = 0; r < 8; r++) {
    const q = game.get(squareAt(file, r));
    if (q && q.type === 'p' && (!color || q.color === color)) return true;
  }
  return false;
}

function pieceAt(game: Chess, sq: Square): string {
  const p = game.get(sq);
  return p ? `${PIECE_NAME[p.type]}ที่ ${sq}` : sq;
}

/** Put a space between a square name and following Thai text: "d7ไว้" -> "d7 ไว้". */
export function tidy(text: string): string {
  return text.replace(/([a-h][1-8])(?=[\u0E00-\u0E7F])/g, '$1 ');
}

function listThai(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return items.slice(0, -1).join(', ') + ' และ' + items[items.length - 1];
}

// ---------- Move features ----------

export interface MoveFeatures {
  move: Move;
  us: Color;
  mate: boolean;
  check: boolean;
  captured?: PieceSymbol;
  captureFree: boolean;
  captureWinning: boolean;
  newThreats: Square[];
  forkTargets: Square[];
  pins: { pinned: Square; behind: Square }[];
  escaped: boolean;
  defended: Square[];
  hangsMoved: boolean;
  newlyHanging: Square[];
  castle: boolean;
  develop: boolean;
  centerControl: boolean;
  centerPawn: boolean;
  openFile: boolean;
  passedPawn: boolean;
  kingWalk: boolean;
  earlyQueen: boolean;
  promotion?: PieceSymbol;
  after: Chess;
}

export function moveFeatures(fen: string, uci: string): MoveFeatures | null {
  const before = new Chess(fen);
  const r = tryMove(fen, uci);
  if (!r) return null;
  const { move, after } = r;
  const us = move.color;
  const them = opposite(us);
  const moveNo = Number(fen.split(' ')[5] ?? '1');

  const threatsBefore = new Set(threatenedPieces(before, them));
  const threatsAfter = threatenedPieces(after, them);
  const newThreats = threatsAfter.filter((s) => !threatsBefore.has(s));

  const movedAttacks = (sq: Square) => after.attackers(sq, us).includes(move.to);
  const forkTargets = newThreats.filter(movedAttacks);
  // Count the king too when the moving piece gives check.
  const forkCount = forkTargets.length + (after.isCheck() && after.attackers(kingSq(after, them)!, us).includes(move.to) ? 1 : 0);

  const ourThreatsBefore = threatenedPieces(before, us);
  const ourThreatsAfter = new Set(threatenedPieces(after, us));
  const escaped = ourThreatsBefore.includes(move.from) && !ourThreatsAfter.has(move.to);
  const defended = ourThreatsBefore.filter((s) => s !== move.from && !ourThreatsAfter.has(s));
  const hangsMoved = ourThreatsAfter.has(move.to) && !after.isCheckmate();
  const newlyHanging = [...ourThreatsAfter].filter((s) => s !== move.to && !ourThreatsBefore.includes(s));

  const captured = move.captured;
  const captureFree = !!captured && before.attackers(move.to, them).length === 0;
  const captureWinning = !!captured && PIECE_VALUE[captured] > PIECE_VALUE[move.piece];

  const castle = move.flags.includes('k') || move.flags.includes('q');
  const backRank = us === 'w' ? '1' : '8';
  const develop =
    (move.piece === 'n' || move.piece === 'b') && move.from[1] === backRank && moveNo <= 15;
  const centerControl = CENTER.some((c) => after.attackers(c, us).includes(move.to)) || CENTER.includes(move.to);
  const centerPawn = move.piece === 'p' && CENTER.includes(move.to);
  const openFile = move.piece === 'r' && !fileHasPawn(after, fileOf(move.to), us) && fileOf(move.from) !== fileOf(move.to);
  const passedPawn = move.piece === 'p' && isPassedPawn(after, move.to, us);
  const hadCastling = before.getCastlingRights(us).k || before.getCastlingRights(us).q;
  const kingWalk = move.piece === 'k' && !castle && hadCastling && moveNo < 25;
  const earlyQueen = move.piece === 'q' && moveNo <= 6 && !captured;

  return {
    move,
    us,
    mate: after.isCheckmate(),
    check: after.isCheck(),
    captured,
    captureFree,
    captureWinning,
    newThreats,
    forkTargets: forkCount >= 2 ? forkTargets : [],
    pins: findPins(after, move.to),
    escaped,
    defended,
    hangsMoved,
    newlyHanging,
    castle,
    develop,
    centerControl,
    centerPawn,
    openFile,
    passedPawn,
    kingWalk,
    earlyQueen,
    promotion: move.promotion,
    after,
  };
}

function kingSq(game: Chess, color: Color): Square | null {
  for (const row of game.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

/** Good things a move does, most important first. */
export function positiveReasons(f: MoveFeatures, line?: PvLine): string[] {
  const out: string[] = [];
  const name = PIECE_NAME[f.move.piece];
  if (f.mate) return ['รุกจนจบเกม'];
  if (line && line.score.type === 'mate' && line.score.value > 0) {
    out.push(`เปิดทางรุกจนภายใน ${line.score.value} ตา`);
  }
  if (f.promotion) out.push(`เลื่อนเบี้ยขึ้นเป็น${PIECE_NAME[f.promotion]} ได้หมากตัวใหม่ที่มีพลังมาก`);
  if (f.captured) {
    const cap = PIECE_NAME[f.captured];
    if (f.captureFree) out.push(`กิน${cap}ได้ฟรี เพราะไม่มีตัวป้องกัน`);
    else if (f.captureWinning) out.push(`กิน${cap}ซึ่งมีค่ามากกว่า${name} ได้กำไรหมาก`);
    else if (PIECE_VALUE[f.captured] === PIECE_VALUE[f.move.piece]) out.push(`แลก${cap}กัน`);
    else out.push(`กิน${cap}`);
  }
  if (f.forkTargets.length) {
    const targets = f.forkTargets.map((s) => pieceAt(f.after, s));
    if (f.check) targets.unshift('คิง');
    out.push(`ส้อม! ${name}โจมตี${listThai(targets)}พร้อมกัน ฝ่ายตรงข้ามหนีได้ไม่หมด`);
  }
  for (const pin of f.pins) {
    const behind = f.after.get(pin.behind)!;
    out.push(
      `ตรึง${pieceAt(f.after, pin.pinned)}ไว้ ถ้ามันขยับ${PIECE_NAME[behind.type]}ข้างหลังจะโดนกิน`,
    );
  }
  if (f.check && !f.forkTargets.length) out.push('รุกคิง บังคับให้ฝ่ายตรงข้ามต้องแก้รุกก่อน');
  const plainThreats = f.newThreats.filter((s) => !f.forkTargets.includes(s) && !f.pins.some((p) => p.pinned === s));
  if (plainThreats.length && !f.forkTargets.length) {
    out.push(`ขู่กิน${listThai(plainThreats.map((s) => pieceAt(f.after, s)))}`);
  }
  if (f.escaped) out.push(`พา${name}หนีจากการถูกโจมตี`);
  if (f.defended.length) out.push(`ป้องกัน${listThai(f.defended.map((s) => pieceAt(f.after, s)))}ที่กำลังถูกขู่`);
  if (f.castle) out.push('เข้าป้อม พาคิงไปหลบในที่ปลอดภัย และนำเรือออกมาร่วมเกม');
  if (f.develop) {
    out.push(
      f.centerControl
        ? `พัฒนา${name}ออกมาร่วมเกม และช่วยคุมกลางกระดาน`
        : `พัฒนา${name}ออกมาร่วมเกม`,
    );
  } else if (f.centerPawn) {
    out.push('ยึดกลางกระดาน และเปิดทางให้หมากตัวอื่นออกมา');
  }
  if (f.openFile) out.push('วางเรือบนแถวตั้งที่ไม่มีเบี้ยขวาง ทำให้เรือมีพลังมากขึ้น');
  if (f.passedPawn && !f.promotion) out.push('ดันเบี้ยผ่าน (ไม่มีเบี้ยฝ่ายตรงข้ามขวาง) ให้ใกล้เลื่อนขั้น');
  return out.map(tidy);
}

/** Problems a move causes, in plain Thai. */
export function negativeReasons(f: MoveFeatures): string[] {
  const out: string[] = [];
  if (f.hangsMoved) out.push(`${PIECE_NAME[f.move.piece]}ที่ ${f.move.to} ถูกโจมตีและอาจถูกกินโดยไม่คุ้ม`);
  if (f.newlyHanging.length) {
    out.push(`ทำให้${listThai(f.newlyHanging.map((s) => pieceAt(f.after, s)))}ไม่มีการป้องกันพอ`);
  }
  if (f.kingWalk) out.push('คิงเดินเองทำให้เสียสิทธิ์เข้าป้อม คิงจะปลอดภัยน้อยลง');
  if (f.earlyQueen) out.push('เอาควีนออกมาเร็วเกินไป อาจถูกหมากเล็กไล่จนเสียจังหวะ');
  return out.map(tidy);
}

/** Short purpose phrase for a suggested move: "เพื่อ...". */
export function intentPhrase(fen: string, line: PvLine): string {
  const uci = line.pv[0];
  const f = moveFeatures(fen, uci);
  if (!f) return '';
  const reasons = positiveReasons(f, line);
  if (reasons.length) return reasons.slice(0, 2).join(' และ');
  // Fall back to the engine's plan: what we intend to do next.
  if (line.pv.length >= 3) {
    const r = tryMove(fen, uci);
    const reply = r && tryMove(r.after.fen(), line.pv[1]);
    if (reply) {
      const next = tryMove(reply.after.fen(), line.pv[2]);
      if (next) return `เตรียมเดิน ${describeMoveFromTo(next.move)} ในตาถัดไป`;
    }
  }
  return 'ปรับตำแหน่งหมากให้ทำงานได้ดีขึ้น';
}

// ---------- Grading ----------

export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const GRADE_LABEL: Record<Grade, string> = {
  best: 'ยอดเยี่ยม',
  good: 'ดี',
  inaccuracy: 'ไม่แม่น',
  mistake: 'พลาด',
  blunder: 'พลาดร้ายแรง',
};

export const GRADE_ICON: Record<Grade, string> = {
  best: '⭐',
  good: '👍',
  inaccuracy: '⚠️',
  mistake: '❌',
  blunder: '💥',
};

/** Grade from the drop in win % for the player who moved. */
export function gradeFromDrop(drop: number, isBest: boolean): Grade {
  if (isBest || drop < 2) return 'best';
  if (drop < 10) return 'good';
  if (drop < 20) return 'inaccuracy';
  if (drop < 30) return 'mistake';
  return 'blunder';
}

/** Lichess-style accuracy for one move from the win % drop. */
export function moveAccuracy(drop: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

// ---------- Full explanation of a played move ----------

export interface Explanation {
  grade: Grade;
  headline: string;
  good: string[];
  bad: string[];
  /** What happens next: advantage + likely reply. */
  outlook: string[];
  better?: { move: string; uci: string; why: string; gain: string };
}

export interface ExplainInput {
  fen: string;
  played: string;
  /** Engine lines for `fen` (side to move = mover). Best first. */
  bestLines: PvLine[];
  /** Engine line for the position after the played move (side to move = opponent). */
  afterLine?: PvLine;
}

/** Score after the played move, from the mover's point of view. */
function scoreAfterPlayed(input: ExplainInput, after: Chess): Score | null {
  if (after.isCheckmate()) return { type: 'mate', value: 1 };
  if (after.isDraw()) return { type: 'cp', value: 0 };
  if (input.afterLine) return negate(input.afterLine.score);
  const same = input.bestLines.find((l) => l.pv[0] === input.played);
  return same ? same.score : null;
}

export function explainMove(input: ExplainInput): Explanation | null {
  const f = moveFeatures(input.fen, input.played);
  if (!f) return null;
  const best = input.bestLines[0];
  const isBest = !!best && best.pv[0] === input.played;
  const scoreBefore = best?.score;
  const scoreAfter = scoreAfterPlayed(input, f.after);

  let drop = 0;
  if (scoreBefore && scoreAfter && !isBest) {
    drop = winPercent(scoreBefore) - winPercent(scoreAfter);
  }
  const grade = gradeFromDrop(drop, isBest);

  const good = positiveReasons(f, input.bestLines.find((l) => l.pv[0] === input.played));
  const bad = grade === 'best' || grade === 'good' ? [] : negativeReasons(f);

  const outlook: string[] = [];
  if (scoreAfter) {
    outlook.push(describeAdvantage(toWhite(scoreAfter, f.us)));
  }
  if (!f.after.isGameOver() && input.afterLine?.pv[0]) {
    const replyFen = f.after.fen();
    const reply = tryMove(replyFen, input.afterLine.pv[0]);
    if (reply) {
      const replyReasons = positiveReasons(moveFeatures(replyFen, input.afterLine.pv[0])!, input.afterLine);
      const why = replyReasons[0] ? ` เพื่อ${replyReasons[0]}` : '';
      outlook.push(`ฝ่ายตรงข้ามน่าจะตอบด้วย ${describeMoveFromTo(reply.move)}${why}`);
      // A bad move with no obvious reason: the reply shows the punishment.
      if ((grade === 'mistake' || grade === 'blunder' || bad.length === 0) && grade !== 'best' && grade !== 'good' && replyReasons[0]) {
        bad.push(`เปิดโอกาสให้ฝ่ายตรงข้าม${replyReasons[0]}`);
      }
    }
  }
  if (f.after.isGameOver()) outlook.length = 0;

  let better: Explanation['better'];
  if (!isBest && best && grade !== 'best') {
    const bm = tryMove(input.fen, best.pv[0]);
    if (bm) {
      const cpDiff = scoreAfter ? (scoreToCp(best.score) - scoreToCp(scoreAfter)) / 100 : 0;
      let gain = 'ดีกว่าเล็กน้อย';
      if (best.score.type === 'mate' && best.score.value > 0) gain = `ตานี้รุกจนได้ภายใน ${best.score.value} ตา`;
      else if (scoreAfter?.type === 'mate' && scoreAfter.value < 0) gain = 'ตานี้ช่วยไม่ให้ถูกรุกจน';
      else if (cpDiff > 10) gain = 'ดีกว่ามาก (มากกว่า 10 เบี้ย)';
      else if (cpDiff >= 0.5) gain = `ดีกว่าประมาณ ${cpDiff.toFixed(1)} เบี้ย`;
      better = { move: describeMoveFromTo(bm.move), uci: best.pv[0], why: intentPhrase(input.fen, best), gain };
    }
  }

  const headline = `${GRADE_ICON[grade]} ${GRADE_LABEL[grade]}: ${describeMoveFromTo(f.move)}`;
  return { grade, headline, good, bad, outlook, better };
}

/**
 * Warnings for the user after the opponent moved (guide mode).
 * `fen` is the position before the opponent's move.
 */
export function describeOpponentMove(fen: string, uci: string, bestForUs?: PvLine): string[] {
  const f = moveFeatures(fen, uci);
  if (!f) return [];
  const out: string[] = [];
  const name = PIECE_NAME[f.move.piece];
  if (f.mate) return ['ฝ่ายตรงข้ามรุกจน เกมจบแล้ว'];
  if (f.captured) out.push(`ฝ่ายตรงข้ามกิน${PIECE_NAME[f.captured]}ของคุณที่ ${f.move.to}`);
  if (f.check) out.push(`คุณถูกรุก! ต้องแก้รุกก่อน (หนีคิง, บัง หรือกินตัวที่รุก)`);
  if (f.forkTargets.length) {
    out.push(`ระวัง! ${name}ที่ ${f.move.to} ส้อม${listThai(f.forkTargets.map((s) => pieceAt(f.after, s)))}ของคุณ`);
  } else if (f.newThreats.length) {
    out.push(`ระวัง! ฝ่ายตรงข้ามขู่กิน${listThai(f.newThreats.map((s) => pieceAt(f.after, s)))}ของคุณ`);
  }
  for (const pin of f.pins) {
    out.push(`${pieceAt(f.after, pin.pinned)}ของคุณถูกตรึง ถ้าขยับ${PIECE_NAME[f.after.get(pin.behind)!.type]}จะโดนกิน`);
  }
  if (bestForUs && bestForUs.score.type === 'mate' && bestForUs.score.value < 0) {
    out.push(`อันตราย! ฝ่ายตรงข้ามขู่รุกจนภายใน ${Math.abs(bestForUs.score.value)} ตา ต้องป้องกันให้ดี`);
  }
  if (bestForUs && bestForUs.score.type === 'mate' && bestForUs.score.value > 0) {
    out.push(`โอกาสทอง! คุณรุกจนได้ภายใน ${bestForUs.score.value} ตา`);
  }
  return out.map(tidy);
}

/** Engine continuation in Thai, e.g. for the analysis screen. */
export function pvText(fen: string, pv: string[], max = 4): string {
  return describePv(fen, pv, max).join(', ');
}

export { parseUci };
