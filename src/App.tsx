import { useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import GameScreen from './screens/GameScreen';
import AnalysisScreen from './screens/AnalysisScreen';
import HistoryScreen from './screens/HistoryScreen';
import type { GameConfig } from './lib/gameConfig';
import { loadGames } from './lib/storage';

type Screen =
  | { name: 'home' }
  | { name: 'game'; config: GameConfig; key: number }
  | { name: 'analysis'; gameId: string; from: 'game' | 'history' }
  | { name: 'history' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  switch (screen.name) {
    case 'home':
      return (
        <HomeScreen
          savedCount={loadGames().length}
          onStart={(config) => setScreen({ name: 'game', config, key: Date.now() })}
          onHistory={() => setScreen({ name: 'history' })}
        />
      );
    case 'game':
      return (
        <GameScreen
          key={screen.key}
          config={screen.config}
          onExit={() => setScreen({ name: 'home' })}
          onRestart={() => setScreen({ name: 'game', config: screen.config, key: Date.now() })}
          onAnalyse={(gameId) => setScreen({ name: 'analysis', gameId, from: 'game' })}
        />
      );
    case 'analysis':
      return (
        <AnalysisScreen
          gameId={screen.gameId}
          onBack={() => setScreen(screen.from === 'history' ? { name: 'history' } : { name: 'home' })}
        />
      );
    case 'history':
      return (
        <HistoryScreen
          onBack={() => setScreen({ name: 'home' })}
          onAnalyse={(gameId) => setScreen({ name: 'analysis', gameId, from: 'history' })}
        />
      );
  }
}
