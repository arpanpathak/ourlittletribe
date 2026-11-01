# Appendix: the API

Every route below is under `/api` and answers JSON, except the two in the last section. The routes follow REST: a path names a thing, and the method says what to do with it. `POST` creates and answers `201 Created`; `PUT` sets something to a value you send, such as your RSVP or a cover, and doing it twice changes nothing more; `PATCH` changes some fields; `DELETE` removes, and answers `204 No Content` when there is nothing to return. `me` in a path means the person signed in.

Every route except creating an account and signing in needs the session cookie (chapter 9). An error is `{"error": "…"}` with one of these statuses:

| Status | Meaning |
|---|---|
| `400` | the request is malformed or a field is out of range |
| `401` | not signed in, or a wrong password |
| `403` | signed in, but not allowed to do this |
| `404` | no such thing |
| `409` | it already exists, such as an email in use |
| `413` | the upload is larger than 15 MB |
| `429` | too many requests of this kind; try later |
| `502` | a public service the server called failed |
| `503` | the model is not configured on this server |

A picture upload sends the file itself as the request body, with its `Content-Type`, at most 15 MB.

## Accounts and people

| Method and path | Does |
|---|---|
| `POST /users` | create an account and sign in: `{email, name, password}` |
| `POST /sessions` | sign in: `{email, password}` |
| `DELETE /sessions/current` | sign out |
| `GET /users/me` | your account, with your email |
| `PATCH /users/me` | change your name, bio or home area |
| `PUT /users/me/avatar`, `DELETE /users/me/avatar` | set or remove your profile picture |
| `PUT /users/me/cover`, `DELETE /users/me/cover` | set or remove your profile banner |
| `GET /users/{id}` | a person's profile: their tribes and the events they are going to |

## Tribes

| Method and path | Does |
|---|---|
| `GET /tribes` | every tribe, with whether you belong |
| `POST /tribes` | start a tribe: `{name, description, home_area}`; you become its organizer |
| `GET /tribes/{id}` | a tribe with its members, upcoming events and past events |
| `PATCH /tribes/{id}` | change a tribe (organizers) |
| `PUT /tribes/{id}/members/me`, `DELETE /tribes/{id}/members/me` | join or leave |
| `PUT /tribes/{id}/cover`, `DELETE /tribes/{id}/cover` | set or remove the cover (organizers) |

## Events

| Method and path | Does |
|---|---|
| `GET /events` | upcoming events across every tribe |
| `POST /events` | plan an event: `{tribe_id, title, description, meeting_point: {name, lat, lng}, starts_at, tz_offset_minutes, stops: [{kind, name, lat, lng, note}]}` |
| `GET /events/{id}` | everything the event page shows: the event, stops, people going, list, conditions, photos, your starting point |
| `PATCH /events/{id}` | change an event (its managers); the body is the same as for creating, without `tribe_id` |
| `DELETE /events/{id}` | delete it and everything attached (its managers) |
| `PUT /events/{id}/rsvp` | `{answer: "going"}` or `{answer: "not_going"}` |
| `PUT /events/{id}/vote`, `DELETE /events/{id}/vote` | `{vote: "up"}` or `{vote: "down"}`, or take your vote back |
| `PUT /events/{id}/origin`, `DELETE /events/{id}/origin` | set or clear where you set off from: `{lat, lng}` |
| `PUT /events/{id}/cover`, `DELETE /events/{id}/cover` | set or remove the cover (its managers) |
| `POST /events/{id}/photos` | share a photo; `?caption=` is optional |
| `DELETE /photos/{id}` | delete a photo (whoever shared it, or the event's managers) |
| `GET /events/{id}/briefing?units=imperial` | the model's conditions briefing; `units` is `imperial` or `metric` |
| `GET /events/{id}/trails` | named trails near the venue, nearest first, with length, climb, profile and line |
| `GET /events/{id}/trip` | your route to the meeting point, and shops on it that sell what you still need |

## The packing list

| Method and path | Does |
|---|---|
| `POST /events/{id}/items` | add an item: `{name, why?, scope?, quantity?}`; `scope` is `personal` or `shared` |
| `POST /events/{id}/item-plans` | have the model plan items from the trip facts; answers how many were added and the whole list |
| `GET /events/{id}/item-suggestions?q=` | items for a need in your own words, such as "my feet get cold", with shops on your way |
| `DELETE /items/{id}` | remove an item (whoever added it, or the event's managers) |
| `PUT /items/{id}/marks/me`, `DELETE /items/{id}/marks/me` | `{state: "bringing"}` or `{state: "got"}`, or clear your mark |

## Search, places, drafts and pictures

| Method and path | Does |
|---|---|
| `GET /feed` | your next events, your tribes, and recent activity |
| `GET /search?q=` | tribes, upcoming events and people matching any word of the text, in any form, with near spellings |
| `GET /search/related?q=` | more results, for words the model says the search also means |
| `GET /places?q=&lat=&lng=` | OpenStreetMap places for the text, nearest first; tries "and" and "&" both |
| `GET /places/best-matches?q=&lat=&lng=` | the places the model works out the text means, each one real |
| `GET /places/nearest?lat=&lng=` | the named place or address at a point |
| `POST /event-drafts` | an event filled in from your words: `{text, today, near?}` |
| `POST /tribe-drafts` | a tribe filled in from your words: `{text}` |
| `POST /description-drafts` | write or rewrite a description: `{details, current, instruction}` |
| `POST /cover-designs` | a cover scene: `{subject, title, description, place, when}`, where `subject` is `tribe` or `event` |
| `POST /pictures` | upload a picture to place in a description |

## Outside `/api`

| Method and path | Does |
|---|---|
| `GET /media/{id}.jpg`, `GET /media/{id}_s.jpg` | a picture, large or small; signed-in people only |
| `GET /health` | `{"status": "ok"}` |

Any other path without a dot in it answers with the web app's page, so links such as `/#/events/{id}` work when shared.
