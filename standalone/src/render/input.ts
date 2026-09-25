import { VIEW } from '../config';
import type { Input } from '../sim/simulation';
import type { CameraRig } from './camera';
import { unlockAudio } from './audio';

// All player input: keyboard, mouse, gamepad (standard mapping), and touch.
// Movement becomes a world-space push relative to the camera; analog sticks keep their magnitude.

export type InputMode = 'game' | 'menu' | 'none';

export interface InputActions {
  restart(): void;
  backToCheckpoint(): void;
  toggleCamera(): void;
  pause(): void;
  // Menu navigation (gamepad)
  menuMove(delta: number): void;
  menuAdjust(delta: number): void;
  menuActivate(): void;
  menuBack(): void;
}

// Standard gamepad button indices.
const BTN = { A: 0, B: 1, X: 2, Y: 3, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
const DEADZONE = 0.18;
const STICK_RADIUS = 60; // px, touch joystick

function deadzone(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (m - DEADZONE) / (1 - DEADZONE));
  return [(x / m) * scaled, (y / m) * scaled];
}

export class Controls {
  private keys = new Set<string>();
  private padButtons: boolean[] = [];
  private padMove: [number, number] = [0, 0];
  private padLook = 0;
  private menuRepeat = { dir: 0, next: 0 };
  private touchMove: [number, number] = [0, 0];
  private stickPointer: number | null = null;
  private stickOrigin = [0, 0];
  private stick = document.getElementById('stick')!;
  private knob = document.getElementById('stick-knob')!;

  constructor(
    canvas: HTMLCanvasElement,
    private rig: CameraRig,
    private actions: InputActions,
    private mode: () => InputMode,
    private sensitivity: () => number,
  ) {
    window.addEventListener('keydown', (e) => {
      unlockAudio();
      this.keys.add(e.code);
      if (this.mode() !== 'game') return;
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Backspace') e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyR') actions.restart();
      if (e.code === 'Backspace') actions.backToCheckpoint();
      if (e.code === 'KeyC') actions.toggleCamera();
      if (e.code === 'Escape' || e.code === 'KeyP') actions.pause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Mouse: drag anywhere to orbit. Touch: left half = joystick, right half = orbit.
    let dragPointer: number | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      unlockAudio();
      if (e.pointerType === 'touch') document.body.classList.add('touch');
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch' && e.clientX < window.innerWidth / 2 && this.stickPointer === null) {
        this.stickPointer = e.pointerId;
        this.stickOrigin = [e.clientX, e.clientY];
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.stick.style.display = 'block';
        this.setKnob(0, 0);
      } else {
        dragPointer = e.pointerId;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) {
        let dx = e.clientX - this.stickOrigin[0], dy = e.clientY - this.stickOrigin[1];
        const m = Math.hypot(dx, dy);
        if (m > STICK_RADIUS) { dx *= STICK_RADIUS / m; dy *= STICK_RADIUS / m; }
        this.setKnob(dx, dy);
        this.touchMove = deadzone(dx / STICK_RADIUS, dy / STICK_RADIUS);
      } else if (e.pointerId === dragPointer && this.mode() === 'game') {
        const touchBoost = e.pointerType === 'touch' ? 1.5 : 1;
        rig.rotate(-e.movementX * VIEW.camera.dragSpeed * this.sensitivity() * touchBoost);
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.stickPointer) {
        this.stickPointer = null;
        this.touchMove = [0, 0];
        this.stick.style.display = 'none';
      }
      if (e.pointerId === dragPointer) dragPointer = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    document.getElementById('pause-btn')!.addEventListener('click', () => actions.pause());
  }

  private setKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Reads the gamepad and fires button actions. Call once per frame. */
  poll(now: number) {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected) ?? null;
    if (!pad) {
      this.padMove = [0, 0];
      this.padLook = 0;
      return;
    }
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.padButtons[i];
    const [lx, ly] = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const [rx] = deadzone(pad.axes[2] ?? 0, 0);
    if (pressed.some(Boolean)) unlockAudio();

    const mode = this.mode();
    if (mode === 'game') {
      this.padMove = [lx, ly];
      this.padLook = rx;
      if (edge(BTN.START)) this.actions.pause();
      if (edge(BTN.Y)) this.actions.restart();
      if (edge(BTN.X)) this.actions.backToCheckpoint();
      if (edge(BTN.BACK)) this.actions.toggleCamera();
    } else {
      this.padMove = [0, 0];
      this.padLook = 0;
      if (mode === 'menu') {
        if (edge(BTN.A)) this.actions.menuActivate();
        if (edge(BTN.B) || edge(BTN.START)) this.actions.menuBack();
        // D-pad / stick with key-repeat style timing.
        const vert = pressed[BTN.DOWN] || ly > 0.6 ? 1 : pressed[BTN.UP] || ly < -0.6 ? -1 : 0;
        const horiz = pressed[BTN.RIGHT] || lx > 0.6 ? 1 : pressed[BTN.LEFT] || lx < -0.6 ? -1 : 0;
        const dir = vert ? vert * 2 : horiz; // encode: ±2 vertical, ±1 horizontal
        if (dir === 0) this.menuRepeat.dir = 0;
        else if (dir !== this.menuRepeat.dir || now >= this.menuRepeat.next) {
          const first = dir !== this.menuRepeat.dir;
          this.menuRepeat = { dir, next: now + (first ? 350 : 120) };
          if (Math.abs(dir) === 2) this.actions.menuMove(Math.sign(dir));
          else this.actions.menuAdjust(dir);
        }
      }
    }
    this.padButtons = pressed;
  }

  /** Q/E and right-stick camera rotation; call once per frame. */
  updateCamera(dt: number) {
    if (this.mode() !== 'game') return;
    const speed = VIEW.camera.rotateSpeed * this.sensitivity() * dt;
    if (this.down('KeyQ')) this.rig.rotate(speed);
    if (this.down('KeyE')) this.rig.rotate(-speed);
    if (this.padLook) this.rig.rotate(-this.padLook * speed);
  }

  /** Current push, rotated so "up" means "away from the camera". */
  move(): Input {
    if (this.mode() !== 'game') return { x: 0, z: 0 };
    let fx = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let fz = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    const km = Math.hypot(fx, fz);
    if (km > 0) {
      fx /= km;
      fz /= km;
    } else if (this.padMove[0] || this.padMove[1]) {
      [fx, fz] = this.padMove;
    } else {
      [fx, fz] = this.touchMove;
    }
    if (fx === 0 && fz === 0) return { x: 0, z: 0 };
    const c = Math.cos(this.rig.yaw), s = Math.sin(this.rig.yaw);
    return { x: fx * c + fz * s, z: -fx * s + fz * c };
  }
}
