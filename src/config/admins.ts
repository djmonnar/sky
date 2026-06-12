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
