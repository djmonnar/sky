/**
 * 부트스트랩 관리자 설정 (하드코딩)
 *
 * 이 파일은 초기 배포 단계에서 Firestore에 관리자 프로필이 없을 때도
 * 앱이 관리자를 인식할 수 있도록 이메일을 직접 목록에 넣어 관리한다.
 * firestore.rules 의 isConfiguredAdmin() 도 동일한 UID/이메일을 사용한다.
 *
 * 장기적으로는 Firestore users/{uid}.role == "admin" 문서를 기반으로
 * 인증하고, 이 파일의 의존도를 줄이는 방향을 권장한다.
 *
 * 새 관리자 추가 시:
 *   1. ADMIN_EMAILS에 이메일 추가
 *   2. firestore.rules isConfiguredAdmin()에 해당 uid 또는 email 추가
 *   3. firebase deploy --only firestore:rules 로 배포
 */
import { STORE_ID } from "../lib/firebase";
import type { UserProfile } from "../types/firestore";

const ADMIN_EMAILS = new Set([
  "iu431214@gmail.com",
  "djmonnar4@gmail.com",
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase());
}

export function adminProfileForEmail(email: string): UserProfile {
  return {
    name: email,
    role: "admin",
    storeId: STORE_ID,
    active: true,
  };
}
