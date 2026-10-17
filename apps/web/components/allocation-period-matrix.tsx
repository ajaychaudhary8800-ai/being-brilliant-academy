"use client";

export type PeriodMatrixRow = {
  courseId: string;
  courseName: string;
  batchId: string;
  batchName: string;
  subjectId: string;
  subjectName: string;
};

export const periodMatrixKey = (row: Pick<PeriodMatrixRow, "courseId" | "batchId" | "subjectId">) =>
  `${row.courseId}:${row.batchId}:${row.subjectId}`;

export function AllocationPeriodMatrix({
  rows,
  defaultPeriods,
  periods,
  onChange,
}: {
  rows: PeriodMatrixRow[];
  defaultPeriods: string;
  periods: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!rows.length) return null;
  const count = (row: PeriodMatrixRow) => Number(periods[periodMatrixKey(row)] ?? defaultPeriods);
  const valid = rows.every(row => Number.isInteger(count(row)) && count(row) >= 1 && count(row) <= 100);
  const weeklyTotal = valid ? rows.reduce((total, row) => total + count(row), 0) : null;

  return (
    <section aria-label="Weekly subject allocation" className="mt-5 rounded-xl border bg-slate-50 p-4 dark:bg-slate-800">
      <h3 className="text-base font-bold">Weekly periods by class, section and subject</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Edit the weekly period count for each individual allocation. For example, Mathematics can have 6 periods and
        General Knowledge 2 periods in the same section. Exact weekdays and timings are configured in Timetable Management.
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm" aria-live="polite">
        <span><b>{rows.length}</b> class–section–subject allocations</span>
        <span><b>{weeklyTotal ?? "—"}</b> total weekly teaching periods across these allocations</span>
      </div>
      {rows.length > 500 && <p className="mt-2 text-sm text-red-700" role="alert">Select no more than 500 allocation rows at a time.</p>}
      {!valid && <p className="mt-2 text-sm text-red-700" role="alert">Every weekly period count must be a whole number from 1 to 100.</p>}
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border bg-white dark:bg-slate-900">
        <table className="w-full min-w-[580px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase dark:bg-slate-800">
            <tr><th scope="col" className="p-3">Class / Course</th><th scope="col" className="p-3">Section / Batch</th><th scope="col" className="p-3">Subject</th><th scope="col" className="p-3">Periods / week</th></tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const key = periodMatrixKey(row);
              return <tr key={key} className="border-t">
                <td className="p-3">{row.courseName}</td>
                <td className="p-3">{row.batchName}</td>
                <td className="p-3">{row.subjectName}</td>
                <td className="p-3">
                  <input
                    aria-label={`Weekly periods for ${row.courseName}, ${row.batchName}, ${row.subjectName}`}
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    required
                    className="w-24 rounded-lg border px-3 py-2 text-base dark:bg-slate-900"
                    value={periods[key] ?? defaultPeriods}
                    onChange={event => onChange(key, event.target.value)}
                  />
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
