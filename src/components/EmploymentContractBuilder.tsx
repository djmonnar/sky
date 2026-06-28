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
  wagePeriodStart: string;
  wagePeriodEnd: string;
  workplace: string;
  jobDescription: string;
  workDaysPerWeek: string;
  workStart: string;
  workEnd: string;
  breakTime: string;
  weeklyHoliday: string;
  partTimeSchedule: string;
  wageType: string;
  wageAmount: string;
  baseWage: string;
  fixedOvertimePay: string;
  payDay: string;
  payMethod: string;
  insurance: string[];
  employerRepresentative: string;
  employerName: string;
  employerPhone: string;
  employerAddress: string;
  businessType: string;
  businessNumber: string;
  issueDate: string;
  notes: string;
}

const INSURANCE_OPTIONS = ["국민연금", "건강보험료", "장기요양보험료", "고용보험"];

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

function formatPlainMoney(value: string): string {
  const n = Number(value.replace(/[^0-9]/g, ""));
  return n ? n.toLocaleString("ko-KR") : "________";
}

function formatDateKorean(value: string): string {
  if (!value) return "____ 년 __ 월 __ 일";
  const [year, month, day] = value.split("-");
  return `${Number(year)} 년 ${Number(month)} 월 ${Number(day)} 일`;
}

function formatMonthKorean(value: string): string {
  if (!value) return "____년 __월";
  const [year, month] = value.split("-");
  return `${Number(year)}년 ${Number(month)}월`;
}

function formatTimeKorean(value: string): string {
  if (!value) return "__시 __분";
  const [hour, minute = "00"] = value.split(":");
  return `${Number(hour)}시 ${minute.padStart(2, "0")}분`;
}

function birthDateFromResident(value?: string): string {
  const digits = value?.replace(/[^0-9]/g, "") ?? "";
  if (digits.length < 6) return "____ 년 __ 월 __ 일";
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const genderCode = digits[6];
  const century = ["3", "4", "7", "8"].includes(genderCode) ? 2000 : 1900;
  return `${century + yy} 년 ${mm} 월 ${dd} 일`;
}

function defaultWagePeriodEnd(startDate: string): string {
  const year = startDate.slice(0, 4) || TODAY_STR.slice(0, 4);
  return `${year}-12`;
}

function defaultDraft(employee: Employee): ContractDraft {
  const contractType: ContractType = employee.employmentType === "fullTime" ? "fullTime" : "partTime";
  const workStart = employee.standardStart ?? "11:00";
  const workEnd = employee.standardEnd ?? "21:30";
  const wageAmount = moneyValue(employee);
  return {
    contractType,
    startDate: TODAY_STR,
    endDate: "",
    wagePeriodStart: TODAY_STR.slice(0, 7),
    wagePeriodEnd: defaultWagePeriodEnd(TODAY_STR),
    workplace: "백년가업 하늘땅 본점",
    jobDescription: `${employee.role}${employee.roleLabel ? ` / ${employee.roleLabel}` : ""}`,
    workDaysPerWeek: contractType === "fullTime" ? "6" : "",
    workStart,
    workEnd,
    breakTime: "15:00-17:00",
    weeklyHoliday: "업무 사정상 주중 1일을 직원간 협의하여 교대로 사용",
    partTimeSchedule: "근무일 및 근로일별 근로시간은 매장 근무표에 따름",
    wageType: salaryTypeLabel(employee),
    wageAmount,
    baseWage: "",
    fixedOvertimePay: "",
    payDay: "익월 10일",
    payMethod: employee.bank || employee.account
      ? `${employee.bank ?? ""} ${employee.account ?? ""} 계좌이체`.trim()
      : "통장 또는 현금 지급",
    insurance: [...INSURANCE_OPTIONS],
    employerRepresentative: "박동철",
    employerName: "백년가업 하늘땅 본점",
    employerPhone: "",
    employerAddress: "경상남도 창원시 진해구 병암로 49",
    businessType: "음식점업",
    businessNumber: "",
    issueDate: TODAY_STR,
    notes: "",
  };
}

export default function EmploymentContractBuilder({ employee, onClose, showToast }: Props) {
  const [draft, setDraft] = useState<ContractDraft>(() => defaultDraft(employee));
  const title = "근로계약서";
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
      workDaysPerWeek: contractType === "fullTime" ? prev.workDaysPerWeek || "6" : prev.workDaysPerWeek,
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

  const wageLine = draft.contractType === "fullTime" && draft.wageType === "월급"
    ? `월급 ${formatMoney(draft.wageAmount)}(기본급:${formatPlainMoney(draft.baseWage)} 고정연장근로수당:${formatPlainMoney(draft.fixedOvertimePay)})(소정근로시간, 연장근로시간 연장근로수당)에 동의하며, 월급적용기간은 ${formatMonthKorean(draft.wagePeriodStart)}부터 ${formatMonthKorean(draft.wagePeriodEnd)}까지로 하며, 다음해에 월급이 조정되지 아니하면 동일한 금액으로 적용되는 것으로 한다.`
    : `${draft.wageType} ${formatMoney(draft.wageAmount)}을 기준으로 지급하며, 구체적인 산정 및 지급은 실제 근로시간, 근무표, 매장 운영기준에 따른다.`;

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
              <span className="field-label">입사일</span>
              <input className="input" type="date" value={draft.startDate} onChange={(e) => update("startDate", e.target.value)} />
            </label>
            <label>
              <span className="field-label">계약 종료일</span>
              <input className="input" type="date" value={draft.endDate} onChange={(e) => update("endDate", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사용자 성명</span>
              <input className="input" value={draft.employerRepresentative} onChange={(e) => update("employerRepresentative", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사업체명</span>
              <input className="input" value={draft.employerName} onChange={(e) => update("employerName", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사업 종류</span>
              <input className="input" value={draft.businessType} onChange={(e) => update("businessType", e.target.value)} />
            </label>
            <label>
              <span className="field-label">사업자번호</span>
              <input className="input" value={draft.businessNumber} onChange={(e) => update("businessNumber", e.target.value)} />
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
              <span className="field-label">주 근무일수</span>
              <input className="input" inputMode="numeric" value={draft.workDaysPerWeek} onChange={(e) => update("workDaysPerWeek", e.target.value)} placeholder="6" />
            </label>
            <label>
              <span className="field-label">주휴일</span>
              <input className="input" value={draft.weeklyHoliday} onChange={(e) => update("weeklyHoliday", e.target.value)} />
            </label>
            <label>
              <span className="field-label">시업시간</span>
              <input className="input" value={draft.workStart} onChange={(e) => update("workStart", e.target.value)} placeholder="11:00" />
            </label>
            <label>
              <span className="field-label">종업시간</span>
              <input className="input" value={draft.workEnd} onChange={(e) => update("workEnd", e.target.value)} placeholder="21:30" />
            </label>
            <label>
              <span className="field-label">휴게시간</span>
              <input className="input" value={draft.breakTime} onChange={(e) => update("breakTime", e.target.value)} placeholder="15:00-17:00" />
            </label>
            <label>
              <span className="field-label">임금형태</span>
              <input className="input" value={draft.wageType} onChange={(e) => update("wageType", e.target.value)} />
            </label>
            <label>
              <span className="field-label">임금</span>
              <input className="input" inputMode="numeric" value={draft.wageAmount} onChange={(e) => update("wageAmount", e.target.value)} />
            </label>
            <label>
              <span className="field-label">기본급</span>
              <input className="input" inputMode="numeric" value={draft.baseWage} onChange={(e) => update("baseWage", e.target.value)} />
            </label>
            <label>
              <span className="field-label">고정연장근로수당</span>
              <input className="input" inputMode="numeric" value={draft.fixedOvertimePay} onChange={(e) => update("fixedOvertimePay", e.target.value)} />
            </label>
            <label>
              <span className="field-label">임금 적용 시작</span>
              <input className="input" type="month" value={draft.wagePeriodStart} onChange={(e) => update("wagePeriodStart", e.target.value)} />
            </label>
            <label>
              <span className="field-label">임금 적용 종료</span>
              <input className="input" type="month" value={draft.wagePeriodEnd} onChange={(e) => update("wagePeriodEnd", e.target.value)} />
            </label>
            <label>
              <span className="field-label">지급일</span>
              <input className="input" value={draft.payDay} onChange={(e) => update("payDay", e.target.value)} />
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
            <span className="field-label">지급방법</span>
            <input className="input" value={draft.payMethod} onChange={(e) => update("payMethod", e.target.value)} />
          </label>
          {draft.contractType === "partTime" && (
            <label className="contract-wide-field">
              <span className="field-label">근로일 및 근로일별 근로시간</span>
              <textarea className="textarea" value={draft.partTimeSchedule} onChange={(e) => update("partTimeSchedule", e.target.value)} />
            </label>
          )}
          <label className="contract-wide-field">
            <span className="field-label">특약사항</span>
            <textarea className="textarea" value={draft.notes} onChange={(e) => update("notes", e.target.value)} />
          </label>

          <div>
            <div className="field-label">원천징수 및 사회보험</div>
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

        <article className="contract-print-area contract-paper contract-hwp-paper">
          <h2>{title}</h2>

          <p className="contract-section-title">계약당사자</p>
          <table className="contract-info-table">
            <tbody>
              <tr>
                <th className="contract-side-head" rowSpan={3}>사용자(갑)</th>
                <th>성명</th>
                <td>{draft.employerRepresentative || "________"}</td>
                <th>사업의 종류</th>
                <td>{draft.businessType || "________"}</td>
              </tr>
              <tr>
                <th>사업체명</th>
                <td colSpan={3}>{draft.employerName || "________"}</td>
              </tr>
              <tr>
                <th>소재지</th>
                <td colSpan={3}>{draft.employerAddress || "________"}</td>
              </tr>
              <tr>
                <th className="contract-side-head" rowSpan={3}>근로자(을)</th>
                <th>성명</th>
                <td>{employee.name}</td>
                <th>생년월일</th>
                <td>{birthDateFromResident(employee.residentRegistrationNumber)}</td>
              </tr>
              <tr>
                <th>주소</th>
                <td colSpan={3}>{employee.address || "________"}</td>
              </tr>
              <tr>
                <th>연락처</th>
                <td colSpan={3}>{employee.phone || "________"}</td>
              </tr>
            </tbody>
          </table>

          <section className="contract-article">
            <h4>제1조【근로계약】</h4>
            <p>사용자 갑과 근로자 을은 쌍방간 합의하에 근로계약을 체결하고 성실히 준수할 것을 약속한다.</p>
          </section>

          <section className="contract-article">
            <h4>제2조【성실의무】</h4>
            <p>을은 사용자의 지시, 명령에 따라 성실히 업무에 종사한다.</p>
          </section>

          <section className="contract-article">
            <h4>제3조【업무의 내용】</h4>
            <ol>
              <li>을은 사전 약정된 바에 따라 {draft.jobDescription || "홀서빙, 청소, 기타 업무"} 등에 종사하며, 근무장소는 {draft.workplace || "________"}로 한다.</li>
              <li>갑은 을의 업무 내용 및 장소를 회사의 경영상의 사정에 따라 변경, 추가할 수 있고 을은 이에 따라야 한다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제4조【근로계약기간 및 수습기간】</h4>
            <ol>
              <li>입사일 {formatDateKorean(draft.startDate)}{draft.endDate ? `부터 ${formatDateKorean(draft.endDate)}까지` : ""}. 단, 필요에 의해 양 당사자가 합의에 의해 갱신할 수 있다.</li>
              <li>최초 채용일로부터 1개월은 수습기간으로 한다(최저시급적용, 업무 능력에 따라 바로 수습기간은 끝난다). 다만, 수습기간 중이라도 고객을 향한 태도, 직무능력 부족, 조직 적응력 부족, 고객의 민원 발생, 타사에서의 해고, 면직 직원으로서 부적격하다고 해당되는 경우 채용을 취소할 수 있다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제5조【근로시간】</h4>
            <ol>
              <li>일 소정근로시간은 필요시 시업, 종업시간 및 근로시간을 조정할 수 있다.</li>
              <li>시업 및 종업시간: {formatTimeKorean(draft.workStart)} ~ {formatTimeKorean(draft.workEnd)}, 주 {draft.workDaysPerWeek || "__"}일 근무</li>
              <li>휴게시간: 휴게시간은 {draft.breakTime || "________"}을 원칙으로 하나, 업무의 특성상 휴게시간은 식사 등으로 적정하게 분할하여 사용하며 조정할 수 있다. 휴게시간은 근로시간에 포함하지 아니한다.</li>
            </ol>
            {draft.contractType === "partTime" && <p className="contract-note-line">근로일 및 근로일별 근로시간: {draft.partTimeSchedule || "________"}</p>}
          </section>

          <section className="contract-article">
            <h4>제6조【임금】</h4>
            <ol>
              <li>{wageLine}</li>
              <li>소정근로시간 이외 근무시 시간외 수당을 지급한다.</li>
              <li>결근, 휴직, 정직, 지각, 조퇴 등 을의 귀책사유로 근로를 제공하지 못할 경우 그 기간 또는 시간만큼 임금을 지급하지 아니하거나, 다른 날이나 다른 시간을 대체하여 근무하게 할 수 있다.</li>
              <li>주 1일 이상 출근하지 아니할 경우 주휴수당(8시간)을 임금에서 차감한다.</li>
              <li>중도 입사자 및 퇴사자의 경우에는 연봉을 365일로 나눈 일급에서 재직일수를 곱해 일할 계산한다.(연봉÷365일×재직일수)</li>
              <li>임금 지급일: 당월 1일부터 말일까지 해당 분을 {draft.payDay || "익월 10일"}에 {draft.payMethod || "통장 또는 현금 지급"}한다. 휴일인 경우 익일 또는 다음 금융기관 업무개시일로 한다.</li>
              <li>회사 경영상 필요시 사용자와 근로자의 협의에 의해 임금을 조정(감액 포함)할 수 있다.</li>
              <li>시업 및 종업시간을 조정하는 경우 임금을 조정할 수 있다.</li>
              <li>상기 급여에서 {draft.insurance.length ? draft.insurance.join(", ") : "국민연금, 건강보험료, 장기요양보험료, 고용보험"}, 제세금을 원천징수한다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제7조【휴가, 휴일】</h4>
            <ol>
              <li>유급휴일은 근로자의 날과 주휴일로 한다. 단, 근로자의 날과 주휴일이 겹칠 경우 1일만 유급휴일을 적용한다.</li>
              <li>주휴일: {draft.weeklyHoliday || "업무 사정상 주중 1일을 직원간 협의하여 교대로 사용한다."} 단 직원간 협의되지 아니할 경우 갑이 결정한다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제8조【직원 준수사항】</h4>
            <ol>
              <li>조리시 칼 등의 자상이나 뜨거운 물, 불 등에 화상을 입지 않도록 하여야 한다.</li>
              <li>조리시 지정된 복장, 모자, 신발 등을 착용하여야 한다.</li>
              <li>조리시 부패되거나 유통기한이 지난 식재료는 갑에게 보고하고 지시에 따라야 한다.</li>
              <li>새로운 조리법 등을 연구하여 고객이 만족할 수 있는 요리 개발에도 노력하여야 한다.</li>
              <li>매장의 청결은 내가 먼저 솔선하여야 한다.</li>
              <li>조리시 용제 등에 알레르기가 있는 경우에는 사전 보고하여 조치하여야 한다.</li>
              <li>타인에게 감염될 수 있는 질병이 걸린 경우에는 갑에게 보고하고 적절하게 조치하여야 한다.</li>
              <li>기타 외식업 직원으로 지켜야 할 도리와 의무에 충실하여야 한다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제9조【퇴직금】</h4>
            <p>근로자퇴직급여보장법에 의한다.</p>
          </section>

          <section className="contract-article">
            <h4>제10조【계약의 해지사유, 해고사유 및 당연퇴직 사유】</h4>
            <ol>
              <li>근로계약기간의 종료</li>
              <li>근무성적이 극히 불량한 경우</li>
              <li>연속하여 2일 이상 무단결근하거나 월 2일 이상 무단결근 한 경우. 결근계를 제출하지 아니한 경우 무단결근으로 간주하며, 상기 기간 이상으로 결근한 경우 갑은 특별한 통지 없이도 근로계약을 해지하고 4대 보험 상실신고를 할 수 있고, 이에 대해 을은 이의를 제기하지 못한다.</li>
              <li>법률에 의해 공민권을 정지 또는 박탈당한 경우</li>
              <li>고의 또는 부주의로 중대한 사고를 일으켜 회사에 손해를 끼친 경우</li>
              <li>난치의 전염병을 가졌거나 취업으로 병세가 악화될 염려가 있거나 질병의 치료를 태만히 하여 다른 직원에게 전염시킬 우려가 있는 경우</li>
              <li>신체상 또는 정신상 장해로 직무를 감당할 수 없다고 인정되는 경우</li>
              <li>1심에서 형사상 유죄 판결을 받은 경우(벌금 포함)</li>
              <li>피성년후견인, 피한정후견인이 된 경우</li>
              <li>허위 사실을 날조하거나 사실을 왜곡하여 유포하거나, 불법 유인물을 부착하는 등 사업장 내 질서를 크게 문란하게 하는 경우</li>
              <li>사내에서 허가 없이 집회, 시위, 집단구호제창, 연설 등 근로자를 선동 또는 소요를 하는 경우</li>
              <li>상사의 주요한 업무상 명령에 불복하여 경영 질서를 크게 문란하게 한 경우</li>
              <li>을이 회사의 물품, 금품을 절취, 횡령, 배임 등을 하거나, 고의로 회사의 재산 손상, 부정한 행위로 회사의 재산, 금품을 취득한 경우</li>
              <li>기타 사회 통념상 계속 근로를 유지하기가 어렵다고 회사가 인정하는 경우</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제11조【손해배상】</h4>
            <ol>
              <li>을의 고의 또는 중대한 과실로 인하여 갑에게 자산상의 손해가 발생한 경우 을은 이에 대해 민사상 손해배상을 책임져야 한다.(제10조의 해고 등과는 별개임)</li>
              <li>을이 퇴사하고자 할 때에는 사직일로부터 30일 전에 사표를 제출하고, 갑과 협의하여 업무 인수인계 및 전달 등을 성실히 행하여야 하며, 만약 최소한의 업무인계를 거부하는 등 의무를 다하지 아니할 경우 해당 퇴직자에게 민사상의 손해배상을 물을 수 있다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제12조【기밀유지 등】</h4>
            <ol>
              <li>을은 근로계약서 및 급여명세서는 기밀을 유지하며, 타인의 급여 내역에 대해서 알려고 하지 않으며, 이를 위반시 불이익을 감수한다.</li>
              <li>갑과 관련된 모든 기록 매체는 근로계약이 해지될 때 또는 퇴사시 그 해지 사유 등과 관계없이 즉시 을은 갑에게 반환하여야 한다.</li>
              <li>갑의 경영에 관련된 모든 파일, 서류, 도안, 명세서, 프로그램, 장부, 특허 등이 갑과 을 어느 쪽에 의해 작성되었는지 관계없이 갑의 독점적 소유물이며, 갑의 서면 동의 없이는 갑 밖으로 유출하지 말아야 한다.</li>
              <li>을은 갑과 관련하여 인지 또는 취득한 각종 정보(본 계약의 내용도 포함한다)에 대하여 어떠한 경우라도 제3자에게 그 내용의 일부 또는 전부를 유출하여서는 아니된다.</li>
              <li>근로계약 기간 동안 을은 갑의 서면 동의가 없을 경우 갑의 사업행위와 유사한 다른 사업행위에 직, 간접적으로 관계하지 말아야 한다.</li>
              <li>상기 각 항에 명시되지 않는 사항은 비밀유지서약서에 의해 비밀을 유지해야 한다.</li>
              <li>상기 조항 중 한 조항이라도 위반하여 갑에게 발생한 손해에 대하여는 배상 의무를 가진다.</li>
            </ol>
          </section>

          <section className="contract-article">
            <h4>제12조【기타】</h4>
            <p>본 계약서상 기재되지 아니한 사항은 근로기준법을 적용하고, 갑과 을은 본 계약에 따라 성실히 이행키로 하고 이를 증명하기 위해 각각 서명 날인하여 1부씩 보관한다.</p>
            {draft.notes && <p className="contract-note-line">특약사항: {draft.notes}</p>}
          </section>

          <p className="contract-date">{formatDateKorean(draft.issueDate)}</p>

          <div className="contract-signatures">
            <div>
              <p><b>“갑”(사용자)</b></p>
              <p>주소: {draft.employerAddress || "________"}</p>
              <p>회사명: {draft.employerName || "________"}</p>
              <p>대표이사: {draft.employerRepresentative || "________"} <span className="signature-line">(서명)</span></p>
            </div>
            <div>
              <p><b>“을”(근로자)</b></p>
              <p>주소: {employee.address || "________"}</p>
              <p>생년월일: {birthDateFromResident(employee.residentRegistrationNumber)}</p>
              <p>성명: {employee.name} <span className="signature-line">(서명)</span></p>
            </div>
          </div>

          <p className="contract-receipt">근로자 본인은 근로계약서를 교부받았음을 확인합니다. <span>(서명)</span></p>
        </article>
      </div>
    </section>
  );
}
