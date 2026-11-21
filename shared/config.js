// 게임 규칙과 수치. 서버(권위)와 클라이언트(예측·화면)가 같은 값을 쓴다.
export const CFG = {
  TICK_RATE: 30, // 서버 시뮬레이션 (초당)
  SNAPSHOT_EVERY: 2, // 2틱마다 스냅샷 → 15Hz

  PLAYERS: 8, // 한 판의 플레이어 수 (사람 + 봇)
  AI_COUNT: 42, // AI 닭 수

  ROUND_TIME: 180, // 한 판 (초)
  COUNTDOWN: 3, // 시작 카운트다운
  END_TIME: 8, // 결과 화면 뒤 다음 판까지 (온라인)

  RADIUS: 0.35, // 닭 몸 반지름
  WALK: 2.0, // 걷기 속도 (m/s) — AI 와 사람이 똑같다
  RUN: 4.6, // 달리기 속도 — 플레이어(사람·봇)만 뛸 수 있다. AI 닭은 절대 뛰지 않는다
  ACCEL: 12, // 속도 따라잡기
  TURN: 9, // 회전 속도 (rad/s)
  TURN_ONLY: 0.45, // 조이스틱을 이보다 덜 밀면 제자리에서 돌기만 한다
  DEADZONE: 0.12,

  STAB_RANGE: 1.65, // 칼이 닿는 거리 (몸 중심끼리)
  STAB_ANGLE: 1.0, // 정면 기준 좌우 허용 각 (rad, 약 57도)
  STAB_TIME: 1.0, // 찌르기: 이 시간 동안 제자리에 멈춰 칼을 한 번 찌른다 (움직이지도 돌지도 못한다).
  //                 멈춤이 풀리면 바로 다시 찌를 수 있다 (따로 쿨다운 없음)
  STAB_HIT: 0.2, // 누른 뒤 칼이 쭉 나가는 이 순간에 맞는다 (그 사이에 비켜나면 빗나간다)

  PECK_TIME: 0.7, // 쪼기 동작
  FLAP_TIME: 0.9, // 퍼덕이기 동작

  PENALTY_CD: 2.5, // AI 를 찌른 뒤 칼을 다시 쓸 수 있을 때까지

  // 데스매치: 잡힌 플레이어는 다시 태어나지 않고 관전한다. AI 닭도 잡히면 그대로 줄어든다
  FINISH_DELAY: 1.5, // 플레이어가 한 명만 남으면 이만큼 뒤에 판이 끝난다
  BODY_TIME: 4, // 쓰러진 닭이 남아 있는 시간
  PANIC_RADIUS: 7, // 근처에서 닭이 잡히면 이 안의 AI 닭이 놀라 달아난다
};

// 화면에 보내는 동작 코드 (스냅샷에서 숫자 하나로 보낸다)
// 찌르기 멈춤을 틱(입력) 수로: 서버와 내 닭 예측이 똑같이 센다
export const STAB_TICKS = Math.round(CFG.STAB_TIME * CFG.TICK_RATE);

export const ANIM = { IDLE: 0, WALK: 1, RUN: 2, PECK: 3, FLAP: 4, STAB: 5, DEAD: 6 };

// 손으로 하는 동작 (입력 a 값)
export const ACT = { NONE: 0, STAB: 1, PECK: 2, FLAP: 3 };

export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
