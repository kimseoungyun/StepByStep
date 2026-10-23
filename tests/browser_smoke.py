"""Real Chromium + real MediaPipe smoke test. Start Django on :8000 first.

Uses a generated blank video, never a user's camera. Requires network access
to the pinned MediaPipe JS/WASM/model. Does not validate clinical accuracy.
"""
import argparse
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(__file__).resolve().parents[1] / 'test-results'
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--pose-image', type=Path, help='Optional local JPEG of a visible person; tests static pose inference, not gait accuracy.')
args = parser.parse_args()
image_data = 'data:image/jpeg;base64,' + base64.b64encode(args.pose_image.read_bytes()).decode() if args.pose_image else None
prefix = 'pose' if image_data else 'blank'

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append((request.method, request.url)))
    page.goto('http://127.0.0.1:8000/')
    expect(page.locator('#start')).to_be_disabled()
    page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
    # A generated 4.5s file exercises upload/decode/inference without personal media.
    page.evaluate("""async imageData => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      let image;
      if (imageData) { image = new Image(); image.src = imageData; await image.decode(); canvas.width = image.width; canvas.height = image.height; }
      const ctx = canvas.getContext('2d'), stream = canvas.captureStream(15), chunks = [];
      const recorder = new MediaRecorder(stream, {mimeType: 'video/webm'});
      recorder.ondataavailable = e => chunks.push(e.data);
      const stopped = new Promise(resolve => recorder.onstop = resolve);
      recorder.start();
      const paint = setInterval(() => {ctx.fillStyle = '#eeeeee'; ctx.fillRect(0,0,canvas.width,canvas.height); if(image) ctx.drawImage(image,0,0);}, 60);
      await new Promise(resolve => setTimeout(resolve,4500)); recorder.stop(); await stopped;
      clearInterval(paint); stream.getTracks().forEach(t => t.stop());
      const transfer = new DataTransfer(); transfer.items.add(new File(chunks,'blank.webm',{type:'video/webm'}));
      const input = document.getElementById('file'); input.files = transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }""", image_data)
    expect(page.locator('#start')).to_be_enabled(timeout=20000)
    page.locator('#start').click()
    page.wait_for_function("!document.getElementById('json').disabled || document.getElementById('status').classList.contains('error')", timeout=90000)
    status = page.locator('#status').inner_text()
    print('ANALYSIS STATUS:', status, flush=True)
    assert not page.locator('#status').evaluate("e => e.classList.contains('error')"), status
    expect(page.locator('.metric')).to_have_count(8)
    with page.expect_download() as download:
        page.locator('#json').click()
    download.value.save_as(str(OUT / f'{prefix}-result.json'))
    result = json.loads((OUT / f'{prefix}-result.json').read_text(encoding='utf-8'))
    assert result['sampled_frames'] > 0
    if image_data:
        assert result['valid_frames'] >= 20 and result['usable'], result
        assert result['metrics']['trunk_deg'] is not None
        assert result['metrics']['cadence_estimate_spm'] is None, 'Static image must not produce cadence'
    else:
        assert result['valid_frames'] == 0 and not result['usable']
        assert all(value is None for value in result['metrics'].values())
    with page.expect_download() as download:
        page.locator('#csv').click()
    download.value.save_as(str(OUT / f'{prefix}-result.csv'))
    csv = (OUT / f'{prefix}-result.csv').read_text(encoding='utf-8')
    assert len(csv.splitlines()) == result['sampled_frames'] + 1
    page.screenshot(path=str(OUT / f'{prefix}-report.png'), full_page=True)
    # Retry then cancel while the next worker loads; no stale result may overwrite it.
    page.locator('#start').click()
    page.locator('#stop').click()
    expect(page.locator('#start')).to_be_enabled()
    expect(page.locator('.metric')).to_have_count(8)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Fake camera verifies permission, preview and release without hardware access.
    page.context.grant_permissions(['camera'])
    page.locator('#camera').click()
    expect(page.locator('#start')).to_be_enabled()
    page.evaluate('window.testTracks = document.getElementById("video").srcObject.getTracks()')
    page.locator('#start').click()
    page.locator('#stop').click()
    assert page.evaluate('window.testTracks.every(track => track.readyState === "ended")')
    expect(page.locator('#start')).to_be_disabled()
    # A malformed file must reset the source and keep analysis disabled.
    page.locator('#file').set_input_files({'name': 'broken.webm', 'mimeType': 'video/webm', 'buffer': b'not-a-video'})
    expect(page.locator('#status')).to_have_class('error')
    expect(page.locator('#start')).to_be_disabled()
    assert not errors, errors
    assert not any(method == 'POST' for method, _ in requests), 'Unexpected upload'
    print(json.dumps({'frames': result['sampled_frames'], 'valid_frames': result['valid_frames'], 'browser_errors': errors, 'uploads': 0,
                      'fake_camera_released': True, 'malformed_file_rejected': True}, ensure_ascii=False), flush=True)
    browser.close()
