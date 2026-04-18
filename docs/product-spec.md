# PROJECT: HW 상품 구조 명세

## 목적

무엇을 어떻게 판매할지 상품 스키마를 먼저 고정한다. 결제 도입 전에는 상품 데이터가 결제 금액, 지급 보상, 반복 구매 가능 여부, 판매 기간을 모두 설명해야 한다.

## 상품 타입

| 타입 | 설명 |
| --- | --- |
| `bling_pack` | 유료 블링 충전 상품 |
| `direct_pack` | 현금 결제 후 아이템/재화를 직접 지급하는 상품 |
| `furniture_pack` | 가구 또는 하우징 테마 상품 |
| `season_pack` | 기간 한정 시즌 상품 |
| `support_pack` | 후원/응원 성격의 상품 |

## 필수 필드

| 필드 | 설명 |
| --- | --- |
| `productId` | 불변 상품 ID |
| `name` | 사용자 표시명 |
| `type` | 상품 타입 |
| `price` | 판매 가격 |
| `currency` | `KRW`, `USD`, `paidBling`, `freeBling`, `bling` 중 하나 |
| `rewardData` | 지급 보상 구조 |
| `isRepeatable` | 반복 구매 가능 여부 |
| `saleStartAt` | 판매 시작 시각 또는 `null` |
| `saleEndAt` | 판매 종료 시각 또는 `null` |
| `isActive` | 운영 활성 여부 |

## 상품 모델

```ts
type Product = {
  productId: string;
  name: string;
  type: "bling_pack" | "direct_pack" | "furniture_pack" | "season_pack" | "support_pack";
  description: string;
  price: number;
  currency: "KRW" | "USD" | "paidBling" | "freeBling" | "bling";
  rewardData: ProductRewardData;
  isRepeatable: boolean;
  saleStartAt: string | null;
  saleEndAt: string | null;
  isActive: boolean;
  tags: string[];
};
```

## 보상 모델

```ts
type ProductRewardData = {
  coin?: number;
  freeBling?: number;
  paidBling?: number;
  items?: Array<{
    itemId: string;
    amount: number;
  }>;
  entitlements?: Array<{
    entitlementType: "furniture_pack" | "season_pack" | "support_pack";
    entitlementKey: string;
  }>;
};
```

## 상품 예시

```json
{
  "productId": "bling_pack_1000_krw",
  "name": "블링 1000",
  "type": "bling_pack",
  "description": "유료 블링 1000개를 충전합니다.",
  "price": 11000,
  "currency": "KRW",
  "rewardData": {
    "paidBling": 1000
  },
  "isRepeatable": true,
  "saleStartAt": null,
  "saleEndAt": null,
  "isActive": true,
  "tags": ["bling", "web"]
}
```

## 운영 규칙

1. `productId`는 출시 후 의미를 바꾸지 않는다.
2. 가격 변경은 새 상품 ID를 만들거나 가격 이력 테이블로 관리한다.
3. `isActive: false` 상품은 신규 구매만 막고 기존 구매/복원 기록은 유지한다.
4. 기간 한정 상품은 서버 시간이 `saleStartAt`과 `saleEndAt` 사이일 때만 구매 가능하다.
5. 직접 현금 상품도 반드시 구매 기록과 지급 기록을 남긴다.

## 관련 파일

예시 JSON과 JSON Schema는 `data/products/`에 둔다.

