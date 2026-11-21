// 닭 이동. 서버(권위)와 클라이언트(내 닭 예측)가 같은 코드를 실행한다.
// AI 닭과 플레이어가 똑같은 함수로 움직이므로 걸음걸이만으로는 구별할 수 없다.
import { CFG, wrapAngle } from './config.js';
import { pushOut } from './map.js';

// c: {x,z,yaw,vx,vz}
// inp: {dx,dz} 월드 방향(길이 0..1), run, face(제자리에서 바라볼 방향, 선택), stop(찌르는 중: 그 자리에 딱 멈춘다)
export function stepChicken(c, inp, dt) {
  if (inp.stop) {
    c.vx = c.vz = 0;
    return;
  }
  let dx = inp.dx || 0;
  let dz = inp.dz || 0;
  let mag = Math.hypot(dx, dz);
  if (mag > 1) {
    dx /= mag;
    dz /= mag;
    mag = 1;
  }
  let face = inp.face;
  let tvx = 0;
  let tvz = 0;
  if (mag >= CFG.TURN_ONLY) {
    // 조금이라도 걸으면 항상 같은 속도 (AI 와 같다)
    const sp = inp.run ? CFG.RUN : CFG.WALK;
    tvx = (dx / mag) * sp;
    tvz = (dz / mag) * sp;
    face = Math.atan2(dx, dz);
  } else if (mag >= CFG.DEADZONE) {
    face = Math.atan2(dx, dz); // 살짝만 밀면 제자리에서 돌아본다
  }
  const k = Math.min(1, CFG.ACCEL * dt);
  c.vx += (tvx - c.vx) * k;
  c.vz += (tvz - c.vz) * k;
  if (Math.abs(c.vx) < 1e-3) c.vx = 0;
  if (Math.abs(c.vz) < 1e-3) c.vz = 0;
  const ox = c.x;
  const oz = c.z;
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  if (pushOut(c)) {
    // 벽에 막힌 만큼 속도도 줄인다 (벽에 붙어 미끄러지기)
    c.vx = (c.x - ox) / dt;
    c.vz = (c.z - oz) / dt;
  }
  if (face !== undefined && face !== null) {
    const d = wrapAngle(face - c.yaw);
    const m = CFG.TURN * dt;
    c.yaw = wrapAngle(c.yaw + Math.max(-m, Math.min(m, d)));
  }
}

export const speedOf = (c) => Math.hypot(c.vx, c.vz);
