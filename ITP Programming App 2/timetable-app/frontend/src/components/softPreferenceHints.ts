import type { SessionRow } from "../types";
import type { SoftPreferenceHint } from "./SoftConstraintWorkflow";

export function softConstraintHints(session: SessionRow): SoftPreferenceHint[] {
  const hints: SoftPreferenceHint[] = [];
  if (session.preferred_days) hints.push({ label: "Preferred", value: session.preferred_days, tone: "preferred" });
  if (session.avoid_days) hints.push({ label: "Avoid", value: session.avoid_days, tone: "avoid" });
  if ((session.delivery_mode || "").toLowerCase().includes("online")) {
    hints.push({ label: "Delivery", value: "Online placement preference", tone: "online" });
  }
  if (session.remarks) hints.push({ label: "Remarks", value: session.remarks, tone: "remarks" });
  return hints;
}
