import type { ReportConflict } from "../types";

type ConflictSession = ReportConflict["affected_sessions"][number];

export type ConsolidatedConflictDetail = {
  message: string;
  occurrence_count: number;
  affected_sessions: ConflictSession[];
};

export type ConsolidatedConflictGroup = {
  key: string;
  severity: ReportConflict["severity"];
  constraint_code: string;
  occurrence_count: number;
  affected_sessions: ConflictSession[];
  details: ConsolidatedConflictDetail[];
};

type MutableConflictDetail = Omit<ConsolidatedConflictDetail, "affected_sessions"> & {
  affected_sessions: Map<number, ConflictSession>;
};

type MutableConflictGroup = Omit<ConsolidatedConflictGroup, "affected_sessions" | "details"> & {
  affected_sessions: Map<number, ConflictSession>;
  details: Map<string, MutableConflictDetail>;
};

export function consolidateReportConflicts(items: ReportConflict[]): ConsolidatedConflictGroup[] {
  const groups = new Map<string, MutableConflictGroup>();

  for (const item of items) {
    const key = `${item.severity}|${item.constraint_code}`;
    const group = groups.get(key) ?? {
      key,
      severity: item.severity,
      constraint_code: item.constraint_code,
      occurrence_count: 0,
      affected_sessions: new Map<number, ConflictSession>(),
      details: new Map<string, MutableConflictDetail>(),
    };
    group.occurrence_count += 1;

    const message = item.message.trim() || "No message recorded.";
    const detail = group.details.get(message) ?? {
      message,
      occurrence_count: 0,
      affected_sessions: new Map<number, ConflictSession>(),
    };
    detail.occurrence_count += 1;

    for (const session of conflictSessions(item)) {
      group.affected_sessions.set(session.session_id, session);
      detail.affected_sessions.set(session.session_id, session);
    }

    group.details.set(message, detail);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      severity: group.severity,
      constraint_code: group.constraint_code,
      occurrence_count: group.occurrence_count,
      affected_sessions: sortedSessions(group.affected_sessions),
      details: Array.from(group.details.values())
        .map((detail) => ({
          message: detail.message,
          occurrence_count: detail.occurrence_count,
          affected_sessions: sortedSessions(detail.affected_sessions),
        }))
        .sort(
          (left, right) => right.occurrence_count - left.occurrence_count || left.message.localeCompare(right.message),
        ),
    }))
    .sort(
      (left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        right.occurrence_count - left.occurrence_count ||
        left.constraint_code.localeCompare(right.constraint_code),
    );
}

function conflictSessions(item: ReportConflict): ConflictSession[] {
  const sessions = new Map(item.affected_sessions.map((session) => [session.session_id, session]));
  for (const sessionId of item.affected_session_ids) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        session_id: sessionId,
        requirement_id: null,
        module_code: null,
        student_group_code: null,
        placement: "Not available",
      });
    }
  }
  return Array.from(sessions.values());
}

function sortedSessions(sessions: Map<number, ConflictSession>) {
  return Array.from(sessions.values()).sort((left, right) => sessionLabel(left).localeCompare(sessionLabel(right)));
}

function sessionLabel(session: ConflictSession) {
  return session.module_code ?? session.requirement_id ?? `Session ${session.session_id}`;
}

function severityRank(severity: ReportConflict["severity"]) {
  return severity === "HARD" ? 0 : 1;
}
