import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

// Builds a portal upload: npm run build:portal -- crazygames|poki|itch
// Needs VITE_SERVER_URL (e.g. wss://game.pocketball.example) so multiplayer finds the server.
const platform = process.argv[2];
if (!['crazygames', 'poki', 'itch'].includes(platform)) {
  console.error('Usage: npm run build:portal -- crazygames|poki|itch');
  process.exit(1);
}
if (!process.env.VITE_SERVER_URL) console.warn('⚠ VITE_SERVER_URL is not set: multiplayer will look for a server on the page\'s own host.');

const outDir = `dist-${platform}`;
rmSync(outDir, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--outDir', outDir], { stdio: 'inherit', env: { ...process.env, VITE_PLATFORM: platform } });
mkdirSync('release', { recursive: true });
const zip = `release/pocket-ball-${platform}.zip`;
rmSync(zip, { force: true });
execFileSync('zip', ['-rq', `../${zip}`, '.'], { cwd: outDir, stdio: 'inherit' });
console.log(`\n✓ ${zip} — upload this to ${platform}.`);
