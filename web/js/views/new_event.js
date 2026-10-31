// Planning a new event: what, when, and where to meet, picked on the map.

import { api } from "../api.js";
import { squatch } from "../art.js";
import { h, mount, toast, debounce, localInputToUnix, unixToLocalInput } from "../ui.js";
import { createMap, pin, PUGET_SOUND } from "../map.js";
import { go } from "../app.js";

function nextSaturdayMorning() {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  date.setHours(8, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** Draws the new-event page for the tribe `tribeId`. */
export async function renderNewEvent(view, tribeId) {
  const tribes = (await api.tribes()).filter((tribe) => tribe.is_member);
  if (!tribes.length) {
    mount(view, h("div", { class: "empty card" }, h("div", { html: squatch("map", 100) }), h("p", {}, "Join a tribe before planning."),
      h("a", { class: "button primary", href: "#/tribes" }, "Find a tribe")));
    return;
  }

  let meeting = null;
  const placeInput = h("input", { name: "place_name", required: true, maxlength: 200, placeholder: "Search a trailhead, park or cafe", autocomplete: "off" });
  const suggestions = h("ul", { class: "suggestions", role: "listbox" });
  const mapElement = h("div", { class: "map map-picker" });
  const pickedNote = h("p", { class: "muted small" }, "Search above or tap the map to set the meeting point.");

  const form = h("form", { class: "card stack" },
    h("h1", {}, "Plan an outing"),
    h("label", {}, "Tribe",
      h("select", { name: "tribe_id" }, tribes.map((tribe) =>
        h("option", { value: tribe.id, selected: tribe.id === tribeId ? true : null }, tribe.name)))),
    h("label", {}, "What's the plan?", h("input", { name: "title", required: true, maxlength: 120, placeholder: "Skyline Trail loop at Paradise" })),
    h("label", {}, "When", h("input", { name: "starts_at", type: "datetime-local", required: true, value: unixToLocalInput(nextSaturdayMorning()) })),
    h("label", {}, "Tell people about it",
      h("textarea", {
        name: "description",
        rows: 5,
        maxlength: 4000,
        placeholder: "5.5 mile loop, 1,700 ft gain. Lunch at Panorama Point. Dogs welcome. We'll stay for sunset.",
      }),
      h("span", { class: "hint" }, "The planning model reads this, so details help: distance, gain, food plans, dogs, kids, sunset.")),
    h("div", { class: "place-field" }, h("label", {}, "Where to meet", placeInput), suggestions),
    mapElement,
    pickedNote,
    h("button", { type: "submit", class: "button primary" }, "Create event"),
  );

  mount(view, h("div", { class: "narrow" }, form));

  const map = createMap(mapElement, PUGET_SOUND, 9);
  let marker = null;

  function setMeeting(point, name) {
    meeting = point;
    if (name) placeInput.value = name;
    if (marker) marker.setLatLng([point.lat, point.lng]);
    else marker = L.marker([point.lat, point.lng], { icon: pin("meet"), draggable: true }).addTo(map);
    marker.off("dragend");
    marker.on("dragend", () => {
      const moved = marker.getLatLng();
      meeting = { lat: moved.lat, lng: moved.lng };
    });
    map.setView([point.lat, point.lng], Math.max(map.getZoom(), 13));
    pickedNote.textContent = "Meeting point set. Drag the pin to adjust.";
  }

  map.on("click", (event) => setMeeting({ lat: event.latlng.lat, lng: event.latlng.lng }));

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!meeting) map.setView([position.coords.latitude, position.coords.longitude], 10);
      },
      () => {},
      { timeout: 4000 },
    );
  }

  const searchPlaces = debounce(async (text) => {
    if (text.trim().length < 3) {
      mount(suggestions);
      return;
    }
    try {
      const center = map.getCenter();
      const places = await api.places(text, { lat: center.lat, lng: center.lng });
      mount(suggestions, places.map((place) =>
        h("li", {
          role: "option",
          tabindex: "0",
          onclick: () => {
            setMeeting({ lat: place.lat, lng: place.lng }, place.name.split(",").slice(0, 2).join(","));
            mount(suggestions);
          },
        }, place.name)));
    } catch (error) {
      mount(suggestions, h("li", { class: "muted" }, error.message));
    }
  }, 450);
  placeInput.addEventListener("input", () => searchPlaces(placeInput.value));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!meeting) {
      toast("Set the meeting point on the map", "error");
      return;
    }
    const data = new FormData(form);
    const startsAt = localInputToUnix(data.get("starts_at"));
    try {
      const created = await api.createEvent({
        tribe_id: data.get("tribe_id"),
        title: data.get("title"),
        description: data.get("description"),
        place_name: data.get("place_name"),
        lat: meeting.lat,
        lng: meeting.lng,
        starts_at: startsAt,
        tz_offset_minutes: -new Date(startsAt * 1000).getTimezoneOffset(),
      });
      toast("Event created", "success");
      go(`/events/${created.id}`);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}
