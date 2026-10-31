# Appendix: the API

Every route is under `/api` and answers JSON, except `/media` and `/health`.
All routes except registering and signing in need the session cookie
(chapter 9). Errors are `{"error": "…"}` with a status: `400` for bad input,
`401` signed out, `403` not allowed or wrong password, `404` not found, `409` already
exists (such as an email in use), `413` too large, `429`
too many, `502` a public service failed, `503` no model configured.

Picture uploads send the file itself as the request body, with its
`Content-Type`, at most 15 MB.

## Accounts and people

| Method and path | Does |
|---|---|
| `POST /account/register` | create an account and sign in: `{email, name, password}` |
| `POST /account/login` | sign in: `{email, password}` |
| `POST /account/logout` | sign out |
| `GET /me`, `PATCH /me` | your account; change name, bio, home area |
| `POST /me/avatar`, `DELETE /me/avatar` | set or remove your profile picture |
| `POST /me/cover`, `DELETE /me/cover` | set or remove your profile banner |
| `GET /people/{id}` | a profile, with tribes and events |

## Tribes

| Method and path | Does |
|---|---|
| `GET /tribes`, `POST /tribes` | list; create |
| `GET /tribes/{id}`, `PATCH /tribes/{id}` | detail with members and events; edit |
| `POST /tribes/{id}/cover`, `DELETE /tribes/{id}/cover` | set or remove the cover |
| `POST /tribes/{id}/join`, `POST /tribes/{id}/leave` | join; leave |

## Events

| Method and path | Does |
|---|---|
| `GET /events`, `POST /events` | upcoming events; create, with `stops` |
| `GET /events/{id}`, `PATCH /events/{id}`, `DELETE /events/{id}` | detail; edit; delete |
| `POST /events/{id}/cover`, `DELETE /events/{id}/cover` | set or remove the cover |
| `POST /events/{id}/photos?caption=` | share a photo |
| `DELETE /photos/{image_id}` | delete a photo |
| `POST /events/{id}/rsvp`, `POST /events/{id}/vote` | going or not; thumbs up or down |
| `PUT /events/{id}/origin`, `DELETE /events/{id}/origin` | share or remove your starting point |
| `GET /events/{id}/briefing?units=imperial` | the model's conditions briefing |

## The packing list and the trip

| Method and path | Does |
|---|---|
| `POST /events/{id}/plan` | the model plans items for the list |
| `POST /events/{id}/items` | add an item |
| `POST /events/{id}/find` | items that answer a search, such as "something for mosquitoes" |
| `POST /items/{id}/mark`, `DELETE /items/{id}` | mark bringing or got; remove |
| `GET /events/{id}/trip` | your route and the stores on it |

## Search, places and the assistant

| Method and path | Does |
|---|---|
| `GET /feed` | your upcoming events, tribes and activity |
| `GET /search?q=` | events, tribes and people containing the text |
| `GET /places?q=&lat=&lng=` | place search, plain lane |
| `GET /places/smart?q=&lat=&lng=` | place search, the model's lane |
| `GET /places/at?lat=&lng=` | the place or address at a point |
| `POST /assist/event-draft` | fill in an event from words: `{text, today, lat, lng}` |
| `POST /assist/description` | write or rewrite a description: `{details, current, instruction}` |
| `POST /pictures` | upload a picture to place in a description |

## Outside `/api`

| Method and path | Does |
|---|---|
| `GET /media/{id}.jpg`, `GET /media/{id}_s.jpg` | a picture, large or small; signed in only |
| `GET /health` | `{"status": "ok"}` |
| anything else | the web app |
