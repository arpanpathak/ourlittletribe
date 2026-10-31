//! "Bought together" pairs learned from what groups marked as bought.
//!
//! Each finished prep list is one basket. For an item A and another item B:
//!
//! - *support* is the share of baskets that hold both;
//! - *confidence* is the share of baskets with A that also hold B;
//! - *lift* is confidence divided by B's share of all baskets; above 1 means
//!   B shows up with A more often than chance.
//!
//! A pair is reported only when there is enough evidence (see
//! [`EvidenceThreshold`]); with too few baskets the app shows the
//! hand-written suggestions and says so, instead of claiming a pattern.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

/// How much evidence a pair needs before it is shown.
#[derive(Debug, Clone, Copy)]
pub struct EvidenceThreshold {
    /// Fewer baskets than this in total and nothing is reported.
    pub min_baskets: usize,
    /// A pair must appear together in at least this many baskets.
    pub min_together: usize,
    /// A pair must have at least this lift.
    pub min_lift: f64,
}

impl Default for EvidenceThreshold {
    fn default() -> EvidenceThreshold {
        EvidenceThreshold {
            min_baskets: 10,
            min_together: 3,
            min_lift: 1.1,
        }
    }
}

/// An item often bought alongside the one asked about.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pairing {
    /// The other item, normalised to lower case.
    pub item: String,
    /// Baskets that held both items.
    pub together: usize,
    /// Share of baskets with the asked item that also held this one.
    pub confidence: f64,
    /// Confidence divided by this item's overall share of baskets.
    pub lift: f64,
}

/// Lower-cases and trims an item name so "Trail Mix " and "trail mix" match.
pub fn normalize_item(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Items bought with `item`, strongest first, or empty when the evidence is too thin.
pub fn bought_with(baskets: &[Vec<String>], item: &str, threshold: EvidenceThreshold) -> Vec<Pairing> {
    if baskets.len() < threshold.min_baskets {
        return Vec::new();
    }
    let wanted = normalize_item(item);
    let mut baskets_with_item: BTreeMap<String, usize> = BTreeMap::new();
    let mut together_with_wanted: BTreeMap<String, usize> = BTreeMap::new();
    let mut baskets_with_wanted = 0usize;

    for basket in baskets {
        let distinct: BTreeSet<String> = basket.iter().map(|name| normalize_item(name)).collect();
        let holds_wanted = distinct.contains(&wanted);
        if holds_wanted {
            baskets_with_wanted += 1;
        }
        for name in distinct {
            *baskets_with_item.entry(name.clone()).or_default() += 1;
            if holds_wanted && name != wanted {
                *together_with_wanted.entry(name).or_default() += 1;
            }
        }
    }

    if baskets_with_wanted == 0 {
        return Vec::new();
    }

    let basket_total = baskets.len() as f64;
    let mut pairings = Vec::new();
    for (other, together) in together_with_wanted {
        if together < threshold.min_together {
            continue;
        }
        let other_share = baskets_with_item.get(&other).copied().unwrap_or(0) as f64 / basket_total;
        let confidence = together as f64 / baskets_with_wanted as f64;
        let lift = match other_share > 0.0 {
            true => confidence / other_share,
            false => 0.0,
        };
        if lift >= threshold.min_lift {
            pairings.push(Pairing {
                item: other,
                together,
                confidence,
                lift,
            });
        }
    }
    pairings.sort_by(|left, right| right.lift.total_cmp(&left.lift).then(right.together.cmp(&left.together)));
    pairings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basket(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    fn hiking_history() -> Vec<Vec<String>> {
        let mut baskets = Vec::new();
        for _ in 0..6 {
            baskets.push(basket(&["Trail mix", "Electrolyte drink", "Water"]));
        }
        for _ in 0..6 {
            baskets.push(basket(&["Water", "Cookies"]));
        }
        baskets
    }

    #[test]
    fn too_few_baskets_reports_nothing() {
        let baskets = vec![basket(&["trail mix", "water"]); 3];
        assert!(bought_with(&baskets, "trail mix", EvidenceThreshold::default()).is_empty());
    }

    #[test]
    fn strong_pair_is_found_and_case_is_ignored() {
        let pairings = bought_with(&hiking_history(), "TRAIL MIX", EvidenceThreshold::default());
        let Some(first) = pairings.first() else {
            panic!("no pairing found");
        };
        assert_eq!(first.item, "electrolyte drink");
        assert_eq!(first.together, 6);
        assert!((first.confidence - 1.0).abs() < 1e-9);
        assert!((first.lift - 2.0).abs() < 1e-9);
    }

    #[test]
    fn item_in_every_basket_has_no_lift_and_is_dropped() {
        let pairings = bought_with(&hiking_history(), "trail mix", EvidenceThreshold::default());
        assert!(pairings.iter().all(|pairing| pairing.item != "water"));
    }

    #[test]
    fn unknown_item_reports_nothing() {
        assert!(bought_with(&hiking_history(), "kayak", EvidenceThreshold::default()).is_empty());
    }
}
