import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// VITE_PLATFORM picks the build: 'web' (our own site, default), a portal build
// ('crazygames' | 'poki' | 'itch'): relative paths for zip uploads, the portal's SDK, and no
// shop or level editor (portals don't allow outside payments; the editor is for our team),
// or 'solo': single-player only, no server needed (GitHub Pages; keeps the level editor).
const platform = process.env.VITE_PLATFORM ?? 'web';
const solo = platform === 'solo';
const portal = platform !== 'web';

const SDK_SCRIPTS: Record<string, string> = {
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
};

function portalHtml(): Plugin {
  return {
    name: 'pocket-ball-html',
    transformIndexHtml(html) {
      if (!portal) return html;
      if (solo) {
        // No server: drop everything online, and "Solo" is simply "Play".
        return html
          .replace(/^.*data-action="(quick|multiplayer|shop|leaderboard)".*\n/gm, '')
          .replace('<button data-action="play">Solo</button>', '<button class="primary" data-action="play">Play</button>');
      }
      let out = html.replace(/^.*data-action="(shop|editor)".*\n/gm, '');
      const sdk = SDK_SCRIPTS[platform];
      if (sdk) out = out.replace('</head>', `    <script src="${sdk}"></script>\n  </head>`);
      return out;
    },
  };
}

export default defineConfig({
  base: portal ? './' : '/',
  plugins: [portalHtml()],
  build: {
    // Rapier embeds its WebAssembly engine in the JS bundle (~2 MB); see TRACKER.md tech debt.
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      // The game, and (own site only) the level editor, kept out of the game bundle.
      input: {
        game: resolve(import.meta.dirname, 'index.html'),
        ...(portal && !solo ? {} : { editor: resolve(import.meta.dirname, 'editor.html') }),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
