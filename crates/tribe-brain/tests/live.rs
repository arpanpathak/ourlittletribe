//! Asks a real model server. Run on the Thor with
//! `OLT_LLM_URL=http://127.0.0.1:8081/v1 cargo test -p tribe-brain -- --ignored --nocapture`.

use std::time::{Duration, Instant};

use tribe_brain::{Brain, BrainConfig, BrainError, DriveFacts, TripFacts, WeatherFacts};

fn brain() -> Result<Brain, BrainError> {
    let base_url =
        std::env::var("OLT_LLM_URL").unwrap_or_else(|_| "http://127.0.0.1:8081/v1".to_string());
    Brain::new(BrainConfig {
        base_url,
        model: None,
        api_key: None,
        timeout: Duration::from_secs(120),
    })
}

fn snowy_hike() -> TripFacts {
    TripFacts {
        title: "Skyline Trail loop".to_string(),
        description: "5.5 mile loop, 1700 ft gain. Lunch at Panorama Point, bring the pup! We'll stay for sunset photos.".to_string(),
        place_name: "Paradise, Mount Rainier National Park".to_string(),
        starts_local: "Saturday 2026-11-07 13:00".to_string(),
        group_size: 8,
        elevation_m: Some(1658.0),
        weather: Some(WeatherFacts {
            max_temp_c: 3.0,
            min_temp_c: -4.0,
            precipitation_chance: 60.0,
            precipitation_mm: 4.0,
            snowfall_cm: 3.0,
            max_wind_kmh: 25.0,
            max_uv_index: 2.0,
            sunrise_local: "07:01".to_string(),
            sunset_local: "16:52".to_string(),
        }),
        drive: Some(DriveFacts { minutes: 150.0, km: 167.0 }),
        already_listed: Vec::new(),
        learned_pairings: Vec::new(),
        ..TripFacts::default()
    }
}

#[tokio::test]
#[ignore]
async fn plans_a_snowy_hike() -> Result<(), BrainError> {
    let brain = brain()?;
    let started = Instant::now();
    let items = brain.plan_items(&snowy_hike()).await?;
    println!(
        "{} items in {:.1} s",
        items.len(),
        started.elapsed().as_secs_f64()
    );
    for item in &items {
        println!(
            "- {} [{} x{}] {:?}: {}",
            item.name, item.scope, item.quantity, item.shop_tags, item.why
        );
    }
    assert!(items.len() >= 4);
    Ok(())
}

#[tokio::test]
#[ignore]
async fn answers_a_search() -> Result<(), BrainError> {
    let brain = brain()?;
    let items = brain
        .items_for_search("my feet get cold", &snowy_hike())
        .await?;
    for item in &items {
        println!(
            "- {} [{} x{}] {:?}: {}",
            item.name, item.scope, item.quantity, item.shop_tags, item.why
        );
    }
    assert!(!items.is_empty());
    Ok(())
}
