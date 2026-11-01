# Roadmap

What is built is in the [README](README.md) and the [book](book/src/introduction.md).
This is what comes next, roughly in order. Each item says why it matters and
what "done" looks like.

## Next: going live and staying up

- **Own place search.** Index every named place in Washington (then the West)
  from an OpenStreetMap extract into SQLite with a trigram index, built and
  queried in Rust. Search becomes instant, tolerant of typos
  ("henry javkson visitor"), works when Photon and Nominatim refuse us, and can
  search by kind ("hiking" → trailheads and peaks near you).
  *Done when:* a typed query answers in under 50 ms on the Thor with no network.
- **Search places by meaning.** Tribes and events already are: the model adds
  related words and the search index answers them. Places are next: the model
  turns "hiking" or "somewhere to swim" into kinds of places (OpenStreetMap
  tags) near you.
  *Done when:* "hiking" in a place box finds trailheads near the map's centre.
- **Own copies of the map services.** OSRM, Overpass and the marked hiking
  routes for Washington on the Thor, so routes, store searches and trails no
  longer wait on busy public servers.
- **Password reset and email verification.** Today a forgotten password means a
  new account.
- **Tests for who may do what.** Route tests that sign in as a non-member, a
  member and an organizer and check every write route answers `403` where it
  should. Today these rules were checked by hand.
- **Backups.** A nightly copy of the database and pictures to a second disk,
  with a tested restore.

## Pictures

- **Drag to reposition a cover.** Pick which part of a photo shows in the
  banner (a focal point stored with the picture), instead of always the
  centre.
- **Animated GIF covers.** Today every upload is re-encoded as a JPEG, which
  strips GPS data but keeps only a GIF's first frame. Keep animated GIFs as
  GIFs (checked frame by frame, size-limited), and convert large ones to
  animated WebP.
- **SVG covers.** An SVG scales to any banner without cropping, which makes
  repositioning unnecessary. SVG can carry scripts, so uploads must be
  sanitised to a safe subset (shapes, paths, gradients, text; no scripts,
  no external references, no `foreignObject`) and served with a strict
  content policy.
- **Albums per event**, with captions and a cover chosen from them.

## The model

- **Local voice.** Speech-to-text on the Thor (Whisper on TensorRT) instead of
  the browser's recognition, which sends audio to Google and needs HTTPS.
- **Plan from a photo of a flyer or a screenshot** of a trail page.
- **Briefing checks.** Compare every number the briefing states with the
  forecast it was given, and drop sentences that disagree.
- **Use the stops in planning.** The packing list already sees them; the store
  search should route through every stop, not just to the meeting point.
- **After the outing.** A short recap from the photos and the list: who
  brought what, what nobody used.

## People and groups

- **Invitations and private tribes.** Today every tribe is open to everyone
  signed in.
- **Comments on events**, and a question box for the planner.
- **Notifications** (email, then web push) when an event changes, a day before
  it, and when someone needs a ride.
- **Carpools.** Who drives, who has seats, who needs a ride, from where.

## The app

- **Installable on phones** (a web app manifest and offline shell).
- **Calendar subscription** per person: every event you're going to, in one
  `.ics` feed.
- **Accessibility pass** with a screen reader on every page.
