/*
 * Displays hard and soft schedule constraint violations after generation.
 */

import { ChevronDown, Zap } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { conflictPresentation } from "../conflictPresentation";
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
  const groups = [
    {
      key: "hard" as const,
      label: "Hard Constraints",
      hint: "Must be fixed before export",
      items: violations.filter((item) => item.severity === "HARD"),
    },
    {
      key: "soft" as const,
      label: "Soft Constraints",
      hint: "Optional quality warnings",
      items: violations.filter((item) => item.severity === "SOFT"),
    },
  ].filter((group) => group.items.length > 0);
  const columnCount = hasQuickFix ? 5 : 4;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Impact</th>
            <th>Issue Type</th>
            <th>What Happened</th>
            <th>Classes</th>
            {hasQuickFix && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <tr className={`conflict-group-row ${group.key}`}>
                <td colSpan={columnCount}>
                  <div>
                    <strong>{group.label}</strong>
                    <span>
                      {group.items.length} issue{group.items.length === 1 ? "" : "s"} | {group.hint}
                    </span>
                  </div>
                </td>
              </tr>
              {group.items.map((item) => {
                const quickFixOpen = item.id === quickFixOpenId;
                const urgencyClass = item.severity === "HARD" ? "conflict-hard-row" : "conflict-soft-row";
                const resolvingClass = item.id === resolvingConflictId ? "quick-fix-resolving" : "";
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={`${urgencyClass} ${resolvingClass} ${
                        item.id === activeConflictId ? "conflict-active-row" : ""
                      }`}
                      style={{ cursor: onSelectConflict ? "pointer" : "default" }}
                      onClick={() => onSelectConflict?.(item)}
                    >
                      <td>
                        <StatusBadge
                          label={item.severity === "HARD" ? "Blocks export" : "Optional"}
                          tone={item.severity === "HARD" ? "bad" : "warn"}
                        />
                      </td>
                      <td>
                        <strong>{conflictPresentation(item).label}</strong>
                        <small className="conflict-code">{item.constraint_code}</small>
                      </td>
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
                        <td colSpan={columnCount}>{renderQuickFixTray?.(item)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
