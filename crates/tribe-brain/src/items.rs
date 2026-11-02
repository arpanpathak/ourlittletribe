//! The packing list: what a group should bring for a trip, and items that
//! answer one person's search, such as "something for mosquitoes".

use serde::{Deserialize, Serialize};
use serde_json::json;
use tribe_core::osm::{ShopTags, is_plain_tag};

use crate::client::{AnswerStyle, Brain, Question};
use crate::{BrainError, TripFacts, clip, prompt};

/// Most items kept from one answer.
const MAX_ITEMS: usize = 14;

/// Most items kept for one search.
const MAX_SEARCH_ITEMS: usize = 5;

/// How many of an item the group needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    /// One for each person going.
    Personal,
    /// One for the whole group.
    Shared,
}

/// One thing to bring, as the model suggested it, after checking.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlannedItem {
    /// What to bring.
    pub name: String,
    /// Which fact it answers to, with its number when there is one.
    pub why: String,
    /// One each, or one for the group.
    pub scope: Scope,
    /// How many for the whole group.
    pub quantity: i64,
    /// The kinds of shop that sell it.
    pub shop_tags: ShopTags,
}

#[derive(Deserialize)]
struct ItemsAnswer {
    items: Vec<PlannedItem>,
}

fn items_question(instructions: &'static str) -> Question {
    Question {
        instructions,
        schema_name: "prep_list",
        max_tokens: 1800,
        style: AnswerStyle::Varied,
        schema: json!({
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "why": { "type": "string" },
                            "scope": { "type": "string", "enum": ["personal", "shared"] },
                            "quantity": { "type": "integer" },
                            "shop_tags": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
                        },
                        "required": ["name", "why", "scope", "quantity", "shop_tags"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["items"],
            "additionalProperties": false
        }),
    }
}

/// The shop tags that are plain lower-case OpenStreetMap values, each once,
/// without the meaningless "shop".
fn clean_tags(raw_tags: Vec<String>) -> ShopTags {
    let mut tags = ShopTags::new();
    for raw in raw_tags {
        let tag = raw.trim().to_lowercase();
        if is_plain_tag(&tag) && tag != "shop" && !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    tags
}

/// Checks and tidies the model's items: trims text, bounds quantities, drops
/// bad tags, drops items with no name or a name already listed, and keeps at
/// most [`MAX_ITEMS`].
pub fn clean_items(raw_items: Vec<PlannedItem>, already_listed: &[String]) -> Vec<PlannedItem> {
    let mut seen: Vec<String> = already_listed
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let mut cleaned = Vec::new();

    for raw in raw_items {
        let name = clip(&raw.name, 80);
        let lowered = name.to_lowercase();
        if name.is_empty() || seen.contains(&lowered) {
            continue;
        }
        seen.push(lowered);

        cleaned.push(PlannedItem {
            name,
            why: clip(&raw.why, 200),
            scope: raw.scope,
            quantity: raw.quantity.clamp(1, 500),
            shop_tags: clean_tags(raw.shop_tags),
        });
        if cleaned.len() == MAX_ITEMS {
            break;
        }
    }

    cleaned
}

impl Brain {
    /// What this group should bring, given the facts of the trip.
    pub async fn plan_items(&self, facts: &TripFacts) -> Result<Vec<PlannedItem>, BrainError> {
        let answer: ItemsAnswer = self
            .ask(items_question(prompt::PLAN_SYSTEM), facts.describe())
            .await?;
        Ok(clean_items(answer.items, &facts.already_listed))
    }

    /// Items that answer one person's search for this trip.
    pub async fn items_for_search(
        &self,
        search: &str,
        facts: &TripFacts,
    ) -> Result<Vec<PlannedItem>, BrainError> {
        let question = format!(
            "{}\nSearch from one attendee: {}\nReturn up to {MAX_SEARCH_ITEMS} items that answer the search for this trip.",
            facts.describe(),
            clip(search, 200)
        );

        let answer: ItemsAnswer = self
            .ask(items_question(prompt::SEARCH_SYSTEM), question)
            .await?;
        let mut items = clean_items(answer.items, &[]);
        items.truncate(MAX_SEARCH_ITEMS);
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(name: &str, scope: Scope, quantity: i64, tags: &[&str]) -> PlannedItem {
        PlannedItem {
            name: name.to_string(),
            why: "because".to_string(),
            scope,
            quantity,
            shop_tags: tags.iter().map(|tag| tag.to_string()).collect(),
        }
    }

    #[test]
    fn cleaning_drops_repeats_and_bad_tags_and_bounds_quantity() {
        let items = vec![
            raw(
                "Microspikes",
                Scope::Personal,
                8,
                &["shop", "outdoor", "Sports ", "x\"]);"],
            ),
            raw("microspikes", Scope::Personal, 8, &["outdoor"]),
            raw("Water", Scope::Personal, 9_999, &["supermarket"]),
            raw("", Scope::Shared, 1, &[]),
            raw("First-aid kit", Scope::Shared, 0, &["chemist"]),
        ];

        let cleaned = clean_items(items, &["water".to_string()]);

        let names: Vec<&str> = cleaned.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, vec!["Microspikes", "First-aid kit"]);
        assert_eq!(
            cleaned[0].shop_tags,
            vec!["outdoor".to_string(), "sports".to_string()]
        );
        assert_eq!(cleaned[1].quantity, 1);
    }

    #[test]
    fn cleaning_keeps_at_most_the_limit() {
        let items: Vec<PlannedItem> = (0..30)
            .map(|number| raw(&format!("Item {number}"), Scope::Shared, 1, &[]))
            .collect();
        assert_eq!(clean_items(items, &[]).len(), MAX_ITEMS);
    }
}
