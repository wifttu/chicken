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
  RUN: 4.6, // 달리기 속도
  ACCEL: 12, // 속도 따라잡기
  TURN: 9, // 회전 속도 (rad/s)
  TURN_ONLY: 0.45, // 조이스틱을 이보다 덜 밀면 제자리에서 돌기만 한다
  DEADZONE: 0.12,

  STAB_RANGE: 1.65, // 칼이 닿는 거리 (몸 중심끼리)
  STAB_ANGLE: 1.0, // 정면 기준 좌우 허용 각 (rad, 약 57도)
  STAB_CD: 0.8, // 찌르기 쿨다운
  STAB_TIME: 0.35, // 찌르기 동작 시간

  PECK_TIME: 0.7, // 쪼기 동작
  FLAP_TIME: 0.9, // 퍼덕이기 동작

  AI_PENALTY: 1, // AI 를 찌르면 잃는 점수
  EXPOSE_TIME: 4, // AI 를 찌르면 머리 위에 ❗ 가 뜨는 시간
  PENALTY_CD: 2.5, // AI 를 찌른 뒤 칼을 다시 쓸 수 있을 때까지

  RESPAWN: 3, // 잡힌 뒤 다시 태어날 때까지
  BODY_TIME: 4, // 쓰러진 닭이 남아 있는 시간
  PANIC_RADIUS: 7, // 근처에서 닭이 잡히면 이 안의 AI 닭이 놀라 달아난다
};

// 화면에 보내는 동작 코드 (스냅샷에서 숫자 하나로 보낸다)
export const ANIM = { IDLE: 0, WALK: 1, RUN: 2, PECK: 3, FLAP: 4, STAB: 5, DEAD: 6 };
export const EXPOSED_BIT = 8;

// 손으로 하는 동작 (입력 a 값)
export const ACT = { NONE: 0, STAB: 1, PECK: 2, FLAP: 3 };

export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
