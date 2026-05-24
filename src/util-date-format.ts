import { padToTwoDigits } from "./util-pad";

export function formatLocalDateTime(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${padToTwoDigits(date.getMonth() + 1)}-${padToTwoDigits(date.getDate())}`,
    time: `${padToTwoDigits(date.getHours())}:${padToTwoDigits(date.getMinutes())}`,
  };
}
