// The DOM overlay: timer, best time, stars, banners, speed, camera mode.

const el = (id: string) => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e;
};

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}

export class Hud {
  private timer = el('timer');
  private best = el('best');
  private stars = el('stars');
  private starTimer = el('star-timer');
  private banner = el('banner');
  private speed = el('speed');
  private cam = el('cam');
  private level = el('level');
  private help = el('help');
  private root = el('hud');
  private bannerTimeout: ReturnType<typeof setTimeout> | undefined;

  setVisible(visible: boolean) { this.root.classList.toggle('hidden', !visible); }
  setHelpVisible(visible: boolean) { this.help.classList.toggle('hidden', !visible); }
  setLevel(name: string) { this.level.textContent = name; }

  hideBanner() {
    clearTimeout(this.bannerTimeout);
    this.banner.style.opacity = '0';
  }

  showBanner(text: string, sub = '', ms = 0) {
    this.banner.replaceChildren(text);
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      this.banner.append(small);
    }
    this.banner.style.opacity = '1';
    clearTimeout(this.bannerTimeout);
    if (ms) this.bannerTimeout = setTimeout(() => { this.banner.style.opacity = '0'; }, ms);
  }

  setTime(t: number) { this.timer.textContent = formatTime(t); }
  setBest(t: number | null) { this.best.textContent = t ? `Best ${formatTime(t)}` : ''; }
  /** ★ for each star collected this run, ☆ for the rest; hidden on courses without stars. */
  setStars(collected: boolean[]) {
    this.stars.textContent = collected.map((got) => (got ? '★' : '☆')).join('');
    this.stars.hidden = !collected.length;
  }
  /** A switch star's timer: seconds left (0 hides it). */
  setStarTimer(left: number) {
    const text = left > 0 ? `⏱ ${Math.ceil(left)}` : '';
    if (this.starTimer.textContent !== text) this.starTimer.textContent = text;
    this.starTimer.hidden = !text;
    this.starTimer.classList.toggle('hurry', left > 0 && left <= 3);
  }
  popStars() {
    this.stars.classList.remove('pop');
    void this.stars.offsetWidth; // restart the animation
    this.stars.classList.add('pop');
  }
  setSpeed(unitsPerSecond: number) { this.speed.textContent = `${Math.round(unitsPerSecond * 3.6)} km/h`; }
  setCameraMode(mode: string) { this.cam.textContent = `Camera: ${mode} (C)`; }
}
