const ENGLISH_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

const ENGLISH_SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function formatSessionDate(
  timestamp: number | string | null | undefined,
  now = new Date(),
): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  return isSameLocalDay(date, now)
    ? ENGLISH_TIME_FORMATTER.format(date)
    : `${date.getDate()} ${ENGLISH_SHORT_MONTH_FORMATTER.format(date)}`;
}
