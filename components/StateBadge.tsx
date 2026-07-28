const STATE_STYLES: Record<string, { background: string; color: string }> = {
  uploaded: { background: "#e5e7eb", color: "#374151" },
  validating: { background: "#e5e7eb", color: "#374151" },
  validated: { background: "#dbeafe", color: "#1e40af" },
  applying: { background: "#dbeafe", color: "#1e40af" },
  completed: { background: "#d1fae5", color: "#065f46" },
  paused: { background: "#fef3c7", color: "#92400e" },
  cancelled: { background: "#e5e7eb", color: "#374151" },
  failed: { background: "#fee2e2", color: "#991b1b" },
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.uploaded;
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[0.8125rem] font-medium"
      style={{ backgroundColor: style.background, color: style.color }}
    >
      {state}
    </span>
  );
}
