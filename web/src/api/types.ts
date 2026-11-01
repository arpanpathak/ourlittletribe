// The JSON the server sends and accepts, one interface per Rust type.
// Times are Unix seconds; ids are UUID strings.

/** A point on the map, in degrees. */
export interface LatLng {
  /** Latitude, -90 to 90. */
  lat: number;
  /** Longitude, -180 to 180. */
  lng: number;
}

/** A point on the map with the name people know it by. */
export interface Place extends LatLng {
  /** What people call it, such as "Issaquah Park and Ride". */
  name: string;
}

/** A person with an account. */
export interface User {
  /** Account id. */
  id: string;
  /** Sign-in email; only present on your own account. */
  email?: string;
  /** Display name. */
  name: string;
  /** A short self-description. */
  bio: string;
  /** A neighbourhood or town. */
  home_area: string;
  /** Whether the account may manage every tribe and event. */
  is_admin: boolean;
  /** When the account was made. */
  created_at: number;
  /** The profile picture's id. */
  avatar: string | null;
  /** The profile banner's id. */
  cover_image: string | null;
}

/** What a person may do in a tribe. */
export type Role = "organizer" | "member";

/** A tribe as one viewer sees it. */
export interface Tribe {
  /** Tribe id. */
  id: string;
  /** Who started it. */
  creator_id: string | null;
  /** Name. */
  name: string;
  /** What it is about, in Markdown. */
  description: string;
  /** Where it usually meets. */
  home_area: string;
  /** When it was started. */
  created_at: number;
  /** How many people belong. */
  member_count: number;
  /** Whether the viewer belongs. */
  is_member: boolean;
  /** Whether the viewer is one of its organizers. */
  is_organizer: boolean;
  /** The cover picture's id. */
  cover_image: string | null;
}

/** One member of a tribe. */
export interface Member {
  /** Their account. */
  user_id: string;
  /** Display name. */
  name: string;
  /** Their profile picture's id. */
  avatar: string | null;
  /** What they may do in the tribe. */
  role: Role;
  /** When they joined. */
  joined_at: number;
}

/** A person's answer to an event. */
export type Rsvp = "going" | "not_going";

/** A thumbs up or down. */
export type Vote = "up" | "down";

/** An event as one viewer sees it. */
export interface Event {
  /** Event id. */
  id: string;
  /** The tribe it belongs to. */
  tribe_id: string;
  /** That tribe's name. */
  tribe_name: string;
  /** Who planned it. */
  creator_id: string | null;
  /** Title. */
  title: string;
  /** What the plan is, in Markdown. */
  description: string;
  /** Where everyone gathers first. */
  meeting_point: Place;
  /** Start time. */
  starts_at: number;
  /** The meeting place's offset from UTC, minutes. */
  tz_offset_minutes: number;
  /** When it was planned. */
  created_at: number;
  /** How many people said they are going. */
  going_count: number;
  /** Up-votes minus down-votes. */
  net_votes: number;
  /** The viewer's answer. */
  my_rsvp: Rsvp | null;
  /** The viewer's vote. */
  my_vote: Vote | null;
  /** The cover picture's id. */
  cover_image: string | null;
}

/** Someone who said they are going. */
export interface Attendee {
  /** Their account. */
  user_id: string;
  /** Display name. */
  name: string;
  /** Their profile picture's id. */
  avatar: string | null;
}

/** What a place on an event's plan is for, besides the meeting point. */
export type StopKind = "stop" | "optional" | "venue";

/** A stop to save. */
export interface NewStop extends Place {
  /** What it is for. */
  kind: StopKind;
  /** A line from the planner, such as "Coffee and restrooms, 15 min". */
  note: string;
}

/** A saved stop. */
export interface Stop extends NewStop {
  /** Stop id. */
  id: string;
}

/** How many of an item the group needs. */
export type Scope = "personal" | "shared";

/** One person's progress on an item. */
export type MarkState = "bringing" | "got";

/** One person's mark on an item. */
export interface ItemMark {
  /** Their account. */
  user_id: string;
  /** Display name. */
  name: string;
  /** Their profile picture's id. */
  avatar: string | null;
  /** Whether they are bringing it or have it. */
  state: MarkState;
}

/** An item that earlier groups bought alongside another. */
export interface Pairing {
  /** The other item, in lower case. */
  item: string;
  /** How many trips had both. */
  together: number;
  /** Share of trips with the first item that also had this one. */
  confidence: number;
  /** How much more often than chance they go together. */
  lift: number;
}

/** An item on an event's packing list. */
export interface PrepItem {
  /** Item id. */
  id: string;
  /** What to bring. */
  name: string;
  /** Why it is on the list. */
  why: string;
  /** One each, or one for the group. */
  scope: Scope;
  /** How many for the whole group. */
  quantity: number;
  /** The kinds of shop that sell it, such as "outdoor". */
  shop_tags: string[];
  /** Who put it on the list. */
  source: "model" | "person";
  /** The person who added it, when a person did. */
  user_id?: string | null;
  /** Everyone's marks, oldest first. */
  marks: ItemMark[];
  /** What groups bought with it, once there is enough evidence. */
  often_with?: Pairing[];
}

/** What the sky is doing in an hour. */
export type Sky =
  | "clear" | "mainly_clear" | "partly_cloudy" | "overcast" | "fog" | "drizzle"
  | "rain" | "snow" | "rain_showers" | "snow_showers" | "thunderstorm" | "unknown";

/** One hour of the forecast. */
export interface HourForecast {
  /** Start of the hour. */
  time: number;
  /** Air temperature, °C. */
  temp_c: number;
  /** How cold it feels, °C. */
  feels_like_c: number;
  /** Chance of precipitation, percent. */
  precipitation_chance: number;
  /** Precipitation, mm. */
  precipitation_mm: number;
  /** Snowfall, cm. */
  snowfall_cm: number;
  /** What the sky is doing. */
  sky: Sky;
  /** Cloud cover, percent. */
  cloud_cover: number;
  /** Wind, km/h. */
  wind_kmh: number;
  /** Gusts, km/h. */
  gusts_kmh: number;
  /** Height above sea level where it freezes, metres. */
  freezing_level_m: number | null;
}

/** The forecast for the day of an event. */
export interface DayForecast {
  /** Highest temperature, °C. */
  max_temp_c: number;
  /** Lowest temperature, °C. */
  min_temp_c: number;
  /** Highest chance of precipitation in any hour, percent. */
  precipitation_chance: number;
  /** Total precipitation, mm. */
  precipitation_mm: number;
  /** Total snowfall, cm. */
  snowfall_cm: number;
  /** Strongest wind, km/h. */
  max_wind_kmh: number;
  /** Highest UV index. */
  max_uv_index: number;
  /** Sunrise. */
  sunrise: number;
  /** Sunset. */
  sunset: number;
  /** Hour by hour, from an hour before the start. */
  hours: HourForecast[];
}

/** The forecast and elevation where an event happens. */
export interface Conditions {
  /** The place they are for: the venue, or the meeting point. */
  place_name: string;
  /** Ground elevation, metres. */
  elevation_m: number | null;
  /** The forecast, once the event is within 16 days. */
  forecast: DayForecast | null;
}

/** A photo shared from an event. */
export interface Photo {
  /** Picture id. */
  id: string;
  /** Who shared it. */
  uploader_id: string | null;
  /** Their name. */
  uploader_name: string;
  /** Their profile picture's id. */
  uploader_avatar: string | null;
  /** A line about it. */
  caption: string;
  /** Width of the large copy, pixels. */
  width: number;
  /** Height of the large copy, pixels. */
  height: number;
  /** When it was shared. */
  created_at: number;
}

/** Everything the event page shows. */
export interface EventDetail {
  /** The event. */
  event: Event;
  /** Its other places, in order. */
  stops: Stop[];
  /** Everyone going. */
  attendees: Attendee[];
  /** The packing list. */
  items: PrepItem[];
  /** Forecast and elevation where it happens. */
  conditions: Conditions;
  /** Shared photos, newest first. */
  photos: Photo[];
  /** Where you said you start from. */
  my_origin: LatLng | null;
  /** Whether you belong to its tribe. */
  is_member: boolean;
  /** Whether you may change it. */
  can_manage: boolean;
  /** Whether the model is set up. */
  model_ready: boolean;
}

/** A driving route. */
export interface Route {
  /** The route's shape, start to end. */
  points: LatLng[];
  /** Driving time, minutes. */
  duration_minutes: number;
  /** Length, kilometres. */
  distance_km: number;
}

/** How far out of the way a store is, and how that was found out. */
export interface Detour {
  /** From a routing service, or a straight-line estimate. */
  kind: "routed" | "estimated";
  /** Extra minutes of driving. */
  minutes: number;
}

/** A shop remembered from OpenStreetMap. */
export interface Store extends LatLng {
  /** Database id. */
  id: string;
  /** `node/123` or `way/456`. */
  osm_ref: string;
  /** Name. */
  name: string;
  /** The OpenStreetMap `shop` value, such as "supermarket". */
  shop_tag: string;
  /** Street address. */
  address: string;
  /** Opening hours in OpenStreetMap's format. */
  opening_hours: string;
}

/** A store worth a stop, and why. */
export interface StoreStop {
  /** The store. */
  store: Store;
  /** How far out of the way it is. */
  detour: Detour;
  /** The needed items it sells. */
  covers: string[];
}

/** A person's way to an event and the stores on it. */
export interface TripView {
  /** The driving route, when there is one. */
  route: Route | null;
  /** Stores worth a stop, best first. */
  stores: StoreStop[];
  /** Set when only remembered stores could be shown. */
  notice: string | null;
}

/** An item the model suggests, not yet on the list. */
export interface PlannedItem {
  /** What to bring. */
  name: string;
  /** Which fact it answers to. */
  why: string;
  /** One each, or one for the group. */
  scope: Scope;
  /** How many for the group. */
  quantity: number;
  /** The kinds of shop that sell it. */
  shop_tags: string[];
}

/** Items that answer a search, and stores on the way that sell them. */
export interface Suggestions {
  /** The items. */
  items: PlannedItem[];
  /** Stores for them. */
  trip: TripView;
}

/** What a planning run added. */
export interface PlanResult {
  /** How many items were new. */
  added: number;
  /** The whole list after it. */
  items: PrepItem[];
}

/** How good the day is for the plan. */
export type Verdict = "great" | "good" | "mixed" | "poor";

/** What a briefing point is about. */
export type PointKind = "timing" | "wear" | "safety" | "comfort" | "road";

/** The model's briefing on the conditions. */
export interface Briefing {
  /** How good the day is. */
  verdict: Verdict;
  /** One sentence on the day. */
  headline: string;
  /** What it means, a sentence each. */
  points: Array<{
    /** What it is about. */
    kind: PointKind;
    /** The sentence. */
    text: string;
  }>;
}

/** One line of the feed. */
export interface ActivityEntry {
  /** Entry id. */
  id: string;
  /** Who did it. */
  user_id: string;
  /** Their name. */
  user_name: string;
  /** Their profile picture's id. */
  user_avatar: string | null;
  /** What they did, such as "joined_tribe". */
  action: string;
  /** The tribe or event it was about. */
  about: {
    /** Which kind of thing. */
    type: "tribe" | "event";
    /** Its id. */
    id: string;
  };
  /** A sentence describing it. */
  summary: string;
  /** When it happened. */
  created_at: number;
}

/** The home page's data. */
export interface Feed {
  /** The next events, soonest first. */
  upcoming: Event[];
  /** The tribes you belong to. */
  my_tribes: Tribe[];
  /** What people did lately. */
  activity: ActivityEntry[];
}

/** What a text search found. */
export interface SearchResults {
  /** Matching tribes. */
  tribes: Tribe[];
  /** Matching upcoming events. */
  events: Event[];
  /** Matching people. */
  people: User[];
}

/** A place found by a map search. */
export interface PlaceMatch extends Place {
  /** Where it is, such as "Ashford, Washington, United States". */
  detail: string;
  /** What kind of place, such as "hotel" or "peak". */
  kind: string;
}

/** A person's profile page. */
export interface ProfilePage {
  /** The person; their email only when it is you. */
  person: User;
  /** Their tribes. */
  tribes: Tribe[];
  /** Events they are going to. */
  events: Event[];
}

/** A tribe page. */
export interface TribeDetail {
  /** The tribe. */
  tribe: Tribe;
  /** Its members, organizers first. */
  members: Member[];
  /** Events still to come. */
  events: Event[];
  /** The latest events that are over. */
  past_events: Event[];
}

/** A place in a drafted event: what the model named, and the real place found for it. */
export interface DraftPlace {
  /** The name and area the model gave. */
  query: string;
  /** The real place, when the map has one. */
  place: PlaceMatch | null;
}

/** Another place in a drafted event. */
export interface DraftStop extends DraftPlace {
  /** What it is for. */
  kind: StopKind;
  /** A few words about it. */
  note: string;
}

/** An event form filled in by the model. */
export interface EventDraft {
  /** Title. */
  title: string;
  /** A Markdown description. */
  description: string;
  /** `YYYY-MM-DD`, when a day was said. */
  date: string | null;
  /** `HH:MM`, when a time was said. */
  time: string | null;
  /** Where everyone meets, when it was said. */
  meeting_point: DraftPlace | null;
  /** Other places, in order. */
  stops: DraftStop[];
}

/** A picture uploaded to place in a description. */
export interface InlinePicture {
  /** Its id. */
  id: string;
  /** Width, pixels. */
  width: number;
  /** Height, pixels. */
  height: number;
}

/** What an event says, when planning or changing it. */
export interface EventFields {
  /** Title. */
  title: string;
  /** Markdown description. */
  description: string;
  /** Where everyone gathers first. */
  meeting_point: Place;
  /** Start time. */
  starts_at: number;
  /** The planner's offset from UTC, minutes. */
  tz_offset_minutes: number;
  /** The other places, in order. */
  stops: NewStop[];
}

/** What a tribe says. */
export interface TribeFields {
  /** Name. */
  name: string;
  /** Markdown description. */
  description: string;
  /** Where it usually meets. */
  home_area: string;
}

/** What a person writes about themselves. */
export interface ProfileFields {
  /** Display name. */
  name: string;
  /** A short self-description. */
  bio: string;
  /** A neighbourhood or town. */
  home_area: string;
}

/** Which units a reader uses. */
export type Units = "imperial" | "metric";

/** What to ask the model when writing a description. */
export interface DescriptionDraftRequest {
  /** Lines about the event or tribe, such as "Title: Skyline loop". */
  details: string[];
  /** The text so far. */
  current: string;
  /** What to do, such as "make it shorter". */
  instruction: string;
}

/** A new tribe's form filled in by the model. */
export interface TribeDraft {
  /** Name. */
  name: string;
  /** Where it usually meets; empty when not said. */
  home_area: string;
  /** A Markdown description. */
  description: string;
}

/** The land in a cover picture. */
export type Landscape = "mountains" | "hills" | "forest" | "lake" | "coast" | "desert" | "city" | "meadow";

/** The time of day in a cover picture. */
export type Light = "dawn" | "day" | "golden_hour" | "dusk" | "night";

/** The sky in a cover picture. */
export type Weather = "clear" | "clouds" | "mist" | "rain" | "snow";

/** The season in a cover picture. */
export type Season = "spring" | "summer" | "autumn" | "winter";

/** What the people in a cover picture are doing. */
export type Activity = "hiking" | "running" | "cycling" | "picnic" | "camping" | "paddling" | "skiing" | "gathering";

/** A cover scene the model chose. */
export interface CoverDesign {
  /** The land. */
  landscape: Landscape;
  /** The time of day. */
  light: Light;
  /** The sky. */
  weather: Weather;
  /** The season. */
  season: Season;
  /** What people are doing. */
  activity: Activity;
  /** How many people, 1 to 4. */
  crew: number;
}

/** What the model reads before choosing a cover. */
export interface CoverRequest {
  /** A tribe's cover or an event's. */
  subject: "tribe" | "event";
  /** Its name or title. */
  title: string;
  /** Its description so far. */
  description: string;
  /** Where it happens or meets. */
  place: string;
  /** When it happens, in words. */
  when: string;
}

/** How hard a trail is, from OpenStreetMap's grades. */
export type Difficulty = "easy" | "moderate" | "hard" | "alpine";

/** How much a trail goes up and down, metres. */
export interface Climb {
  /** Total height gained along the profile. */
  gain_m: number;
  /** Total height lost along the profile. */
  loss_m: number;
  /** Its lowest point. */
  lowest_m: number;
  /** Its highest point. */
  highest_m: number;
}

/** A trail near where an event happens. */
export interface Trail {
  /** `relation/123` or `way/456` on OpenStreetMap. */
  osm_ref: string;
  /** Its name. */
  name: string;
  /** How hard it is, when the map says. */
  difficulty: Difficulty | null;
  /** Whether it is a marked hiking route. */
  is_route: boolean;
  /** Its length, km. */
  length_km: number;
  /** Its climb, when the elevation lookup worked. */
  climb: Climb | null;
  /** Heights along it, metres, in order. */
  profile: number[];
  /** Its line, in pieces. */
  segments: LatLng[][];
  /** How far its nearest point is from where the event happens, km. */
  distance_km: number;
}
