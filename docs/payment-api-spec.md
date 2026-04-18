# PROJECT: HW 결제 API 설계 초안

## 목적

실제 PG 연동 전에 필요한 결제 API 흐름을 고정한다. 이 문서는 엔드포인트 초안이며, 결제 제공자 선정 후 필드와 서명 검증 방식을 보강한다.

## 결제 플로우

1. 클라이언트가 상품 목록을 조회한다.
2. 로그인 사용자가 결제 요청을 생성한다.
3. 서버가 상품 가격과 판매 상태를 검증한다.
4. 서버가 결제 제공자 주문을 생성한다.
5. 사용자가 웹 결제를 완료한다.
6. 결제 제공자가 서버 콜백을 호출한다.
7. 서버가 결제 결과를 검증한다.
8. 서버가 구매 기록을 `paid`로 변경한다.
9. 서버가 상품 지급을 수행한다.
10. 서버가 구매 기록을 `granted`로 변경한다.
11. 클라이언트가 서버 상태를 재동기화한다.

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

