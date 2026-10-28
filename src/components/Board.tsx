import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Chess, type Color, type Square, type PieceSymbol } from 'chess.js';
import { kingSquare, squareAt } from '../lib/chessUtil';

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
  /** Small label drawn near the arrow head, e.g. "1". */
  label?: string;
  width?: number;
  opacity?: number;
}

interface Props {
  fen: string;
  orientation: Color;
  /** Which side the user may move pieces for. */
  movable: Color | 'both' | 'none';
  onMove?: (uci: string) => void;
  lastMove?: { from: Square; to: Square } | null;
  arrows?: Arrow[];
}

const PIECE_URL = (color: Color, type: PieceSymbol) =>
  `${import.meta.env.BASE_URL}pieces/${color}${type.toUpperCase()}.svg`;

interface Drag {
  from: Square;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

export default function Board({ fen, orientation, movable, onMove, lastMove, arrows = [] }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const game = useMemo(() => new Chess(fen), [fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [lastFen, setLastFen] = useState(fen);

  // Clear any selection when the position changes from outside.
  if (fen !== lastFen) {
    setLastFen(fen);
    setSelected(null);
    setDrag(null);
    setPromotion(null);
  }

  const turn = game.turn();
  const canMoveSide = movable === 'both' || movable === turn;

  const targets = useMemo(() => {
    if (!selected) return new Set<Square>();
    return new Set(game.moves({ square: selected, verbose: true }).map((m) => m.to as Square));
  }, [game, selected]);

  const checkSq = game.isCheck() ? kingSquare(game, turn) : null;

  // Board geometry: index 0..7 from the top-left as displayed.
  const toDisplay = (sq: Square) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    return orientation === 'w' ? { col: f, row: 7 - r } : { col: 7 - f, row: r };
  };
  const fromDisplay = (col: number, row: number): Square =>
    orientation === 'w' ? squareAt(col, 7 - row) : squareAt(7 - col, row);

  const squareFromPoint = (clientX: number, clientY: number): Square | null => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return fromDisplay(col, row);
  };

  const tryMove = (from: Square, to: Square) => {
    const legal = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (legal.length === 0) return false;
    if (legal.some((m) => m.promotion)) {
      setPromotion({ from, to });
      return true;
    }
    setSelected(null);
    onMove?.(from + to);
    return true;
  };

  const ownPiece = (sq: Square) => {
    const p = game.get(sq);
    return !!p && canMoveSide && p.color === turn;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (promotion || !canMoveSide) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (selected && targets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (ownPiece(sq)) {
      setSelected(sq);
      const rect = ref.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrag({ from: sq, startX: x, startY: y, x, y, moved: false });
      ref.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = ref.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const moved = drag.moved || Math.hypot(x - drag.startX, y - drag.startY) > 6;
    setDrag({ ...drag, x, y, moved });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    const d = drag;
    setDrag(null);
    if (d.moved && sq && sq !== d.from) {
      if (!tryMove(d.from, sq)) setSelected(null);
    }
  };

  const pieces = [];
  for (const row of game.board()) {
    for (const p of row) {
      if (!p) continue;
      const { col, row: r } = toDisplay(p.square);
      const dragging = drag?.moved && drag.from === p.square;
      const style = dragging
        ? {
            transform: `translate(${drag!.x}px, ${drag!.y}px) translate(-50%, -50%) scale(1.15)`,
            left: 0,
            top: 0,
            zIndex: 10,
          }
        : { left: `${col * 12.5}%`, top: `${r * 12.5}%` };
      pieces.push(
        <img
          key={p.square + p.color + p.type}
          className={'piece' + (dragging ? ' dragging' : '')}
          src={PIECE_URL(p.color, p.type)}
          alt=""
          draggable={false}
          style={style}
        />,
      );
    }
  }

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = fromDisplay(col, row);
      const light = (col + row) % 2 === 0;
      const classes = ['sq', light ? 'light' : 'dark'];
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) classes.push('last');
      if (selected === sq) classes.push('selected');
      if (checkSq === sq) classes.push('check');
      const isTarget = targets.has(sq);
      squares.push(
        <div key={sq} className={classes.join(' ')} style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
          {col === 0 && <span className="coord rank">{sq[1]}</span>}
          {row === 7 && <span className="coord file">{sq[0]}</span>}
          {isTarget && <span className={game.get(sq) ? 'hint capture' : 'hint'} />}
        </div>,
      );
    }
  }

  const center = (sq: Square) => {
    const { col, row } = toDisplay(sq);
    return { x: col * 12.5 + 6.25, y: row * 12.5 + 6.25 };
  };

  return (
    <div
      className="board"
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {squares}
      {pieces}
      {arrows.length > 0 && (
        <svg className="arrows" viewBox="0 0 100 100">
          {arrows.map((a, i) => {
            const s = center(a.from);
            const t = center(a.to);
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const w = a.width ?? 2.2;
            const head = w * 2.2;
            // Start a bit off the centre of the origin square, stop at the arrow head.
            const sx = s.x + ux * 3;
            const sy = s.y + uy * 3;
            const ex = t.x - ux * head;
            const ey = t.y - uy * head;
            const px = -uy;
            const py = ux;
            const tip = `${t.x},${t.y} ${ex + px * head * 0.75},${ey + py * head * 0.75} ${ex - px * head * 0.75},${ey - py * head * 0.75}`;
            return (
              <g key={i} opacity={a.opacity ?? 0.85}>
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={w} strokeLinecap="round" />
                <polygon points={tip} fill={a.color} />
                {a.label && (
                  <g>
                    <circle cx={(sx + ex) / 2} cy={(sy + ey) / 2} r={3.2} fill={a.color} />
                    <text x={(sx + ex) / 2} y={(sy + ey) / 2 + 1.3} textAnchor="middle" fontSize="3.6" fontWeight="700" fill="#fff">
                      {a.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {promotion && (
        <div className="promo" onPointerDown={(e) => e.stopPropagation()}>
          <div className="promo-box">
            <div className="promo-title">เลื่อนเบี้ยเป็น</div>
            <div className="promo-choices">
              {(['q', 'r', 'b', 'n'] as PieceSymbol[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    const pr = promotion;
                    setPromotion(null);
                    setSelected(null);
                    onMove?.(pr.from + pr.to + t);
                  }}
                >
                  <img src={PIECE_URL(turn, t)} alt={t} />
                </button>
              ))}
            </div>
            <button className="link" onClick={() => setPromotion(null)}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

