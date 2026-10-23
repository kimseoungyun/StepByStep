# 그대의 걸음걸이 · Step by Step

공개 자세 추정 라이브러리로 측면 보행 영상을 분석하고 움직임을 수치로 보여주는 Django 프로젝트입니다.
기존 Team. 뜨아아의 TensorFlow/PoseNet 실험 코드를 보존하면서, 현재 실행 경로는 브라우저 기반 MediaPipe로 개편했습니다.

## 실행

Python 3.12 권장. Windows PowerShell에서 저장소 루트 기준:

```powershell
uv python install 3.12
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe StepbyStep/manage.py runserver
```

`uv`가 없다면 설치된 Python 3.12로 `python -m venv .venv`를 실행한 뒤
`.venv/Scripts/python.exe -m pip install -r requirements.txt`로 설치할 수 있습니다.

[로컬 분석 화면](http://127.0.0.1:8000/)을 엽니다. 현재 분석 기능에는 DB 마이그레이션이나 관리자 계정이 필요하지 않습니다.
관리자 기능을 사용할 때만 `manage.py migrate`와 `manage.py createsuperuser`를 실행하세요.

## 사용 방법

1. 한 사람의 전신이 보이는 측면 영상을 선택하거나 카메라를 연결합니다.
2. 고정된 카메라에 수직으로, 가능하면 10~15초 동안 같은 방향으로 걷습니다.
3. **분석 시작**을 누르면 영상의 처음부터 최대 15초를 분석합니다. 중간에 **측정 종료**할 수 있습니다.
4. 결과 카드와 인식률을 확인하고 JSON(요약+샘플) 또는 CSV(프레임별 수치)를 저장합니다.

카메라는 HTTPS 또는 localhost에서 사용해야 합니다. 원본 영상과 관절 데이터는 서버에 업로드하지 않습니다.
페이지를 닫거나 새로 고치면 결과는 사라지므로 필요한 결과를 다운로드하세요.
최초 분석에는 jsDelivr의 MediaPipe JS/WASM과 Google Storage의 모델 다운로드를 위한 인터넷 연결이 필요합니다.
이 외부 요청에는 서비스 제공자가 통상적인 접속 정보를 받을 수 있습니다. 완전한 오프라인 배포는 아직 지원하지 않습니다.

## 수치와 한계

| 표시값 | 정의 | 단위 |
|---|---|---|
| 몸통 기울기 | 수직선 대비 어깨·골반 중심선 각도의 중앙값(방향 구분 없음) | 도 |
| 좌우 무릎 움직임 | 골반–무릎–발목 각도의 P95−P5 | 도 |
| 좌우 팔 움직임 | 몸통 대비 위팔의 부호 있는 각도 P95−P5 | 도 |
| 좌우 팔 차이 | 좌우 범위 차이 / 큰 범위 × 100 | % |
| 발목 벌어짐 | 수평 발목 간격 / 몸통 길이의 P95 | 배 |
| 분당 걸음 추정 | 연속된 좌우 발목 교차 간격 중앙값의 역수 × 60 | 걸음/분 |

- 좌표를 영상 픽셀 비율로 보정한 **2D 기술 통계**이며 의료 진단, 정상/비정상 판정, 실제 보폭(cm) 또는 보행 속도(m/s)가 아닙니다.
- visibility 0.6 이상인 어깨·골반·발목을 확보한 프레임만 사용합니다. 신뢰도 기준은 제품의 초기 휴리스틱이며 검증된 정확도 지표가 아닙니다.
- 유효 샘플 20개, 유효 데이터의 시간 범위 3초, 유효 프레임 비율 50% 이상이 필요합니다. 각 관절 지표에도 별도 샘플 수 기준을 적용합니다.
- 분당 걸음은 몸통 길이의 ±0.12를 넘는 발목 교차를 사용합니다. 0.3초 초과 공백과 인식 실패는 구간을 나눕니다. 한 구간에 교차 6회 이상, 간격 0.25~1.5초, 중앙값 대비 편차 35% 미만일 때만 표시합니다.
- 실제 발 착지 이벤트를 검증하지 않았으므로 제자리 다리 움직임도 교차로 인식할 수 있습니다. 가림·좌우 관절 뒤바뀜·회전·카메라 이동·투시 왜곡의 영향을 받습니다.
- 여러 사람이 감지된 프레임은 제외합니다. 동일 인물의 재식별 및 촬영 방향 자동 판별은 아직 지원하지 않습니다.
- 표본 기반 회귀 테스트는 계산을 검증합니다. 실제 보행 데이터셋과 기준 장비 대비 정확도 검증은 별도 과제로 남아 있습니다.

## 구조

- `StepbyStep/main/static/main/pose-worker.mjs`: MediaPipe Pose Landmarker Lite, 추론 전용 Worker. 최대 한 프레임만 처리 중 상태로 유지.
- `StepbyStep/main/static/main/gait.mjs`: 프레임 측정과 통계. DOM·모델과 독립적으로 테스트 가능.
- `StepbyStep/main/static/main/analyze.mjs`: 파일/카메라 입력, 최대 15fps 샘플링, 리포트, 다운로드, 자원 해제.
- `StepbyStep/main/templates/main/analyze.html`: 한국어 분석 화면.
- `StepbyStep/posenet/`, 기존 템플릿: 역사적 실험 코드. 새 실행 경로에서는 사용하지 않습니다.
- 이전 `_models/`, DB, 측정 JSON, Python 캐시는 추적 대상에서 제외했습니다. 기존 로컬 파일은 보존하며 새로 복제할 때는 내려받지 않습니다. 이전 공개 커밋의 이력은 보존합니다.

공유 `info.json`/`result.json`을 읽고 쓰던 흐름과 서버 장치의 카메라 스트리밍은 새 화면에서 제거했습니다.
기존 `/detect/`는 새 분석 화면, `/url/`, `/qr/`, `/camera/`는 시작 화면으로 연결됩니다.
기존 모바일 QR 결과 공유 기능은 현재 제공하지 않습니다.

## 테스트

```powershell
node --test tests/gait.test.mjs
.venv/Scripts/python.exe StepbyStep/manage.py test main
.venv/Scripts/python.exe StepbyStep/manage.py check
```

실제 Chromium + MediaPipe 연결 테스트(인터넷 필요, 서버를 먼저 실행):

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
.venv/Scripts/python.exe -m playwright install chromium
.venv/Scripts/python.exe tests/browser_smoke.py
```

이 테스트는 생성한 빈 영상으로 추론·미검출·다운로드·재시도·모바일 레이아웃을 확인하며,
가상 카메라로 연결·종료와 손상된 영상의 오류 처리를 확인합니다. 사용자의 카메라를 열지 않습니다.
산출물은 Git에서 제외되는 `test-results/`에 기록됩니다.
`--pose-image path/to/person.jpg` 옵션은 로컬 JPEG를 정지 영상으로 만들어 인체가 있는 경우도 검사합니다.
정지 자세 테스트는 보행 정확도 평가가 아닙니다.

## 배포 설정

로컬 개발은 기본 설정으로 실행합니다. 외부 배포 시 `DJANGO_DEBUG=0`, 고유한 `DJANGO_SECRET_KEY`,
쉼표로 구분한 `DJANGO_ALLOWED_HOSTS`를 설정하고 HTTPS 및 정적 파일 제공을 구성해야 합니다.
개발 서버는 운영용 서버가 아닙니다.

## 다음 개선 과제

1. 동의받은 측면 보행 영상·기준 걸음 수·관절 각도 라벨로 평가 세트 구성
2. 촬영 각도 검사와 동일 인물 추적, 좌우 관절 뒤바뀜 탐지
3. 보정 도구/다중 시점 기반 실제 거리와 속도 추정
4. 결과 이력·동일 조건 비교와 사용자별 접근 제어를 갖춘 공유 기능
5. 추론 시간·프레임 누락률 벤치마크 및 모델 자산 자체 호스팅

## 출처와 기존 프로젝트

- [MediaPipe 웹 Pose Landmarker 문서](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [MediaPipe](https://github.com/google-ai-edge/mediapipe), `@mediapipe/tasks-vision` 0.10.21, Pose Landmarker Lite float16 v1
- [기존 발표 자료](https://github.com/tjddus0403/StepByStep/files/10018003/default.pdf)
- [기존 데모](https://www.youtube.com/watch?v=HqwVybZ8kz4)

원작: AI융합경진대회 Team. 뜨아아 — SungYeon Kim, JaeWon Ko, DongHyun Kang, SeongYun Kim.
기존 코드의 라이선스는 `LICENSE`를 참고하세요. 외부 라이브러리와 모델의 라이선스는 해당 배포처를 따릅니다.
