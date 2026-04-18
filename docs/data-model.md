# PROJECT: HW 서버 데이터 모델 초안

## 목적

결제와 계정 기반 저장을 위해 필요한 서버 모델을 논리 구조로 정의한다. 실제 ORM, DB, 파일 확장자는 서버 기술 스택이 정해진 뒤 확정한다.

## 모델 목록

| 모델 | 역할 |
| --- | --- |
| `User` | 계정 식별 |
| `PlayerSave` | 게임 진행 상태 |
| `Wallet` | 코인, 무료 블링, 유료 블링 |
| `Product` | 판매 상품 정의 |
| `Purchase` | 결제/구매 기록 |
| `GrantRecord` | 상품 지급 기록 |
| `Entitlement` | 영구 권한/상품 보유 |
| `CurrencyLedger` | 재화 변동 장부 |
| `RefundCase` | 환불 처리 상태 |
| `RestoreEvent` | 복원/동기화 기록 |

## User

```ts
type User = {
  userId: string;
  publicUserCode: string;
  email: string;
  emailVerifiedAt: string | null;
  passwordHash: string;
  displayName: string;
  status: "active" | "locked" | "deleted_pending";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};
```

## PlayerSave

```ts
type PlayerSave = {
  userId: string;
  saveVersion: number;
  schemaVersion: string;
  coin: number;
  inventory: Record<string, number>;
  housing: {
    slots: Array<string | null>;
  };
  unlocks: Record<string, boolean>;
  lifeSkills: {
    gathering: number;
    fishing: number;
    farming: number;
  };
  updatedAt: string;
};
```

## Wallet

```ts
type Wallet = {
  userId: string;
  coin: number;
  freeBling: number;
  paidBling: number;
  updatedAt: string;
};
```

## Purchase

```ts
type Purchase = {
  purchaseId: string;
  userId: string;
  productId: string;
  provider: "web_pg" | "manual";
  providerTransactionId: string | null;
  status: "created" | "paid" | "granted" | "refund_pending" | "refunded" | "failed";
  price: number;
  currency: "KRW" | "USD";
  idempotencyKey: string;
  paidAt: string | null;
  grantedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## GrantRecord

```ts
type GrantRecord = {
  grantId: string;
  userId: string;
  purchaseId: string | null;
  productId: string | null;
  rewardData: ProductRewardData;
  status: "pending" | "granted" | "revoked" | "failed";
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};
```

## Entitlement

```ts
type Entitlement = {
  entitlementId: string;
  userId: string;
  productId: string;
  entitlementType: "furniture_pack" | "season_pack" | "support_pack";
  status: "active" | "revoked";
  purchaseId: string | null;
  grantedAt: string;
  revokedAt: string | null;
};
```

## CurrencyLedger

```ts
type CurrencyLedger = {
  ledgerId: string;
  userId: string;
  currency: "coin" | "freeBling" | "paidBling";
  delta: number;
  balanceAfter: number;
  reason: string;
  sourceType: "game" | "purchase" | "refund" | "admin" | "system";
  sourceId: string | null;
  idempotencyKey: string;
  createdAt: string;
};
```

## RefundCase

```ts
type RefundCase = {
  refundId: string;
  userId: string;
  purchaseId: string;
  status: "requested" | "reviewing" | "approved" | "rejected" | "completed";
  requestedReason: string | null;
  refundableAmount: number;
  currency: "KRW" | "USD";
  revokeRequired: boolean;
  createdAt: string;
  updatedAt: string;
};
```

## RestoreEvent

```ts
type RestoreEvent = {
  restoreEventId: string;
  userId: string;
  status: "completed" | "failed";
  restoredPurchaseCount: number;
  restoredEntitlementCount: number;
  syncedWallet: boolean;
  createdAt: string;
};
```

## 설계 원칙

구매 기록은 삭제하지 않고 상태를 변경한다. 지급 기록과 장부 기록은 회수/환불 시에도 원본을 보존하고 반대 방향 기록을 추가한다. 이 방식은 CS, 감사, 복원 처리에 필요한 이력을 유지한다.

