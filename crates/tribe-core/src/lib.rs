//! Pure domain logic for OurLittleTribe.
//!
//! Nothing in this crate touches the network, the database or the clock, so
//! every rule here can be tested with plain values. What a group needs is
//! decided by the model in `tribe-brain`; this crate only does the maths
//! around it: route geometry, store ranking and learned item pairings.

pub mod basket;
pub mod clock;
pub mod geo;
pub mod itinerary;
pub mod osm;
pub mod recommend;
