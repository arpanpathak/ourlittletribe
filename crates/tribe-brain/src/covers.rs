//! Cover pictures, drawn by the model. First it writes a rich description of
//! a scene for the tribe or event, which the person can read and change.
//! Then it draws that description as one SVG document. Nothing is drawn
//! from a template: every shape comes from the model.

use serde::Deserialize;
use serde_json::json;

use crate::client::{AnswerStyle, Brain, Listening, Question};
use crate::{BrainError, clip, prompt};

/// What a cover is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverFor {
    /// A tribe: a group that meets again and again.
    Tribe,
    /// One event.
    Event,
}

/// What the model reads before describing a cover.
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

/// Longest scene description kept, in characters.
const LONGEST_SCENE: usize = 2500;

/// Most tokens a drawing may take. The Thor writes about 75 tokens a second,
/// so this is at most about 90 seconds. A drawing cut off here is still
/// used: the server closes whatever the model left open.
const DRAWING_TOKENS: u32 = 7000;

/// How freely the model draws: some variety, so a second drawing differs.
const DRAWING_TEMPERATURE: f64 = 0.7;

#[derive(Deserialize)]
struct SceneAnswer {
    scene: String,
}

fn scene_question() -> Question {
    Question {
        instructions: prompt::COVER_SCENE_SYSTEM,
        schema_name: "cover_scene",
        max_tokens: 900,
        style: AnswerStyle::Varied,
        schema: json!({
            "type": "object",
            "properties": { "scene": { "type": "string" } },
            "required": ["scene"],
            "additionalProperties": false
        }),
    }
}

/// What the model reads about the subject, as lines.
fn subject_lines(subject: &CoverSubject) -> String {
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
            clip(text, 3000)
        )),
    }
    lines.join("\n")
}

/// The SVG document in the model's answer, from `<svg` to the last `</svg>`,
/// or to the end when the model ran out of room; `None` when there is none.
fn svg_in(answer: &str) -> Option<String> {
    let start = answer.find("<svg")?;
    let end = match answer.rfind("</svg>") {
        Some(close) if close > start => close + "</svg>".len(),
        _ => answer.len(),
    };

    Some(answer[start..end].to_string())
}

impl Brain {
    /// A rich description of a cover scene for a tribe or event: the place,
    /// the light, the season, the people and what they are doing, and the
    /// style, for the person to read, change, and then have drawn.
    pub async fn describe_cover(&self, subject: &CoverSubject<'_>) -> Result<String, BrainError> {
        let answer: SceneAnswer = self.ask(scene_question(), subject_lines(subject)).await?;

        Ok(clip(answer.scene.trim(), LONGEST_SCENE))
    }

    /// Draws `scene` as one SVG document, 1600 by 900. `on_piece` sees the
    /// drawing as it is written and can stop it. The SVG may be unfinished
    /// when the model ran out of room; the server closes and cleans it before
    /// anyone sees it, and this only finds it in the answer.
    pub async fn draw_cover(
        &self,
        scene: &str,
        on_piece: &mut (dyn FnMut(&str) -> Listening + Send),
    ) -> Result<String, BrainError> {
        let request = format!(
            "Draw this scene:\n\"\"\"\n{}\n\"\"\"",
            clip(scene, LONGEST_SCENE)
        );
        let answer = self
            .write(
                prompt::COVER_DRAW_SYSTEM,
                request,
                DRAWING_TOKENS,
                DRAWING_TEMPERATURE,
                on_piece,
            )
            .await?;

        svg_in(&answer).ok_or(BrainError::EmptyAnswer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_svg_is_cut_out_of_the_answer() {
        let answer = "Here it is:\n```svg\n<svg viewBox=\"0 0 10 10\"><rect/></svg>\n```";

        assert_eq!(
            svg_in(answer).as_deref(),
            Some("<svg viewBox=\"0 0 10 10\"><rect/></svg>")
        );
        assert_eq!(svg_in("no drawing"), None);
        assert_eq!(
            svg_in("<svg><rect/><circ").as_deref(),
            Some("<svg><rect/><circ")
        );
    }

    #[test]
    fn the_subject_names_what_is_known() {
        let subject = CoverSubject {
            kind: CoverFor::Event,
            title: "Rattlesnake Ledge at sunrise",
            description: "",
            place: Some("Rattlesnake Lake, North Bend"),
            when: None,
        };
        let text = subject_lines(&subject);

        assert!(text.contains("Where: Rattlesnake Lake"));
        assert!(text.contains("No description."));
        assert!(!text.contains("When:"));
    }
}
