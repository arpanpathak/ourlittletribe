//! Cover pictures. The model reads what a tribe or event is about and chooses
//! a scene: the land, the light, the weather, the season, what people are doing
//! and how many of them. The page draws that scene in the app's own style, so
//! a cover costs one short answer instead of an image model.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::client::{Brain, Question};
use crate::{BrainError, clip, prompt};

/// The land in the picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Landscape {
    /// Snowy peaks behind forest.
    Mountains,
    /// Rolling green hills.
    Hills,
    /// Deep woods.
    Forest,
    /// A lake with hills around it.
    Lake,
    /// A shore with the sea behind.
    Coast,
    /// Dunes and mesas.
    Desert,
    /// A park with a skyline behind.
    City,
    /// Open grass and flowers.
    Meadow,
}

/// The time of day, which sets the sky's colours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Light {
    /// Pink and pale gold, sun low on the left.
    Dawn,
    /// Blue sky, sun high.
    Day,
    /// Warm orange, sun low on the right.
    GoldenHour,
    /// Purple and rose after sunset.
    Dusk,
    /// Stars and the moon.
    Night,
}

/// What the sky is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Weather {
    /// No clouds.
    Clear,
    /// A few drifting clouds.
    Clouds,
    /// Low mist between the hills.
    Mist,
    /// Rain falling.
    Rain,
    /// Snow falling, and snow on the ground.
    Snow,
}

/// The season, which colours the trees and grass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Season {
    /// Fresh green, blossom.
    Spring,
    /// Deep green.
    Summer,
    /// Orange and gold.
    Autumn,
    /// Bare and white.
    Winter,
}

/// What the people in the picture are doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Activity {
    /// Walking a trail with packs.
    Hiking,
    /// Running.
    Running,
    /// Riding bikes.
    Cycling,
    /// Sitting on a blanket with a basket.
    Picnic,
    /// A tent and a campfire.
    Camping,
    /// In a canoe on the water.
    Paddling,
    /// On skis.
    Skiing,
    /// Standing together, waving.
    Gathering,
}

/// The scene for a cover, as the model chose it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverDesign {
    /// The land.
    pub landscape: Landscape,
    /// The time of day.
    pub light: Light,
    /// The sky.
    pub weather: Weather,
    /// The season.
    pub season: Season,
    /// What people are doing.
    pub activity: Activity,
    /// How many people, 1 to 4.
    pub crew: u8,
}

/// What a cover is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverFor {
    /// A tribe: a group that meets again and again.
    Tribe,
    /// One event.
    Event,
}

/// What the model reads before choosing a scene.
#[derive(Debug, Clone)]
pub struct CoverSubject<'a> {
    /// A tribe or an event.
    pub kind: CoverFor,
    /// Its name or title.
    pub title: &'a str,
    /// What it says about itself.
    pub description: &'a str,
    /// Where it happens or meets, when known.
    pub place: Option<&'a str>,
    /// When it happens, such as "Saturday 7 November 2026", when known.
    pub when: Option<&'a str>,
}

/// Fewest and most people in a scene.
const CREW_RANGE: std::ops::RangeInclusive<u8> = 1..=4;

fn cover_question() -> Question {
    Question {
        instructions: prompt::COVER_SYSTEM,
        schema_name: "cover_design",
        max_tokens: 200,
        schema: json!({
            "type": "object",
            "properties": {
                "landscape": { "type": "string", "enum": ["mountains", "hills", "forest", "lake", "coast", "desert", "city", "meadow"] },
                "light": { "type": "string", "enum": ["dawn", "day", "golden_hour", "dusk", "night"] },
                "weather": { "type": "string", "enum": ["clear", "clouds", "mist", "rain", "snow"] },
                "season": { "type": "string", "enum": ["spring", "summer", "autumn", "winter"] },
                "activity": { "type": "string", "enum": ["hiking", "running", "cycling", "picnic", "camping", "paddling", "skiing", "gathering"] },
                "crew": { "type": "integer", "minimum": 1, "maximum": 4 }
            },
            "required": ["landscape", "light", "weather", "season", "activity", "crew"],
            "additionalProperties": false
        }),
    }
}

fn describe(subject: &CoverSubject) -> String {
    let kind = match subject.kind {
        CoverFor::Tribe => "A tribe: a group that gets together again and again.",
        CoverFor::Event => "One event.",
    };

    let mut lines = vec![
        kind.to_string(),
        format!("Name: {}", clip(subject.title, 120)),
    ];
    if let Some(place) = subject.place {
        lines.push(format!("Where: {}", clip(place, 160)));
    }
    if let Some(when) = subject.when {
        lines.push(format!("When: {}", clip(when, 60)));
    }

    match subject.description.trim() {
        "" => lines.push("No description.".to_string()),
        text => lines.push(format!(
            "Description:\n\"\"\"\n{}\n\"\"\"",
            clip(text, 2000)
        )),
    }
    lines.join("\n")
}

impl Brain {
    /// Chooses a cover scene for a tribe or an event.
    pub async fn design_cover(
        &self,
        subject: &CoverSubject<'_>,
    ) -> Result<CoverDesign, BrainError> {
        let design: CoverDesign = self.ask(cover_question(), describe(subject)).await?;
        let crew = design.crew.clamp(*CREW_RANGE.start(), *CREW_RANGE.end());
        Ok(CoverDesign { crew, ..design })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_design_reads_from_the_models_json() {
        let answer = r#"{"landscape":"lake","light":"golden_hour","weather":"mist","season":"autumn","activity":"paddling","crew":2}"#;
        let design: CoverDesign = serde_json::from_str(answer).unwrap();

        assert_eq!(design.landscape, Landscape::Lake);
        assert_eq!(design.light, Light::GoldenHour);
        assert_eq!(design.activity, Activity::Paddling);
    }

    #[test]
    fn the_description_names_what_is_known() {
        let subject = CoverSubject {
            kind: CoverFor::Event,
            title: "Lake Twenty-Two at first light",
            description: "",
            place: Some("Granite Falls, Washington"),
            when: None,
        };
        let text = describe(&subject);

        assert!(text.contains("Where: Granite Falls"));
        assert!(text.contains("No description."));
        assert!(!text.contains("When:"));
    }
}
