"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, BriefcaseBusiness, CalendarCheck, Download, Plus, Search, Upload, Users, X } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { csvTemplate, parseTabularFile } from "../../../components/tabular-import";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Obj = Record<string, any>;

type EmployeeForm = {
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  branchId: string;
  departmentId: string;
  designationId: string;
  joiningDate: string;
  employmentType: string;
  status: string;
  remarks: string;
};

const blankEmployee = (): EmployeeForm => ({
  employeeCode: "",
  name: "",
  email: "",
  phone: "",
  password: "",
  branchId: "",
  departmentId: "",
  designationId: "",
  joiningDate: new Date().toISOString().slice(0, 10),
  employmentType: "FULL_TIME",
  status: "ACTIVE",
  remarks: "",
});

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

const money = (value: any) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value ?? 0) / 100);

const titleCase = (value: unknown) =>
  String(value ?? "—")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase());

const formatDate = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

const INTERNAL_KEYS = new Set([
  "id",
  "organizationId",
  "userId",
  "branchId",
  "departmentId",
  "designationId",
  "_count",
  "createdAt",
  "updatedAt",
  "deletedAt",
]);

function genericValue(key: string, value: any) {
  if (key.toLowerCase().includes("paise")) return money(value);
  if (key === "isArchived") return value ? "Archived" : "Active";
  if (key === "isActive") return value ? "Active" : "Inactive";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key.toLowerCase().includes("date") || key.endsWith("At")) return formatDate(value);
  if (Array.isArray(value)) return value.length ? `${value.length} item${value.length === 1 ? "" : "s"}` : "—";
  if (value && typeof value === "object") {
    return value.name ?? value.branchName ?? value.employeeCode ?? value.title ?? "Details";
  }
  if (value == null || value === "") return "—";
  const text = String(value);
  return text.includes("_") ? titleCase(text) : text;
}

type Column = { key: string; label: string; render: (row: Obj) => React.ReactNode };

function columnsFor(tab: string, rows: Obj[]): Column[] {
  if (tab === "employees") {
    return [
      { key: "employeeCode", label: "Employee Code", render: row => <span className="font-semibold text-brand-700">{row.employeeCode ?? "—"}</span> },
      {
        key: "employee",
        label: "Employee",
        render: row => <div><p className="font-semibold">{row.user?.name ?? "—"}</p><p className="text-xs text-slate-500">{row.user?.email ?? "—"}</p></div>,
      },
      { key: "branch", label: "Branch", render: row => row.branch?.branchName ?? "—" },
      { key: "department", label: "Department", render: row => row.department?.name ?? "—" },
      { key: "designation", label: "Designation", render: row => row.designation?.name ?? "—" },
      { key: "joiningDate", label: "Joining Date", render: row => formatDate(row.joiningDate) },
      { key: "status", label: "Status", render: row => titleCase(row.status) },
    ];
  }

  if (tab === "departments") {
    return [
      { key: "name", label: "Department", render: row => <span className="font-semibold">{row.name ?? "—"}</span> },
      { key: "code", label: "Code", render: row => row.code ?? "—" },
      { key: "description", label: "Description", render: row => row.description || "—" },
      { key: "isArchived", label: "Status", render: row => row.isArchived ? "Archived" : "Active" },
      { key: "employees", label: "Employees", render: row => row._count?.employees ?? 0 },
      { key: "designations", label: "Designations", render: row => row.designations?.filter((item: Obj) => !item.isArchived).length ?? 0 },
    ];
  }

  const keys = Object.keys(rows[0] ?? { status: "Status" })
    .filter(key => !INTERNAL_KEYS.has(key))
    .slice(0, 7);

  return keys.map(key => ({
    key,
    label: key === "isArchived" || key === "isActive" ? "Status" : key.replace(/([A-Z])/g, " $1").trim(),
    render: row => genericValue(key, row[key]),
  }));
}

function Grid({ rows, tab }: { rows: Obj[]; tab: string }) {
  const columns = columnsFor(tab, rows);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
          <tr>{columns.map(column => <th className="px-4 py-3" key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className="border-t border-slate-100 align-top dark:border-slate-800" key={row.id ?? index}>
              {columns.map(column => <td className="px-4 py-3" key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="p-6 text-slate-500">No records found.</p>}
    </div>
  );
}

function Hr() {
  const [tab, setTab] = useState("employees");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Obj[]>([]);
  const [dashboard, setDashboard] = useState<Obj>({});
  const [departments, setDepartments] = useState<Obj[]>([]);
  const [branches, setBranches] = useState<Obj[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [departmentForm, setDepartmentForm] = useState({ name: "", code: "" });
  const [designationForm, setDesignationForm] = useState({ departmentId: "", name: "", code: "", level: "1" });
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(blankEmployee);
  const [savingEmployee, setSavingEmployee] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const [dashboardResponse, departmentResponse, branchResponse] = await Promise.all([
        api("/hr/dashboard"),
        api("/hr/departments"),
        api("/admin/branches?page=1&limit=100&sortBy=branchName&sortOrder=asc"),
      ]);
      setDashboard(dashboardResponse.data);
      setDepartments(departmentResponse.data);
      setBranches(branchResponse.data);

      if (tab === "departments") {
        setData(departmentResponse.data);
        return;
      }

      const path =
        tab === "employees" ? "/hr/employees" :
        tab === "recruitment" ? "/hr/recruitment" :
        tab === "attendance" ? "/hr/attendance" :
        tab === "leaves" ? "/hr/leaves" :
        tab === "payroll" ? "/hr/payroll" :
        tab === "shifts" ? "/hr/shifts" :
        "/hr/audit-logs";

      const response = await api(`${path}?search=${encodeURIComponent(query)}&page=1&limit=50`);
      setData(response.data);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [tab, query]);

  useEffect(() => { void load(); }, [load]);

  const addDepartment = async () => {
    try {
      setError("");
      await api("/hr/departments", { method: "POST", body: JSON.stringify(departmentForm) });
      setDepartmentForm({ name: "", code: "" });
      setNotice("Department created");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const addDesignation = async () => {
    try {
      setError("");
      await api("/hr/designations", {
        method: "POST",
        body: JSON.stringify({
          departmentId: designationForm.departmentId,
          name: designationForm.name,
          code: designationForm.code,
          level: Number(designationForm.level),
        }),
      });
      setDesignationForm({ departmentId: "", name: "", code: "", level: "1" });
      setNotice("Designation created");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const selectedDepartment = departments.find(item => item.id === employeeForm.departmentId);
  const designationOptions = (selectedDepartment?.designations ?? []).filter((item: Obj) => !item.isArchived);

  const updateEmployee = <K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) => {
    setEmployeeForm(current => ({
      ...current,
      [key]: value,
      ...(key === "departmentId" ? { designationId: "" } : {}),
    }));
  };

  const closeEmployee = () => {
    setEmployeeOpen(false);
    setEmployeeForm(blankEmployee());
  };

  const createEmployee = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingEmployee(true);
    setError("");
    setNotice("");
    try {
      await api("/hr/employees", {
        method: "POST",
        body: JSON.stringify({
          ...employeeForm,
          phone: employeeForm.phone.trim() || null,
          remarks: employeeForm.remarks.trim() || null,
        }),
      });
      closeEmployee();
      setNotice("Employee created. Employee Portal login is ready.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSavingEmployee(false);
    }
  };

  const importEmployees = async (file: File) => {
    try {
      setError("");
      setNotice("");
      const rows = await parseTabularFile(file);
      const result = await api("/hr/import/employees", { method: "POST", body: JSON.stringify({ rows }) });
      setNotice(`${result.meta?.imported ?? rows.length} employees imported successfully`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const downloadEmployees = async () => {
    try {
      setError("");
      const response = await fetch(`${API}/hr/export/employees`, { headers: { Authorization: `Bearer ${getAccessToken()}` } });
      if (!response.ok) throw new Error("Employee export failed");
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(await response.blob());
      anchor.download = "employees.xls";
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const downloadEmployeeTemplate = () => {
    const content = csvTemplate([
      "employeeCode", "name", "email", "phone", "password", "branchId", "departmentId", "designationId",
      "joiningDate", "employmentType", "bankName", "bankAccount", "ifsc", "pan", "uan", "esiNumber",
      "biometricCode", "emergencyContact", "status", "remarks",
    ]);
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    anchor.download = "hr-employee-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const filtered = useMemo(
    () => data.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())),
    [data, query],
  );

  return (
    <ProtectedAdminWorkspace title="HR & Payroll" description="Employee lifecycle, attendance, leave, recruitment and compliant payroll operations.">
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [Users, "Employees", dashboard.employees],
          [BriefcaseBusiness, "Candidates", dashboard.candidates],
          [CalendarCheck, "Pending leaves", dashboard.pendingLeaves],
          [Banknote, "Payroll runs", dashboard.payrollRuns],
          [Banknote, "Net payroll", money(dashboard.netPaise)],
        ].map(([IconValue, label, value]) => {
          const Icon = IconValue as typeof Users;
          return <div className="card p-4" key={String(label)}><Icon className="text-brand-700" /><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><p className="text-xl font-bold">{String(value ?? 0)}</p></div>;
        })}
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto">
        {["employees", "departments", "recruitment", "attendance", "leaves", "payroll", "shifts", "audit"].map(item => (
          <button onClick={() => setTab(item)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === item ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`} key={item}>
            {item.replace(/^./, character => character.toUpperCase())}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {notice && <p className="mt-4 rounded-lg bg-green-50 p-3 text-green-700">{notice}</p>}

      <div className="my-5 flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-3 text-slate-400" size={17} />
          <input className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search and filter" value={query} onChange={event => setQuery(event.target.value)} />
        </div>

        {tab === "employees" && (
          <>
            <button type="button" onClick={() => setEmployeeOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white">
              <Plus size={17} /> Add Employee
            </button>
            <button type="button" onClick={() => void downloadEmployees()} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900">
              <Download size={17} /> Employee Excel
            </button>
            <button type="button" onClick={downloadEmployeeTemplate} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900">
              <Download size={17} /> Import template
            </button>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-brand-700 bg-white px-4 py-2 font-semibold text-brand-700 dark:bg-slate-900">
              <Upload size={17} /> Import employees
              <input className="hidden" type="file" accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importEmployees(file); }} />
            </label>
          </>
        )}
      </div>

      {tab === "departments" && (
        <div className="mb-5 grid gap-4 xl:grid-cols-2">
          <section className="card p-5">
            <h3 className="font-bold">Add department</h3>
            <p className="mt-1 text-xs text-slate-500">Create the department first, then add its designations.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input className="rounded-lg border p-2 dark:bg-slate-950" placeholder="Department name" value={departmentForm.name} onChange={event => setDepartmentForm({ ...departmentForm, name: event.target.value })} />
              <input className="rounded-lg border p-2 dark:bg-slate-950" placeholder="Code" value={departmentForm.code} onChange={event => setDepartmentForm({ ...departmentForm, code: event.target.value })} />
              <button onClick={() => void addDepartment()} className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white">Add department</button>
            </div>
          </section>

          <section className="card p-5">
            <h3 className="font-bold">Add designation</h3>
            <p className="mt-1 text-xs text-slate-500">Designations become available automatically in the Add Employee form.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <select value={designationForm.departmentId} onChange={event => setDesignationForm({ ...designationForm, departmentId: event.target.value })} className="rounded-lg border p-2 dark:bg-slate-950 lg:col-span-2">
                <option value="">Select department</option>
                {departments.filter(item => !item.isArchived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <input className="rounded-lg border p-2 dark:bg-slate-950" placeholder="Designation" value={designationForm.name} onChange={event => setDesignationForm({ ...designationForm, name: event.target.value })} />
              <input className="rounded-lg border p-2 dark:bg-slate-950" placeholder="Code" value={designationForm.code} onChange={event => setDesignationForm({ ...designationForm, code: event.target.value })} />
              <button disabled={!designationForm.departmentId || !designationForm.name.trim() || !designationForm.code.trim()} onClick={() => void addDesignation()} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Add designation</button>
            </div>
          </section>
        </div>
      )}

      <Grid rows={filtered} tab={tab} />

      <p className="mt-4 text-xs text-slate-500">
        Employee master supports joining, experience, documents, promotion, transfer, exit, performance, loans, reimbursements and salary structures through the secured HR API. Payroll reports provide PDF, Excel salary registers and bank-transfer exports.
      </p>

      {employeeOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="add-employee-title">
          <section className="my-6 w-full max-w-4xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between border-b border-slate-100 p-5 dark:border-slate-800">
              <div>
                <h2 id="add-employee-title" className="text-xl font-bold">Add Employee</h2>
                <p className="mt-1 text-sm text-slate-500">Create the HR profile and Employee Portal login in one step.</p>
              </div>
              <button type="button" onClick={closeEmployee} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close add employee form"><X size={19} /></button>
            </header>

            <form onSubmit={createEmployee} className="max-h-[78vh] overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold">Employee code
                  <input required value={employeeForm.employeeCode} onChange={event => updateEmployee("employeeCode", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" placeholder="QA-EMP-001" />
                </label>
                <label className="text-sm font-semibold">Full name
                  <input required value={employeeForm.name} onChange={event => updateEmployee("name", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" placeholder="Employee name" />
                </label>
                <label className="text-sm font-semibold">Email
                  <input required type="email" value={employeeForm.email} onChange={event => updateEmployee("email", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" placeholder="employee@example.com" />
                </label>
                <label className="text-sm font-semibold">Phone
                  <input value={employeeForm.phone} onChange={event => updateEmployee("phone", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" placeholder="10–15 digit number" />
                </label>
                <label className="text-sm font-semibold">Portal password
                  <input required minLength={10} type="password" value={employeeForm.password} onChange={event => updateEmployee("password", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" placeholder="Minimum 10 characters" />
                </label>
                <label className="text-sm font-semibold">Branch
                  <select required value={employeeForm.branchId} onChange={event => updateEmployee("branchId", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950">
                    <option value="">Select branch</option>
                    {branches.filter(item => item.isActive !== false).map(item => <option key={item.id} value={item.id}>{item.branchName} ({item.branchCode})</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold">Department
                  <select required value={employeeForm.departmentId} onChange={event => updateEmployee("departmentId", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950">
                    <option value="">Select department</option>
                    {departments.filter(item => !item.isArchived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold">Designation
                  <select required disabled={!employeeForm.departmentId || designationOptions.length === 0} value={employeeForm.designationId} onChange={event => updateEmployee("designationId", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 disabled:bg-slate-100 dark:bg-slate-950 dark:disabled:bg-slate-800">
                    <option value="">{!employeeForm.departmentId ? "Select department first" : designationOptions.length ? "Select designation" : "No active designations"}</option>
                    {designationOptions.map((item: Obj) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  {employeeForm.departmentId && designationOptions.length === 0 && <span className="mt-1 block text-xs font-normal text-amber-700">Create an active designation for this department before adding the employee.</span>}
                </label>
                <label className="text-sm font-semibold">Joining date
                  <input required type="date" value={employeeForm.joiningDate} onChange={event => updateEmployee("joiningDate", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" />
                </label>
                <label className="text-sm font-semibold">Employment type
                  <select value={employeeForm.employmentType} onChange={event => updateEmployee("employmentType", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950">
                    <option value="FULL_TIME">Full time</option>
                    <option value="PART_TIME">Part time</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="INTERN">Intern</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">Status
                  <select value={employeeForm.status} onChange={event => updateEmployee("status", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950">
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="NOTICE">Notice</option>
                  </select>
                </label>
                <label className="text-sm font-semibold md:col-span-2">Remarks
                  <textarea rows={3} value={employeeForm.remarks} onChange={event => updateEmployee("remarks", event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 dark:bg-slate-950" placeholder="Optional notes" />
                </label>
              </div>

              <footer className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 dark:border-slate-800 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeEmployee} className="rounded-xl border px-4 py-2.5 font-semibold">Cancel</button>
                <button disabled={savingEmployee || designationOptions.length === 0} className="rounded-xl bg-brand-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                  {savingEmployee ? "Creating employee…" : "Create Employee"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </ProtectedAdminWorkspace>
  );
}

export default Hr;
