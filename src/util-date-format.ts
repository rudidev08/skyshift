const padTwoDigits = (value: number) => String(value).padStart(2, "0");

export function formatLocalDateTime(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`,
    time: `${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`,
  };
}
