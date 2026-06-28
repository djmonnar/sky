import { useMemo, useState } from "react";
import type { Employee, EmploymentType } from "../data/types";
import { TODAY_STR } from "../data";
import { employmentLabel, salaryTypeLabel } from "../lib/payroll";

interface Props {
  employee: Employee;
  onClose: () => void;
  showToast: (message: string) => void;
}

type ContractType = EmploymentType;

interface ContractDraft {
  contractType: ContractType;
  startDate: string;
  endDate: string;
  workplace: string;
  jobDescription: string;
  workDays: string;
  workStart: string;
  workEnd: string;
  breakTime: string;
  weeklyHoliday: string;
  partTimeSchedule: string;
  wageType: string;
  wageAmount: string;
  bonus: string;
  allowances: string;
  payDay: string;
  payMethod: string;
  annualLeave: string;
  insurance: string[];
  employerName: string;
  employerPhone: string;
  employerAddress: string;
  businessNumber: string;
  issueDate: string;
  notes: string;
}

const INSURANCE_OPTIONS = ["고용보험", "산재보험", "국민연금", "건강보험"];

function moneyValue(employee: Employee): string {
  const value = employee.salaryType === "monthly"
    ? employee.monthlySalary
    : employee.salaryType === "perSlot"
      ? employee.slotRate
      : employee.hourly;
  return value ? String(value) : "";
}

function formatMoney(value: string): string {
  const n = Number(value.replace(/[^0-9]/g, ""));
  return n ? `${n.toLocaleString("ko-KR")}원` : "________원";
}

function defaultDraft(employee: Employee): ContractDraft {
  const contractType: ContractType = employee.employmentType === "fullTime" ? "fullTime" : "partTime";
  const workStart = employee.standardStart ?? "10:00";
  const workEnd = employee.standardEnd ?? "22:00";
  return {
    contractType,
    startDate: TODAY_STR,
    endDate: "",
    workplace: "하늘땅",
    jobDescription: `${employee.role}${employee.roleLabel ? ` / ${employee.roleLabel}` : ""}`,
    workDays: contractType === "fullTime" ? "매장 근무표에 따름" : "근무표에 따름",
    workStart,
    workEnd,
    breakTime: "근로기준법에 따라 근로시간 중 부여",
    weeklyHoliday: "근무표에 따름",
    partTimeSchedule: "근무일 및 근로일별 근로시간은 매장 근무표에 따름",
    wageType: salaryTypeLabel(employee),
    wageAmount: moneyValue(employee),
    bonus: "없음",
    allowances: "없음",
    payDay: "매월 10일",
    payMethod: employee.bank || employee.account
      ? `${employee.bank ?? ""} ${employee.account ?? ""} 계좌이체`.trim()
      : "근로자 명의 예금통장 입금",
    annualLeave: contractType === "fullTime"
      ? "근로기준법에서 정하는 바에 따라 부여"
      : "근로기준법에서 정하는 바에 따라 근로시간에 비례하여 부여",
    insurance: [...INSURANCE_OPTIONS],
    employerName: "하늘땅",
    employerPhone: "",
    employerAddress: "",
    businessNumber: "",
    issueDate: TODAY_STR,
    notes: "기타 근로조건은 근로기준법 및 사업장 운영규정에 따른다.",
  };
}

export default function EmploymentContractBuilder({ employee, onClose, showToast }: Props) {
  const [draft, setDraft] = useState<ContractDraft>(() => defaultDraft(employee));
  const title = draft.contractType === "fullTime"
    ? "표준근로계약서"
    : "단시간근로자 표준근로계약서";
  const employeeMeta = useMemo(
    () => `${employmentLabel(employee)} · ${salaryTypeLabel(employee)} · #${employee.id}`,
    [employee]
  );

  const update = <K extends keyof ContractDraft>(key: K, value: ContractDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const setContractType = (contractType: ContractType) => {
    setDraft((prev) => ({
      ...prev,
      contractType,
      annualLeave: contractType === "fullTime"
        ? "근로기준법에서 정하는 바에 따라 부여"
        : "근로기준법에서 정하는 바에 따라 근로시간에 비례하여 부여",
      workDays: contractType === "fullTime" ? prev.workDays || "매장 근무표에 따름" : prev.workDays || "근무표에 따름",
    }));
  };

  const toggleInsurance = (name: string) => {
    setDraft((prev) => ({
      ...prev,
      insurance: prev.insurance.includes(name)
        ? prev.insurance.filter((item) => item !== name)
        : [...prev.insurance, name],
    }));
  };

  const printContract = () => {
    document.body.classList.add("printing-contract");
    const cleanup = () => document.body.classList.remove("printing-contract");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1200);
    showToast(`${employee.name} 근로계약서 인쇄 화면을 열었습니다`);
  };

  return (
    <section className="contract-builder">
      <div className="contract-builder-head no-print">
        <div>
          <h3>{employee.name} 근로계약서 작성</h3>
          <p className="muted small">{employeeMeta}</p>
        </div>
        <div className="row">
          <button className="btn btn-outline btn-sm" onClick={onClose}>닫기</button>
          <button className="btn btn-primary btn-sm" onClick={printContract}>인쇄하기</button>
        </div>
      </div>

      <div className="contract-layout">
        <div className="contract-form no-print">
          <div className="segmented contract-type-toggle">
            <button className={draft.contractType === "fullTime" ? "on" : ""} onClick={() => setContractType("fullTime")}>
              정직원용
            </button>
            <button className={draft.contractType === "partTime" ? "on" : ""} onClick={() => setContractType("partTime")}>
              아르바이트용
            </button>
          </div>

          <div className="contract-form-grid">
            <label>
              <span className="field-label">근로개시일</span>
              <input className="input" type="date" value={draft.startDate} onChange={(e) => update("startDate", e.target.value)} />
            </label>
            <label>
              <span className="field-label">종료일</span>
              <input className="input" type="date" value={draft.endDate} onChange={(e) => update("endDate", e.target.value)} />
            </label>
            <label>
              <span className="field-label">근무장소</span>
              <input className="input" value={draft.workplace} onChange={(e) => update("workplace", e.target.value)} />
            </label>
            <label>
              <span className="field-label">업무내용</span>
              <input className="input" value={draft.jobDescription} onChange={(e) => update("jobDescription", e.target.value)} />
            </label>
            <label>
              <span className="field-label">근무일</span>
              <input className="input" value={draft.workDays} onChange={(e) => update("workDays", e.target.value)} />
            </label>
            <label>
              <span className="field-label">주휴일</span>
              <input className="input" value={draft.weeklyHoliday} onChange={(e) => update("weeklyHoliday", e.target.value)} />
            </label>
            <label>
              <span className="field-label">시작시간</span>
              <input className="input" value={draft.workStart} onChange={(e) => update("workStart", e.target.value)} placeholder="10:00" />
            </label>
            <label>
              <span className="field-label">종료시간</span>
              <input className="input" value={draft.workEnd} onChange={(e) => update("workEnd", e.target.value)} placeholder="22:00" />
            </label>
            <label>
              <span className="field-label">임금</span>
              <input className="input" inputMode="numeric" value={draft.wageAmount} onChange={(e) => update("wageAmount", e.target.value)} />
            </label>
            <label>
              <span className="field-label">지급일</span>
              <input className="input" value={draft.payDay} onChange={(e) => update("payDay", e.target.value)} />
            </label>
          </div>

          {draft.contractType === "partTime" && (
            <label className="contract-wide-field">
              <span className="field-label">근로일 및 근로일별 근로시간</span>
              <textarea className="textarea" value={draft.partTimeSchedule} onChange={(e) => update("partTimeSchedule", e.target.value)} />
            </label>
          )}

          <div className="contract-form-grid">
            <label>
              <span className="field-label">휴게시간</span>
              <input className="input" value={draft.breakTime} onChange={(e) => update("breakTime", e.target.value)} />
            </label>
            <label>
              <span className="field-label">상여금</span>
              <input className="input" value={draft.bonus} onChange={(e) => update("bonus", e.target.value)} />
            </label>
            <label>
              <span className="field-label">기타수당</span>
              <input className="input" value={draft.allowances} onChange={(e) => update("allowances", e.target.value)} />
            </label>
            <label>
              <span className="field-label">지급방법</span>
              <input className="input" value={draft.payMethod} onChange={(e) => update("payMethod", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사업주명</span>
              <input className="input" value={draft.employerName} onChange={(e) => update("employerName", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사업주 연락처</span>
              <input className="input" value={draft.employerPhone} onChange={(e) => update("employerPhone", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사업자번호</span>
              <input className="input" value={draft.businessNumber} onChange={(e) => update("businessNumber", e.target.value)} />
            </label>
            <label>
              <span className="field-label">작성일</span>
              <input className="input" type="date" value={draft.issueDate} onChange={(e) => update("issueDate", e.target.value)} />
            </label>
          </div>

          <label className="contract-wide-field">
            <span className="field-label">사업장 주소</span>
            <input className="input" value={draft.employerAddress} onChange={(e) => update("employerAddress", e.target.value)} />
          </label>
          <label className="contract-wide-field">
            <span className="field-label">연차유급휴가</span>
            <input className="input" value={draft.annualLeave} onChange={(e) => update("annualLeave", e.target.value)} />
          </label>
          <label className="contract-wide-field">
            <span className="field-label">비고</span>
            <textarea className="textarea" value={draft.notes} onChange={(e) => update("notes", e.target.value)} />
          </label>

          <div>
            <div className="field-label">사회보험 적용 여부</div>
            <div className="contract-checks">
              {INSURANCE_OPTIONS.map((name) => (
                <label className="check-row" key={name}>
                  <input type="checkbox" checked={draft.insurance.includes(name)} onChange={() => toggleInsurance(name)} />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <article className="contract-print-area contract-paper">
          <h2>{title}</h2>
          <p className="contract-intro">
            {draft.employerName || "사업주"}(이하 "사업주")와 {employee.name}(이하 "근로자")는 다음과 같이 근로계약을 체결한다.
          </p>

          <div className="contract-lines">
            <div><b>1. 근로계약기간</b><span>{draft.startDate || "____년 __월 __일"}부터 {draft.endDate || "기간의 정함 없음"}까지</span></div>
            <div><b>2. 근무장소</b><span>{draft.workplace || "________"}</span></div>
            <div><b>3. 업무내용</b><span>{draft.jobDescription || "________"}</span></div>
            <div><b>4. 소정근로시간</b><span>{draft.workStart || "__:__"}부터 {draft.workEnd || "__:__"}까지, 휴게시간: {draft.breakTime || "________"}</span></div>
            <div><b>5. 근무일/주휴일</b><span>{draft.workDays || "________"} / {draft.weeklyHoliday || "________"}</span></div>
          </div>

          {draft.contractType === "partTime" && (
            <div className="contract-clause">
              <b>단시간근로자 근로일 및 근로일별 근로시간</b>
              <p>{draft.partTimeSchedule || "________"}</p>
            </div>
          )}

          <div className="contract-clause">
            <b>6. 임금</b>
            <table className="contract-table">
              <tbody>
                <tr><th>임금형태</th><td>{draft.wageType}</td><th>금액</th><td>{formatMoney(draft.wageAmount)}</td></tr>
                <tr><th>상여금</th><td>{draft.bonus || "없음"}</td><th>기타수당</th><td>{draft.allowances || "없음"}</td></tr>
                <tr><th>임금지급일</th><td>{draft.payDay || "________"}</td><th>지급방법</th><td>{draft.payMethod || "________"}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="contract-lines">
            <div><b>7. 연차유급휴가</b><span>{draft.annualLeave || "근로기준법에서 정하는 바에 따름"}</span></div>
            <div><b>8. 사회보험 적용</b><span>{draft.insurance.length ? draft.insurance.join(", ") : "해당 없음"}</span></div>
            <div><b>9. 근로계약서 교부</b><span>사업주는 본 계약서를 작성한 뒤 근로자에게 1부를 교부한다.</span></div>
            <div><b>10. 기타</b><span>{draft.notes || "기타 근로조건은 근로기준법에 따른다."}</span></div>
          </div>

          <div className="contract-party-grid">
            <div>
              <h3>사업주</h3>
              <p>상호: {draft.employerName || "________"}</p>
              <p>사업자번호: {draft.businessNumber || "________"}</p>
              <p>주소: {draft.employerAddress || "________"}</p>
              <p>연락처: {draft.employerPhone || "________"}</p>
              <p className="signature-line">서명: __________________</p>
            </div>
            <div>
              <h3>근로자</h3>
              <p>성명: {employee.name}</p>
              <p>주민등록번호: {employee.residentRegistrationNumber || "________"}</p>
              <p>주소: {employee.address || "________"}</p>
              <p>연락처: {employee.phone || "________"}</p>
              <p className="signature-line">서명: __________________</p>
            </div>
          </div>

          <p className="contract-date">{draft.issueDate || TODAY_STR}</p>
        </article>
      </div>
    </section>
  );
}
