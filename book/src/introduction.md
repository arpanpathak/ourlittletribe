# Introduction

<img class="cover" src="art/cover.svg" alt="Book cover: the title OurLittleTribe over a mountain landscape with three friends walking a trail toward a snow-capped peak">

OurLittleTribe is a web app for planning outings with a small group: a hike,
a picnic, a run, a book club that meets at a trailhead. A **tribe** is the
group. An **event** is one outing, with a meeting point, stops, a time, a
packing list everyone can see, and the photos afterwards.

This book describes how it is built and why. It is written for someone who
will change the code, run it, or build something like it.

## What exists

| Part | State |
|---|---|
| Tribes, events, RSVPs, the feed, search | <span class="built">built</span> |
| Places: meeting point, stops on the way, optional stops, venue, on one map | <span class="built">built</span> |
| Place search: instant OpenStreetMap results, then the model's best matches | <span class="built">built</span> |
| Packing list planned by the model from the plan, the forecast and the drive | <span class="built">built</span> |
| "Groups often also got…": pairings learned from what groups bought | <span class="built">built</span>, shown after 10 trips of evidence |
| Conditions: hourly forecast at the venue and the model's briefing | <span class="built">built</span> |
| Stores on your way, ranked by detour | <span class="built">built</span> |
| Pictures: covers, profile pictures, event photos, pictures in descriptions | <span class="built">built</span> |
| Plan from your own words, typed or spoken; Write with AI | <span class="built">built</span> |
| Own place index, own routing and store search servers | <span class="planned">planned</span> |

## Meet the crew

<img class="plate" src="art/ch01.svg" alt="Three hikers in front of a tribe flag: one in red waving, one in yellow with a red hat, one in blue waving">

The four hikers who walk across the sign-in page, the feed and the profile
banners are drawn in code, in `web/js/art.js`, as SVG animated by CSS. There
are no image files to download. Ada carries the orange pack, Bo wears the red
hat, Cy the red jacket, and Dee the dark beanie. At night, when the app is in
dark mode, the sun becomes a moon and the stars come out. The pictures in
this book are the same scenes, written out by `book/tools/art.mjs`.

## In numbers

| | |
|---|---|
| Server | one Rust binary, 10.1 MB, aarch64 release build |
| Code | 9,864 lines of Rust in six crates; 4,998 lines of JavaScript and 858 of CSS in the web app |
| Tests | 66, all without network |
| Storage | one SQLite file and one folder of pictures |
| Model | Qwen3.6 35B-A3B (NVFP4) on TensorRT Edge-LLM, on the same Jetson AGX Thor |
| Address | `https://ourlittletribe.taildb9a39.ts.net`, through Tailscale Funnel |

## How to read it

Chapter 1 is the whole system on one page. Chapters 2 to 8 each take one part
in depth: the data, places, the model, conditions, stores, pictures and the
web app. Chapters 9 and 10 cover security and running it in public.
Chapter 11 is the roadmap. The appendix lists every API route.

## Building this book

```bash
node book/tools/art.mjs        # the cover and chapter pictures
node book/tools/figures.mjs    # the diagrams
mdbook serve book              # http://localhost:3000
```
