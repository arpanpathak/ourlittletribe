// Calls to the server's JSON API, one function per route. Paths are relative,
// so the app also works under a sub-path.

import type {
  Briefing, CoverRequest, DescriptionDraftRequest, DrawingUpdate, Event, EventDetail, EventDraft, EventFields, Feed, InlinePicture, LatLng,
  MarkState, PlaceMatch, PlanResult, PrepItem, ProfileFields, ProfilePage, Photo, Rsvp, SearchResults, Suggestions,
  Trail, Tribe, TribeDetail, TribeDraft, TribeFields, TripView, Units, User, Vote,
} from "./types.js";

/** A failed request: its HTTP status and the server's message. */
export class ApiError extends Error {
  /** The HTTP status, such as 403. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A request body: JSON, or a picture file sent as itself. */
type Body = { json: unknown } | { file: File } | null;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function messageFor(status: number, data: unknown): string {
  if (status === 413) return "That picture is too large (15 MB at most)";

  const serverMessage = typeof data === "object" && data !== null && "error" in data ? String(data.error) : null;
  return capitalize(serverMessage ?? `Request failed (${status})`);
}

function requestInit(method: Method, body: Body, signal?: AbortSignal): RequestInit {
  const init: RequestInit = { method, credentials: "same-origin", headers: {}, signal };
  if (body === null) return init;

  if ("file" in body) {
    init.headers = { "Content-Type": body.file.type || "application/octet-stream" };
    init.body = body.file;
  } else {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body.json);
  }
  return init;
}

function parsed(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Throws the server's error for a failed response. */
async function refuse(response: Response): Promise<never> {
  if (response.status === 401) window.dispatchEvent(new CustomEvent("signed-out"));

  const data = parsed(await response.text());
  throw new ApiError(response.status, messageFor(response.status, data));
}

async function send<Answer>(method: Method, path: string, body: Body = null, signal?: AbortSignal): Promise<Answer> {
  const response = await fetch(`api/${path}`, requestInit(method, body, signal));
  if (!response.ok) return refuse(response);

  return parsed(await response.text()) as Answer;
}

/** Reads a response of JSON lines, calling `onLine` with each as it arrives. */
async function readLines<Line>(response: Response, onLine: (line: Line) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let unread = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    unread += decoder.decode(value, { stream: true });
    const lines = unread.split("\n");
    unread = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) onLine(JSON.parse(line) as Line);
    }
  }
}

/**
 * Has the model draw `scene`, calling `onPiece` with each new piece of SVG as
 * it is written, and resolves with the finished, cleaned drawing. Aborting
 * `signal` ends the request, which stops the model.
 */
async function drawCover(scene: string, signal: AbortSignal, onPiece: (text: string) => void): Promise<string> {
  const response = await fetch("api/cover-drawings", requestInit("POST", json({ scene }), signal));
  if (!response.ok) return refuse(response);

  let finished: DrawingUpdate | null = null;
  await readLines<DrawingUpdate>(response, (update) => {
    if (update.kind === "piece") onPiece(update.text);
    else finished = update;
  });

  const result = finished as DrawingUpdate | null;
  if (result?.kind === "done") return result.svg;
  if (result?.kind === "failed") throw new ApiError(502, result.message);
  throw new ApiError(502, "The drawing stopped part way. Try again.");
}

const json = (value: unknown): Body => ({ json: value });
const file = (picture: File): Body => ({ file: picture });
const encode = encodeURIComponent;

function nearParameters(near: LatLng | null): string {
  if (!near) return "";
  return `&lat=${near.lat.toFixed(4)}&lng=${near.lng.toFixed(4)}`;
}

/** Signing in and out, and your own account. */
export const account = {
  create: (email: string, name: string, password: string) => send<User>("POST", "users", json({ email, name, password })),
  signIn: (email: string, password: string) => send<User>("POST", "sessions", json({ email, password })),
  signOut: () => send<null>("DELETE", "sessions/current"),
  me: () => send<User>("GET", "users/me"),
  updateProfile: (profile: ProfileFields) => send<User>("PATCH", "users/me", json(profile)),
  setAvatar: (picture: File) => send<User>("PUT", "users/me/avatar", file(picture)),
  removeAvatar: () => send<User>("DELETE", "users/me/avatar"),
  setCover: (picture: File) => send<User>("PUT", "users/me/cover", file(picture)),
  removeCover: () => send<User>("DELETE", "users/me/cover"),
};

/** Other people. */
export const people = {
  profile: (userId: string) => send<ProfilePage>("GET", `users/${encode(userId)}`),
};

/** Tribes. */
export const tribes = {
  list: () => send<Tribe[]>("GET", "tribes"),
  detail: (tribeId: string) => send<TribeDetail>("GET", `tribes/${encode(tribeId)}`),
  create: (fields: TribeFields) => send<Tribe>("POST", "tribes", json(fields)),
  update: (tribeId: string, fields: TribeFields) => send<Tribe>("PATCH", `tribes/${encode(tribeId)}`, json(fields)),
  join: (tribeId: string) => send<Tribe>("PUT", `tribes/${encode(tribeId)}/members/me`),
  leave: (tribeId: string) => send<Tribe>("DELETE", `tribes/${encode(tribeId)}/members/me`),
  setCover: (tribeId: string, picture: File) => send<Tribe>("PUT", `tribes/${encode(tribeId)}/cover`, file(picture)),
  removeCover: (tribeId: string) => send<Tribe>("DELETE", `tribes/${encode(tribeId)}/cover`),
};

/** Events. */
export const events = {
  list: () => send<Event[]>("GET", "events"),
  detail: (eventId: string) => send<EventDetail>("GET", `events/${encode(eventId)}`),
  create: (tribeId: string, fields: EventFields) => send<Event>("POST", "events", json({ tribe_id: tribeId, ...fields })),
  update: (eventId: string, fields: EventFields) => send<Event>("PATCH", `events/${encode(eventId)}`, json(fields)),
  remove: (eventId: string) => send<null>("DELETE", `events/${encode(eventId)}`),
  setRsvp: (eventId: string, answer: Rsvp) => send<Event>("PUT", `events/${encode(eventId)}/rsvp`, json({ answer })),
  setVote: (eventId: string, vote: Vote) => send<Event>("PUT", `events/${encode(eventId)}/vote`, json({ vote })),
  removeVote: (eventId: string) => send<Event>("DELETE", `events/${encode(eventId)}/vote`),
  setOrigin: (eventId: string, origin: LatLng) => send<LatLng>("PUT", `events/${encode(eventId)}/origin`, json(origin)),
  clearOrigin: (eventId: string) => send<null>("DELETE", `events/${encode(eventId)}/origin`),
  setCover: (eventId: string, picture: File) => send<Event>("PUT", `events/${encode(eventId)}/cover`, file(picture)),
  removeCover: (eventId: string) => send<Event>("DELETE", `events/${encode(eventId)}/cover`),
  trip: (eventId: string) => send<TripView>("GET", `events/${encode(eventId)}/trip`),
  briefing: (eventId: string, units: Units) => send<Briefing>("GET", `events/${encode(eventId)}/briefing?units=${units}`),
  trails: (eventId: string) => send<Trail[]>("GET", `events/${encode(eventId)}/trails`),
};

/** Photos and pictures. */
export const pictures = {
  addPhoto: (eventId: string, picture: File, caption = "") =>
    send<Photo[]>("POST", `events/${encode(eventId)}/photos${caption ? `?caption=${encode(caption)}` : ""}`, file(picture)),
  removePhoto: (imageId: string) => send<Photo[]>("DELETE", `photos/${encode(imageId)}`),
  addInline: (picture: File) => send<InlinePicture>("POST", "pictures", file(picture)),
};

/** The packing list. */
export const items = {
  add: (eventId: string, item: { name: string; scope: string; why?: string }) =>
    send<PrepItem[]>("POST", `events/${encode(eventId)}/items`, json(item)),
  plan: (eventId: string) => send<PlanResult>("POST", `events/${encode(eventId)}/item-plans`),
  suggestions: (eventId: string, search: string) =>
    send<Suggestions>("GET", `events/${encode(eventId)}/item-suggestions?q=${encode(search)}`),
  setMark: (itemId: string, state: MarkState) => send<PrepItem[]>("PUT", `items/${encode(itemId)}/marks/me`, json({ state })),
  clearMark: (itemId: string) => send<PrepItem[]>("DELETE", `items/${encode(itemId)}/marks/me`),
  remove: (itemId: string) => send<PrepItem[]>("DELETE", `items/${encode(itemId)}`),
};

/** Places on the map. */
export const places = {
  search: (text: string, near: LatLng | null, signal?: AbortSignal) =>
    send<PlaceMatch[]>("GET", `places?q=${encode(text)}${nearParameters(near)}`, null, signal),
  bestMatches: (text: string, near: LatLng | null, signal?: AbortSignal) =>
    send<PlaceMatch[]>("GET", `places/best-matches?q=${encode(text)}${nearParameters(near)}`, null, signal),
  nearest: (point: LatLng) => send<PlaceMatch | null>("GET", `places/nearest?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}`),
};

/** The home feed and text search. */
export const discovery = {
  feed: () => send<Feed>("GET", "feed"),
  search: (text: string) => send<SearchResults>("GET", `search?q=${encode(text)}`),
  related: (text: string) => send<SearchResults>("GET", `search/related?q=${encode(text)}`),
};

/** Drafts the model writes. */
export const drafts = {
  event: (text: string, today: string, near: LatLng | null) => send<EventDraft>("POST", "event-drafts", json({ text, today, near })),
  description: (request: DescriptionDraftRequest) => send<{ text: string }>("POST", "description-drafts", json(request)),
  tribe: (text: string) => send<TribeDraft>("POST", "tribe-drafts", json({ text })),
  coverScene: (request: CoverRequest, signal?: AbortSignal) => send<{ scene: string }>("POST", "cover-scenes", json(request), signal),
  coverDrawing: drawCover,
};
