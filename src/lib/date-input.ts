function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

export function formatLocalDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseLocalDateInputToDueEpochSec(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dueDate = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (
    dueDate.getFullYear() !== year ||
    dueDate.getMonth() !== month - 1 ||
    dueDate.getDate() !== day
  ) {
    return NaN;
  }

  return Math.floor(dueDate.getTime() / 1000);
}
