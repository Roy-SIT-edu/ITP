import type { ConstraintViolation } from "./types";

type ConflictPresentation = {
  label: string;
  explanation: string;
};

const CONFLICT_PRESENTATION: Record<string, ConflictPresentation> = {
  ROOM_DOUBLE_BOOKING: {
    label: "Room double-booked",
    explanation: "Two classes use the same room at overlapping times.",
  },
  STUDENT_GROUP_DOUBLE_BOOKING: {
    label: "Student group overlap",
    explanation: "A student group is expected in two classes at the same time.",
  },
  STAFF_DOUBLE_BOOKING: {
    label: "Staff double-booked",
    explanation: "A staff member is assigned to overlapping classes.",
  },
  ROOM_CAPACITY_MISMATCH: {
    label: "Room too small",
    explanation: "The selected room cannot hold the full class.",
  },
  DELIVERY_ROOM_MISMATCH: {
    label: "Wrong room type",
    explanation: "The room does not support this class's delivery mode.",
  },
  REQUIRED_ROOM_MISMATCH: {
    label: "Required room not used",
    explanation: "The class was placed outside its required room list.",
  },
  INVALID_FIXED_TIME: {
    label: "Fixed time changed",
    explanation: "A fixed class is not in its required day and time.",
  },
  ONLINE_NOT_MON_TUE: {
    label: "Online class later in week",
    explanation: "Online teaching is preferred on Monday or Tuesday.",
  },
  TUTOR_IDLE_GAP: {
    label: "Long staff gap",
    explanation: "A staff member has an idle gap longer than two hours.",
  },
  SHORT_CAMPUS_DAY: {
    label: "Short campus day",
    explanation: "Students travel to campus for only a short teaching block.",
  },
  LONG_CONSECUTIVE_DAY: {
    label: "Long teaching block",
    explanation: "Students have more than four consecutive teaching hours.",
  },
  ONLINE_F2F_ADJACENT_SWITCH: {
    label: "No travel gap",
    explanation: "Online and face-to-face classes switch with no travel time.",
  },
};

function fallbackLabel(code: string) {
  return code
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function conflictPresentation(violation: ConstraintViolation): ConflictPresentation {
  return (
    CONFLICT_PRESENTATION[violation.constraint_code] ?? {
      label: fallbackLabel(violation.constraint_code),
      explanation: violation.message,
    }
  );
}

export function uniqueConflictTypes(violations: ConstraintViolation[]) {
  const byCode = new Map<string, ConstraintViolation>();
  violations.forEach((violation) => byCode.set(violation.constraint_code, violation));
  return Array.from(byCode.values());
}
