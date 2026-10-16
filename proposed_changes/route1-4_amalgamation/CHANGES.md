# Route extension: ROUTE1..ROUTE4 + profile amalgamation (PROPOSED — not applied)

Nothing in `backend/` or `frontend/` has been modified. This folder holds:

| Path | What |
|---|---|
| `updated/backend/svk_sim.c` | full updated file (copy over `backend/svk_sim.c`, then rebuild `svk_sim.so`) |
| `updated/backend/main.py` | full updated file |
| `updated/frontend/src/SvkSim.jsx` | full updated file (3-line change) |
| `original/...` | the files as they were when this was prepared (for diffing) |
| `route1-4_amalgamation.diff` | unified diff of all three files |

Rebuild after copying `svk_sim.c`:

    gcc -shared -fPIC -O2 -Wall -Wextra -o svk_sim.so svk_sim.c

## MA table

Add three columns next to `route1`: **`route2`, `route3`, `route4`** (header matching is
case/space/underscore-insensitive, same as today). Each is an APD `S.No`; `0`/blank = unused.

For a route extension:
* `route1` = profile of the currently occupied section, `route2..route4` = extended route(s), in running order.
* `distPktStart` = **negative** distance from the LRT back to the foot of the signal to the rear of it
  (e.g. LRT = Home signal approach tag → reference = foot of the Inner-Distant signal → e.g. `-250`).
* `MA` is measured from that same reference.

Old MA tables with only `route1` keep working unchanged.

## What changed

### svk_sim.c — `track_profile_append_route_subpackets()`
Previously every route's sub-packets were appended back-to-back, so two routes produced two SSP,
two TLI, … sub-packets. That is invalid (decoder.py stops at the first repeated SUB_PKT_TYPE).
Now there is one sub-packet per type:

* only one route has that type → bytes copied verbatim (identical to today);
* several routes → amalgamated (rules per Annexure-C Amdt-10 §C.4.2):
  * **SSP / Gradient**: LM distances are segment lengths → LMs combined in route order, count aggregated.
  * **LC / Turnout / Track Condition**: distances are "from reference position / RFID" → entries combined,
    count aggregated, and each entry of route k shifted by the span of routes 1..k-1 (span = sum of the
    route's SSP LM distances, or Gradient if no SSP). Turnout DIFF_DIST_TO/REL_DIST only when TO_SPEED != 11111.
  * **TLI**: tag lists joined; a tag common to two consecutive TLIs is listed once with the
    inter-tag distances added (one is 0). DIST_DUP_TAG from the first TLI; ABS_LOC_RESET from the first TLI
    that has one (single reset per MA); LINE_TINs = TINs of all TLIs "along the MA", de-duplicated, max 6.
* The SUB_PKT_LENGTH is recomputed. If a count field (SSP/Grad/LC 31, TO 3, TCD 15, TLI 62) or the
  128-byte sub-packet limit overflows, extra LMs are dropped with a `[PROFILE_MERGE]` stderr warning.

### main.py
* `_MA_XLSX_COLUMN_MAP`: added `ROUTE2..ROUTE4`.
* **Bug fix:** `_apply_ma_route1_and_authtype_to_csv()` and `_apply_live_ma_to_csv()` checked
  `0 <= value`, so a negative `distPktStart` from the MA table was silently **not** written into the CSV.
  Both now use `_ma_value_in_range()` (distPktStart = -16384..16383).
* Serial live re-encode now triggers when any of route1..route4 changes (it used to watch route1 only).

### SvkSim.jsx
* MA-table viewer shows ROUTE2..ROUTE4 labels.

## Verification done
Using `SKP_Multi_Track_TLI_Profile_Hex_Data 11.xlsx`:
* routes 1+2+3 → SSP 3 LMs (1202+1018+1010 = 3230) and the TLI is **byte-identical** to APD S.No 9's TLI
  (which is the hand-made B-Tag→S1 combination of the same three sections).
* routes 5+7 → TLI joined at common tag 381.
* Full packet (routes 1,2,3, distPktStart -250) encoded with the new `svk_sim.so` and decoded with the
  project's `decoder.py`: CRC OK, DIST_PKT_START = -250, one SSP / Gradient / TLI sub-packet each.
* `main.py` compiles; MA→CSV patch writes route1..route4 and distPktStart = -250.

Not tested: the full app (UI, UDP/serial transmit) and the LiveTrackProfile visualiser with amalgamated packets.
