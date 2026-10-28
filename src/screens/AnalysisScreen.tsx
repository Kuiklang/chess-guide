import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, DEFAULT_POSITION, type Square } from 'chess.js';
import Board, { type Arrow } from '../components/Board';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import ExplanationCard from '../components/ExplanationCard';
import { analyseGame } from '../lib/analysis';
import { engine, isCancelled, type PvLine, type Score } from '../lib/engine';
import { describeAdvantage, formatScore, parseUci } from '../lib/chessUtil';
import { GRADE_ICON, GRADE_LABEL, explainMove, pvText, type Grade } from '../lib/explain';
import { buildPgn } from '../lib/gameConfig';
import { MODE_NAME, getGame, saveGame, type SavedGame } from '../lib/storage';

interface Props {
  gameId: string;
  onBack: () => void;
}

export default function AnalysisScreen({ gameId, onBack }: Props) {
  const [game, setGame] = useState<SavedGame | undefined>(() => getGame(gameId));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [cur, setCur] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [orientation, setOrientation] = useState<'w' | 'b'>(game?.playerColor ?? 'w');
  const started = useRef(false);

  // Positions before/after each ply.
  const positions = useMemo(() => {
    const out: { fen: string; san: string }[] = [{ fen: DEFAULT_POSITION, san: '' }];
    if (!game) return out;
    const c = new Chess();
    for (const m of game.moves) {
      const mv = c.move(parseUci(m));
      out.push({ fen: c.fen(), san: mv.san });
    }
    return out;
  }, [game]);

  useEffect(() => {
    if (!game || game.analysis || started.current) return;
    started.current = true;
    analyseGame(game.moves, (done, total) => setProgress({ done, total }))
      .then((analysis) => {
        const updated = { ...game, analysis };
        saveGame(updated);
        setGame(updated);
        setProgress(null);
      })
      .catch((e) => {
        if (!isCancelled(e)) setError(true);
      });
    return () => {
      engine.cancelAll();
      started.current = false;
    };
  }, [game]);

  // Keyboard navigation on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCur((c) => Math.max(-1, c - 1));
      if (e.key === 'ArrowRight') setCur((c) => Math.min(positions.length - 2, c + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [positions.length]);

  if (!game) {
    return (
      <div className="page">
        <p>ไม่พบเกมนี้</p>
        <button onClick={onBack}>กลับ</button>
      </div>
    );
  }

  const analysis = game.analysis;
  const n = game.moves.length;
  const fen = positions[cur + 1].fen;
  const lastMove =
    cur >= 0 ? { from: game.moves[cur].slice(0, 2) as Square, to: game.moves[cur].slice(2, 4) as Square } : null;

  const evals: Score[] = analysis ? [...analysis.plies.map((p) => p.evalBefore), analysis.finalEval] : [];
  const grades: Grade[] = analysis ? analysis.plies.map((p) => p.grade) : [];

  // Explanation for the selected ply.
  let explanation = null;
  let bestArrow: Arrow | null = null;
  if (analysis && cur >= 0) {
    const ply = analysis.plies[cur];
    const fenBefore = positions[cur].fen;
    const bestLine: PvLine = { multipv: 1, depth: 12, score: ply.bestScore, pv: ply.bestPv };
    const next = analysis.plies[cur + 1];
    const afterTurn = new Chess(positions[cur + 1].fen).turn();
    const afterWhite = next ? next.evalBefore : analysis.finalEval;
    const afterLine: PvLine | undefined = next
      ? { multipv: 1, depth: 12, score: afterTurn === 'w' ? afterWhite : negateScore(afterWhite), pv: next.bestPv }
      : undefined;
    explanation = explainMove({
      fen: fenBefore,
      played: game.moves[cur],
      bestLines: ply.bestPv.length ? [bestLine] : [],
      afterLine,
    });
    if (explanation) explanation = { ...explanation, grade: ply.grade, headline: headlineFor(ply.grade, explanation.headline) };
    if (ply.bestUci && ply.bestUci !== game.moves[cur] && ply.grade !== 'best' && ply.grade !== 'good') {
      const { from, to } = parseUci(ply.bestUci);
      bestArrow = { from, to, color: '#22a35a', opacity: 0.85 };
    }
  }

  const arrows: Arrow[] = bestArrow ? [bestArrow] : [];
  const pgn = buildPgn({
    moves: game.moves,
    mode: game.mode,
    playerColor: game.playerColor,
    botLevel: game.botLevel,
    date: game.date,
    result: game.result,
  });

  const copyPgn = async () => {
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('คัดลอก PGN', pgn);
    }
  };

  const downloadPgn = () => {
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-guide-${game.date.slice(0, 10)}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const counts = (color: 'w' | 'b') => {
    const out: Partial<Record<Grade, number>> = {};
    analysis?.plies.forEach((p, i) => {
      if ((i % 2 === 0 ? 'w' : 'b') === color) out[p.grade] = (out[p.grade] ?? 0) + 1;
    });
    return out;
  };

  return (
    <div className="game-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="กลับ">
          ←
        </button>
        <div className="topbar-title">
          วิเคราะห์เกม <span className="sub">· {MODE_NAME[game.mode]}</span>
        </div>
        <button className="icon-btn" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))} aria-label="หมุนกระดาน">
          ⟲
        </button>
      </header>

      <div className="game-layout">
        <div className="board-col">
          <Board fen={fen} orientation={orientation} movable="none" lastMove={lastMove} arrows={arrows} />
          <div className="controls nav">
            <button onClick={() => setCur(-1)} aria-label="เริ่มต้น">⏮</button>
            <button onClick={() => setCur((c) => Math.max(-1, c - 1))} aria-label="ก่อนหน้า">◀</button>
            <button onClick={() => setCur((c) => Math.min(n - 1, c + 1))} aria-label="ถัดไป">▶</button>
            <button onClick={() => setCur(n - 1)} aria-label="สุดท้าย">⏭</button>
          </div>
        </div>

        <div className="panel-col">
          <div className="status">{game.resultText}</div>

          {!analysis && !error && (
            <div className="card">
              <div className="card-title">กำลังวิเคราะห์เกม...</div>
              <div className="progress">
                <div style={{ width: `${progress ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <div className="muted small">
                {progress ? `${progress.done}/${progress.total} ตำแหน่ง` : 'กำลังโหลดตัวคิด...'}
              </div>
            </div>
          )}
          {error && <div className="card warn">วิเคราะห์ไม่สำเร็จ ลองรีเฟรชหน้าเว็บ</div>}

          {analysis && (
            <>
              <div className="card accuracy">
                {(['w', 'b'] as const).map((c) => {
                  const cnt = counts(c);
                  return (
                    <div key={c} className="acc-side">
                      <div className="acc-name">
                        {c === 'w' ? 'ฝ่ายขาว' : 'ฝ่ายดำ'}
                        {game.playerColor === c && <span className="tag">คุณ</span>}
                      </div>
                      <div className="acc-num">{analysis.accuracy[c]}%</div>
                      <div className="acc-counts">
                        {(['best', 'inaccuracy', 'mistake', 'blunder'] as Grade[]).map((g) => (
                          <span key={g} title={GRADE_LABEL[g]}>
                            {GRADE_ICON[g]} {cnt[g] ?? 0}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <EvalGraph evals={evals} grades={grades} current={cur} onSelect={setCur} />
              <div className="eval-line muted small">
                {cur >= -1 && evals[cur + 1] && (
                  <>
                    {formatScore(evals[cur + 1])} · {describeAdvantage(evals[cur + 1])}
                  </>
                )}
              </div>
            </>
          )}

          {analysis && cur === -1 && <div className="card muted">กด ▶ หรือแตะตาเดินเพื่อดูคำอธิบายทีละตา</div>}
          {explanation && <ExplanationCard title={`ตาที่ ${Math.floor(cur / 2) + 1}${cur % 2 === 0 ? '' : '...'} ${positions[cur + 1].san}`} exp={explanation} />}
          {analysis && cur >= 0 && analysis.plies[cur].bestPv.length > 1 && analysis.plies[cur].grade !== 'best' && (
            <div className="card small">
              <div className="sub-title">แนวการเดินที่ดีที่สุดจากตำแหน่งก่อนหน้า</div>
              <div>{pvText(positions[cur].fen, analysis.plies[cur].bestPv, 5)}</div>
            </div>
          )}

          <MoveList sans={positions.slice(1).map((p) => p.san)} grades={grades} current={cur} onSelect={setCur} />

          <div className="controls">
            <button onClick={copyPgn}>{copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก PGN'}</button>
            <button onClick={downloadPgn}>⬇ ดาวน์โหลด PGN</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function negateScore(s: Score): Score {
  return { type: s.type, value: -s.value };
}

function headlineFor(grade: Grade, original: string): string {
  // Replace the grade part of the headline with the analysis grade.
  const rest = original.split(': ').slice(1).join(': ');
  return `${GRADE_ICON[grade]} ${GRADE_LABEL[grade]}: ${rest}`;
}
