import type { Explanation } from '../lib/explain';

interface Props {
  exp: Explanation;
  title?: string;
  /** Render without the outer card (e.g. inside <details>). */
  bare?: boolean;
}

export default function ExplanationCard({ exp, title, bare }: Props) {
  const body = (
    <>
      {title && <div className="card-title">{title}</div>}
      <div className={`grade-line grade-${exp.grade}`}>{exp.headline}</div>
      {exp.good.length > 0 && (
        <>
          <div className="sub-title">ตานี้ช่วยอะไร</div>
          <ul className="reasons good-list">
            {exp.good.slice(0, 4).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {exp.bad.length > 0 && (
        <>
          <div className="sub-title">จุดที่ต้องระวัง</div>
          <ul className="reasons bad-list">
            {exp.bad.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {exp.better && (
        <div className="better">
          <div className="sub-title">ตาที่ดีกว่า</div>
          <div>
            <b>{exp.better.move}</b> เพื่อ{exp.better.why}
          </div>
          <div className="muted small">{exp.better.gain}</div>
        </div>
      )}
      {exp.outlook.length > 0 && (
        <>
          <div className="sub-title">ผลที่ตามมา</div>
          <ul className="reasons">
            {exp.outlook.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
  return bare ? <div className="explain">{body}</div> : <div className="card explain">{body}</div>;
}
