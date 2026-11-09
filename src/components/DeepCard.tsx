import { useState } from 'react';
import type { DeepExplanation, Section } from '../lib/insight';

interface Props {
  exp: DeepExplanation;
  title?: string;
  /** Start expanded. */
  open?: boolean;
}

/** Short explanation with an "อ่านเพิ่ม" button that reveals the long one. */
export default function DeepCard({ exp, title, open = false }: Props) {
  const [expanded, setExpanded] = useState(open);
  return (
    <div className="card explain">
      {title && <div className="card-title">{title}</div>}
      <div className={`grade-line grade-${exp.grade}`}>{exp.headline}</div>
      {exp.summary && <p className="summary-text">{exp.summary}</p>}
      {exp.better && !expanded && (
        <div className="better compact">
          ตาที่ดีกว่า: <b>{exp.better.move}</b> เพื่อ{exp.better.why}
        </div>
      )}
      {expanded && <Sections sections={exp.sections} />}
      <button className="more-btn" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'ย่อ ▴' : 'อ่านเพิ่ม ▾'}
      </button>
    </div>
  );
}

export function Sections({ sections }: { sections: Section[] }) {
  return (
    <div className="sections">
      {sections.map((s, i) => (
        <div key={i} className="section">
          <div className="sub-title">{s.title}</div>
          <ul className="reasons">
            {s.items.map((t, j) => (
              <li key={j}>{t}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Generic collapsible block used for opening and strategy cards. */
export function Collapsible({ title, preview, children }: { title: string; preview?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {preview && <div className="summary-text">{preview}</div>}
      {open && <div className="collapsible-body">{children}</div>}
      <button className="more-btn" onClick={() => setOpen((v) => !v)}>
        {open ? 'ย่อ ▴' : 'อ่านเพิ่ม ▾'}
      </button>
    </div>
  );
}
