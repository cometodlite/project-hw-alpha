# PROJECT: HW 계정 시스템 명세 초안

## 목적

결제, 서버 저장, 복원, 환불을 연결하려면 "누가 구매했는지"를 안정적으로 식별해야 한다. 이 문서는 결제 도입 전 필요한 최소 계정 구조와 인증 흐름을 정의한다.

## 계정 식별자

| 필드 | 예시 | 설명 |
| --- | --- | --- |
| `userId` | `user_01HWA8...` | 서버 내부의 불변 계정 ID |
| `publicUserCode` | `HW-7K2M-93QA` | 고객지원용 짧은 표시 ID |
| `email` | `player@example.com` | 로그인과 비밀번호 재설정에 사용 |
| `createdAt` | ISO 8601 | 가입 시각 |
| `status` | `active` | `active`, `locked`, `deleted_pending` |

`userId`는 모든 구매, 지급, 저장, 복원, 환불 기록의 외래키가 된다. 이메일은 변경 가능하므로 결제 기록의 기준 키로 사용하지 않는다.

## 최소 사용자 모델

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

## 인증 상태

프론트엔드는 아래 상태만 직접 사용한다.

```ts
type AuthState = {
  status: "checking" | "guest" | "authenticated";
  userId: string | null;
  publicUserCode: string | null;
  displayName: string | null;
  email: string | null;
  sessionExpiresAt: string | null;
};
```

## 권장 인증 방식

웹 전용 기준에서는 서버 세션 또는 짧은 만료 시간을 가진 액세스 토큰을 사용한다. 장기 토큰을 `localStorage`에 보관하는 방식은 피한다. API 도메인과 프론트 도메인 구성이 확정되면 `HttpOnly`, `Secure`, `SameSite` 쿠키 정책을 별도로 확정한다.

## 엔드포인트 초안

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/auth/register` | 회원가입 |
| `POST` | `/auth/login` | 로그인 |
| `POST` | `/auth/logout` | 로그아웃 |
| `GET` | `/auth/me` | 현재 세션 확인 |
| `POST` | `/auth/password-reset/request` | 비밀번호 재설정 메일 요청 |
| `POST` | `/auth/password-reset/confirm` | 재설정 토큰 검증 및 비밀번호 변경 |
| `POST` | `/auth/email/verify/request` | 이메일 인증 요청 |
| `POST` | `/auth/email/verify/confirm` | 이메일 인증 확인 |

## 가입 흐름

1. 사용자가 이메일, 비밀번호, 표시 이름을 입력한다.
2. 서버가 이메일 중복과 비밀번호 정책을 검사한다.
3. 서버가 `userId`와 `publicUserCode`를 생성한다.
4. 서버가 기본 플레이어 저장 데이터를 생성한다.
5. 서버가 인증 세션을 발급한다.
6. 클라이언트가 `/auth/me`와 저장 데이터 동기화를 수행한다.

## 로그인 흐름

1. 클라이언트가 이메일과 비밀번호를 제출한다.
2. 서버가 계정 상태와 비밀번호를 검증한다.
3. 서버가 세션을 발급하고 `lastLoginAt`을 갱신한다.
4. 클라이언트가 서버 저장 데이터, 지갑, 구매/권한 상태를 동기화한다.

## 비밀번호 재설정 흐름

1. 사용자가 이메일을 입력한다.
2. 서버가 계정 존재 여부를 외부에 드러내지 않는 응답을 반환한다.
3. 서버가 단기 만료 토큰을 발급한다.
4. 사용자가 새 비밀번호를 제출한다.
5. 서버가 기존 세션을 무효화하고 새 로그인 절차를 요구한다.

## 결제 연동 조건

결제 요청 생성은 `AuthState.status === "authenticated"`일 때만 가능하다. 결제 API는 `userId`, 상품 ID, 멱등 키를 필수로 요구한다.

