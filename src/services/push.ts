import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
} from "firebase/messaging";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import {
  firebaseWebConfig,
  requireApp,
  requireAuth,
  requireDb,
  STORE_ID,
} from "../lib/firebase";
import type { Role } from "../data/types";

const PUSH_TOKEN_STORAGE_KEY = "haneulttang.pushToken";
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export interface PushTokenOwner {
  uid: string;
  email: string | null;
  role: Role;
  employeeId?: number;
}

export type PushAvailability =
  | "demo"
  | "unsupported"
  | "missing-vapid"
  | "blocked"
  | "needs-permission"
  | "ready";

function tokenDocId(token: string): string {
  return btoa(token).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function swConfigQuery(): string {
  const params = new URLSearchParams();
  Object.entries(firebaseWebConfig).forEach(([key, value]) => {
    params.set(key, value);
  });
  return params.toString();
}

async function registerMessagingWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("이 브라우저는 서비스워커를 지원하지 않습니다.");
  }
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swConfigQuery()}`, {
    scope: "/",
  });
}

function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function getPushAvailability(mode: "demo" | "live"): Promise<PushAvailability> {
  if (mode !== "live") return "demo";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (!(await isSupported())) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "needs-permission";
  return "ready";
}

export function getStoredPushToken(): string {
  return window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) ?? "";
}

export async function enablePushNotifications(owner: PushTokenOwner): Promise<string> {
  if (!(await isSupported())) {
    throw new Error("이 브라우저는 Firebase 푸시 알림을 지원하지 않습니다.");
  }
  const permission = currentPermission();
  if (permission === "unsupported") {
    throw new Error("이 브라우저는 알림 권한 요청을 지원하지 않습니다.");
  }
  const granted =
    permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (granted !== "granted") {
    throw new Error("알림 권한이 허용되지 않았습니다.");
  }

  const swRegistration = await registerMessagingWorker();
  const messaging = getMessaging(requireApp());
  const token = await getToken(messaging, {
    ...(VAPID_KEY ? { vapidKey: VAPID_KEY } : {}),
    serviceWorkerRegistration: swRegistration,
  });
  if (!token) throw new Error("푸시 토큰을 발급받지 못했습니다.");

  await setDoc(
    doc(requireDb(), "stores", STORE_ID, "pushTokens", tokenDocId(token)),
    {
      token,
      storeId: STORE_ID,
      uid: owner.uid,
      email: owner.email ?? "",
      role: owner.role,
      employeeId: owner.employeeId ?? null,
      platform: navigator.platform ?? "",
      userAgent: navigator.userAgent,
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
  window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  return token;
}

export async function disablePushNotifications(): Promise<void> {
  const token = getStoredPushToken();
  if (!token) return;
  const auth = requireAuth();
  const uid = auth.currentUser?.uid;
  if (uid) {
    await updateDoc(
      doc(requireDb(), "stores", STORE_ID, "pushTokens", tokenDocId(token)),
      {
        enabled: false,
        updatedAt: serverTimestamp(),
      }
    );
  }
  try {
    if (await isSupported()) {
      await deleteToken(getMessaging(requireApp()));
    }
  } catch (error) {
    console.warn("[push] token delete skipped", error);
  }
  window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}

export async function sendTestPushNotification(): Promise<string> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const configuredUrl = import.meta.env.VITE_PUSH_TEST_FUNCTION_URL as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const url = configuredUrl || `https://asia-northeast3-${projectId}.cloudfunctions.net/sendTestPush`;
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ source: "dashboard" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || "테스트 푸시 발송에 실패했습니다.");
  }
  return json.message || "테스트 푸시를 보냈습니다.";
}

export async function hasEnabledPushToken(): Promise<boolean> {
  const token = getStoredPushToken();
  if (!token) return false;
  const snap = await getDoc(doc(requireDb(), "stores", STORE_ID, "pushTokens", tokenDocId(token)));
  return snap.exists() && snap.data().enabled !== false;
}

export async function listenForegroundPush(
  onPush: (payload: MessagePayload) => void
): Promise<() => void> {
  if (!(await isSupported())) return () => undefined;
  return onMessage(getMessaging(requireApp()), onPush);
}
