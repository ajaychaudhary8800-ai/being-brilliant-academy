"use client";

export type BellSlot = { id: string; periodNumber: number; startMinute: number; endMinute: number;
  type: "TEACHING" | "BREAK"; label: string | null; isActive: boolean };
export type AllocationOption = { id: string; subjectId: string; teacherId: string; weeklyPeriods: number;
  teacher: { user: { name: string } }; subject: { name: string } };
export type ScheduledPeriod = { id: string; periodNumber: number; status: string;
  teacher: { user: { name: string } }; subject: { name: string }; classroom: { name: string } };
export type DraftCell = { allocationId: string; classroomId: string };
export type Room = { id: string; name: string };

const clock = (n: number) => `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
export { clock };

export default function SchoolClassDayGrid({ slots, existing, allocations, rooms, defaultRoom, draft, onChange }: {
  slots: BellSlot[]; existing: ScheduledPeriod[]; allocations: AllocationOption[];
  rooms: Room[]; defaultRoom: string; draft: Record<number, DraftCell>;
  onChange: (period: number, patch: Partial<DraftCell>) => void;
}) {
  return <div className="mt-4 overflow-x-auto rounded-xl border">
    <table className="w-full min-w-[830px] text-left text-sm">
      <thead className="bg-slate-50"><tr>{["Period","Time","Subject / Activity","Teacher","Classroom","Status"].map(name =>
        <th className="p-3" key={name}>{name}</th>)}</tr></thead>
      <tbody>{slots.map(slot => {
        const old = existing.find(row => row.periodNumber === slot.periodNumber);
        const value = draft[slot.periodNumber];
        const allocation = allocations.find(item => item.id === value?.allocationId);
        const availableRoom = value?.classroomId || defaultRoom;
        return <tr key={slot.id} className={`border-t ${slot.type === "BREAK" ? "bg-amber-50" : ""}`}>
          <td className="p-3 font-bold">{slot.type === "BREAK" ? "Activity / Break" : `P${slot.periodNumber}`}</td>
          <td className="whitespace-nowrap p-3">{clock(slot.startMinute)}–{clock(slot.endMinute)}</td>
          {slot.type === "BREAK" ? <>
            <td className="p-3 font-semibold">{slot.label || "Break / Recess"}</td>
            <td className="p-3">Not required</td><td className="p-3">—</td><td className="p-3">Bell schedule</td>
          </> : old ? <>
            <td className="p-3 font-semibold">{old.subject.name}</td><td className="p-3">{old.teacher.user.name}</td>
            <td className="p-3">{old.classroom.name}</td><td className="p-3">{old.status}</td>
          </> : <>
            <td className="p-3"><select aria-label={`Subject and teacher for period ${slot.periodNumber}`}
              className="field min-w-52" value={value?.allocationId ?? ""}
              onChange={e => onChange(slot.periodNumber, { allocationId: e.target.value })}>
              <option value="">Choose subject + teacher</option>
              {allocations.map(item => <option key={item.id} value={item.id}>
                {item.subject.name} — {item.teacher.user.name} ({item.weeklyPeriods}/week)
              </option>)}</select></td>
            <td className="p-3">{allocation?.teacher.user.name ?? "—"}</td>
            <td className="p-3"><select aria-label={`Classroom for period ${slot.periodNumber}`}
              className="field min-w-40" value={availableRoom}
              onChange={e => onChange(slot.periodNumber, { classroomId: e.target.value })}>
              <option value="">Choose classroom</option>{rooms.map(room =>
                <option key={room.id} value={room.id}>{room.name}</option>)}
            </select></td><td className="p-3">{allocation && availableRoom ? "Ready" : "Unassigned"}</td>
          </>}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
