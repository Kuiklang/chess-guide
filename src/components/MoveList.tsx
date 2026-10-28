import { useEffect, useRef } from 'react';
import { GRADE_ICON, type Grade } from '../lib/explain';

interface Props {
  sans: string[];
  grades?: Grade[];
  /** Index of the highlighted ply, -1 for the start position. */
  current?: number;
  onSelect?: (ply: number) => void;
}

export default function MoveList({ sans, grades, current, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.cur');
    if (el) el.scrollIntoView({ block: 'nearest' });
    else if (ref.current && current === undefined) ref.current.scrollTop = ref.current.scrollHeight;
  }, [sans.length, current]);

  if (sans.length === 0) return <div className="movelist empty muted small">ยังไม่มีการเดิน</div>;
  const rows = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push(
      <div className="mrow" key={i}>
        <span className="mno">{i / 2 + 1}.</span>
        {[i, i + 1].map((j) =>
          j < sans.length ? (
            <span
              key={j}
              className={'mv' + (current === j ? ' cur' : '') + (grades?.[j] ? ' g-' + grades[j] : '')}
              onClick={() => onSelect?.(j)}
            >
              {sans[j]}
              {grades?.[j] && grades[j] !== 'good' && <i className="gicon">{GRADE_ICON[grades[j]]}</i>}
            </span>
          ) : (
            <span key={j} className="mv" />
          ),
        )}
      </div>,
    );
  }
  return (
    <div className="movelist" ref={ref}>
      {rows}
    </div>
  );
}
