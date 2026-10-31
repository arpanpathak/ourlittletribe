//! The conditions briefing: what the forecast, the elevation and the daylight
//! mean for this group's plan, in the reader's units.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::client::{Brain, Question};
use crate::{BrainError, TripFacts, clip, prompt};

/// Points a briefing keeps at most.
const MAX_POINTS: usize = 4;

/// How a reader writes numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Units {
    /// °F, mph, miles and feet, and 12-hour times; temperatures also in °C.
    Imperial,
    /// °C, km/h, kilometres and metres, and 24-hour times; temperatures also in °F.
    Metric,
}

impl Units {
    fn instruction(self) -> &'static str {
        match self {
            Units::Imperial => {
                "The reader is American: temperatures as °F with °C in brackets, such as 43°F (6°C); \
                 wind in mph; distances in miles and feet; times like 1:15 PM."
            }
            Units::Metric => {
                "Temperatures as °C with °F in brackets, such as 6°C (43°F); wind in km/h; \
                 distances in km and m; times on the 24-hour clock."
            }
        }
    }
}

/// How good the day is for this plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Everything favours it.
    Great,
    /// Fine, with small things to watch.
    Good,
    /// Some hours or some things are against it.
    Mixed,
    /// Hard going; worth rethinking.
    Poor,
}

/// What a point of the briefing is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointKind {
    /// When to go, and when weather or dark arrives.
    Timing,
    /// What to wear or carry.
    Wear,
    /// Something that could hurt someone.
    Safety,
    /// Something that makes the day nicer or worse.
    Comfort,
    /// The drive.
    Road,
}

/// One thing the group should know.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BriefingPoint {
    /// What it is about.
    pub kind: PointKind,
    /// The sentence.
    pub text: String,
}

/// What the model says about the conditions for an event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Briefing {
    /// How good the day is for this plan.
    pub verdict: Verdict,
    /// One sentence on the day, such as "Dry and clear until 2 PM, then showers move in".
    pub headline: String,
    /// What it means, a sentence each, at most four.
    pub points: Vec<BriefingPoint>,
}

fn briefing_question() -> Question {
    Question {
        instructions: prompt::BRIEFING_SYSTEM,
        schema_name: "briefing",
        max_tokens: 500,
        schema: json!({
            "type": "object",
            "properties": {
                "verdict": { "type": "string", "enum": ["great", "good", "mixed", "poor"] },
                "headline": { "type": "string" },
                "points": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "enum": ["timing", "wear", "safety", "comfort", "road"] },
                            "text": { "type": "string" }
                        },
                        "required": ["kind", "text"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["verdict", "headline", "points"],
            "additionalProperties": false
        }),
    }
}

/// The briefing with its text trimmed, empty points dropped, and at most four kept.
fn tidy(briefing: Briefing) -> Briefing {
    let points = briefing
        .points
        .into_iter()
        .filter(|point| !point.text.trim().is_empty())
        .take(MAX_POINTS)
        .map(|point| BriefingPoint {
            kind: point.kind,
            text: clip(&point.text, 300),
        })
        .collect();

    Briefing {
        verdict: briefing.verdict,
        headline: clip(&briefing.headline, 160),
        points,
    }
}

impl Brain {
    /// A short briefing on what the conditions mean for this trip, written in `units`.
    pub async fn write_briefing(
        &self,
        facts: &TripFacts,
        units: Units,
    ) -> Result<Briefing, BrainError> {
        let question = format!("{}\n{}", facts.describe(), units.instruction());
        let answer: Briefing = self.ask(briefing_question(), question).await?;
        Ok(tidy(answer))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_answer_outside_the_enums_is_refused() {
        let wrong = r#"{"verdict":"splendid","headline":"x","points":[]}"#;
        assert!(serde_json::from_str::<Briefing>(wrong).is_err());
    }

    #[test]
    fn tidying_drops_empty_points_and_keeps_four() {
        let point = |text: &str| BriefingPoint {
            kind: PointKind::Timing,
            text: text.to_string(),
        };
        let briefing = Briefing {
            verdict: Verdict::Good,
            headline: "  Clear morning  ".to_string(),
            points: vec![
                point("a"),
                point(" "),
                point("b"),
                point("c"),
                point("d"),
                point("e"),
            ],
        };

        let tidied = tidy(briefing);

        assert_eq!(tidied.headline, "Clear morning");
        let texts: Vec<&str> = tidied
            .points
            .iter()
            .map(|point| point.text.as_str())
            .collect();
        assert_eq!(texts, vec!["a", "b", "c", "d"]);
    }
}
