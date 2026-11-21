// 입력: 모바일(왼쪽 가상 조이스틱 + 오른쪽 끌어서 카메라 돌리기 + 버튼),
// PC(WASD 이동, 마우스 끌기/←→ 카메라, Space 찌르기, Shift 달리기, 1 쪼기, 2 퍼덕).
const STICK_R = 58;
const LOOK_SENS = 0.0058; // rad / px
const KEY_TURN = 2.6; // rad / s

export class Input {
  constructor({ surface, stick, knob, buttons }) {
    this.mx = 0; // 오른쪽
    this.mz = 0; // 앞
    this.yaw = 0; // 카메라 방향 (누적)
    this.pitch = 0.42; // 카메라 내려다보는 각
    this.runToggle = false;
    this.acts = { stab: false, peck: false, flap: false };
    this.keys = new Set();
    this.moveId = null;
    this.lookId = null;
    this.origin = [0, 0];
    this.last = [0, 0];
    this.stick = stick;
    this.knob = knob;
    this.buttons = buttons;
    this.sens = 1;
    this._enabled = false;
    // 터치 기기에서는 손을 떼고 있어도 왼쪽 아래에 흐린 조이스틱을 보여 준다 (어디서 누르든 그 자리에서 시작)
    this.ghost = matchMedia('(pointer: coarse)').matches;
    addEventListener('resize', () => this.placeGhost());

    surface.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, (e) => this.up(e));
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    const press = (btn, fn) =>
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.enabled) fn();
      });
    press(buttons.stab, () => (this.acts.stab = true));
    press(buttons.peck, () => (this.acts.peck = true));
    press(buttons.flap, () => (this.acts.flap = true));
    press(buttons.run, () => this.setRun(!this.runToggle));

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === 'Space' || e.code === 'KeyJ') (this.acts.stab = true), e.preventDefault();
      if (e.code === 'Digit1' || e.code === 'KeyR') this.acts.peck = true;
      if (e.code === 'Digit2' || e.code === 'KeyF') this.acts.flap = true;
      if (e.code === 'CapsLock') this.setRun(!this.runToggle);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v) {
    this._enabled = v;
    this.placeGhost();
  }

  placeGhost() {
    if (this.moveId !== null) return;
    this.knob.style.transform = 'translate(-50%, -50%)';
    const show = this.ghost && this._enabled;
    this.stick.style.display = show ? 'block' : 'none';
    this.stick.classList.toggle('ghost', show);
    if (show) {
      const off = Math.round(Math.min(innerWidth, innerHeight) * 0.2 + 30);
      this.stick.style.left = this.lefty
        ? `min(${innerWidth - off}px, calc(100% - env(safe-area-inset-right, 0px) - 96px))`
        : `max(${off}px, calc(env(safe-area-inset-left, 0px) + 96px))`;
      this.stick.style.top = `${innerHeight - Math.round(Math.min(innerWidth, innerHeight) * 0.2 + 40)}px`;
    }
  }

  setRun(v) {
    this.runToggle = v;
    this.buttons.run.classList.toggle('on', v);
  }

  get running() {
    return this.runToggle || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  down(e) {
    if (!this.enabled) return;
    const touch = e.pointerType !== 'mouse';
    // 관전 중(lookOnly)에는 화면 어디를 끌어도 둘러보기
    const stickSide = this.lefty ? e.clientX > innerWidth * 0.55 : e.clientX < innerWidth * 0.45;
    if (touch && !this.lookOnly && stickSide && this.moveId === null) {
      this.moveId = e.pointerId;
      this.origin = [e.clientX, e.clientY];
      this.stick.style.display = 'block';
      this.stick.classList.remove('ghost');
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.touchMx = this.touchMz = 0;
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.last = [e.clientX, e.clientY];
    }
  }

  move(e) {
    if (e.pointerId === this.moveId) {
      let dx = e.clientX - this.origin[0];
      let dy = e.clientY - this.origin[1];
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        dx *= STICK_R / len;
        dy *= STICK_R / len;
      }
      this.touchMx = dx / STICK_R;
      this.touchMz = -dy / STICK_R;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.lookId) {
      const k = LOOK_SENS * this.sens;
      this.yaw -= (e.clientX - this.last[0]) * k;
      this.pitch = Math.max(0.12, Math.min(1.05, this.pitch + (e.clientY - this.last[1]) * k * 0.7));
      this.last = [e.clientX, e.clientY];
    }
  }

  up(e) {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.touchMx = this.touchMz = 0;
      this.placeGhost();
      if (this.runToggle) this.setRun(false); // 손을 떼면 달리기도 끝
    } else if (e.pointerId === this.lookId) this.lookId = null;
  }

  reset() {
    this.moveId = this.lookId = null;
    this.touchMx = this.touchMz = 0;
    this.placeGhost();
    this.setRun(false);
    for (const k in this.acts) this.acts[k] = false;
  }

  // 프레임마다: 키보드 회전 + 이동 벡터
  update(dt) {
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyQ')) this.yaw += KEY_TURN * dt;
    if (k.has('ArrowRight') || k.has('KeyE')) this.yaw -= KEY_TURN * dt;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.moveId !== null) {
      mx = this.touchMx || 0;
      mz = this.touchMz || 0;
    }
    if (!this.enabled) mx = mz = 0;
    this.mx = mx;
    this.mz = mz;
  }

  // 이번 틱의 동작 하나 (찌르기 > 쪼기 > 퍼덕)
  takeAct() {
    const a = this.acts;
    const out = a.stab ? 1 : a.peck ? 2 : a.flap ? 3 : 0;
    a.stab = a.peck = a.flap = false;
    return out;
  }
}
