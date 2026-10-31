//! Calls the real services. Run with `cargo test -p tribe-places -- --ignored`.

use tribe_core::geo::LatLng;
use tribe_places::{Endpoints, Places, PlacesError};

fn places() -> Result<Places, PlacesError> {
    Places::new("OurLittleTribe-tests/0.1 (https://voltforge.tech)", Endpoints::default())
}

const SEATTLE: LatLng = LatLng { lat: 47.6062, lng: -122.3321 };
const PARADISE: LatLng = LatLng { lat: 46.7865, lng: -121.7353 };

#[tokio::test]
#[ignore]
async fn route_seattle_to_paradise() -> Result<(), PlacesError> {
    let route = places()?.route(SEATTLE, PARADISE).await?;
    println!("{:.0} min, {:.0} km, {} points", route.duration_minutes, route.distance_km, route.points.len());
    assert!(route.duration_minutes > 90.0);
    Ok(())
}

#[tokio::test]
#[ignore]
async fn stores_and_detours_along_the_route() -> Result<(), PlacesError> {
    let places = places()?;
    let route = places.route(SEATTLE, PARADISE).await?;
    let tags = vec!["supermarket".to_string(), "outdoor".to_string()];
    let stores = places.stores_along(&route.points, 1500, &tags).await?;
    println!("{} stores", stores.len());
    assert!(!stores.is_empty());
    let first_few: Vec<LatLng> = stores.iter().take(5).map(|store| store.location).collect();
    let detours = places.detour_minutes(SEATTLE, PARADISE, route.duration_minutes, &first_few).await?;
    for (store, detour) in stores.iter().zip(&detours) {
        println!("{} ({}): {:?} min", store.name, store.shop_tag, detour);
    }
    Ok(())
}

#[tokio::test]
#[ignore]
async fn forecast_elevation_and_search() -> Result<(), PlacesError> {
    let places = places()?;
    let elevation = places.elevation_m(PARADISE).await?;
    println!("elevation {elevation:?}");
    let tomorrow = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64 + 86_400)
        .unwrap_or(0);
    let forecast = places.day_forecast(PARADISE, tomorrow).await?;
    println!("{forecast:?}");
    assert!(forecast.is_some());
    let found = places.search_places("Paradise Mount Rainier", None, 3).await?;
    println!("{found:?}");
    assert!(!found.is_empty());
    let named = places.place_at(PARADISE).await?;
    println!("{named:?}");
    assert!(named.is_some());
    Ok(())
}
