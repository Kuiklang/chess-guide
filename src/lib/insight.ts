// Deeper teaching text: reading engine lines several moves ahead, judging the position
// strategically, and writing the long "อ่านเพิ่ม" explanations.

import { Chess, type Color, type Move, type Square } from 'chess.js';
import type { PvLine } from './engine';
import {
  COLOR_NAME,
  PIECE_NAME,
  PIECE_VALUE,
  describeAdvantage,
  describeMoveFromTo,
  fileOf,
  opposite,
  rankOf,
  squareAt,
  toWhite,
  tryMove,
} from './chessUtil';
import { explainMove, moveFeatures, negativeReasons, positiveReasons, tidy, type ExplainInput, type Explanation } from './explain';

// ---------- Material and phase ----------

export function material(game: Chess): Record<Color, number> {
  const m = { w: 0, b: 0 };
  for (const row of game.board()) for (const p of row) if (p && p.type !== 'k') m[p.color] += PIECE_VALUE[p.type];
  return m;
}

function nonPawnMaterial(game: Chess): number {
  let n = 0;
  for (const row of game.board()) for (const p of row) if (p && p.type !== 'k' && p.type !== 'p') n += PIECE_VALUE[p.type];
  return n;
}

export type Phase = 'opening' | 'middlegame' | 'endgame';

export const PHASE_NAME: Record<Phase, string> = {
  opening: 'ช่วงเปิดหมาก',
  middlegame: 'ช่วงกลางเกม',
  endgame: 'ช่วงท้ายเกม',
};

function undevelopedMinors(game: Chess, c: Color): Square[] {
  const rank = c === 'w' ? '1' : '8';
  const out: Square[] = [];
  for (const [f, t] of [['b', 'n'], ['g', 'n'], ['c', 'b'], ['f', 'b']] as const) {
    const sq = `${f}${rank}` as Square;
    const p = game.get(sq);
    if (p && p.color === c && p.type === t) out.push(sq);
  }
  return out;
}

export function phaseOf(game: Chess): Phase {
  const npm = nonPawnMaterial(game);
  const queens = game.board().flat().filter((p) => p && p.type === 'q').length;
  if (npm <= 20 || (queens === 0 && npm <= 26)) return 'endgame';
  const moveNo = Number(game.fen().split(' ')[5]);
  const undeveloped = undevelopedMinors(game, 'w').length + undevelopedMinors(game, 'b').length;
  if (moveNo <= 12 && undeveloped >= 3) return 'opening';
  if (moveNo <= 8) return 'opening';
  return 'middlegame';
}

// ---------- Strategic assessment ----------

function pawnFiles(game: Chess, c: Color): number[] {
  const counts = new Array(8).fill(0);
  for (const row of game.board()) for (const p of row) if (p && p.type === 'p' && p.color === c) counts[fileOf(p.square)]++;
  return counts;
}

function isPassed(game: Chess, sq: Square, c: Color): boolean {
  const f = fileOf(sq);
  const r = rankOf(sq);
  for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
    for (let rr = 0; rr < 8; rr++) {
      if (c === 'w' ? rr <= r : rr >= r) continue;
      const q = game.get(squareAt(ff, rr));
      if (q && q.type === 'p' && q.color !== c) return false;
    }
  }
  return true;
}

function kingSq(game: Chess, c: Color): Square {
  for (const row of game.board()) for (const p of row) if (p && p.type === 'k' && p.color === c) return p.square;
  return 'e1';
}

/** Short strategic notes about the position for side `c`, most useful first. */
export function strategicNotes(fen: string, c: Color): string[] {
  const game = new Chess(fen);
  const them = opposite(c);
  const phase = phaseOf(game);
  const notes: string[] = [];
  const mat = material(game);
  const diff = mat[c] - mat[them];
  if (diff >= 1) notes.push(`คุณมีหมากมากกว่า ${diff} แต้ม ถ้าได้เปรียบหมากแล้ว ให้แลกหมากตัวต่อตัวเพื่อให้ชนะง่ายขึ้น`);
  else if (diff <= -1) notes.push(`คุณมีหมากน้อยกว่า ${-diff} แต้ม ควรหลีกเลี่ยงการแลกหมาก และหาโอกาสโจมตีเพื่อเอาคืน`);

  const king = kingSq(game, c);
  const rights = game.getCastlingRights(c);
  const homeRank = c === 'w' ? 0 : 7;
  const kf = fileOf(king);
  const castled = rankOf(king) === homeRank && (kf >= 6 || kf <= 2);

  if (phase === 'opening') {
    const und = undevelopedMinors(game, c);
    if (und.length >= 2) {
      notes.push(`ยังมีหมากเล็กที่ยังไม่ออกจากแถวหลัง ${und.length} ตัว (${und.map((s) => `${PIECE_NAME[game.get(s)!.type]} ${s}`).join(', ')}) ควรพัฒนาออกมาก่อนเดินตัวเดิมซ้ำ`);
    }
    if (!castled && (rights.k || rights.q)) notes.push('ยังไม่ได้เข้าป้อม หลักสำคัญของช่วงเปิดหมากคือพาคิงไปที่ปลอดภัยให้เร็ว');
    const centerPawns = (['d4', 'e4', 'd5', 'e5'] as Square[]).filter((s) => {
      const p = game.get(s);
      return p && p.type === 'p' && p.color === c;
    });
    if (centerPawns.length === 0) notes.push('ยังไม่มีเบี้ยอยู่กลางกระดาน ลองหาจังหวะยึดหรือท้าทายช่องกลาง (d4, e4, d5, e5)');
  }

  if (phase !== 'endgame') {
    const queensOn = game.board().flat().some((p) => p && p.type === 'q' && p.color === them);
    if (!castled && !rights.k && !rights.q && queensOn && (kf === 3 || kf === 4)) {
      notes.push('คิงยังค้างอยู่กลางกระดานและเข้าป้อมไม่ได้แล้ว ระวังการเปิดแถวตั้งกลางกระดาน');
    }
    if (castled) {
      const files = kf >= 6 ? [5, 6, 7] : [0, 1, 2];
      const dir = c === 'w' ? 1 : -1;
      let shield = 0;
      for (const f of files) {
        for (const r of [homeRank + dir, homeRank + 2 * dir]) {
          const p = game.get(squareAt(f, r));
          if (p && p.type === 'p' && p.color === c) {
            shield++;
            break;
          }
        }
      }
      if (shield <= 1) notes.push('เบี้ยหน้าคิงเหลือน้อย คิงอาจถูกโจมตีได้ง่าย ให้เก็บหมากไว้ป้องกันใกล้คิง');
    }
  }

  const ownFiles = pawnFiles(game, c);
  const theirFiles = pawnFiles(game, them);
  const isolated: string[] = [];
  const doubled: string[] = [];
  ownFiles.forEach((n, f) => {
    if (n === 0) return;
    if ((f === 0 || ownFiles[f - 1] === 0) && (f === 7 || ownFiles[f + 1] === 0)) isolated.push('abcdefgh'[f]);
    if (n > 1) doubled.push('abcdefgh'[f]);
  });
  if (isolated.length) notes.push(`เบี้ยแถวตั้ง ${isolated.join(', ')} เป็นเบี้ยโดดเดี่ยว (ไม่มีเบี้ยข้าง ๆ ช่วยป้องกัน) ต้องใช้หมากคอยดูแล`);
  if (doubled.length) notes.push(`มีเบี้ยซ้อนกันที่แถวตั้ง ${doubled.join(', ')} ซึ่งเป็นจุดอ่อนในช่วงท้ายเกม`);

  const passed: Square[] = [];
  for (const row of game.board()) for (const p of row) if (p && p.type === 'p' && p.color === c && isPassed(game, p.square, c)) passed.push(p.square);
  if (passed.length) {
    notes.push(
      phase === 'endgame'
        ? `เบี้ยผ่านที่ ${passed.join(', ')} คืออาวุธหลักในช่วงท้ายเกม ดันขึ้นไปพร้อมให้คิงหรือเรือช่วยคุ้มกัน`
        : `มีเบี้ยผ่านที่ ${passed.join(', ')} (ไม่มีเบี้ยฝ่ายตรงข้ามขวาง) เก็บไว้ใช้ในช่วงท้ายเกม`,
    );
  }

  const openFiles: string[] = [];
  for (let f = 0; f < 8; f++) if (ownFiles[f] === 0 && theirFiles[f] === 0) openFiles.push('abcdefgh'[f]);
  const rooks = game.board().flat().filter((p) => p && p.type === 'r' && p.color === c);
  if (openFiles.length && rooks.length && !rooks.some((r) => openFiles.includes(r!.square[0])) && phase !== 'opening') {
    notes.push(`แถวตั้ง ${openFiles.join(', ')} เปิดโล่ง ลองนำเรือไปวางเพื่อให้เรือมีพลังมากขึ้น`);
  }

  const bishops = (col: Color) => game.board().flat().filter((p) => p && p.type === 'b' && p.color === col).length;
  if (bishops(c) === 2 && bishops(them) < 2 && phase !== 'opening') notes.push('คุณมีบิชอปคู่ ซึ่งมีพลังมากในเกมที่เปิด ลองเปิดเกมให้บิชอปทำงาน');

  if (phase === 'endgame') {
    if (rankOf(king) === homeRank) notes.push('เข้าช่วงท้ายเกมแล้ว คิงปลอดภัยพอจะออกมาช่วยต่อสู้ ให้พาคิงเข้าใกล้กลางกระดาน');
  }

  return notes.slice(0, 5).map(tidy);
}

// ---------- Reading lines ahead ----------

/** Short reason a move was played, from the mover's point of view. */
export function moveReason(fen: string, uci: string, prev?: Move): string {
  const f = moveFeatures(fen, uci);
  if (!f) return '';
  if (prev?.captured && f.captured && prev.to === f.move.to) {
    return f.check ? 'กินคืนพร้อมรุก' : `กินคืน ทำให้การแลก${PIECE_NAME[f.captured]}เท่ากัน`;
  }
  const pos = positiveReasons(f);
  if (pos.length) return pos[0];
  if (f.move.piece === 'p') return 'เพิ่มพื้นที่ให้หมากของตัวเอง';
  if (f.move.piece === 'k') return 'ขยับคิงไปที่ปลอดภัยกว่า';
  return `ปรับตำแหน่ง${PIECE_NAME[f.move.piece]}ให้ทำงานได้ดีขึ้น`;
}

export interface LineStep {
  side: Color;
  text: string;
}

export interface LineReading {
  steps: LineStep[];
  /** What the position looks like at the end of the line. */
  result: string[];
}

/** Walk an engine line and say what each move does, then what the position looks like after it. */
export function readLine(fen: string, pv: string[], viewer: Color, maxPlies = 6, finalScore?: PvLine['score']): LineReading {
  const game = new Chess(fen);
  const startMat = material(game);
  const steps: LineStep[] = [];
  let prev: Move | undefined;
  for (const uci of pv.slice(0, maxPlies)) {
    const before = game.fen();
    const r = tryMove(before, uci);
    if (!r) break;
    const who = r.move.color === viewer ? 'คุณ' : 'ฝ่ายตรงข้าม';
    steps.push({ side: r.move.color, text: tidy(`${who}: ${describeMoveFromTo(r.move)} เพื่อ${moveReason(before, uci, prev)}`) });
    game.move(r.move);
    prev = r.move;
    if (game.isGameOver()) break;
  }
  const endMat = material(game);
  const result: string[] = [];
  const delta = endMat[viewer] - startMat[viewer] - (endMat[opposite(viewer)] - startMat[opposite(viewer)]);
  if (game.isCheckmate()) result.push(game.turn() === viewer ? 'จบด้วยการที่คุณถูกรุกจน' : 'จบด้วยการรุกจนฝ่ายตรงข้าม');
  else if (delta >= 1) result.push(`หลังแนวนี้ คุณได้หมากเพิ่ม ${delta} แต้ม`);
  else if (delta <= -1) result.push(`หลังแนวนี้ คุณเสียหมากไป ${-delta} แต้ม`);
  else if (steps.length) result.push('หลังแนวนี้ จำนวนหมากยังเท่าเดิม');
  if (finalScore) result.push(describeAdvantage(finalScore));
  return { steps, result };
}

// ---------- Long explanation of a played move ----------

export interface Section {
  title: string;
  items: string[];
}

export interface DeepExplanation extends Explanation {
  /** One or two sentences shown before "อ่านเพิ่ม". */
  summary: string;
  sections: Section[];
}

export interface DeepInput extends ExplainInput {
  /** The opponent's previous move (UCI) and the position before it, if any. */
  prev?: { fen: string; uci: string };
  /** Write "ฝ่ายขาว/ฝ่ายดำ" instead of "คุณ" (analysis of moves that are not the user's). */
  neutral?: boolean;
}

export function deepExplain(input: DeepInput): DeepExplanation | null {
  const base = explainMove(input);
  if (!base) return null;
  const f = moveFeatures(input.fen, input.played)!;
  const us = f.us;
  const sections: Section[] = [];

  // 1. Reply to the opponent's last move.
  if (input.prev) {
    const pr = tryMove(input.prev.fen, input.prev.uci);
    if (pr) {
      const items = [tidy(`ฝ่ายตรงข้ามเพิ่งเดิน ${describeMoveFromTo(pr.move)} เพื่อ${moveReason(input.prev.fen, input.prev.uci)}`)];
      const recapture = pr.move.captured && f.captured && f.move.to === pr.move.to;
      const pf = moveFeatures(input.prev.fen, input.prev.uci);
      const answered: string[] = [];
      if (pf?.check) answered.push('แก้รุก');
      if (pf && pf.newThreats.some((s) => s === input.played.slice(0, 2)) && f.escaped) answered.push(`พา${PIECE_NAME[f.move.piece]}หนีจากการถูกขู่`);
      if (recapture) answered.push('กินคืน');
      if (f.defended.length) answered.push('ป้องกันหมากที่ถูกขู่');
      items.push(
        answered.length
          ? `ตานี้ของคุณตอบโต้ด้วยการ${answered.join(' และ')}`
          : base.good[0]
            ? `ตานี้ของคุณเลือก${base.good[0]}`
            : 'ตานี้ของคุณไม่ได้ตอบโต้ตาก่อนหน้าโดยตรง แต่เป็นการวางแผนของตัวเอง',
      );
      sections.push({ title: 'ตอบโต้ตาก่อนหน้าอย่างไร', items });
    }
  }

  // 2. What the move does.
  const does = [...base.good, ...base.bad.map((b) => `ข้อควรระวัง: ${b}`)];
  if (does.length) sections.push({ title: 'ตานี้ทำอะไรบ้าง', items: does });

  // 3. Read ahead after the played move.
  if (input.afterLine?.pv.length && !f.after.isGameOver()) {
    const finalWhite = toWhite({ type: input.afterLine.score.type, value: input.afterLine.score.value }, opposite(us));
    const reading = readLine(f.after.fen(), input.afterLine.pv, us, 6, finalWhite);
    sections.push({ title: 'มองไปข้างหน้า: เกมน่าจะไปทางนี้', items: [...reading.steps.map((s) => s.text), ...reading.result] });
  }

  // 4. The better line.
  const best = input.bestLines[0];
  if (base.better && best) {
    const reading = readLine(input.fen, best.pv, us, 6, toWhite(best.score, us));
    sections.push({
      title: `ถ้าเดิน ${base.better.move} แทน`,
      items: [`${base.better.gain} เพราะ${base.better.why}`, ...reading.steps.map((s) => s.text), ...reading.result],
    });
  }

  // 5. Big-picture advice after the move.
  const notes = strategicNotes(f.after.fen(), us);
  if (notes.length) sections.push({ title: `ภาพรวมเชิงกลยุทธ์ (${PHASE_NAME[phaseOf(f.after)]})`, items: notes });

  const reply = base.outlook.find((o) => o.startsWith('ฝ่ายตรงข้ามน่าจะตอบ'));
  const summaryParts = [base.good[0] ?? base.bad[0] ?? '', reply ?? base.outlook[0] ?? ''].filter(Boolean);
  const summary = summaryParts.join(' · ');
  if (input.neutral) {
    const name = COLOR_NAME[us];
    const fix = (t: string) => t.replace(/ตานี้ของคุณ/g, `ตานี้ของ${name}`).replace(/คุณ/g, name);
    return {
      ...base,
      summary: fix(summary),
      sections: sections.map((sec) => ({ title: fix(sec.title), items: sec.items.map(fix) })),
    };
  }
  return { ...base, summary, sections };
}

/** Long explanation for one suggested move (guide/teaching): the plan several moves ahead. */
export function planForLine(fen: string, line: PvLine): Section[] {
  const us = new Chess(fen).turn();
  const f = moveFeatures(fen, line.pv[0]);
  if (!f) return [];
  const sections: Section[] = [];
  const good = positiveReasons(f, line);
  const bad = negativeReasons(f);
  if (good.length || bad.length) sections.push({ title: 'ตานี้ทำอะไร', items: [...good, ...bad.map((b) => `ข้อควรระวัง: ${b}`)] });
  const reading = readLine(fen, line.pv, us, 6, toWhite(line.score, us));
  if (reading.steps.length > 1) sections.push({ title: 'แผนต่อจากนี้ (ถ้าทั้งสองฝ่ายเล่นดีที่สุด)', items: [...reading.steps.map((s) => s.text), ...reading.result] });
  return sections;
}

/** Why the opponent's move was played (for guide/teaching mode). */
export function opponentPurpose(fen: string, uci: string, prev?: Move): string {
  const reason = moveReason(fen, uci, prev);
  return reason ? `เพื่อ${reason}` : '';
}

export { COLOR_NAME };
