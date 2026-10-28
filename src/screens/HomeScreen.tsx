import { useState } from 'react';
import { BOT_LEVELS, type GameConfig } from '../lib/gameConfig';
import type { Mode } from '../lib/storage';

interface Props {
  onStart: (config: GameConfig) => void;
  onHistory: () => void;
  savedCount: number;
}

type ColorChoice = 'w' | 'b' | 'random';

const MODES: { mode: Mode; icon: string; title: string; desc: string }[] = [
  { mode: 'bot', icon: '🤖', title: 'เล่นกับบอท', desc: 'ฝึกเล่นกับคอมพิวเตอร์ 5 ระดับ มีปุ่มขอคำใบ้' },
  { mode: 'pvp', icon: '👥', title: 'เล่น 2 คน', desc: 'ผลัดกันเดินบนเครื่องเดียว' },
  {
    mode: 'guide',
    icon: '🧭',
    title: 'โหมดไกด์',
    desc: 'ใช้ตอนเล่นบนกระดานจริง กดเดินแทนฝั่งตรงข้าม แล้วรับคำแนะนำ 3 ทางพร้อมคำอธิบาย',
  },
];

export default function HomeScreen({ onStart, onHistory, savedCount }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [color, setColor] = useState<ColorChoice>('w');
  const [level, setLevel] = useState(3);

  const start = () => {
    if (!mode) return;
    const playerColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    onStart({ mode, playerColor, botLevel: level });
  };

  return (
    <div className="page home">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}pieces/wN.svg`} alt="" />
        <div>
          <h1>หมากรุกไกด์</h1>
          <p className="muted">เล่น ฝึก และเรียนรู้หมากรุกสากล</p>
        </div>
      </div>

      <div className="mode-list">
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={'mode-card' + (mode === m.mode ? ' active' : '')}
            onClick={() => {
              setMode(m.mode);
              if (m.mode !== 'bot' && color === 'random') setColor('w');
            }}
          >
            <span className="mode-icon">{m.icon}</span>
            <span className="mode-text">
              <span className="mode-title">{m.title}</span>
              <span className="mode-desc">{m.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {mode && mode !== 'pvp' && (
        <div className="setup card">
          <div className="sub-title">{mode === 'guide' ? 'คุณเล่นฝ่ายไหนบนกระดานจริง' : 'คุณเล่นฝ่าย'}</div>
          <div className="seg">
            <button className={color === 'w' ? 'on' : ''} onClick={() => setColor('w')}>
              ♔ ขาว
            </button>
            <button className={color === 'b' ? 'on' : ''} onClick={() => setColor('b')}>
              ♚ ดำ
            </button>
            {mode === 'bot' && (
              <button className={color === 'random' ? 'on' : ''} onClick={() => setColor('random')}>
                🎲 สุ่ม
              </button>
            )}
          </div>
          {mode === 'bot' && (
            <>
              <div className="sub-title">ความยากของบอท</div>
              <div className="seg levels">
                {BOT_LEVELS.map((l, i) => (
                  <button key={l.name} className={level === i + 1 ? 'on' : ''} onClick={() => setLevel(i + 1)}>
                    {l.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button className="primary big" disabled={!mode} onClick={start}>
        {mode ? 'เริ่มเล่น' : 'เลือกโหมดก่อน'}
      </button>

      <button className="link history-link" onClick={onHistory}>
        📚 เกมที่บันทึกไว้ ({savedCount})
      </button>
    </div>
  );
}
