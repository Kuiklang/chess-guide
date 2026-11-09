import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deepExplain, phaseOf, readLine, strategicNotes } from '../insight';
import { identifyOpening } from '../openings';
import { Chess } from 'chess.js';

describe('insight', () => {
  it('reads a line ahead and reports material', () => {
    // White wins a free knight on d5 and the line continues.
    const fen = 'rnbqkb1r/pppppppp/8/3n4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 3';
    const r = readLine(fen, ['c3d5', 'e7e6', 'd5c3'], 'w', 6);
    expect(r.steps[0].text).toContain('คุณ: ม้าจาก c3 ไป d5');
    expect(r.result.join(' ')).toContain('ได้หมากเพิ่ม 3');
  });

  it('gives opening advice about development and castling', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const notes = strategicNotes(fen, 'w').join(' ');
    expect(notes).toContain('หมากเล็ก');
    expect(notes).toContain('เข้าป้อม');
    expect(phaseOf(new Chess(fen))).toBe('opening');
  });

  it('builds a long explanation with sections', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const e = deepExplain({
      fen,
      played: 'd1g4',
      bestLines: [{ multipv: 1, depth: 12, score: { type: 'cp', value: 40 }, pv: ['g1f3', 'b8c6', 'f1b5'] }],
      afterLine: { multipv: 1, depth: 12, score: { type: 'cp', value: 300 }, pv: ['d7d5', 'g4g3', 'd5e4'] },
      prev: { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', uci: 'e7e5' },
    })!;
    const titles = e.sections.map((s) => s.title).join('|');
    expect(titles).toContain('ตอบโต้ตาก่อนหน้า');
    expect(titles).toContain('มองไปข้างหน้า');
    expect(titles).toContain('ถ้าเดิน');
    expect(e.summary.length).toBeGreaterThan(0);
  });

  it('identifies an opening', () => {
    const db = JSON.parse(readFileSync('public/openings.json', 'utf8'));
    const o = identifyOpening(db, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'])!;
    expect(o.name).toContain('Italian');
    expect(o.guide?.th).toBe('อิตาเลียน');
  });
});
