import { describe, expect, it } from 'vitest';
import { moveFeatures, positiveReasons, negativeReasons, explainMove, intentPhrase } from '../explain';

describe('moveFeatures', () => {
  it('sees a knight fork', () => {
    // White knight e5 -> f7 forks queen d8 and rook h8
    const fen = 'r2qk2r/ppp2ppp/8/4N3/8/8/PPP2PPP/R2QK2R w KQkq - 0 10';
    const f = moveFeatures(fen, 'e5f7')!;
    const r = positiveReasons(f);
    expect(r.join(' ')).toContain('ส้อม');
  });

  it('sees a free capture', () => {
    // Black knight on d5 is undefended
    const fen = 'rnbqkb1r/pppppppp/8/3n4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 3';
    const f = moveFeatures(fen, 'c3d5')!;
    expect(positiveReasons(f)[0]).toContain('ฟรี');
  });

  it('sees a pin', () => {
    // Bb5 pins knight c6 to king e8
    const fen = 'r1bqkbnr/ppp2ppp/2np4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4';
    const f = moveFeatures(fen, 'f1b5')!;
    expect(positiveReasons(f).join(' ')).toContain('ตรึง');
  });

  it('flags a hanging queen', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const f = moveFeatures(fen, 'd1g4')!;
    expect(negativeReasons(f).join(' ')).toContain('ควีน');
  });

  it('describes development', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const text = intentPhrase(fen, { multipv: 1, depth: 10, score: { type: 'cp', value: 30 }, pv: ['g1f3'] });
    expect(text).toContain('พัฒนาม้า');
    expect(text).toContain('e5');
  });
});

describe('explainMove', () => {
  it('grades a blunder and offers a better move', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const e = explainMove({
      fen,
      played: 'd1g4',
      bestLines: [{ multipv: 1, depth: 12, score: { type: 'cp', value: 40 }, pv: ['g1f3', 'b8c6'] }],
      afterLine: { multipv: 1, depth: 12, score: { type: 'cp', value: 800 }, pv: ['d7d5', 'g4f3'] },
    })!;
    expect(e.grade).toBe('blunder');
    expect(e.better?.move).toContain('ม้า');
  });
});
