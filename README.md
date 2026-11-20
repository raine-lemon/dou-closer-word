# 가까운 말

DoU 대화방에서 함께 푸는 단어 맞히기 미니앱입니다. 판마다 서버만 아는 숨은 단어가 있고, 대화방에 단어를 치면
숨은 단어와 뜻이 얼마나 가까운지 점수(0 ~ 100)가 순위표에 나옵니다. 숨은 단어를 그대로 치면 그 판이 끝납니다.

- 미니앱: Vite + TypeScript, [`@lemoncloud/chatic-apps-sdk`](https://www.npmjs.com/package/@lemoncloud/chatic-apps-sdk) 0.3.0
- 서버: Firebase Cloud Functions(`functions/`) + Firestore, 유사도는 Vertex AI Gemini 임베딩
- 계획 · 진행 상태: [MINIAPP.md](./MINIAPP.md)

## 구조

```mermaid
flowchart LR
  subgraph DoU["DoU 앱"]
    room["대화방 메시지"]
    page["미니앱 (정적 페이지)"]
  end
  subgraph FB["Firebase"]
    cr["createRound"]
    sc["score"]
    fs[("Firestore<br/>rounds · embeddings")]
    vx["Vertex AI<br/>gemini-embedding-001"]
  end
  room -- "apps.data chat.observeList" --> page
  page -- "sendMessage (사용자가 누를 때만)" --> room
  page -- "{ }" --> cr
  page -- "{ round, words }" --> sc
  cr --> fs
  sc --> fs
  sc --> vx
```

- 판 시작: "새 판" → `createRound`가 판 번호를 주고 → 미니앱이 대화방에 `🎯 가까운 말 #<번호> 시작`을 보냅니다.
  다른 사람의 미니앱은 이 메시지를 보고 같은 판에 들어옵니다.
- 추측: 시작 메시지 뒤의 한 단어짜리 메시지(띄어쓰기 없는 한글 1 ~ 20자). 같은 단어는 처음 친 사람 것으로 칩니다.
- 서버로는 **판 번호와 단어만** 보냅니다. 이름 · 메시지 id · 사용자 id는 보내지 않습니다.
- 점수는 판마다 보정합니다. 단어 임베딩끼리의 코사인은 대개 0.75 ~ 0.85에 몰려 있어서, 숨은 단어와 단어 목록 평균의
  유사도를 0, 숨은 단어 자신을 100으로 둡니다. 평균보다 먼 단어는 음수가 나옵니다. 첫 판은 단어 목록 전체를 한 번 임베딩해서
  40초쯤 걸리고, 그 뒤로는 캐시를 씁니다.
- 숨은 단어 목록은 저장소에 없습니다. `functions/words.private.json`(JSON 배열, git 제외)에 두고 배포합니다.
  없으면 `functions/words.example.json`(예시 12개)을 씁니다.

## 로컬에서 돌리기

Node 22, Java(Firestore 에뮬레이터), Firebase CLI가 필요합니다.

```bash
npm install && npm --prefix functions install
```

```bash
npm run server
```

```bash
npm run dev
```

`npm run server`는 Functions · Firestore 에뮬레이터를 띄웁니다(`demo-closer-word`, 클라우드 계정 불필요).
에뮬레이터에서는 임베딩 대신 음절로 만든 가짜 벡터로 채점합니다(`functions/.env.local`). 뜻은 모르고 글자가 겹치면 점수가 오릅니다.
`npm run dev`의 주소(http://localhost:5180)를 브라우저로 열면 SDK의 mock이 앱 대신 답합니다. mock 대화방에서 "새 판"을 누르면
가상의 친구 둘이 단어를 몇 개 칩니다.

```bash
npm --prefix functions test
```

```bash
npm run build && npm run verify
```

## 배포

지금 배포된 곳: Firebase 프로젝트 `dou-closer-word`, 함수 리전 `asia-northeast3`
(`https://asia-northeast3-dou-closer-word.cloudfunctions.net/{createRound,score}`).

1. Firebase 프로젝트를 Blaze 요금제로 두고 Firestore · Vertex AI(Agent Platform, `aiplatform.googleapis.com`) API를 켭니다.
   Firestore 데이터베이스는 `asia-northeast3`에 만듭니다.
2. `.firebaserc`의 `default`를 그 프로젝트 id로 두고 `functions/words.private.json`을 만듭니다.
3. 배포합니다.

```bash
firebase deploy --only functions,firestore:rules
```

새 프로젝트의 첫 배포는 권한이 아직 퍼지지 않아 `serviceusage` 권한 오류로 실패할 수 있습니다. 그러면 반쯤 만들어진 함수를
지우고(`firebase functions:delete createRound score --region asia-northeast3`) 몇 분 뒤 다시 배포합니다.

4. `.env.production`에 서버 주소를 넣고 묶습니다.

```bash
echo "VITE_API_BASE=https://asia-northeast3-<project-id>.cloudfunctions.net" > .env.production
```

```bash
npm run build && npm run verify && npm run bundle
```

### 화면 올리기 (S3 + CloudFront)

dev 주소: **https://dou-closer-word.apps-dev.chatic.io/**

`*.apps-dev.chatic.io`는 CloudFront 배포 하나가 모든 미니앱을 맡고, 호스트의 첫 라벨을 버킷 폴더로 바꿔 줍니다.
그래서 새 미니앱은 폴더 하나를 올리면 되고 CloudFront · 인증서 · DNS는 건드리지 않습니다.

```bash
cp .env.deploy.example .env.deploy
```

```bash
npm run bundle && DEPLOY_DRY_RUN=1 npm run deploy
```

```bash
npm run deploy
```

`npm run deploy`는 `dou-closer-word.zip`을 풀어 `DEPLOY_BUCKET`(`<버킷>/dou-closer-word`)에 올리고, 그 폴더만 CloudFront에서
무효화합니다. 버킷 이름과 배포 id는 `.env.deploy`(git 제외)에 둡니다.

서버는 `*.apps.chatic.io` · `*.apps-dev.chatic.io` · localhost에서 오는 요청만 CORS로 허용합니다. 폰에서 터널로 시험할 때는
`functions/.env`에 `EXTRA_ORIGINS=https://<터널 주소>`를 넣고 다시 배포합니다.

## 지금 되는 것과 안 되는 것

- 브라우저 mock + 에뮬레이터로 전체 흐름(판 시작 → 추측 → 채점 → 정답)은 됩니다.
- 대화방 읽기 · 보내기(`apps.data`)는 **검수된 주소**에서만 열립니다. DoU 제출 창구가 아직 없어서 폰에서는 아직 시험할 수 없습니다.
- 순위("상위 n위")와 판 포기는 다음 판에서 합니다.
