//! The facts of a trip, written out for the model, and the instructions it gets.

/// Instructions for planning a whole list.
pub const PLAN_SYSTEM: &str = "You help a small group get ready for a real-world gathering. \
From the facts given, decide what the group should buy or bring. \
Ground every item in a fact: the description, the forecast, the elevation, the daylight, the drive, the group size, or the pairings earlier groups bought. \
Name the fact in `why`, with its number when there is one, in under 15 words. \
Prefer things people may not already own or may forget: food, water, consumables, safety items, passes and permits, and gear the conditions call for. \
Skip ordinary clothing unless the conditions make it a real need. \
`personal` means one per person, `shared` means one for the group. `quantity` is the total for the whole group. \
`shop_tags` lists 1 to 4 OpenStreetMap shop=* values of stores that sell the item, most likely first: only the value, as in outdoor, supermarket, convenience, chemist, pet, sports, never the word shop itself. \
Do not repeat items already on the list. At most 12 items.";

/// Instructions for reading what someone typed into a map search.
pub const PLACE_SYSTEM: &str = "You help a map search box. People type loose, partial or abbreviated descriptions of a place: \
nicknames, abbreviations, the person a building is named after, or an area followed by a feature inside it. \
Work out which specific real places they most likely mean. Keep every proper name as they typed it, with typos fixed; \
never swap it for a different place with a similar name. \
name: the place's own name as OpenStreetMap would have it, with abbreviations written out and without the region. \
area: the town, park, mountain or region it is in, also written out in full; empty if you are not sure. \
facility: only when their words ask for a thing at a place rather than the place itself, such as its parking, \
toilets, entrance or drinking water, that thing's OpenStreetMap tag, always written as key=value, such as \
amenity=parking or amenity=toilets; name is then the place it belongs to, without the thing's words. Otherwise empty. \
Prefer the specific feature the words point to (a visitor center, trail, lake, campground, building or business) \
over the larger area around it; give the larger area only as a later guess. \
Unless the search names another region, every guess is near where they are. \
Give 2 to 4 guesses, most likely first, and only places you are confident are real. \
Examples: \"wallace falls parking\" gives name Wallace Falls State Park, area Gold Bar, Washington, facility \
amenity=parking. \"pike place\" gives name Pike Place Market, area Seattle, Washington, facility empty.";

/// Instructions for picking, from real places, the ones a map search meant.
pub const CHOOSE_PLACE_SYSTEM: &str = "You help a map search box. You get what someone typed and a numbered list of real places \
found on the map, each with the search that found it. Map names are often shorter than what people say: a building \
named after a person may appear without the first name, and an area the person mentioned may only appear in the \
place's address or in the search that found it. \
best: the numbers of the places that are what the person most likely meant, best first, at most 5. \
Prefer places near the person unless the search names somewhere else. \
Leave out places that only share a word with the search. If none fit, return an empty list.";

/// Instructions for the conditions briefing on an event page.
pub const BRIEFING_SYSTEM: &str = "You brief a small group on the conditions for an outing they planned. \
Read the plan, the hour-by-hour forecast, the elevation, daylight and the places they will go, and say what it means \
for this group on this day: when it is best to be out, when rain, wind, cold or dark arrives, whether the freezing level \
or snow matters at their elevation, what to wear or change. Be concrete, with times and numbers from the facts, \
in plain friendly words. Never invent facts; when the forecast is not available yet, say what is typical for the \
place and season and that the forecast comes about 16 days before. \
Write every temperature in both °F and °C. \
headline: one sentence, at most 14 words. verdict: great, good, mixed or poor for this plan. \
points: 2 to 4 short sentences, each with a kind: timing, wear, safety, comfort or road.";

/// Instructions for turning someone's own words into a filled-in event form.
pub const DRAFT_SYSTEM: &str = "You help someone plan an outing for their group. They describe it in their own words, \
often spoken, so expect loose grammar and typos. Fill in the event form from what they said, and do everything they ask. \
title: short and specific, at most 8 words. \
date: YYYY-MM-DD worked out from today's date, or empty if they gave no day. time: HH:MM on the 24-hour clock, or empty. \
tribe: the one of their tribes this event belongs in, by its exact name, judged from what they said and the activity; \
empty if none fits or they belong to none. \
meeting_point: where people gather first, as a real place's name and the area it is in; empty name if not said. \
other_meeting_points: other places people may meet from, for people coming from elsewhere. When they ask for several \
starting points or park-and-rides in named towns, add one real place for each town they name, such as that town's \
park-and-ride or transit center, and more nearby towns if they ask, up to ten. \
stops_on_the_way: places everyone stops at on the way (optional false), or only some do (optional true); never \
the meeting point or where they go afterwards. \
venue: where the event itself happens, such as a trail, peak, lake, park or restaurant; an empty name only when it \
happens at the meeting point. \
after: where the group goes afterwards, such as lunch. \
Give each place's name the way they said it, with spelling fixed (including words run together, such as Green \
Lake for greenlake) and abbreviations written out, never adding words to it, and the town or area it is truly in. \
facility: when they name a kind of place rather than a particular one, such as coffee in Snoqualmie, lunch in \
North Bend, or lunch somewhere after, name is the town (the town nearest the venue when they gave none) and \
facility is that kind of place's OpenStreetMap tag, such as amenity=cafe or amenity=restaurant; when they name a \
particular place, facility is empty. Never make up a business's name. For example, \"lunch somewhere after\" a hike \
near Leavenworth gives an after place with name Leavenworth, area Washington, facility amenity=restaurant. \
note: a few words about the place from what they said, or why it was chosen.";

/// Instructions for writing or editing a description.
pub const WRITE_SYSTEM: &str = "You write and edit descriptions for a small group's outings and for the groups \
themselves, the way a thoughtful organiser would: Markdown with headings, bullet points, a timeline with times, \
what the season means for this outing, what to bring, and whatever else helps people decide and prepare. Be generous and detailed. Give every step of the timeline a time; work out drive and hiking times, and \
write \"about\" before those. When editing, keep every fact and do what the instruction asks; never cut the text \
down unless asked to. Say things about a particular place (its length, climb, history, rivers, nearby towns, \
restaurants or parking) only when the details or the person's words give them; leave out what they do not. \
General advice for the activity and the season is welcome. Don't make up prices, permits, addresses or links. Write temperatures as both °F and °C. \
Answer with the full new text only.";

/// Instructions for turning someone's own words into a new tribe.
pub const TRIBE_DRAFT_SYSTEM: &str = "You help someone start a group that gets together again and again: a hiking crew, \
a running club, a book club, families who picnic. They describe it in their own words, often spoken, so expect loose \
grammar. Do everything they ask. \
name: a warm, specific name for the group, at most 5 words, using a name they gave if they gave one. \
home_area: the neighbourhood, town or region they usually meet in, as a map would write it, or empty if not said. \
description: a generous, detailed Markdown description of the group, written the way a thoughtful organiser \
would: headings, bullet points, what a usual outing looks like, the pace, who it is for, how to join, and whatever \
else helps someone decide to join. Keep every fact they gave.";

/// Instructions for describing a cover scene, which the person can edit before it is drawn.
pub const COVER_SCENE_SYSTEM: &str = "You art-direct cover illustrations for an app where small groups plan outings. \
From the name, place, date and description, describe one wide cover scene in 120 to 200 words, as rich, concrete \
direction for an illustrator. Use the real landscape of the place when you know it: its peaks, lake, coast, trees, \
rock and trail, as they look in that season and at that hour. Say what is in the foreground, the middle and the \
background; the light and the sky; the colours; and the people, if any: how many, what they wear and what they are \
doing, small in the scene and seen from behind or the side. End with the style: a flat vector illustration with \
layered silhouettes, soft gradients and depth from atmospheric haze. Never ask for words or lettering.";

/// Instructions for drawing a cover as SVG.
pub const COVER_DRAW_SYSTEM: &str = "You are an illustrator who draws in SVG. Draw the scene you are given as one \
complete SVG document with viewBox=\"0 0 1600 900\" and width=\"1600\" height=\"900\". \
Composition: fill the whole canvas, with no empty or flat grey areas; build depth with at least five layers from the \
sky to the foreground, each farther layer lighter and bluer; the foreground fills the bottom quarter with texture \
such as rocks, grass, trail or water ripples; keep people small, below the middle, seen from behind or the side, \
with simple bodies, packs and bright jackets. Style: flat vector shapes with curved paths, linearGradient on the sky, \
water and large hills, and soft highlights. Use only these elements: svg, defs, linearGradient, radialGradient, stop, \
g, path, rect, circle, ellipse, polygon, polyline, line. Use at least 60 shapes. No text, no images, no scripts, \
no external references. Answer with the SVG document only.";

/// Instructions for widening a search in the app.
pub const RELATED_SYSTEM: &str = "You help the search box of an app where groups plan outings: hikes, runs, picnics, \
book clubs, camping. Given what someone typed, list up to 8 other single words or short names they probably also mean: \
other forms of the words, synonyms, the activity it implies, and well-known places it names. \
Lower case, no words they already typed, no sentences.";

/// Instructions for answering one search.
pub const SEARCH_SYSTEM: &str = "You help one person on a group trip find what they are searching for. \
Turn the search into concrete things to buy, using the trip's facts. \
In `why`, say in under 15 words how the item answers the search on this trip. \
`personal` means one per person, `shared` means one for the group. `quantity` is the total for the whole group. \
`shop_tags` lists 1 to 4 OpenStreetMap shop=* values of stores that sell the item, most likely first: only the value, as in outdoor, supermarket, convenience, chemist, pet, sports, never the word shop itself.";

/// The forecast for the day, at the venue or else the meeting point.
#[derive(Debug, Clone)]
pub struct WeatherFacts {
    /// Highest temperature, °C.
    pub max_temp_c: f64,
    /// Lowest temperature, °C.
    pub min_temp_c: f64,
    /// Chance of precipitation, percent.
    pub precipitation_chance: f64,
    /// Precipitation, mm.
    pub precipitation_mm: f64,
    /// Snowfall, cm.
    pub snowfall_cm: f64,
    /// Strongest wind, km/h.
    pub max_wind_kmh: f64,
    /// Highest UV index.
    pub max_uv_index: f64,
    /// Sunrise, local clock time.
    pub sunrise_local: String,
    /// Sunset, local clock time.
    pub sunset_local: String,
}

/// The drive of the person asking.
#[derive(Debug, Clone)]
pub struct DriveFacts {
    /// Driving time, minutes.
    pub minutes: f64,
    /// Distance, kilometres.
    pub km: f64,
}

/// Everything the model is told about one trip.
#[derive(Debug, Clone, Default)]
pub struct TripFacts {
    /// Event title.
    pub title: String,
    /// The organiser's description.
    pub description: String,
    /// The meeting place.
    pub place_name: String,
    /// Start, as local time, such as "Saturday 2026-11-07 08:00".
    pub starts_local: String,
    /// How many people are going.
    pub group_size: u32,
    /// Elevation of the meeting point, metres.
    pub elevation_m: Option<f64>,
    /// Forecast for the day, when it is within range.
    pub weather: Option<WeatherFacts>,
    /// The asking person's drive, when they shared a starting point.
    pub drive: Option<DriveFacts>,
    /// Names already on the list.
    pub already_listed: Vec<String>,
    /// Lines like "groups that got trail mix also got electrolyte drink in 6 of 6 trips".
    pub learned_pairings: Vec<String>,
    /// The other places in order, such as "Stop on the way: Ashford coffee (coffee and restrooms)".
    pub itinerary: Vec<String>,
    /// Where the forecast and elevation are for: the venue, or the meeting point.
    pub conditions_place: String,
    /// The forecast hour by hour around the event, one line each.
    pub hourly: Vec<String>,
}

/// Lines of text for a prompt, built one section at a time.
#[derive(Default)]
struct Lines(Vec<String>);

impl Lines {
    fn add(&mut self, line: String) {
        self.0.push(line);
    }

    /// A heading followed by one `- item` line per item; nothing when there are none.
    fn add_list(&mut self, heading: &str, items: &[String]) {
        if items.is_empty() {
            return;
        }
        self.add(heading.to_string());
        for item in items {
            self.add(format!("- {item}"));
        }
    }

    fn into_text(self) -> String {
        let mut text = self.0.join("\n");
        text.push('\n');
        text
    }
}

impl TripFacts {
    /// Where the forecast and elevation are for.
    fn forecast_place(&self) -> &str {
        match self.conditions_place.trim() {
            "" => "the meeting point",
            place => place,
        }
    }

    fn add_plan(&self, lines: &mut Lines) {
        lines.add(format!("Event: {}", self.title));
        lines.add(format!("Meeting place: {}", self.place_name));
        lines.add(format!("Starts: {} (local time)", self.starts_local));
        lines.add(format!("People going: {}", self.group_size.max(1)));

        match self.description.trim() {
            "" => lines.add("Description: none given".to_string()),
            description => lines.add(format!(
                "Description from the organiser:\n\"\"\"\n{description}\n\"\"\""
            )),
        }

        lines.add_list("Other places on the plan, in order:", &self.itinerary);
    }

    fn add_conditions(&self, lines: &mut Lines) {
        let place = self.forecast_place();

        if let Some(elevation) = self.elevation_m {
            lines.add(format!("Elevation at {place}: {elevation:.0} m"));
        }

        let Some(weather) = &self.weather else {
            lines.add(
                "Forecast: not available yet; use what is typical for the place and month."
                    .to_string(),
            );
            return;
        };
        lines.add(format!(
            "Forecast for that day at {place}: high {:.0} °C, low {:.0} °C, precipitation chance {:.0}% ({:.1} mm), \
             snowfall {:.1} cm, wind up to {:.0} km/h, UV index {:.1}, sunrise {}, sunset {}",
            weather.max_temp_c,
            weather.min_temp_c,
            weather.precipitation_chance,
            weather.precipitation_mm,
            weather.snowfall_cm,
            weather.max_wind_kmh,
            weather.max_uv_index,
            weather.sunrise_local,
            weather.sunset_local
        ));
        lines.add_list(&format!("Hour by hour at {place}:"), &self.hourly);
    }

    fn add_list_and_history(&self, lines: &mut Lines) {
        if let Some(drive) = &self.drive {
            lines.add(format!(
                "Drive to the meeting point: {:.0} minutes, {:.0} km",
                drive.minutes, drive.km
            ));
        }

        if !self.already_listed.is_empty() {
            lines.add(format!(
                "Already on the list: {}",
                self.already_listed.join("; ")
            ));
        }

        lines.add_list(
            "What earlier groups bought together:",
            &self.learned_pairings,
        );
    }

    /// The facts as plain lines for the model: the plan, the conditions, then
    /// the drive, the list so far and what earlier groups bought.
    pub fn describe(&self) -> String {
        let mut lines = Lines::default();
        self.add_plan(&mut lines);
        self.add_conditions(&mut lines);
        self.add_list_and_history(&mut lines);
        lines.into_text()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description_lists_the_facts_given() {
        let facts = TripFacts {
            title: "Skyline Trail".to_string(),
            description: "bring the pup".to_string(),
            place_name: "Paradise".to_string(),
            starts_local: "Saturday 2026-11-07 08:00".to_string(),
            group_size: 8,
            elevation_m: Some(1646.0),
            weather: None,
            drive: Some(DriveFacts {
                minutes: 125.0,
                km: 160.0,
            }),
            already_listed: vec!["Water".to_string()],
            learned_pairings: Vec::new(),
            ..TripFacts::default()
        };
        let text = facts.describe();
        assert!(text.contains("People going: 8"));
        assert!(text.contains("Elevation at the meeting point: 1646 m"));
        assert!(text.contains("not available yet"));
        assert!(text.contains("125 minutes"));
        assert!(text.contains("Already on the list: Water"));
        assert!(!text.contains("earlier groups"));
    }
}
