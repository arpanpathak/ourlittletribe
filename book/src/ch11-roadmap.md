# Roadmap

The full list, with what "done" means for each item, is in
[`ROADMAP.md`](https://github.com/arpanpathak/ourlittletribe/blob/main/ROADMAP.md)
in the repository. This chapter explains the design behind the larger items.

## 11.1 Own place index

The place search in chapter 3 depends on Photon and Nominatim, and both can
refuse. The plan is a gazetteer built into the app: every named place in a
Washington OpenStreetMap extract (Geofabrik's, about 250 MB), read with a Rust
PBF reader, stored in SQLite with an FTS5 **trigram** index on the names.

A trigram index matches any three-letter piece of a name, so "javkson" still
shares "kso" and "son" with "jackson". Candidates from the index are then
ranked by how closely each typed word matches a word of the name, by how
notable the place is (a Wikidata link counts), and by distance. Each place also
keeps its OpenStreetMap kind, so "hiking" can become a query for trailheads and
peaks near you without any network call. The model's two steps from chapter 3
stay; their lookups become local and take milliseconds.

## 11.2 Covers that fit

Three changes to pictures (chapter 7):

- **A focal point** stored with each cover, set by dragging the picture in its
  frame, and applied with `object-position` wherever the cover is shown.
- **Animated GIFs** kept as GIF or animated WebP after checking every frame,
  instead of a JPEG of the first frame.
- **SVG covers**, which scale to any frame and need no focal point, accepted
  only after reducing them to safe elements and served with a policy that
  forbids scripts.

## 11.3 The model

- **Check briefings against their facts**: find every number in the text and
  compare it with the forecast lines it was given; drop a sentence that
  disagrees.
- **Speech on the Thor**: Whisper on TensorRT, so voice works over plain HTTP
  and no audio leaves the machine.
- **Plan from a picture**: a flyer or a trail page screenshot, read by a vision
  model, filling the form as the plan assistant does.

## 11.4 People

Private tribes with invitations, comments on events, notifications before an
event and when it changes, and carpools: who drives, who has seats, who needs
a ride from where.
