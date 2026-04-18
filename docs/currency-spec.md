# PROJECT: HW 재화 명세

## 목적

블링은 무료 지급과 유료 구매가 섞이는 재화다. 운영, 환불, 복원을 위해 내부 저장은 반드시 `freeBling`과 `paidBling`으로 분리한다.

## 지갑 모델

```ts
type Wallet = {
  userId: string;
  coin: number;
  freeBling: number;
  paidBling: number;
  updatedAt: string;
};
```

UI에서는 `freeBling + paidBling`을 합산해 "블링"으로 표시할 수 있다. 단, 결제/환불/복원/CS 화면에서는 두 값을 분리해서 보여준다.

## 블링 지급 유형

| 유형 | 저장 필드 | 예시 |
| --- | --- | --- |
| 이벤트 보상 | `freeBling` | 출석, 점검 보상 |
| 게임 내 보상 | `freeBling` | 의뢰, 시즌 무료 보상 |
| 유료 충전 | `paidBling` | 블링 팩 구매 |
| 운영 수동 지급 | 사유에 따라 선택 | CS 보상, 오류 보정 |

## 소비 우선순위 초안

기본 초안은 `paidBling`을 먼저 차감한다. 이렇게 하면 유료 재화 사용 여부가 장부에서 명확해지고, 환불 시 미사용 유료 잔액 산정이 단순해진다. 단, 최종 출시 전에는 법무/PG/CS 정책 검토를 통해 `freeBling` 우선 차감 방식과 비교 후 확정한다.

```ts
type BlingSpendRule = {
  priority: ["paidBling", "freeBling"];
  allowMixedSpend: true;
  rejectWhenTotalInsufficient: true;
};
```

## 장부 기록

모든 재화 변동은 `currency_ledger`에 기록한다.

```ts
type CurrencyLedgerEntry = {
  ledgerId: string;
  userId: string;
  currency: "coin" | "freeBling" | "paidBling";
  delta: number;
  balanceAfter: number;
  reason:
    | "game_reward"
    | "purchase_grant"
    | "bling_spend"
    | "refund_reversal"
    | "manual_grant"
    | "manual_revoke";
  sourceType: "game" | "purchase" | "refund" | "admin" | "system";
  sourceId: string | null;
  idempotencyKey: string;
  createdAt: string;
};
```

## 차감 예시

사용자가 `paidBling: 20`, `freeBling: 15`를 보유하고 25 블링 상품을 구매하면 아래처럼 기록한다.

1. `paidBling -20`
2. `freeBling -5`
3. 상품 지급 기록 생성

두 줄의 장부 기록은 같은 `sourceId`와 같은 결제/소비 트랜잭션 ID로 묶는다.

## 환불 관련 기준

유료 블링 환불 가능액은 구매 기록, 지급 기록, `paidBling` 소비 기록을 함께 조회해 산정한다. 이미 소비된 `paidBling`은 기본적으로 환불 불가 상태로 처리한다.

## 완료 기준

- `freeBling`과 `paidBling`이 내부적으로 분리된다.
- 모든 획득/소비/회수/환불이 장부에 남는다.
- 유료 블링 미사용분을 계산할 수 있다.

