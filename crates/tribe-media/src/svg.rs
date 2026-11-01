//! Cleaning an SVG drawing before anyone sees it. An SVG is a document, not
//! just a picture: it can carry scripts, event handlers, links to other
//! servers and embedded HTML. This keeps only plain drawing elements and
//! plain drawing attributes, and drops everything else, with whatever is
//! inside a dropped element.

use quick_xml::Reader;
use quick_xml::escape::escape;
use quick_xml::events::{BytesStart, Event};

/// Largest drawing accepted, bytes.
pub const MOST_SVG_BYTES: usize = 400 * 1024;

/// Most elements kept in one drawing.
const MOST_ELEMENTS: usize = 6000;

/// Elements a drawing may use.
const ELEMENTS: &[&str] = &[
    "svg",
    "defs",
    "g",
    "linearGradient",
    "radialGradient",
    "stop",
    "path",
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "line",
    "clipPath",
];

/// Attributes a drawing may use: geometry and paint, nothing that loads or runs anything.
const ATTRIBUTES: &[&str] = &[
    "id",
    "viewBox",
    "width",
    "height",
    "preserveAspectRatio",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "fx",
    "fy",
    "d",
    "points",
    "transform",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "opacity",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "clip-path",
    "clipPathUnits",
];

/// What went wrong cleaning a drawing.
#[derive(Debug, thiserror::Error)]
pub enum SvgError {
    /// Larger than [`MOST_SVG_BYTES`].
    #[error("the drawing is too large")]
    TooLarge,
    /// Not well-formed XML.
    #[error("the drawing is not valid SVG: {0}")]
    Malformed(String),
    /// The outermost element is not `<svg>`.
    #[error("the drawing has no svg element")]
    NotSvg,
}

/// Whether an attribute value is safe: a reference may only point inside the
/// drawing, as `url(#name)`, and nothing may name a script.
fn safe_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if lower.contains("javascript:") || lower.contains("data:") || lower.contains("expression(") {
        return false;
    }

    let mut rest = lower.as_str();
    while let Some(at) = rest.find("url(") {
        let inside = rest[at + 4..].trim_start();
        if !inside.starts_with('#') {
            return false;
        }
        rest = &rest[at + 4..];
    }
    true
}

/// The element's allowed attributes, escaped, as ` name="value"` pairs.
fn kept_attributes(element: &BytesStart) -> String {
    let mut kept = String::new();

    for attribute in element.attributes().flatten() {
        let name = String::from_utf8_lossy(attribute.key.as_ref()).to_string();
        let Ok(value) = attribute.unescape_value() else {
            continue;
        };

        if ATTRIBUTES.contains(&name.as_str()) && safe_value(&value) {
            kept.push_str(&format!(" {name}=\"{}\"", escape(value.as_ref())));
        }
    }
    kept
}

/// The drawing with only allowed elements and attributes, and no text,
/// comments, scripts or declarations.
pub fn clean_svg(source: &str) -> Result<String, SvgError> {
    if source.len() > MOST_SVG_BYTES {
        return Err(SvgError::TooLarge);
    }

    let mut reader = Reader::from_str(source);
    reader.config_mut().trim_text(true);

    let mut out = String::new();
    let mut open: Vec<String> = Vec::new();
    let mut skipping = 0usize;
    let mut count = 0usize;

    loop {
        let event = reader
            .read_event()
            .map_err(|error| SvgError::Malformed(error.to_string()))?;
        match event {
            Event::Eof => break,
            Event::Start(_) if skipping > 0 => skipping += 1,
            Event::Empty(_) if skipping > 0 => {}
            Event::End(_) if skipping > 0 => skipping -= 1,
            Event::Start(element) => {
                let name = String::from_utf8_lossy(element.name().as_ref()).to_string();
                if open.is_empty() && name != "svg" {
                    return Err(SvgError::NotSvg);
                }
                if !ELEMENTS.contains(&name.as_str()) || count >= MOST_ELEMENTS {
                    skipping = 1;
                    continue;
                }

                count += 1;
                let namespace = if open.is_empty() {
                    " xmlns=\"http://www.w3.org/2000/svg\""
                } else {
                    ""
                };
                out.push_str(&format!("<{name}{namespace}{}>", kept_attributes(&element)));
                open.push(name);
            }
            Event::Empty(element) => {
                let name = String::from_utf8_lossy(element.name().as_ref()).to_string();
                if open.is_empty() || !ELEMENTS.contains(&name.as_str()) || count >= MOST_ELEMENTS {
                    continue;
                }

                count += 1;
                out.push_str(&format!("<{name}{}/>", kept_attributes(&element)));
            }
            Event::End(_) => {
                if let Some(name) = open.pop() {
                    out.push_str(&format!("</{name}>"));
                }
            }
            Event::Text(_)
            | Event::CData(_)
            | Event::Comment(_)
            | Event::Decl(_)
            | Event::PI(_)
            | Event::DocType(_) => {}
        }
    }

    if !out.starts_with("<svg") {
        return Err(SvgError::NotSvg);
    }
    while let Some(name) = open.pop() {
        out.push_str(&format!("</{name}>"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_handlers_and_outside_links_are_dropped() {
        let dirty = r##"<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script>
            <rect width="10" height="10" fill="url(#sky)" onclick="x()"/>
            <circle r="2" fill="url(https://evil.example/a.svg#x)"/>
            <foreignObject><div>hi</div></foreignObject>
            <text>words</text><g><path d="M0 0L5 5"/></g></svg>"##;

        let clean = clean_svg(dirty).unwrap();
        assert!(
            clean.starts_with(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">"#)
        );
        assert!(clean.contains(r#"<rect width="10" height="10" fill="url(#sky)"/>"#));
        assert!(clean.contains("<circle r=\"2\"/>"));
        assert!(clean.contains("<g><path d=\"M0 0L5 5\"/></g>"));
        for bad in [
            "script",
            "onload",
            "onclick",
            "alert",
            "evil",
            "foreignObject",
            "div",
            "words",
            "text",
        ] {
            assert!(!clean.contains(bad), "{bad} survived: {clean}");
        }
    }

    #[test]
    fn a_document_that_is_not_svg_is_refused() {
        assert!(matches!(
            clean_svg("<html><body/></html>"),
            Err(SvgError::NotSvg)
        ));
    }
}
