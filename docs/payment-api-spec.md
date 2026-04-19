# PROJECT: HW 결제 API 설계 초안

## 목적

실제 PG 연동 전에 필요한 결제 API 흐름을 고정한다. 이 문서는 엔드포인트 초안이며, 결제 제공자 선정 후 필드와 서명 검증 방식을 보강한다.

## 결제 플로우

1. 클라이언트가 상품 목록을 조회한다.
2. GitHub Pages 클라이언트는 Firebase 로그인 사용자의 ID 토큰을 `Authorization: Bearer <idToken>`으로 서버에 전달한다.
3. 서버가 `FIREBASE_PROJECT_ID` 기준으로 Firebase ID 토큰을 검증하고 Firebase UID 기준 서버 계정을 준비한다.
4. 로그인 사용자가 결제 요청을 생성한다.
5. 서버가 상품 가격과 판매 상태를 검증한다.
6. 서버가 결제 제공자 주문을 생성한다.
7. 사용자가 웹 결제를 완료한다.
8. 결제 제공자가 서버 콜백을 호출한다.
9. 서버가 결제 결과를 검증한다.
10. 서버가 구매 기록을 `paid`로 변경한다.
11. 서버가 상품 지급을 수행한다.
12. 서버가 구매 기록을 `granted`로 변경한다.
13. 클라이언트가 서버 상태를 재동기화한다.

## 인증 기준

GitHub Pages 배포본은 정적 호스팅이므로 결제 서버 세션 쿠키에 의존하지 않는다. Firebase Auth가 활성화된 환경에서는 모든 보호 API에 Firebase ID 토큰을 Bearer 토큰으로 보낸다.

서버는 다음 항목을 검증한다.

- Firebase 서명 인증서 기반 RS256 서명
- `iss = https://securetoken.google.com/{FIREBASE_PROJECT_ID}`
- `aud = {FIREBASE_PROJECT_ID}`
- `sub` / 만료 시간 / 발급 시간

검증이 끝나면 서버는 `firebase:{uid}` 형식의 내부 `user_id`를 사용하고, `users`, `player_state`, `wallets` 기본 row를 자동 생성한다.

## 엔드포인트 초안

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/products` | 판매 상품 목록 조회 |
| `GET` | `/products/:productId` | 상품 상세 조회 |
| `POST` | `/payments/checkout` | 결제 요청 생성 |
| `POST` | `/payments/webhooks/:provider` | 결제 성공/실패 콜백 수신 |
| `GET` | `/payments/:purchaseId` | 구매 상태 조회 |
| `POST` | `/payments/:purchaseId/sync` | 구매 후 클라이언트 재동기화 |
| `GET` | `/me/purchases` | 내 구매 내역 조회 |
| `GET` | `/me/entitlements` | 내 권한 조회 |
| `POST` | `/me/restore` | 내 계정 복원 동기화 |

## 결제 요청 생성

```ts
type CheckoutRequest = {
  productId: string;
  idempotencyKey: string;
  clientContext: {
    locale: "ko-KR" | "en-US";
    returnUrl: string;
  };
};
```

```ts
type CheckoutResponse = {
  purchaseId: string;
  provider: "web_pg";
  checkoutUrl: string;
  expiresAt: string;
};
```

## 결제 콜백 처리

서버 콜백은 반드시 서명 검증, 금액 검증, 상품 ID 검증, 중복 처리 방지를 수행한다. 콜백을 여러 번 받아도 같은 `purchaseId`는 한 번만 지급되어야 한다.

## 상품 지급 트랜잭션

지급 처리에서 하나라도 실패하면 구매 상태는 `paid` 또는 `grant_failed`로 남기고 재처리 가능해야 한다. 지급 완료 후에만 `granted` 상태로 변경한다.

## 구매 상태

```ts
type PurchaseStatus =
  | "created"
  | "paid"
  | "granting"
  | "granted"
  | "grant_failed"
  | "refund_pending"
  | "refunded"
  | "failed";
```

## 멱등성 규칙

| 작업 | 멱등 키 |
| --- | --- |
| 결제 요청 생성 | 클라이언트 생성 `idempotencyKey` |
| PG 콜백 처리 | `providerTransactionId` |
| 상품 지급 | `purchaseId + productId` |
| 재화 장부 기록 | 지급/소비 트랜잭션 ID |

## 완료 기준

실제 PG를 붙이기 전에 구매 생성, 검증, 지급, 기록, 재동기화 흐름이 서버 API 기준으로 설명되어 있어야 한다.
