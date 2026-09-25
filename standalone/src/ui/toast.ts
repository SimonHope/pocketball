// A short message at the top of the screen.

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, ms = 0) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(timer);
  if (ms) timer = setTimeout(() => el.classList.remove('show'), ms);
}
