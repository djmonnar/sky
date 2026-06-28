import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatCard } from "../components/ui";
import type { Vendor } from "../data/types";

const EMPTY_VENDOR: Vendor = {
  id: 0,
  name: "",
  businessNumber: "",
  address: "",
  contactName: "",
  phone: "",
  email: "",
  bank: "",
  account: "",
  memo: "",
  active: true,
};

function nextVendorId(vendors: Vendor[]): number {
  return Math.max(0, ...vendors.map((vendor) => vendor.id)) + 1;
}

export default function Vendors() {
  const { vendors, upsertVendor, deleteVendor, showToast } = useStore();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Vendor>(EMPTY_VENDOR);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((vendor) =>
      [vendor.name, vendor.businessNumber, vendor.address, vendor.contactName, vendor.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [query, vendors]);

  const updateDraft = <K extends keyof Vendor>(key: K, value: Vendor[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setDraft(EMPTY_VENDOR);
    setEditingId(null);
  };

  const editVendor = (vendor: Vendor) => {
    setDraft({ ...vendor });
    setEditingId(vendor.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveVendor = () => {
    const name = draft.name.trim();
    const businessNumber = draft.businessNumber.trim();
    const address = draft.address.trim();
    if (!name) {
      showToast("거래처명을 입력해주세요");
      return;
    }
    if (!businessNumber) {
      showToast("사업자번호를 입력해주세요");
      return;
    }
    if (!address) {
      showToast("주소를 입력해주세요");
      return;
    }

    const vendor: Vendor = {
      ...draft,
      id: editingId ?? nextVendorId(vendors),
      name,
      businessNumber,
      address,
      contactName: draft.contactName?.trim(),
      phone: draft.phone?.trim(),
      email: draft.email?.trim(),
      bank: draft.bank?.trim(),
      account: draft.account?.trim(),
      memo: draft.memo?.trim(),
      active: true,
      createdAt: draft.createdAt ?? new Date().toISOString(),
    };
    upsertVendor(vendor);
    showToast(editingId ? "거래처 정보를 수정했습니다" : "거래처를 등록했습니다");
    resetForm();
  };

  const removeVendor = (vendor: Vendor) => {
    if (!window.confirm(`${vendor.name} 거래처를 삭제할까요?`)) return;
    deleteVendor(vendor.id);
    if (editingId === vendor.id) resetForm();
    showToast("거래처를 삭제했습니다");
  };

  return (
    <>
      <div className="grid grid-3">
        <StatCard label="등록 거래처" value={vendors.length} unit="곳" trend="식자재/소모품 포함" trendUp icon="🏢" />
        <StatCard label="주소 등록" value={vendors.filter((vendor) => vendor.address).length} unit="곳" trend="배송 확인용" trendUp icon="📍" tone="blue" />
        <StatCard label="사업자번호" value={vendors.filter((vendor) => vendor.businessNumber).length} unit="건" trend="정산 자료" trendUp icon="🧾" tone="amber" />
      </div>

      <Card
        title={editingId ? "거래처 수정" : "거래처 등록"}
        icon="🏢"
        action={editingId ? <button className="btn btn-outline btn-sm" onClick={resetForm}>새 거래처</button> : undefined}
      >
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div>
            <label className="field-label">거래처명</label>
            <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder="예: 하늘식자재" />
          </div>
          <div>
            <label className="field-label">사업자번호</label>
            <input className="input" value={draft.businessNumber} onChange={(e) => updateDraft("businessNumber", e.target.value)} placeholder="000-00-00000" />
          </div>
          <div>
            <label className="field-label">담당자</label>
            <input className="input" value={draft.contactName ?? ""} onChange={(e) => updateDraft("contactName", e.target.value)} placeholder="담당자명" />
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
          <div>
            <label className="field-label">연락처</label>
            <input className="input" value={draft.phone ?? ""} onChange={(e) => updateDraft("phone", e.target.value)} placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="field-label">이메일</label>
            <input className="input" value={draft.email ?? ""} onChange={(e) => updateDraft("email", e.target.value)} placeholder="order@example.com" />
          </div>
          <div>
            <label className="field-label">은행/계좌</label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={draft.bank ?? ""} onChange={(e) => updateDraft("bank", e.target.value)} placeholder="은행" />
              <input className="input" value={draft.account ?? ""} onChange={(e) => updateDraft("account", e.target.value)} placeholder="계좌번호" />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">주소</label>
          <input className="input" value={draft.address} onChange={(e) => updateDraft("address", e.target.value)} placeholder="거래처 주소" />
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">메모</label>
          <textarea className="textarea" value={draft.memo ?? ""} onChange={(e) => updateDraft("memo", e.target.value)} placeholder="납품 품목, 주문 시간, 특이사항" />
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-outline" onClick={resetForm}>취소</button>
          <button className="btn btn-primary" onClick={saveVendor}>{editingId ? "수정 저장" : "거래처 등록"}</button>
        </div>
      </Card>

      <Card
        title="거래처 목록"
        icon="📋"
        action={
          <input
            className="input"
            style={{ width: 240 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처 검색"
          />
        }
      >
        <div className="table-wrap">
          <table className="table vendor-table">
            <thead>
              <tr>
                <th>거래처</th>
                <th>사업자번호</th>
                <th>주소</th>
                <th>담당자</th>
                <th>연락처</th>
                <th>계좌</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((vendor) => (
                <tr key={vendor.id}>
                  <td className="bold">{vendor.name}</td>
                  <td className="num">{vendor.businessNumber}</td>
                  <td>{vendor.address}</td>
                  <td>{vendor.contactName || "-"}</td>
                  <td className="num">{vendor.phone || "-"}</td>
                  <td>{vendor.bank || vendor.account ? `${vendor.bank ?? ""} ${vendor.account ?? ""}`.trim() : "-"}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => editVendor(vendor)}>수정</button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeVendor(vendor)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    등록된 거래처가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
