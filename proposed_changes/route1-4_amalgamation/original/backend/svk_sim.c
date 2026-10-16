/*
 * ============================================================================
 * svk_sim.c  —  SVK SIM Station XML + StoryBoard XML Parser + CSV Encoder
 *               + UDP Network Transmission Engine
 *
 * DOCUMENT REFERENCE : RDSO/SPN/196/2020  Annexure-C  (Amendment-10)
 * SAFETY INTEGRITY   : Intended for SIL-4 Railway Signalling Systems
 *                      (Train Collision Avoidance System – TCAS)
 *
 * BUILD (shared library, loaded by Python via ctypes):
 *   gcc -shared -fPIC -O2 -Wall -Wextra -o svk_sim.so svk_sim.c
 *
 * BUILD (test executable – define SVK_TEST_MAIN):
 *   gcc -DSVK_TEST_MAIN -O2 -Wall -Wextra -o svk_sim_test svk_sim.c
 *
 * ----------------------------------------------------------------------------
 * EXPORTED FUNCTIONS
 * ----------------------------------------------------------------------------
 *
 *  1. parse_station_xml()
 *       Parses a Station Configuration XML file into a JSON structure
 *       containing station identity, location, signals and point machines.
 *
 *  2. parse_storyboard_xml()
 *       Parses a StoryBoard XML (OpenSCENARIO-style) into a JSON structure
 *       of Stories → Acts → Events with speed-action and trigger conditions.
 *
 *  3. encode_storyboard_csv()
 *       Reads the TCAS Storyboard CSV (35-column Annexure-C format), encodes
 *       each data row into the correct binary packet (PKT_TYPE 9–13) and
 *       returns a JSON array with the row's hex bytes, byte-length, and
 *       packet-type metadata.
 *
 *       Signature (radio_id ADDED — see §C.3.2.12 note below):
 *         int encode_storyboard_csv(
 *             const char *csv_text,  // full CSV content (NUL-terminated)
 *             int         radio_id,  // 1 or 2 — which radio unit this
 *                                    //   packet would be sent on
 *             char       *out_json,  // caller-supplied output buffer
 *             int         out_len    // size of out_json
 *         );
 *       Each JSON record's "hex" field is unchanged (the pure KAVACH packet
 *       bytes, used for CRC/MAC checks). Three fields were ADDED:
 *       "radio_id", "frame_prefix" (6 hex chars), "ota_hex" (frame_prefix +
 *       hex — what actually goes on air) and "ota_byte_len".
 *
 *  4. transmit_storyboard_csv()   ← NEW
 *       Reads the same CSV, encodes every data row in TDMA frame order, then
 *       transmits each packet over UDP to a remote SVK Stresser endpoint.
 *       Packets within the same TDMA frame window (2-second epoch, matching
 *       the StoryBoard frame rate) are dispatched together; then the function
 *       sleeps until the next 2-second boundary before processing the next
 *       frame number group.
 *
 *       Signature (radio_id ADDED — see §C.3.2.12 note below):
 *         int transmit_storyboard_csv(
 *             const char *csv_text,   // full CSV content (NUL-terminated)
 *             const char *dest_ip,    // destination IPv4 address string
 *             int         dest_port,  // destination UDP port (1–65535)
 *             int         loop,       // 0 = play once; 1 = loop forever
 *             int         radio_id,   // 1 or 2 — which physical radio is
 *                                     //   transmitting (sets OTA prefix)
 *             volatile int *stop_flag // pointer to int; set to 1 to abort
 *         );
 *       Returns:
 *         0  – completed successfully (or stopped via stop_flag)
 *        -1  – invalid argument (incl. radio_id not 1 or 2)
 *        -2  – socket creation / bind failure
 *        -3  – encoding error
 *
 *  5. svk_ota_prefix_hex()   ← NEW
 *       Returns the Annexure-C §C.3.2.12 3-byte Start-of-Frame prefix for
 *       a given radio_id as a 6-char hex string ("F1A5C3" / "F2A5C3"), so
 *       any OTHER byte-writing TX path outside this file (e.g. a serial/
 *       UHF modem writer in main.py) can reuse the exact same framing
 *       instead of re-deriving it.
 *
 *       Signature:
 *         int svk_ota_prefix_hex(int radio_id, char *out_hex, int out_len);
 *
 * ----------------------------------------------------------------------------
 * OTA START-OF-FRAME PREFIX  (RDSO/SPN/196/2020 Annexure-C §C.3.2.12)
 * ----------------------------------------------------------------------------
 *   "When Radio1 is transmitting, the prefix '0xF1 0xA5 0xC3' must be added
 *    as Start of frame. When Radio2 is transmitting, the prefix '0xF2 0xA5
 *    0xC3' must be added as Start of frame."
 *
 * This is modem-level framing, added OUTSIDE the encoded KAVACH packet
 * (never included in PKT_CRC/MAC). transmit_storyboard_csv() now prepends
 * it to every UDP datagram sent. encode_storyboard_csv() reports it
 * separately (frame_prefix / ota_hex) without altering "hex", so existing
 * CRC-verification logic downstream is unaffected.
 *
 * ============================================================================
 * DESIGN NOTES FOR SIL-4 MAINTENANCE ENGINEERS
 * ============================================================================
 *
 *  Determinism & Safety
 *  --------------------
 *  • No dynamic memory allocation occurs during the transmission loop.
 *    All working buffers are allocated on the stack or as static storage.
 *  • The BitWriter structure is initialised to zero before every encode
 *    call (bw_init), ensuring no stale data contaminates a new packet.
 *  • All field widths are explicitly stated in comments alongside every
 *    bw_write() call so they can be verified against Annexure-C by
 *    inspection.
 *  • Integer overflow cannot occur in field encoding: all fields are
 *    masked to their declared width inside bw_write() / bw_write_signed().
 *
 *  Packet Structure Map (each encoder is self-documenting)
 *  -------------------------------------------------------
 *  PKT_TYPE 9  – Station/ILC/IBS → Onboard Regular Packet   (§C.4.2)
 *  PKT_TYPE 10 – Onboard → Station Regular Packet            (§C.4.3)
 *  PKT_TYPE 11 – Access Authority Packet v2.0                (§C.4.4)
 *  PKT_TYPE 12 – Additional Emergency Packet                 (§C.4.5)
 *  PKT_TYPE 13 – Onboard Access Request Packet               (§C.4.6)
 *
 *  CSV Column Layout (0-indexed, 35 columns total)
 *  ------------------------------------------------
 *  Col  0  TDMASlot        Col 18  nxtSigAsp
 *  Col  1  pktType         Col 19  apprSigDist
 *  Col  2  pktLen          Col 20  authType
 *  Col  3  frameNum        Col 21  authSpeed
 *  Col  4  srcStationId    Col 22  MA
 *  Col  5  srcStationVer   Col 23  shortMA
 *  Col  6  locoId          Col 24  revMA
 *  Col  7  REF_PROF_ID     Col 25  TLsts
 *  Col  8  lastRefRfid     Col 26  TLtype
 *  Col  9  distPktStart    Col 27  refFN
 *  Col 10  pktDir          Col 28  refOff
 *  Col 11  subPktType      Col 29  nxtStnHO
 *  Col 12  subPktLen       Col 30  nxtStationId
 *  Col 13  frameOffset     Col 31  profileID
 *  Col 14  sos             Col 32  TLIProfID
 *  Col 15  secType         Col 33  CBCMAC
 *  Col 16  curSigInfo      Col 34  CRC
 *  Col 17  curSigAsp
 *
 * ============================================================================
 */

/* ── Standard headers ─────────────────────────────────────────────────────── */

/* POSIX feature-test macro — must appear before all system headers.
 * Enables clock_gettime(), CLOCK_MONOTONIC, nanosleep(), struct timespec. */
#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdarg.h>
#include <ctype.h>
#include <time.h>

/* POSIX socket headers (Linux / POSIX) */
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

/* ============================================================================
 * SECTION 1 – TINY XML HELPERS
 *
 * These are minimal, allocation-free XML helpers sufficient for the structured
 * (non-namespace) XML formats produced by the SVK SIM configuration tools.
 * They are NOT a general-purpose XML parser.
 * ============================================================================ */

/**
 * find_tag() – locate the text content of the first occurrence of <tag>…</tag>
 *
 * @src      : XML source string (NUL-terminated, read-only)
 * @tag      : tag name (without angle brackets)
 * @tag_end  : if non-NULL, receives a pointer to the character immediately
 *             after the closing </tag> (useful for iterating sibling tags)
 *
 * Returns   : pointer to first character of the tag's TEXT content, or NULL
 *             if the tag is not found.
 *
 * NOTE      : The function handles self-closing tags defensively but does not
 *             return content for them (content would be zero-length).
 */
static const char *find_tag(const char *src,
                              const char *tag,
                              const char **tag_end)
{
    char open[128], close[128];
    snprintf(open,  sizeof(open),  "<%s",   tag);
    snprintf(close, sizeof(close), "</%s>", tag);

    const char *p = strstr(src, open);
    if (!p) return NULL;

    const char *gt = strchr(p, '>');
    if (!gt) return NULL;

    const char *content_start = gt + 1;
    const char *cl = strstr(content_start, close);

    if (tag_end)
        *tag_end = cl ? (cl + strlen(close)) : content_start;

    return content_start;
}

/**
 * get_tag_text() – copy the trimmed text content of a tag into dst[].
 *
 * Writes an empty string to dst if the tag is missing or content is absent.
 */
static void get_tag_text(const char *src,
                          const char *tag,
                          char       *dst,
                          int         dst_len)
{
    const char *end_sentinel;
    const char *start = find_tag(src, tag, &end_sentinel);
    if (!start) { dst[0] = '\0'; return; }

    char close[128];
    snprintf(close, sizeof(close), "</%s>", tag);
    const char *end = strstr(start, close);
    if (!end) { dst[0] = '\0'; return; }

    /* Trim leading whitespace */
    while (start < end && isspace((unsigned char)*start)) start++;
    /* Trim trailing whitespace */
    while (end > start && isspace((unsigned char)*(end - 1))) end--;

    int len = (int)(end - start);
    if (len >= dst_len) len = dst_len - 1;
    memcpy(dst, start, len);
    dst[len] = '\0';
}

/**
 * get_attr() – extract the value of a named XML attribute.
 *
 * Searches for   attr="value"   within the supplied tag_open string
 * (which should span from '<' up to and including '>').
 */
static void get_attr(const char *tag_open,
                      const char *attr,
                      char       *dst,
                      int         dst_len)
{
    char search[128];
    snprintf(search, sizeof(search), "%s=\"", attr);

    const char *p = strstr(tag_open, search);
    if (!p) { dst[0] = '\0'; return; }

    p += strlen(search);
    const char *q = strchr(p, '"');
    if (!q) { dst[0] = '\0'; return; }

    int len = (int)(q - p);
    if (len >= dst_len) len = dst_len - 1;
    memcpy(dst, p, len);
    dst[len] = '\0';
}

/**
 * json_escape() – copy src into dst, escaping '"' and '\\' for JSON strings.
 */
static void json_escape(const char *src, char *dst, int dst_len)
{
    int di = 0;
    for (int si = 0; src[si] && di < dst_len - 2; si++) {
        char c = src[si];
        if ((c == '"' || c == '\\') && di < dst_len - 3)
            dst[di++] = '\\';
        dst[di++] = c;
    }
    dst[di] = '\0';
}

/**
 * buf_append() – vsnprintf into a bounded output buffer with position tracking.
 *
 * Returns 0 on success, -1 if the buffer would overflow.
 */
static int buf_append(char *buf, int *pos, int buf_len, const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    int written = vsnprintf(buf + *pos, buf_len - *pos, fmt, args);
    va_end(args);

    if (written < 0 || *pos + written >= buf_len)
        return -1;

    *pos += written;
    return 0;
}

/* ============================================================================
 * SECTION 2 – STATION XML PARSER
 *
 * Converts a Station Configuration XML document into a compact JSON object
 * of the form:
 *
 *   {
 *     "type": "station_config",
 *     "station_count": N,
 *     "stations": [
 *       {
 *         "id":        "...",
 *         "name":      "...",
 *         "type":      "...",
 *         "km_post":   "...",
 *         "section":   "...",
 *         "lat":       "...",
 *         "lon":       "...",
 *         "signals":   [ { "id":"...", "type":"...", "aspect":"..." }, ... ],
 *         "points":    [ { "id":"...", "normal":"...", "status":"..." }, ... ]
 *       },
 *       ...
 *     ]
 *   }
 * ============================================================================ */

int parse_station_xml(const char *xml, char *out_json, int out_len)
{
    if (!xml || !out_json || out_len < 64) return -1;

    int pos = 0;
    if (buf_append(out_json, &pos, out_len,
                   "{\"type\":\"station_config\",\"stations\":[") < 0)
        return -1;

    const char *cursor = xml;
    int station_count  = 0;

    while (1) {
        /* Locate next <Station ...> opening tag */
        const char *stag = strstr(cursor, "<Station");
        if (!stag) break;

        const char *stag_end = strchr(stag, '>');
        if (!stag_end) break;

        const char *etag = strstr(stag_end, "</Station>");
        if (!etag) break;

        /* --- Extract station element content --- */
        int content_len = (int)(etag - stag_end - 1);
        if (content_len < 0) content_len = 0;
        char *content = (char *)malloc(content_len + 1);
        if (!content) return -1;
        memcpy(content, stag_end + 1, content_len);
        content[content_len] = '\0';

        /* --- Extract opening tag (for attribute parsing) --- */
        int tag_attr_len = (int)(stag_end - stag) + 1;
        char *tag_attr   = (char *)malloc(tag_attr_len + 1);
        if (!tag_attr) { free(content); return -1; }
        memcpy(tag_attr, stag, tag_attr_len);
        tag_attr[tag_attr_len] = '\0';

        /* Station identity attributes */
        char id[64], name[128], type[32];
        get_attr(tag_attr, "id",   id,   sizeof(id));
        get_attr(tag_attr, "name", name, sizeof(name));
        get_attr(tag_attr, "type", type, sizeof(type));
        free(tag_attr);

        /* Station child elements */
        char km[32], section[64];
        get_tag_text(content, "KmPost",  km,      sizeof(km));
        get_tag_text(content, "Section", section, sizeof(section));

        /* Optional <Location lat="..." lon="..."/> attribute */
        char lat[32] = "", lon[32] = "";
        const char *loc = strstr(content, "<Location");
        if (loc) {
            const char *loc_end = strchr(loc, '>');
            if (loc_end) {
                int llen = (int)(loc_end - loc) + 1;
                char *ltag = (char *)malloc(llen + 1);
                if (ltag) {
                    memcpy(ltag, loc, llen);
                    ltag[llen] = '\0';
                    get_attr(ltag, "lat", lat, sizeof(lat));
                    get_attr(ltag, "lon", lon, sizeof(lon));
                    free(ltag);
                }
            }
        }

        /* --- Build signals JSON array --- */
        char signals_json[4096] = "[]";
        {
            const char *sig_block_end;
            const char *sig_block_start = find_tag(content, "Signals",
                                                    &sig_block_end);
            if (sig_block_start) {
                char sig_buf[4096];
                int  spos      = 0;
                int  first_sig = 1;
                sig_buf[spos++] = '[';

                const char *sc = sig_block_start;
                while (1) {
                    const char *stg = strstr(sc, "<Signal");
                    if (!stg || stg >= sig_block_end - (int)strlen("<Signal"))
                        break;

                    const char *stg_end = strchr(stg, '>');
                    if (!stg_end) break;

                    int slen = (int)(stg_end - stg) + 1;
                    char *sbuf = (char *)malloc(slen + 1);
                    if (!sbuf) break;
                    memcpy(sbuf, stg, slen);
                    sbuf[slen] = '\0';

                    char sid[32], stype[32], saspect[32];
                    get_attr(sbuf, "id",     sid,     sizeof(sid));
                    get_attr(sbuf, "type",   stype,   sizeof(stype));
                    get_attr(sbuf, "aspect", saspect, sizeof(saspect));
                    free(sbuf);

                    char eid[64], etype[64], easpect[64];
                    json_escape(sid,     eid,     sizeof(eid));
                    json_escape(stype,   etype,   sizeof(etype));
                    json_escape(saspect, easpect, sizeof(easpect));

                    if (!first_sig && spos < (int)sizeof(sig_buf) - 2)
                        sig_buf[spos++] = ',';
                    first_sig = 0;

                    spos += snprintf(sig_buf + spos,
                                     sizeof(sig_buf) - spos,
                                     "{\"id\":\"%s\",\"type\":\"%s\","
                                     "\"aspect\":\"%s\"}",
                                     eid, etype, easpect);
                    sc = stg_end + 1;
                }

                if (spos < (int)sizeof(sig_buf) - 2)
                    sig_buf[spos++] = ']';
                sig_buf[spos] = '\0';
                snprintf(signals_json, sizeof(signals_json), "%s", sig_buf);
            }
        }

        /* --- Build points JSON array --- */
        char points_json[4096] = "[]";
        {
            const char *pt_block_end;
            const char *pt_block_start = find_tag(content, "Points",
                                                   &pt_block_end);
            if (pt_block_start) {
                char pt_buf[4096];
                int  ppos    = 0;
                int  first_pt = 1;
                pt_buf[ppos++] = '[';

                const char *pc = pt_block_start;
                while (1) {
                    const char *ptg = strstr(pc, "<Point");
                    if (!ptg || ptg >= pt_block_end - (int)strlen("<Point"))
                        break;

                    const char *ptg_end = strchr(ptg, '>');
                    if (!ptg_end) break;

                    int plen = (int)(ptg_end - ptg) + 1;
                    char *pbuf = (char *)malloc(plen + 1);
                    if (!pbuf) break;
                    memcpy(pbuf, ptg, plen);
                    pbuf[plen] = '\0';

                    char pid[32], pnormal[32], pstatus[32];
                    get_attr(pbuf, "id",     pid,     sizeof(pid));
                    get_attr(pbuf, "normal", pnormal, sizeof(pnormal));
                    get_attr(pbuf, "status", pstatus, sizeof(pstatus));
                    free(pbuf);

                    char eid[64], enormal[64], estatus[64];
                    json_escape(pid,     eid,     sizeof(eid));
                    json_escape(pnormal, enormal, sizeof(enormal));
                    json_escape(pstatus, estatus, sizeof(estatus));

                    if (!first_pt && ppos < (int)sizeof(pt_buf) - 2)
                        pt_buf[ppos++] = ',';
                    first_pt = 0;

                    ppos += snprintf(pt_buf + ppos,
                                     sizeof(pt_buf) - ppos,
                                     "{\"id\":\"%s\",\"normal\":\"%s\","
                                     "\"status\":\"%s\"}",
                                     eid, enormal, estatus);
                    pc = ptg_end + 1;
                }

                if (ppos < (int)sizeof(pt_buf) - 2)
                    pt_buf[ppos++] = ']';
                pt_buf[ppos] = '\0';
                snprintf(points_json, sizeof(points_json), "%s", pt_buf);
            }
        }

        free(content);

        /* JSON-escape all string values before embedding */
        char eid[128], ename[256], etype[64], ekm[64], esec[128];
        json_escape(id,      eid,   sizeof(eid));
        json_escape(name,    ename, sizeof(ename));
        json_escape(type,    etype, sizeof(etype));
        json_escape(km,      ekm,   sizeof(ekm));
        json_escape(section, esec,  sizeof(esec));

        if (station_count > 0)
            if (buf_append(out_json, &pos, out_len, ",") < 0) return -1;

        if (buf_append(out_json, &pos, out_len,
                       "{\"id\":\"%s\",\"name\":\"%s\",\"type\":\"%s\","
                       "\"km_post\":\"%s\",\"section\":\"%s\","
                       "\"lat\":\"%s\",\"lon\":\"%s\","
                       "\"signals\":%s,\"points\":%s}",
                       eid, ename, etype, ekm, esec,
                       lat[0] ? lat : "0",
                       lon[0] ? lon : "0",
                       signals_json, points_json) < 0)
            return -1;

        station_count++;
        cursor = etag + strlen("</Station>");
    }

    if (buf_append(out_json, &pos, out_len,
                   "],\"station_count\":%d}", station_count) < 0)
        return -1;

    return 0;
}

/* ============================================================================
 * SECTION 3 – STORYBOARD XML PARSER
 *
 * Parses an OpenSCENARIO-style StoryBoard XML document and returns JSON:
 *
 *   {
 *     "type":    "storyboard",
 *     "name":    "...",
 *     "version": "...",
 *     "meta": { "author":"...", "date":"...", "description":"..." },
 *     "story_count": N,
 *     "stories": [
 *       {
 *         "name": "...",
 *         "act_count": N,
 *         "acts": [
 *           {
 *             "name": "...",
 *             "event_count": N,
 *             "events": [
 *               {
 *                 "name":     "...",
 *                 "priority": "...",
 *                 "speed_action": {
 *                   "value": "...", "unit": "...", "shape": "..."
 *                 },
 *                 "trigger_condition": {
 *                   "name": "...", "value": "...", "rule": "..."
 *                 }
 *               },
 *               ...
 *             ]
 *           },
 *           ...
 *         ]
 *       },
 *       ...
 *     ]
 *   }
 * ============================================================================ */

int parse_storyboard_xml(const char *xml, char *out_json, int out_len)
{
    if (!xml || !out_json || out_len < 64) return -1;

    int pos = 0;

    /* Extract StoryBoard-level attributes */
    char board_name[128] = "", board_version[32] = "";
    const char *sb_tag = strstr(xml, "<StoryBoard");
    if (sb_tag) {
        const char *sb_end = strchr(sb_tag, '>');
        if (sb_end) {
            int tlen  = (int)(sb_end - sb_tag) + 1;
            char *tbuf = (char *)malloc(tlen + 1);
            if (tbuf) {
                memcpy(tbuf, sb_tag, tlen);
                tbuf[tlen] = '\0';
                get_attr(tbuf, "name",    board_name,    sizeof(board_name));
                get_attr(tbuf, "version", board_version, sizeof(board_version));
                free(tbuf);
            }
        }
    }

    /* Extract <Meta> child elements */
    char meta_author[128] = "", meta_date[32] = "", meta_desc[256] = "";
    {
        const char *meta_end;
        const char *meta = find_tag(xml, "Meta", &meta_end);
        if (meta) {
            int mlen = meta_end
                       ? (int)(meta_end - strlen("</Meta>") - meta)
                       : 0;
            char meta_content[1024];
            if (mlen > 0 && mlen < (int)sizeof(meta_content)) {
                memcpy(meta_content, meta, mlen);
                meta_content[mlen] = '\0';
                get_tag_text(meta_content, "Author",      meta_author,
                             sizeof(meta_author));
                get_tag_text(meta_content, "Date",        meta_date,
                             sizeof(meta_date));
                get_tag_text(meta_content, "Description", meta_desc,
                             sizeof(meta_desc));
            }
        }
    }

    /* Emit JSON header */
    char en[256], ev[64], ea[128], ed[512];
    json_escape(board_name,    en, sizeof(en));
    json_escape(board_version, ev, sizeof(ev));
    json_escape(meta_author,   ea, sizeof(ea));
    json_escape(meta_desc,     ed, sizeof(ed));

    if (buf_append(out_json, &pos, out_len,
                   "{\"type\":\"storyboard\","
                   "\"name\":\"%s\",\"version\":\"%s\","
                   "\"meta\":{\"author\":\"%s\",\"date\":\"%s\","
                   "\"description\":\"%s\"},"
                   "\"stories\":[",
                   en, ev, ea, meta_date, ed) < 0)
        return -1;

    const char *cursor = xml;
    int story_count    = 0;

    while (1) {
        const char *stag = strstr(cursor, "<Story");
        if (!stag) break;

        const char *stag_gt = strchr(stag, '>');
        if (!stag_gt) break;

        const char *etag = strstr(stag_gt, "</Story>");
        if (!etag) break;

        /* Story name */
        int sname_len = (int)(stag_gt - stag) + 1;
        char *snbuf   = (char *)malloc(sname_len + 1);
        if (!snbuf) break;
        memcpy(snbuf, stag, sname_len);
        snbuf[sname_len] = '\0';

        char story_name[128];
        get_attr(snbuf, "name", story_name, sizeof(story_name));
        free(snbuf);

        /* Story content */
        int content_len = (int)(etag - stag_gt - 1);
        if (content_len < 0) content_len = 0;
        char *story_content = (char *)malloc(content_len + 1);
        if (!story_content) break;
        memcpy(story_content, stag_gt + 1, content_len);
        story_content[content_len] = '\0';

        /* Build acts array */
        char acts_buf[16384];
        int  apos      = 0;
        int  act_count = 0;
        acts_buf[apos++] = '[';

        const char *acur = story_content;
        while (1) {
            const char *atag = strstr(acur, "<Act");
            if (!atag) break;

            const char *atag_gt = strchr(atag, '>');
            if (!atag_gt) break;

            const char *aetag = strstr(atag_gt, "</Act>");
            if (!aetag) break;

            /* Act name */
            int alen    = (int)(atag_gt - atag) + 1;
            char *anbuf = (char *)malloc(alen + 1);
            if (!anbuf) break;
            memcpy(anbuf, atag, alen);
            anbuf[alen] = '\0';

            char act_name[128];
            get_attr(anbuf, "name", act_name, sizeof(act_name));
            free(anbuf);

            /* Act content */
            int aclen = (int)(aetag - atag_gt - 1);
            if (aclen < 0) aclen = 0;
            char *act_content = (char *)malloc(aclen + 1);
            if (!act_content) break;
            memcpy(act_content, atag_gt + 1, aclen);
            act_content[aclen] = '\0';

            /* Build events array */
            char events_buf[8192];
            int  epos        = 0;
            int  event_count = 0;
            events_buf[epos++] = '[';

            const char *ecur = act_content;
            while (1) {
                const char *evtag = strstr(ecur, "<Event");
                if (!evtag) break;

                const char *evtag_gt = strchr(evtag, '>');
                if (!evtag_gt) break;

                const char *evetag = strstr(evtag_gt, "</Event>");
                if (!evetag) break;

                /* Event attributes */
                int evlen    = (int)(evtag_gt - evtag) + 1;
                char *evbuf  = (char *)malloc(evlen + 1);
                if (!evbuf) break;
                memcpy(evbuf, evtag, evlen);
                evbuf[evlen] = '\0';

                char ev_name[128], ev_prio[64];
                get_attr(evbuf, "name",     ev_name, sizeof(ev_name));
                get_attr(evbuf, "priority", ev_prio, sizeof(ev_prio));
                free(evbuf);

                /* SpeedActionDynamics attributes */
                char speed_val[32]   = "";
                char speed_unit[32]  = "";
                char speed_shape[32] = "";
                const char *spd = strstr(evtag_gt, "<SpeedActionDynamics");
                if (spd && spd < evetag) {
                    const char *spd_end = strchr(spd, '>');
                    if (spd_end) {
                        int slen    = (int)(spd_end - spd) + 1;
                        char *spdbuf = (char *)malloc(slen + 1);
                        if (spdbuf) {
                            memcpy(spdbuf, spd, slen);
                            spdbuf[slen] = '\0';
                            get_attr(spdbuf, "value",
                                     speed_val,   sizeof(speed_val));
                            get_attr(spdbuf, "dynamicsUnit",
                                     speed_unit,  sizeof(speed_unit));
                            get_attr(spdbuf, "dynamicsShape",
                                     speed_shape, sizeof(speed_shape));
                            free(spdbuf);
                        }
                    }
                }

                /* Trigger condition */
                char cond_name[128] = "", cond_val[64] = "", cond_rule[64] = "";
                const char *cond = strstr(evtag_gt, "<Condition");
                if (cond && cond < evetag) {
                    const char *cond_end = strchr(cond, '>');
                    if (cond_end) {
                        int clen      = (int)(cond_end - cond) + 1;
                        char *condbuf = (char *)malloc(clen + 1);
                        if (condbuf) {
                            memcpy(condbuf, cond, clen);
                            condbuf[clen] = '\0';
                            get_attr(condbuf, "name", cond_name,
                                     sizeof(cond_name));
                            free(condbuf);
                        }
                    }
                }
                const char *stc = strstr(evtag_gt, "<SimulationTimeCondition");
                if (stc && stc < evetag) {
                    const char *stc_end = strchr(stc, '>');
                    if (stc_end) {
                        int slen     = (int)(stc_end - stc) + 1;
                        char *stcbuf = (char *)malloc(slen + 1);
                        if (stcbuf) {
                            memcpy(stcbuf, stc, slen);
                            stcbuf[slen] = '\0';
                            get_attr(stcbuf, "value", cond_val,
                                     sizeof(cond_val));
                            get_attr(stcbuf, "rule",  cond_rule,
                                     sizeof(cond_rule));
                            free(stcbuf);
                        }
                    }
                }

                /* JSON-escape all string values */
                char een[256], eep[128], esv[64], esu[64], ess[64];
                char ecn[256], ecv[64], ecr[64];
                json_escape(ev_name,    een, sizeof(een));
                json_escape(ev_prio,    eep, sizeof(eep));
                json_escape(speed_val,  esv, sizeof(esv));
                json_escape(speed_unit, esu, sizeof(esu));
                json_escape(speed_shape,ess, sizeof(ess));
                json_escape(cond_name,  ecn, sizeof(ecn));
                json_escape(cond_val,   ecv, sizeof(ecv));
                json_escape(cond_rule,  ecr, sizeof(ecr));

                if (event_count > 0 && epos < (int)sizeof(events_buf) - 2)
                    events_buf[epos++] = ',';

                epos += snprintf(events_buf + epos,
                                 sizeof(events_buf) - epos,
                                 "{\"name\":\"%s\",\"priority\":\"%s\","
                                 "\"speed_action\":{\"value\":\"%s\","
                                 "\"unit\":\"%s\",\"shape\":\"%s\"},"
                                 "\"trigger_condition\":{\"name\":\"%s\","
                                 "\"value\":\"%s\",\"rule\":\"%s\"}}",
                                 een, eep, esv, esu, ess,
                                 ecn, ecv, ecr);

                event_count++;
                ecur = evetag + strlen("</Event>");
            }

            if (epos < (int)sizeof(events_buf) - 2)
                events_buf[epos++] = ']';
            events_buf[epos] = '\0';
            free(act_content);

            char ean[256];
            json_escape(act_name, ean, sizeof(ean));

            if (act_count > 0 && apos < (int)sizeof(acts_buf) - 2)
                acts_buf[apos++] = ',';

            apos += snprintf(acts_buf + apos, sizeof(acts_buf) - apos,
                             "{\"name\":\"%s\",\"event_count\":%d,"
                             "\"events\":%s}",
                             ean, event_count, events_buf);
            act_count++;
            acur = aetag + strlen("</Act>");
        }

        if (apos < (int)sizeof(acts_buf) - 2)
            acts_buf[apos++] = ']';
        acts_buf[apos] = '\0';
        free(story_content);

        char esn[256];
        json_escape(story_name, esn, sizeof(esn));

        if (story_count > 0)
            if (buf_append(out_json, &pos, out_len, ",") < 0) return -1;

        if (buf_append(out_json, &pos, out_len,
                       "{\"name\":\"%s\",\"act_count\":%d,\"acts\":%s}",
                       esn, act_count, acts_buf) < 0)
            return -1;

        story_count++;
        cursor = etag + strlen("</Story>");
    }

    if (buf_append(out_json, &pos, out_len,
                   "],\"story_count\":%d}", story_count) < 0)
        return -1;

    return 0;
}

/* ============================================================================
 * SECTION 4 – BIT-STREAM WRITER
 *
 * Provides MSB-first bit-level packing into a fixed-size byte buffer.
 * This is the fundamental primitive used by all Annexure-C packet encoders.
 *
 * Maximum packet size supported: 1024 bytes = 8192 bits.
 * The largest packet type (PKT_TYPE 9) is bounded by sub-packet size;
 * in practice no TCAS packet exceeds ~64 bytes, so 1024 bytes is safe.
 * ============================================================================ */

/** BitWriter – maintains a byte buffer and a current bit position. */
typedef struct {
    uint8_t buf[1024]; /**< Packed byte output buffer                     */
    int     bit_pos;   /**< Next bit to write (0 = MSB of first byte)     */
} BitWriter;

/**
 * bw_init() – zero the buffer and reset bit position.
 *
 * MUST be called before using a BitWriter for a new packet.
 */
static void bw_init(BitWriter *bw)
{
    memset(bw->buf, 0, sizeof(bw->buf));
    bw->bit_pos = 0;
}

/**
 * bw_write() – write the low-order 'nbits' bits of 'value', MSB first.
 *
 * @bw    : target BitWriter
 * @value : unsigned value to write (bits above nbits are ignored)
 * @nbits : number of bits to write (1..64)
 *
 * Example: bw_write(bw, 0x3, 2) writes binary "11".
 *
 * SIL-4 note: The loop writes one bit per iteration to avoid any
 * possibility of misaligned word writes, ensuring correct behaviour
 * regardless of host endianness.
 */
static void bw_write(BitWriter *bw, uint64_t value, int nbits)
{
    for (int i = nbits - 1; i >= 0; i--) {
        int byte_idx = bw->bit_pos / 8;
        int bit_idx  = 7 - (bw->bit_pos % 8);  /* MSB-first within byte */

        if ((value >> i) & 1ULL)
            bw->buf[byte_idx] |= (uint8_t)(1u << bit_idx);

        bw->bit_pos++;
    }
}

/**
 * bw_write_signed() – write a signed integer value as 2's-complement, MSB first.
 *
 * @bw    : target BitWriter
 * @value : signed value (e.g. distPktStart which may be negative)
 * @nbits : field width in bits (value is masked to this width)
 */
static void bw_write_signed(BitWriter *bw, int64_t value, int nbits)
{
    /*
     * Cast to uint64 with masking: for nbits < 64, mask off upper bits so
     * negative values are correctly represented as 2's complement within
     * the declared field width.
     */
    uint64_t mask = (nbits < 64) ? (((uint64_t)1 << nbits) - 1ULL)
                                 : (uint64_t)-1ULL;
    bw_write(bw, (uint64_t)(value) & mask, nbits);
}

/**
 * bw_byte_len() – return the number of bytes used (rounded up from bits).
 */
static int bw_byte_len(const BitWriter *bw)
{
    return (bw->bit_pos + 7) / 8;
}

/**
 * bw_backfill_7bit() – write a 7-bit value at a previously-reserved position.
 *
 * Used to back-fill the SUB_PKT_LENGTH field in PKT_TYPE 9 after the
 * sub-packet content is known.
 *
 * @bw      : target BitWriter
 * @bit_pos : bit position (inclusive start) of the 7-bit field to overwrite
 * @val7    : 7-bit value to write (high bits are ignored)
 */
static void bw_backfill_7bit(BitWriter *bw, int bit_pos, uint8_t val7)
{
    for (int i = 6; i >= 0; i--) {
        int bpos   = bit_pos + (6 - i);
        int byte_i = bpos / 8;
        int bit_i  = 7 - (bpos % 8);

        if ((val7 >> i) & 1u)
            bw->buf[byte_i] |=  (uint8_t)(1u << bit_i);
        else
            bw->buf[byte_i] &= ~(uint8_t)(1u << bit_i);
    }
}

/* ============================================================================
 * SECTION 4B – PKT_CRC RESOLUTION  (STORYBOARD-DRIVEN, VALID-OR-FORCED)
 *
 * The Annexure-C CRC column (CSV col 34 / src[27]) has two meanings:
 *
 *   • CSV value == 0   → the storyboard author left CRC unset. SVK SIM
 *                        computes a genuine, standards-valid CRC-32 over
 *                        every byte written to the packet so far (header +
 *                        body + CBC_MAC, i.e. everything preceding the
 *                        PKT_CRC field itself) and encodes THAT value.
 *                        This is the "auto-CRC" / valid-packet path.
 *
 *   • CSV value != 0   → the storyboard author deliberately supplied a
 *                        CRC value (valid or intentionally wrong). SVK SIM
 *                        encodes that value verbatim, unmodified. This is
 *                        the CRC-FAIL test-vector path — it lets a
 *                        storyboard intentionally exercise a receiver's
 *                        "LOG / CRC VERIFY" rejection logic.
 *
 * The CRC-32 algorithm used is the project's confirmed "CRC-32 IEEE
 * (Custom MISRA-C Compatible)" variant:
 *   Polynomial          : 0x04C11DB7   (reflected form 0xEDB88320)
 *   Initial value        : 0x00000000
 *   Final XOR             : 0x00000000
 *   Input reflected       : true
 *   Result reflected      : true
 * This matches the reference calculate_crc32_ieee() implementation used
 * by the "LOG / CRC VERIFY" checker on the decode side byte-for-byte, so
 * a packet SVK SIM marks valid will also verify as valid there, and a
 * packet with a deliberately-wrong CSV CRC will correctly fail there.
 * ============================================================================ */

static uint32_t g_crc32_table[256];
static int      g_crc32_table_ready = 0;

/** crc32_init_table() – build the standard reflected CRC-32 lookup table. */
static void crc32_init_table(void)
{
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++)
            c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        g_crc32_table[i] = c;
    }
    g_crc32_table_ready = 1;
}

/**
 * crc32_calc() – CRC-32 IEEE, MISRA-C compatible variant, over a byte buffer.
 *
 * Init = 0x00000000, Final XOR = 0x00000000 (NOT the zlib/PKZIP variant,
 * which XORs with 0xFFFFFFFF at both ends) — matches the reference Python
 * calculate_crc32_ieee() used by the decode-side "LOG / CRC VERIFY" checker.
 *
 * @data : pointer to the bytes to checksum
 * @len  : number of bytes
 *
 * Returns the 32-bit CRC value, ready to encode as-is.
 */
static uint32_t crc32_calc(const uint8_t *data, size_t len)
{
    if (!g_crc32_table_ready) crc32_init_table();

    uint32_t crc = 0x00000000u;
    for (size_t i = 0; i < len; i++)
        crc = (crc >> 8) ^ g_crc32_table[(crc ^ data[i]) & 0xFFu];
    return crc;
}

/**
 * resolve_pkt_crc() – decide the 32-bit value to encode into PKT_CRC.
 *
 * Call this AFTER every other field of the packet (including CBC_MAC, if
 * present) has been written to @bw, and BEFORE writing the PKT_CRC field
 * itself — @bw->bit_pos at that point must be byte-aligned (true for every
 * Annexure-C packet type; each encoder's total bit length is a multiple
 * of 8), so bw->bit_pos/8 gives the exact byte count to checksum.
 *
 * @bw        : BitWriter holding everything written so far for this packet
 * @csv_crc   : raw CRC value taken from the storyboard CSV (col 34 / v[34])
 *
 * Returns the value to bw_write() into the 32-bit PKT_CRC field:
 *   csv_crc == 0  → freshly computed, standards-valid CRC-32
 *   csv_crc != 0  → csv_crc, unmodified (intentional pass-through)
 */
static uint32_t resolve_pkt_crc(const BitWriter *bw, long long csv_crc)
{
    if ((uint32_t)csv_crc == 0)
        return crc32_calc(bw->buf, (size_t)(bw->bit_pos / 8));
    return (uint32_t)csv_crc;
}

/* ============================================================================
 * SECTION 4C – OTA START-OF-FRAME PREFIX  (Annexure-C §C.3.2.12)
 *
 * Per RDSO/SPN/196/2020 Annexure-C, clause C.3.2.12:
 *
 *   "When Radio1 is transmitting, the prefix '0xF1 0xA5 0xC3' must be
 *    added as Start of frame. When Radio2 is transmitting, the prefix
 *    '0xF2 0xA5 0xC3' must be added as Start of frame."
 *
 * This is modem-level OTA framing, NOT part of the KAVACH packet itself
 * (PKT_TYPE .. PKT_CRC). It sits *outside* the encoded packet and is never
 * included in any CRC/MAC computation — those are computed only over the
 * encoded packet bytes (see resolve_pkt_crc() above), exactly as before.
 * Kept as a separate, self-contained section for that reason: it must
 * never be woven into dispatch_encode()/encode_pktN(), which remain the
 * sole owners of Annexure-C packet-field encoding (SIL-4 boundary).
 * ============================================================================ */

/**
 * ota_frame_prefix() – build the 3-byte "Start of Frame" prefix for the
 * physical radio unit that is about to transmit.
 *
 * @radio_id : 1 (Radio1) or 2 (Radio2) — which physical radio is keying up
 * @out3     : caller-supplied 3-byte buffer to receive the prefix
 *
 * Returns 0 on success, -1 if radio_id is not 1 or 2 (out3 left untouched).
 */
static int ota_frame_prefix(int radio_id, uint8_t out3[3])
{
    if (radio_id == 1)      out3[0] = 0xF1;
    else if (radio_id == 2) out3[0] = 0xF2;
    else                     return -1;

    out3[1] = 0xA5;
    out3[2] = 0xC3;
    return 0;
}

/**
 * ota_prefix_hex() – convenience wrapper: same as ota_frame_prefix() but
 * returns the 3 bytes as a 6-char uppercase hex string (7 bytes incl NUL).
 * Exposed to Python (see svk_ota_prefix_hex export near the bottom of this
 * file) so any TX path that writes raw bytes from Python/main.py — e.g. a
 * serial/UHF modem writer — can fetch the exact same prefix used here
 * instead of hard-coding "F1A5C3"/"F2A5C3" a second time.
 *
 * @radio_id : 1 or 2
 * @out7     : caller-supplied buffer, at least 7 bytes
 *
 * Returns 0 on success, -1 if radio_id is invalid.
 */
static int ota_prefix_hex(int radio_id, char out7[7])
{
    uint8_t p[3];
    if (ota_frame_prefix(radio_id, p) != 0) return -1;
    sprintf(out7, "%02X%02X%02X", p[0], p[1], p[2]);
    return 0;
}

/* ============================================================================
 * SECTION 5 – CSV ROW PARSER
 *
 * The TCAS StoryBoard CSV has exactly 35 data columns (indices 0–34).
 * Lines beginning with '#' (after optional leading whitespace) are comments
 * and are always silently skipped.  This handles:
 *
 *   #,TimeLost Interval,,2,...          – scenario metadata comment
 *   #TDMASlot,pktType,...               – column-header comment
 *   #,,,,,,...                          – blank separator comment
 *
 * Any line with fewer than CSV_MIN_COLS parsed integers is discarded.
 * ============================================================================ */

/*
 * Two storyboard CSV formats are supported:
 *
 * FORMAT A — 35 columns (standard S2L PKT9 storyboard, Annexure-C §C.4.2)
 *   Col layout is the canonical one used by all encoder functions (v[0]..v[34]).
 *
 * FORMAT B — 28 columns (L2S PKT10/13 onboard storyboard)
 *   Header: TDMASlot,PktType,PktLen,Frame#,LocoID,ver,AbsLoc,L_DO,L_DU,
 *           TrnInt,TrnLen,TrnSpeed,DoM,SoS,Mode,lastReadTag,TagDup,
 *           TagLinkInfo,TIN,Brake,NewMAReply,lastRefProfId,SigOV,
 *           Info-Ack,Spare,LocoHealth,CBCMAC,CRC
 *
 *   The 28-column row is remapped into the 35-column v[] array so that
 *   encode_pkt10() / encode_pkt13() see the fields at the indices they
 *   expect.  Unused fields are left as 0.
 *
 *   Remapping (28-col source → 35-col v[] destination):
 *     src[0]  TDMASlot        → v[0]   TDMASlot
 *     src[1]  PktType         → v[1]   pktType
 *     src[2]  PktLen          → v[2]   pktLen
 *     src[3]  Frame#          → v[3]   frameNum  (grouping key only)
 *     src[4]  LocoID          → v[6]   locoId
 *     src[5]  ver             → v[5]   srcStnVer / locoVer
 *     src[6]  AbsLoc          → v[9]   distPktStart (closest available)
 *     src[7]  L_DO            → v[7]   (unused by pkt10/13, kept for debug)
 *     src[8]  L_DU            → v[8]   lastRefRfid
 *     src[9]  TrnInt          → (no direct mapping, stored at v[2] spare)
 *     src[10] TrnLen          → (no direct mapping – zero in pkt10 encoder)
 *     src[11] TrnSpeed        → v[21]  authSpeed / TRAIN_SPEED
 *     src[12] DoM             → v[10]  pktDir / MOVEMENT_DIR
 *     src[13] SoS             → v[14]  sos / EMERGENCY_STATUS
 *     src[14] Mode            → v[15]  secType / LOCO_MODE
 *     src[15] lastReadTag     → v[8]   lastRefRfid (overrides L_DU above)
 *     src[16] TagDup          → (zero – pkt10 always encodes 0 here)
 *     src[17] TagLinkInfo     → (zero)
 *     src[18] TIN             → (zero)
 *     src[19] Brake           → (zero)
 *     src[20] NewMAReply      → (zero)
 *     src[21] lastRefProfId   → v[7]   refProfNum
 *     src[22] SigOV           → (zero)
 *     src[23] Info-Ack        → (zero)
 *     src[24] Spare           → (zero)
 *     src[25] LocoHealth      → (zero)
 *     src[26] CBCMAC          → v[33]  cbcMac
 *     src[27] CRC             → v[34]  crc
 */
#define CSV_MIN_COLS_35  35   /**< Standard 35-column Annexure-C storyboard   */
#define CSV_MIN_COLS_28  28   /**< 28-column L2S PKT10/13 onboard storyboard  */
#define CSV_COLS_ACCREQ_19  19 /**< 19-col compact Access Request storyboard
                                 *   (e.g. "NOVA_StoryBoard_-_AccReq_for_SKP.csv") */
#define CSV_COLS_ACCAUTH_15 15 /**< 15-col compact Access Authority storyboard
                                 *   (e.g. "NOVA_StoryBoard_-_AccAuth_for_SKP.csv") */
#define CSV_COLS_ADDEMER_10 10 /**< 10-col compact Additional Emergency Packet
                                 *   storyboard, PKT_TYPE 12 only (e.g.
                                 *   "NOVA_StoryBoard_-_SKP_Additional_Emer.xlsx"):
                                 *   TDMASlot,PKT_TYPE,PKT_LENGTH,FRAME_NUM,
                                 *   SOURCE_STN_ILC_IBS_ID,SOURCE_STN_ILC_IBS_VERSION,
                                 *   STN_ILC_IBS_LOC,GEN_SOS_CALL,Padding bits,PKT_CRC */
#define CSV_MIN_COLS     CSV_COLS_ADDEMER_10  /**< Accept rows with at least this many columns —
                                 *   the narrowest of all five supported storyboard formats. */
#define MAX_COLS         56   /**< Guard against malformed over-wide rows.
                                 *   Raised from 48 -> 56 for v[41..51], the
                                 *   L2S (PKT10) fields of the 28-col onboard
                                 *   storyboard that have no canonical slot.
                                 *   Raised from 40 -> 48 to make room for v[35..40],
                                 *   the extra fields carried by the compact
                                 *   (10-col AddEmer / 15-col AccAuth / 19-col AccReq)
                                 *   formats that have no slot in the canonical
                                 *   35-col layout. */

/** CsvRow – parsed values and validity flag for one CSV data row. */
typedef struct {
    long long v[MAX_COLS]; /**< Parsed column values, remapped to 35-col layout */
    int       n;           /**< Number of raw columns parsed from the line      */
    int       valid;       /**< 1 = usable data row;  0 = comment/blank/error   */
    long long live_frame_num; /**< Annexure-C wall-clock TDMA frame number.
                               *   Set to 0 by parse_csv_row(); overridden by
                               *   transmit_storyboard_csv() at TX time.        */
    int       l2s_ext;     /**< 1 = row came from the 28-col L2S onboard
                               *   storyboard: encode_pkt10() reads its
                               *   extension slots v[35..37], v[41..51].   */
    long long route[4];    /**< ROUTE1..ROUTE4 — S.No index into the Track
                               *   Profile (APD) table loaded via
                               *   svk_load_track_profile(). 0 = no route in
                               *   that slot. See parse_csv_row() for why these
                               *   are captured separately from v[] instead of
                               *   reusing v[31..34] (route3/4 collide with the
                               *   CBCMAC/CRC re-anchoring below).             */
} CsvRow;

/**
 * remap_28col_to_35col() – convert a 28-column L2S onboard storyboard row
 * into the canonical 35-column v[] layout expected by all encoder functions.
 *
 * The raw[] array holds the 28 values as parsed directly from the CSV.
 * They are written into the v[] positions that encode_pkt10() and
 * encode_pkt13() actually read.  All other positions remain 0.
 */
static void remap_28col_to_35col(const long long raw[28], long long v[MAX_COLS])
{
    memset(v, 0, MAX_COLS * sizeof(long long));

    v[0]  = raw[0];   /* TDMASlot                                          */
    v[1]  = raw[1];   /* PktType                                           */
    v[2]  = raw[2];   /* PktLen                                            */
    v[3]  = raw[3];   /* Frame# (grouping key — not encoded in packet)     */
    v[5]  = raw[5];   /* ver → srcStnVer / SOURCE_LOCO_VER                 */
    v[6]  = raw[4];   /* LocoID → locoId / SOURCE_LOCO_ID                  */
    v[7]  = raw[21];  /* lastRefProfId → refProfNum / LAST_REF_PROFILE     */
    v[8]  = raw[15];  /* lastReadTag → lastRefRfid / LAST_RFID_TAG         */
    v[9]  = raw[6];   /* AbsLoc → distPktStart (closest field)             */
    v[10] = raw[12];  /* DoM → pktDir / MOVEMENT_DIR                      */
    v[14] = raw[13];  /* SoS → sos / EMERGENCY_STATUS                     */
    v[15] = raw[14];  /* Mode → secType / LOCO_MODE                       */
    v[21] = raw[11];  /* TrnSpeed → authSpeed / TRAIN_SPEED                */
    v[33] = raw[26];  /* CBCMAC                                            */
    v[34] = raw[27];  /* CRC                                               */

    /* Extension slots — every other C.4.3 field of the row, so encode_pkt10()
     * transmits what the storyboard says instead of 0 (same idea as the
     * 19-col AccReq remap; v[35..37] use the same meaning as there).        */
    v[35] = raw[6];   /* AbsLoc      → ABS_LOCO_LOC                        */
    v[36] = raw[10];  /* TrnLen      → TRAIN_LENGTH                        */
    v[37] = raw[18];  /* TIN         → TIN                                 */
    v[41] = raw[7];   /* L_DO        → L_DOUBTOVER                         */
    v[42] = raw[8];   /* L_DU        → L_DOUBTUNDER                        */
    v[43] = raw[9];   /* TrnInt      → TRAIN_INT                           */
    v[44] = raw[16];  /* TagDup      → TAG_DUP                             */
    v[45] = raw[17];  /* TagLinkInfo → TAG_LINK_INFO                       */
    v[46] = raw[19];  /* Brake       → Brake_Applied                       */
    v[47] = raw[20];  /* NewMAReply  → NEW_MA_REPLY                        */
    v[48] = raw[22];  /* SigOV       → SIG_OV                              */
    v[49] = raw[23];  /* Info-Ack    → Info_Ack                            */
    v[50] = raw[24];  /* Spare       → Spare                               */
    v[51] = raw[25];  /* LocoHealth  → Loco_Health_Status                  */
}

/**
 * remap_15col_accauth_to_35col() – convert a 15-column "Access Authority for
 * SKP" storyboard row (PKT_TYPE 11 only) into the canonical v[] layout.
 *
 * Source header (e.g. NOVA_StoryBoard_-_AccAuth_for_SKP.csv):
 *   TDMA Slot,pktType,pktLen,frameNum,srcStationId,srcStationVer,absLoc,
 *   locoId,upLinkFreq,dnLinkFreq,locoSlot,RS,stationSlot,MAC,CRC
 *
 * Fields with a slot in the canonical 35-col scheme are placed there so
 * encode_pkt11() keeps reading v[0]/v[4]/v[5]/v[6]/v[33]/v[34] unchanged.
 * Fields with NO canonical slot (absLoc, upLinkFreq, dnLinkFreq, locoSlot,
 * RS, stationSlot) are placed at v[35..40] — see encode_pkt11(), which now
 * reads them from there instead of hard-coding 0.
 *
 *   src[0]  TDMA Slot     -> v[0]  tdmaSlot   (on-air burst slot)
 *   src[1]  pktType       -> v[1]  pktType
 *   src[2]  pktLen        -> v[2]  pktLen
 *   src[3]  frameNum      -> v[3]  frameNum   (grouping key only)
 *   src[4]  srcStationId  -> v[4]  srcStnId
 *   src[5]  srcStationVer -> v[5]  srcStnVer
 *   src[6]  absLoc        -> v[35] STN_ILC_IBS_LOC
 *   src[7]  locoId        -> v[6]  locoId
 *   src[8]  upLinkFreq    -> v[36] Allotted_UpLink_Freq
 *   src[9]  dnLinkFreq    -> v[37] Allotted_DownLink_Freq
 *   src[10] locoSlot      -> v[38] Allotted_TDMA_Timeslot
 *   src[11] RS            -> v[39] STN_RND_NUM_RS
 *   src[12] stationSlot   -> v[40] STN_TDMA
 *   src[13] MAC           -> v[33] cbcMac / MAC_CODE
 *   src[14] CRC           -> v[34] crc  (0 = auto-generate, else pass-through)
 */
static void remap_15col_accauth_to_35col(const long long raw[15], long long v[MAX_COLS])
{
    memset(v, 0, MAX_COLS * sizeof(long long));

    v[0]  = raw[0];   /* TDMA Slot -> tdmaSlot                             */
    v[1]  = raw[1];   /* pktType                                           */
    v[2]  = raw[2];   /* pktLen                                            */
    v[3]  = raw[3];   /* frameNum (grouping key — not encoded in packet)   */
    v[4]  = raw[4];   /* srcStationId -> SOURCE_STN_ID                     */
    v[5]  = raw[5];   /* srcStationVer -> SOURCE_STN_VER                   */
    v[6]  = raw[7];   /* locoId -> DEST_LOCO_ID                            */
    v[33] = raw[13];  /* MAC -> MAC_CODE                                   */
    v[34] = raw[14];  /* CRC                                               */
    v[35] = raw[6];   /* absLoc -> STN_ILC_IBS_LOC                         */
    v[36] = raw[8];   /* upLinkFreq -> Allotted_UpLink_Freq                */
    v[37] = raw[9];   /* dnLinkFreq -> Allotted_DownLink_Freq              */
    v[38] = raw[10];  /* locoSlot -> Allotted_TDMA_Timeslot                */
    v[39] = raw[11];  /* RS -> STN_RND_NUM_RS                              */
    v[40] = raw[12];  /* stationSlot -> STN_TDMA                           */
}

/**
 * remap_10col_addemer_to_35col() – convert a 10-column "Additional Emergency
 * Packet" storyboard row (PKT_TYPE 12 only) into the canonical v[] layout.
 *
 * Source header (e.g. NOVA_StoryBoard_-_SKP_Additional_Emer.xlsx, §C.4.5):
 *   TDMASlot,PKT_TYPE,PKT_LENGTH,FRAME_NUM,SOURCE_STN_ILC_IBS_ID,
 *   SOURCE_STN_ILC_IBS_VERSION,STN_ILC_IBS_LOC,GEN_SOS_CALL,Padding bits,
 *   PKT_CRC
 *
 * Fields with a slot in the canonical 35-col scheme are placed there so
 * encode_pkt12() keeps reading v[4]/v[5]/v[14]/v[34] unchanged. STN_ILC_IBS_LOC
 * has no canonical slot, so it is placed at v[35] — the same extension slot
 * remap_15col_accauth_to_35col() uses for the identically-named field —
 * and encode_pkt12() now reads it from there instead of hard-coding 0.
 *
 *   src[0] TDMASlot                    -> v[0]  tdmaSlot
 *   src[1] PKT_TYPE                    -> v[1]  pktType
 *   src[2] PKT_LENGTH                  -> v[2]  pktLen
 *   src[3] FRAME_NUM                   -> v[3]  frameNum (grouping key only)
 *   src[4] SOURCE_STN_ILC_IBS_ID       -> v[4]  srcStnId / SOURCE_STN_ID
 *   src[5] SOURCE_STN_ILC_IBS_VERSION  -> v[5]  srcStnVer / SOURCE_STN_VER
 *   src[6] STN_ILC_IBS_LOC             -> v[35] STN_ILC_IBS_LOC
 *   src[7] GEN_SOS_CALL                -> v[14] sos / GEN_SOS_CALL
 *   src[8] Padding bits                -> (unused — encoder writes constant 0)
 *   src[9] PKT_CRC                     -> v[34] crc (0 = auto-generate, else pass-through)
 */
static void remap_10col_addemer_to_35col(const long long raw[10], long long v[MAX_COLS])
{
    memset(v, 0, MAX_COLS * sizeof(long long));

    v[0]  = raw[0];   /* TDMASlot                                          */
    v[1]  = raw[1];   /* PKT_TYPE                                          */
    v[2]  = raw[2];   /* PKT_LENGTH                                        */
    v[3]  = raw[3];   /* FRAME_NUM (grouping key — not encoded in packet)  */
    v[4]  = raw[4];   /* SOURCE_STN_ILC_IBS_ID -> SOURCE_STN_ID            */
    v[5]  = raw[5];   /* SOURCE_STN_ILC_IBS_VERSION -> SOURCE_STN_VER      */
    v[14] = raw[7];   /* GEN_SOS_CALL -> sos                               */
    v[34] = raw[9];   /* PKT_CRC                                           */
    v[35] = raw[6];   /* STN_ILC_IBS_LOC                                   */
}

/**
 * remap_19col_accreq_to_35col() – convert a 19-column "Access Request for
 * SKP" storyboard row (PKT_TYPE 13 only) into the canonical v[] layout.
 *
 * Source header (e.g. NOVA_StoryBoard_-_AccReq_for_SKP.csv):
 *   TDMASlot,PKT_TYPE,PKT_LENGTH,FRAME_NUM,SOURCE_LOCO_ID,
 *   SOURCE_LOCO_VERSION,ABS_LOCO_LOCATION,TRAIN_LENGTH,TRAIN_SPEED,
 *   MOVEMENT_DIR,EMERGENCY_STATUS,LOCO_MODE,apprStationId,LAST_Rear_TAG,
 *   TIN,Longitude,Latitude,RL,crc
 *
 * Fields with a slot in the canonical 35-col scheme (as already read by
 * encode_pkt13()) are placed there; apprStationId feeds v[4] because
 * encode_pkt13() encodes "srcStnId" (v[4]) into the Approaching_STN_ID
 * field for this packet type. Fields with no canonical slot (ABS_LOCO_LOC,
 * TRAIN_LENGTH, TIN, Longitude, Latitude, RL) go to v[35..40] — see
 * encode_pkt13(), which now reads them from there instead of hard-coding 0.
 *
 *   src[0]  TDMASlot            -> v[0]  tdmaSlot
 *   src[1]  PKT_TYPE            -> v[1]  pktType
 *   src[2]  PKT_LENGTH          -> v[2]  pktLen
 *   src[3]  FRAME_NUM           -> v[3]  frameNum (grouping key only)
 *   src[4]  SOURCE_LOCO_ID      -> v[6]  locoId / SOURCE_LOCO_ID
 *   src[5]  SOURCE_LOCO_VERSION -> v[5]  srcStnVer / SOURCE_LOCO_VER
 *   src[6]  ABS_LOCO_LOCATION   -> v[35] ABS_LOCO_LOC
 *   src[7]  TRAIN_LENGTH        -> v[36] TRAIN_LENGTH
 *   src[8]  TRAIN_SPEED         -> v[21] authSpeed / TRAIN_SPEED
 *   src[9]  MOVEMENT_DIR        -> v[10] pktDir / MOVEMENT_DIR
 *   src[10] EMERGENCY_STATUS    -> v[14] sos / EMERGENCY_STATUS
 *   src[11] LOCO_MODE           -> v[15] secType / LOCO_MODE
 *   src[12] apprStationId       -> v[4]  srcStnId / Approaching_STN_ID
 *   src[13] LAST_Rear_TAG       -> v[8]  lastRefRfid / LAST_RFID_TAG
 *   src[14] TIN                 -> v[37] TIN
 *   src[15] Longitude           -> v[38] Longitude
 *   src[16] Latitude            -> v[39] Latitude
 *   src[17] RL                  -> v[40] LOCO_RND_NUM_RL
 *   src[18] crc                 -> v[34] crc (0 = auto-generate, else pass-through)
 */
static void remap_19col_accreq_to_35col(const long long raw[19], long long v[MAX_COLS])
{
    memset(v, 0, MAX_COLS * sizeof(long long));

    v[0]  = raw[0];   /* TDMASlot                                          */
    v[1]  = raw[1];   /* PKT_TYPE                                          */
    v[2]  = raw[2];   /* PKT_LENGTH                                        */
    v[3]  = raw[3];   /* FRAME_NUM (grouping key — not encoded in packet)  */
    v[4]  = raw[12];  /* apprStationId -> Approaching_STN_ID               */
    v[5]  = raw[5];   /* SOURCE_LOCO_VERSION -> SOURCE_LOCO_VER            */
    v[6]  = raw[4];   /* SOURCE_LOCO_ID -> locoId                          */
    v[8]  = raw[13];  /* LAST_Rear_TAG -> lastRefRfid / LAST_RFID_TAG      */
    v[10] = raw[9];   /* MOVEMENT_DIR -> pktDir                            */
    v[14] = raw[10];  /* EMERGENCY_STATUS -> sos                           */
    v[15] = raw[11];  /* LOCO_MODE -> secType                              */
    v[21] = raw[8];   /* TRAIN_SPEED -> authSpeed                          */
    v[34] = raw[18];  /* crc                                               */
    v[35] = raw[6];   /* ABS_LOCO_LOCATION                                 */
    v[36] = raw[7];   /* TRAIN_LENGTH                                     */
    v[37] = raw[14];  /* TIN                                               */
    v[38] = raw[15];  /* Longitude                                         */
    v[39] = raw[16];  /* Latitude                                          */
    v[40] = raw[17];  /* RL -> LOCO_RND_NUM_RL                             */
}

/**
 * parse_csv_row() – parse one CSV line into a CsvRow.
 *
 * Accepts the 35-column standard storyboard, the 28-column L2S onboard
 * storyboard, the 19-column compact Access Request (PKT13) storyboard, the
 * 15-column compact Access Authority (PKT11) storyboard, and the 10-column
 * compact Additional Emergency Packet (PKT12) storyboard. Every compact/
 * onboard row is automatically remapped into the 35-column v[] layout (plus
 * v[35..40] extension slots where needed) so all downstream encoders work
 * unchanged.
 *
 * @line : NUL-terminated line string (no newline characters expected)
 *
 * Returns a CsvRow with .valid = 0 for comment/blank/malformed lines.
 */
static CsvRow parse_csv_row(const char *line)
{
    CsvRow row;
    memset(&row, 0, sizeof(row));
    row.live_frame_num = 0;

    /* Skip leading whitespace */
    while (*line == ' ' || *line == '\t') line++;

    /* Discard comment lines */
    if (*line == '#') return row;

    /* Discard blank lines */
    if (*line == '\0' || *line == '\r' || *line == '\n') return row;

    /* Parse all columns into a temporary raw buffer */
    long long raw[MAX_COLS];
    memset(raw, 0, sizeof(raw));
    const char *p = line;
    int col = 0;

    while (*p && *p != '\r' && *p != '\n' && col < MAX_COLS) {
        char *endp;
        raw[col] = strtoll(p, &endp, 10);
        col++;
        if (*endp == ',')
            p = endp + 1;
        else
            break;
    }

    row.n = col;

    if (col < CSV_MIN_COLS) {
        row.valid = 0;   /* fewer than 28 columns — discard */
        return row;
    }

    row.valid = 1;

    if (col >= CSV_MIN_COLS_35) {
        /*
         * Standard Format A storyboard — copy every parsed field directly,
         * THEN re-anchor CBC_MAC and PKT_CRC to the LAST TWO columns of
         * the row rather than trusting fixed indices 33/34.
         *
         * WHY THIS IS NECESSARY:
         * The canonical 35-column layout reserves v[31]/v[32] for
         * ROUTE1/ROUTE2 (confirmed unused by every encode_pktN() — grep
         * shows no encoder ever reads v[31] or v[32]), followed by
         * CBCMAC at v[33] and CRC at v[34]. Some storyboard exports widen
         * this to FOUR route columns (route1..route4) for readability,
         * producing 37 total columns. A blind 1:1 raw[i] -> v[i] copy
         * then silently reads ROUTE3/ROUTE4 (always 0 in every real
         * storyboard) into v[33]/v[34] instead of the real CBCMAC/CRC —
         * so resolve_pkt_crc() ALWAYS sees csv_crc == 0 and ALWAYS
         * auto-generates a valid CRC, even when the operator has
         * deliberately written a bad CRC into the CSV's real trailing
         * column. This silently defeats every CRC-FAIL test vector
         * without any error or warning.
         *
         * Anchoring to the last two parsed columns is robust to any
         * number of route columns (2, 4, or more) as long as the row
         * still ends "...,CBCMAC,CRC" — true for every known storyboard
         * export — and is fully backward-compatible with the plain
         * 35-column format (col-2 == 33, col-1 == 34, unchanged).
         */
        int i;
        for (i = 0; i < col && i < MAX_COLS; i++)
            row.v[i] = raw[i];
        row.v[33] = raw[col - 2];   /* CBCMAC — always second-to-last column */
        row.v[34] = raw[col - 1];   /* CRC    — always the last column       */

        /*
         * ROUTE1..ROUTE4 — captured from raw[] (BEFORE the CBCMAC/CRC
         * anchor above can clobber raw[33]/raw[34]'s positions in v[]).
         * Standard 35-col rows only have 2 route slots (v[31]/v[32]);
         * the 37-col route1..route4 export adds 2 more right before
         * CBCMAC/CRC. Either way they sit at raw[31..34], just with the
         * narrower format leaving raw[33]/raw[34] as the real CBCMAC/CRC
         * instead of route3/route4 — hence the col>=37 guard below.
         */
        /*
         * ROUTE1..ROUTE4 — captured from raw[] (BEFORE the CBCMAC/CRC
         * anchor above can clobber raw[33]/raw[34]'s positions in v[]).
         * Derived the same way the anchor above is: relative to the
         * confirmed-real CBCMAC/CRC at (col-2)/(col-1), so this is robust
         * to any number of route columns (2 in the plain 35-col format,
         * 4 in the wider "route1..route4" export) rather than assuming a
         * fixed 37-column width.
         */
        int n_route_cols = (col - 2) - 31;
        if (n_route_cols < 0) n_route_cols = 0;
        if (n_route_cols > 4) n_route_cols = 4;
        for (i = 0; i < 4; i++)
            row.route[i] = (i < n_route_cols) ? raw[31 + i] : 0;
    } else if (col >= CSV_MIN_COLS_28 && col < CSV_MIN_COLS_35) {
        /* 28-column L2S onboard format — remap to 35-col layout.
         * (Range, not exact match, to preserve the original tolerance for
         * a handful of extra/missing trailing columns in this format —
         * unlike the two newer 19/15-col formats below, which are matched
         * exactly since we own their definitions.) */
        remap_28col_to_35col(raw, row.v);
        row.l2s_ext = 1;
    } else if (col == CSV_COLS_ACCREQ_19) {
        /* 19-column compact Access Request (PKT13) storyboard — e.g.
         * "NOVA_StoryBoard_-_AccReq_for_SKP.csv" — remap to 35-col layout
         * (+ v[35..40] extension slots; see remap_19col_accreq_to_35col()). */
        long long raw19[19];
        memcpy(raw19, raw, sizeof(raw19));
        remap_19col_accreq_to_35col(raw19, row.v);
    } else if (col == CSV_COLS_ACCAUTH_15) {
        /* 15-column compact Access Authority (PKT11) storyboard — e.g.
         * "NOVA_StoryBoard_-_AccAuth_for_SKP.csv" — remap to 35-col layout
         * (+ v[35..40] extension slots; see remap_15col_accauth_to_35col()). */
        long long raw15[15];
        memcpy(raw15, raw, sizeof(raw15));
        remap_15col_accauth_to_35col(raw15, row.v);
    } else if (col == CSV_COLS_ADDEMER_10) {
        /* 10-column compact Additional Emergency Packet (PKT12) storyboard —
         * e.g. "NOVA_StoryBoard_-_SKP_Additional_Emer.xlsx" — remap to
         * 35-col layout (+ v[35] extension slot; see
         * remap_10col_addemer_to_35col()). */
        long long raw10[10];
        memcpy(raw10, raw, sizeof(raw10));
        remap_10col_addemer_to_35col(raw10, row.v);
    } else {
        /* Column count doesn't match any of the five known storyboard
         * formats (35+/37, 28, 19, 15, 10) — discard rather than guess, so a
         * malformed export fails loudly instead of silently mis-mapping
         * fields (and, worse, mis-anchoring the CRC column). */
        row.valid = 0;
        return row;
    }

    return row;
}

/* ============================================================================
 * SECTION 5B – Track Profile (APD) in-memory table + sub-packet lookup
 *
 * Loaded via svk_load_track_profile() from the '|'-delimited text
 * main.py's /svk/load_track_profile endpoint builds from the uploaded
 * .xlsx (one line per row):
 *     <S.No>|<PSR hex>|<Gradient hex>|<LC hex>|<Turnout hex>|<TLI hex>|<TCD hex>
 *
 * Each hex field is a fixed-width, zero-padded byte buffer as exported
 * from the workbook (confirmed against real sample data: e.g. a TLI
 * field "52 08 20 00 7c 83 21 f4 2f 07 d8 3e 9f 80 96 8b 20 00 00...00").
 * The REAL sub-packet occupies only the leading bytes; its length is
 * self-encoded in its own first two bytes, matching every other
 * self-describing sub-packet in this file (c.f. the MA sub-packet's own
 * SUB_PKT_LENGTH backfill in encode_pkt9()):
 *
 *   byte0 bits 7..4 = SUB_PKT_TYPE   (0xF = "no sub-packet" placeholder —
 *                                     confirmed by real data: every empty
 *                                     column in the sample sheet is
 *                                     "F0 00 00 00...")
 *   bits  byte0[3..0] ++ byte1[7..5] (7 bits, MSB-first) = SUB_PKT_LENGTH,
 *                                     encoded as (real_byte_length − 1) —
 *                                     the same convention encode_pkt9()
 *                                     already uses for the MA sub-packet.
 *
 * Verified against the user-supplied sample: PSR field "10 81 09 64 68
 * 00 00...". byte0=0x10 -> type=0x1; SUB_PKT_LENGTH = ((0x10&0xF)<<3) |
 * (0x81>>5) = 0|4 = 4 -> real length = 5 bytes = "10 81 09 64 68", which
 * matches the "+ 10 81 09 64 68 +" the user showed being concatenated
 * into a real decoded S2L packet just before its CRC.
 *
 * ORDER CAVEAT (please confirm): each sub-packet carries its own
 * type+length header, so a decoder that reads sub-packets sequentially
 * and checks each one's own type nibble will identify PSR/Gradient/LC/
 * Turnout/TLI/TCD correctly regardless of the order they're concatenated
 * in. I emit them in the order PSR, Gradient, LC, Turnout, TLI, TCD
 * (matching the order you originally described). If your on-air spec
 * fixes a different mandatory order, tell me and I'll change the
 * sequence below — it's one line to reorder, not a redesign.
 * ============================================================================ */

#define TRACK_PROFILE_MAX_ROWS   2048   /* Increased from 512 to support more APD/Track Profile rows */
#define TRACK_PROFILE_HEX_LEN    600   /* holds a 128-byte field as space-separated
                                         * hex text (128*3=384 chars) plus margin —
                                         * the sub-packet length field is 7 bits, so
                                         * a real field can legitimately be up to
                                         * 128 bytes (0..127 encoded, +1)             */
#define TRACK_PROFILE_SUBPKT_MAX 130   /* max decoded bytes per sub-packet field —
                                         * matches the 7-bit length field's max
                                         * real length of 128, plus margin           */

typedef struct {
    int  sno;
    char psr[TRACK_PROFILE_HEX_LEN];
    char gradient[TRACK_PROFILE_HEX_LEN];
    char lc[TRACK_PROFILE_HEX_LEN];
    char turnout[TRACK_PROFILE_HEX_LEN];
    char tli[TRACK_PROFILE_HEX_LEN];
    char tcd[TRACK_PROFILE_HEX_LEN];
} TrackProfileRow;

static TrackProfileRow g_track_profile[TRACK_PROFILE_MAX_ROWS];
static int             g_track_profile_count = 0;

/**
 * track_profile_copy_field() – copy one '|'-delimited field into @dst,
 * stopping at '|', '\n', '\r', or end of string. NUL-terminates @dst even
 * if the source field is longer than (dst_len - 1) (truncates safely).
 *
 * Returns a pointer to the character that stopped the copy (so the caller
 * can tell '|' from end-of-line/string).
 */
static const char *track_profile_copy_field(const char *src, char *dst, int dst_len)
{
    int i = 0;
    while (*src && *src != '|' && *src != '\n' && *src != '\r' && i < dst_len - 1) {
        dst[i++] = *src++;
    }
    dst[i] = '\0';
    /* Skip any remaining characters of an over-long field up to the delimiter */
    while (*src && *src != '|' && *src != '\n' && *src != '\r') src++;
    return src;
}

/**
 * svk_load_track_profile() – parse the '|'-delimited Track Profile text
 * described above and load it into g_track_profile[], replacing any
 * previously loaded table.
 *
 * @text : NUL-terminated text, one row per line:
 *           <S.No>|<PSR>|<Gradient>|<LC>|<Turnout>|<TLI>|<TCD>
 *
 * Malformed lines (missing S.No, non-numeric S.No, or a line producing
 * zero columns) are skipped rather than aborting the whole load, matching
 * the tolerant-parse style of parse_csv_row() elsewhere in this file.
 *
 * Returns the number of rows actually loaded (>= 0), or -1 if @text is
 * NULL.
 */
int svk_load_track_profile(const char *text)
{
    if (!text) return -1;

    g_track_profile_count = 0;
    const char *p = text;

    while (*p && g_track_profile_count < TRACK_PROFILE_MAX_ROWS) {
        /* Skip blank lines */
        if (*p == '\n' || *p == '\r') { p++; continue; }

        /* S.No column */
        char *endptr;
        long sno = strtol(p, &endptr, 10);
        if (endptr == p) {
            /* No leading number on this line — skip to next line */
            while (*p && *p != '\n') p++;
            if (*p == '\n') p++;
            continue;
        }
        p = endptr;
        if (*p == '|') p++;

        TrackProfileRow row;
        memset(&row, 0, sizeof(row));
        row.sno = (int)sno;

        p = track_profile_copy_field(p, row.psr,      TRACK_PROFILE_HEX_LEN);
        if (*p == '|') p++;
        p = track_profile_copy_field(p, row.gradient,  TRACK_PROFILE_HEX_LEN);
        if (*p == '|') p++;
        p = track_profile_copy_field(p, row.lc,        TRACK_PROFILE_HEX_LEN);
        if (*p == '|') p++;
        p = track_profile_copy_field(p, row.turnout,   TRACK_PROFILE_HEX_LEN);
        if (*p == '|') p++;
        p = track_profile_copy_field(p, row.tli,       TRACK_PROFILE_HEX_LEN);
        if (*p == '|') p++;
        p = track_profile_copy_field(p, row.tcd,       TRACK_PROFILE_HEX_LEN);

        g_track_profile[g_track_profile_count++] = row;

        /* Advance to next line */
        while (*p && *p != '\n') p++;
        if (*p == '\n') p++;
    }

    return g_track_profile_count;
}

/**
 * svk_track_profile_count() – number of rows currently held in the
 * in-memory Track Profile table (0 if none has been loaded yet).
 */
int svk_track_profile_count(void)
{
    return g_track_profile_count;
}

/**
 * track_profile_find() – look up a Track Profile row by S.No.
 * Returns a pointer into g_track_profile[], or NULL if not loaded.
 */
static const TrackProfileRow *track_profile_find(int sno)
{
    for (int i = 0; i < g_track_profile_count; i++)
        if (g_track_profile[i].sno == sno)
            return &g_track_profile[i];
    return NULL;
}

/**
 * track_profile_hex_to_bytes() – decode an ASCII hex string (bytes may be
 * space/comma-separated, as exported from the workbook, e.g.
 * "10 81 09 64 00 00") into raw bytes.
 *
 * Returns the number of bytes decoded (0 if the field is empty/unparsable).
 */
static int track_profile_hex_to_bytes(const char *s, uint8_t *out, int max_out)
{
    int n = 0;
    int hi = -1;
    for (; s && *s && n < max_out; s++) {
        char c = *s;
        int v;
        if (c >= '0' && c <= '9')      v = c - '0';
        else if (c >= 'a' && c <= 'f') v = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') v = c - 'A' + 10;
        else continue;   /* skip separators/whitespace */
        if (hi < 0) hi = v;
        else { out[n++] = (uint8_t)((hi << 4) | v); hi = -1; }
    }
    return n;
}

/**
 * track_profile_real_len() – decode the self-described real byte length
 * of a pre-packed sub-packet field (see SECTION 5B header comment for the
 * bit layout). Returns 0 if @n < 2 or the field's SUB_PKT_TYPE nibble is
 * 0xF ("no sub-packet" placeholder — nothing to append for this field).
 */
static int track_profile_real_len(const uint8_t *b, int n)
{
    if (n < 2) return 0;
    if ((b[0] >> 4) == 0xF) return 0;
    int len7 = ((b[0] & 0x0F) << 3) | (b[1] >> 5);
    int real_len = len7 + 1;
    if (real_len > n) real_len = n;
    return real_len;
}

/**
 * track_profile_append_route_subpackets() – for a storyboard row's
 * ROUTE1..ROUTE4 (r->route[0..3]), look up each referenced Track Profile
 * S.No and append the real (non-placeholder) bytes of its PSR / Gradient /
 * LC / Turnout / TLI / TCD sub-packet fields into @out, in that order.
 *
 * A route value of 0, or a route S.No that isn't in the loaded table, is
 * silently skipped (no Track Profile loaded yet, or that row's route
 * simply has nothing to attach — matches the tolerant style used
 * elsewhere in this file rather than failing the whole packet).
 *
 * Returns the total number of bytes written to @out.
 */
static int track_profile_append_route_subpackets(const CsvRow *r, uint8_t *out, int max_out)
{
    int total = 0;

    for (int ridx = 0; ridx < 4; ridx++) {
        long long sno = r->route[ridx];
        if (sno == 0) continue;

        const TrackProfileRow *tp = track_profile_find((int)sno);
        if (!tp) continue;   /* referenced S.No not in the loaded table */

        const char *fields[6] = { tp->psr, tp->gradient, tp->lc, tp->turnout, tp->tli, tp->tcd };

        for (int f = 0; f < 6; f++) {
            uint8_t raw[TRACK_PROFILE_SUBPKT_MAX];
            int n = track_profile_hex_to_bytes(fields[f], raw, sizeof(raw));
            int real_len = track_profile_real_len(raw, n);
            if (real_len <= 0) continue;
            if (total + real_len > max_out) return total;   /* safety guard */
            memcpy(out + total, raw, real_len);
            total += real_len;
        }
    }

    return total;
}

/* ============================================================================
 * SECTION 6 – UTILITY FUNCTIONS
 * ============================================================================ */

/**
 * bytes_to_hex() – convert a byte array to an uppercase hex string.
 *
 * @buf : source byte array
 * @n   : number of bytes
 * @out : destination string; must have space for at least (n*2 + 1) bytes
 */
static void bytes_to_hex(const uint8_t *buf, int n, char *out)
{
    for (int i = 0; i < n; i++)
        sprintf(out + i * 2, "%02X", buf[i]);
    out[n * 2] = '\0';
}

/**
 * sleep_until_next_2s_boundary() – busy-wait/sleep until the next 2-second
 * wall-clock boundary.
 *
 * In the StoryBoard, each unique frame number represents a 2-second epoch
 * (matching the TDMA superframe period of the TCAS radio link).  Before
 * transmitting the next frame group we sleep to the next 2-second boundary
 * so real-time pacing is accurate.
 *
 * Uses nanosleep() for POSIX compliance.
 */
static void sleep_until_next_2s_boundary(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);

    /*
     * Time within the current 2-second window (in nanoseconds):
     *   elapsed_ns = (now.tv_sec % 2) * 1e9 + now.tv_nsec
     * Remaining until next boundary:
     *   remain_ns  = 2e9 - elapsed_ns
     */
    long long elapsed_ns = (long long)(now.tv_sec % 2) * 1000000000LL
                           + (long long)now.tv_nsec;
    long long remain_ns  = 2000000000LL - elapsed_ns;

    if (remain_ns <= 0)
        remain_ns = 2000000000LL;   /* already on boundary; wait full 2s */

    struct timespec ts;
    ts.tv_sec  = (time_t)(remain_ns / 1000000000LL);
    ts.tv_nsec = (long)  (remain_ns % 1000000000LL);

    nanosleep(&ts, NULL);
}

/* ============================================================================
 * SECTION 7 – ANNEXURE-C PACKET ENCODERS
 *
 * Each encoder receives:
 *   @r  : pointer to a validated CsvRow with .n >= CSV_MIN_COLS
 *   @bw : pointer to a zero-initialised BitWriter
 *
 * Returns 0 on success, -1 on internal error.
 *
 * Field widths are annotated in comments for every bw_write() call so
 * engineers can verify them against the standard without reading code logic.
 * ============================================================================ */

/*
 * LIVE_FRAME_NUM() — compute the current Annexure-C TDMA FRAME_NUM.
 *
 * Per RDSO/SPN/196/2020 Annexure-C, FRAME_NUM must always be an ODD number.
 * Each 2-second TDMA epoch is identified by its start second:
 *   epoch 1 → second 1, epoch 3 → second 3, epoch 5 → second 5 …
 *
 * Formula: floor(seconds_since_midnight / 2) * 2 + 1
 *   • Dividing by 2 (integer) floors to the epoch index.
 *   • Multiplying back by 2 and adding 1 gives the odd epoch second.
 *   • Result is always odd, range 1..86399, fits in 17 bits (max 131071).
 *
 * Used by all five encoder functions when live_frame_num is not pre-set
 * by the transmit path (i.e. the encode-only / preview path).
 */
#define LIVE_FRAME_NUM() \
    ((((long long)(time(NULL) % 86400)) / 2) * 2 + 1)

/*
 * §C.4.2  Station / ILC / IBS → Onboard Regular Packet  (PKT_TYPE = 9)
 *
 * OUTER HEADER  (bits after PKT_TYPE + PKT_LENGTH):
 *  ┌─ Field ──────────────────┬── Bits ──┬─ Source column ─┐
 *  │ FRAME_NUM                │  17      │ v[3]             │
 *  │ SOURCE_STN_ID            │  16      │ v[4]             │
 *  │ SOURCE_STN_VER           │   3      │ v[5]             │
 *  │ DEST_LOCO_ID             │  20      │ v[6]             │
 *  │ REF_PROF_ID              │   4      │ v[7]             │
 *  │ LAST_REF_RFID            │  10      │ v[8]             │
 *  │ DIST_PKT_START (signed)  │  15      │ v[9]             │
 *  │ PKT_DIR                  │   2      │ v[10]            │
 *  │ Padding                  │   3      │ 0                │
 *  └──────────────────────────┴──────────┴──────────────────┘
 *  Total outer header bits: 17+16+3+20+4+10+15+2+3 = 90
 *
 * MA SUB-PACKET  (SUB_PKT_TYPE = 0):
 *  ┌─ Field ──────────────────┬── Bits ──┬─ Source column ─┐
 *  │ SUB_PKT_TYPE             │   4      │ constant 0       │
 *  │ SUB_PKT_LENGTH           │   7      │ back-filled      │
 *  │ FRAME_OFFSET             │   4      │ v[13]            │
 *  │ DEST_LOCO_SOS            │   4      │ v[14]            │
 *  │ TRAIN_SECTION_TYPE       │   2      │ v[15]            │
 *  │ CUR_SIG_INFO             │  17      │ v[16]            │
 *  │ CUR_SIG_ASPECT           │   6      │ v[17]            │
 *  │ NEXT_SIG_ASPECT          │   6      │ v[18]            │
 *  │ APPR_SIG_DIST            │  15      │ v[19]            │
 *  │ AUTHORITY_TYPE           │   2      │ v[20]            │
 *  │ AUTHORIZED_SPEED         │   6      │ v[21] ÷5 if >50  │
 *  │ MA_W_R_T_SIG             │  16      │ v[22]            │
 *  │ REQ_SHORTEN_MA           │   1      │ v[23] != 0       │
 *  │ NEW_MA (if above = 1)    │  16      │ v[23]            │
 *  │ TRN_LEN_INFO_STS         │   1      │ v[25]            │
 *  │ TRN_LEN_INFO_TYPE        │   1      │ v[26] (if STS=1) │
 *  │ REF_FRAME_NUM_TLM        │  17      │ v[27] (if STS=1) │
 *  │ REF_OFFSET_INT_TLM       │   8      │ v[28] (if STS=1) │
 *  │ NEXT_STN_COMM            │   1      │ v[29]            │
 *  │ APPR_STN_ILC_IBS_ID      │  16      │ v[30] (if HO=1)  │
 *  │ [byte padding]           │ 0..7     │ 0                │
 *  └──────────────────────────┴──────────┴──────────────────┘
 *
 * FOOTER:
 *  │ CBC_MAC                  │  32      │ v[33]            │
 *  │ PKT_CRC                  │  32      │ v[34]            │
 *
 * TOTAL BYTES:
 *   total_bits  = 4 + 10 + 90 + sp_bytes×8 + 64
 *   total_bytes = ceil(total_bits / 8)
 *   PKT_LENGTH  = total_bytes − 1
 */
static int encode_pkt9(const CsvRow *r, BitWriter *bw)
{
    /* --- Extract CSV fields --- */
    /* FRAME_NUM (Annexure-C 17-bit field):
     *   transmit path  → live_frame_num is set by transmit_storyboard_csv()
     *                    before each 2-second burst; use it directly.
     *   encode-only path → live_frame_num is 0; fall back to live wall-clock
     *                    (IST seconds since midnight), NOT CSV col-3 index. */
    long long frameNum     = r->live_frame_num
                             ? r->live_frame_num
                             : LIVE_FRAME_NUM();
    long long srcStnId     = r->v[4];
    long long srcStnVer    = r->v[5];
    long long locoId       = r->v[6];
    long long refProfNum   = r->v[7];
    long long lastRefRfid  = r->v[8];
    long long distPktStart = r->v[9];   /* signed – may be negative */
    long long pktDir       = r->v[10];
    long long frameOffset  = r->v[13];
    long long sos          = r->v[14];
    long long secType      = r->v[15];
    long long curSigInfo   = r->v[16];
    long long curSigAsp    = r->v[17];
    long long nxtSigAsp    = r->v[18];
    long long apprSigDist  = r->v[19];
    long long authType     = r->v[20];
    long long authSpeed    = r->v[21];
    long long ma           = r->v[22];
    long long shortMA      = r->v[23];
    long long TLsts        = r->v[25];
    long long TLtype       = r->v[26];
    long long refFN        = r->v[27];
    long long refOff       = r->v[28];
    long long nxtStnHO     = r->v[29];
    long long nxtStnId     = r->v[30];
    long long cbcMac       = r->v[33];
    long long crc          = r->v[34];

    /* ── Build MA sub-packet in a temporary BitWriter ── */
    BitWriter sp;
    bw_init(&sp);

    bw_write(&sp, 0x0, 4);                        /* SUB_PKT_TYPE = 0 (MA)     */

    int sp_len_bit_pos = sp.bit_pos;               /* remember position for     */
    bw_write(&sp, 0x0, 7);                         /* SUB_PKT_LENGTH placeholder */

    bw_write(&sp, (uint64_t)frameOffset,   4);     /* FRAME_OFFSET              */
    bw_write(&sp, (uint64_t)sos,           4);     /* DEST_LOCO_SOS             */
    bw_write(&sp, (uint64_t)secType,       2);     /* TRAIN_SECTION_TYPE        */
    bw_write(&sp, (uint64_t)curSigInfo,   17);     /* CUR_SIG_INFO              */
    bw_write(&sp, (uint64_t)curSigAsp,     6);     /* CUR_SIG_ASPECT            */
    bw_write(&sp, (uint64_t)nxtSigAsp,     6);     /* NEXT_SIG_ASPECT           */
    bw_write(&sp, (uint64_t)apprSigDist,  15);     /* APPR_SIG_DIST             */
    bw_write(&sp, (uint64_t)authType,      2);     /* AUTHORITY_TYPE            */

    /*
     * AUTHORIZED_SPEED encoding:
     *   If the raw speed in the CSV exceeds 50 km/h, encode as (kmph / 5)
     *   to fit within 6 bits (max encoded value = 200/5 = 40).
     *   If ≤ 50 km/h, encode raw (direct fit in 6 bits).
     */
    long long speedCode = (authSpeed > 50) ? (authSpeed / 5) : authSpeed;
    bw_write(&sp, (uint64_t)speedCode,     6);     /* AUTHORIZED_SPEED          */

    bw_write(&sp, (uint64_t)ma,           16);     /* MA_W_R_T_SIG              */

    int shortenFlag = (shortMA != 0) ? 1 : 0;
    bw_write(&sp, (uint64_t)shortenFlag,   1);     /* REQ_SHORTEN_MA            */
    if (shortenFlag)
        bw_write(&sp, (uint64_t)shortMA,  16);     /* NEW_MA (conditional)      */

    bw_write(&sp, (uint64_t)TLsts,         1);     /* TRN_LEN_INFO_STS          */
    if (TLsts) {
        bw_write(&sp, (uint64_t)TLtype,    1);     /* TRN_LEN_INFO_TYPE (cond.) */
        bw_write(&sp, (uint64_t)refFN,    17);     /* REF_FRAME_NUM_TLM (cond.) */
        bw_write(&sp, (uint64_t)refOff,    8);     /* REF_OFFSET_INT_TLM(cond.) */
    }

    bw_write(&sp, (uint64_t)nxtStnHO,     1);     /* NEXT_STN_COMM             */
    if (nxtStnHO)
        bw_write(&sp, (uint64_t)nxtStnId, 16);    /* APPR_STN_ILC_IBS_ID(cond.)*/

    /* Pad sub-packet to next byte boundary */
    int sp_bits  = sp.bit_pos;
    int sp_bytes = (sp_bits + 7) / 8;
    int pad_bits = sp_bytes * 8 - sp_bits;
    if (pad_bits > 0)
        bw_write(&sp, 0, pad_bits);

    /* Back-fill SUB_PKT_LENGTH = (sp_bytes − 1) into the placeholder */
    bw_backfill_7bit(&sp, sp_len_bit_pos, (uint8_t)(sp_bytes - 1));

    /* ── Track Profile (APD) sub-packets referenced by ROUTE1..ROUTE4 ──
     * Appended as their own self-describing (type+length) sub-packets,
     * sibling to the MA sub-packet above — NOT nested inside it. See
     * SECTION 5B for the field layout this decodes and the order caveat.
     *
     * REF_PROF_ID (refProfNum = r->v[7], CSV column "REF_PROF_ID") is a
     * plain 4-bit header value (0000 = no profile, 0001-1111 = valid
     * profile) that is only written into the packet header below. It does
     * NOT select which Track Profile (APD) rows are attached.
     *
     * The Track Profile lookup is driven ONLY by ROUTE1..ROUTE4
     * (r->route[0..3], from the dedicated wide route columns raw[31..34]) —
     * an internal-use S.No index into the loaded Track Profile table, which
     * can exceed 15. So gate on the route columns alone; refProfNum must
     * not influence this. */
    uint8_t profile_bytes[TRACK_PROFILE_SUBPKT_MAX * 6 * 4];
    int profile_byte_count = 0;
    int any_route_set = (r->route[0] != 0) || (r->route[1] != 0) ||
                         (r->route[2] != 0) || (r->route[3] != 0);
    if (any_route_set) {
        profile_byte_count = track_profile_append_route_subpackets(r, profile_bytes, sizeof(profile_bytes));
    }

    /* ── Compute full packet metrics ── */
    int total_bits  = 4 + 10 + 90 + sp_bytes * 8 + profile_byte_count * 8 + 64;
    int total_bytes = (total_bits + 7) / 8;

    /* ── Write full packet to output BitWriter ── */
    bw_write(bw, 0x9,                          4);   /* PKT_TYPE = 9             */
    bw_write(bw, (uint64_t)(total_bytes - 1), 10);   /* PKT_LENGTH               */
    bw_write(bw, (uint64_t)frameNum,          17);   /* FRAME_NUM                */
    bw_write(bw, (uint64_t)srcStnId,          16);   /* SOURCE_STN_ID            */
    bw_write(bw, (uint64_t)srcStnVer,          3);   /* SOURCE_STN_VER           */
    bw_write(bw, (uint64_t)locoId,            20);   /* DEST_LOCO_ID             */
    bw_write(bw, (uint64_t)refProfNum,         4);   /* REF_PROF_ID              */
    bw_write(bw, (uint64_t)lastRefRfid,       10);   /* LAST_REF_RFID            */
    bw_write_signed(bw, (int64_t)distPktStart,15);   /* DIST_PKT_START (signed)  */
    bw_write(bw, (uint64_t)pktDir,             2);   /* PKT_DIR                  */
    bw_write(bw, 0,                            3);   /* Padding                  */

    /* Append sub-packet bytes */
    for (int i = 0; i < sp_bytes; i++)
        bw_write(bw, sp.buf[i], 8);

    /* Append Track Profile (APD) sub-packets, if this row's routes resolved any */
    for (int i = 0; i < profile_byte_count; i++)
        bw_write(bw, profile_bytes[i], 8);

    /* Footer */
    bw_write(bw, (uint64_t)(uint32_t)cbcMac, 32);   /* CBC_MAC                  */
    uint32_t pkt_crc9 = resolve_pkt_crc(bw, crc);
    bw_write(bw, (uint64_t)pkt_crc9,         32);   /* PKT_CRC                  */

    return 0;
}

/*
 * §C.4.3  Onboard → Station Regular Packet  (PKT_TYPE = 10)
 *
 * Fixed structure, 29 bytes (232 bits):
 *  ┌─ Field ──────────────────┬── Bits ──┬─ Source column ─┐
 *  │ PKT_TYPE                 │   4      │ constant 0xA     │
 *  │ PKT_LENGTH               │   7      │ 28 (29-1)        │
 *  │ FRAME_NUM                │  17      │ v[3]             │
 *  │ SOURCE_LOCO_ID           │  20      │ v[6]             │
 *  │ SOURCE_LOCO_VER          │   3      │ v[5]             │
 *  │ ABS_LOCO_LOC             │  23      │ 0 (unknown)      │
 *  │ L_DOUBTOVER              │   9      │ 0                │
 *  │ L_DOUBTUNDER             │   9      │ 0                │
 *  │ TRAIN_INT                │   2      │ 0                │
 *  │ TRAIN_LENGTH             │  11      │ 0                │
 *  │ TRAIN_SPEED              │   9      │ v[21] (÷5 if>50) │
 *  │ MOVEMENT_DIR             │   2      │ v[10]            │
 *  │ EMERGENCY_STATUS         │   3      │ v[14]            │
 *  │ LOCO_MODE                │   4      │ v[15]            │
 *  │ LAST_RFID_TAG            │  10      │ v[8]             │
 *  │ TAG_DUP                  │   1      │ 0                │
 *  │ TAG_LINK_INFO            │   3      │ 0                │
 *  │ TIN                      │   9      │ 0                │
 *  │ Brake_Applied            │   3      │ 0                │
 *  │ NEW_MA_REPLY             │   2      │ 0                │
 *  │ LAST_REF_PROFILE         │   4      │ v[7]             │
 *  │ SIG_OV                   │   1      │ 0                │
 *  │ Info_Ack                 │   4      │ 0                │
 *  │ Spare                    │   2      │ 0                │
 *  │ Loco_Health_Status       │   6      │ 0                │
 *  │ MAC_CODE                 │  32      │ v[33]            │
 *  │ PKT_CRC                  │  32      │ v[34]            │
 *  └──────────────────────────┴──────────┴──────────────────┘
 *  Sum: 4+7+17+20+3+23+9+9+2+11+9+2+3+4+10+1+3+9+3+2+4+1+4+2+6+32+32 = 232 ✓
 */
static int encode_pkt10(const CsvRow *r, BitWriter *bw)
{
    /* FRAME_NUM: use live_frame_num if set by transmit path, else wall-clock. */
    long long frameNum    = r->live_frame_num
                            ? r->live_frame_num
                            : LIVE_FRAME_NUM();
    long long locoId      = r->v[6];
    long long srcStnVer   = r->v[5];
    long long lastRefRfid = r->v[8];
    long long pktDir      = r->v[10];
    long long sos         = r->v[14];
    long long secType     = r->v[15];
    long long authSpeed   = r->v[21];
    long long refProfNum  = r->v[7];
    long long cbcMac      = r->v[33];
    long long crc         = r->v[34];

    /*
     * Fields the 28-col L2S onboard storyboard carries in its extension
     * slots (see remap_28col_to_35col()). Before, these were hard-coded 0,
     * so e.g. AbsLoc 140370 / TrnLen 180 in the storyboard went out as 0.
     * Rows from any other format (l2s_ext = 0) keep the previous 0s.
     */
    const int x = r->l2s_ext;
    long long absLocoLoc  = x ? r->v[35] : 0;   /* ABS_LOCO_LOC          */
    long long trainLength = x ? r->v[36] : 0;   /* TRAIN_LENGTH          */
    long long tin         = x ? r->v[37] : 0;   /* TIN                   */
    long long lDoubtOver  = x ? r->v[41] : 0;   /* L_DOUBTOVER           */
    long long lDoubtUnder = x ? r->v[42] : 0;   /* L_DOUBTUNDER          */
    long long trainInt    = x ? r->v[43] : 0;   /* TRAIN_INT             */
    long long tagDup      = x ? r->v[44] : 0;   /* TAG_DUP               */
    long long tagLinkInfo = x ? r->v[45] : 0;   /* TAG_LINK_INFO         */
    long long brake       = x ? r->v[46] : 0;   /* Brake_Applied         */
    long long newMaReply  = x ? r->v[47] : 0;   /* NEW_MA_REPLY          */
    long long sigOv       = x ? r->v[48] : 0;   /* SIG_OV                */
    long long infoAck     = x ? r->v[49] : 0;   /* Info_Ack              */
    long long spare       = x ? r->v[50] : 0;   /* Spare                 */
    long long locoHealth  = x ? r->v[51] : 0;   /* Loco_Health_Status    */

    /* TRAIN_SPEED is raw km/h (9 bits, 1 km/h) in C.4.3 as in C.4.6 — the
     * old ÷5 above 50 km/h (an AUTHORIZED_SPEED rule) sent 80 km/h as 16. */
    long long speedKmph   = authSpeed;
    int total_bytes       = 29;

    bw_write(bw, 0xA,                           4);  /* PKT_TYPE = 10            */
    bw_write(bw, (uint64_t)(total_bytes - 1),   7);  /* PKT_LENGTH               */
    bw_write(bw, (uint64_t)frameNum,           17);  /* FRAME_NUM                */
    bw_write(bw, (uint64_t)locoId,             20);  /* SOURCE_LOCO_ID           */
    bw_write(bw, (uint64_t)srcStnVer,           3);  /* SOURCE_LOCO_VER          */
    bw_write(bw, (uint64_t)absLocoLoc,         23);  /* ABS_LOCO_LOC             */
    bw_write(bw, (uint64_t)lDoubtOver,          9);  /* L_DOUBTOVER              */
    bw_write(bw, (uint64_t)lDoubtUnder,         9);  /* L_DOUBTUNDER             */
    bw_write(bw, (uint64_t)trainInt,            2);  /* TRAIN_INT                */
    bw_write(bw, (uint64_t)trainLength,        11);  /* TRAIN_LENGTH             */
    bw_write(bw, (uint64_t)speedKmph,           9);  /* TRAIN_SPEED (raw km/h)   */
    bw_write(bw, (uint64_t)pktDir,              2);  /* MOVEMENT_DIR             */
    bw_write(bw, (uint64_t)sos,                 3);  /* EMERGENCY_STATUS         */
    bw_write(bw, (uint64_t)secType,             4);  /* LOCO_MODE                */
    bw_write(bw, (uint64_t)lastRefRfid,        10);  /* LAST_RFID_TAG            */
    bw_write(bw, (uint64_t)tagDup,              1);  /* TAG_DUP                  */
    bw_write(bw, (uint64_t)tagLinkInfo,         3);  /* TAG_LINK_INFO            */
    bw_write(bw, (uint64_t)tin,                 9);  /* TIN                      */
    bw_write(bw, (uint64_t)brake,               3);  /* Brake_Applied            */
    bw_write(bw, (uint64_t)newMaReply,          2);  /* NEW_MA_REPLY             */
    bw_write(bw, (uint64_t)refProfNum,          4);  /* LAST_REF_PROFILE         */
    bw_write(bw, (uint64_t)sigOv,               1);  /* SIG_OV                   */
    bw_write(bw, (uint64_t)infoAck,             4);  /* Info_Ack                 */
    bw_write(bw, (uint64_t)spare,               2);  /* Spare                    */
    bw_write(bw, (uint64_t)locoHealth,          6);  /* Loco_Health_Status       */
    bw_write(bw, (uint64_t)(uint32_t)cbcMac,  32);  /* MAC_CODE                 */
    uint32_t pkt_crc10 = resolve_pkt_crc(bw, crc);
    bw_write(bw, (uint64_t)pkt_crc10,         32);  /* PKT_CRC                  */

    return 0;
}

/*
 * §C.4.4  Access Authority Packet v2.0  (PKT_TYPE = 11)
 *
 * Fixed structure, 26 bytes (208 bits):
 *  ┌─ Field ──────────────────┬── Bits ──┬─ Source column ─┐
 *  │ PKT_TYPE                 │   4      │ constant 0xB     │
 *  │ PKT_LENGTH               │   7      │ 25 (26-1)        │
 *  │ FRAME_NUM                │  17      │ v[3]             │
 *  │ SOURCE_STN_ID            │  16      │ v[4]             │
 *  │ SOURCE_STN_VER           │   3      │ v[5]             │
 *  │ STN_ILC_IBS_LOC          │  23      │ 0                │
 *  │ DEST_LOCO_ID             │  20      │ v[6]             │
 *  │ Allotted_UpLink_Freq     │  12      │ 0 (not used)     │
 *  │ Allotted_DownLink_Freq   │  12      │ 0 (not used)     │
 *  │ Allotted_TDMA_Timeslot   │   7      │ v[0]             │
 *  │ STN_RND_NUM_RS           │  16      │ 0                │
 *  │ STN_TDMA                 │   7      │ 0x7F (not used)  │
 *  │ MAC_CODE                 │  32      │ v[33]            │
 *  │ PKT_CRC                  │  32      │ v[34]            │
 *  └──────────────────────────┴──────────┴──────────────────┘
 *  Sum: 4+7+17+16+3+23+20+12+12+7+16+7+32+32 = 208 ✓
 */
static int encode_pkt11(const CsvRow *r, BitWriter *bw)
{
    /* FRAME_NUM: use live_frame_num if set by transmit path, else wall-clock. */
    long long frameNum  = r->live_frame_num
                          ? r->live_frame_num
                          : LIVE_FRAME_NUM();
    long long srcStnId  = r->v[4];
    long long srcStnVer = r->v[5];
    long long locoId    = r->v[6];
    long long cbcMac    = r->v[33];
    long long crc       = r->v[34];

    /*
     * Extended fields carried by the 15-col compact AccAuth storyboard
     * (see remap_15col_accauth_to_35col()) — v[35..40] default to 0 for
     * any row that did NOT come through that remap (e.g. a legacy
     * standard-layout row), which preserves the previous hard-coded-0
     * behaviour for those. Allotted_TDMA_Timeslot now comes from the
     * storyboard's dedicated "locoSlot" column (v[38]) rather than the
     * on-air TDMASlot (v[0]/tdmaSlot) — the two are conceptually
     * different per Annexure-C (physical TX slot vs. the timeslot value
     * assigned to the loco inside the packet).
     */
    long long stnIlcIbsLoc  = r->v[35];  /* absLoc                        */
    long long upLinkFreq    = r->v[36];  /* Allotted_UpLink_Freq          */
    long long dnLinkFreq    = r->v[37];  /* Allotted_DownLink_Freq        */
    long long allottedSlot  = r->v[38];  /* Allotted_TDMA_Timeslot        */
    long long stnRndNumRs   = r->v[39];  /* STN_RND_NUM_RS                */
    long long stnTdma       = r->v[40];  /* STN_TDMA                      */

    int total_bytes = 26;

    bw_write(bw, 0xB,                           4);  /* PKT_TYPE = 11            */
    bw_write(bw, (uint64_t)(total_bytes - 1),   7);  /* PKT_LENGTH               */
    bw_write(bw, (uint64_t)frameNum,           17);  /* FRAME_NUM                */
    bw_write(bw, (uint64_t)srcStnId,           16);  /* SOURCE_STN_ID            */
    bw_write(bw, (uint64_t)srcStnVer,           3);  /* SOURCE_STN_VER           */
    bw_write(bw, (uint64_t)stnIlcIbsLoc,       23);  /* STN_ILC_IBS_LOC          */
    bw_write(bw, (uint64_t)locoId,             20);  /* DEST_LOCO_ID             */
    bw_write(bw, (uint64_t)upLinkFreq,         12);  /* Allotted_UpLink_Freq     */
    bw_write(bw, (uint64_t)dnLinkFreq,         12);  /* Allotted_DownLink_Freq   */
    bw_write(bw, (uint64_t)allottedSlot,        7);  /* Allotted_TDMA_Timeslot   */
    bw_write(bw, (uint64_t)stnRndNumRs,        16);  /* STN_RND_NUM_RS           */
    bw_write(bw, (uint64_t)stnTdma,             7);  /* STN_TDMA                 */
    bw_write(bw, (uint64_t)(uint32_t)cbcMac,  32);  /* MAC_CODE                 */
    uint32_t pkt_crc11 = resolve_pkt_crc(bw, crc);
    bw_write(bw, (uint64_t)pkt_crc11,         32);  /* PKT_CRC                  */

    return 0;
}

/*
 * §C.4.5  Additional Emergency Packet  (PKT_TYPE = 12)
 *
 * Fixed structure, 13 bytes (104 bits):
 *  ┌─ Field ──────────────────┬── Bits ──┬─ Source column ─┐
 *  │ PKT_TYPE                 │   4      │ constant 0xC     │
 *  │ PKT_LENGTH               │   7      │ 12 (13-1)        │
 *  │ FRAME_NUM                │  17      │ v[3]             │
 *  │ SOURCE_STN_ID            │  16      │ v[4]             │
 *  │ SOURCE_STN_VER           │   3      │ v[5]             │
 *  │ STN_ILC_IBS_LOC          │  23      │ v[35]            │
 *  │ GEN_SOS_CALL             │   1      │ v[14] != 0 → 1   │
 *  │ Padding                  │   1      │ 0                │
 *  │ PKT_CRC                  │  32      │ v[34]            │
 *  └──────────────────────────┴──────────┴──────────────────┘
 *  Sum: 4+7+17+16+3+23+1+1+32 = 104 ✓
 *
 * NOTE: PKT_TYPE 12 carries no CBC_MAC (it is an emergency broadcast).
 */
static int encode_pkt12(const CsvRow *r, BitWriter *bw)
{
    /* FRAME_NUM: use live_frame_num if set by transmit path, else wall-clock. */
    long long frameNum  = r->live_frame_num
                          ? r->live_frame_num
                          : LIVE_FRAME_NUM();
    long long srcStnId  = r->v[4];
    long long srcStnVer = r->v[5];
    long long stnLoc    = r->v[35];
    long long sos       = r->v[14];
    long long crc       = r->v[34];

    int total_bytes = 13;

    bw_write(bw, 0xC,                           4);  /* PKT_TYPE = 12            */
    bw_write(bw, (uint64_t)(total_bytes - 1),   7);  /* PKT_LENGTH               */
    bw_write(bw, (uint64_t)frameNum,           17);  /* FRAME_NUM                */
    bw_write(bw, (uint64_t)srcStnId,           16);  /* SOURCE_STN_ID            */
    bw_write(bw, (uint64_t)srcStnVer,           3);  /* SOURCE_STN_VER           */
    bw_write(bw, (uint64_t)stnLoc,             23);  /* STN_ILC_IBS_LOC          */
    bw_write(bw, sos ? 1ULL : 0ULL,             1);  /* GEN_SOS_CALL             */
    bw_write(bw, 0,                             1);  /* Padding                  */
    uint32_t pkt_crc12 = resolve_pkt_crc(bw, crc);
    bw_write(bw, (uint64_t)pkt_crc12,          32);  /* PKT_CRC                  */

    return 0;
}

/*
 * §C.4.6  Onboard Access Request Packet  (PKT_TYPE = 13)
 *
 * Fixed structure, 29 bytes (232 bits):
 *  ┌─ Field ──────────────────┬── Bits ──┬─ Source column ─┐
 *  │ PKT_TYPE                 │   4      │ constant 0xD     │
 *  │ PKT_LENGTH               │   7      │ 28 (29-1)        │
 *  │ FRAME_NUM                │  17      │ v[3]             │
 *  │ SOURCE_LOCO_ID           │  20      │ v[6]             │
 *  │ SOURCE_LOCO_VER          │   3      │ v[5]             │
 *  │ ABS_LOCO_LOC             │  23      │ 0                │
 *  │ TRAIN_LENGTH             │  11      │ 0                │
 *  │ TRAIN_SPEED (raw km/h)   │   9      │ v[21]            │
 *  │ MOVEMENT_DIR             │   2      │ v[10]            │
 *  │ EMERGENCY_STATUS         │   3      │ v[14]            │
 *  │ LOCO_MODE                │   4      │ v[15]            │
 *  │ Approaching_STN_ID       │  16      │ v[4]             │
 *  │ LAST_RFID_TAG            │  10      │ v[8]             │
 *  │ TIN                      │   9      │ 0                │
 *  │ Longitude                │  21      │ 0                │
 *  │ Latitude                 │  20      │ 0                │
 *  │ LOCO_RND_NUM_RL          │  16      │ 0                │
 *  │ Padding                  │   5      │ 0                │
 *  │ PKT_CRC                  │  32      │ v[34]            │
 *  └──────────────────────────┴──────────┴──────────────────┘
 *  Sum: 4+7+17+20+3+23+11+9+2+3+4+16+10+9+21+20+16+5+32 = 232 ✓
 *
 * NOTE: PKT_TYPE 13 carries no CBC_MAC (access-request packet).
 * NOTE: TRAIN_SPEED for PKT13 is raw km/h (9 bits, max 511 km/h);
 *       no ÷5 scaling is applied for this packet type.
 */
static int encode_pkt13(const CsvRow *r, BitWriter *bw)
{
    /* FRAME_NUM: use live_frame_num if set by transmit path, else wall-clock. */
    long long frameNum    = r->live_frame_num
                            ? r->live_frame_num
                            : LIVE_FRAME_NUM();
    long long srcStnId    = r->v[4];
    long long srcStnVer   = r->v[5];
    long long locoId      = r->v[6];
    long long lastRefRfid = r->v[8];
    long long pktDir      = r->v[10];
    long long sos         = r->v[14];
    long long secType     = r->v[15];
    long long authSpeed   = r->v[21];
    long long crc         = r->v[34];

    /*
     * Extended fields carried by the 19-col compact AccReq storyboard
     * (see remap_19col_accreq_to_35col()) — v[35..40] default to 0 for any
     * row that did NOT come through that remap, which preserves the
     * previous hard-coded-0 behaviour for those (e.g. rows arriving via
     * the standard/28-col formats, which don't carry these fields at all).
     */
    long long absLocoLoc  = r->v[35];  /* ABS_LOCO_LOC                    */
    long long trainLength = r->v[36];  /* TRAIN_LENGTH                   */
    long long tin         = r->v[37];  /* TIN                             */
    long long longitude   = r->v[38];  /* Longitude                       */
    long long latitude    = r->v[39];  /* Latitude                        */
    long long locoRndRl   = r->v[40];  /* LOCO_RND_NUM_RL                 */

    int total_bytes = 29;

    bw_write(bw, 0xD,                           4);  /* PKT_TYPE = 13            */
    bw_write(bw, (uint64_t)(total_bytes - 1),   7);  /* PKT_LENGTH               */
    bw_write(bw, (uint64_t)frameNum,           17);  /* FRAME_NUM                */
    bw_write(bw, (uint64_t)locoId,             20);  /* SOURCE_LOCO_ID           */
    bw_write(bw, (uint64_t)srcStnVer,           3);  /* SOURCE_LOCO_VER          */
    bw_write(bw, (uint64_t)absLocoLoc,         23);  /* ABS_LOCO_LOC             */
    bw_write(bw, (uint64_t)trainLength,        11);  /* TRAIN_LENGTH             */
    bw_write(bw, (uint64_t)authSpeed,           9);  /* TRAIN_SPEED (raw km/h)   */
    bw_write(bw, (uint64_t)pktDir,              2);  /* MOVEMENT_DIR             */
    bw_write(bw, (uint64_t)sos,                 3);  /* EMERGENCY_STATUS         */
    bw_write(bw, (uint64_t)secType,             4);  /* LOCO_MODE                */
    bw_write(bw, (uint64_t)srcStnId,           16);  /* Approaching_STN_ID       */
    bw_write(bw, (uint64_t)lastRefRfid,        10);  /* LAST_RFID_TAG            */
    bw_write(bw, (uint64_t)tin,                 9);  /* TIN                      */
    bw_write_signed(bw, (int64_t)longitude,    21);  /* Longitude (signed)       */
    bw_write_signed(bw, (int64_t)latitude,     20);  /* Latitude (signed)        */
    bw_write(bw, (uint64_t)locoRndRl,          16);  /* LOCO_RND_NUM_RL          */
    bw_write(bw, 0,                             5);  /* Padding                  */
    uint32_t pkt_crc13 = resolve_pkt_crc(bw, crc);
    bw_write(bw, (uint64_t)pkt_crc13,          32);  /* PKT_CRC                  */

    return 0;
}

/* ============================================================================
 * SECTION 8 – SHARED ENCODE DISPATCH
 *
 * Centralises the switch(pkt_type) logic so it is used identically by both
 * encode_storyboard_csv() and transmit_storyboard_csv(), avoiding any
 * divergence between the two code paths.
 * ============================================================================ */

/**
 * dispatch_encode() – encode one CSV row into a BitWriter using the
 * packet-type-specific encoder.
 *
 * @r   : validated CsvRow
 * @bw  : zero-initialised BitWriter to write into
 *
 * Returns:
 *   0  – success
 *  -1  – encoder reported an error
 *  -2  – packet type not supported (pkt_type outside 9..13)
 */
static int dispatch_encode(const CsvRow *r, BitWriter *bw)
{
    int pkt_type = (int)r->v[1];

    switch (pkt_type) {
        case  9: return encode_pkt9 (r, bw);
        case 10: return encode_pkt10(r, bw);
        case 11: return encode_pkt11(r, bw);
        case 12: return encode_pkt12(r, bw);
        case 13: return encode_pkt13(r, bw);
        default: return -2;
    }
}

/* ============================================================================
 * SECTION 9 – encode_storyboard_csv()  (PUBLIC API)
 *
 * Encodes the full CSV storyboard into a JSON array of encoded-packet records.
 *
 * Output JSON per row:
 *   {
 *     "row":           <data-row index>,
 *     "line_num":      <absolute CSV line number>,
 *     "tdma_slot":     <column 0 value>,
 *     "frame_num":     <column 3 value>,
 *     "pkt_type":      <column 1 value>,
 *     "pkt_type_name": "<human-readable name>",
 *     "byte_len":      <encoded byte count>,
 *     "hex":           "<uppercase hex string>",
 *     "error":         "<error description, or empty string>"
 *   }
 * ============================================================================ */

/**
 * Packet type names indexed by pkt_type (0..15).
 * Types outside the supported range are labelled "Unknown".
 */
static const char * const PKT_TYPE_NAME[16] = {
    /* 0 */ "",
    /* 1 */ "",
    /* 2 */ "",
    /* 3 */ "",
    /* 4 */ "",
    /* 5 */ "",
    /* 6 */ "",
    /* 7 */ "",
    /* 8 */ "",
    /* 9 */ "Station to Onboard Regular Packet",
    /*10 */ "Onboard to Station Regular Packet",
    /*11 */ "Access Authority Packet v2.0",
    /*12 */ "Additional Emergency Packet",
    /*13 */ "Onboard Access Request Packet",
    /*14 */ "",
    /*15 */ ""
};

int encode_storyboard_csv(const char *csv_text, int radio_id, char *out_json, int out_len)
{
    if (!csv_text || !out_json || out_len < 64) return -1;
    if (radio_id != 1 && radio_id != 2) return -1;

    char ota_prefix_str[7];
    ota_prefix_hex(radio_id, ota_prefix_str);  /* "F1A5C3" or "F2A5C3" */

    int pos = 0;
    int rc_append;

#define JAPP(...) do { \
    rc_append = buf_append(out_json, &pos, out_len, __VA_ARGS__); \
    if (rc_append < 0) return -1; \
} while (0)

    JAPP("[");

    const char *line_start = csv_text;
    int row_idx    = 0;  /* count of valid data rows encoded */
    int line_num   = 0;  /* absolute line number for diagnostics */
    int first_item = 1;

    /*
     * ── Distinct FRAME_NUM assignment for the encode-only / preview path ──
     *
     * dispatch_encode()/encode_pktN() fall back to LIVE_FRAME_NUM() (a
     * wall-clock read) whenever row.live_frame_num is 0. That is correct
     * for the real paced transmit path (transmit_storyboard_csv()), which
     * genuinely sleeps ~2s between frame-groups so the wall clock advances
     * between rows. This bulk/preview loop instead runs at full CPU speed
     * with no sleeping, so many (or all) rows can be encoded within the
     * very same wall-clock second — every row falls back to an IDENTICAL
     * LIVE_FRAME_NUM() value, which (when every other CSV column is also
     * identical, as in a straight "same profile, next frame" storyboard)
     * produces byte-for-byte identical packets and CRCs.
     *
     * Fix: read the wall clock once, then hand out one distinct, valid,
     * odd Annexure-C FRAME_NUM per distinct storyboard frame-group (CSV
     * col-3 value), advancing by 2 for every new group encountered — i.e.
     * exactly what the real transmit path would produce if it were
     * actually sleeping 2s between each group, just computed instantly.
     * Rows that share the same CSV col-3 (the same on-air TDMA burst)
     * correctly still share one FRAME_NUM, matching Annexure-C semantics.
     */
    long long enc_base_fn        = -1;  /* wall-clock odd base, set on first valid row */
    long long enc_last_csv_frame = 0;   /* previous row's grouping key (CSV col-3)     */
    long long enc_group_idx      = -1;  /* 0-based index of distinct frame-groups seen */

    while (*line_start) {
        /* Find end of line (handles both \r\n and \n) */
        const char *line_end = line_start;
        while (*line_end && *line_end != '\n' && *line_end != '\r')
            line_end++;

        line_num++;

        int line_len = (int)(line_end - line_start);
        if (line_len >= 2048) line_len = 2047;

        char line_buf[2048];
        memcpy(line_buf, line_start, line_len);
        line_buf[line_len] = '\0';

        /* Advance past CR/LF */
        line_start = line_end;
        if (*line_start == '\r') line_start++;
        if (*line_start == '\n') line_start++;

        CsvRow row = parse_csv_row(line_buf);
        if (!row.valid) continue;   /* skip comment, blank, or malformed */

        row_idx++;

        int pkt_type  = (int)row.v[1];
        long long tdma_slot = row.v[0];
        /* frame_num in the JSON output = CSV col-3 storyboard sequence index.
         * This value is used ONLY by the frontend (SvkSim.jsx) to group packets
         * into their 2-second TDMA burst frames for display and paced injection.
         * It is NOT the FRAME_NUM encoded inside the packet bytes. */
        long long frame_num = row.v[3];

        /* Assign this row's on-air FRAME_NUM — see comment block above. */
        if (enc_base_fn < 0) enc_base_fn = LIVE_FRAME_NUM();
        if (row_idx == 1 || frame_num != enc_last_csv_frame) {
            enc_group_idx++;
            enc_last_csv_frame = frame_num;
        }
        row.live_frame_num = (enc_base_fn + enc_group_idx * 2) % 86400;
        if ((row.live_frame_num & 1) == 0) row.live_frame_num += 1; /* stay odd (safety) */

        /* Encode packet */
        BitWriter bw;
        bw_init(&bw);
        int enc_rc = dispatch_encode(&row, &bw);

        int  byte_len = bw_byte_len(&bw);
        char hex_buf[2100] = "";
        char ota_hex_buf[2106] = "";   /* frame_prefix (6 chars) + hex_buf */
        if (enc_rc == 0) {
            bytes_to_hex(bw.buf, byte_len, hex_buf);
            snprintf(ota_hex_buf, sizeof(ota_hex_buf), "%s%s", ota_prefix_str, hex_buf);
        }

        const char *type_name = (pkt_type >= 0 && pkt_type < 16)
                                 ? PKT_TYPE_NAME[pkt_type] : "Unknown";
        if (!type_name || !type_name[0]) type_name = "Unknown";

        char err_buf[80] = "";
        if (enc_rc == -2)
            snprintf(err_buf, sizeof(err_buf),
                     "Unsupported pkt_type %d", pkt_type);
        else if (enc_rc != 0)
            snprintf(err_buf, sizeof(err_buf),
                     "Encoding error (pkt_type %d)", pkt_type);

        if (!first_item) JAPP(",");
        first_item = 0;

        /*
         * "hex" stays the raw KAVACH packet bytes only (PKT_TYPE..PKT_CRC) —
         * unchanged from before, since that is what CRC/MAC verification on
         * the decode side operates over.
         *
         * "frame_prefix" / "ota_hex" / "ota_byte_len" are NEW: the modem-level
         * Annexure-C §C.3.2.12 Start-of-Frame bytes, reported separately so
         * a UI can show exactly what actually goes on air without disturbing
         * any existing CRC-verification logic that reads "hex".
         */
        JAPP("{\"row\":%d,\"line_num\":%d,\"tdma_slot\":%lld,"
             "\"frame_num\":%lld,"
             "\"pkt_type\":%d,\"pkt_type_name\":\"%s\","
             "\"byte_len\":%d,\"hex\":\"%s\","
             "\"radio_id\":%d,\"frame_prefix\":\"%s\","
             "\"ota_hex\":\"%s\",\"ota_byte_len\":%d,"
             "\"error\":\"%s\"}",
             row_idx, line_num, tdma_slot, frame_num,
             pkt_type, type_name,
             byte_len, hex_buf,
             radio_id, ota_prefix_str,
             ota_hex_buf, (enc_rc == 0) ? byte_len + 3 : 0,
             err_buf);
    }

    JAPP("]");
#undef JAPP
    return 0;
}

/* ============================================================================
 * SECTION 10 – transmit_storyboard_csv()  (PUBLIC API – NEW)
 *
 * OVERVIEW
 * --------
 * Reads the CSV storyboard, encodes every valid data row, then transmits each
 * encoded packet as a UDP datagram to the remote SVK Stresser endpoint.
 *
 * TIMING MODEL
 * ------------
 * The CSV storyboard represents a time-ordered sequence of TDMA frames.
 * Column 3 (frameNum) identifies which 2-second epoch each row belongs to:
 * rows with the same frameNum are part of the same frame-group and are
 * transmitted in rapid succession.  After all rows in a frame-group are sent,
 * the function sleeps until the next 2-second wall-clock boundary before
 * processing the next frame-group.  This faithfully reproduces the real-time
 * behaviour of an SVK station's radio transmission schedule.
 *
 * PARAMETERS
 * ----------
 * @csv_text    NUL-terminated string containing the full CSV file content.
 * @dest_ip     IPv4 address string of the remote SVK Stresser (e.g. "192.168.1.5").
 * @dest_port   UDP destination port number (1–65535).
 * @loop        0 = play the storyboard once and return;
 *              1 = loop continuously until *stop_flag becomes non-zero.
 * @stop_flag   Pointer to a volatile int; set to 1 from another thread or
 *              signal handler to abort an in-progress (or looping) run.
 *              Pass NULL if you do not need external abort capability.
 *
 * RETURN VALUES
 * -------------
 *   0  – completed (all rows sent, or stopped cleanly via stop_flag)
 *  -1  – invalid argument (csv_text or dest_ip is NULL, port out of range)
 *  -2  – socket / address setup failure (check errno)
 *  -3  – encoding error for one or more rows
 *
 * NOTES
 * -----
 * • The function opens a single UDP socket for the entire run (or loop) and
 *   closes it before returning.  This is intentional: re-using the socket
 *   avoids the overhead of repeated open/close during a high-rate burst.
 * • Only encoding errors cause -3 to be returned; unsupported packet types
 *   are silently skipped (the row is logged to stderr if SVK_VERBOSE is
 *   defined at compile time).
 * • The function is NOT thread-safe with respect to the same csv_text buffer;
 *   do not modify the buffer while this function is running.
 * ============================================================================ */

int transmit_storyboard_csv(const char  *csv_text,
                             const char  *dest_ip,
                             int          dest_port,
                             int          loop,
                             int          radio_id,
                             volatile int *stop_flag)
{
    /* ── Argument validation ── */
    if (!csv_text || !dest_ip)         return -1;
    if (dest_port < 1 || dest_port > 65535) return -1;
    if (radio_id != 1 && radio_id != 2) return -1;

    /* Annexure-C §C.3.2.12 Start-of-Frame prefix for this radio unit —
     * computed once, prepended to every packet sent below. */
    uint8_t frame_prefix[3];
    ota_frame_prefix(radio_id, frame_prefix);

    /* ── First pass: parse all rows into heap memory ── */
    /*
     * We parse the CSV once into an array of (CsvRow, encoded bytes, byte_len)
     * so the transmission loop itself is free of dynamic parsing overhead and
     * deterministic in timing.
     */

    /* Count valid rows first */
    int total_rows = 0;
    {
        const char *p = csv_text;
        while (*p) {
            const char *eol = p;
            while (*eol && *eol != '\n' && *eol != '\r') eol++;
            char lbuf[2048];
            int  llen = (int)(eol - p);
            if (llen >= 2048) llen = 2047;
            memcpy(lbuf, p, llen);
            lbuf[llen] = '\0';
            CsvRow r = parse_csv_row(lbuf);
            if (r.valid) total_rows++;
            p = eol;
            if (*p == '\r') p++;
            if (*p == '\n') p++;
        }
    }

    if (total_rows == 0) return 0;   /* nothing to send */

    /*
     * Allocate a flat array to hold each row's encoded packet.
     * Max packet size per encode: 1024 bytes (BitWriter buffer size).
     */
    typedef struct {
        long long csv_frame_num;      /* CSV col-3 value — used ONLY for grouping rows
                                       * into same-burst sets. Never encoded on air.   */
        long long tdma_slot;          /* for diagnostics */
        int       pkt_type;
        CsvRow    row;                /* full parsed row — re-encoded at TX time with
                                       * live_frame_num set to wall-clock value         */
        uint8_t   pkt_buf[1024];      /* encoded packet bytes (filled at TX time)       */
        int       pkt_len;            /* valid bytes in pkt_buf                         */
        int       enc_error;          /* 0 = ok, -1 = error, -2 = unsupported           */
    } EncodedRow;

    EncodedRow *rows = (EncodedRow *)malloc((size_t)total_rows * sizeof(EncodedRow));
    if (!rows) return -2;   /* out of memory treated as resource failure */

    /* Second pass: parse every valid row and store for TX-time encoding */
    int row_idx = 0;
    {
        const char *p = csv_text;
        while (*p && row_idx < total_rows) {
            const char *eol = p;
            while (*eol && *eol != '\n' && *eol != '\r') eol++;
            char lbuf[2048];
            int  llen = (int)(eol - p);
            if (llen >= 2048) llen = 2047;
            memcpy(lbuf, p, llen);
            lbuf[llen] = '\0';

            CsvRow r = parse_csv_row(lbuf);
            if (r.valid) {
                EncodedRow *er = &rows[row_idx];
                er->csv_frame_num = r.v[3];   /* group key only — not encoded */
                er->tdma_slot     = r.v[0];
                er->pkt_type      = (int)r.v[1];
                er->row           = r;         /* store full row for TX-time re-encode */
                er->pkt_len       = 0;
                er->enc_error     = 0;
                row_idx++;
            }

            p = eol;
            if (*p == '\r') p++;
            if (*p == '\n') p++;
        }
    }

    /* ── Create UDP socket ── */
    int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sockfd < 0) {
        free(rows);
        return -2;
    }

    /* Set up destination address */
    struct sockaddr_in dest_addr;
    memset(&dest_addr, 0, sizeof(dest_addr));
    dest_addr.sin_family      = AF_INET;
    dest_addr.sin_port        = htons((uint16_t)dest_port);

    if (inet_pton(AF_INET, dest_ip, &dest_addr.sin_addr) != 1) {
        close(sockfd);
        free(rows);
        return -2;
    }

    /* ── Transmission loop ── */
    int ret        = 0;   /* return code */
    int enc_errors = 0;   /* count of encoding errors encountered */

    do {
        int i = 0;

        while (i < total_rows) {
            /* Check stop flag before each frame group */
            if (stop_flag && *stop_flag) goto cleanup;

            long long current_csv_frame = rows[i].csv_frame_num;

            /*
             * Compute the Annexure-C TDMA FRAME_NUM for this burst.
             *
             * Per RDSO/SPN/196/2020 Annexure-C, FRAME_NUM counts 2-second
             * TDMA epochs since midnight.  Each epoch starts on an ODD second:
             *   epoch 1 → 00:00:01, epoch 3 → 00:00:03, epoch 5 → 00:00:05 …
             *
             * Formula: live_fn = floor(seconds_since_midnight / 2) * 2 + 1
             *   → always odd, increments by 2 every epoch, max 86399 (fits 17 bits).
             *
             * The CSV column 3 value is used ONLY to group rows that belong
             * to the same burst; it is never placed into the encoded packet.
             */
            long long live_fn = LIVE_FRAME_NUM();

            /*
             * Encode and transmit all rows belonging to the current CSV frame group.
             * Each row is encoded fresh here with live_frame_num set so the
             * FRAME_NUM field in the on-air packet reflects wall-clock time.
             */
            while (i < total_rows && rows[i].csv_frame_num == current_csv_frame) {
                EncodedRow *er = &rows[i];

                /* Set the live frame number and re-encode this packet */
                er->row.live_frame_num = live_fn;

                BitWriter bw;
                bw_init(&bw);
                er->enc_error = dispatch_encode(&er->row, &bw);

                if (er->enc_error == 0) {
                    er->pkt_len = bw_byte_len(&bw);
                    memcpy(er->pkt_buf, bw.buf, er->pkt_len);
                } else {
                    er->pkt_len = 0;
                }

                if (er->enc_error == 0 && er->pkt_len > 0) {
                    /* Prepend the Annexure-C §C.3.2.12 Start-of-Frame prefix
                     * (0xF1/0xF2 0xA5 0xC3) — this goes out on the wire but
                     * is never fed into CRC/MAC, which only ever see
                     * er->pkt_buf (the pure KAVACH packet) above. */
                    uint8_t ota_frame[3 + 1024];
                    memcpy(ota_frame, frame_prefix, 3);
                    memcpy(ota_frame + 3, er->pkt_buf, (size_t)er->pkt_len);
                    int ota_len = er->pkt_len + 3;

                    ssize_t sent = sendto(sockfd,
                                          ota_frame,
                                          (size_t)ota_len,
                                          0,
                                          (struct sockaddr *)&dest_addr,
                                          sizeof(dest_addr));
                    if (sent < 0) {
                        /* Transient send error: log but continue */
                        /* (In SIL-4 production, this would raise a safety alarm.) */
                        fprintf(stderr,
                                "[svk_sim] sendto failed: live_frame=%lld "
                                "tdma=%lld pkt_type=%d err=%s\n",
                                live_fn, er->tdma_slot,
                                er->pkt_type, strerror(errno));
                    }
                } else if (er->enc_error == -1) {
                    enc_errors++;
                }
                /* enc_error == -2 (unsupported type): silently skip */

                i++;
            }

            /*
             * All packets for 'current_frame' have been sent.
             * Sleep until the next 2-second wall-clock boundary before
             * processing the next frame group.
             *
             * We check stop_flag once more after waking in case an abort
             * was requested during the sleep.
             */
            if (i < total_rows) {
                sleep_until_next_2s_boundary();
                if (stop_flag && *stop_flag) goto cleanup;
            }
        }

    } while (loop && !(stop_flag && *stop_flag));

cleanup:
    close(sockfd);
    free(rows);

    if (enc_errors > 0) ret = -3;
    return ret;
}

/* ============================================================================
 * SECTION 10B – svk_ota_prefix_hex()  (PUBLIC API – NEW)
 *
 * Exported so any OTHER transmit path that writes raw bytes directly
 * (e.g. the serial/UHF radio-modem writer in main.py, which is not part
 * of this file) can fetch the exact same Annexure-C §C.3.2.12 prefix used
 * above, instead of re-deriving/hard-coding "F1A5C3" / "F2A5C3" a second
 * time. This keeps the framing rule defined in exactly one place.
 *
 * @radio_id  : 1 (Radio1) or 2 (Radio2)
 * @out_hex   : caller-supplied buffer, must hold at least 7 bytes
 *              ("F1A5C3" / "F2A5C3" + NUL terminator)
 * @out_len   : size of out_hex buffer (must be >= 7)
 *
 * Returns 0 on success, -1 on invalid radio_id or too-small out_len.
 * ============================================================================ */
int svk_ota_prefix_hex(int radio_id, char *out_hex, int out_len)
{
    if (!out_hex || out_len < 7) return -1;
    return ota_prefix_hex(radio_id, out_hex);
}

/* ============================================================================
 * SECTION 11 – SELF-TEST  (compile with -DSVK_TEST_MAIN)
 * ============================================================================ */

#ifdef SVK_TEST_MAIN

static const char *SAMPLE_CSV =
    "#,TimeLost Interval,,2\n"
    "#TDMASlot,pktType,pktLen,frameNum,srcStationId,srcStationVer,locoId,"
    "REF_PROF_ID,lastRefRfid,distPktStart,pktDir,subPktType,subPktLen,"
    "frameOffset,sos,secType,curSigInfo,curSigAsp,nxtSigAsp,apprSigDist,"
    "authType,authSpeed,MA,shortMA,revMA,TLsts,TLtype,refFN,refOff,"
    "nxtStnHO,nxtStationId,profileID,TLIProfID,CBCMAC,CRC\n"
    "#\n"
    "10,9,0,1,431,2,504,1,352,-300,1,0,0,0,0,1,8224,10,2,1200,1,100,3249,0,0,0,0,0,0,1,431,1,1,0,0\n"
    "12,9,0,3,431,2,505,1,352,-300,1,0,0,0,0,1,8224,10,2,1200,1,100,3249,0,0,0,0,0,0,1,431,1,1,0,0\n"
    "14,9,0,3,431,2,504,1,352,-300,1,0,0,0,0,1,8224,10,2,1200,1,100,3249,0,0,0,0,0,0,1,431,0,0,0,0\n";

int main(void)
{
    printf("=== SVK SIM encode_storyboard_csv() self-test ===\n\n");

    char json_out[65536];
    int rc = encode_storyboard_csv(SAMPLE_CSV, /*radio_id=*/1, json_out, sizeof(json_out));

    if (rc != 0) {
        fprintf(stderr, "encode_storyboard_csv() returned %d\n", rc);
        return 1;
    }

    /* Pretty-print: show first 1024 chars */
    printf("Output JSON (first 1024 chars):\n%.1024s\n...\n", json_out);
    printf("\nTest PASSED (encode returned 0).\n");

    printf("\n=== Transmission test (localhost:12345, no-loop) ===\n");
    printf("(packets will be sent to 127.0.0.1:12345 – use netcat to observe)\n");

    volatile int stop = 0;
    rc = transmit_storyboard_csv(SAMPLE_CSV, "127.0.0.1", 12345, 0, /*radio_id=*/1, &stop);
    printf("transmit_storyboard_csv() returned %d\n", rc);

    char prefix_hex[7];
    svk_ota_prefix_hex(1, prefix_hex, sizeof(prefix_hex));
    printf("Radio1 OTA prefix: %s\n", prefix_hex);
    svk_ota_prefix_hex(2, prefix_hex, sizeof(prefix_hex));
    printf("Radio2 OTA prefix: %s\n", prefix_hex);

    printf("\n=== Track Profile (APD) load test ===\n");
    static const char *SAMPLE_TRACK_PROFILE =
        "1|A1B2C3|001122|FF00FF|0A0B0C|DEADBEEF|CAFE\n"
        "4|112233|445566|778899|AABBCC|DDEEFF|001122\n";
    int tp_loaded = svk_load_track_profile(SAMPLE_TRACK_PROFILE);
    printf("svk_load_track_profile() loaded %d rows\n", tp_loaded);
    printf("svk_track_profile_count() = %d\n", svk_track_profile_count());
    if (tp_loaded != 2 || svk_track_profile_count() != 2) {
        fprintf(stderr, "Track Profile self-test FAILED (expected 2 rows)\n");
        return 1;
    }
    printf("Track Profile self-test PASSED.\n");

    return (rc == 0) ? 0 : 1;
}

#endif /* SVK_TEST_MAIN */