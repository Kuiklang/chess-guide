import { useState } from 'react';
import { BOT_LEVELS } from '../lib/gameConfig';
import { MODE_NAME, deleteGame, loadGames } from '../lib/storage';

interface Props {
  onBack: () => void;
  onAnalyse: (id: string) => void;
}

export default function HistoryScreen({ onBack, onAnalyse }: Props) {
  const [games, setGames] = useState(loadGames);

  const remove = (id: string) => {
    if (!window.confirm('ลบเกมนี้?')) return;
    deleteGame(id);
    setGames(loadGames());
  };

  return (
    <div className="page">
      <header className="topbar plain">
        <button className="icon-btn" onClick={onBack} aria-label="กลับ">
          ←
        </button>
        <div className="topbar-title">เกมที่บันทึกไว้</div>
        <span />
      </header>
      <p className="muted small">เก็บไว้ในเบราว์เซอร์นี้ 20 เกมล่าสุด ถ้าล้างข้อมูลเบราว์เซอร์ เกมจะหายไป</p>
      {games.length === 0 && <div className="card muted">ยังไม่มีเกมที่บันทึกไว้</div>}
      <div className="history">
        {games.map((g) => {
          const d = new Date(g.date);
          return (
            <div key={g.id} className="card hist-item">
              <div className="hist-main" onClick={() => onAnalyse(g.id)}>
                <div className="hist-title">
                  {MODE_NAME[g.mode]}
                  {g.mode === 'bot' && g.botLevel ? ` · ${BOT_LEVELS[g.botLevel - 1]?.name}` : ''}
                  {g.playerColor ? ` · คุณเล่น${g.playerColor === 'w' ? 'ขาว' : 'ดำ'}` : ''}
                </div>
                <div className="muted small">
                  {d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}{' '}
                  {d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · {Math.ceil(g.moves.length / 2)} ตา
                </div>
                <div className="hist-result">
                  {g.resultText}
                  {g.analysis && g.playerColor && (
                    <span className="tag">ความแม่นยำ {g.analysis.accuracy[g.playerColor]}%</span>
                  )}
                </div>
              </div>
              <div className="hist-actions">
                <button onClick={() => onAnalyse(g.id)}>📊 วิเคราะห์</button>
                <button className="danger" onClick={() => remove(g.id)} aria-label="ลบ">
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
