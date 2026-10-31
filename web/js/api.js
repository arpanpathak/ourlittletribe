// Calls to the server's JSON API. Paths are relative so the app also works under a sub-path.

/** Raised for any non-2xx answer; `status` holds the HTTP status. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function send(method, path, body, contentType) {
  const options = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    options.headers["Content-Type"] = contentType;
    options.body = body;
  }
  const response = await fetch(`api/${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    let message = data?.error || `Request failed (${response.status})`;
    if (response.status === 413) message = "That picture is too large (15 MB at most)";
    if (response.status === 401) window.dispatchEvent(new CustomEvent("signed-out"));
    throw new ApiError(response.status, message.charAt(0).toUpperCase() + message.slice(1));
  }
  return data;
}

const call = (method, path, body) =>
  send(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json");

/** Sends a picture file as the raw request body. */
const upload = (path, file) => send("POST", path, file, file.type || "application/octet-stream");

const encode = encodeURIComponent;

export const api = {
  register: (email, name, password) => call("POST", "account/register", { email, name, password }),
  login: (email, password) => call("POST", "account/login", { email, password }),
  logout: () => call("POST", "account/logout"),
  me: () => call("GET", "me"),
  updateMe: (profile) => call("PATCH", "me", profile),
  setAvatar: (file) => upload("me/avatar", file),
  removeAvatar: () => call("DELETE", "me/avatar"),
  setProfileCover: (file) => upload("me/cover", file),
  removeProfileCover: () => call("DELETE", "me/cover"),
  addPicture: (file) => upload("pictures", file),
  person: (userId) => call("GET", `people/${encode(userId)}`),

  feed: () => call("GET", "feed"),
  search: (query) => call("GET", `search?q=${encode(query)}`),
  places: (query, near) =>
    call("GET", `places?q=${encode(query)}${near ? `&lat=${near.lat.toFixed(4)}&lng=${near.lng.toFixed(4)}` : ""}`),
  smartPlaces: (query, near) =>
    call("GET", `places/smart?q=${encode(query)}${near ? `&lat=${near.lat.toFixed(4)}&lng=${near.lng.toFixed(4)}` : ""}`),
  placeAt: (point) => call("GET", `places/at?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}`),

  tribes: () => call("GET", "tribes"),
  tribe: (tribeId) => call("GET", `tribes/${encode(tribeId)}`),
  createTribe: (tribe) => call("POST", "tribes", tribe),
  updateTribe: (tribeId, change) => call("PATCH", `tribes/${encode(tribeId)}`, change),
  setTribeCover: (tribeId, file) => upload(`tribes/${encode(tribeId)}/cover`, file),
  removeTribeCover: (tribeId) => call("DELETE", `tribes/${encode(tribeId)}/cover`),
  joinTribe: (tribeId) => call("POST", `tribes/${encode(tribeId)}/join`),
  leaveTribe: (tribeId) => call("POST", `tribes/${encode(tribeId)}/leave`),

  events: () => call("GET", "events"),
  event: (eventId) => call("GET", `events/${encode(eventId)}`),
  createEvent: (event) => call("POST", "events", event),
  updateEvent: (eventId, change) => call("PATCH", `events/${encode(eventId)}`, change),
  deleteEvent: (eventId) => call("DELETE", `events/${encode(eventId)}`),
  setEventCover: (eventId, file) => upload(`events/${encode(eventId)}/cover`, file),
  removeEventCover: (eventId) => call("DELETE", `events/${encode(eventId)}/cover`),
  addPhoto: (eventId, file, caption = "") =>
    upload(`events/${encode(eventId)}/photos${caption ? `?caption=${encode(caption)}` : ""}`, file),
  removePhoto: (imageId) => call("DELETE", `photos/${encode(imageId)}`),
  rsvp: (eventId, going) => call("POST", `events/${encode(eventId)}/rsvp`, { going }),
  setOrigin: (eventId, point) => call("PUT", `events/${encode(eventId)}/origin`, point),
  clearOrigin: (eventId) => call("DELETE", `events/${encode(eventId)}/origin`),

  plan: (eventId) => call("POST", `events/${encode(eventId)}/plan`),
  addItem: (eventId, item) => call("POST", `events/${encode(eventId)}/items`, item),
  find: (eventId, query) => call("POST", `events/${encode(eventId)}/find`, { query }),
  trip: (eventId) => call("GET", `events/${encode(eventId)}/trip`),
  mark: (itemId, state) => call("POST", `items/${encode(itemId)}/mark`, { state }),
  removeItem: (itemId) => call("DELETE", `items/${encode(itemId)}`),
};
