/* ============================================================
   Firebase 초기화

   - 모든 설정값은 Vite 환경변수(import.meta.env.VITE_FIREBASE_*)로
     주입합니다. 코드에 하드코딩하지 마세요.
   - 웹 API 키는 공개되어도 되는 식별자이지만, Admin SDK 서비스
     계정 키 / private key는 절대 프론트 코드에 넣지 마세요.
   - 환경변수가 없으면 앱은 죽지 않고 "데모 모드"로 동작합니다.
   ============================================================ */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

const env = import.meta.env;

const REQUIRED_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

export const missingFirebaseKeys: string[] = REQUIRED_KEYS.filter(
  (k) => !env[k]
);
export const firebaseConfigured = missingFirebaseKeys.length === 0;

function cleanEnvValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/^\uFEFF/, "").trim() : "";
}

/** 매장 ID (Firestore 최상위 stores/{storeId}) */
export const STORE_ID = cleanEnvValue(env.VITE_FIREBASE_STORE_ID) || "haneulttang";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

if (firebaseConfigured) {
  app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  // ignoreUndefinedProperties: 선택 필드(roleLabel 등)가 undefined여도 쓰기 허용
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  auth = getAuth(app);
} else {
  // 개발자가 원인을 바로 알 수 있도록 명확히 안내
  console.warn(
    `[firebase] 환경변수 누락으로 데모 모드로 동작합니다.\n` +
      `누락: ${missingFirebaseKeys.join(", ")}\n` +
      `.env 파일을 생성하고 .env.example을 참고해 값을 채워주세요.`
  );
}

export function requireDb(): Firestore {
  if (!db) {
    throw new Error(
      `Firebase가 설정되지 않았습니다. 누락된 환경변수: ${missingFirebaseKeys.join(", ")}`
    );
  }
  return db;
}

export function requireAuth(): Auth {
  if (!auth) {
    throw new Error(
      `Firebase Auth가 설정되지 않았습니다. 누락된 환경변수: ${missingFirebaseKeys.join(", ")}`
    );
  }
  return auth;
}

/* Analytics는 선택 사항: 필요해지면 아래처럼 별도 동적 로드
   (측정 ID 없는 프로젝트에서 오류를 내지 않도록 분리해둠)

   export async function initAnalytics() {
     if (!app) return null;
     const { getAnalytics, isSupported } = await import("firebase/analytics");
     return (await isSupported()) ? getAnalytics(app) : null;
   }
*/
