import { LEVELS, levelId } from '../levels';
import { computeFeedback, eventsFromFile, levelVersion, type CourseFeedback, type StoredEvent } from '../meta/feedback';
import { drawCourseMap } from '../render/course-map';

// The course feedback viewer (feedback.html): load exported feedback files and see, per course,
// where players fell and what they marked on the map, with their ratings and comments. The
// numbers come from the same computeFeedback as `npm run analytics`.

const out = document.getElementById('out')!;
const current = document.getElementById('current') as HTMLInputElement;
const byId = new Map(LEVELS.map((l) => [levelId(l), l]));
const versions = new Map(LEVELS.map((l) => [levelId(l), levelVersion(l)]));
const events: StoredEvent[] = [];

async function load(files: FileList | File[]) {
  for (const f of files) {
    try {
      events.push(...eventsFromFile(JSON.parse(await f.text())));
    } catch {
      alert(`${f.name} isn't a feedback file`);
    }
  }
  render();
}

document.getElementById('files')!.addEventListener('change', (e) => void load((e.target as HTMLInputElement).files ?? []));
current.addEventListener('change', render);
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (e.dataTransfer?.files.length) void load(e.dataTransfer.files);
});

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

function bar(name: string, parts: [label: string, share: number, color: string][]) {
  const row = el('div', '', 'bar-row');
  row.append(el('div', name, 'name'));
  const b = el('div', '', 'bar');
  for (const [label, share, color] of parts) {
    if (share <= 0) continue;
    const s = el('span', share >= 0.12 ? `${label} ${Math.round(share * 100)}%` : '');
    s.style.width = `${share * 100}%`;
    s.style.background = color;
    s.title = `${label}: ${Math.round(share * 100)}%`;
    b.append(s);
  }
  row.append(b);
  return row;
}

function card(c: CourseFeedback) {
  const level = byId.get(c.level);
  const box = el('section', '', 'course');
  const left = el('div');
  const right = el('div', '', 'bars');
  left.append(el('h2', level?.name ?? c.level), el('div', `${c.level} · layout ${c.v}${versions.get(c.level) === c.v ? ' (current)' : ' (older layout: the map shows the current one)'}`, 'sub'));
  if (level) {
    const canvas = el('canvas');
    canvas.width = 720;
    canvas.height = 420;
    left.append(canvas);
    const map = drawCourseMap(canvas, level);
    const ctx = canvas.getContext('2d');
    if (map && ctx) {
      // Falls: translucent dots, so the places many players fall glow brighter.
      ctx.fillStyle = 'rgba(230, 57, 70, 0.35)';
      for (const [x, z] of c.falls) {
        const [px, py] = map.toPx(x, z);
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'round';
      for (const [x, z] of c.spots) {
        const [px, py] = map.toPx(x, z);
        for (const [w, color] of [[6, '#ffffff'], [3, '#e63946']] as const) {
          ctx.beginPath();
          ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7);
          ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7);
          ctx.lineWidth = w;
          ctx.strokeStyle = color;
          ctx.stroke();
        }
      }
      // How often each star was found.
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      level.pieces.filter((p) => p.type === 'star').forEach((p, i) => {
        if (c.starRates[i] === undefined) return;
        const [px, py] = map.toPx(p.position[0], p.position[2]);
        ctx.fillStyle = '#ffd166';
        ctx.fillText(`${Math.round(c.starRates[i] * 100)}%`, px, py - 12);
      });
    }
  }

  const stats = el('div', '', 'stats');
  const stat = (label: string, value: string) => { const s = el('span', `${label} `); s.append(el('b', value)); stats.append(s); };
  stat('Ratings', String(c.ratings));
  stat('Fun', c.fun === null ? '–' : `${c.fun}/5`);
  stat('Runs', `${c.runs} (${c.finishedRuns} finished)`);
  stat('Falls/run', String(c.fallsPerRun));
  if (c.worstSection) stat('Most falls', `${c.worstSection.section ? `after checkpoint ${c.worstSection.section}` : 'before checkpoint 1'} (${c.worstSection.fallsPerRun}/run)`);
  const quits = Object.entries(c.quits).map(([why, n]) => `${why} ${n}`).join(', ');
  if (quits) stat('Quit', quits);
  right.append(stats);
  if (c.ratings) {
    right.append(
      bar('Difficulty', [['Too easy', c.difficulty.easy, '#8ecae6'], ['Just right', c.difficulty.right, '#90e0a0'], ['Too hard', c.difficulty.hard, '#ff8c8c']]),
      bar('Length', [['Too short', c.length.short, '#8ecae6'], ['Just right', c.length.right, '#90e0a0'], ['Too long', c.length.long, '#ff8c8c']]),
      bar('Stars', [['Too easy', c.stars.easy, '#8ecae6'], ['Fun to find', c.stars.fun, '#90e0a0'], ['Too hard', c.stars.hard, '#ff8c8c'], ["Didn't notice", c.stars.unnoticed, '#c8c8c8']]),
      bar('Variety', [['Fresh', c.variety.fresh, '#90e0a0'], ['OK', c.variety.ok, '#ffd166'], ['Samey', c.variety.samey, '#ff8c8c']]),
    );
  }
  if (c.sectionTimes.length) right.append(el('div', `Median time per section: ${c.sectionTimes.map((t) => `${t}s`).join(' → ')}`, 'legend'));
  if (c.comments.length) {
    const list = el('ul', '', 'comments');
    for (const text of c.comments.slice(0, 10)) list.append(el('li', `“${text}”`));
    right.append(list);
  }
  box.append(left, right);
  return box;
}

function render() {
  const courses = computeFeedback(events, current.checked ? versions : undefined);
  if (!events.length) return;
  out.replaceChildren(
    el('div', `${events.length} events · ${courses.length} courses · the ones to look at first on top`, 'legend'),
    ...courses.map(card),
  );
  if (!courses.length) out.append(el('div', 'No feedback on the current layouts. Untick "Current layouts only" to see older ones.', 'drop'));
}
