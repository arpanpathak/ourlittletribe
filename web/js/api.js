// Calls to the server's JSON API. Paths are relative so the app also works under a sub-path.

/** Raised for any non-2xx answer; `status` holds the HTTP status. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body) {
  const options = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
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
    const message = data?.error || `Request failed (${response.status})`;
    if (response.status === 401) window.dispatchEvent(new CustomEvent("signed-out"));
    throw new ApiError(response.status, message);
  }
  return data;
}

const encode = encodeURIComponent;

export const api = {
  register: (email, name, password) => call("POST", "account/register", { email, name, password }),
  login: (email, password) => call("POST", "account/login", { email, password }),
  logout: () => call("POST", "account/logout"),
  me: () => call("GET", "me"),
  updateMe: (profile) => call("PATCH", "me", profile),
  person: (userId) => call("GET", `people/${encode(userId)}`),

  feed: () => call("GET", "feed"),
  search: (query) => call("GET", `search?q=${encode(query)}`),
  places: (query, near) =>
    call("GET", `places?q=${encode(query)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ""}`),

  tribes: () => call("GET", "tribes"),
  tribe: (tribeId) => call("GET", `tribes/${encode(tribeId)}`),
  createTribe: (tribe) => call("POST", "tribes", tribe),
  joinTribe: (tribeId) => call("POST", `tribes/${encode(tribeId)}/join`),
  leaveTribe: (tribeId) => call("POST", `tribes/${encode(tribeId)}/leave`),

  event: (eventId) => call("GET", `events/${encode(eventId)}`),
  createEvent: (event) => call("POST", "events", event),
  deleteEvent: (eventId) => call("DELETE", `events/${encode(eventId)}`),
  rsvp: (eventId, going) => call("POST", `events/${encode(eventId)}/rsvp`, { going }),
  vote: (eventId, vote) => call("POST", `events/${encode(eventId)}/vote`, { vote }),
  setOrigin: (eventId, point) => call("PUT", `events/${encode(eventId)}/origin`, point),
  clearOrigin: (eventId) => call("DELETE", `events/${encode(eventId)}/origin`),

  plan: (eventId) => call("POST", `events/${encode(eventId)}/plan`),
  addItem: (eventId, item) => call("POST", `events/${encode(eventId)}/items`, item),
  find: (eventId, query) => call("POST", `events/${encode(eventId)}/find`, { query }),
  trip: (eventId) => call("GET", `events/${encode(eventId)}/trip`),
  mark: (itemId, state) => call("POST", `items/${encode(itemId)}/mark`, { state }),
  removeItem: (itemId) => call("DELETE", `items/${encode(itemId)}`),
};
