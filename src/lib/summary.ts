// Whole-game summary: opening, phases, turning points, missed chances and advice.

import { Chess, type Color } from 'chess.js';
import { COLOR_NAME, describeMoveFromTo, parseUci, tryMove, winPercent } from './chessUtil';
import { GRADE_LABEL, intentPhrase, moveFeatures } from './explain';
import { PHASE_NAME, phaseOf, type Phase } from './insight';
import { openingTitle, type OpeningInfo } from './openings';
import type { GameAnalysis } from './storage';

export interface SummaryItem {
  text: string;
  /** Ply to jump to when tapped. */
  ply?: number;
}

export interface SummarySection {
  title: string;
  items: SummaryItem[];
}

export interface GameSummary {
  short: string[];
  sections: SummarySection[];
  phases: { phase: Phase; from: number; to: number }[];
}

function moveLabel(ply: number): string {
  const no = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `ตาที่ ${no}` : `ตาที่ ${no}...`;
}

export function summarizeGame(
  moves: string[],
  analysis: GameAnalysis,
  opening: OpeningInfo | null,
  playerColor?: Color,
): GameSummary {
  const game = new Chess();
  const fens: string[] = [game.fen()];
  const sans: string[] = [];
  const phaseByPly: Phase[] = [];
  for (const m of moves) {
    phaseByPly.push(phaseOf(game));
    const mv = game.move(parseUci(m));
    sans.push(mv.san);
    fens.push(game.fen());
  }

  // Phase ranges (by ply index).
  const phases: GameSummary['phases'] = [];
  phaseByPly.forEach((ph, i) => {
    const last = phases[phases.length - 1];
    // Phases only move forward; ignore brief flickers back.
    if (last && (last.phase === ph || order(ph) < order(last.phase))) last.to = i;
    else phases.push({ phase: ph, from: i, to: i });
  });

  const side = (ply: number): Color => (ply % 2 === 0 ? 'w' : 'b');
  const who = (c: Color) => (playerColor ? (c === playerColor ? 'คุณ' : 'ฝ่ายตรงข้าม') : COLOR_NAME[c]);
  const sections: SummarySection[] = [];

  // Opening.
  if (opening) {
    const items: SummaryItem[] = [{ text: `เกมนี้เปิดด้วย ${openingTitle(opening)} [${opening.eco}] ตามตำรา ${Math.ceil(opening.plies / 2)} ตาแรก` }];
    if (opening.guide) {
      items.push({ text: `แนวคิด: ${opening.guide.idea}` });
      items.push({ text: `แผนของฝ่ายขาว: ${opening.guide.white}` });
      items.push({ text: `แผนของฝ่ายดำ: ${opening.guide.black}` });
    }
    if (opening.plies < moves.length) {
      const p = opening.plies;
      items.push({ text: `ออกจากตำราที่${moveLabel(p)} ${sans[p]} (${COLOR_NAME[side(p)]})`, ply: p });
    }
    sections.push({ title: 'การเปิดหมาก', items });
  }

  // Phases with accuracy.
  const phaseItems: SummaryItem[] = phases.map((ph) => {
    const parts: string[] = [];
    for (const c of ['w', 'b'] as Color[]) {
      const idx = range(ph.from, ph.to).filter((i) => side(i) === c);
      if (!idx.length) continue;
      const acc = Math.round(idx.reduce((a, i) => a + analysis.plies[i].accuracy, 0) / idx.length);
      const errors = idx.filter((i) => ['mistake', 'blunder'].includes(analysis.plies[i].grade)).length;
      parts.push(`${who(c)} แม่นยำ ${acc}%${errors ? ` พลาด ${errors} ครั้ง` : ''}`);
    }
    return {
      text: `${PHASE_NAME[ph.phase]} (${moveLabel(ph.from)} ถึง ${moveLabel(ph.to)}): ${parts.join(', ')}`,
      ply: ph.from,
    };
  });
  sections.push({ title: 'แต่ละช่วงของเกม', items: phaseItems });

  // Key moments: largest drops.
  const ranked = analysis.plies
    .map((p, i) => ({ i, drop: p.drop, grade: p.grade }))
    .filter((x) => x.drop >= 10)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 5)
    .sort((a, b) => a.i - b.i);
  const keyItems: SummaryItem[] = ranked.map(({ i, grade }) => {
    const p = analysis.plies[i];
    let better = '';
    if (p.bestUci && p.bestPv.length) {
      const bm = tryMove(fens[i], p.bestUci);
      if (bm) better = ` ควรเดิน ${describeMoveFromTo(bm.move)} เพื่อ${intentPhrase(fens[i], { multipv: 1, depth: 12, score: p.bestScore, pv: p.bestPv })}`;
    }
    return { text: `${moveLabel(i)} ${who(side(i))}เดิน ${sans[i]} (${GRADE_LABEL[grade]}).${better}`, ply: i };
  });
  if (keyItems.length) sections.push({ title: 'จุดที่น่าศึกษา (ควรทำแบบไหนแทน)', items: keyItems });

  // Turning point: the single largest swing.
  let turning = -1;
  let maxDrop = 0;
  analysis.plies.forEach((p, i) => {
    if (p.drop > maxDrop) {
      maxDrop = p.drop;
      turning = i;
    }
  });

  // Missed chances: a winning tactic or mate was available but not played.
  const missed: SummaryItem[] = [];
  analysis.plies.forEach((p, i) => {
    if (!p.bestUci || p.bestUci === moves[i] || p.drop < 8) return;
    const bf = moveFeatures(fens[i], p.bestUci);
    if (!bf) return;
    let what = '';
    if (p.bestScore.type === 'mate' && p.bestScore.value > 0) what = `รุกจนได้ภายใน ${p.bestScore.value} ตา`;
    else if (bf.forkTargets.length) what = 'ส้อมหมากฝ่ายตรงข้าม';
    else if (bf.captureFree) what = 'กินหมากฟรี';
    else if (bf.captureWinning) what = 'กินหมากที่มีค่ามากกว่า';
    if (what) missed.push({ text: `${moveLabel(i)} ${who(side(i))}พลาดโอกาส${what} ด้วย ${describeMoveFromTo(bf.move)}`, ply: i });
  });
  if (missed.length) sections.push({ title: 'โอกาสที่พลาดไป', items: missed.slice(0, 5) });

  // Habits and advice.
  const focus: Color[] = playerColor ? [playerColor] : ['w', 'b'];
  const advice: SummaryItem[] = [];
  for (const c of focus) {
    let hung = 0;
    let ignored = 0;
    let bigErrors = 0;
    let castlePly = -1;
    let earlyQueen = false;
    let kingWalk = false;
    moves.forEach((m, i) => {
      if (side(i) !== c) return;
      const f = moveFeatures(fens[i], m);
      if (!f) return;
      const bad = ['mistake', 'blunder'].includes(analysis.plies[i].grade);
      if (bad) bigErrors++;
      if ((f.hangsMoved || f.newlyHanging.length) && bad) hung++;
      if (bad && i > 0) {
        const pf = moveFeatures(fens[i - 1], moves[i - 1]);
        if (pf && (pf.newThreats.length || pf.forkTargets.length || pf.check)) ignored++;
      }
      if (f.castle && castlePly < 0) castlePly = i;
      if (f.earlyQueen) earlyQueen = true;
      if (f.kingWalk) kingWalk = true;
    });
    const name = who(c);
    if (hung) advice.push({ text: `${name}ปล่อยหมากให้ถูกกินหรือถูกโจมตีโดยไม่คุ้ม ${hung} ครั้ง ก่อนเดินทุกตาให้ถามตัวเองว่า "หมากที่เดินไปถูกโจมตีไหม และมีอะไรป้องกันหรือเปล่า"` });
    if (castlePly < 0 && moves.length > 24) advice.push({ text: `${name}ไม่ได้เข้าป้อมเลยตลอดเกม ลองเข้าป้อมให้ได้ภายใน 10 ตาแรก` });
    else if (castlePly > 24) advice.push({ text: `${name}เข้าป้อมช้า (${moveLabel(castlePly)}) คิงที่อยู่กลางกระดานนานเสี่ยงต่อการถูกโจมตี`, ply: castlePly });
    if (ignored) advice.push({ text: `${name}พลาดหลังจากฝ่ายตรงข้ามขู่ ${ignored} ครั้ง ทุกครั้งที่ฝ่ายตรงข้ามเดิน ให้ถามตัวเองก่อนว่า "เขาขู่อะไร" แล้วค่อยวางแผนของตัวเอง` });
    if (bigErrors && !hung && !ignored) advice.push({ text: `${name}พลาดใหญ่ ${bigErrors} ครั้ง ลองย้อนดูใน "จุดที่น่าศึกษา" ว่าตาที่ดีกว่าคืออะไร และอ่านแนวการเดินล่วงหน้าประกอบ` });
    if (earlyQueen) advice.push({ text: `${name}เอาควีนออกเร็ว ช่วงเปิดหมากควรออกม้าและบิชอปก่อน` });
    if (kingWalk) advice.push({ text: `${name}เดินคิงจนเสียสิทธิ์เข้าป้อมในช่วงต้นเกม` });
    if (missed.some((x) => x.ply !== undefined && side(x.ply) === c)) {
      advice.push({ text: `${name}พลาดโอกาสทางยุทธวิธีบางครั้ง ก่อนเดินให้มองหา "รุก กิน ขู่" ของตัวเองก่อนเสมอ` });
    }
    const end = phases.find((p) => p.phase === 'endgame');
    if (end) {
      const idx = range(end.from, end.to).filter((i) => side(i) === c);
      const errs = idx.filter((i) => ['mistake', 'blunder'].includes(analysis.plies[i].grade)).length;
      if (errs >= 2) advice.push({ text: `${name}พลาดหลายครั้งในช่วงท้ายเกม ควรฝึกเรื่องการใช้คิงและเบี้ยผ่าน` });
    }
  }
  if (!advice.length) advice.push({ text: 'เล่นได้สม่ำเสมอ ไม่มีจุดอ่อนที่เกิดซ้ำ ลองเพิ่มความยากหรือศึกษาจุดที่น่าศึกษาด้านบน' });
  sections.push({ title: 'คำแนะนำสำหรับเกมต่อไป', items: advice });

  // Short summary.
  const short: string[] = [];
  if (opening) short.push(`เปิดหมากแบบ ${opening.guide?.th ?? opening.name}`);
  const accText = (c: Color) => `${who(c)} ${analysis.accuracy[c]}%`;
  short.push(`ความแม่นยำ: ${accText('w')} (ขาว), ${accText('b')} (ดำ)`);
  if (turning >= 0 && maxDrop >= 15) {
    const swingTo = opposite(side(turning));
    short.push(`จุดเปลี่ยนสำคัญคือ${moveLabel(turning)} ${sans[turning]} ทำให้${who(swingTo)}ได้เปรียบ`);
  } else {
    short.push('ไม่มีความผิดพลาดใหญ่ที่เปลี่ยนเกม');
  }
  const final = winPercent(analysis.finalEval);
  short.push(final > 60 ? 'ตำแหน่งสุดท้ายฝ่ายขาวได้เปรียบ' : final < 40 ? 'ตำแหน่งสุดท้ายฝ่ายดำได้เปรียบ' : 'ตำแหน่งสุดท้ายใกล้เคียงกัน');

  return { short, sections, phases };
}

function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

function order(p: Phase): number {
  return p === 'opening' ? 0 : p === 'middlegame' ? 1 : 2;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
