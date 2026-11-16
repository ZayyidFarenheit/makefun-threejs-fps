// Input: keyboard, mouse look, firing, and pointer lock — with a full
// fallback when pointer lock is unavailable (bug §4.1) and a pause screen
// that only appears on a genuine locked→unlocked transition (bug §4.2).
//
// Pointer-lock failure modes handled: a throwing requestPointerLock, a
// rejected lock promise, and the pointerlockerror event. When the lock is
// unavailable the game falls back to free-cursor aiming at the same
// sensitivity (mousemove movementX/Y still fire without a lock in desktop
// browsers), clicks still fire, and the pause screen never appears.

export class Input {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.cb = callbacks; // {onPause, onResume, onLockFailed, onAnyKey}
    this.keys = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.firing = false;
    this.locked = false;
    this.lockFailed = false; // sticky: lock is unavailable, use free cursor
    this.lockWanted = false;
    this.resumeGuardUntil = 0; // ms timestamp: suppress pause re-show
    this.wheelDelta = 0;
    this._pressed = new Set(); // edge-triggered keys, consumed by the sim
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const code = e.code;
      if (!this.keys.has(code)) this._pressed.add(code);
      this.keys.add(code);
      if (code === 'Space') e.preventDefault();
      if (this.cb.onAnyKey) this.cb.onAnyKey();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
    });

    document.addEventListener('mousemove', (e) => {
      // movementX/Y are reported with or without pointer lock.
      if (this.locked || this.lockFailed) {
        this.lookDX += e.movementX || 0;
        this.lookDY += e.movementY || 0;
      }
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // Clicking the canvas when unlocked and lock is wanted re-locks — that
      // click is for the lock, not a shot, so it must not fire the weapon.
      if (!this.locked && !this.lockFailed && this.lockWanted) {
        this.requestLock();
        return;
      }
      this.firing = true;
      if (this.cb.onAnyKey) this.cb.onAnyKey();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.wheelDelta += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (wasLocked && !this.locked) {
        // Genuine locked→unlocked transition. Suppress if we are inside the
        // post-resume guard (Esc auto-repeat re-exiting right after resume)
        // or if the player is dead (spectate never pauses).
        if (performance.now() < this.resumeGuardUntil) return;
        if (this.cb.isDead && this.cb.isDead()) return;
        if (this.cb.onPause) this.cb.onPause();
      }
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      this.locked = false;
      if (this.cb.onLockFailed) this.cb.onLockFailed();
    });
  }

  // Ask for the lock. Returns a promise that resolves true when locked,
  // false when the lock is unavailable (all three failure modes converge).
  async requestLock() {
    this.lockWanted = true;
    if (this.lockFailed) return false;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') {
        await p;
      }
      // Some browsers resolve the promise before pointerlockchange fires;
      // give the event a beat, then read the real state.
      await new Promise((r) => setTimeout(r, 60));
      if (document.pointerLockElement === this.canvas) {
        this.locked = true;
        return true;
      }
      this.lockFailed = true;
      if (this.cb.onLockFailed) this.cb.onLockFailed();
      return false;
    } catch {
      this.lockFailed = true;
      if (this.cb.onLockFailed) this.cb.onLockFailed();
      return false;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Soft re-lock attempt after the buy menu closes: never marks the lock as
  // failed. Chrome enforces a short cooldown after exitPointerLock, so a
  // too-early attempt must not poison lockFailed — the click-to-relock path
  // stays available as the fallback.
  async tryRelock() {
    if (this.lockFailed || this.locked || !this.lockWanted) return this.locked;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') await p;
      await new Promise((r) => setTimeout(r, 60));
      if (document.pointerLockElement === this.canvas) {
        this.locked = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Call after a resume click: suppress pause re-show for ~1 s, re-armed by
  // rapid clicks (each resume click extends the guard).
  armResumeGuard() {
    this.resumeGuardUntil = performance.now() + 1000;
  }

  consumeLook() {
    const dx = this.lookDX, dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  consumeWheel() {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  // Edge-triggered: true once per physical press.
  pressed(code) {
    if (this._pressed.has(code)) {
      this._pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame() {
    this._pressed.clear();
  }

  get down() { return this.keys; }
}
