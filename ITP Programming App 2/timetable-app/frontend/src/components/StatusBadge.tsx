type Props = {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
};

export default function StatusBadge({ label, tone = "neutral" }: Props) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}
