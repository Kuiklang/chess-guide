import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works both on GitHub Pages (/chess-guide/) and locally.
export default defineConfig({
  base: './',
  plugins: [react()],
});
