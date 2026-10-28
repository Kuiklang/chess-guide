import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, DEFAULT_POSITION, type Square } from 'chess.js';
import Board, { type Arrow } from '../components/Board';
import { engine, isCancelled, type PvLine } from '../lib/engine';
import {
  COLOR_NAME,
  describeAdvantage,
  describeMoveFromTo,
  formatScore,
  gameResultText,
  parseUci,
  pgnResult,
  toWhite,
  tryMove,
} from '../lib/chessUtil';
import { describeOpponentMove, explainMove, intentPhrase, type Explanation } from '../lib/explain';
import { BOT_LEVELS, type GameConfig } from '../lib/gameConfig';
import { MODE_NAME, newGameId, saveGame } from '../lib/storage';
import ExplanationCard from '../components/ExplanationCard';
import MoveList from '../components/MoveList';

interface Ply {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
}

interface Ending {
  result: string;
  text: string;
}

interface Props {
  config: GameConfig;
  onExit: () => void;
  onAnalyse: (gameId: string) => void;
  onRestart: () => void;
}

const SUGGEST_OPTS = { multipv: 3, depth: 14, movetime: 2500 };
const AFTER_OPTS = { multipv: 1, depth: 12, movetime: 1200 };

export default function GameScreen({ config, onExit, onAnalyse, onRestart }: Props) {
  const { mode, playerColor } = config;
  const [plies, setPlies] = useState<Ply[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showEndMenu, setShowEndMenu] = useState(false);
  const [orientation, setOrientation] = useState<'w' | 'b'>(mode === 'pvp' ? 'w' : playerColor);
  const [lines, setLines] = useState<{ fen: string; lines: PvLine[] } | null>(null);
  const [explanations, setExplanations] = useState<Record<string, Explanation>>({});
  const [hintFen, setHintFen] = useState<string | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const gameId = useRef(newGameId());
  const cache = useRef(new Map<string, Promise<PvLine[]>>());
  const mounted = useRef(true);

  const fen = plies.length ? plies[plies.length - 1].fenAfter : DEFAULT_POSITION;
  const game = useMemo(() => new Chess(fen), [fen]);
  const turn = game.turn();
  const lastPly = plies[plies.length - 1];
  const lastMove = lastPly ? { from: lastPly.uci.slice(0, 2) as Square, to: lastPly.uci.slice(2, 4) as Square } : null;

  useEffect(() => {
    mounted.current = true;
    engine.warmUp();
    return () => {
      mounted.current = false;
      engine.cancelAll();
    };
  }, []);

  /** Engine lines for a position, shared between callers and cached. */
  const getLines = useCallback((f: string, opts: { multipv: number; depth: number; movetime: number }) => {
    const deep = cache.current.get(f + '|3');
    if (deep) return deep;
    const key = `${f}|${opts.multipv}`;
    let p = cache.current.get(key);
    if (!p) {
      p = engine.search(f, opts).then((r) => r.lines);
      p.catch(() => cache.current.delete(key));
      cache.current.set(key, p);
    }
    return p;
  }, []);

  const handleEngineError = (e: unknown) => {
    if (!isCancelled(e) && mounted.current) setEngineError(true);
  };

  // ---- Applying moves ----

  const finish = useCallback(
    (allPlies: Ply[], end: Ending) => {
      setEnding(end);
      setShowResult(true);
      saveGame({
        id: gameId.current,
        date: new Date().toISOString(),
        mode,
        playerColor: mode === 'pvp' ? undefined : playerColor,
        botLevel: mode === 'bot' ? config.botLevel : undefined,
        moves: allPlies.map((p) => p.uci),
        result: end.result,
        resultText: end.text,
      });
    },
    [mode, playerColor, config.botLevel],
  );

  const playMove = useCallback(
    (uci: string) => {
      if (ending) return;
      const r = tryMove(fen, uci);
      if (!r) return;
      const ply: Ply = { uci, san: r.move.san, fenBefore: fen, fenAfter: r.after.fen() };
      const next = [...plies, ply];
      setPlies(next);
      setHintFen(null);
      const text = gameResultText(r.after);
      if (text) finish(next, { result: pgnResult(r.after) ?? '*', text });
    },
    [ending, fen, plies, finish],
  );

  // ---- Bot moves ----
  useEffect(() => {
    if (mode !== 'bot' || ending || turn === playerColor) return;
    const level = BOT_LEVELS[config.botLevel - 1] ?? BOT_LEVELS[2];
    let active = true;
    setBotThinking(true);
    const started = Date.now();
    engine
      .search(fen, { skill: level.skill, depth: level.depth, movetime: level.movetime, multipv: 1 })
      .then((res) => {
        if (!active || !res.bestmove) return;
        const wait = Math.max(0, 500 - (Date.now() - started));
        setTimeout(() => {
          if (active && mounted.current) playMove(res.bestmove!);
        }, wait);
      })
      .catch(handleEngineError)
      .finally(() => {
        if (active && mounted.current) setBotThinking(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, mode, ending]);

  // ---- Guide: suggestions on the user's turn ----
  useEffect(() => {
    if (mode !== 'guide' || ending || turn !== playerColor) return;
    let active = true;
    getLines(fen, SUGGEST_OPTS)
      .then((l) => active && mounted.current && setLines({ fen, lines: l }))
      .catch(handleEngineError);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, mode, ending]);

  // ---- Guide: explain the user's move once it is played ----
  useEffect(() => {
    if (mode !== 'guide' || !lastPly) return;
    const moverColor = new Chess(lastPly.fenBefore).turn();
    if (moverColor !== playerColor) return;
    const key = lastPly.fenBefore + lastPly.uci;
    if (explanations[key]) return;
    const ply = lastPly;
    (async () => {
      const bestLines = await getLines(ply.fenBefore, SUGGEST_OPTS);
      const afterGame = new Chess(ply.fenAfter);
      const afterLines = afterGame.isGameOver() ? [] : await getLines(ply.fenAfter, AFTER_OPTS);
      const exp = explainMove({ fen: ply.fenBefore, played: ply.uci, bestLines, afterLine: afterLines[0] });
      if (exp && mounted.current) setExplanations((prev) => ({ ...prev, [key]: exp }));
    })().catch(handleEngineError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPly, mode]);

  // ---- Bot mode hint ----
  useEffect(() => {
    if (!hintFen || hintFen !== fen) return;
    let active = true;
    getLines(fen, SUGGEST_OPTS)
      .then((l) => active && mounted.current && setLines({ fen, lines: l }))
      .catch(handleEngineError);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintFen, fen]);

  // ---- Controls ----

  const undo = () => {
    if (plies.length === 0) return;
    engine.cancelAll();
    cache.current.clear();
    let next = plies.slice(0, -1);
    if (mode === 'bot') {
      // Go back to the user's turn.
      while (next.length && new Chess(next[next.length - 1].fenAfter).turn() !== playerColor) next = next.slice(0, -1);
      if (next.length === 0 && playerColor === 'b') next = plies.slice(0, 1);
    }
    setPlies(next);
    setEnding(null);
    setShowResult(false);
    setHintFen(null);
    setBotThinking(false);
  };

  const endManually = (result: string, text: string) => {
    setShowEndMenu(false);
    finish(plies, { result, text });
  };

  const exit = () => {
    if (!ending && plies.length >= 4) {
      saveGame({
        id: gameId.current,
        date: new Date().toISOString(),
        mode,
        playerColor: mode === 'pvp' ? undefined : playerColor,
        botLevel: mode === 'bot' ? config.botLevel : undefined,
        moves: plies.map((p) => p.uci),
        result: '*',
        resultText: 'ยังเล่นไม่จบ',
      });
    }
    onExit();
  };

  // ---- What the board accepts ----
  let movable: 'w' | 'b' | 'both' | 'none' = 'both';
  if (ending) movable = 'none';
  else if (mode === 'bot') movable = turn === playerColor && !botThinking ? playerColor : 'none';

  const currentLines = lines && lines.fen === fen ? lines.lines : null;

  const arrows: Arrow[] = [];
  const showSuggestions = mode === 'guide' && !ending && turn === playerColor;
  const showHint = mode === 'bot' && hintFen === fen && !ending;
  if ((showSuggestions || showHint) && currentLines) {
    const shown = showHint ? currentLines.slice(0, 1) : currentLines;
    shown.forEach((l, i) => {
      const { from, to } = parseUci(l.pv[0]);
      arrows.push({
        from,
        to,
        color: i === 0 ? '#22a35a' : i === 1 ? '#3d7bd9' : '#d98a2b',
        label: showHint ? undefined : String(i + 1),
        width: i === 0 ? 2.6 : 2,
        opacity: i === 0 ? 0.9 : 0.65,
      });
    });
  }

  // ---- Side panel content ----
  const playerName = COLOR_NAME[playerColor];
  let status: string;
  if (ending) status = ending.text;
  else if (mode === 'pvp') status = `ตา${COLOR_NAME[turn]}เดิน`;
  else if (mode === 'bot') status = turn === playerColor ? `ตาของคุณ (${playerName})` : 'บอทกำลังคิด...';
  else status = turn === playerColor ? `ตาของคุณ (${playerName})` : `เดินหมากของฝ่ายตรงข้ามตามกระดานจริง`;

  const userExplanation =
    mode === 'guide' && lastPly && new Chess(lastPly.fenBefore).turn() === playerColor
      ? explanations[lastPly.fenBefore + lastPly.uci]
      : undefined;
  const awaitingExplanation =
    mode === 'guide' && lastPly && new Chess(lastPly.fenBefore).turn() === playerColor && !userExplanation;

  const opponentWarnings =
    mode === 'guide' && lastPly && turn === playerColor
      ? describeOpponentMove(lastPly.fenBefore, lastPly.uci, currentLines?.[0])
      : [];

  // Explanation of the user's previous move stays visible (collapsed) on their next turn.
  const prevUserPly = mode === 'guide' && turn === playerColor && plies.length >= 2 ? plies[plies.length - 2] : undefined;
  const prevExplanation = prevUserPly ? explanations[prevUserPly.fenBefore + prevUserPly.uci] : undefined;

  return (
    <div className="game-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={exit} aria-label="กลับหน้าหลัก">
          ←
        </button>
        <div className="topbar-title">
          {MODE_NAME[mode]}
          {mode === 'bot' && <span className="sub"> · ระดับ{BOT_LEVELS[config.botLevel - 1]?.name}</span>}
        </div>
        <button className="icon-btn" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))} aria-label="หมุนกระดาน">
          ⟲
        </button>
      </header>

      <div className="game-layout">
        <div className="board-col">
          <Board fen={fen} orientation={orientation} movable={movable} onMove={playMove} lastMove={lastMove} arrows={arrows} />
          <div className="controls">
            <button onClick={undo} disabled={plies.length === 0}>
              ↶ ย้อนกลับ
            </button>
            {mode === 'bot' && !ending && (
              <button onClick={() => setHintFen(fen)} disabled={turn !== playerColor || botThinking}>
                💡 ขอคำใบ้
              </button>
            )}
            {!ending ? (
              <button onClick={() => setShowEndMenu(true)}>🏳 จบเกม</button>
            ) : (
              <button className="primary" onClick={() => onAnalyse(gameId.current)}>
                📊 วิเคราะห์เกม
              </button>
            )}
          </div>
        </div>

        <div className="panel-col">
          <div className={'status' + (game.isCheck() && !ending ? ' check' : '')}>
            {status}
            {game.isCheck() && !ending && <span className="badge">รุก!</span>}
          </div>

          {engineError && <div className="card warn">โหลดตัวคิด (Stockfish) ไม่สำเร็จ ลองรีเฟรชหน้าเว็บ</div>}

          {mode === 'guide' && !ending && (
            <>
              {userExplanation && <ExplanationCard title="คำอธิบายตาที่คุณเดิน" exp={userExplanation} />}
              {awaitingExplanation && <div className="card muted">กำลังวิเคราะห์ตาที่คุณเดิน...</div>}

              {turn === playerColor && (
                <>
                  {lastPly && (
                    <div className="card">
                      <div className="card-title">ฝ่ายตรงข้ามเดิน: {describeMoveFromTo(tryMove(lastPly.fenBefore, lastPly.uci)!.move)}</div>
                      {opponentWarnings.length > 0 ? (
                        <ul className="reasons warn-list">
                          {opponentWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="muted small">ไม่มีภัยคุกคามที่ชัดเจน</div>
                      )}
                    </div>
                  )}
                  <Suggestions fen={fen} lines={currentLines} onPick={playMove} />
                  {prevExplanation && (
                    <details className="card collapsed">
                      <summary>คำอธิบายตาก่อนหน้าของคุณ</summary>
                      <ExplanationCard exp={prevExplanation} bare />
                    </details>
                  )}
                </>
              )}
            </>
          )}

          {showHint && (
            <div className="card hint-card">
              <div className="card-title">💡 คำใบ้</div>
              {currentLines?.[0] ? (
                <>
                  <div className="suggest-move">{describeMoveFromTo(tryMove(fen, currentLines[0].pv[0])!.move)}</div>
                  <div>เพื่อ{intentPhrase(fen, currentLines[0])}</div>
                  <div className="muted small">{describeAdvantage(toWhite(currentLines[0].score, turn))}</div>
                </>
              ) : (
                <div className="muted">กำลังคิด...</div>
              )}
            </div>
          )}

          <MoveList sans={plies.map((p) => p.san)} />
        </div>
      </div>

      {showEndMenu && (
        <div className="modal-bg" onClick={() => setShowEndMenu(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>จบเกม</h3>
            {mode === 'bot' && (
              <button onClick={() => endManually(playerColor === 'w' ? '0-1' : '1-0', 'คุณยอมแพ้ บอทชนะ')}>ยอมแพ้</button>
            )}
            {mode === 'pvp' && (
              <>
                <button onClick={() => endManually('0-1', 'ฝ่ายขาวยอมแพ้ ฝ่ายดำชนะ')}>ฝ่ายขาวยอมแพ้</button>
                <button onClick={() => endManually('1-0', 'ฝ่ายดำยอมแพ้ ฝ่ายขาวชนะ')}>ฝ่ายดำยอมแพ้</button>
                <button onClick={() => endManually('1/2-1/2', 'ตกลงเสมอ')}>ตกลงเสมอ</button>
              </>
            )}
            {mode === 'guide' && (
              <>
                <button onClick={() => endManually(playerColor === 'w' ? '1-0' : '0-1', 'คุณชนะ')}>ฉันชนะ</button>
                <button onClick={() => endManually(playerColor === 'w' ? '0-1' : '1-0', 'คุณแพ้')}>ฉันแพ้</button>
                <button onClick={() => endManually('1/2-1/2', 'เสมอ')}>เสมอ</button>
              </>
            )}
            <button className="link" onClick={() => setShowEndMenu(false)}>
              เล่นต่อ
            </button>
          </div>
        </div>
      )}

      {ending && showResult && (
        <div className="modal-bg" onClick={() => setShowResult(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>เกมจบแล้ว</h3>
            <p className="result-text">{ending.text}</p>
            <button className="primary" onClick={() => onAnalyse(gameId.current)}>
              📊 วิเคราะห์เกม
            </button>
            <button onClick={onRestart}>เล่นใหม่</button>
            <button onClick={onExit}>กลับหน้าหลัก</button>
            <button className="link" onClick={() => setShowResult(false)}>
              ดูกระดาน
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Suggestions({ fen, lines, onPick }: { fen: string; lines: PvLine[] | null; onPick: (uci: string) => void }) {
  if (!lines) return <div className="card muted">กำลังหาตาเดินที่ดีที่สุด...</div>;
  if (lines.length === 0) return null;
  const turn = new Chess(fen).turn();
  return (
    <div className="card">
      <div className="card-title">ทางเลือกสำหรับคุณ</div>
      <ol className="suggestions">
        {lines.map((l, i) => {
          const m = tryMove(fen, l.pv[0]);
          if (!m) return null;
          return (
            <li key={l.pv[0]} className={i === 0 ? 'best' : ''} onClick={() => onPick(l.pv[0])}>
              <span className={'num n' + (i + 1)}>{i === 0 ? '⭐' : i + 1}</span>
              <div className="suggest-body">
                <div className="suggest-move">
                  {describeMoveFromTo(m.move)}
                  {i === 0 && <span className="tag">ดีที่สุด</span>}
                </div>
                <div className="suggest-why">เพื่อ{intentPhrase(fen, l)}</div>
              </div>
              <span className="score">{formatScore(toWhite(l.score, turn))}</span>
            </li>
          );
        })}
      </ol>
      <div className="muted small">แตะทางเลือกเพื่อเดินตานั้น หรือเดินเองบนกระดาน</div>
    </div>
  );
}
