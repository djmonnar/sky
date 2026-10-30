import { useCallback, useEffect, useState } from "react";
import { APP_MODE, useStore } from "../store";
import type {
  ChecklistDay, ChecklistSection, ChecklistTemplate, ChecklistTemplateItem, KakaoMemoLink,
  KakaoMemoReportType, KakaoMemoSchedule,
} from "../data/types";
import { exampleTemplate } from "../lib/checklist";
import {
  callChecklistApi, fsSaveChecklistNote, fsSaveChecklistTemplate, fsSetChecklistCheck,
  subscribeChecklistDay, subscribeChecklistTemplate, subscribeKakaoMemoLinks, subscribeKakaoMemoSchedule,
} from "../services/checklist";

/*
  체크리스트 화면이 쓰는 것 한 묶음. 운영은 Firestore·함수, 데모는 메모리.

  전역 store 에 넣지 않았다 — 체크리스트는 이 화면에서만 쓰고, 날짜를 바꿀 때마다
  그 하루치만 구독하면 된다(지난 기록을 전부 들고 있을 이유가 없다).
*/

export interface ChecklistSendResult {
  text: string;
  delivered: string[];
  failed: { label: string; message: string }[];
}

export interface ChecklistInvite {
  url: string;
  expiresAtMs: number;
  label: string;
}

type RowRef = { id: string; text: string; section: ChecklistSection };

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── 데모: 메모리에 두고 바뀌면 알린다 ── */

const demo = {
  template: {
    items: [
      ...exampleTemplate(makeId),
      { id: "demo-weekly", section: "close" as const, text: "튀김기 기름 교체", days: [1] },
    ],
  } as ChecklistTemplate | null,
  days: new Map<string, ChecklistDay>(),
  links: [
    { id: "demo-1", label: "사장님", nickname: "데모", linkedAt: "2026-06-01 10:00", active: true, lastError: null, lastSentAt: null },
  ] as KakaoMemoLink[],
  schedule: {} as KakaoMemoSchedule,
  listeners: new Set<() => void>(),
};
const notifyDemo = () => demo.listeners.forEach((fn) => fn());
const demoDay = (date: string): ChecklistDay => demo.days.get(date) ?? { date, checks: {}, note: "" };

export function useChecklist(date: string) {
  const { role, profile, authUser, currentEmployee } = useStore();
  const isAdmin = role === "admin";
  const actorName = APP_MODE === "live"
    ? profile?.name ?? authUser?.email ?? "사용자"
    : role === "admin" ? "김지현" : currentEmployee?.name ?? "직원";

  const [template, setTemplate] = useState<ChecklistTemplate | null>(null);
  const [day, setDay] = useState<ChecklistDay | null>(null);
  const [links, setLinks] = useState<KakaoMemoLink[]>([]);
  const [schedule, setSchedule] = useState<KakaoMemoSchedule>({});
  const [loaded, setLoaded] = useState({ template: false, day: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded({ template: false, day: false });
    if (APP_MODE !== "live") {
      const sync = () => {
        setTemplate(demo.template);
        setDay(demo.days.get(date) ?? null);
        setLinks([...demo.links]);
        setSchedule({ ...demo.schedule });
        setLoaded({ template: true, day: true });
      };
      sync();
      demo.listeners.add(sync);
      return () => { demo.listeners.delete(sync); };
    }
    const onError = (e: Error) => setError(e.message);
    const offTemplate = subscribeChecklistTemplate((v) => { setTemplate(v); setLoaded((s) => ({ ...s, template: true })); }, onError);
    const offDay = subscribeChecklistDay(date, (v) => { setDay(v); setLoaded((s) => ({ ...s, day: true })); }, onError);
    // 받는 곳 목록은 관리자만 읽을 수 있다(규칙) — 직원 화면은 구독하지 않는다
    const offLinks = isAdmin ? subscribeKakaoMemoLinks(setLinks, onError) : () => undefined;
    const offSchedule = isAdmin ? subscribeKakaoMemoSchedule(setSchedule, onError) : () => undefined;
    return () => { offTemplate(); offDay(); offLinks(); offSchedule(); };
  }, [date, isAdmin]);

  const setChecked = useCallback(async (row: RowRef, checked: boolean) => {
    if (APP_MODE === "live") {
      await fsSetChecklistCheck(date, row, checked, actorName);
      return;
    }
    const current = demoDay(date);
    demo.days.set(date, {
      ...current,
      checks: { ...current.checks, [row.id]: { checked, text: row.text, section: row.section, by: actorName, at: nowText() } },
    });
    notifyDemo();
  }, [actorName, date]);

  const saveNote = useCallback(async (note: string) => {
    if (APP_MODE === "live") {
      await fsSaveChecklistNote(date, note, actorName);
      return;
    }
    demo.days.set(date, { ...demoDay(date), note, noteBy: actorName, noteAt: nowText() });
    notifyDemo();
  }, [actorName, date]);

  const saveTemplate = useCallback(async (items: ChecklistTemplateItem[]) => {
    if (APP_MODE === "live") {
      await fsSaveChecklistTemplate(items, actorName);
      return;
    }
    demo.template = { items, updatedBy: actorName, updatedAt: nowText() };
    notifyDemo();
  }, [actorName]);

  const send = useCallback(async (): Promise<ChecklistSendResult> => {
    if (APP_MODE === "live") return callChecklistApi<ChecklistSendResult>({ action: "send", date });
    const active = demo.links.filter((link) => link.active);
    demo.days.set(date, { ...demoDay(date), sent: { at: nowText(), by: actorName, delivered: active.length, failed: 0 } });
    notifyDemo();
    return { text: "(데모 모드 — 실제로 보내지 않았습니다)", delivered: active.map((link) => link.label), failed: [] };
  }, [actorName, date]);

  const createInvite = useCallback(async (label: string): Promise<ChecklistInvite> => {
    if (APP_MODE === "live") return callChecklistApi<ChecklistInvite>({ action: "invite", label });
    return { url: "https://asia-northeast3-skyearth-84a78.cloudfunctions.net/kakaoMemoAuth?invite=demo", expiresAtMs: Date.now() + 86_400_000, label };
  }, []);

  /** 자동으로 가는 것(11시 오늘 예약·22시 30분 일일 정산·월요일 9시 주간 보고)을 지금 시험으로 보낸다 */
  const sendReport = useCallback(async (type: KakaoMemoReportType): Promise<ChecklistSendResult> => {
    if (APP_MODE === "live") {
      const action = { reservations: "sendReservations", settlement: "sendSettlement", weekly: "sendWeekly" }[type];
      return callChecklistApi<ChecklistSendResult>({ action });
    }
    const active = demo.links.filter((link) => link.active);
    demo.schedule = {
      ...demo.schedule,
      [type]: { date: date, status: active.length ? "sent" : "no_links", trigger: "test", by: actorName, delivered: active.length, failed: 0, at: nowText() },
    };
    notifyDemo();
    const demoText = {
      reservations: "[하늘땅] 오늘 예약 3팀 · 11명\n11:50 최미선 3명\n12:00 정미자 4명\n18:00 김하늘 4명 창가",
      settlement: "[하늘땅] 일일 정산\n매출 7,503,100원 (네이버)\n이번 달 110,214,800원 · 18일\n매입 90,000원 · 1건\n인건비 1,350,000원(매출의 18%)\n예약 5팀 22명\n체크리스트 오픈 4/4 · 마감 3/4",
      weekly: "[하늘땅] 주간 보고 6/1(월)~6/7(일)\n매출 52,000,000원 · 전주 대비 +8%\n매입 3,000,000원 · 인건비 10,400,000원(매출의 20%)\n고정비 1,400,000원 → 이익 추정 37,200,000원\n예약 40팀 150명 · 노쇼 2팀(5%) · 재방문 11팀",
    }[type];
    return {
      text: `(데모 — 실제로 보내지 않았습니다)\n${demoText}`,
      delivered: active.map((link) => link.label),
      failed: [],
    };
  }, [actorName, date]);

  const unlink = useCallback(async (linkId: string) => {
    if (APP_MODE === "live") {
      await callChecklistApi({ action: "unlink", linkId });
      return;
    }
    demo.links = demo.links.filter((link) => link.id !== linkId);
    notifyDemo();
  }, []);

  return {
    isAdmin,
    actorName,
    loading: !loaded.template || !loaded.day,
    error,
    template,
    day,
    links,
    schedule,
    sendReport,
    setChecked,
    saveNote,
    saveTemplate,
    send,
    createInvite,
    unlink,
  };
}
