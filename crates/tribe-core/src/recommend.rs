//! Ranking stores along a trip by how many still-needed items they sell and
//! how far out of the way they are.
//!
//! Which shops sell an item is not decided here: the model tags each item
//! with OpenStreetMap `shop=*` values, and a store matches an item when its
//! own `shop` value is among them.

use serde::Serialize;

use crate::geo::{LatLng, estimated_detour_minutes};
use crate::osm::ShopTags;

/// A store that might be worth a stop. `Id` is however the caller names stores.
#[derive(Debug, Clone)]
pub struct StoreCandidate<Id> {
    /// The store's id.
    pub store_id: Id,
    /// The store's OpenStreetMap `shop` value, such as `supermarket`.
    pub shop_tag: String,
    /// Where it is.
    pub location: LatLng,
    /// Extra minutes from a routing service, when one answered for this store.
    pub routed_detour_minutes: Option<f64>,
}

/// Something the group still needs, with the kinds of shop that sell it.
#[derive(Debug, Clone)]
pub struct NeededItem {
    /// The item's name, as written on the list.
    pub name: String,
    /// The kinds of shop that sell it.
    pub shop_tags: ShopTags,
}

/// Limits and weights for ranking.
#[derive(Debug, Clone, Copy)]
pub struct RankingRules {
    /// Stores further out of the way than this are left out.
    pub max_detour_minutes: f64,
    /// Points for each needed item the store sells.
    pub points_per_covered_item: f64,
    /// Points taken off per minute of detour.
    pub penalty_per_detour_minute: f64,
}

impl Default for RankingRules {
    fn default() -> RankingRules {
        RankingRules {
            max_detour_minutes: 15.0,
            points_per_covered_item: 10.0,
            penalty_per_detour_minute: 1.5,
        }
    }
}

/// How far out of the way a store is, and how that was found out.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Detour {
    /// Driving minutes from a routing service.
    Routed {
        /// Extra minutes of driving.
        minutes: f64,
    },
    /// A straight-line estimate, when no route was available.
    Estimated {
        /// Extra minutes of driving, estimated.
        minutes: f64,
    },
}

impl Detour {
    /// The extra minutes, however they were found.
    pub fn minutes(self) -> f64 {
        match self {
            Detour::Routed { minutes } | Detour::Estimated { minutes } => minutes,
        }
    }
}

/// A store worth suggesting, with the reasons.
#[derive(Debug, Clone, Serialize)]
pub struct StoreSuggestion<Id> {
    /// The store's id.
    pub store_id: Id,
    /// How far out of the way it is.
    pub detour: Detour,
    /// Names of needed items it sells.
    pub covers: Vec<String>,
    /// The ranking score; higher is better.
    pub score: f64,
}

fn detour_of<Id>(store: &StoreCandidate<Id>, route: &[LatLng]) -> Detour {
    match store.routed_detour_minutes {
        Some(routed) => Detour::Routed {
            minutes: routed.max(0.0),
        },
        None => Detour::Estimated {
            minutes: estimated_detour_minutes(store.location, route),
        },
    }
}

/// The needed items a store sells.
fn covered_items<Id>(store: &StoreCandidate<Id>, needed: &[NeededItem]) -> Vec<String> {
    needed
        .iter()
        .filter(|item| item.shop_tags.contains(&store.shop_tag))
        .map(|item| item.name.clone())
        .collect()
}

/// Ranks `stores` for a trip along `route`, best first. Stores that sell
/// nothing on the list, or are further out of the way than the rules allow,
/// are left out.
pub fn rank_stores<Id: Clone>(
    stores: &[StoreCandidate<Id>],
    needed: &[NeededItem],
    route: &[LatLng],
    rules: RankingRules,
) -> Vec<StoreSuggestion<Id>> {
    let mut suggestions = Vec::new();

    for store in stores {
        let detour = detour_of(store, route);
        if detour.minutes() > rules.max_detour_minutes {
            continue;
        }

        let covers = covered_items(store, needed);
        if covers.is_empty() {
            continue;
        }

        let score = covers.len() as f64 * rules.points_per_covered_item
            - detour.minutes() * rules.penalty_per_detour_minute;
        suggestions.push(StoreSuggestion {
            store_id: store.store_id.clone(),
            detour,
            covers,
            score,
        });
    }

    suggestions.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then(left.detour.minutes().total_cmp(&right.detour.minutes()))
    });
    suggestions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route() -> Vec<LatLng> {
        vec![
            LatLng {
                lat: 47.6,
                lng: -122.3,
            },
            LatLng {
                lat: 46.8,
                lng: -121.7,
            },
        ]
    }

    fn store(
        store_id: &'static str,
        shop_tag: &str,
        lat: f64,
        lng: f64,
    ) -> StoreCandidate<&'static str> {
        StoreCandidate {
            store_id,
            shop_tag: shop_tag.to_string(),
            location: LatLng { lat, lng },
            routed_detour_minutes: None,
        }
    }

    fn needed() -> Vec<NeededItem> {
        let item = |name: &str, tags: &[&str]| NeededItem {
            name: name.to_string(),
            shop_tags: tags.iter().map(|tag| tag.to_string()).collect(),
        };
        vec![
            item("Water", &["supermarket", "convenience"]),
            item("Bananas", &["supermarket", "greengrocer"]),
            item("Microspikes", &["outdoor"]),
        ]
    }

    fn ranked_ids(stores: &[StoreCandidate<&'static str>]) -> Vec<&'static str> {
        rank_stores(stores, &needed(), &route(), RankingRules::default())
            .into_iter()
            .map(|suggestion| suggestion.store_id)
            .collect()
    }

    #[test]
    fn a_store_covering_more_items_ranks_first() {
        let stores = [
            store("corner", "convenience", 47.2, -122.0),
            store("market", "supermarket", 47.2, -122.0),
            store("bakery", "bakery", 47.2, -122.0),
        ];
        assert_eq!(ranked_ids(&stores), vec!["market", "corner"]);
    }

    #[test]
    fn a_far_store_is_left_out() {
        assert!(ranked_ids(&[store("far", "supermarket", 47.2, -120.5)]).is_empty());
    }

    #[test]
    fn the_closer_store_wins_a_tie_on_coverage() {
        let stores = [
            store("off_route", "outdoor", 47.25, -122.0),
            store("on_route", "outdoor", 47.2, -122.0),
        ];
        assert_eq!(ranked_ids(&stores).first(), Some(&"on_route"));
    }

    #[test]
    fn a_routed_detour_is_preferred_over_an_estimate() {
        let mut routed = store("routed", "supermarket", 47.2, -120.5);
        routed.routed_detour_minutes = Some(4.0);

        let ranked = rank_stores(&[routed], &needed(), &route(), RankingRules::default());

        let Some(first) = ranked.first() else {
            panic!("routed store dropped");
        };
        assert_eq!(first.detour, Detour::Routed { minutes: 4.0 });
    }
}
