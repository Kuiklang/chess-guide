import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, DEFAULT_POSITION, type Square } from 'chess.js';
import Board, { type Arrow } from '../components/Board';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import DeepCard, { Sections } from '../components/DeepCard';
import { analyseGame } from '../lib/analysis';
import { engine, isCancelled, type PvLine, type Score } from '../lib/engine';
import { describeAdvantage, describeMoveFromTo, formatScore, parseUci, tryMove } from '../lib/chessUtil';
import { GRADE_ICON, GRADE_LABEL, pvText, type Grade } from '../lib/explain';
import { deepExplain, moveReason, type DeepExplanation } from '../lib/insight';
import { identifyOpening, loadOpenings, type OpeningInfo } from '../lib/openings';
import { summarizeGame } from '../lib/summary';
import { buildPgn } from '../lib/gameConfig';
import { MODE_NAME, getGame, saveGame, type GameAnalysis, type SavedGame } from '../lib/storage';

interface Props {
  gameId: string;
  onBack: () => void;
}

type Tab = 'summary' | 'moves' | 'read';

export default function AnalysisScreen({ gameId, onBack }: Props) {
  const [game, setGame] = useState<SavedGame | undefined>(() => getGame(gameId));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [cur, setCur] = useState(-1);
  const [tab, setTab] = useState<Tab>('summary');
  const [copied, setCopied] = useState(false);
  const [orientation, setOrientation] = useState<'w' | 'b'>(game?.playerColor ?? 'w');
  const [opening, setOpening] = useState<OpeningInfo | null>(null);
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
    if (!game) return;
    let active = true;
    loadOpenings().then((db) => active && setOpening(identifyOpening(db, game.moves)));
    return () => {
      active = false;
    };
  }, [game?.id]);

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

  const summary = useMemo(
    () => (game?.analysis ? summarizeGame(game.moves, game.analysis, opening, game.playerColor) : null),
    [game, opening],
  );

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

  const explanation = analysis && cur >= 0 ? explainPly(game, analysis, positions, cur) : null;
  let bestArrow: Arrow | null = null;
  if (analysis && cur >= 0) {
    const ply = analysis.plies[cur];
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

  const jump = (ply: number) => {
    setCur(ply);
    setTab('moves');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
                {evals[cur + 1] && (
                  <>
                    {formatScore(evals[cur + 1])} · {describeAdvantage(evals[cur + 1])}
                  </>
                )}
              </div>

              <div className="tabs">
                <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
                  สรุปเกม
                </button>
                <button className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>
                  ทีละตา
                </button>
                <button className={tab === 'read' ? 'on' : ''} onClick={() => setTab('read')}>
                  อ่านทั้งเกม
                </button>
              </div>

              {tab === 'summary' && summary && (
                <>
                  <div className="card">
                    <div className="card-title">สรุปสั้น ๆ</div>
                    <ul className="reasons">
                      {summary.short.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  {summary.sections.map((sec, i) => (
                    <SummaryBlock key={i} title={sec.title} items={sec.items} onJump={jump} startOpen={i < 2} />
                  ))}
                </>
              )}

              {tab === 'moves' && (
                <>
                  {cur === -1 && <div className="card muted">กด ▶ หรือแตะตาเดินเพื่อดูคำอธิบายทีละตา</div>}
                  {explanation && (
                    <DeepCard
                      key={cur}
                      title={`ตาที่ ${Math.floor(cur / 2) + 1}${cur % 2 === 0 ? ' (ขาว)' : ' (ดำ)'} ${positions[cur + 1].san}`}
                      exp={explanation}
                    />
                  )}
                  {cur >= 0 && analysis.plies[cur].bestPv.length > 1 && analysis.plies[cur].grade !== 'best' && (
                    <div className="card small">
                      <div className="sub-title">แนวการเดินที่ดีที่สุดจากตำแหน่งก่อนหน้า</div>
                      <div>{pvText(positions[cur].fen, analysis.plies[cur].bestPv, 6)}</div>
                    </div>
                  )}
                  <MoveList sans={positions.slice(1).map((p) => p.san)} grades={grades} current={cur} onSelect={setCur} />
                </>
              )}

              {tab === 'read' && <ReadWholeGame game={game} analysis={analysis} positions={positions} onJump={jump} />}
            </>
          )}

          <div className="controls">
            <button onClick={copyPgn}>{copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก PGN'}</button>
            <button onClick={downloadPgn}>⬇ ดาวน์โหลด PGN</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function explainPly(
  game: SavedGame,
  analysis: GameAnalysis,
  positions: { fen: string; san: string }[],
  i: number,
): DeepExplanation | null {
  const ply = analysis.plies[i];
  const fenBefore = positions[i].fen;
  const bestLine: PvLine = { multipv: 1, depth: 12, score: ply.bestScore, pv: ply.bestPv };
  const next = analysis.plies[i + 1];
  const afterTurn = new Chess(positions[i + 1].fen).turn();
  const afterWhite = next ? next.evalBefore : analysis.finalEval;
  const afterLine: PvLine | undefined = next
    ? { multipv: 1, depth: 12, score: afterTurn === 'w' ? afterWhite : negateScore(afterWhite), pv: next.bestPv }
    : undefined;
  const mover = i % 2 === 0 ? 'w' : 'b';
  const exp = deepExplain({
    fen: fenBefore,
    played: game.moves[i],
    bestLines: ply.bestPv.length ? [bestLine] : [],
    afterLine,
    prev: i > 0 ? { fen: positions[i - 1].fen, uci: game.moves[i - 1] } : undefined,
    neutral: game.playerColor !== mover,
  });
  if (!exp) return null;
  // Use the grade from the full-game analysis so every screen agrees.
  const rest = exp.headline.split(': ').slice(1).join(': ');
  const fine = ply.grade === 'best' || ply.grade === 'good';
  return {
    ...exp,
    grade: ply.grade,
    headline: `${GRADE_ICON[ply.grade]} ${GRADE_LABEL[ply.grade]}: ${rest}`,
    better: fine ? undefined : exp.better,
    sections: fine ? exp.sections.filter((s) => !s.title.startsWith('ถ้าเดิน')) : exp.sections,
  };
}

function SummaryBlock({
  title,
  items,
  onJump,
  startOpen,
}: {
  title: string;
  items: { text: string; ply?: number }[];
  onJump: (ply: number) => void;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const shown = open ? items : items.slice(0, 1);
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <ul className="reasons">
        {shown.map((it, i) => (
          <li
            key={i}
            className={it.ply !== undefined ? 'sum-item jump' : undefined}
            onClick={it.ply !== undefined ? () => onJump(it.ply!) : undefined}
          >
            {it.text}
          </li>
        ))}
      </ul>
      {items.length > 1 && (
        <button className="more-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'ย่อ ▴' : `อ่านเพิ่ม (${items.length - 1}) ▾`}
        </button>
      )}
    </div>
  );
}

function ReadWholeGame({
  game,
  analysis,
  positions,
  onJump,
}: {
  game: SavedGame;
  analysis: GameAnalysis;
  positions: { fen: string; san: string }[];
  onJump: (ply: number) => void;
}) {
  const [openPly, setOpenPly] = useState<number | null>(null);
  return (
    <div className="card">
      <div className="card-title">อ่านเกมทั้งหมดทีละตา</div>
      <div className="muted small">แต่ละตามีคำอธิบายสั้น ๆ กด "อ่านเพิ่ม" เพื่อดูเหตุผลเต็ม การตอบโต้ และแนวการเดินล่วงหน้า</div>
      {game.moves.map((uci, i) => {
        const p = analysis.plies[i];
        const r = tryMove(positions[i].fen, uci);
        if (!r) return null;
        const side = i % 2 === 0 ? 'ขาว' : 'ดำ';
        const isYou = game.playerColor && game.playerColor === (i % 2 === 0 ? 'w' : 'b');
        const prevMove = i > 0 ? tryMove(positions[i - 1].fen, game.moves[i - 1])?.move : undefined;
        let shortText = `${describeMoveFromTo(r.move)} เพื่อ${moveReason(positions[i].fen, uci, prevMove)}`;
        if (p.bestUci && p.bestUci !== uci && p.grade !== 'best' && p.grade !== 'good') {
          const bm = tryMove(positions[i].fen, p.bestUci);
          if (bm) shortText += ` · ควรเดิน ${describeMoveFromTo(bm.move)}`;
        }
        const open = openPly === i;
        const deep = open ? explainPly(game, analysis, positions, i) : null;
        return (
          <div key={i} className="read-ply">
            <div className="read-head">
              <span className="sum-item jump" onClick={() => onJump(i)}>
                {Math.floor(i / 2) + 1}
                {i % 2 === 0 ? '.' : '...'} {positions[i + 1].san} ({side}
                {isYou ? ' · คุณ' : ''})
              </span>
              <span className={`grade-${p.grade}`}>
                {GRADE_ICON[p.grade]} {GRADE_LABEL[p.grade]}
              </span>
            </div>
            <div className="summary-text">{shortText}</div>
            {deep && <Sections sections={deep.sections} />}
            <button className="more-btn" onClick={() => setOpenPly(open ? null : i)}>
              {open ? 'ย่อ ▴' : 'อ่านเพิ่ม ▾'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function negateScore(s: Score): Score {
  return { type: s.type, value: -s.value };
}
