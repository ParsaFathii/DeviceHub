/* DeviceHub C Protocol Library — Copyright © 2026 Parsa Fathi — Apache-2.0 */
/**
 * @file test_protocol.c
 *
 * Test suite for the DeviceHub binary wire protocol implementation.
 * Self-contained harness: CHECK() counts individual assertions and
 * RUN_TEST() tracks per-test PASS/FAIL; the program exits non-zero if
 * anything failed.
 */
#include "dh_protocol.h"

#include <float.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

/* -------------------------------------------------------------------- */
/* Tiny assert framework                                                 */
/* -------------------------------------------------------------------- */

static int tests_run = 0;
static int tests_failed = 0;
static int checks_run = 0;
static int checks_failed = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        checks_run++;                                                        \
        if (!(cond)) {                                                       \
            checks_failed++;                                                 \
            printf("    CHECK FAILED %s:%d: %s\n",                           \
                   __FILE__, __LINE__, #cond);                               \
        }                                                                    \
    } while (0)

#define RUN_TEST(fn)                                                         \
    do {                                                                     \
        int failed_before = checks_failed;                                   \
        printf("[TEST ] %s\n", #fn);                                         \
        fn();                                                                \
        tests_run++;                                                         \
        if (checks_failed > failed_before) {                                 \
            tests_failed++;                                                  \
            printf("[FAIL ] %s\n\n", #fn);                                   \
        } else {                                                             \
            printf("[PASS ] %s\n\n", #fn);                                   \
        }                                                                    \
    } while (0)

/* -------------------------------------------------------------------- */
/* Test-side serialization helpers                                       */
/*                                                                        */
/* These deliberately re-implement little-endian writes independently of */
/* the library so that wire-layout assertions do not just re-encode with */
/* the code under test.                                                   */
/* -------------------------------------------------------------------- */

static void t_put16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
}

static void t_put32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
    p[2] = (uint8_t)((v >> 16) & 0xFFu);
    p[3] = (uint8_t)((v >> 24) & 0xFFu);
}

static void t_put64(uint8_t *p, uint64_t v)
{
    for (int i = 0; i < 8; ++i) {
        p[i] = (uint8_t)((v >> (8 * i)) & 0xFFu);
    }
}

/**
 * Build a raw frame without going through the library encoder so that
 * invalid frames can be constructed for decode-rejection tests.
 * The CRC is always computed correctly over bytes [0..17] + payload.
 */
static size_t t_make_frame(uint8_t *out, size_t outCap, uint8_t msgType,
                           uint8_t flags, uint32_t seq, int64_t ts,
                           const uint8_t *payload, size_t payloadLen)
{
    if (payloadLen > (size_t)DH_MAX_PAYLOAD) {
        return 0;
    }
    size_t total = DH_FRAME_SIZE(payloadLen);
    if (outCap < total) {
        return 0;
    }
    out[0] = (uint8_t)DH_MAGIC;
    out[1] = (uint8_t)DH_PROTOCOL_VERSION;
    out[2] = msgType;
    out[3] = flags;
    t_put16(out + 4, (uint16_t)payloadLen);
    t_put32(out + 6, seq);
    t_put64(out + 10, (uint64_t)ts);
    uint8_t body[18 + DH_MAX_PAYLOAD];
    memcpy(body, out, 18);
    if (payloadLen > 0u) {
        memcpy(body + 18, payload, payloadLen);
    }
    t_put32(out + 18, dh_crc32(body, 18 + payloadLen));
    if (payloadLen > 0u) {
        memcpy(out + 22, payload, payloadLen);
    }
    return total;
}

/** Build a valid telemetry frame with a specific raw payload. */
static size_t t_telemetry_frame(uint8_t *out, size_t outCap, const uint8_t *payload)
{
    return t_make_frame(out, outCap, (uint8_t)DH_MSG_TELEMETRY,
                        (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                        (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
}

/* -------------------------------------------------------------------- */
/* 1. CRC-32 reference vectors                                           */
/* -------------------------------------------------------------------- */

static void test_crc32_known_vectors(void)
{
    /* required vectors */
    CHECK(dh_crc32((const uint8_t *)"123456789", 9) == 0xCBF43926u);
    CHECK(dh_crc32((const uint8_t *)"", 0) == 0x00000000u);
    const uint8_t nul = 0x00;
    CHECK(dh_crc32(&nul, 1) == 0xD202EF8Du);

    /* additional vectors cross-checked against zlib */
    const uint8_t ff = 0xFF;
    CHECK(dh_crc32(&ff, 1) == 0xFF000000u);
    CHECK(dh_crc32((const uint8_t *)"DeviceHub", 9) == 0x002808EAu);
    const uint8_t four[4] = { 0x00, 0x01, 0x02, 0x03 };
    CHECK(dh_crc32(four, 4) == 0x8BB98613u);

    /* multi-kilobyte input */
    uint8_t big[4096];
    for (size_t i = 0; i < sizeof big; ++i) {
        big[i] = (uint8_t)(i & 0xFFu);
    }
    CHECK(dh_crc32(big, sizeof big) == 0xA2912082u);
}

/* -------------------------------------------------------------------- */
/* 2. Exact wire layout against an independently assembled frame         */
/* -------------------------------------------------------------------- */

static void test_wire_layout(void)
{
    const uint32_t seq = 12345u;
    const int64_t ts = 1730000000123LL;
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 22.5 };

    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    uint8_t frame[DH_HEADER_SIZE + DH_TELEMETRY_PAYLOAD_SIZE];
    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                               (uint8_t)DH_FLAG_HAS_CRC, seq, ts, payload,
                               (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    /* golden frame assembled field by field, independent of the encoder */
    uint8_t golden[DH_HEADER_SIZE + DH_TELEMETRY_PAYLOAD_SIZE];
    golden[0] = 0xD4;
    golden[1] = 0x01;
    golden[2] = 0x01;
    golden[3] = 0x01;
    t_put16(golden + 4, 11u);
    t_put32(golden + 6, seq);
    t_put64(golden + 10, (uint64_t)ts);
    uint8_t body[18 + DH_TELEMETRY_PAYLOAD_SIZE];
    memcpy(body, golden, 18);
    memcpy(body + 18, payload, DH_TELEMETRY_PAYLOAD_SIZE);
    t_put32(golden + 18, dh_crc32(body, sizeof body));
    memcpy(golden + 22, payload, DH_TELEMETRY_PAYLOAD_SIZE);
    CHECK(memcmp(frame, golden, n) == 0);

    /* spot checks of individual bytes */
    CHECK(frame[0] == 0xD4);                 /* magic */
    CHECK(frame[1] == 0x01);                 /* version */
    CHECK(frame[2] == DH_MSG_TELEMETRY);     /* msgType */
    CHECK(frame[3] == DH_FLAG_HAS_CRC);      /* flags */
    CHECK(frame[4] == 11 && frame[5] == 0);  /* payloadLen LE */
    CHECK(frame[6] == 0x39 && frame[7] == 0x30 && frame[8] == 0x00 && frame[9] == 0x00);
    CHECK(frame[10] == 0x7B && frame[11] == 0x14 && frame[12] == 0x09 && frame[13] == 0xCC);
    CHECK(frame[14] == 0x92 && frame[15] == 0x01 && frame[16] == 0x00 && frame[17] == 0x00);
    CHECK(memcmp(frame + 22, payload, 11) == 0);

    /* telemetry payload bytes: metric LE, quality, IEEE754 double LE */
    CHECK(payload[0] == 0x01 && payload[1] == 0x00);
    CHECK(payload[2] == DH_QUALITY_GOOD);
    const uint8_t d22_5[8] = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x36, 0x40 };
    CHECK(memcmp(payload + 3, d22_5, 8) == 0);

    /* the stored CRC must equal CRC-32 over [0..17] + payload */
    uint32_t stored = (uint32_t)frame[18] | ((uint32_t)frame[19] << 8) |
                      ((uint32_t)frame[20] << 16) | ((uint32_t)frame[21] << 24);
    CHECK(stored == dh_crc32(body, sizeof body));
}

/* -------------------------------------------------------------------- */
/* 3. Telemetry round trip                                               */
/* -------------------------------------------------------------------- */

static void test_telemetry_roundtrip(void)
{
    DhTelemetry in;
    memset(&in, 0, sizeof in);
    in.metricId = DH_METRIC_TEMPERATURE;
    in.quality = DH_QUALITY_GOOD;
    in.value = 22.5;

    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &in) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                               (uint8_t)DH_FLAG_HAS_CRC, 12345u, 1730000000123LL,
                               payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.magic == DH_MAGIC);
    CHECK(f.version == DH_PROTOCOL_VERSION);
    CHECK(f.msgType == DH_MSG_TELEMETRY);
    CHECK(f.flags == DH_FLAG_HAS_CRC);
    CHECK(f.payloadLen == DH_TELEMETRY_PAYLOAD_SIZE);
    CHECK(f.seq == 12345u);
    CHECK(f.ts == 1730000000123LL);
    CHECK(memcmp(f.payload, payload, DH_TELEMETRY_PAYLOAD_SIZE) == 0);

    DhTelemetry out;
    CHECK(dh_telemetry_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.metricId == DH_METRIC_TEMPERATURE);
    CHECK(out.quality == DH_QUALITY_GOOD);
    CHECK(out.value == 22.5);

    /* re-encoding the decoded frame reproduces identical bytes */
    uint8_t frame2[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    CHECK(dh_frame_encode(frame2, sizeof frame2, f.msgType, f.flags, f.seq, f.ts,
                          f.payload, f.payloadLen) == n);
    CHECK(memcmp(frame, frame2, n) == 0);
}

/* -------------------------------------------------------------------- */
/* 4. Status round trip                                                  */
/* -------------------------------------------------------------------- */

static void test_status_roundtrip(void)
{
    DhStatus in;
    memset(&in, 0, sizeof in);
    in.state = DH_STATE_ONLINE;
    in.health = 97;
    in.fw[0] = 1;  /* firmware 1.4.2 */
    in.fw[1] = 4;
    in.fw[2] = 2;
    in.fw[3] = 0;

    uint8_t payload[DH_STATUS_PAYLOAD_SIZE];
    CHECK(dh_status_encode(payload, sizeof payload, &in) ==
          (size_t)DH_STATUS_PAYLOAD_SIZE);
    CHECK(payload[0] == DH_STATE_ONLINE);
    CHECK(payload[1] == 97);
    CHECK(payload[2] == 1 && payload[3] == 0);  /* fw components, LE */
    CHECK(payload[4] == 4 && payload[5] == 0);
    CHECK(payload[6] == 2 && payload[7] == 0);
    CHECK(payload[8] == 0 && payload[9] == 0);
    CHECK(payload[10] == 0 && payload[11] == 0);  /* reserved bytes zeroed */

    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_STATUS,
                               (uint8_t)DH_FLAG_HAS_CRC, 777u, 1730000000999LL,
                               payload, (size_t)DH_STATUS_PAYLOAD_SIZE);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_STATUS_PAYLOAD_SIZE);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.msgType == DH_MSG_STATUS);
    CHECK(f.payloadLen == DH_STATUS_PAYLOAD_SIZE);
    CHECK(f.seq == 777u);
    CHECK(f.ts == 1730000000999LL);
    CHECK(frame[22] == DH_STATE_ONLINE);  /* payload starts right after the 22-byte prefix */
    CHECK(frame[23] == 97);

    DhStatus out;
    CHECK(dh_status_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.state == DH_STATE_ONLINE);
    CHECK(out.health == 97);
    CHECK(out.fw[0] == 1 && out.fw[1] == 4 && out.fw[2] == 2 && out.fw[3] == 0);

    /* byte-identical re-encode */
    uint8_t frame2[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    CHECK(dh_frame_encode(frame2, sizeof frame2, f.msgType, f.flags, f.seq, f.ts,
                          f.payload, f.payloadLen) == n);
    CHECK(memcmp(frame, frame2, n) == 0);

    /* the decoder ignores the reserved payload bytes */
    payload[10] = 0xAB;
    payload[11] = 0xCD;
    DhStatus rnd;
    CHECK(dh_status_decode(&rnd, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_OK);
    CHECK(rnd.state == DH_STATE_ONLINE);
    CHECK(rnd.health == 97);
    CHECK(rnd.fw[0] == 1 && rnd.fw[1] == 4 && rnd.fw[2] == 2 && rnd.fw[3] == 0);
    payload[10] = 0;
    payload[11] = 0;
}

/* -------------------------------------------------------------------- */
/* 5. ACK round trip                                                     */
/* -------------------------------------------------------------------- */

static void test_ack_roundtrip(void)
{
    uint8_t payload[DH_MAX_PAYLOAD];
    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];

    /* ack with detail text */
    DhAck in;
    memset(&in, 0, sizeof in);
    in.code = DH_ACK_CODE_OK;
    const char *detail = "command-42 executed";
    in.detailLen = (uint16_t)strlen(detail);
    memcpy(in.detail, detail, in.detailLen);

    size_t plen = dh_ack_encode(payload, sizeof payload, &in);
    CHECK(plen == (size_t)DH_ACK_PAYLOAD_MIN + strlen(detail));
    CHECK(payload[0] == DH_ACK_CODE_OK);
    CHECK(payload[1] == (uint8_t)(in.detailLen & 0xFFu));
    CHECK(payload[2] == (uint8_t)((in.detailLen >> 8) & 0xFFu));
    CHECK(memcmp(payload + 3, detail, in.detailLen) == 0);

    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                               (uint8_t)DH_FLAG_HAS_CRC, 1000u, 5000LL, payload, plen);
    CHECK(n == (size_t)DH_HEADER_SIZE + plen);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.msgType == DH_MSG_ACK);
    CHECK(f.payloadLen == plen);

    DhAck out;
    CHECK(dh_ack_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.code == DH_ACK_CODE_OK);
    CHECK(out.detailLen == in.detailLen);
    CHECK(memcmp(out.detail, detail, in.detailLen) == 0);
    CHECK(out.detail[out.detailLen] == '\0');

    /* rejected ack with a different detail */
    DhAck rej;
    memset(&rej, 0, sizeof rej);
    rej.code = DH_ACK_CODE_REJECTED;
    const char *why = "payload too large";
    rej.detailLen = (uint16_t)strlen(why);
    memcpy(rej.detail, why, rej.detailLen);
    CHECK(dh_ack_encode(payload, sizeof payload, &rej) ==
          (size_t)DH_ACK_PAYLOAD_MIN + strlen(why));
    n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                        (uint8_t)DH_FLAG_HAS_CRC, 1001u, 5001LL, payload,
                        (size_t)DH_ACK_PAYLOAD_MIN + strlen(why));
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(dh_ack_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.code == DH_ACK_CODE_REJECTED);
    CHECK(out.detailLen == (uint16_t)strlen(why));
    CHECK(memcmp(out.detail, why, out.detailLen) == 0);

    /* empty detail: minimum-size ack payload */
    DhAck empty;
    memset(&empty, 0, sizeof empty);
    empty.code = DH_ACK_CODE_UNSUPPORTED;
    empty.detailLen = 0;
    CHECK(dh_ack_encode(payload, sizeof payload, &empty) == (size_t)DH_ACK_PAYLOAD_MIN);
    n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                        (uint8_t)DH_FLAG_HAS_CRC, 1002u, 5002LL, payload,
                        (size_t)DH_ACK_PAYLOAD_MIN);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_ACK_PAYLOAD_MIN);
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(dh_ack_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.code == DH_ACK_CODE_UNSUPPORTED);
    CHECK(out.detailLen == 0);
    CHECK(out.detail[0] == '\0');

    /* maximum-length detail fills a maximum-size payload */
    DhAck big;
    memset(&big, 0, sizeof big);
    big.code = DH_ACK_CODE_ERROR;
    big.detailLen = (uint16_t)DH_DETAIL_MAX;
    for (uint16_t i = 0; i < big.detailLen; ++i) {
        big.detail[i] = (char)('a' + (i % 26));
    }
    CHECK(dh_ack_encode(payload, sizeof payload, &big) == (size_t)DH_MAX_PAYLOAD);
    n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                        (uint8_t)DH_FLAG_HAS_CRC, 0xFFFFFFFFu, 0LL, payload,
                        (size_t)DH_MAX_PAYLOAD);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_MAX_PAYLOAD);
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    DhAck obig;
    CHECK(dh_ack_decode(&obig, f.payload, f.payloadLen) == DH_OK);
    CHECK(obig.detailLen == (uint16_t)DH_DETAIL_MAX);
    CHECK(memcmp(obig.detail, big.detail, DH_DETAIL_MAX) == 0);
}

/* -------------------------------------------------------------------- */
/* 6. ERROR round trip                                                   */
/* -------------------------------------------------------------------- */

static void test_error_roundtrip(void)
{
    DhError in;
    memset(&in, 0, sizeof in);
    in.errorCode = 500;
    const char *msg = "sensor bus fault";
    in.messageLen = (uint16_t)strlen(msg);
    memcpy(in.message, msg, in.messageLen);

    uint8_t payload[DH_MAX_PAYLOAD];
    size_t plen = dh_error_encode(payload, sizeof payload, &in);
    CHECK(plen == (size_t)DH_ERROR_PAYLOAD_MIN + strlen(msg));
    CHECK(payload[0] == 0xF4 && payload[1] == 0x01);  /* errorCode 500 LE */
    CHECK(memcmp(payload + 2, msg, strlen(msg)) == 0);

    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ERROR,
                               (uint8_t)DH_FLAG_HAS_CRC, 9u, 42LL, payload, plen);
    CHECK(n == (size_t)DH_HEADER_SIZE + plen);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.msgType == DH_MSG_ERROR);
    CHECK(f.payloadLen == plen);

    DhError out;
    CHECK(dh_error_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.errorCode == 500);
    CHECK(out.messageLen == (uint16_t)strlen(msg));
    CHECK(memcmp(out.message, msg, out.messageLen) == 0);
    CHECK(out.message[out.messageLen] == '\0');

    /* empty message: minimum-size error payload */
    in.messageLen = 0;
    CHECK(dh_error_encode(payload, sizeof payload, &in) == (size_t)DH_ERROR_PAYLOAD_MIN);
    n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ERROR,
                        (uint8_t)DH_FLAG_HAS_CRC, 10u, 43LL, payload,
                        (size_t)DH_ERROR_PAYLOAD_MIN);
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(dh_error_decode(&out, f.payload, f.payloadLen) == DH_OK);
    CHECK(out.errorCode == 500);
    CHECK(out.messageLen == 0);
    CHECK(out.message[0] == '\0');
}

/* -------------------------------------------------------------------- */
/* 7. COMMAND frames (opaque payload, including empty)                   */
/* -------------------------------------------------------------------- */

static void test_command_roundtrip(void)
{
    const uint8_t cmd[6] = { 'r', 'e', 'b', 'o', 'o', 't' };
    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];

    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND,
                               (uint8_t)DH_FLAG_HAS_CRC, 42u, 0LL, cmd, sizeof cmd);
    CHECK(n == (size_t)DH_HEADER_SIZE + sizeof cmd);
    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.msgType == DH_MSG_COMMAND);
    CHECK(f.payloadLen == sizeof cmd);
    CHECK(memcmp(f.payload, cmd, sizeof cmd) == 0);

    /* empty command payload is legal (COMMAND has no length constraints) */
    n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0u, 42u, 0LL,
                        NULL, 0u);
    CHECK(n == (size_t)DH_HEADER_SIZE);
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.payloadLen == 0);
}

/* -------------------------------------------------------------------- */
/* 8. Frames without the has_crc flag                                    */
/* -------------------------------------------------------------------- */

static void test_frame_without_crc(void)
{
    DhTelemetry t = { DH_METRIC_HUMIDITY, DH_QUALITY_SUSPECT, 55.25 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    uint8_t frame[64];
    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY, 0u,
                               7u, 1000LL, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    CHECK(frame[3] == 0);
    CHECK(frame[18] == 0 && frame[19] == 0 && frame[20] == 0 && frame[21] == 0);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    CHECK(f.flags == 0);

    /* the stored CRC field is ignored when has_crc is clear */
    frame[18] ^= 0xA5u;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
}

/* -------------------------------------------------------------------- */
/* 9-11. Decode rejections: magic, version, flags                       */
/* -------------------------------------------------------------------- */

static void test_reject_bad_magic(void)
{
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 20.0 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[64];
    const size_t n = t_telemetry_frame(frame, sizeof frame, payload);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    DhFrame f;
    const uint8_t good = frame[0];
    frame[0] = 0xD5;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_MAGIC);
    frame[0] = 0x00;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_MAGIC);
    frame[0] = 0xFF;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_MAGIC);
    frame[0] = good;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);  /* sanity: restored */
}

static void test_reject_bad_version(void)
{
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 20.0 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[64];
    const size_t n = t_telemetry_frame(frame, sizeof frame, payload);

    DhFrame f;
    const uint8_t good = frame[1];
    frame[1] = 0x00;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_VERSION);
    frame[1] = 0x02;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_VERSION);
    frame[1] = 0xFF;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_VERSION);
    frame[1] = good;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
}

static void test_reject_reserved_flags(void)
{
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 20.0 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[64];
    const size_t n = t_telemetry_frame(frame, sizeof frame, payload);

    DhFrame f;
    const uint8_t good = frame[3];
    frame[3] = 0x02;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_FLAGS);
    frame[3] = 0x80;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_FLAGS);
    frame[3] = 0xFF;
    CHECK(dh_frame_decode(&f, frame, n) == DH_ERR_FLAGS);
    frame[3] = good;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
}

/* -------------------------------------------------------------------- */
/* 12. payloadLen exceeding the supplied buffer                          */
/* -------------------------------------------------------------------- */

static void test_reject_payloadlen_exceeds_buffer(void)
{
    uint8_t payload[40];
    memset(payload, 0xAB, sizeof payload);
    uint8_t frame[DH_HEADER_SIZE + 40];
    const size_t n = t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND,
                                  (uint8_t)DH_FLAG_HAS_CRC, 1u, 2LL, payload, 40u);
    CHECK(n == (size_t)DH_HEADER_SIZE + 40u);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n - 1u) == DH_ERR_TRUNCATED);   /* one byte short */
    CHECK(dh_frame_decode(&f, frame, n - 40u) == DH_ERR_TRUNCATED);  /* payload partly missing */
    CHECK(dh_frame_decode(&f, frame, (size_t)DH_HEADER_SIZE) == DH_ERR_TRUNCATED); /* payload missing */
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);                   /* sanity */

    /* trailing garbage after a complete frame is also rejected */
    uint8_t longer[DH_HEADER_SIZE + 41];
    memcpy(longer, frame, n);
    longer[n] = 0x00;
    CHECK(dh_frame_decode(&f, longer, n + 1u) == DH_ERR_TRUNCATED);
}

/* -------------------------------------------------------------------- */
/* 13. payloadLen above the 1024-byte protocol maximum                   */
/* -------------------------------------------------------------------- */

static void test_reject_payloadlen_over_max(void)
{
    DhFrame f;

    static uint8_t buf[DH_HEADER_SIZE + 1025];
    memset(buf, 0, sizeof buf);
    buf[0] = (uint8_t)DH_MAGIC;
    buf[1] = (uint8_t)DH_PROTOCOL_VERSION;
    buf[2] = (uint8_t)DH_MSG_COMMAND;
    buf[3] = 0u;
    t_put16(buf + 4, 1025u);
    CHECK(dh_frame_decode(&f, buf, sizeof buf) == DH_ERR_LENGTH);

    static uint8_t buf65535[DH_HEADER_SIZE + 65535u];
    memset(buf65535, 0, sizeof buf65535);
    buf65535[0] = (uint8_t)DH_MAGIC;
    buf65535[1] = (uint8_t)DH_PROTOCOL_VERSION;
    buf65535[2] = (uint8_t)DH_MSG_COMMAND;
    buf65535[3] = 0u;
    t_put16(buf65535 + 4, 65535u);
    CHECK(dh_frame_decode(&f, buf65535, sizeof buf65535) == DH_ERR_LENGTH);

    /* boundary: exactly 1024 is accepted */
    static uint8_t buf1024[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    memset(buf1024, 0x5A, sizeof buf1024);
    buf1024[0] = (uint8_t)DH_MAGIC;
    buf1024[1] = (uint8_t)DH_PROTOCOL_VERSION;
    buf1024[2] = (uint8_t)DH_MSG_COMMAND;
    buf1024[3] = (uint8_t)DH_FLAG_HAS_CRC;
    t_put16(buf1024 + 4, (uint16_t)DH_MAX_PAYLOAD);
    uint8_t body[18 + DH_MAX_PAYLOAD];
    memcpy(body, buf1024, 18);
    memcpy(body + 18, buf1024 + DH_HEADER_SIZE, DH_MAX_PAYLOAD);
    t_put32(buf1024 + 18, dh_crc32(body, sizeof body));
    CHECK(dh_frame_decode(&f, buf1024, sizeof buf1024) == DH_OK);
    CHECK(f.payloadLen == DH_MAX_PAYLOAD);
}

/* -------------------------------------------------------------------- */
/* 14. Corrupted CRC                                                     */
/* -------------------------------------------------------------------- */

static void test_reject_corrupted_crc(void)
{
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 21.5 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[64];
    const size_t n = t_telemetry_frame(frame, sizeof frame, payload);
    const size_t frame_total = (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE;
    CHECK(n == frame_total);

    DhFrame f;
    frame[22] ^= 0x01;  /* corrupt first payload byte */
    CHECK(dh_frame_decode(&f, frame, frame_total) == DH_ERR_CRC);
    frame[22] ^= 0x01;

    frame[18] ^= 0x01;  /* corrupt the CRC field itself */
    CHECK(dh_frame_decode(&f, frame, frame_total) == DH_ERR_CRC);
    frame[18] ^= 0x01;

    frame[10] ^= 0x80;  /* corrupt a ts byte: header is covered by the CRC */
    CHECK(dh_frame_decode(&f, frame, frame_total) == DH_ERR_CRC);
    frame[10] ^= 0x80;

    frame[6] ^= 0x40;  /* corrupt a seq byte */
    CHECK(dh_frame_decode(&f, frame, frame_total) == DH_ERR_CRC);
    frame[6] ^= 0x40;

    CHECK(dh_frame_decode(&f, frame, frame_total) == DH_OK);  /* sanity: restored */
}

/* -------------------------------------------------------------------- */
/* 15. Truncated input / NULL arguments                                  */
/* -------------------------------------------------------------------- */

static void test_reject_truncated_header(void)
{
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 20.0 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[64];
    const size_t n = t_telemetry_frame(frame, sizeof frame, payload);
    CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, 0) == DH_ERR_SHORT);
    CHECK(dh_frame_decode(&f, frame, 1) == DH_ERR_SHORT);
    CHECK(dh_frame_decode(&f, frame, 10) == DH_ERR_SHORT);
    CHECK(dh_frame_decode(&f, frame, 21) == DH_ERR_SHORT);
    CHECK(dh_frame_decode(&f, frame, (size_t)DH_HEADER_SIZE) == DH_ERR_TRUNCATED);
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);  /* sanity */

    CHECK(dh_frame_decode(NULL, frame, n) == DH_ERR_NULL);
    CHECK(dh_frame_decode(&f, NULL, n) == DH_ERR_NULL);
    CHECK(dh_frame_decode(NULL, NULL, 0) == DH_ERR_NULL);
}

/* -------------------------------------------------------------------- */
/* 16. Wrong payload length per message type                             */
/* -------------------------------------------------------------------- */

static void test_reject_wrong_payload_len_per_type(void)
{
    uint8_t payload[16];
    memset(payload, 0, sizeof payload);
    uint8_t frame[DH_HEADER_SIZE + 16];
    DhFrame f;

    /* telemetry must be exactly 11 bytes: 10 and 12 are rejected */
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 10u) == 32u);
    CHECK(dh_frame_decode(&f, frame, 32u) == DH_ERR_PAYLOAD);
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 12u) == 34u);
    CHECK(dh_frame_decode(&f, frame, 34u) == DH_ERR_PAYLOAD);
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 0u) == 22u);
    CHECK(dh_frame_decode(&f, frame, 22u) == DH_ERR_PAYLOAD);

    /* status must be exactly 12 bytes: 11 and 13 are rejected */
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_STATUS,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 11u) == 33u);
    CHECK(dh_frame_decode(&f, frame, 33u) == DH_ERR_PAYLOAD);
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_STATUS,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 13u) == 35u);
    CHECK(dh_frame_decode(&f, frame, 35u) == DH_ERR_PAYLOAD);

    /* ack payload shorter than the 3-byte minimum */
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 2u) == 24u);
    CHECK(dh_frame_decode(&f, frame, 24u) == DH_ERR_PAYLOAD);

    /* error payload shorter than the 2-byte minimum */
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_ERROR,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 1u) == 23u);
    CHECK(dh_frame_decode(&f, frame, 23u) == DH_ERR_PAYLOAD);

    /* unknown message types */
    CHECK(t_make_frame(frame, sizeof frame, 0u, (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL,
                       payload, 4u) == 26u);
    CHECK(dh_frame_decode(&f, frame, 26u) == DH_ERR_PAYLOAD);
    CHECK(t_make_frame(frame, sizeof frame, 6u, (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL,
                       payload, 4u) == 26u);
    CHECK(dh_frame_decode(&f, frame, 26u) == DH_ERR_PAYLOAD);
    CHECK(t_make_frame(frame, sizeof frame, 255u, (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL,
                       payload, 4u) == 26u);
    CHECK(dh_frame_decode(&f, frame, 26u) == DH_ERR_PAYLOAD);

    /* sanity: command accepts any payload length */
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 4u) == 26u);
    CHECK(dh_frame_decode(&f, frame, 26u) == DH_OK);
}

/* -------------------------------------------------------------------- */
/* 17. Invalid telemetry field values                                    */
/* -------------------------------------------------------------------- */

static void test_reject_invalid_telemetry_fields(void)
{
    DhTelemetry out;
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];

    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 1.0 };
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    /* invalid quality codes */
    payload[2] = 3;
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_RANGE);
    payload[2] = 255;
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_RANGE);
    payload[2] = (uint8_t)DH_QUALITY_GOOD;

    /* invalid metric ids: 0, 11, 65535 */
    t_put16(payload, 0);
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_RANGE);
    t_put16(payload, 11);
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_RANGE);
    t_put16(payload, 65535);
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_RANGE);
    t_put16(payload, (uint16_t)DH_METRIC_TEMPERATURE);

    /* boundary metric ids are accepted */
    t_put16(payload, (uint16_t)DH_METRIC_TEMPERATURE);
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);
    t_put16(payload, (uint16_t)DH_METRIC_STATUS);
    CHECK(dh_telemetry_decode(&out, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);

    /* through a full frame: frame decode is structural, payload decode fails */
    payload[2] = 7;  /* invalid quality on the wire */
    uint8_t frame[64];
    CHECK(t_telemetry_frame(frame, sizeof frame, payload) ==
          (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, (size_t)DH_HEADER_SIZE +
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);
    CHECK(dh_telemetry_decode(&out, f.payload, f.payloadLen) == DH_ERR_RANGE);
    payload[2] = (uint8_t)DH_QUALITY_GOOD;

    /* wrong payload length at the payload-decode level */
    CHECK(dh_telemetry_decode(&out, payload, 10u) == DH_ERR_PAYLOAD);
    CHECK(dh_telemetry_decode(&out, payload, 12u) == DH_ERR_PAYLOAD);
    CHECK(dh_telemetry_decode(&out, payload, 0u) == DH_ERR_PAYLOAD);

    /* NULL arguments */
    CHECK(dh_telemetry_decode(NULL, payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_NULL);
    CHECK(dh_telemetry_decode(&out, NULL, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) ==
          DH_ERR_NULL);
}

/* -------------------------------------------------------------------- */
/* 18. Invalid status field values                                       */
/* -------------------------------------------------------------------- */

static void test_reject_invalid_status_fields(void)
{
    DhStatus out;
    uint8_t payload[DH_STATUS_PAYLOAD_SIZE];

    DhStatus s = { DH_STATE_ONLINE, 90, { 1, 0, 0, 0 } };
    CHECK(dh_status_encode(payload, sizeof payload, &s) ==
          (size_t)DH_STATUS_PAYLOAD_SIZE);

    /* invalid state codes */
    payload[0] = 8;
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_ERR_RANGE);
    payload[0] = 255;
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_ERR_RANGE);
    payload[0] = (uint8_t)DH_STATE_RETIRED;  /* highest valid state */
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_OK);
    payload[0] = (uint8_t)DH_STATE_ONLINE;

    /* invalid health percentages */
    payload[1] = 101;
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_ERR_RANGE);
    payload[1] = 255;
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_ERR_RANGE);
    payload[1] = 100;  /* boundary is valid */
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_OK);
    CHECK(out.health == 100);
    payload[1] = 0;    /* boundary is valid */
    CHECK(dh_status_decode(&out, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_OK);

    /* wrong payload length */
    CHECK(dh_status_decode(&out, payload, 11u) == DH_ERR_PAYLOAD);
    CHECK(dh_status_decode(&out, payload, 13u) == DH_ERR_PAYLOAD);

    /* NULL arguments */
    CHECK(dh_status_decode(NULL, payload, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_ERR_NULL);
    CHECK(dh_status_decode(&out, NULL, (size_t)DH_STATUS_PAYLOAD_SIZE) == DH_ERR_NULL);
}

/* -------------------------------------------------------------------- */
/* 19. ACK decode rejections                                             */
/* -------------------------------------------------------------------- */

static void test_ack_decode_rejects(void)
{
    DhAck out;
    uint8_t p[16];
    p[0] = (uint8_t)DH_ACK_CODE_OK;
    t_put16(p + 1, 5u);
    memset(p + 3, 'x', 5);

    CHECK(dh_ack_decode(&out, p, 8u) == DH_OK);       /* 3 + 5 detail bytes */
    CHECK(out.detailLen == 5);
    CHECK(out.detail[0] == 'x' && out.detail[4] == 'x');
    CHECK(dh_ack_decode(&out, p, 7u) == DH_ERR_PAYLOAD);  /* detail truncated */
    CHECK(dh_ack_decode(&out, p, 9u) == DH_ERR_PAYLOAD);  /* extra byte */
    CHECK(dh_ack_decode(&out, p, 2u) == DH_ERR_PAYLOAD);  /* below minimum */

    p[0] = 4;   /* invalid ack code */
    CHECK(dh_ack_decode(&out, p, 8u) == DH_ERR_RANGE);
    p[0] = 255;
    CHECK(dh_ack_decode(&out, p, 8u) == DH_ERR_RANGE);

    CHECK(dh_ack_decode(NULL, p, 8u) == DH_ERR_NULL);
    CHECK(dh_ack_decode(&out, NULL, 8u) == DH_ERR_NULL);

    /* frame-level: a 2-byte ack payload is rejected by dh_frame_decode */
    uint8_t two[2] = { 0, 0 };
    uint8_t frame[64];
    CHECK(t_make_frame(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                       (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, two, 2u) == 24u);
    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, 24u) == DH_ERR_PAYLOAD);
}

/* -------------------------------------------------------------------- */
/* 20. Boundary values: doubles and NaN bit patterns                     */
/* -------------------------------------------------------------------- */

static void test_telemetry_boundary_values(void)
{
    static const double values[] = {
        0.0, -273.15, DBL_MAX, -DBL_MAX, -0.0, 1.0e-300
    };
    for (size_t i = 0; i < sizeof values / sizeof values[0]; ++i) {
        DhTelemetry in = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, values[i] };
        uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
        CHECK(dh_telemetry_encode(payload, sizeof payload, &in) ==
              (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        DhTelemetry out;
        CHECK(dh_telemetry_decode(&out, payload,
                                  (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);
        uint64_t want, got;
        memcpy(&want, &values[i], sizeof want);
        memcpy(&got, &out.value, sizeof got);
        CHECK(got == want);              /* bit-exact transport */
        CHECK(out.value == values[i]);   /* and numeric equality */
    }

    /* NaN: the exact bit pattern must survive the round trip */
    static const uint64_t nanPatterns[] = {
        0x7FF8000000000001ULL,  /* quiet NaN with payload bit */
        0xFFF8000000000001ULL,  /* negative quiet NaN */
        0x7FF0000000000001ULL   /* signaling NaN */
    };
    for (size_t i = 0; i < sizeof nanPatterns / sizeof nanPatterns[0]; ++i) {
        double nanValue;
        memcpy(&nanValue, &nanPatterns[i], sizeof nanValue);
        CHECK(isnan(nanValue));
        DhTelemetry in = { DH_METRIC_VOLTAGE, DH_QUALITY_BAD, nanValue };
        uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
        CHECK(dh_telemetry_encode(payload, sizeof payload, &in) ==
              (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        /* wire bytes must be the little-endian image of the original bits */
        for (int b = 0; b < 8; ++b) {
            CHECK(payload[3 + b] == (uint8_t)(nanPatterns[i] >> (8 * b)));
        }
        DhTelemetry out;
        CHECK(dh_telemetry_decode(&out, payload,
                                  (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);
        CHECK(isnan(out.value));
        uint64_t got;
        memcpy(&got, &out.value, sizeof got);
        CHECK(got == nanPatterns[i]);
    }

    /* NaN survives a full frame round trip too */
    double nanValue;
    const uint64_t bits = 0x7FF8000000000001ULL;
    memcpy(&nanValue, &bits, sizeof nanValue);
    DhTelemetry in = { DH_METRIC_CURRENT, DH_QUALITY_SUSPECT, nanValue };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &in) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                               (uint8_t)DH_FLAG_HAS_CRC, 5u, 60LL, payload,
                               (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
    DhTelemetry out;
    CHECK(dh_telemetry_decode(&out, f.payload, f.payloadLen) == DH_OK);
    uint64_t got;
    memcpy(&got, &out.value, sizeof got);
    CHECK(got == bits);

    /* every defined metric id and quality code round trips */
    for (uint16_t m = (uint16_t)DH_METRIC_TEMPERATURE;
         m <= (uint16_t)DH_METRIC_STATUS; ++m) {
        DhTelemetry vin = { m, DH_QUALITY_SUSPECT, 3.5 };
        uint8_t p[DH_TELEMETRY_PAYLOAD_SIZE];
        CHECK(dh_telemetry_encode(p, sizeof p, &vin) ==
              (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        DhTelemetry vout;
        CHECK(dh_telemetry_decode(&vout, p, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);
        CHECK(vout.metricId == m);
        CHECK(vout.quality == DH_QUALITY_SUSPECT);
        CHECK(vout.value == 3.5);
    }
    for (uint8_t q = 0; q <= (uint8_t)DH_QUALITY_BAD; ++q) {
        DhTelemetry vin = { DH_METRIC_ENERGY, q, -12.75 };
        uint8_t p[DH_TELEMETRY_PAYLOAD_SIZE];
        CHECK(dh_telemetry_encode(p, sizeof p, &vin) ==
              (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        DhTelemetry vout;
        CHECK(dh_telemetry_decode(&vout, p, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == DH_OK);
        CHECK(vout.quality == q);
    }
}

/* -------------------------------------------------------------------- */
/* 21. Sequence number and timestamp boundaries                          */
/* -------------------------------------------------------------------- */

static void test_seq_ts_boundaries(void)
{
    DhTelemetry t = { DH_METRIC_PRESSURE, DH_QUALITY_GOOD, 101.325 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    DhFrame f;

    /* sequence number boundaries */
    static const uint32_t seqs[] = { 0u, 1u, 12345u, 0xFFFFFFFEu, 0xFFFFFFFFu };
    for (size_t i = 0; i < sizeof seqs / sizeof seqs[0]; ++i) {
        size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                                   (uint8_t)DH_FLAG_HAS_CRC, seqs[i], 0LL, payload,
                                   (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
        CHECK(f.seq == seqs[i]);
    }
    /* UINT32_MAX must serialize as FF FF FF FF at offsets 6..9 */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 0xFFFFFFFFu, 0LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) != 0);
    CHECK(frame[6] == 0xFF && frame[7] == 0xFF && frame[8] == 0xFF && frame[9] == 0xFF);
    /* seq = 0 serializes as all zero bytes */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 0u, 0LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) != 0);
    CHECK(frame[6] == 0 && frame[7] == 0 && frame[8] == 0 && frame[9] == 0);

    /* timestamp boundaries: 0, pre-epoch negatives, INT64 extremes */
    static const int64_t tss[] = {
        0LL, -1LL, -86400000LL, -2208988800000LL, 1730000000123LL,
        INT64_MAX, INT64_MIN
    };
    for (size_t i = 0; i < sizeof tss / sizeof tss[0]; ++i) {
        size_t n = dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                                   (uint8_t)DH_FLAG_HAS_CRC, 1u, tss[i], payload,
                                   (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        CHECK(n == (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE);
        CHECK(dh_frame_decode(&f, frame, n) == DH_OK);
        CHECK(f.ts == tss[i]);
    }
    /* ts = 0 -> all zero bytes; ts = -1 -> all 0xFF bytes */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 0LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) != 0);
    for (int b = 0; b < 8; ++b) {
        CHECK(frame[10 + b] == 0x00);
    }
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, -1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) != 0);
    for (int b = 0; b < 8; ++b) {
        CHECK(frame[10 + b] == 0xFF);
    }
    /* INT64_MAX -> sign bit clear, everything else set */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, INT64_MAX, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) != 0);
    for (int b = 0; b < 7; ++b) {
        CHECK(frame[10 + b] == 0xFF);
    }
    CHECK(frame[17] == 0x7F);
}

/* -------------------------------------------------------------------- */
/* 22. Frame encode rejections                                           */
/* -------------------------------------------------------------------- */

static void test_encode_rejects_invalid_input(void)
{
    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 20.0 };
    uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
    CHECK(dh_telemetry_encode(payload, sizeof payload, &t) ==
          (size_t)DH_TELEMETRY_PAYLOAD_SIZE);

    uint8_t frame[DH_HEADER_SIZE + DH_MAX_PAYLOAD];
    const size_t need = (size_t)DH_HEADER_SIZE + (size_t)DH_TELEMETRY_PAYLOAD_SIZE;

    /* buffer too small */
    CHECK(dh_frame_encode(frame, need - 1u, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    CHECK(dh_frame_encode(frame, (size_t)DH_HEADER_SIZE, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    CHECK(dh_frame_encode(frame, 1u, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    CHECK(dh_frame_encode(frame, 0u, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    /* exact capacity succeeds */
    CHECK(dh_frame_encode(frame, need, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == need);

    /* NULL output */
    CHECK(dh_frame_encode(NULL, need, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    /* NULL payload with non-zero length */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, NULL,
                          (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    /* NULL payload with zero length is fine (empty command frame) */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0u, 1u, 1LL,
                          NULL, 0u) == (size_t)DH_HEADER_SIZE);

    /* payload longer than the protocol maximum */
    uint8_t big[DH_MAX_PAYLOAD + 1u];
    memset(big, 1, sizeof big);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0u, 1u, 1LL,
                          big, (size_t)DH_MAX_PAYLOAD + 1u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0u, 1u, 1LL,
                          big, 65536u) == 0);
    /* exactly the maximum is allowed */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, big,
                          (size_t)DH_MAX_PAYLOAD) ==
          (size_t)DH_HEADER_SIZE + (size_t)DH_MAX_PAYLOAD);
    DhFrame f;
    CHECK(dh_frame_decode(&f, frame, (size_t)DH_HEADER_SIZE + (size_t)DH_MAX_PAYLOAD) ==
          DH_OK);

    /* invalid message types */
    CHECK(dh_frame_encode(frame, sizeof frame, 0u, (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL,
                          payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, 6u, (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL,
                          payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, 255u, (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL,
                          payload, (size_t)DH_TELEMETRY_PAYLOAD_SIZE) == 0);

    /* reserved flag bits */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0x02, 1u, 1LL,
                          payload, 4u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0x80, 1u, 1LL,
                          payload, 4u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_COMMAND, 0xFF, 1u, 1LL,
                          payload, 4u) == 0);

    /* payload length inconsistent with the message type */
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 10u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_TELEMETRY,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 12u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_STATUS,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 11u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ACK,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 2u) == 0);
    CHECK(dh_frame_encode(frame, sizeof frame, (uint8_t)DH_MSG_ERROR,
                          (uint8_t)DH_FLAG_HAS_CRC, 1u, 1LL, payload, 1u) == 0);
}

/* -------------------------------------------------------------------- */
/* 23. Payload encode rejections                                         */
/* -------------------------------------------------------------------- */

static void test_payload_encode_rejects(void)
{
    uint8_t buf[DH_MAX_PAYLOAD];

    DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 1.0 };
    CHECK(dh_telemetry_encode(buf, 10u, &t) == 0);
    CHECK(dh_telemetry_encode(NULL, (size_t)DH_TELEMETRY_PAYLOAD_SIZE, &t) == 0);
    CHECK(dh_telemetry_encode(buf, (size_t)DH_TELEMETRY_PAYLOAD_SIZE, NULL) == 0);
    DhTelemetry badMetric = { 0, DH_QUALITY_GOOD, 1.0 };
    CHECK(dh_telemetry_encode(buf, sizeof buf, &badMetric) == 0);
    DhTelemetry badMetric2 = { 11, DH_QUALITY_GOOD, 1.0 };
    CHECK(dh_telemetry_encode(buf, sizeof buf, &badMetric2) == 0);
    DhTelemetry badQuality = { DH_METRIC_TEMPERATURE, 3, 1.0 };
    CHECK(dh_telemetry_encode(buf, sizeof buf, &badQuality) == 0);

    DhStatus s = { DH_STATE_ONLINE, 50, { 1, 0, 0, 0 } };
    CHECK(dh_status_encode(buf, 11u, &s) == 0);
    CHECK(dh_status_encode(NULL, (size_t)DH_STATUS_PAYLOAD_SIZE, &s) == 0);
    CHECK(dh_status_encode(buf, (size_t)DH_STATUS_PAYLOAD_SIZE, NULL) == 0);
    DhStatus badState = { 8, 50, { 0, 0, 0, 0 } };
    CHECK(dh_status_encode(buf, sizeof buf, &badState) == 0);
    DhStatus badHealth = { DH_STATE_ONLINE, 101, { 0, 0, 0, 0 } };
    CHECK(dh_status_encode(buf, sizeof buf, &badHealth) == 0);

    DhAck a;
    memset(&a, 0, sizeof a);
    a.code = (uint8_t)DH_ACK_CODE_OK;
    a.detailLen = 5;
    CHECK(dh_ack_encode(buf, 7u, &a) == 0);          /* needs 8 */
    CHECK(dh_ack_encode(buf, 8u, &a) == 8u);
    CHECK(dh_ack_encode(NULL, 8u, &a) == 0);
    a.code = 4;
    CHECK(dh_ack_encode(buf, sizeof buf, &a) == 0);  /* invalid code */
    a.code = (uint8_t)DH_ACK_CODE_OK;
    a.detailLen = (uint16_t)(DH_DETAIL_MAX + 1u);
    CHECK(dh_ack_encode(buf, sizeof buf, &a) == 0);  /* detail too long */

    DhError e;
    memset(&e, 0, sizeof e);
    e.errorCode = 1;
    e.messageLen = 5;
    CHECK(dh_error_encode(buf, 6u, &e) == 0);        /* needs 7 */
    CHECK(dh_error_encode(buf, 7u, &e) == 7u);
    CHECK(dh_error_encode(NULL, 7u, &e) == 0);
    e.messageLen = (uint16_t)(DH_ERRMSG_MAX + 1u);
    CHECK(dh_error_encode(buf, sizeof buf, &e) == 0);
}

/* -------------------------------------------------------------------- */
/* 24. Name mappings                                                     */
/* -------------------------------------------------------------------- */

static void test_names(void)
{
    CHECK(strcmp(dh_metric_name(DH_METRIC_TEMPERATURE), "temperature") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_HUMIDITY), "humidity") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_PRESSURE), "pressure") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_MOTION), "motion") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_POWER), "power") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_ENERGY), "energy") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_VIBRATION), "vibration") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_VOLTAGE), "voltage") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_CURRENT), "current") == 0);
    CHECK(strcmp(dh_metric_name(DH_METRIC_STATUS), "status") == 0);
    CHECK(dh_metric_name(0) == NULL);
    CHECK(dh_metric_name(11) == NULL);
    CHECK(dh_metric_name(65535) == NULL);

    CHECK(strcmp(dh_state_name(DH_STATE_UNPROVISIONED), "UNPROVISIONED") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_PROVISIONED), "PROVISIONED") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_ONLINE), "ONLINE") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_OFFLINE), "OFFLINE") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_DEGRADED), "DEGRADED") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_MAINTENANCE), "MAINTENANCE") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_ERROR), "ERROR") == 0);
    CHECK(strcmp(dh_state_name(DH_STATE_RETIRED), "RETIRED") == 0);
    CHECK(dh_state_name(8) == NULL);
    CHECK(dh_state_name(255) == NULL);
}

/* -------------------------------------------------------------------- */
/* 25. Timestamp conversion                                              */
/* -------------------------------------------------------------------- */

static void test_ts_to_unix_seconds(void)
{
    CHECK(dh_ts_to_unix_seconds(0) == 0.0);
    CHECK(dh_ts_to_unix_seconds(1730000000000LL) == 1730000000.0);
    CHECK(dh_ts_to_unix_seconds(1234LL) == 1.234);
    CHECK(dh_ts_to_unix_seconds(999LL) == 0.999);
    CHECK(dh_ts_to_unix_seconds(-1500LL) == -1.5);
    CHECK(dh_ts_to_unix_seconds(-1LL) == -0.001);
    CHECK(dh_ts_to_unix_seconds(86400000LL) == 86400.0);
}

/* -------------------------------------------------------------------- */
/* 26. Decode result names                                               */
/* -------------------------------------------------------------------- */

static void test_decode_result_names(void)
{
    CHECK(strcmp(dh_decode_result_name(DH_OK), "ok") == 0);
    CHECK(strcmp(dh_decode_result_name(DH_ERR_CRC), "CRC-32 mismatch") == 0);
    CHECK(strcmp(dh_decode_result_name(DH_ERR_MAGIC), "bad magic byte") == 0);
    CHECK(dh_decode_result_name(DH_ERR_NULL) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_SHORT) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_VERSION) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_FLAGS) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_LENGTH) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_TRUNCATED) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_PAYLOAD) != NULL);
    CHECK(dh_decode_result_name(DH_ERR_RANGE) != NULL);
    CHECK(strcmp(dh_decode_result_name((DhDecodeResult)99), "unknown") == 0);
}

/* -------------------------------------------------------------------- */
/* main                                                                  */
/* -------------------------------------------------------------------- */

int main(void)
{
    printf("DeviceHub C Protocol Library - test suite\n");
    printf("=========================================\n\n");

    RUN_TEST(test_crc32_known_vectors);
    RUN_TEST(test_wire_layout);
    RUN_TEST(test_telemetry_roundtrip);
    RUN_TEST(test_status_roundtrip);
    RUN_TEST(test_ack_roundtrip);
    RUN_TEST(test_error_roundtrip);
    RUN_TEST(test_command_roundtrip);
    RUN_TEST(test_frame_without_crc);
    RUN_TEST(test_reject_bad_magic);
    RUN_TEST(test_reject_bad_version);
    RUN_TEST(test_reject_reserved_flags);
    RUN_TEST(test_reject_payloadlen_exceeds_buffer);
    RUN_TEST(test_reject_payloadlen_over_max);
    RUN_TEST(test_reject_corrupted_crc);
    RUN_TEST(test_reject_truncated_header);
    RUN_TEST(test_reject_wrong_payload_len_per_type);
    RUN_TEST(test_reject_invalid_telemetry_fields);
    RUN_TEST(test_reject_invalid_status_fields);
    RUN_TEST(test_ack_decode_rejects);
    RUN_TEST(test_telemetry_boundary_values);
    RUN_TEST(test_seq_ts_boundaries);
    RUN_TEST(test_encode_rejects_invalid_input);
    RUN_TEST(test_payload_encode_rejects);
    RUN_TEST(test_names);
    RUN_TEST(test_ts_to_unix_seconds);
    RUN_TEST(test_decode_result_names);

    printf("=========================================\n");
    printf("Tests:  %d run, %d passed, %d failed\n",
           tests_run, tests_run - tests_failed, tests_failed);
    printf("Checks: %d run, %d passed, %d failed\n",
           checks_run, checks_run - checks_failed, checks_failed);

    if (tests_failed == 0 && checks_failed == 0) {
        printf("RESULT: ALL TESTS PASSED\n");
        return 0;
    }
    printf("RESULT: TESTS FAILED\n");
    return 1;
}
