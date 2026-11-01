//! Hiking trails near a point, from OpenStreetMap through Overpass: marked
//! hiking routes, and named paths, with their lines and difficulty.

use serde::{Deserialize, Serialize};
use tribe_core::geo::{Bounds, LatLng};
use tribe_core::trails::Segment;

use crate::{Places, PlacesError};

/// How hard a trail is, from OpenStreetMap's `sac_scale` grades.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty {
    /// `hiking`: a clear path, easy footing.
    Easy,
    /// `mountain_hiking`: steeper, rougher in places.
    Moderate,
    /// `demanding_mountain_hiking`: exposed or steep; sure footing needed.
    Hard,
    /// Any `alpine_hiking` grade: scrambling, snow, or rock.
    Alpine,
}

impl Difficulty {
    /// The grade for a `sac_scale` value, or `None` for one it does not know.
    pub(crate) fn from_sac_scale(value: &str) -> Option<Difficulty> {
        match value {
            "hiking" => Some(Difficulty::Easy),
            "mountain_hiking" => Some(Difficulty::Moderate),
            "demanding_mountain_hiking" => Some(Difficulty::Hard),
            "alpine_hiking" | "demanding_alpine_hiking" | "difficult_alpine_hiking" => {
                Some(Difficulty::Alpine)
            }
            _ => None,
        }
    }
}

/// A trail as OpenStreetMap has it.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundTrail {
    /// `relation/123` or `way/456`.
    pub osm_ref: String,
    /// Its name.
    pub name: String,
    /// How hard it is, when the map says.
    pub difficulty: Option<Difficulty>,
    /// Whether it is a marked hiking route rather than one named path.
    pub is_route: bool,
    /// Its line, in pieces.
    pub segments: Vec<Segment>,
}

#[derive(Deserialize)]
struct TrailResponse {
    elements: Vec<TrailElement>,
}

#[derive(Deserialize)]
struct TrailElement {
    #[serde(rename = "type")]
    kind: String,
    id: u64,
    #[serde(default)]
    tags: std::collections::HashMap<String, String>,
    /// A way's points.
    #[serde(default)]
    geometry: Vec<GeoPoint>,
    /// A relation's members, each with its own points.
    #[serde(default)]
    members: Vec<Member>,
}

#[derive(Deserialize)]
struct Member {
    #[serde(default)]
    geometry: Vec<GeoPoint>,
}

#[derive(Deserialize)]
struct GeoPoint {
    lat: f64,
    lon: f64,
}

/// Most trails asked for at once.
const MOST_TRAILS: u32 = 40;

fn line_of(points: &[GeoPoint]) -> Segment {
    points
        .iter()
        .map(|point| LatLng {
            lat: point.lat,
            lng: point.lon,
        })
        .collect()
}

/// Named hiking routes and named paths within `radius_m` metres of `point`, with their lines.
fn trail_query(point: LatLng, radius_m: u32) -> String {
    let around = format!("around:{radius_m},{:.6},{:.6}", point.lat, point.lng);

    format!(
        "[out:json][timeout:25];(\
         relation[\"route\"~\"^(hiking|foot)$\"][\"name\"]({around});\
         way[\"highway\"~\"^(path|footway)$\"][\"name\"]({around});\
         );out geom {MOST_TRAILS};"
    )
}

/// A relation's member lines that can be drawn: two points or more.
fn member_lines(members: &[Member]) -> Vec<Segment> {
    let lines = members.iter().map(|member| line_of(&member.geometry));

    lines.filter(|line| line.len() >= 2).collect()
}

/// A trail from one element, or `None` when it has no name or no line.
fn read_trail(element: TrailElement) -> Option<FoundTrail> {
    let name = element.tags.get("name")?.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let is_route = element.kind == "relation";
    let segments = match is_route {
        true => member_lines(&element.members),
        false => vec![line_of(&element.geometry)],
    };
    if segments.iter().all(|segment| segment.len() < 2) {
        return None;
    }

    let grade = element.tags.get("sac_scale");
    let difficulty = grade.and_then(|value| Difficulty::from_sac_scale(value));
    let osm_ref = format!("{}/{}", element.kind, element.id);

    Some(FoundTrail {
        osm_ref,
        name,
        difficulty,
        is_route,
        segments,
    })
}

/// Keeps one trail per name: a marked route over a path of the same name.
fn one_per_name(trails: Vec<FoundTrail>) -> Vec<FoundTrail> {
    let mut kept: Vec<FoundTrail> = Vec::new();

    for trail in trails {
        let same = kept
            .iter()
            .position(|other| other.name.eq_ignore_ascii_case(&trail.name));
        match same {
            None => kept.push(trail),
            Some(index) if trail.is_route && !kept[index].is_route => kept[index] = trail,
            Some(_) => {}
        }
    }
    kept
}

/// Kilometres in one degree of latitude.
const KM_PER_DEGREE: f64 = 111.0;

impl Places {
    /// Hiking trails within `radius_m` metres of `point`, one per name.
    ///
    /// Marked routes come from Waymarked Trails, which answers in about a
    /// second. Only when it has nothing, or fails, does this ask Overpass,
    /// whose public servers are often busy, for named paths as well.
    pub async fn trails_near(
        &self,
        point: LatLng,
        radius_m: u32,
    ) -> Result<Vec<FoundTrail>, PlacesError> {
        let half_degrees = f64::from(radius_m) / 1000.0 / KM_PER_DEGREE;
        let routes = self
            .waymarked_routes(Bounds::around(point, half_degrees))
            .await;

        match routes {
            Ok(found) if !found.is_empty() => return Ok(one_per_name(found)),
            Ok(_) => tracing::info!("no marked routes nearby; asking Overpass for paths"),
            Err(error) => tracing::warn!(%error, "Waymarked Trails failed; asking Overpass"),
        }

        let response: TrailResponse = self.ask_overpass(&trail_query(point, radius_m)).await?;
        let trails = response
            .elements
            .into_iter()
            .filter_map(read_trail)
            .collect();
        Ok(one_per_name(trails))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"elements":[
        {"type":"way","id":7,"tags":{"name":"Skyline Trail","highway":"path","sac_scale":"mountain_hiking"},
         "geometry":[{"lat":46.786,"lon":-121.735},{"lat":46.790,"lon":-121.730}]},
        {"type":"relation","id":9,"tags":{"name":"Skyline Trail","route":"hiking"},
         "members":[{"geometry":[{"lat":46.786,"lon":-121.735},{"lat":46.795,"lon":-121.725}]},{"geometry":[]}]},
        {"type":"way","id":8,"tags":{"highway":"path"},"geometry":[{"lat":46.7,"lon":-121.7},{"lat":46.71,"lon":-121.7}]}
    ]}"#;

    #[test]
    fn a_route_wins_over_a_path_with_its_name_and_nameless_ways_are_dropped() {
        let response: TrailResponse = serde_json::from_str(SAMPLE).unwrap();
        let trails = one_per_name(
            response
                .elements
                .into_iter()
                .filter_map(read_trail)
                .collect(),
        );

        assert_eq!(trails.len(), 1);
        assert_eq!(trails[0].osm_ref, "relation/9");
        assert_eq!(trails[0].segments.len(), 1);
    }

    #[test]
    fn grades_become_difficulties() {
        assert_eq!(Difficulty::from_sac_scale("hiking"), Some(Difficulty::Easy));
        assert_eq!(
            Difficulty::from_sac_scale("demanding_alpine_hiking"),
            Some(Difficulty::Alpine)
        );
        assert_eq!(Difficulty::from_sac_scale("t3"), None);
    }

    #[test]
    fn the_query_names_the_point_and_radius() {
        let query = trail_query(
            LatLng {
                lat: 46.786,
                lng: -121.735,
            },
            4000,
        );

        assert!(query.contains("around:4000,46.786000,-121.735000"));
        assert!(query.contains("out geom 40"));
    }
}
