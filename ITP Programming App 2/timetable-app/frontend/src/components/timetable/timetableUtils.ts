import type { ScheduledRow, TimeSlot } from "../../types";
import type { PlannerSlot } from "./types";

export function duration(row: ScheduledRow) {
  const [startHour, startMinute] = row.start_time.split(":").map(Number);
  const [endHour, endMinute] = row.end_time.split(":").map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}

export function buildPlannerSlots(
  rows: ScheduledRow[],
  timeSlots: TimeSlot[],
  startTime?: string,
  endTime?: string,
): PlannerSlot[] {
  let minHour = 9;
  let maxHour = 17;
  const allTimes = [
    ...timeSlots.flatMap((slot) => [slot.start_time, slot.end_time]),
    ...rows.flatMap((row) => [row.start_time, row.end_time]),
  ];

  allTimes.forEach((time) => {
    if (!time) return;
    const [hourText, minuteText] = time.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText || 0);
    if (Number.isNaN(hour)) return;
    minHour = Math.min(minHour, hour);
    maxHour = Math.max(maxHour, minute > 0 ? hour + 1 : hour);
  });

  if (startTime) {
    minHour = Math.max(0, Math.floor(timeToMinutes(startTime) / 60));
  }
  if (endTime) {
    maxHour = Math.min(24, Math.ceil(timeToMinutes(endTime) / 60));
  }
  if (maxHour <= minHour) {
    maxHour = Math.min(24, minHour + 1);
  }

  const slots = [];
  for (let hour = minHour; hour < maxHour; hour += 1) {
    const start = `${String(hour).padStart(2, "0")}:00`;
    const end = `${String(hour + 1).padStart(2, "0")}:00`;
    slots.push({
      key: `${start}|${end}`,
      start_time: start,
      end_time: end,
      label: `${start}-${end}`,
    });
  }
  return slots;
}

export function getFirstOverlapKey(row: ScheduledRow, plannerSlots: Pick<PlannerSlot, "start_time" | "end_time">[]) {
  for (const slot of plannerSlots) {
    if (intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time)) {
      return `${row.day}|${slot.start_time}|${slot.end_time}`;
    }
  }
  return `${row.day}|${row.start_time}|${row.end_time}`;
}

export function groupRowsBySlot(rows: ScheduledRow[], plannerSlots: Pick<PlannerSlot, "start_time" | "end_time">[]) {
  const map = new Map<string, ScheduledRow[]>();
  rows.forEach((row) => {
    plannerSlots.forEach((slot) => {
      if (intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time)) {
        const key = `${row.day}|${slot.start_time}|${slot.end_time}`;
        map.set(key, [...(map.get(key) ?? []), row]);
      }
    });
  });
  return map;
}

export function timeToMinutes(timeStr: string) {
  const [hour, minute] = timeStr.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

export function intervalsOverlap(startA: string, endA: string, startB: string, endB: string) {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(startB) < timeToMinutes(endA);
}

export function heatClass(value: number) {
  if (value === 0) return "load-0";
  if (value === 1) return "load-1";
  if (value === 2) return "load-2";
  if (value <= 4) return "load-4";
  return "load-5";
}
