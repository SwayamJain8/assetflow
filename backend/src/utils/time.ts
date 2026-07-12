import { env } from "../config/env";

/**
 * All human-readable times are formatted in the ORGANIZATION'S timezone, taken
 * from config — never from the server's ambient locale.
 *
 * Why this file exists: `date.toLocaleTimeString()` silently uses whatever
 * timezone the process happens to run in. On a developer's machine that is IST; in
 * the Docker container it is UTC. The same booking would then be described as
 * "09:00" in one place and "14:30" in another, and nobody would notice until a
 * user complained that the activity feed disagreed with the calendar.
 *
 * Timestamps sent to the frontend are always raw ISO instants — the browser knows
 * the viewer's timezone and formats them itself. This helper is only for strings
 * the SERVER has to compose: activity-log summaries and notification bodies.
 */
const TZ = env.APP_TIMEZONE;

export const formatTime = (date: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(date);

export const formatDateTime = (date: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(date);

/** "09:00–10:00" — the shape the activity feed and notifications want. */
export const formatRange = (from: Date, to: Date): string =>
  `${formatTime(from)}–${formatTime(to)}`;
