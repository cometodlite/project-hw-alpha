# PROJECT: HW 관리자 운영 도구 명세 초안

## 목적

결제 이후에는 운영자가 구매, 지급, 환불, 계정 상태를 확인하고 조치할 수 있어야 한다. 이 문서는 최소 관리자 도구 요구사항을 정의한다.

## 권한 역할

| 역할 | 권한 |
| --- | --- |
| `viewer` | 조회 전용 |
| `support` | 유저/구매/지급/환불 조회, CS 메모 |
| `operator` | 수동 지급, 수동 회수, 환불 상태 갱신 |
| `admin` | 관리자 계정/권한 관리 |

## 최소 화면

| 화면 | 기능 |
| --- | --- |
| 유저 조회 | `userId`, 이메일, 고객지원 코드로 검색 |
| 구매 내역 | 구매 상태, PG 거래 ID, 상품, 가격 조회 |
| 지급 로그 | 지급 성공/실패, 지급 항목 조회 |
| 지갑/장부 | 코인, `freeBling`, `paidBling`, 장부 이력 조회 |
| 권한 조회 | 영구 상품, 시즌 상품, 회수 상태 조회 |
| 환불 상태 | 요청, 검토, 승인, 거절, 완료 상태 조회 |
| 수동 지급 | 운영 사유와 멱등 키를 포함한 지급 |
| 수동 회수 | 지급 항목 회수와 장부 반대 기록 생성 |
| 계정 상태 | 잠금, 해제, 탈퇴 대기 상태 조회 |

## 감사 로그

관리자 액션은 별도 감사 로그를 남긴다.

```ts
type AdminAuditLog = {
  auditId: string;
  adminUserId: string;
  action:
    | "manual_grant"
    | "manual_revoke"
    | "refund_approve"
    | "refund_reject"
    | "account_lock"
    | "account_unlock";
  targetUserId: string;
  targetId: string | null;
  reason: string;
  createdAt: string;
};
```

## 수동 지급 기준

수동 지급은 이벤트 보상, CS 보상, 오류 보정에만 사용한다. 지급 전 사유 입력을 필수로 하고, 지급 후 `grant_records`, `currency_ledger`, `admin_audit_logs`를 함께 남긴다.

## 수동 회수 기준

수동 회수는 환불, 오류 지급, 운영 제재에만 사용한다. 이미 소비된 재화는 마이너스 잔액을 만들지 않는 것을 기본 원칙으로 하며, 부족분은 별도 운영 케이스로 남긴다.

## 완료 기준

운영자가 특정 유저에 대해 "무엇을 샀고, 무엇이 지급됐고, 어떤 장부 변화가 있었고, 환불/복원 상태가 어떤지"를 한 화면 흐름에서 확인할 수 있어야 한다.

