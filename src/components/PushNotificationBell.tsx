import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushAvailability,
  hasEnabledPushToken,
  listenForegroundPush,
  sendTestPushNotification,
  type PushAvailability,
} from "../services/push";

const STATUS_TEXT: Record<PushAvailability, string> = {
  demo: "데모 모드에서는 푸시 알림을 사용할 수 없어요.",
  unsupported: "이 브라우저에서는 푸시 알림이 지원되지 않아요.",
  "missing-vapid": "Firebase Web Push 인증키가 아직 설정되지 않았어요.",
  blocked: "브라우저에서 알림 권한이 차단되어 있어요.",
  "needs-permission": "이 기기에서 알림 권한을 허용해야 해요.",
  ready: "이 기기에서 푸시 알림을 받을 수 있어요.",
};

export default function PushNotificationBell() {
  const { mode, authUser, profile, role, showToast } = useStore();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<PushAvailability>("unsupported");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getPushAvailability(mode);
      setAvailability(next);
      setEnabled(next === "ready" ? await hasEnabledPushToken().catch(() => false) : false);
    } catch {
      setAvailability("unsupported");
      setEnabled(false);
    }
  }, [mode]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (mode !== "live") return;
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    listenForegroundPush((payload) => {
      const title = payload.notification?.title ?? "새 알림";
      const body = payload.notification?.body ?? "";
      showToast(body ? `${title}: ${body}` : title);
    }).then((nextUnsubscribe) => {
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [mode, showToast]);

  const handleEnable = async () => {
    if (!authUser || !profile) {
      showToast("로그인 후 사용할 수 있어요");
      return;
    }
    setBusy(true);
    try {
      await enablePushNotifications({
        uid: authUser.uid,
        email: authUser.email,
        role,
        employeeId: profile.employeeId,
      });
      setEnabled(true);
      await refreshStatus();
      showToast("이 기기에서 푸시 알림을 받을게요");
    } catch (error) {
      showToast((error as Error).message);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await disablePushNotifications();
      setEnabled(false);
      await refreshStatus();
      showToast("이 기기의 푸시 알림을 껐어요");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const message = await sendTestPushNotification();
      showToast(message);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canEnable = availability === "ready" || availability === "needs-permission";

  return (
    <div className="push-bell">
      <button
        className={`icon-btn ${enabled ? "push-enabled" : ""}`}
        aria-label="푸시 알림"
        onClick={() => setOpen((prev) => !prev)}
      >
        🔔
        {enabled && <span className="dot" />}
      </button>
      {open && (
        <div className="push-panel">
          <div className="push-panel-title">푸시 알림</div>
          <p>{enabled ? "이 기기에 알림이 켜져 있어요." : STATUS_TEXT[availability]}</p>
          <p className="muted small">
            카카오톡 인앱브라우저에서는 푸시가 제한될 수 있어요. 휴대폰 브라우저 또는 홈 화면 앱에서 켜주세요.
          </p>
          <div className="push-actions">
            {!enabled && (
              <button className="btn btn-primary btn-sm" disabled={!canEnable || busy} onClick={handleEnable}>
                켜기
              </button>
            )}
            {enabled && (
              <>
                <button className="btn btn-soft btn-sm" disabled={busy} onClick={handleTest}>
                  테스트
                </button>
                <button className="btn btn-outline btn-sm" disabled={busy} onClick={handleDisable}>
                  끄기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
