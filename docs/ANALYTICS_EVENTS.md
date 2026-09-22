# Analytics events (readiness only)

No external analytics (GA, PostHog, etc.) until explicitly approved. When added, prefer server-side or privacy-conscious client hooks with the same names.

## Recommended events

| Event | When | Properties (suggested) |
| --- | --- | --- |
| `signup` | User completes email signup (after confirmation optional) | `method: email` |
| `upload_started` | User selects file / begins upload | `source: drag \| picker` |
| `request_created` | `/api/create-request` success | `plan_code`, `duration_bucket` |
| `tutorial_completed` | User reaches end of tutorial playback (future) | `song_id` hash only |
| `pricing_viewed` | `/pricing` mount | — |
| `mini_pack_checkout_started` | Checkout API returns `url_enlace` for mini_pack | — |
| `mini_pack_paid` | Purchase settled (webhook + settle) | server-only |

## Out of scope for now

- Subscription lifecycle events until Wompi recurrent E2E is confirmed.
- PII in event payloads (email, filenames).
