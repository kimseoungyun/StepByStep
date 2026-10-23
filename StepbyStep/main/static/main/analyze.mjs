import { measure, summarize } from './gait.mjs';
const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const fields = [
  ['trunk_deg', '몸통 기울기', '°', '수직선 기준 · 중앙값'],
  ['cadence_estimate_spm', '분당 걸음 추정', '걸음/분', '발목 교차 주기 기반'],
  ['left_knee_rom_deg', '왼쪽 무릎 움직임', '°', '관절 각도 범위'],
  ['right_knee_rom_deg', '오른쪽 무릎 움직임', '°', '관절 각도 범위'],
  ['left_arm_rom_deg', '왼팔 움직임', '°', '몸통 기준 위팔 각도 범위'],
  ['right_arm_rom_deg', '오른팔 움직임', '°', '몸통 기준 위팔 각도 범위'],
  ['arm_asymmetry_pct', '좌우 팔 차이', '%', '큰 쪽 움직임 대비 차이'],
  ['ankle_separation_torso_ratio', '발목 벌어짐', '배', '몸통 길이 기준 · 실제 보폭 아님'],
];
let stream, objectURL, worker, rows = [], report, mode, running = false, busy = false;
let runId = 0, started = 0, lastMediaTime = -1, lastSample = -Infinity, animation;
let pendingResolve, pendingReject, workerTimer;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function buttons(locked = false) {
  $('file').disabled = locked; $('camera').disabled = locked;
  $('start').disabled = locked || !mode; $('stop').disabled = !running;
}
function clearReport() {
  report = null; $('metrics').replaceChildren(); $('warnings').replaceChildren();
  $('summary').textContent = '측정을 마치면 결과가 표시됩니다.';
  $('json').disabled = $('csv').disabled = true;
}
function releaseSource() {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
  if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null;
  mode = null; ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('placeholder').hidden = false;
  $('source').textContent = '카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다.';
}
function killWorker() {
  clearTimeout(workerTimer); worker?.terminate(); worker = null;
  pendingReject?.(new Error('분석이 취소되었습니다.')); pendingReject = pendingResolve = null; busy = false;
}
function requestWorker(message, transfer = []) {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve; pendingReject = reject;
    workerTimer = setTimeout(() => { pendingReject = pendingResolve = null; reject(new Error('모델 응답 시간이 초과되었습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.')); }, 60000);
    worker.postMessage(message, transfer);
  });
}
async function initializeWorker() {
  // MediaPipe's WASM loader calls importScripts; it needs a classic Worker.
  worker = new Worker(new URL('./pose-worker.mjs', import.meta.url));
  worker.onmessage = ({ data }) => {
    clearTimeout(workerTimer);
    if (data.type === 'error') pendingReject?.(new Error(data.message)); else pendingResolve?.(data);
    pendingReject = pendingResolve = null;
  };
  worker.onerror = () => { clearTimeout(workerTimer); pendingReject?.(new Error('분석 모델을 불러올 수 없습니다. 네트워크와 브라우저 지원을 확인해 주세요.')); pendingReject = pendingResolve = null; };
  await requestWorker({ type: 'init' });
}
function mediaReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('영상을 열 수 없습니다. MP4 또는 WebM 파일을 사용해 주세요.')), 15000);
    const loaded = () => done();
    const failed = () => done(new Error('지원하지 않거나 손상된 영상입니다.'));
    function done(error) { clearTimeout(timer); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', failed); error ? reject(error) : resolve(); }
    video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed);
    if (video.readyState >= 2) done();
  });
}
$('file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  releaseSource(); clearReport(); buttons(true);
  try {
    objectURL = URL.createObjectURL(file); video.src = objectURL;
    await mediaReady(); mode = 'file'; $('placeholder').hidden = true;
    $('source').textContent = `${file.name} · 원본 영상은 서버로 전송되지 않습니다.`;
    status('영상이 준비됐습니다. 분석 시작을 눌러 주세요.');
  } catch (e) { releaseSource(); status(e.message, true); }
  finally { buttons(); event.target.value = ''; }
});
$('camera').addEventListener('click', async () => {
  releaseSource(); clearReport(); buttons(true);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라는 HTTPS 또는 localhost에서 지원되는 브라우저로 연결해 주세요.');
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play(); await mediaReady(); mode = 'camera';
    $('placeholder').hidden = true; $('source').textContent = '카메라 미리보기 · 측정을 마치면 카메라가 꺼집니다.';
    status('전신이 화면에 들어오도록 준비한 뒤 분석 시작을 눌러 주세요.');
  } catch (e) { releaseSource(); status(`카메라를 연결하지 못했습니다. 권한과 연결 상태를 확인해 주세요. (${e.message})`, true); }
  finally { buttons(); }
});
function draw(points) {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points) return;
  ctx.strokeStyle = '#b8e978'; ctx.fillStyle = '#b8e978'; ctx.lineWidth = Math.max(2, canvas.width / 350);
  for (const [a, b] of [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]]) {
    if (points[a].visibility < .6 || points[b].visibility < .6) continue;
    ctx.beginPath(); ctx.moveTo(points[a].x * canvas.width, points[a].y * canvas.height); ctx.lineTo(points[b].x * canvas.width, points[b].y * canvas.height); ctx.stroke();
  }
  for (const p of points) if (p.visibility >= .6) { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, canvas.width / 200, 0, Math.PI * 2); ctx.fill(); }
}
function renderReport() {
  report = { ...summarize(rows), created_at: new Date().toISOString(), source: mode };
  $('summary').textContent = `${report.duration_s}초 · 분석 ${report.sampled_frames}프레임 · 유효 ${report.valid_frames}프레임 · 인식률 ${report.coverage_pct}%`;
  for (const [key, title, unit, note] of fields) {
    const card = document.createElement('article'); card.className = 'metric';
    const h = document.createElement('h3'); h.textContent = title;
    const v = document.createElement('span'); v.className = 'value'; v.textContent = report.metrics[key] ?? '—';
    const u = document.createElement('span'); u.className = 'unit'; u.textContent = report.metrics[key] === null ? '측정 불가' : unit;
    const p = document.createElement('p'); p.textContent = note; card.append(h, v, u, p); $('metrics').append(card);
  }
  for (const warning of report.warnings) { const li = document.createElement('li'); li.textContent = warning; $('warnings').append(li); }
  $('json').disabled = $('csv').disabled = false;
}
function finish(cancelled = false) {
  if (!running) return;
  running = false; runId++; cancelAnimationFrame(animation); video.pause(); killWorker();
  if (!cancelled) { renderReport(); status(report.usable ? '분석이 완료됐습니다. 아래에서 움직임 리포트를 확인해 주세요.' : '측정이 끝났지만 충분한 데이터가 없습니다. 아래 안내를 확인해 주세요.'); }
  if (mode === 'camera') { stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; mode = null; }
  buttons();
}
async function tick(id) {
  if (!running || id !== runId) return;
  const now = performance.now(), t = mode === 'file' ? video.currentTime : (now - started) / 1000;
  if (t >= 15 || video.ended) { finish(); return; }
  if (!busy && video.readyState >= 2 && video.currentTime !== lastMediaTime && t - lastSample >= 1 / 15) {
    busy = true; lastMediaTime = video.currentTime; lastSample = t;
    try {
      const bitmap = await createImageBitmap(video);
      if (!running || id !== runId) { bitmap.close(); return; }
      const result = await requestWorker({ type: 'frame', bitmap, timestamp: now, t }, [bitmap]);
      if (!running || id !== runId) return;
      const points = result.landmarks.length === 1 ? result.landmarks[0] : null;
      const row = measure(points, video.videoWidth, video.videoHeight, t); rows.push(row); draw(points);
      $('progress').value = t;
      status(`${t.toFixed(1)} / 15초 · ${result.landmarks.length > 1 ? '여러 사람이 감지됐습니다. 한 사람만 촬영해 주세요.' : row.valid ? '관절을 추적하고 있습니다.' : '전신이 잘 보이도록 위치를 조정해 주세요.'}`);
    } catch (e) { if (running && id === runId) { finish(true); status(`분석에 실패했습니다. ${e.message}`, true); } return; }
    finally { busy = false; }
  }
  if (running && id === runId) animation = requestAnimationFrame(() => tick(id));
}
$('start').addEventListener('click', async () => {
  clearReport(); rows = []; running = true; const id = ++runId; buttons(true);
  $('progress').value = 0; lastSample = -Infinity; lastMediaTime = -1;
  status('분석 모델을 준비하고 있습니다. 첫 실행에는 다운로드 시간이 필요합니다.');
  try {
    await initializeWorker(); if (!running || id !== runId) return;
    if (mode === 'file') { video.currentTime = 0; }
    await video.play(); if (!running || id !== runId) return;
    started = performance.now(); tick(id);
  } catch (e) { if (running && id === runId) { finish(true); status(`시작하지 못했습니다. ${e.message}`, true); } }
});
$('stop').addEventListener('click', () => finish());
video.addEventListener('error', () => { if (running) { finish(true); status('영상 재생 중 오류가 발생했습니다.', true); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && running) finish(); });
window.addEventListener('pagehide', () => { running = false; killWorker(); releaseSource(); });
function download(text, type, extension) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = `stepbystep-${Date.now()}.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('json').addEventListener('click', () => { if (report) download(JSON.stringify({ ...report, samples: rows }, null, 2), 'application/json', 'json'); });
$('csv').addEventListener('click', () => {
  if (!report) return;
  const keys = ['t','valid','trunk','leftKnee','rightKnee','leftArm','rightArm','separation','signedSeparation'];
  download(keys.join(',') + '\n' + rows.map(r => keys.map(k => r[k] ?? '').join(',')).join('\n'), 'text/csv;charset=utf-8', 'csv');
});
