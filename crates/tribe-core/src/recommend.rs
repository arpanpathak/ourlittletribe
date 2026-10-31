//! Ranking stores along a trip by how many still-needed items they sell and
//! how far out of the way they are.
//!
//! Which shops sell an item is not decided here: the model tags each item
//! with OpenStreetMap `shop=*` values, and a store matches an item when its
//! own `shop` value is among them.

use serde::Serialize;

use crate::geo::{LatLng, estimated_detour_minutes};

/// A store that might be worth a stop.
#[derive(Debug, Clone)]
pub struct StoreCandidate {
    /// Database id of the store.
    pub store_id: String,
    /// The store's OpenStreetMap `shop` value, such as `supermarket`.
    pub shop_tag: String,
    /// Where it is.
    pub location: LatLng,
    /// Extra minutes from a routing service, when one answered for this store.
    pub routed_detour_minutes: Option<f64>,
}

/// Something the group still needs, with the shops the model says sell it.
#[derive(Debug, Clone)]
pub struct NeededItem {
    /// The item's name, as written on the list.
    pub name: String,
    /// OpenStreetMap `shop` values of stores that sell it.
    pub shop_tags: Vec<String>,
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

/// A store worth suggesting, with the reasons.
#[derive(Debug, Clone, Serialize)]
pub struct StoreSuggestion {
    /// Database id of the store.
    pub store_id: String,
    /// Extra minutes of driving to stop here.
    pub detour_minutes: f64,
    /// `true` when the detour is a straight-line estimate, not a routed time.
    pub detour_is_estimate: bool,
    /// Names of needed items this store sells.
    pub covers: Vec<String>,
    /// The ranking score; higher is better.
    pub score: f64,
}

/// Ranks `stores` for a trip along `route`, best first.
///
/// Stores that sell nothing on the list, or are further out of the way than
/// the rules allow, are left out.
pub fn rank_stores(
    stores: &[StoreCandidate],
    needed: &[NeededItem],
    route: &[LatLng],
    rules: RankingRules,
) -> Vec<StoreSuggestion> {
    let mut suggestions = Vec::new();
    for store in stores {
        let (detour_minutes, detour_is_estimate) = match store.routed_detour_minutes {
            Some(routed) => (routed.max(0.0), false),
            None => (estimated_detour_minutes(store.location, route), true),
        };
        if detour_minutes > rules.max_detour_minutes {
            continue;
        }

        let mut covers = Vec::new();
        for item in needed {
            if item.shop_tags.iter().any(|tag| tag == &store.shop_tag) {
                covers.push(item.name.clone());
            }
        }
        if covers.is_empty() {
            continue;
        }

        let score = covers.len() as f64 * rules.points_per_covered_item
            - detour_minutes * rules.penalty_per_detour_minute;

        suggestions.push(StoreSuggestion {
            store_id: store.store_id.clone(),
            detour_minutes,
            detour_is_estimate,
            covers,
            score,
        });
    }
    suggestions.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then(left.detour_minutes.total_cmp(&right.detour_minutes))
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

    fn store(store_id: &str, shop_tag: &str, lat: f64, lng: f64) -> StoreCandidate {
        StoreCandidate {
            store_id: store_id.to_string(),
            shop_tag: shop_tag.to_string(),
            location: LatLng { lat, lng },
            routed_detour_minutes: None,
        }
    }

    fn needed() -> Vec<NeededItem> {
        vec![
            NeededItem {
                name: "Water".to_string(),
                shop_tags: vec!["supermarket".to_string(), "convenience".to_string()],
            },
            NeededItem {
                name: "Bananas".to_string(),
                shop_tags: vec!["supermarket".to_string(), "greengrocer".to_string()],
            },
            NeededItem {
                name: "Microspikes".to_string(),
                shop_tags: vec!["outdoor".to_string()],
            },
        ]
    }

    #[test]
    fn store_covering_more_items_ranks_first() {
        let stores = vec![
            store("corner", "convenience", 47.2, -122.0),
            store("market", "supermarket", 47.2, -122.0),
            store("bakery", "bakery", 47.2, -122.0),
        ];
        let ranked = rank_stores(&stores, &needed(), &route(), RankingRules::default());
        let ids: Vec<&str> = ranked
            .iter()
            .map(|suggestion| suggestion.store_id.as_str())
            .collect();
        assert_eq!(ids, vec!["market", "corner"]);
    }

    #[test]
    fn far_store_is_left_out() {
        let stores = vec![store("far", "supermarket", 47.2, -120.5)];
        assert!(rank_stores(&stores, &needed(), &route(), RankingRules::default()).is_empty());
    }

    #[test]
    fn closer_store_wins_a_tie_on_coverage() {
        let stores = vec![
            store("off_route", "outdoor", 47.25, -122.0),
            store("on_route", "outdoor", 47.2, -122.0),
        ];
        let ranked = rank_stores(&stores, &needed(), &route(), RankingRules::default());
        let Some(first) = ranked.first() else {
            panic!("nothing ranked");
        };
        assert_eq!(first.store_id, "on_route");
    }

    #[test]
    fn routed_detour_is_preferred_over_estimate() {
        let mut routed = store("routed", "supermarket", 47.2, -120.5);
        routed.routed_detour_minutes = Some(4.0);
        let ranked = rank_stores(&[routed], &needed(), &route(), RankingRules::default());
        let Some(first) = ranked.first() else {
            panic!("routed store dropped");
        };
        assert!(!first.detour_is_estimate);
        assert!((first.detour_minutes - 4.0).abs() < 1e-9);
    }
}
