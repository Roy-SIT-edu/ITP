const ISSUE_LABELS: Record<string, string> = {
  "Fixed Time": "Fixed session conflict",
};

export function formatIssueType(field: string) {
  return ISSUE_LABELS[field] ?? field;
}

export function labelForStatus(errorCount: number) {
  return errorCount === 0
    ? "Clean: Ready to Generate"
    : `Attention Required: ${errorCount} Conflict${errorCount === 1 ? "" : "s"} Found`;
}
