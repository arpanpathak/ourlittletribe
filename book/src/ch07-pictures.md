<img class="plate" src="art/ch07.svg" alt="Chapter 7 opener: three people stand in a red canoe on a lake at dawn, with a pale sun over purple hills and autumn trees on the far shore. Caption: drawn in the browser.">

# Pictures

People put pictures in four places: a cover for a tribe or an event, a profile picture and banner, photos shared after an outing, and pictures inside a description. Every one of them goes through the same short pipeline before it is stored. This chapter explains that pipeline and why it re-encodes everything, where pictures live and who sees them, and how the model draws a cover when you have no photo.

<div class="covers" markdown="1">

This chapter covers

- what happens to an uploaded picture, and why every one is written again
- where pictures are kept, who can see them, and when they are deleted
- why a GIF cover loses its animation and an SVG is refused
- covers drawn from a scene the model chooses

</div>

## 7.1 The pipeline

<figure>
<img src="figures/ch07-pictures.svg" alt="Five steps: check and decode JPEG, PNG, WebP or GIF up to 12,000 pixels a side; turn upright from the EXIF orientation; flatten transparency onto white; make two sizes, 1,600 and 560 pixels on the long side; write JPEG at quality 82 with no metadata. Limits: 15 MB an upload, 300 uploads an hour, two at a time off the request threads.">
<figcaption><b>Figure 7.1</b> <code>tribe-media::process</code>, the path of every upload.</figcaption>
</figure>

A picture arrives as the raw body of the request, at most 15 MB, and the whole server accepts at most 300 uploads an hour. `tribe-media::process` checks the first bytes to confirm the file is a JPEG, PNG, WebP or GIF, and decodes it with a limit of 12,000 pixels a side. It turns the picture upright using its EXIF orientation, flattens any transparency onto white, makes two copies at most 1,600 and 560 pixels on the long side, and encodes both as JPEG at quality 82.

Decoding a large photo takes a few hundred megabytes of memory and a second or more of processor time. It therefore runs on Tokio's blocking pool, at most two pictures at a time behind a semaphore, and never on the threads that answer requests.

The reason for writing every picture again is privacy. A phone photo carries EXIF metadata, and that usually includes the GPS position where it was taken, which is often someone's home. A file written from the decoded pixels carries none of it. It also means the server only ever serves files it wrote itself, in one format it knows.

## 7.2 Where pictures live

Files live in the pictures folder (`OLT_MEDIA`, by default a `media` folder next to the database) as `{id}.jpg` and `{id}_s.jpg`, where the id is a lower-case UUID. A row in `images` or `inline_images`, or a column on `users`, records what each picture belongs to (chapter 2).

`GET /media/{file}` serves pictures to signed-in people only, with `Cache-Control: private, max-age=31536000, immutable`. A picture never changes under its id; a new picture gets a new id, so a browser can keep a copy for a year. The server parses the file name instead of joining it to a path, so a request for `../` cannot reach anything outside the folder.

An event's cover can be changed by its planner, the tribe's organizers and admins, and a tribe's cover by its organizers. Anyone in the tribe can add photos to its events, and a photo can be deleted by whoever shared it or by the event's managers. The hourly sweep deletes every file whose id no row mentions, so a replaced cover or a deleted photo leaves nothing behind.

## 7.3 GIF and SVG

A GIF cover loses its animation. The upload works, but the last step writes a JPEG of the first frame. Keeping animated GIFs needs a second path that checks every frame and keeps the GIF, or converts it to animated WebP, instead of re-encoding it.

An SVG is refused. SVG is a document format: a file can contain scripts and links to other servers. The server only accepts formats it can decode into pixels. SVG covers would be worth having, because they scale to any banner without cropping, but only once uploads are reduced to a safe subset of shapes, paths, gradients and text. Both changes are on the roadmap.

## 7.4 Covers the model draws

<figure>
<img src="figures/ch07-ai-cover.svg" alt="design_cover reads the name, place, date and description in 0.8 seconds and answers six words: landscape lake, light dawn, weather clear, season autumn, activity paddling, crew 3. The browser draws the scene with the app's own people and trees, a canvas turns it into a 1,600 by 900 PNG, and it takes the same upload path as any picture. Beside it, the drawn scene: three people in a canoe on a lake at dawn.">
<figcaption><b>Figure 7.2</b> A cover from one short answer. The picture is the scene drawn from the answer shown.</figcaption>
</figure>

When you press "Draw one with AI" on a tribe or event, the model reads the name, the place, the date and the description, and `design_cover` answers with six words: a landscape, a time of day, the weather, the season, an activity and how many people. For "Lake Twenty-Two first light paddle" on 14 November it chose a lake at dawn in autumn, with three people paddling.

The browser draws that scene with `cover_art.ts`, from the same people and trees as the rest of the app's illustrations, writing every colour into the drawing so it stands on its own. A canvas turns it into a 1,600 × 900 PNG, and the PNG goes through the upload pipeline in figure 7.1 like any photo. There is no image model to host, and a cover costs one answer of about 30 tokens.

The six words set the backdrop. A random seed, new for every press, sets everything else: which of ten people are in the group and in what order, how far apart they stand and how tall each one is, where the trees and clouds go, whether birds cross the sky, and whether a dog comes along. Two covers for the same plan therefore look different, and pressing again draws another. The book uses fixed seeds, so its pictures stay the same between builds.

The drawing is composed for two crops. Cards show a cover at 16:9, and the top of a tribe or event page crops it to a band about 4:1 across the middle. The land and the people are lifted into that band, so the group stays in view in both.
