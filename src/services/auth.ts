/* Firebase Auth (이메일/비밀번호) 서비스 */

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { requireAuth, requireDb } from "../lib/firebase";
import type { UserProfile } from "../types/firestore";

export type AuthUser = { uid: string; email: string | null };

export async function signInEmail(
  email: string,
  password: string,
  rememberLogin = true
): Promise<void> {
  const auth = requireAuth();
  await setPersistence(
    auth,
    rememberLogin ? browserLocalPersistence : browserSessionPersistence
  );
  await signInWithEmailAndPassword(auth, email, password);
}

/** 이메일/비밀번호 회원가입. 성공 시 uid/email 반환 */
export async function signUpEmail(
  email: string,
  password: string
): Promise<{ uid: string; email: string | null }> {
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
  return { uid: cred.user.uid, email: cred.user.email };
}

/** 회원가입 직후 본인 users/{uid} 프로필 생성 (rules가 staff 생성만 허용) */
export async function createUserProfile(
  uid: string,
  profile: UserProfile
): Promise<void> {
  await setDoc(doc(requireDb(), "users", uid), {
    ...profile,
    createdAt: serverTimestamp(),
  });
}

export async function signOutUser(): Promise<void> {
  await signOut(requireAuth());
}

/** 로그인 상태 구독. unsubscribe 함수를 반환 */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(requireAuth(), cb);
}

/** users/{uid} 프로필 조회. 문서가 없으면 null */
export async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(requireDb(), "users", uid));
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

/** Firebase 오류 코드를 사용자 친화적 메시지로 변환 */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-email": return "이메일 형식이 올바르지 않습니다.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential": return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "auth/too-many-requests": return "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해주세요.";
    case "auth/network-request-failed": return "네트워크 오류입니다. 연결을 확인해주세요.";
    case "auth/email-already-in-use": return "이미 가입된 이메일입니다. 로그인해주세요.";
    case "auth/weak-password": return "비밀번호는 6자 이상이어야 합니다.";
    case "auth/operation-not-allowed": return "Firebase Console에서 이메일/비밀번호 로그인을 켜주세요.";
    case "profile-create-failed": return "계정은 생성되었지만 직원 프로필 생성에 실패했습니다. 관리자에게 문의해주세요.";
    case "permission-denied": return "프로필 생성 권한이 없습니다. 관리자에게 문의해주세요.";
    default: return "요청에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }
}
