/*
 * Displays hard and soft schedule constraint violations after generation.
 */

import { ChevronDown, Zap } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { ConstraintViolation } from "../types";
import StatusBadge from "./StatusBadge";

type Props = {
  violations: ConstraintViolation[];
  activeConflictId?: number | null;
  quickFixOpenId?: number | null;
  resolvingConflictId?: number | null;
  onSelectConflict?: (violation: ConstraintViolation) => void;
  onToggleQuickFix?: (violation: ConstraintViolation) => void;
  renderQuickFixTray?: (violation: ConstraintViolation) => ReactNode;
};

export default function ConflictTable({
  violations,
  activeConflictId,
  quickFixOpenId,
  resolvingConflictId,
  onSelectConflict,
  onToggleQuickFix,
  renderQuickFixTray,
}: Props) {
  if (violations.length === 0) {
    return <div className="empty-state">No generated timetable conflicts found.</div>;
  }

  const hasQuickFix = Boolean(onToggleQuickFix && renderQuickFixTray);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Code</th>
            <th>Message</th>
            <th>Sessions</th>
            {hasQuickFix && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {violations.map((item) => {
            const quickFixOpen = item.id === quickFixOpenId;
            const urgencyClass = item.severity === "HARD" ? "conflict-hard-row" : "conflict-soft-row";
            const resolvingClass = item.id === resolvingConflictId ? "quick-fix-resolving" : "";
            return (
              <Fragment key={item.id}>
                <tr
                  className={`${urgencyClass} ${resolvingClass} ${item.id === activeConflictId ? "conflict-active-row" : ""}`}
                  style={{ cursor: onSelectConflict ? "pointer" : "default" }}
                  onClick={() => onSelectConflict?.(item)}
                >
                  <td>
                    <StatusBadge label={item.severity} tone={item.severity === "HARD" ? "bad" : "warn"} />
                  </td>
                  <td>{item.constraint_code}</td>
                  <td>{item.message}</td>
                  <td>{item.affected_session_ids.join(", ")}</td>
                  {hasQuickFix && (
                    <td>
                      <button
                        className={`button secondary slim quick-fix-toggle ${quickFixOpen ? "open" : ""}`}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleQuickFix?.(item);
                        }}
                      >
                        <Zap size={14} />
                        Quick Fix
                        <ChevronDown size={14} />
                      </button>
                    </td>
                  )}
                </tr>
                {quickFixOpen && hasQuickFix && (
                  <tr className="quick-fix-row">
                    <td colSpan={5}>{renderQuickFixTray?.(item)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
