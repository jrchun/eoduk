// 예약 작업(Cron Trigger). wrangler.toml의 [triggers] crons 시각에 Cloudflare가 worker.js의 scheduled()를 부른다.
// Worker 안에서 바로 D1·Supabase에 닿으므로 GitHub 비밀이나 API 토큰이 필요 없다.
// 새 프로젝트에서는 daily()의 내용을 바꾼다(예: 시세 받기, 알림 만들기).
import { nowIso } from './lib/http.js';

// D1 모드: 하루 한 번 사용 기록 수를 job_log에 남기는 예제.
export async function daily(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_log').first();
  const note = `사용 기록 ${row?.n ?? 0}건`;
  await env.DB.prepare('INSERT INTO job_log (ts, job, note) VALUES (?, ?, ?)').bind(nowIso(), 'daily', note).run();
  return note;
}

// Supabase 모드: 무료 플랜은 7일 동안 요청이 없으면 프로젝트를 멈추므로 하루 한 번 깨운다(공개 키만 쓴다).
export async function supabaseKeepalive(env, fetchFn = fetch) {
  const r = await fetchFn(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/keepalive', {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error('Supabase keepalive 실패: HTTP ' + r.status);
  return 'Supabase 응답 ' + r.status;
}

// 어둑시니: 10분마다 게임 시간을 앞으로 돌린다(밤 침식 틱, 자정 기록, 일요일 시즌 정산).
// DB 함수 tick()은 시간이 된 일만 하므로 여러 번 불러도 안전하다. 요청이 오가니 잠들기 방지도 겸한다.
export async function supabaseTick(env, fetchFn = fetch) {
  const r = await fetchFn(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/tick', {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error('게임 시간 진행(tick) 실패: HTTP ' + r.status);
  const j = await r.json().catch(() => null);
  return j ? `게임 시간 ${j.tick_date} 침식 ${j.tick_done}/8` : 'tick 응답 ' + r.status;
}

export async function runScheduled(env, fetchFn = fetch) {
  const done = [];
  if (env.DB) done.push(await daily(env));
  if (env.SUPABASE_URL && env.SUPABASE_KEY) done.push(await supabaseTick(env, fetchFn));
  return done.join(', ') || '할 일 없음';
}
