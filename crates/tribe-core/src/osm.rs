//! Small helpers for OpenStreetMap tag values.

/// Whether `tag` is a plain OpenStreetMap value such as `supermarket` or `pet`.
///
/// Model output and user input are checked with this before a tag goes into
/// an Overpass query or the database.
pub fn is_plain_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 40
        && tag
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_' || byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_tags_are_allowed() {
        assert!(is_plain_tag("supermarket"));
        assert!(is_plain_tag("pet_shop"));
        assert!(!is_plain_tag("a\"]);out;"));
        assert!(!is_plain_tag("Supermarket"));
        assert!(!is_plain_tag(""));
    }
}
