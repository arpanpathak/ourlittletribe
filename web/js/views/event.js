// The event page: the plan, the real conditions, the shared prep list the
// model drafts, search for what you need, and stores along your way.

import { api } from "../api.js";
import { skyline, squatch, emblem, SPARKLE } from "../art.js";
import { h, mount, toast, avatar, busyButton, formatWhen, relativeTime, debounce } from "../ui.js";
import { createMap, pin, routeLine, fitTo, directionsUrl } from "../map.js";
import { session, go } from "../app.js";

function skyForHour(unixSeconds) {
  const hour = new Date(unixSeconds * 1000).getHours();
  if (hour >= 19 || hour < 5) return "night";
  if (hour >= 15) return "dusk";
  return "dawn";
}

function clock(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function conditionChips(conditions) {
  const chips = [];
  const forecast = conditions.forecast;
  if (forecast) {
    chips.push(["temp", `${Math.round(forecast.max_temp_c)}° / ${Math.round(forecast.min_temp_c)}°C`]);
    chips.push(["rain", `${Math.round(forecast.precipitation_chance)}% rain`]);
    if (forecast.snowfall_cm > 0) chips.push(["snow", `${forecast.snowfall_cm.toFixed(1)} cm snow`]);
    chips.push(["wind", `${Math.round(forecast.max_wind_kmh)} km/h wind`]);
    if (forecast.max_uv_index >= 3) chips.push(["uv", `UV ${forecast.max_uv_index.toFixed(0)}`]);
    if (forecast.sunset) chips.push(["sun", `Sunset ${clock(forecast.sunset)}`]);
  } else {
    chips.push(["cloud", "Forecast appears 16 days out"]);
  }
  if (conditions.elevation_m !== null && conditions.elevation_m !== undefined) {
    chips.push(["peak", `${Math.round(conditions.elevation_m).toLocaleString()} m`]);
  }
  return h("div", { class: "conditions" }, chips.map(([kind, text]) => h("span", { class: `condition condition-${kind}` }, text)));
}

function minutes(value) {
  if (value < 1) return "on the way";
  if (value < 60) return `+${Math.round(value)} min`;
  return `+${Math.floor(value / 60)} h ${Math.round(value % 60)} min`;
}

function durationText(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const rest = Math.round(totalMinutes % 60);
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

/** Draws the event page. */
export async function renderEvent(view, eventId) {
  let detail = await api.event(eventId);
  const me = session.user;

  const listSlot = h("div");
  const findSlot = h("div");
  const tripSlot = h("div", { class: "trip" });
  const peopleSlot = h("div");
  const heroSlot = h("div");
  const mapElement = h("div", { class: "map map-event" });

  let map = null;
  let tripLayer = null;
  let originMarker = null;
  let pickingStart = false;
  let lastTrip = null;

  const isGoing = () => detail.event.my_rsvp === "going";
  const destination = () => ({ lat: detail.event.lat, lng: detail.event.lng });

  async function refresh() {
    detail = await api.event(eventId);
    drawHero();
    drawList();
    drawPeople();
  }

  function drawHero() {
    const { event } = detail;
    const sky = skyForHour(event.starts_at);
    const rsvpButton = isGoing()
      ? busyButton("Can't make it", async () => {
          await api.rsvp(event.id, false);
          await refresh();
          loadTrip();
        }, { class: "button ghost on-dark" })
      : busyButton("I'm going", async () => {
          await api.rsvp(event.id, true);
          toast("See you there!", "success");
          await refresh();
        }, { class: "button primary" });
    const voteButton = (value, label) =>
      busyButton(label, async () => {
        await api.vote(event.id, event.my_vote === value ? 0 : value);
        await refresh();
      }, { class: `vote${event.my_vote === value ? " voted" : ""}`, "aria-label": value > 0 ? "Up-vote" : "Down-vote" });

    mount(heroSlot,
      h("section", { class: `page-hero event-hero sky-${sky}` },
        h("div", { class: "page-hero-art", html: skyline(sky, { stars: sky === "night" }) }),
        h("div", { class: "page-hero-inner" },
          h("div", {},
            h("a", { class: "eyebrow tribe-tag on-dark", href: `#/tribes/${event.tribe_id}` }, h("span", { html: emblem(event.tribe_emblem, 18) }), event.tribe_name),
            h("h1", {}, event.title),
            h("p", { class: "lead" }, `${formatWhen(event.starts_at)} · ${event.place_name}`),
            h("p", { class: "hero-meta" },
              h("span", { class: "pill on-dark" }, `${event.going_count} going`),
              h("span", { class: "muted on-dark" }, relativeTime(event.starts_at))),
          ),
          h("div", { class: "hero-actions" },
            h("div", { class: "votes" }, voteButton(1, "▲"), h("span", {}, String(event.net_votes)), voteButton(-1, "▼")),
            rsvpButton,
          ),
        ),
      ),
      conditionChips(detail.conditions),
    );
  }

  function itemControls(item) {
    const myMark = item.marks.find((mark) => mark.user_id === me.id);
    const setMark = (state) => async () => {
      await api.mark(item.id, state);
      await refresh();
      loadTrip();
    };
    if (item.scope === "shared") {
      if (!item.marks.length) return busyButton("I'll bring it", setMark("bringing"), { class: "button small" });
      if (myMark?.state === "bringing")
        return h("div", { class: "row" },
          busyButton("Got it", setMark("got"), { class: "button small primary" }),
          busyButton("Drop", setMark(null), { class: "button small ghost" }));
      if (myMark?.state === "got") return busyButton("Undo", setMark(null), { class: "button small ghost" });
      return null;
    }
    return myMark?.state === "got"
      ? busyButton("✓ Got it", setMark(null), { class: "button small done" })
      : busyButton("I've got it", setMark("got"), { class: "button small" });
  }

  function itemRow(item) {
    const goingCount = Math.max(detail.event.going_count, 1);
    const got = item.marks.filter((mark) => mark.state === "got");
    const bringing = item.marks.filter((mark) => mark.state === "bringing");
    let status;
    if (item.scope === "shared") {
      if (got.length) status = h("span", { class: "status done" }, `${got[0].name} got it`);
      else if (bringing.length) status = h("span", { class: "status pending" }, `${bringing[0].name} is bringing it`);
      else status = h("span", { class: "status open" }, "Nobody yet");
    } else {
      const share = Math.min(got.length / goingCount, 1);
      status = h("div", { class: "have-meter" },
        h("div", { class: "meter" }, h("span", { style: `width:${Math.round(share * 100)}%` })),
        h("span", { class: "small muted" }, `${got.length} of ${goingCount} have it`));
    }
    const canRemove = me.is_admin || item.added_by === me.id || detail.event.creator_id === me.id;
    return h("li", { class: `item ${got.length && item.scope === "shared" ? "item-done" : ""}` },
      h("div", { class: "item-main" },
        h("div", { class: "item-title" },
          h("strong", {}, item.name),
          item.quantity > 1 ? h("span", { class: "qty" }, `×${item.quantity}`) : null,
          item.source === "model" ? h("span", { class: "ai-tag", title: "Suggested by the planning model", html: `${SPARKLE} AI` }) : null),
        item.why ? h("p", { class: "why" }, item.why) : null,
        h("div", { class: "item-foot" },
          status,
          item.marks.length ? h("div", { class: "faces" }, item.marks.slice(0, 6).map((mark) => avatar(mark.name, 22))) : null),
        item.often_with?.length
          ? h("p", { class: "often small" }, "Groups often also got: ", item.often_with.map((pairing) => h("span", { class: "chip" }, pairing.item)))
          : null,
        item.shop_tags.length ? h("div", { class: "tags" }, item.shop_tags.map((tag) => h("span", { class: "tag" }, tag.replace(/_/g, " ")))) : null,
      ),
      h("div", { class: "item-actions" },
        detail.is_member ? itemControls(item) : null,
        canRemove
          ? busyButton("✕", async () => {
              await api.removeItem(item.id);
              await refresh();
            }, { class: "icon-button subtle", title: "Remove", "aria-label": `Remove ${item.name}` })
          : null),
    );
  }

  function drawList() {
    const items = detail.items;
    const shared = items.filter((item) => item.scope === "shared");
    const personal = items.filter((item) => item.scope === "personal");
    const covered = shared.filter((item) => item.marks.length).length + personal.filter((item) => item.marks.some((mark) => mark.user_id === me.id && mark.state === "got")).length;

    const planButton = detail.model_ready && detail.is_member
      ? busyButton(items.length ? "Ask for more ideas" : "Plan with AI", async (button) => {
          button.replaceChildren(h("span", { class: "spinner" }), "Reading the plan, forecast and route…");
          const result = await api.plan(eventId);
          toast(result.added ? `Added ${result.added} items` : "Nothing new to add", result.added ? "success" : "info");
          await refresh();
          loadTrip();
        }, { class: "button primary ai-button" })
      : null;

    const addInput = h("input", { placeholder: "Add an item, e.g. bear spray", maxlength: 80, "aria-label": "New item" });
    const scopeSelect = h("select", { "aria-label": "Who brings it" },
      h("option", { value: "personal" }, "Everyone"),
      h("option", { value: "shared" }, "One for the group"));
    const addForm = detail.is_member
      ? h("form", { class: "add-item" }, addInput, scopeSelect, h("button", { type: "submit", class: "button" }, "Add"))
      : null;
    addForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!addInput.value.trim()) return;
      try {
        await api.addItem(eventId, { name: addInput.value, scope: scopeSelect.value });
        addInput.value = "";
        await refresh();
        setTimeout(loadTrip, 9000);
      } catch (error) {
        toast(error.message, "error");
      }
    });

    let body;
    if (!items.length) {
      body = h("div", { class: "empty" },
        h("div", { html: squatch("think", 110) }),
        h("p", {}, detail.model_ready
          ? "Nothing on the list yet. The model reads the description, the forecast at the meeting point, the elevation and your drive, then drafts what to bring."
          : "Nothing on the list yet. Add what the group should bring."),
        planButton);
    } else {
      body = h("div", { class: "stack" },
        h("div", { class: "progress-line" },
          h("div", { class: "meter big" }, h("span", { style: `width:${Math.round((covered / items.length) * 100)}%` })),
          h("span", { class: "small" }, `${covered} of ${items.length} sorted for you`)),
        shared.length ? h("div", {}, h("h4", { class: "group-title" }, "One for the group"), h("ul", { class: "items" }, shared.map(itemRow))) : null,
        personal.length ? h("div", {}, h("h4", { class: "group-title" }, "Everyone brings their own"), h("ul", { class: "items" }, personal.map(itemRow))) : null,
        planButton ? h("div", { class: "row" }, planButton) : null);
    }

    mount(listSlot,
      h("section", { class: "card" },
        h("div", { class: "section-head" }, h("h2", { class: "section-title" }, "Prep list"),
          detail.is_member ? null : h("span", { class: "muted small" }, "RSVP to help out")),
        body,
        addForm),
    );
  }

  function drawFind() {
    if (!detail.model_ready) {
      mount(findSlot);
      return;
    }
    const input = h("input", { type: "search", placeholder: "What do you need? Try “my feet get cold” or “snacks kids like”", maxlength: 200, "aria-label": "What do you need?" });
    const results = h("div", { class: "find-results" });
    const form = h("form", { class: "find-bar" }, h("span", { class: "find-icon", html: SPARKLE }), input, h("button", { type: "submit", class: "button primary" }, "Find"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      mount(results, h("div", { class: "thinking" }, h("div", { html: squatch("think", 70) }), h("p", {}, "Thinking about your trip…")));
      try {
        const found = await api.find(eventId, query);
        lastTrip = found.trip;
        drawTrip(found.trip, found.items.map((item) => item.name));
        mount(results,
          found.items.length
            ? h("ul", { class: "found" }, found.items.map((item) =>
                h("li", { class: "found-item" },
                  h("div", {},
                    h("strong", {}, item.name),
                    h("p", { class: "why" }, item.why),
                    h("div", { class: "tags" }, item.shop_tags.map((tag) => h("span", { class: "tag" }, tag.replace(/_/g, " "))))),
                  detail.is_member
                    ? busyButton("Add to list", async () => {
                        await api.addItem(eventId, item);
                        toast(`${item.name} added`, "success");
                        await refresh();
                      }, { class: "button small" })
                    : null)))
            : h("p", { class: "muted" }, "Nothing came up. Try other words."),
          found.trip.stores.length ? h("p", { class: "small muted" }, `${found.trip.stores.length} stores on the map sell these.`) : null);
      } catch (error) {
        mount(results, h("p", { class: "error-text" }, error.message));
      }
    });
    mount(findSlot, h("section", { class: "card find" }, form, results));
  }

  function drawPeople() {
    mount(peopleSlot,
      h("section", { class: "card" },
        h("h3", {}, `Going (${detail.attendees.length})`),
        detail.attendees.length
          ? h("ul", { class: "people" }, detail.attendees.map((person) =>
              h("li", {}, h("a", { href: `#/people/${person.user_id}`, class: "person" }, avatar(person.name, 36), h("span", {}, person.name)))))
          : h("p", { class: "muted" }, "Be the first."),
        detail.event.description ? h("div", { class: "prose" }, h("h3", {}, "About"), h("p", { class: "pre" }, detail.event.description)) : null,
        detail.can_manage
          ? busyButton("Delete event", async () => {
              if (!window.confirm("Delete this event for everyone?")) return;
              await api.deleteEvent(eventId);
              toast("Event deleted");
              go(`/tribes/${detail.event.tribe_id}`);
            }, { class: "button ghost danger small" })
          : null));
  }

  function drawTrip(trip, highlight = null) {
    if (tripLayer) tripLayer.remove();
    tripLayer = L.layerGroup().addTo(map);
    const points = [destination()];
    if (trip.route) {
      routeLine(tripLayer, trip.route.points);
      points.push(...trip.route.points);
    }
    if (detail.my_origin) points.push(detail.my_origin);
    trip.stores.forEach((stop, index) => {
      const marker = L.marker([stop.store.lat, stop.store.lng], { icon: pin("store", index + 1) }).addTo(tripLayer);
      marker.bindPopup(() => {
        const box = h("div", { class: "popup" },
          h("strong", {}, stop.store.name),
          h("p", { class: "small muted" }, `${stop.store.shop_tag.replace(/_/g, " ")} · ${minutes(stop.detour_minutes)}`),
          h("p", { class: "small" }, stop.covers.join(", ")));
        return box;
      });
      points.push({ lat: stop.store.lat, lng: stop.store.lng });
    });
    fitTo(map, points);

    const routeSummary = trip.route
      ? h("p", { class: "trip-summary" }, h("strong", {}, durationText(trip.route.duration_minutes)), ` · ${Math.round(trip.route.distance_km)} km drive`)
      : null;
    const heading = highlight ? `Stores for: ${highlight.join(", ")}` : "Stores on your way";
    mount(tripSlot,
      routeSummary,
      h("h4", { class: "group-title" }, heading),
      trip.stores.length
        ? h("ol", { class: "stops" }, trip.stores.map((stop, index) =>
            h("li", { class: "stop" },
              h("span", { class: "stop-number" }, String(index + 1)),
              h("div", { class: "stop-body" },
                h("div", { class: "stop-title" }, h("strong", {}, stop.store.name), h("span", { class: `detour${stop.detour_is_estimate ? " estimate" : ""}`, title: stop.detour_is_estimate ? "Estimated from distance" : "Routed driving time" }, minutes(stop.detour_minutes))),
                h("p", { class: "small muted" }, [stop.store.shop_tag.replace(/_/g, " "), stop.store.address].filter(Boolean).join(" · ")),
                h("div", { class: "tags" }, stop.covers.map((name) => h("span", { class: "chip" }, name))),
                stop.store.opening_hours ? h("p", { class: "small muted" }, `Hours: ${stop.store.opening_hours}`) : null,
                h("p", { class: "small links" },
                  h("a", { href: directionsUrl(detail.my_origin, { lat: stop.store.lat, lng: stop.store.lng }), target: "_blank", rel: "noopener" }, "Directions"),
                  h("a", { href: `https://www.openstreetmap.org/${stop.store.osm_ref}`, target: "_blank", rel: "noopener" }, "On the map"))))))
        : h("p", { class: "muted small" }, detail.items.length ? "No matching stores found nearby." : "Stores appear here once the list has items."),
      h("p", { class: "tiny muted" }, "Store data © OpenStreetMap contributors. Routing by OSRM."));
  }

  const loadTrip = debounce(async () => {
    if (!detail.items.length) {
      drawTrip({ route: null, stores: [] });
      return;
    }
    mount(tripSlot, h("p", { class: "muted small" }, h("span", { class: "spinner" }), " Looking along your route…"));
    try {
      lastTrip = await api.trip(eventId);
      drawTrip(lastTrip);
    } catch (error) {
      mount(tripSlot, h("p", { class: "error-text small" }, error.message));
    }
  }, 300);

  function drawOrigin() {
    if (originMarker) originMarker.remove();
    originMarker = null;
    if (detail.my_origin) {
      originMarker = L.marker([detail.my_origin.lat, detail.my_origin.lng], { icon: pin("start") }).addTo(map).bindTooltip("You start here");
    }
  }

  async function saveOrigin(point) {
    await api.setOrigin(eventId, point);
    detail.my_origin = point;
    drawOrigin();
    loadTrip();
  }

  const startSearch = h("input", { type: "search", placeholder: "Starting from… (address or town)", "aria-label": "Starting point" });
  const startSuggestions = h("ul", { class: "suggestions" });
  const searchStart = debounce(async (text) => {
    if (text.trim().length < 3) {
      mount(startSuggestions);
      return;
    }
    try {
      const places = await api.places(text, destination());
      mount(startSuggestions, places.map((place) =>
        h("li", {
          onclick: async () => {
            mount(startSuggestions);
            startSearch.value = place.name.split(",").slice(0, 2).join(",");
            await saveOrigin({ lat: place.lat, lng: place.lng });
          },
        }, place.name)));
    } catch (error) {
      mount(startSuggestions, h("li", { class: "muted" }, error.message));
    }
  }, 450);
  startSearch.addEventListener("input", () => searchStart(startSearch.value));

  const pickButton = h("button", { type: "button", class: "button small ghost" }, "Tap the map");
  pickButton.addEventListener("click", () => {
    pickingStart = !pickingStart;
    pickButton.classList.toggle("active", pickingStart);
    mapElement.classList.toggle("picking", pickingStart);
    if (pickingStart) toast("Tap where you'll set off from");
  });
  const locateButton = busyButton("Use my location", () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("This browser can't share location"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          await saveOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
          resolve();
        },
        () => reject(new Error("Location was not shared")),
        { timeout: 8000 },
      );
    }), { class: "button small ghost" });
  const clearButton = busyButton("Clear", async () => {
    await api.clearOrigin(eventId);
    detail.my_origin = null;
    drawOrigin();
    loadTrip();
  }, { class: "button small ghost" });

  drawHero();
  drawList();
  drawFind();
  drawPeople();

  mount(view,
    heroSlot,
    h("div", { class: "event-grid" },
      h("div", { class: "stack-lg" }, findSlot, listSlot, peopleSlot),
      h("aside", { class: "map-column" },
        h("section", { class: "card map-card" },
          h("div", { class: "section-head" }, h("h2", { class: "section-title" }, "Your way there")),
          h("div", { class: "start-controls" },
            h("div", { class: "place-field" }, startSearch, startSuggestions),
            h("div", { class: "row" }, locateButton, pickButton, clearButton)),
          h("p", { class: "tiny muted" }, "Your starting point is only used for your route and is deleted a day after the event."),
          mapElement,
          tripSlot),
      ),
    ),
  );

  map = createMap(mapElement, destination(), 12);
  L.marker([detail.event.lat, detail.event.lng], { icon: pin("meet") }).addTo(map).bindTooltip(detail.event.place_name);
  drawOrigin();
  map.on("click", async (event) => {
    if (!pickingStart) return;
    pickingStart = false;
    pickButton.classList.remove("active");
    mapElement.classList.remove("picking");
    try {
      await saveOrigin({ lat: event.latlng.lat, lng: event.latlng.lng });
    } catch (error) {
      toast(error.message, "error");
    }
  });
  loadTrip();
}
