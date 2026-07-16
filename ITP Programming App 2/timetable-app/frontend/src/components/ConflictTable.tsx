/*
 * Displays hard and soft schedule constraint violations after generation.
 */

import { ChevronDown, ShieldAlert, Sparkles, Zap } from "lucide-react";
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
  quickFixState?: (violation: ConstraintViolation) => QuickFixState;
};

export type QuickFixState = "available" | "unavailable" | "checking" | "error";

export default function ConflictTable({
  violations,
  activeConflictId,
  quickFixOpenId,
  resolvingConflictId,
  onSelectConflict,
  onToggleQuickFix,
  renderQuickFixTray,
  quickFixState,
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
                  <div className="conflict-group-heading">
                    <span className={`conflict-group-indicator ${group.key}`}>
                      {group.key === "hard" ? <ShieldAlert size={14} /> : <Sparkles size={14} />}
                      {group.key === "hard" ? "Blocking" : "Optional"}
                    </span>
                    <div className="conflict-group-copy">
                      <strong>{group.label}</strong>
                      <span>
                        {group.items.length} issue{group.items.length === 1 ? "" : "s"} · {group.hint}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
              {group.items.map((item) => {
                const quickFixOpen = item.id === quickFixOpenId;
                const itemQuickFixState = quickFixState?.(item) ?? "available";
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
                            className={`button secondary slim quick-fix-toggle ${quickFixOpen ? "open" : ""} ${itemQuickFixState}`}
                            disabled={itemQuickFixState !== "available" && !quickFixOpen}
                            title={quickFixStateTitle(itemQuickFixState)}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleQuickFix?.(item);
                            }}
                          >
                            <Zap size={14} />
                            {quickFixStateLabel(itemQuickFixState)}
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

function quickFixStateLabel(state: QuickFixState) {
  if (state === "unavailable") return "No Fix";
  if (state === "checking") return "Checking";
  if (state === "error") return "Unavailable";
  return "Quick Fix";
}

function quickFixStateTitle(state: QuickFixState) {
  if (state === "unavailable") return "No clean quick fix is available";
  if (state === "checking") return "Checking for clean quick fixes";
  if (state === "error") return "Quick fix availability could not be checked";
  return undefined;
}
