// Builds public/openings.json from the Lichess chess-openings TSV files (CC0).
// Usage: node scripts/build-openings.mjs <dir with a.tsv..e.tsv>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';

const dir = process.argv[2];
const out = {};
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const game = new Chess();
    game.loadPgn(pgn);
    // Position key: placement, side to move, castling (ignore en passant and clocks for transpositions).
    const key = game.fen().split(' ').slice(0, 3).join(' ');
    out[key] = [eco, name];
  }
}
writeFileSync(new URL('../public/openings.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'positions');
