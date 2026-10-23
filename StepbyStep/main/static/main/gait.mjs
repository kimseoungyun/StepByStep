// Pixel coordinates prevent aspect-ratio distortion of 2D angles.
export const VERSION = '2d-descriptive-1';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const round = n => Math.round(n * 10) / 10;

export function quantile(values, p) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * p, lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}

export function angle(a, b, c) {
  const u = [a.x - b.x, a.y - b.y], v = [c.x - b.x, c.y - b.y];
  const length = Math.hypot(...u) * Math.hypot(...v);
  if (length < 1e-8) return null;
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / length))) * 180 / Math.PI;
}

export function measure(landmarks, width, height, t) {
  const row = { t, valid: false };
  if (!Number.isFinite(t) || !(width > 0 && height > 0) || landmarks?.length !== 33) return row;
  const get = i => {
    const p = landmarks[i];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && p.visibility >= 0.6
      ? { x: p.x * width, y: p.y * height } : null;
  };
  const ls = get(11), rs = get(12), lh = get(23), rh = get(24);
  const la = get(27), ra = get(28);
  if (![ls, rs, lh, rh, la, ra].every(Boolean)) return row;
  const shoulder = midpoint(ls, rs), hip = midpoint(lh, rh);
  const torso = dist(shoulder, hip);
  if (torso < height * 0.05 || shoulder.y >= hip.y) return row;
  row.valid = true;
  row.trunk = Math.atan2(Math.abs(shoulder.x - hip.x), hip.y - shoulder.y) * 180 / Math.PI;
  row.separation = Math.abs(la.x - ra.x) / torso;
  row.signedSeparation = (la.x - ra.x) / torso;
  for (const [side, s, h, knee, ankle, elbow] of [
    ['left', ls, lh, get(25), la, get(13)], ['right', rs, rh, get(26), ra, get(14)],
  ]) {
    row[`${side}Knee`] = knee ? angle(h, knee, ankle) : null;
    if (elbow && dist(s, elbow) > height * 0.02) {
      const ux = elbow.x - s.x, uy = elbow.y - s.y;
      const vx = h.x - s.x, vy = h.y - s.y;
      const arm = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180 / Math.PI;
      row[`${side}Arm`] = Math.abs(arm) <= 100 ? arm : null;
    }
  }
  return row;
}

export function summarize(rows) {
  const clean = rows.filter((r, i) => Number.isFinite(r.t) && (i === 0 || r.t > rows[i - 1].t));
  const good = clean.filter(r => r.valid);
  const duration = clean.length > 1 ? clean.at(-1).t - clean[0].t : 0;
  const validSpan = good.length > 1 ? good.at(-1).t - good[0].t : 0;
  const coverage = clean.length ? good.length / clean.length : 0;
  const usable = good.length >= 20 && validSpan >= 3 && coverage >= 0.5;
  const values = key => good.map(r => r[key]).filter(Number.isFinite);
  const enough = a => usable && a.length >= 20 && a.length >= clean.length * 0.5;
  const median = key => { const a = values(key); return enough(a) ? round(quantile(a, .5)) : null; };
  const range = key => { const a = values(key); return enough(a) ? round(quantile(a, .95) - quantile(a, .05)) : null; };
  const leftArm = range('leftArm'), rightArm = range('rightArm');
  const separation = values('separation');
  // Hysteresis rejects ankle jitter. Never bridge missing intervals for cadence.
  // These are ankle alternations, not validated heel strikes.
  const segments = [];
  let events = [], sign = 0, previous = null;
  const flush = () => { if (events.length) segments.push(events); events = []; sign = 0; };
  for (const r of clean) {
    if (!r.valid || !Number.isFinite(r.signedSeparation)) { flush(); previous = null; continue; }
    if (previous !== null && r.t - previous > .3) flush();
    previous = r.t;
    const next = r.signedSeparation > .12 ? 1 : r.signedSeparation < -.12 ? -1 : 0;
    if (next && sign && next !== sign) events.push(r.t);
    if (next) sign = next;
  }
  flush();
  const longest = segments.sort((a, b) => b.length - a.length)[0] || [];
  const intervals = longest.slice(1).map((t, i) => t - longest[i]);
  const period = quantile(intervals, .5);
  const regular = period && intervals.every(v => v >= .25 && v <= 1.5 && Math.abs(v - period) / period < .35);
  const cadence = usable && longest.length >= 6 && regular ? round(60 / period) : null;
  return {
    version: VERSION, duration_s: round(duration), sampled_frames: clean.length,
    valid_frames: good.length, coverage_pct: round(coverage * 100), usable,
    metrics: {
      trunk_deg: median('trunk'), left_knee_rom_deg: range('leftKnee'), right_knee_rom_deg: range('rightKnee'),
      left_arm_rom_deg: leftArm, right_arm_rom_deg: rightArm,
      arm_asymmetry_pct: leftArm !== null && rightArm !== null && Math.max(leftArm, rightArm) >= 5
        ? round(Math.abs(leftArm - rightArm) / Math.max(leftArm, rightArm) * 100) : null,
      ankle_separation_torso_ratio: enough(separation) ? Math.round(quantile(separation, .95) * 100) / 100 : null,
      cadence_estimate_spm: cadence,
    },
    warnings: [
      ...(!usable ? ['전신이 보이는 유효 데이터를 3초 이상 확보해 주세요. 유효 프레임 20개 이상, 인식률 50% 이상이 필요합니다.'] : []),
      ...(coverage < .8 ? ['관절 가림 또는 화면 이탈이 많습니다. 카메라 위치와 조명을 조정해 다시 측정해 주세요.'] : []),
      ...(cadence === null ? ['일정한 발목 교차가 충분하지 않아 분당 걸음 추정값을 계산하지 않았습니다.'] : []),
      '고정된 측면 영상의 2D 관찰값입니다. 촬영 각도·가림에 영향을 받으며 의료 진단이나 실제 보폭(cm)을 뜻하지 않습니다.',
    ],
  };
}
