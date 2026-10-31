//! Uploaded pictures: event covers, tribe covers and event photos.
//!
//! Every upload is decoded, turned upright from its EXIF orientation, scaled
//! down, and written again as a plain JPEG. Writing it again drops all
//! metadata, including the GPS position phones put in photos. Each picture is
//! kept in two sizes: `{id}.jpg` (at most 1600 px a side) and `{id}_s.jpg`
//! (at most 560 px) for cards and grids.

use std::collections::HashSet;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits, RgbImage};

/// The longest side of the large copy, in pixels.
pub const LARGE_SIDE: u32 = 1600;
/// The longest side of the small copy, in pixels.
pub const SMALL_SIDE: u32 = 560;
/// The largest upload accepted, in bytes.
pub const MAX_UPLOAD_BYTES: usize = 15 * 1024 * 1024;

const JPEG_QUALITY: u8 = 82;
const MAX_SOURCE_SIDE: u32 = 12_000;
const MAX_DECODE_BYTES: u64 = 400 * 1024 * 1024;

/// Everything that can go wrong with a picture.
#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    /// The bytes are not a JPEG, PNG, WebP or GIF picture.
    #[error("upload a JPEG, PNG, WebP or GIF picture")]
    NotAPicture,
    /// The picture is bigger than allowed.
    #[error("that picture is too large")]
    TooLarge,
    /// The picture could not be decoded or encoded.
    #[error("that picture could not be read: {0}")]
    Image(#[from] image::ImageError),
    /// Reading or writing the stored files failed.
    #[error("storing the picture failed: {0}")]
    Io(#[from] std::io::Error),
}

/// A picture ready to store: two JPEG copies and the large copy's size.
#[derive(Debug, Clone)]
pub struct Processed {
    /// Width of the large copy.
    pub width: u32,
    /// Height of the large copy.
    pub height: u32,
    /// The large JPEG.
    pub large: Vec<u8>,
    /// The small JPEG.
    pub small: Vec<u8>,
}

fn shrink_to(picture: &DynamicImage, longest_side: u32) -> DynamicImage {
    match picture.width().max(picture.height()) > longest_side {
        true => picture.resize(longest_side, longest_side, FilterType::CatmullRom),
        false => picture.clone(),
    }
}

/// Flattens any transparency onto white, so transparent PNGs don't turn black as JPEGs.
fn flatten_on_white(picture: &DynamicImage) -> RgbImage {
    match picture.color().has_alpha() {
        false => picture.to_rgb8(),
        true => {
            let with_alpha = picture.to_rgba8();
            let mut flat = RgbImage::new(with_alpha.width(), with_alpha.height());
            for (x, y, pixel) in with_alpha.enumerate_pixels() {
                let [red, green, blue, alpha] = pixel.0;
                let blend = |channel: u8| -> u8 {
                    let covered = u16::from(channel) * u16::from(alpha);
                    let background = 255 * (255 - u16::from(alpha));
                    ((covered + background) / 255) as u8
                };
                flat.put_pixel(x, y, image::Rgb([blend(red), blend(green), blend(blue)]));
            }
            flat
        }
    }
}

fn encode_jpeg(picture: &DynamicImage) -> Result<Vec<u8>, MediaError> {
    let flat = flatten_on_white(picture);
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY).encode_image(&flat)?;
    Ok(bytes)
}

/// Decodes an upload, turns it upright, scales it down and re-encodes it.
pub fn process(upload: &[u8]) -> Result<Processed, MediaError> {
    if upload.len() > MAX_UPLOAD_BYTES {
        return Err(MediaError::TooLarge);
    }
    let mut reader = ImageReader::new(Cursor::new(upload)).with_guessed_format()?;
    match reader.format() {
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP | ImageFormat::Gif) => {}
        _ => return Err(MediaError::NotAPicture),
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_SIDE);
    limits.max_image_height = Some(MAX_SOURCE_SIDE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|error| match error {
        image::ImageError::Limits(_) => MediaError::TooLarge,
        other => MediaError::Image(other),
    })?;
    let orientation = decoder.orientation()?;
    let mut picture = DynamicImage::from_decoder(decoder).map_err(|error| match error {
        image::ImageError::Limits(_) => MediaError::TooLarge,
        other => MediaError::Image(other),
    })?;
    picture.apply_orientation(orientation);
    let large = shrink_to(&picture, LARGE_SIDE);
    let small = shrink_to(&large, SMALL_SIDE);
    Ok(Processed {
        width: large.width(),
        height: large.height(),
        large: encode_jpeg(&large)?,
        small: encode_jpeg(&small)?,
    })
}

/// Which stored copy to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    /// At most [`LARGE_SIDE`] pixels.
    Large,
    /// At most [`SMALL_SIDE`] pixels.
    Small,
}

/// Whether `id` looks like an id this store made: a lower-case UUID. Anything else
/// (slashes, dots) is refused before it gets near a file path.
pub fn is_valid_id(id: &str) -> bool {
    id.len() == 36
        && id
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                8 | 13 | 18 | 23 => character == '-',
                _ => character.is_ascii_digit() || ('a'..='f').contains(&character),
            })
}

/// Splits a served file name such as `{id}.jpg` or `{id}_s.jpg` into its id and size.
pub fn parse_file_name(file_name: &str) -> Option<(&str, Size)> {
    let stem = file_name.strip_suffix(".jpg")?;
    let (id, size) = match stem.strip_suffix("_s") {
        Some(id) => (id, Size::Small),
        None => (stem, Size::Large),
    };
    is_valid_id(id).then_some((id, size))
}

/// The folder that holds the pictures.
#[derive(Debug, Clone)]
pub struct MediaStore {
    folder: PathBuf,
}

impl MediaStore {
    /// Uses `folder`, creating it if needed.
    pub fn open(folder: &Path) -> Result<MediaStore, MediaError> {
        std::fs::create_dir_all(folder)?;
        Ok(MediaStore {
            folder: folder.to_path_buf(),
        })
    }

    fn path(&self, id: &str, size: Size) -> PathBuf {
        let name = match size {
            Size::Large => format!("{id}.jpg"),
            Size::Small => format!("{id}_s.jpg"),
        };
        self.folder.join(name)
    }

    /// Writes both copies of a picture under `id`.
    pub fn save(&self, id: &str, picture: &Processed) -> Result<(), MediaError> {
        if !is_valid_id(id) {
            return Err(MediaError::NotAPicture);
        }
        for (size, bytes) in [(Size::Large, &picture.large), (Size::Small, &picture.small)] {
            let path = self.path(id, size);
            let partial = path.with_extension("part");
            std::fs::write(&partial, bytes)?;
            std::fs::rename(&partial, &path)?;
        }
        Ok(())
    }

    /// Reads one copy of a picture, or `None` if there is no such picture.
    pub fn read(&self, id: &str, size: Size) -> Result<Option<Vec<u8>>, MediaError> {
        if !is_valid_id(id) {
            return Ok(None);
        }
        match std::fs::read(self.path(id, size)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(MediaError::Io(error)),
        }
    }

    /// Deletes both copies of a picture; a missing file is not an error.
    pub fn remove(&self, id: &str) -> Result<(), MediaError> {
        if !is_valid_id(id) {
            return Ok(());
        }
        for size in [Size::Large, Size::Small] {
            match std::fs::remove_file(self.path(id, size)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(MediaError::Io(error)),
            }
        }
        Ok(())
    }

    /// Deletes every stored picture whose id is not in `keep`, and returns how many went.
    /// Used after events are purged, since their picture rows go with them.
    pub fn sweep(&self, keep: &HashSet<String>) -> Result<usize, MediaError> {
        let mut removed = 0;
        for entry in std::fs::read_dir(&self.folder)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            let id = match parse_file_name(name) {
                Some((id, _)) => id,
                None => match name.strip_suffix(".part") {
                    Some(_) => "",
                    None => continue,
                },
            };
            if !keep.contains(id) {
                std::fs::remove_file(entry.path())?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn png_bytes(width: u32, height: u32, pixel: Rgba<u8>) -> Vec<u8> {
        let picture = DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, pixel));
        let mut bytes = Vec::new();
        if let Err(error) = picture.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png) {
            panic!("encoding the sample failed: {error}");
        }
        bytes
    }

    fn decode(bytes: &[u8]) -> DynamicImage {
        match image::load_from_memory(bytes) {
            Ok(picture) => picture,
            Err(error) => panic!("decoding failed: {error}"),
        }
    }

    #[test]
    fn big_picture_is_scaled_down_keeping_its_shape() -> Result<(), MediaError> {
        let processed = process(&png_bytes(3200, 1600, Rgba([10, 120, 80, 255])))?;
        assert_eq!((processed.width, processed.height), (1600, 800));
        let small = decode(&processed.small);
        assert_eq!((small.width(), small.height()), (560, 280));
        assert_eq!(&processed.large[..2], &[0xFF, 0xD8], "large copy is a JPEG");
        Ok(())
    }

    #[test]
    fn small_picture_is_not_enlarged() -> Result<(), MediaError> {
        let processed = process(&png_bytes(300, 200, Rgba([0, 0, 0, 255])))?;
        assert_eq!((processed.width, processed.height), (300, 200));
        Ok(())
    }

    #[test]
    fn transparency_becomes_white() -> Result<(), MediaError> {
        let processed = process(&png_bytes(20, 20, Rgba([0, 0, 0, 0])))?;
        let pixel = decode(&processed.large).to_rgb8().get_pixel(10, 10).0;
        assert!(pixel.iter().all(|channel| *channel > 245), "{pixel:?}");
        Ok(())
    }

    #[test]
    fn text_is_refused() {
        assert!(matches!(
            process(b"hello, not a picture"),
            Err(MediaError::NotAPicture)
        ));
    }

    #[test]
    fn file_names_must_hold_a_uuid() {
        let id = "0b9c1f5e-2a4d-4c3b-9e8f-1a2b3c4d5e6f";
        assert_eq!(
            parse_file_name(&format!("{id}.jpg")),
            Some((id, Size::Large))
        );
        assert_eq!(
            parse_file_name(&format!("{id}_s.jpg")),
            Some((id, Size::Small))
        );
        assert_eq!(parse_file_name("../../etc/passwd.jpg"), None);
        assert_eq!(parse_file_name(&format!("{id}.png")), None);
        assert!(!is_valid_id("0B9C1F5E-2A4D-4C3B-9E8F-1A2B3C4D5E6F"));
    }

    #[test]
    fn store_saves_reads_and_sweeps() -> Result<(), MediaError> {
        let folder = std::env::temp_dir().join(format!("tribe-media-test-{}", std::process::id()));
        let store = MediaStore::open(&folder)?;
        let processed = process(&png_bytes(40, 30, Rgba([200, 100, 50, 255])))?;
        let kept = "11111111-1111-4111-8111-111111111111";
        let dropped = "22222222-2222-4222-8222-222222222222";
        store.save(kept, &processed)?;
        store.save(dropped, &processed)?;
        assert!(store.read(kept, Size::Small)?.is_some());
        let keep: HashSet<String> = [kept.to_string()].into_iter().collect();
        assert_eq!(store.sweep(&keep)?, 2);
        assert!(store.read(dropped, Size::Large)?.is_none());
        assert!(store.read(kept, Size::Large)?.is_some());
        store.remove(kept)?;
        assert!(store.read(kept, Size::Large)?.is_none());
        std::fs::remove_dir_all(&folder)?;
        Ok(())
    }
}
