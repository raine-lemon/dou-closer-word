# 가까운 말 (dou-closer-word)

Stage: 1 idea — done · 2 first build — done · 3 release prep — done · dev https://dou-closer-word.apps-dev.chatic.io/ · 운영 https://dou-closer-word.apps.chatic.io/

## What it does

대화방 사람들이 함께 푸는 단어 맞히기 게임이다. 판마다 서버만 아는 숨은 단어가 하나 있다.
사람들이 대화방에 단어를 치면 미니앱이 그 메시지를 읽고, 숨은 단어와 뜻이 얼마나 가까운지 점수(0 ~ 100)를 매겨
순위표로 보여 준다. 누군가 숨은 단어를 그대로 치면 그 판이 끝난다.

- 판 시작: 누군가 미니앱에서 "새 판"을 누르면 서버가 판을 만들고, 미니앱이 대화방에
  `🎯 가까운 말 #<번호> 시작` 메시지를 보낸다. 다른 사람의 미니앱은 이 메시지를 보고 같은 판에 들어온다.
- 채점: 시작 메시지 뒤에 올라온 한 단어짜리 메시지만 추측으로 친다(띄어쓰기 없는 한글 1 ~ 20자).
- 정답: 맞힌 사람의 미니앱이 `🎉 #<번호> 정답은 "<단어>" — <이름>님이 <n>번째 추측에 맞혔어요`를 보낸다.

## Screens

1. 대화방 고르기: 이 플레이스에서 내가 들어가 있는 대화방 목록. 진행 중인 판이 있으면 표시한다.
   하나를 누르면 순위표로 간다. 서버로 단어를 보낸다는 안내가 맨 아래에 있다.
2. 순위표: 판 번호, 추측 수, 점수 높은 순 목록(이름 · 단어 · 점수), 방금 들어온 추측 강조, 정답이면 맨 위에 ★.
   아래에 단어 입력칸(보내면 대화방에 내 이름으로 올라간다)과 "새 판" 버튼. 뒤로 가기는 1로 돌아간다.

## What it asks the app for

- Permissions:
  - `session` — 내 사용자 id와 지금 플레이스를 알아, 내가 친 정답일 때만 정답 메시지를 보내려고
  - `channel` — 대화방 목록과 이름
  - `chat` — 대화방 메시지를 읽어 추측을 찾으려고
  - `user` — 순위표에 보낸 사람 이름을 붙이려고
  - `chatSend` — 단어 입력 · 판 시작 · 정답 알림 메시지를 보내려고
- Display: clean · Orientation: portrait
- Result when it closes: 없음
- Saved on the device: 마지막으로 고른 대화방 id
- Own server: Firebase(새 프로젝트) Cloud Functions
  - `createRound` — 새 판을 만들고 판 id · 번호를 준다. 숨은 단어는 서버에만 있다
  - `score` — 판 id와 단어 목록을 받아 점수 · 정답 여부를 준다. 받는 것은 **판 id와 단어뿐**이다
    (이름 · 메시지 id · 사용자 id는 보내지 않는다). 유사도는 Vertex AI의 Gemini 임베딩, 한 번 잰 단어는 저장해 다시 쓴다.
    점수는 판마다 보정한다 — 숨은 단어와 단어 목록 평균의 거리를 0으로, 숨은 단어를 100으로 둔다(평균보다 먼 단어는 음수)
  - 숨은 단어 후보 목록은 공개 저장소에 넣지 않는다(gitignore된 파일 → Firestore로 올림)

## Later

- 순위(꼬리말 "상위 n위") — 단어장 전체와 비교해야 해서 첫 판에서는 뺀다
- 판 포기 · 정답 공개 버튼

## Progress

- [x] Starting files and first install
- [x] Server — createRound · score (에뮬레이터에서 가짜 임베딩으로)
- [x] 1 대화방 고르기
- [x] 2 순위표
- [x] Verify passes
- [x] Zip built (배포된 서버 주소로)
- [x] Firebase 배포 — 프로젝트 `dou-closer-word`, 함수 `asia-northeast3`
- [x] dev 호스팅 — `dou-closer-word.apps-dev.chatic.io` (S3 폴더 + CloudFront, `npm run deploy`)
- [x] 운영 호스팅 — `dou-closer-word.apps.chatic.io` (`npm run deploy:prod`)
- [ ] DoU 실험실 카드 — 앱 ID `dou-closer-word` (dou-app PR)
- [ ] DoU 앱에 미니앱으로 등록 · 폰에서 대화방 연결 확인
