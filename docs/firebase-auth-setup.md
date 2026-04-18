# PROJECT: HW Firebase Auth 설정

## 목적
GitHub Pages 배포본에서 이메일 회원가입, 이메일 로그인, Google 로그인을 사용하기 위한 Firebase 1차 연결 기준입니다.

## Firebase 콘솔 설정
1. Firebase 프로젝트를 생성합니다.
2. Authentication에서 아래 제공자를 활성화합니다.
   - Email/Password
   - Google
3. Authentication > Settings > Authorized domains에 아래 도메인을 추가합니다.
   - `cometodlite.github.io`
   - 로컬 확인용으로 필요한 경우 `127.0.0.1`, `localhost`
4. Firestore Database를 생성합니다.

## GitHub Pages 설정 파일
`firebase-config.js`의 빈 값을 Firebase 웹 앱 설정값으로 교체합니다.

```js
window.HW_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Firebase 웹 설정값은 비밀키가 아니지만, Firestore Security Rules는 반드시 설정해야 합니다.

## Firestore 저장 구조
- `users/{uid}`
  - `email`
  - `displayName`
  - `updatedAt`
- `player_states/{uid}`
  - `wallet.coin`
  - `wallet.freeBling`
  - `wallet.paidBling`
  - `wallet.bling`
  - `playerState.inventory`
  - `playerState.housing`
  - `playerState.unlocks`
  - `playerState.lifeSkills`
  - `playerState.activityStats`
  - `playerState.farmPlot`
  - `createdAt`
  - `updatedAt`

## 최소 Firestore Rules 예시
```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /player_states/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 운영 주의
이번 단계의 Firestore 저장은 GitHub Pages 로그인과 클라우드 저장을 위한 1차 구조입니다.

유료 블링 지급, 결제 검증, 환불, 복원, 장부 기록은 클라이언트에서 직접 처리하지 않고 다음 단계에서 Cloud Functions 또는 별도 서버 권한 코드로 이동해야 합니다.
