/* DeviceHub C Protocol Library — Copyright © 2026 Parsa Fathi — Apache-2.0 */
/**
 * @file dh_protocol.c
 *
 * Implementation of the DeviceHub binary wire protocol.
 *
 * Portable C11: no external dependencies, no assumptions about host
 * endianness or struct layout.  All multi-byte values are serialized and
 * parsed byte by byte, and floating point values are moved through
 * memcpy() so the code is free of strict-aliasing and alignment hazards.
 */
#include "dh_protocol.h"

#include <string.h>

/* -------------------------------------------------------------------- */
/* CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320)                  */
/* -------------------------------------------------------------------- */

/** Lookup table for the reflected CRC-32 polynomial 0xEDB88320. */
static const uint32_t kCrc32Table[256] = {
    0x00000000u, 0x77073096u, 0xEE0E612Cu, 0x990951BAu, 0x076DC419u, 0x706AF48Fu, 0xE963A535u, 0x9E6495A3u,
    0x0EDB8832u, 0x79DCB8A4u, 0xE0D5E91Eu, 0x97D2D988u, 0x09B64C2Bu, 0x7EB17CBDu, 0xE7B82D07u, 0x90BF1D91u,
    0x1DB71064u, 0x6AB020F2u, 0xF3B97148u, 0x84BE41DEu, 0x1ADAD47Du, 0x6DDDE4EBu, 0xF4D4B551u, 0x83D385C7u,
    0x136C9856u, 0x646BA8C0u, 0xFD62F97Au, 0x8A65C9ECu, 0x14015C4Fu, 0x63066CD9u, 0xFA0F3D63u, 0x8D080DF5u,
    0x3B6E20C8u, 0x4C69105Eu, 0xD56041E4u, 0xA2677172u, 0x3C03E4D1u, 0x4B04D447u, 0xD20D85FDu, 0xA50AB56Bu,
    0x35B5A8FAu, 0x42B2986Cu, 0xDBBBC9D6u, 0xACBCF940u, 0x32D86CE3u, 0x45DF5C75u, 0xDCD60DCFu, 0xABD13D59u,
    0x26D930ACu, 0x51DE003Au, 0xC8D75180u, 0xBFD06116u, 0x21B4F4B5u, 0x56B3C423u, 0xCFBA9599u, 0xB8BDA50Fu,
    0x2802B89Eu, 0x5F058808u, 0xC60CD9B2u, 0xB10BE924u, 0x2F6F7C87u, 0x58684C11u, 0xC1611DABu, 0xB6662D3Du,
    0x76DC4190u, 0x01DB7106u, 0x98D220BCu, 0xEFD5102Au, 0x71B18589u, 0x06B6B51Fu, 0x9FBFE4A5u, 0xE8B8D433u,
    0x7807C9A2u, 0x0F00F934u, 0x9609A88Eu, 0xE10E9818u, 0x7F6A0DBBu, 0x086D3D2Du, 0x91646C97u, 0xE6635C01u,
    0x6B6B51F4u, 0x1C6C6162u, 0x856530D8u, 0xF262004Eu, 0x6C0695EDu, 0x1B01A57Bu, 0x8208F4C1u, 0xF50FC457u,
    0x65B0D9C6u, 0x12B7E950u, 0x8BBEB8EAu, 0xFCB9887Cu, 0x62DD1DDFu, 0x15DA2D49u, 0x8CD37CF3u, 0xFBD44C65u,
    0x4DB26158u, 0x3AB551CEu, 0xA3BC0074u, 0xD4BB30E2u, 0x4ADFA541u, 0x3DD895D7u, 0xA4D1C46Du, 0xD3D6F4FBu,
    0x4369E96Au, 0x346ED9FCu, 0xAD678846u, 0xDA60B8D0u, 0x44042D73u, 0x33031DE5u, 0xAA0A4C5Fu, 0xDD0D7CC9u,
    0x5005713Cu, 0x270241AAu, 0xBE0B1010u, 0xC90C2086u, 0x5768B525u, 0x206F85B3u, 0xB966D409u, 0xCE61E49Fu,
    0x5EDEF90Eu, 0x29D9C998u, 0xB0D09822u, 0xC7D7A8B4u, 0x59B33D17u, 0x2EB40D81u, 0xB7BD5C3Bu, 0xC0BA6CADu,
    0xEDB88320u, 0x9ABFB3B6u, 0x03B6E20Cu, 0x74B1D29Au, 0xEAD54739u, 0x9DD277AFu, 0x04DB2615u, 0x73DC1683u,
    0xE3630B12u, 0x94643B84u, 0x0D6D6A3Eu, 0x7A6A5AA8u, 0xE40ECF0Bu, 0x9309FF9Du, 0x0A00AE27u, 0x7D079EB1u,
    0xF00F9344u, 0x8708A3D2u, 0x1E01F268u, 0x6906C2FEu, 0xF762575Du, 0x806567CBu, 0x196C3671u, 0x6E6B06E7u,
    0xFED41B76u, 0x89D32BE0u, 0x10DA7A5Au, 0x67DD4ACCu, 0xF9B9DF6Fu, 0x8EBEEFF9u, 0x17B7BE43u, 0x60B08ED5u,
    0xD6D6A3E8u, 0xA1D1937Eu, 0x38D8C2C4u, 0x4FDFF252u, 0xD1BB67F1u, 0xA6BC5767u, 0x3FB506DDu, 0x48B2364Bu,
    0xD80D2BDAu, 0xAF0A1B4Cu, 0x36034AF6u, 0x41047A60u, 0xDF60EFC3u, 0xA867DF55u, 0x316E8EEFu, 0x4669BE79u,
    0xCB61B38Cu, 0xBC66831Au, 0x256FD2A0u, 0x5268E236u, 0xCC0C7795u, 0xBB0B4703u, 0x220216B9u, 0x5505262Fu,
    0xC5BA3BBEu, 0xB2BD0B28u, 0x2BB45A92u, 0x5CB36A04u, 0xC2D7FFA7u, 0xB5D0CF31u, 0x2CD99E8Bu, 0x5BDEAE1Du,
    0x9B64C2B0u, 0xEC63F226u, 0x756AA39Cu, 0x026D930Au, 0x9C0906A9u, 0xEB0E363Fu, 0x72076785u, 0x05005713u,
    0x95BF4A82u, 0xE2B87A14u, 0x7BB12BAEu, 0x0CB61B38u, 0x92D28E9Bu, 0xE5D5BE0Du, 0x7CDCEFB7u, 0x0BDBDF21u,
    0x86D3D2D4u, 0xF1D4E242u, 0x68DDB3F8u, 0x1FDA836Eu, 0x81BE16CDu, 0xF6B9265Bu, 0x6FB077E1u, 0x18B74777u,
    0x88085AE6u, 0xFF0F6A70u, 0x66063BCAu, 0x11010B5Cu, 0x8F659EFFu, 0xF862AE69u, 0x616BFFD3u, 0x166CCF45u,
    0xA00AE278u, 0xD70DD2EEu, 0x4E048354u, 0x3903B3C2u, 0xA7672661u, 0xD06016F7u, 0x4969474Du, 0x3E6E77DBu,
    0xAED16A4Au, 0xD9D65ADCu, 0x40DF0B66u, 0x37D83BF0u, 0xA9BCAE53u, 0xDEBB9EC5u, 0x47B2CF7Fu, 0x30B5FFE9u,
    0xBDBDF21Cu, 0xCABAC28Au, 0x53B39330u, 0x24B4A3A6u, 0xBAD03605u, 0xCDD70693u, 0x54DE5729u, 0x23D967BFu,
    0xB3667A2Eu, 0xC4614AB8u, 0x5D681B02u, 0x2A6F2B94u, 0xB40BBE37u, 0xC30C8EA1u, 0x5A05DF1Bu, 0x2D02EF8Du
};

_Static_assert(DH_MAX_PAYLOAD >= DH_TELEMETRY_PAYLOAD_SIZE, "telemetry payload must fit");
_Static_assert(DH_MAX_PAYLOAD >= DH_STATUS_PAYLOAD_SIZE, "status payload must fit");

/**
 * Feed @p data into a running CRC-32 register.  @p state is the register
 * value before the call; the returned value is the register afterwards.
 * The final checksum is the register XOR 0xFFFFFFFF.
 */
static uint32_t crc32_update(uint32_t state, const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; ++i) {
        state = kCrc32Table[(state ^ data[i]) & 0xFFu] ^ (state >> 8);
    }
    return state;
}

uint32_t dh_crc32(const uint8_t *data, size_t len)
{
    return crc32_update(0xFFFFFFFFu, data, len) ^ 0xFFFFFFFFu;
}

/* -------------------------------------------------------------------- */
/* Little-endian serialization helpers                                   */
/* -------------------------------------------------------------------- */

static void put_u16le(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
}

static void put_u32le(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
    p[2] = (uint8_t)((v >> 16) & 0xFFu);
    p[3] = (uint8_t)((v >> 24) & 0xFFu);
}

static void put_u64le(uint8_t *p, uint64_t v)
{
    for (unsigned i = 0; i < 8; ++i) {
        p[i] = (uint8_t)((v >> (8u * i)) & 0xFFu);
    }
}

static void put_i64le(uint8_t *p, int64_t v)
{
    put_u64le(p, (uint64_t)v); /* conversion to unsigned is modulo 2^64 */
}

static void put_f64le(uint8_t *p, double v)
{
    uint64_t bits;
    memcpy(&bits, &v, sizeof bits);
    put_u64le(p, bits);
}

static uint16_t get_u16le(const uint8_t *p)
{
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t get_u32le(const uint8_t *p)
{
    return (uint32_t)p[0] |
           ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

static uint64_t get_u64le(const uint8_t *p)
{
    uint64_t v = 0;
    for (unsigned i = 0; i < 8; ++i) {
        v |= (uint64_t)p[i] << (8u * i);
    }
    return v;
}

static int64_t get_i64le(const uint8_t *p)
{
    uint64_t u = get_u64le(p);
    int64_t v;
    memcpy(&v, &u, sizeof v); /* bit-preserving reinterpretation */
    return v;
}

static double get_f64le(const uint8_t *p)
{
    uint64_t bits = get_u64le(p);
    double v;
    memcpy(&v, &bits, sizeof v);
    return v;
}

/* -------------------------------------------------------------------- */
/* Field validators                                                      */
/* -------------------------------------------------------------------- */

static int msg_type_valid(uint8_t msgType)
{
    return msgType >= (uint8_t)DH_MSG_TELEMETRY && msgType <= (uint8_t)DH_MSG_ERROR;
}

static int metric_id_valid(uint16_t metricId)
{
    return metricId >= (uint16_t)DH_METRIC_TEMPERATURE &&
           metricId <= (uint16_t)DH_METRIC_STATUS;
}

static int quality_valid(uint8_t quality)
{
    return quality <= (uint8_t)DH_QUALITY_BAD;
}

static int state_valid(uint8_t state)
{
    return state <= (uint8_t)DH_STATE_RETIRED;
}

static int ack_code_valid(uint8_t code)
{
    return code <= (uint8_t)DH_ACK_CODE_ERROR;
}

/** Payload length expected for a given message type (COMMAND is opaque). */
static int payload_len_valid_for_type(uint8_t msgType, size_t payloadLen)
{
    switch (msgType) {
    case DH_MSG_TELEMETRY:
        return payloadLen == (size_t)DH_TELEMETRY_PAYLOAD_SIZE;
    case DH_MSG_STATUS:
        return payloadLen == (size_t)DH_STATUS_PAYLOAD_SIZE;
    case DH_MSG_ACK:
        return payloadLen >= (size_t)DH_ACK_PAYLOAD_MIN;
    case DH_MSG_ERROR:
        return payloadLen >= (size_t)DH_ERROR_PAYLOAD_MIN;
    case DH_MSG_COMMAND:
        return 1; /* opaque payload, any length within DH_MAX_PAYLOAD */
    default:
        return 0;
    }
}

/* -------------------------------------------------------------------- */
/* Frame encode / decode                                                 */
/* -------------------------------------------------------------------- */

size_t dh_frame_encode(uint8_t *out, size_t outCap, uint8_t msgType, uint8_t flags,
                       uint32_t seq, int64_t ts,
                       const uint8_t *payload, size_t payloadLen)
{
    if (out == NULL) {
        return 0;
    }
    if (!msg_type_valid(msgType)) {
        return 0;
    }
    if ((flags & (uint8_t)~DH_FLAG_KNOWN_MASK) != 0u) {
        return 0;
    }
    if (payloadLen > (size_t)DH_MAX_PAYLOAD) {
        return 0;
    }
    if (payloadLen > 0u && payload == NULL) {
        return 0;
    }
    if (!payload_len_valid_for_type(msgType, payloadLen)) {
        return 0;
    }
    size_t total = DH_FRAME_SIZE(payloadLen);
    if (outCap < total) {
        return 0;
    }

    out[DH_OFF_MAGIC] = (uint8_t)DH_MAGIC;
    out[DH_OFF_VERSION] = (uint8_t)DH_PROTOCOL_VERSION;
    out[DH_OFF_MSG_TYPE] = msgType;
    out[DH_OFF_FLAGS] = flags;
    put_u16le(out + DH_OFF_PAYLOAD_LEN, (uint16_t)payloadLen);
    put_u32le(out + DH_OFF_SEQ, seq);
    put_i64le(out + DH_OFF_TS, ts);

    /* CRC-32 over bytes [0..17] followed by the payload. */
    uint32_t crc = 0u;
    if ((flags & DH_FLAG_HAS_CRC) != 0u) {
        uint32_t state = crc32_update(0xFFFFFFFFu, out, DH_OFF_CRC);
        if (payloadLen > 0u) {
            state = crc32_update(state, payload, payloadLen);
        }
        crc = state ^ 0xFFFFFFFFu;
    }
    put_u32le(out + DH_OFF_CRC, crc);

    if (payloadLen > 0u) {
        memcpy(out + DH_OFF_PAYLOAD, payload, payloadLen);
    }
    return total;
}

DhDecodeResult dh_frame_decode(DhFrame *out, const uint8_t *buf, size_t len)
{
    if (out == NULL || buf == NULL) {
        return DH_ERR_NULL;
    }
    if (len < (size_t)DH_HEADER_SIZE) {
        return DH_ERR_SHORT;
    }
    if (buf[DH_OFF_MAGIC] != (uint8_t)DH_MAGIC) {
        return DH_ERR_MAGIC;
    }
    if (buf[DH_OFF_VERSION] != (uint8_t)DH_PROTOCOL_VERSION) {
        return DH_ERR_VERSION;
    }
    uint8_t flags = buf[DH_OFF_FLAGS];
    if ((flags & (uint8_t)~DH_FLAG_KNOWN_MASK) != 0u) {
        return DH_ERR_FLAGS;
    }
    uint16_t payloadLen = get_u16le(buf + DH_OFF_PAYLOAD_LEN);
    if (payloadLen > (uint16_t)DH_MAX_PAYLOAD) {
        return DH_ERR_LENGTH;
    }
    size_t total = DH_FRAME_SIZE(payloadLen);
    if (len != total) {
        return DH_ERR_TRUNCATED;
    }
    if ((flags & DH_FLAG_HAS_CRC) != 0u) {
        uint32_t state = crc32_update(0xFFFFFFFFu, buf, DH_OFF_CRC);
        state = crc32_update(state, buf + DH_OFF_PAYLOAD, payloadLen);
        uint32_t computed = state ^ 0xFFFFFFFFu;
        if (computed != get_u32le(buf + DH_OFF_CRC)) {
            return DH_ERR_CRC;
        }
    }
    uint8_t msgType = buf[DH_OFF_MSG_TYPE];
    if (!payload_len_valid_for_type(msgType, payloadLen)) {
        return DH_ERR_PAYLOAD;
    }

    out->magic = buf[DH_OFF_MAGIC];
    out->version = buf[DH_OFF_VERSION];
    out->msgType = msgType;
    out->flags = flags;
    out->payloadLen = payloadLen;
    out->seq = get_u32le(buf + DH_OFF_SEQ);
    out->ts = get_i64le(buf + DH_OFF_TS);
    out->crc = get_u32le(buf + DH_OFF_CRC);
    if (payloadLen > 0u) {
        memcpy(out->payload, buf + DH_OFF_PAYLOAD, payloadLen);
    }
    return DH_OK;
}

/* -------------------------------------------------------------------- */
/* Telemetry payload                                                     */
/* -------------------------------------------------------------------- */

size_t dh_telemetry_encode(uint8_t *out, size_t outCap, const DhTelemetry *in)
{
    if (out == NULL || in == NULL) {
        return 0;
    }
    if (outCap < (size_t)DH_TELEMETRY_PAYLOAD_SIZE) {
        return 0;
    }
    if (!metric_id_valid(in->metricId) || !quality_valid(in->quality)) {
        return 0;
    }
    put_u16le(out, in->metricId);
    out[2] = in->quality;
    put_f64le(out + 3, in->value);
    return DH_TELEMETRY_PAYLOAD_SIZE;
}

DhDecodeResult dh_telemetry_decode(DhTelemetry *out, const uint8_t *buf, size_t len)
{
    if (out == NULL || buf == NULL) {
        return DH_ERR_NULL;
    }
    if (len != (size_t)DH_TELEMETRY_PAYLOAD_SIZE) {
        return DH_ERR_PAYLOAD;
    }
    uint16_t metricId = get_u16le(buf);
    uint8_t quality = buf[2];
    if (!metric_id_valid(metricId)) {
        return DH_ERR_RANGE;
    }
    if (!quality_valid(quality)) {
        return DH_ERR_RANGE;
    }
    out->metricId = metricId;
    out->quality = quality;
    out->value = get_f64le(buf + 3);
    return DH_OK;
}

/* -------------------------------------------------------------------- */
/* Status payload                                                        */
/* -------------------------------------------------------------------- */

size_t dh_status_encode(uint8_t *out, size_t outCap, const DhStatus *in)
{
    if (out == NULL || in == NULL) {
        return 0;
    }
    if (outCap < (size_t)DH_STATUS_PAYLOAD_SIZE) {
        return 0;
    }
    if (!state_valid(in->state) || in->health > 100u) {
        return 0;
    }
    out[0] = in->state;
    out[1] = in->health;
    put_u16le(out + 2, in->fw[0]);
    put_u16le(out + 4, in->fw[1]);
    put_u16le(out + 6, in->fw[2]);
    put_u16le(out + 8, in->fw[3]);
    /* Bytes 10..11 are reserved: the protocol mandates a 12-byte status
     * payload while the documented fields occupy the first 10 bytes.
     * The encoder writes zeros; the decoder ignores these bytes. */
    out[10] = 0u;
    out[11] = 0u;
    return DH_STATUS_PAYLOAD_SIZE;
}

DhDecodeResult dh_status_decode(DhStatus *out, const uint8_t *buf, size_t len)
{
    if (out == NULL || buf == NULL) {
        return DH_ERR_NULL;
    }
    if (len != (size_t)DH_STATUS_PAYLOAD_SIZE) {
        return DH_ERR_PAYLOAD;
    }
    uint8_t state = buf[0];
    uint8_t health = buf[1];
    if (!state_valid(state)) {
        return DH_ERR_RANGE;
    }
    if (health > 100u) {
        return DH_ERR_RANGE;
    }
    out->state = state;
    out->health = health;
    out->fw[0] = get_u16le(buf + 2);
    out->fw[1] = get_u16le(buf + 4);
    out->fw[2] = get_u16le(buf + 6);
    out->fw[3] = get_u16le(buf + 8);
    return DH_OK;
}

/* -------------------------------------------------------------------- */
/* ACK payload                                                           */
/* -------------------------------------------------------------------- */

size_t dh_ack_encode(uint8_t *out, size_t outCap, const DhAck *in)
{
    if (out == NULL || in == NULL) {
        return 0;
    }
    if (!ack_code_valid(in->code)) {
        return 0;
    }
    if (in->detailLen > (uint16_t)DH_DETAIL_MAX) {
        return 0;
    }
    size_t total = (size_t)DH_ACK_PAYLOAD_MIN + (size_t)in->detailLen;
    if (outCap < total) {
        return 0;
    }
    out[0] = in->code;
    put_u16le(out + 1, in->detailLen);
    if (in->detailLen > 0u) {
        memcpy(out + 3, in->detail, in->detailLen);
    }
    return total;
}

DhDecodeResult dh_ack_decode(DhAck *out, const uint8_t *buf, size_t len)
{
    if (out == NULL || buf == NULL) {
        return DH_ERR_NULL;
    }
    if (len < (size_t)DH_ACK_PAYLOAD_MIN) {
        return DH_ERR_PAYLOAD;
    }
    uint8_t code = buf[0];
    uint16_t detailLen = get_u16le(buf + 1);
    if (!ack_code_valid(code)) {
        return DH_ERR_RANGE;
    }
    if ((size_t)DH_ACK_PAYLOAD_MIN + (size_t)detailLen != len) {
        return DH_ERR_PAYLOAD;
    }
    out->code = code;
    out->detailLen = detailLen;
    if (detailLen > 0u) {
        memcpy(out->detail, buf + 3, detailLen);
    }
    out->detail[detailLen] = '\0';
    return DH_OK;
}

/* -------------------------------------------------------------------- */
/* ERROR payload                                                         */
/* -------------------------------------------------------------------- */

size_t dh_error_encode(uint8_t *out, size_t outCap, const DhError *in)
{
    if (out == NULL || in == NULL) {
        return 0;
    }
    if (in->messageLen > (uint16_t)DH_ERRMSG_MAX) {
        return 0;
    }
    size_t total = (size_t)DH_ERROR_PAYLOAD_MIN + (size_t)in->messageLen;
    if (outCap < total) {
        return 0;
    }
    put_u16le(out, in->errorCode);
    if (in->messageLen > 0u) {
        memcpy(out + 2, in->message, in->messageLen);
    }
    return total;
}

DhDecodeResult dh_error_decode(DhError *out, const uint8_t *buf, size_t len)
{
    if (out == NULL || buf == NULL) {
        return DH_ERR_NULL;
    }
    if (len < (size_t)DH_ERROR_PAYLOAD_MIN) {
        return DH_ERR_PAYLOAD;
    }
    /* Layout: 2-byte errorCode followed directly by the message; the
     * message length is implied by the payload length. */
    uint16_t errorCode = get_u16le(buf);
    size_t messageLen = len - (size_t)DH_ERROR_PAYLOAD_MIN;
    out->errorCode = errorCode;
    out->messageLen = (uint16_t)messageLen;
    if (messageLen > 0u) {
        memcpy(out->message, buf + 2, messageLen);
    }
    out->message[messageLen] = '\0';
    return DH_OK;
}

/* -------------------------------------------------------------------- */
/* Helpers                                                               */
/* -------------------------------------------------------------------- */

const char *dh_metric_name(uint16_t metricId)
{
    switch (metricId) {
    case DH_METRIC_TEMPERATURE: return "temperature";
    case DH_METRIC_HUMIDITY:    return "humidity";
    case DH_METRIC_PRESSURE:    return "pressure";
    case DH_METRIC_MOTION:      return "motion";
    case DH_METRIC_POWER:       return "power";
    case DH_METRIC_ENERGY:      return "energy";
    case DH_METRIC_VIBRATION:   return "vibration";
    case DH_METRIC_VOLTAGE:     return "voltage";
    case DH_METRIC_CURRENT:     return "current";
    case DH_METRIC_STATUS:      return "status";
    default:                    return NULL;
    }
}

const char *dh_state_name(uint8_t state)
{
    switch (state) {
    case DH_STATE_UNPROVISIONED: return "UNPROVISIONED";
    case DH_STATE_PROVISIONED:   return "PROVISIONED";
    case DH_STATE_ONLINE:        return "ONLINE";
    case DH_STATE_OFFLINE:       return "OFFLINE";
    case DH_STATE_DEGRADED:      return "DEGRADED";
    case DH_STATE_MAINTENANCE:   return "MAINTENANCE";
    case DH_STATE_ERROR:         return "ERROR";
    case DH_STATE_RETIRED:       return "RETIRED";
    default:                     return NULL;
    }
}

const char *dh_decode_result_name(DhDecodeResult result)
{
    switch (result) {
    case DH_OK:           return "ok";
    case DH_ERR_NULL:     return "NULL argument";
    case DH_ERR_SHORT:    return "input shorter than fixed header";
    case DH_ERR_MAGIC:    return "bad magic byte";
    case DH_ERR_VERSION:  return "unsupported version";
    case DH_ERR_FLAGS:    return "reserved flag bits set";
    case DH_ERR_LENGTH:   return "payload length exceeds maximum";
    case DH_ERR_TRUNCATED: return "input length inconsistent with payload length";
    case DH_ERR_CRC:      return "CRC-32 mismatch";
    case DH_ERR_PAYLOAD:  return "payload length invalid for message type";
    case DH_ERR_RANGE:    return "field value out of range";
    default:              return "unknown";
    }
}

double dh_ts_to_unix_seconds(int64_t tsMs)
{
    return (double)tsMs / 1000.0;
}
