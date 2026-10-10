import type { LevelData } from '../levels/schema';
import { MAX_COMMENT, type Ratings, type RunLog } from '../meta/feedback';
import { drawCourseMap, type MapTransform } from '../render/course-map';

// The course feedback form (index.html #feedback): one tap per question, a map to mark the most
// frustrating spot (this run's falls shown as red dots), and in playtest mode a comment.

type Choice = [value: string | number, label: string, title?: string];
interface Question { key: keyof Ratings; label: string; choices: Choice[]; emoji?: boolean }

const RATE: Question[] = [
  { key: 'fun', label: 'How fun was it?', emoji: true, choices: [[1, '😴', 'Not fun'], [2, '🙂', 'A bit'], [3, '😀', 'Fun'], [4, '😄', 'Really fun'], [5, '🤩', 'Loved it']] },
  { key: 'difficulty', label: 'Difficulty', choices: [['easy', 'Too easy'], ['right', 'Just right'], ['hard', 'Too hard']] },
  { key: 'length', label: 'Length', choices: [['short', 'Too short'], ['right', 'Just right'], ['long', 'Too long']] },
  { key: 'stars', label: 'The stars were…', choices: [['easy', 'Too easy'], ['fun', 'Fun to find'], ['hard', 'Too hard'], ['unnoticed', "Didn't notice"]] },
  { key: 'variety', label: 'Variety', choices: [['fresh', 'Felt fresh'], ['ok', 'OK'], ['samey', 'Samey']] },
];
const QUIT: Question[] = [
  { key: 'quit', label: 'Why did you stop?', choices: [['hard', 'Too hard'], ['long', 'Too long'], ['boring', 'Boring'], ['lost', 'Lost / confused'], ['other', 'Something else']] },
];

export class FeedbackForm {
  private answers: Ratings = {};
  private map: MapTransform | null = null;
  private level: LevelData | null = null;
  private run: RunLog | null = null;
  private readonly questions = document.getElementById('fb-questions')!;
  private readonly canvas = document.getElementById('fb-map') as HTMLCanvasElement;
  private readonly comment = document.getElementById('fb-comment') as HTMLInputElement;

  constructor() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.map) return;
      const box = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * this.canvas.width;
      const py = ((e.clientY - box.top) / box.height) * this.canvas.height;
      const [x, z] = this.map.toWorld(px, py);
      this.answers.spot = [Math.round(x), Math.round(z)];
      this.draw();
    });
  }

  /** Sets the form up for `level`: ratings after a run, or `quit` for why they stopped. */
  open(level: LevelData, run: RunLog, { quit = false, comment = false } = {}) {
    this.level = level;
    this.run = run;
    this.answers = {};
    document.getElementById('fb-title')!.textContent = quit ? `Leaving ${level.name}` : `How was ${level.name}?`;
    const hasStars = level.pieces.some((p) => p.type === 'star');
    this.questions.replaceChildren(...(quit ? QUIT : RATE).filter((q) => q.key !== 'stars' || hasStars).map((q) => this.question(q)));
    this.comment.value = '';
    this.comment.hidden = !comment;
    document.getElementById('fb-note')!.textContent = run.falls.length ? `Red dots: where you fell this run (${run.falls.length}).` : '';
    this.draw();
  }

  /** The answers so far (questions left blank are left out). */
  read(): Ratings {
    const text = this.comment.hidden ? '' : this.comment.value.trim().slice(0, MAX_COMMENT);
    return { ...this.answers, ...(text ? { comment: text } : {}) };
  }

  private question(q: Question): HTMLElement {
    const box = document.createElement('div');
    box.className = 'fb-q';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = q.label;
    const row = document.createElement('div');
    row.className = q.emoji ? 'answers emoji' : 'answers';
    for (const [value, text, title] of q.choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (title) b.title = b.ariaLabel = title;
      b.setAttribute('aria-pressed', 'false');
      b.dataset.answer = `${q.key}:${value}`;
      b.addEventListener('click', () => {
        const again = (this.answers as Record<string, unknown>)[q.key] === value;
        (this.answers as Record<string, unknown>)[q.key] = again ? undefined : value; // tap again to clear
        for (const other of row.children) other.setAttribute('aria-pressed', String(!again && other === b));
      });
      row.append(b);
    }
    box.append(label, row);
    return box;
  }

  private draw() {
    if (!this.level) return;
    this.map = drawCourseMap(this.canvas, this.level);
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.map) return;
    for (const [x, z] of this.run?.falls ?? []) {
      const [px, py] = this.map.toPx(x, z);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230, 57, 70, 0.8)';
      ctx.fill();
    }
    if (this.answers.spot) {
      const [px, py] = this.map.toPx(...this.answers.spot);
      ctx.lineCap = 'round';
      for (const [w, color] of [[7, '#ffffff'], [4, '#e63946']] as const) {
        ctx.beginPath();
        ctx.moveTo(px - 8, py - 8); ctx.lineTo(px + 8, py + 8);
        ctx.moveTo(px + 8, py - 8); ctx.lineTo(px - 8, py + 8);
        ctx.lineWidth = w;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
  }
}
