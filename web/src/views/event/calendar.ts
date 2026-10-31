// Taking an event elsewhere: a calendar file, and the share sheet.

import type { Event } from "../../api/types.js";
import { h } from "../../dom.js";
import { formatWhen } from "../../format.js";
import { markdownToText } from "../../markdown.js";
import { copyText } from "../../ui/controls.js";

/** How long a calendar entry lasts, seconds. */
const CALENDAR_LENGTH = 3 * 3600;

function icsStamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function calendarLines(event: Event): string[] {
  const { name, lat, lng } = event.meeting_point;
  const description = `${markdownToText(event.description)}\n\n${window.location.href}`.trim();

  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OurLittleTribe//EN", "BEGIN:VEVENT",
    `UID:${event.id}@ourlittletribe`, `DTSTAMP:${icsStamp(Date.now() / 1000)}`,
    `DTSTART:${icsStamp(event.starts_at)}`, `DTEND:${icsStamp(event.starts_at + CALENDAR_LENGTH)}`,
    `SUMMARY:${icsText(event.title)}`, `LOCATION:${icsText(name)}`, `GEO:${lat};${lng}`,
    `DESCRIPTION:${icsText(description)}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
}

/** Downloads a calendar file for the event. */
export function downloadCalendarFile(event: Event): void {
  const blob = new Blob([calendarLines(event).join("\r\n")], { type: "text/calendar" });
  const fileName = `${event.title.replace(/[^\w -]+/g, "").trim() || "event"}.ics`;
  const link = h("a", { href: URL.createObjectURL(blob), download: fileName });

  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
}

/** Opens the device's share sheet, or copies the link where there is none. */
export async function share(event: Event): Promise<void> {
  const url = window.location.href.split("?")[0] ?? window.location.href;
  if (!navigator.share) {
    await copyText(url);
    return;
  }

  try {
    await navigator.share({ title: event.title, text: `${event.title} · ${formatWhen(event.starts_at)}`, url });
  } catch {
    await copyText(url);
  }
}
