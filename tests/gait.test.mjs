import test from 'node:test';
import assert from 'node:assert/strict';
import { angle, measure, quantile, summarize } from '../StepbyStep/main/static/main/gait.mjs';

function pose(width = 640, height = 480) {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .99 }));
  for (const [i, x, y] of [[11,280,100],[12,320,100],[13,270,180],[14,330,180],
    [23,280,240],[24,320,240],[25,280,320],[26,320,320],[27,280,420],[28,320,420]]) {
    points[i] = { x: x / width, y: y / height, visibility: .99 };
  }
  return points;
}
function walking(seconds = 10) {
  return Array.from({ length: seconds * 15 }, (_, i) => {
    const t = i / 15, wave = Math.sin(2 * Math.PI * t);
    return { t, valid: true, trunk: 5, leftArm: wave * 20, rightArm: wave * 10,
      leftKnee: 150 + wave * 20, rightKnee: 150 - wave * 20,
      separation: Math.abs(wave), signedSeparation: wave };
  });
}
test('angles handle vertical limbs and degenerate joints without recursion or NaN', () => {
  assert.equal(angle({x:0,y:0}, {x:0,y:1}, {x:0,y:2}), 180);
  assert.equal(angle({x:1,y:0}, {x:0,y:0}, {x:0,y:1}), 90);
  assert.equal(angle({x:0,y:0}, {x:0,y:0}, {x:0,y:1}), null);
});
test('pixel aspect ratio, resizing and translations do not distort joint angles', () => {
  const a = measure(pose(), 640, 480, 0);
  const b = measure(pose(1280, 720), 1280, 720, 0);
  const c = measure(pose(), 1280, 960, 0);
  assert.ok(a.valid);
  for (const key of ['trunk','leftKnee','rightKnee','leftArm','rightArm','separation']) {
    assert.equal(a[key], b[key]); assert.equal(a[key], c[key]);
  }
  const translated = pose().map(p => ({...p, x:p.x + .1, y:p.y - .05}));
  assert.ok(Math.abs(measure(translated,640,480,0).leftArm - a.leftArm) < 1e-10);
});
test('missing, cropped, uncertain and collapsed torso frames are rejected', () => {
  assert.equal(measure(null,640,480,0).valid, false);
  assert.equal(measure([],640,480,0).valid, false);
  for (const changes of [{visibility:.1},{x:NaN},{x:1.1},{y:-.1}]) {
    const points = pose(); Object.assign(points[27],changes);
    assert.equal(measure(points,640,480,0).valid,false);
  }
  const points = pose(); points[23] = points[11]; points[24] = points[12];
  assert.equal(measure(points,640,480,0).valid,false);
});
test('missing elbow suppresses only its metric', () => {
  const points = pose(); points[13].visibility = .1;
  const result = measure(points,640,480,0);
  assert.ok(result.valid); assert.equal(result.leftArm,undefined); assert.ok(Number.isFinite(result.rightArm));
});
test('empty and short samples never manufacture scores', () => {
  for (const rows of [[],walking(1),walking().map(r => ({...r,valid:false}))]) {
    const result = summarize(rows);
    assert.equal(result.usable,false);
    assert.ok(Object.values(result.metrics).every(v => v === null));
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
  }
});
test('known periodic motion gives 120 cadence and 50 percent arm difference', () => {
  const result = summarize(walking());
  assert.ok(result.usable); assert.equal(result.metrics.trunk_deg,5);
  assert.ok(Math.abs(result.metrics.cadence_estimate_spm - 120) < 10);
  assert.ok(Math.abs(result.metrics.arm_asymmetry_pct - 50) < .2);
  assert.ok(Math.abs(result.metrics.left_knee_rom_deg - result.metrics.right_knee_rom_deg) < .1);
});
test('stationary pose and small jitter do not produce cadence or arm asymmetry', () => {
  for (const amplitude of [0,.05]) {
    const rows = walking().map(r => ({...r, signedSeparation:r.signedSeparation * amplitude,leftArm:0,rightArm:0}));
    const result = summarize(rows);
    assert.equal(result.metrics.cadence_estimate_spm,null);
    assert.equal(result.metrics.arm_asymmetry_pct,null);
  }
});
test('occlusions and time gaps do not create cadence across disconnected segments', () => {
  const rows = walking().map((r,i) => ({...r,valid:i % 30 !== 0}));
  assert.equal(summarize(rows).metrics.cadence_estimate_spm,null);
  assert.equal(summarize(walking().map((r,i) => ({...r,t:r.t + Math.floor(i/30)}))).metrics.cadence_estimate_spm,null);
});
test('low coverage and sparse per-joint observations suppress unreliable metrics', () => {
  assert.equal(summarize(walking().map((r,i) => ({...r,valid:i%3===0}))).usable,false);
  const result = summarize(walking().map((r,i) => ({...r,leftArm:i%3===0 ? r.leftArm : null})));
  assert.equal(result.metrics.left_arm_rom_deg,null);
  assert.equal(result.metrics.arm_asymmetry_pct,null);
  assert.notEqual(result.metrics.right_arm_rom_deg,null);
});
test('robust statistics limit isolated outlier impact', () => {
  const rows = walking(); rows[5].trunk = 89; rows[10].leftArm = 10000;
  const result = summarize(rows);
  assert.equal(result.metrics.trunk_deg,5); assert.ok(result.metrics.left_arm_rom_deg < 41);
  assert.equal(quantile([], .5),null); assert.equal(quantile([1,2,3,4],.5),2.5);
});
