import type { Score } from '../lib/engine';
import { winPercent } from '../lib/chessUtil';
import type { Grade } from '../lib/explain';

interface Props {
  /** White's-view eval after each ply, starting with the initial position. */
  evals: Score[];
  grades: Grade[];
  current: number;
  onSelect: (ply: number) => void;
}

const GRADE_COLOR: Partial<Record<Grade, string>> = {
  inaccuracy: '#e6b422',
  mistake: '#e07b24',
  blunder: '#d23b3b',
};

export default function EvalGraph({ evals, grades, current, onSelect }: Props) {
  const n = evals.length;
  if (n < 2) return null;
  const W = 300;
  const H = 70;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (s: Score) => H - (winPercent(s) / 100) * H;
  const pts = evals.map((s, i) => `${x(i)},${y(s)}`).join(' ');
  const area = `0,${H} ${pts} ${W},${H}`;

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left) / rect.width) * (n - 1));
    onSelect(Math.max(0, Math.min(n - 1, i)) - 1);
  };

  return (
    <svg
      className="evalgraph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
    >
      <rect x="0" y="0" width={W} height={H} className="eg-black" />
      <polygon points={area} className="eg-white" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      {grades.map((g, i) =>
        GRADE_COLOR[g] ? <circle key={i} cx={x(i + 1)} cy={y(evals[i + 1])} r="2.6" fill={GRADE_COLOR[g]} /> : null,
      )}
      <line x1={x(current + 1)} x2={x(current + 1)} y1="0" y2={H} className="eg-cur" />
    </svg>
  );
}
