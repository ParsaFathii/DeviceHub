/* DeviceHub C Protocol Library — Copyright © 2026 Parsa Fathi — Apache-2.0 */
/**
 * @file dh_protocol.h
 *
 * Public API of the DeviceHub binary wire protocol, implemented as a
 * portable C11 library with no external dependencies.
 *
 * Frame layout (all multi-byte integers are little-endian):
 *
 * | Offset | Size | Field      | Notes                                        |
 * |--------|------|------------|----------------------------------------------|
 * |      0 |    1 | magic      | 0xD4                                         |
 * |      1 |    1 | version    | currently 1                                  |
 * |      2 |    1 | msgType    | 1..5 (see DhMsgType)                         |
 * |      3 |    1 | flags      | bit0: has_crc, others reserved 0             |
 * |      4 |    2 | payloadLen | uint16 LE, max 1024                          |
 * |      6 |    4 | seq        | uint32 LE, monotonic per device              |
 * |     10 |    8 | ts         | int64 LE, ms since Unix epoch (UTC)          |
 * |     18 |    4 | crc32      | CRC-32 over bytes [0..17] + payload          |
 * |     22 | plen | payload    | interpretation depends on msgType           |
 *
 * Total frame size = 22 + payloadLen.
 *
 * CRC-32 parameters: IEEE 802.3 (reflected), polynomial 0xEDB88320,
 * initial value 0xFFFFFFFF, final XOR 0xFFFFFFFF.
 */
#ifndef DH_PROTOCOL_H
#define DH_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------- */
/* Wire-format constants                                                 */
/* -------------------------------------------------------------------- */

/** Magic byte at offset 0 of every frame. */
#define DH_MAGIC 0xD4u

/** Protocol version carried at offset 1 (current version). */
#define DH_PROTOCOL_VERSION 1u

/** Maximum payload length in bytes. */
#define DH_MAX_PAYLOAD 1024u

/** Fixed frame prefix size: 18-byte header + 4-byte CRC field. */
#define DH_HEADER_SIZE 22u

/** Total on-wire size of a frame carrying `plen` payload bytes. */
#define DH_FRAME_SIZE(plen) ((size_t)(DH_HEADER_SIZE) + (size_t)(plen))

/* Byte offsets of the frame fields. */
#define DH_OFF_MAGIC       0u
#define DH_OFF_VERSION     1u
#define DH_OFF_MSG_TYPE    2u
#define DH_OFF_FLAGS       3u
#define DH_OFF_PAYLOAD_LEN 4u
#define DH_OFF_SEQ         6u
#define DH_OFF_TS          10u
#define DH_OFF_CRC         18u
#define DH_OFF_PAYLOAD     22u

/* Flag bits (frame offset 3). */
#define DH_FLAG_HAS_CRC    0x01u  /**< CRC-32 field is valid and must be checked. */
#define DH_FLAG_KNOWN_MASK 0x01u  /**< All flag bits defined by protocol version 1. */

/* Message types (frame offset 2). */
enum {
    DH_MSG_TELEMETRY = 1,  /**< metric sample, payload = DhTelemetry (11 bytes) */
    DH_MSG_STATUS    = 2,  /**< device status, payload = DhStatus (12 bytes) */
    DH_MSG_COMMAND   = 3,  /**< command to a device, payload is opaque */
    DH_MSG_ACK       = 4,  /**< acknowledgement, payload = DhAck (>= 3 bytes) */
    DH_MSG_ERROR     = 5   /**< error report, payload = DhError (>= 2 bytes) */
};

/* -------------------------------------------------------------------- */
/* Telemetry payload (msgType = 1, exactly 11 bytes)                     */
/* -------------------------------------------------------------------- */

#define DH_TELEMETRY_PAYLOAD_SIZE 11u

enum {
    DH_METRIC_TEMPERATURE = 1,
    DH_METRIC_HUMIDITY    = 2,
    DH_METRIC_PRESSURE    = 3,
    DH_METRIC_MOTION      = 4,
    DH_METRIC_POWER       = 5,
    DH_METRIC_ENERGY      = 6,
    DH_METRIC_VIBRATION   = 7,
    DH_METRIC_VOLTAGE     = 8,
    DH_METRIC_CURRENT     = 9,
    DH_METRIC_STATUS      = 10
};

enum {
    DH_QUALITY_GOOD    = 0,
    DH_QUALITY_SUSPECT = 1,
    DH_QUALITY_BAD     = 2
};

/* -------------------------------------------------------------------- */
/* Status payload (msgType = 2, exactly 12 bytes)                        */
/*                                                                        */
/* Layout: state (1 byte) @0, health (1 byte) @1, firmware version as    */
/* four uint16 LE components @2..9, and two reserved bytes @10..11.      */
/* The documented fields occupy 10 bytes while the protocol mandates a   */
/* total payload length of exactly 12, so the trailing two bytes are     */
/* reserved: the encoder writes zeros there, the decoder ignores them.   */
/* -------------------------------------------------------------------- */

#define DH_STATUS_PAYLOAD_SIZE 12u
#define DH_STATUS_RESERVED_SIZE 2u

enum {
    DH_STATE_UNPROVISIONED = 0,
    DH_STATE_PROVISIONED   = 1,
    DH_STATE_ONLINE        = 2,
    DH_STATE_OFFLINE       = 3,
    DH_STATE_DEGRADED      = 4,
    DH_STATE_MAINTENANCE   = 5,
    DH_STATE_ERROR         = 6,
    DH_STATE_RETIRED       = 7
};

/* -------------------------------------------------------------------- */
/* ACK payload (msgType = 4, >= 3 bytes)                                 */
/* -------------------------------------------------------------------- */

#define DH_ACK_PAYLOAD_MIN 3u

enum {
    DH_ACK_CODE_OK          = 0,
    DH_ACK_CODE_REJECTED    = 1,
    DH_ACK_CODE_UNSUPPORTED = 2,
    DH_ACK_CODE_ERROR       = 3
};

/* -------------------------------------------------------------------- */
/* ERROR payload (msgType = 5, >= 2 bytes)                               */
/* -------------------------------------------------------------------- */

#define DH_ERROR_PAYLOAD_MIN 2u

/* -------------------------------------------------------------------- */
/* Payload sub-field capacities                                          */
/* -------------------------------------------------------------------- */

/** Longest ack detail text that fits into a single payload. */
#define DH_DETAIL_MAX (DH_MAX_PAYLOAD - 3u)
/** Longest error message that fits into a single payload. */
#define DH_ERRMSG_MAX (DH_MAX_PAYLOAD - 2u)

/* -------------------------------------------------------------------- */
/* Result codes                                                          */
/* -------------------------------------------------------------------- */

/** Status/result codes returned by the decoding functions. */
typedef enum {
    DH_OK          = 0,  /**< success */
    DH_ERR_NULL    = 1,  /**< NULL pointer argument */
    DH_ERR_SHORT   = 2,  /**< input shorter than the fixed 22-byte prefix */
    DH_ERR_MAGIC   = 3,  /**< magic byte is not 0xD4 */
    DH_ERR_VERSION = 4,  /**< unsupported protocol version */
    DH_ERR_FLAGS   = 5,  /**< reserved flag bits are set */
    DH_ERR_LENGTH  = 6,  /**< payloadLen exceeds DH_MAX_PAYLOAD */
    DH_ERR_TRUNCATED = 7, /**< input length != 22 + payloadLen */
    DH_ERR_CRC     = 8,  /**< CRC-32 mismatch (only for has_crc frames) */
    DH_ERR_PAYLOAD = 9,  /**< payload length not valid for the message type */
    DH_ERR_RANGE   = 10  /**< payload field value out of range */
} DhDecodeResult;

/* -------------------------------------------------------------------- */
/* Data structures                                                       */
/* -------------------------------------------------------------------- */

/**
 * A decoded frame. Only the first @c payloadLen bytes of @c payload are
 * meaningful; the array is sized so a maximum-length frame always fits.
 */
typedef struct DhFrame {
    uint8_t  magic;                  /**< always DH_MAGIC (0xD4) */
    uint8_t  version;                /**< protocol version (currently 1) */
    uint8_t  msgType;                /**< one of DH_MSG_* */
    uint8_t  flags;                  /**< DH_FLAG_HAS_CRC may be set */
    uint16_t payloadLen;             /**< number of valid payload bytes (<= 1024) */
    uint32_t seq;                    /**< sequence number */
    int64_t  ts;                     /**< milliseconds since Unix epoch, UTC */
    uint32_t crc;                    /**< CRC-32 field as read from the wire */
    uint8_t  payload[DH_MAX_PAYLOAD]; /**< payload bytes */
} DhFrame;

/** Telemetry sample (payload of DH_MSG_TELEMETRY frames). */
typedef struct DhTelemetry {
    uint16_t metricId;               /**< one of DH_METRIC_* */
    uint8_t  quality;                /**< one of DH_QUALITY_* */
    double   value;                  /**< IEEE754 double, transported bit-exactly */
} DhTelemetry;

/** Device status (payload of DH_MSG_STATUS frames).
 *  On the wire: state @0, health @1, fw[4] @2..9, reserved @10..11. */
typedef struct DhStatus {
    uint8_t  state;                  /**< one of DH_STATE_* */
    uint8_t  health;                 /**< health percentage, 0..100 */
    uint16_t fw[4];                  /**< firmware version: major, minor, patch, build */
} DhStatus;

/** Acknowledgement (payload of DH_MSG_ACK frames). */
typedef struct DhAck {
    uint8_t  code;                   /**< one of DH_ACK_CODE_* */
    uint16_t detailLen;              /**< number of detail bytes (<= DH_DETAIL_MAX) */
    char     detail[DH_DETAIL_MAX + 1u]; /**< detail text, NUL-terminated convenience */
} DhAck;

/** Error report (payload of DH_MSG_ERROR frames). */
typedef struct DhError {
    uint16_t errorCode;              /**< application-defined error code */
    uint16_t messageLen;             /**< number of message bytes (<= DH_ERRMSG_MAX) */
    char     message[DH_ERRMSG_MAX + 1u]; /**< message text, NUL-terminated convenience */
} DhError;

/* -------------------------------------------------------------------- */
/* CRC-32                                                                */
/* -------------------------------------------------------------------- */

/**
 * CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320, init 0xFFFFFFFF,
 * final XOR 0xFFFFFFFF).  Known vectors: "123456789" -> 0xCBF43926,
 * empty input -> 0x00000000, single byte 0x00 -> 0xD202EF8D.
 *
 * @param data  bytes to checksum (may be NULL only if len == 0)
 * @param len   number of bytes
 * @return CRC-32 checksum of @p data
 */
uint32_t dh_crc32(const uint8_t *data, size_t len);

/* -------------------------------------------------------------------- */
/* Frame encode / decode                                                 */
/* -------------------------------------------------------------------- */

/**
 * Serialize a complete frame into @p out.
 *
 * The CRC-32 field is computed over bytes [0..17] followed by the payload
 * whenever @p flags has DH_FLAG_HAS_CRC set (it is written as 0 otherwise).
 * The message type must be one of DH_MSG_* and @p payloadLen must be valid
 * for that type (TELEMETRY: 11, STATUS: 12, ACK: >= 3, ERROR: >= 2,
 * COMMAND: any length up to DH_MAX_PAYLOAD).
 *
 * @param out        output buffer
 * @param outCap     capacity of @p out in bytes
 * @param msgType    one of DH_MSG_*
 * @param flags      DH_FLAG_HAS_CRC and/or 0
 * @param seq        sequence number
 * @param ts         milliseconds since Unix epoch (UTC)
 * @param payload    payload bytes (may be NULL when payloadLen == 0)
 * @param payloadLen payload length in bytes (<= DH_MAX_PAYLOAD)
 * @return total frame size (22 + payloadLen), or 0 on invalid input or
 *         when @p outCap is too small
 */
size_t dh_frame_encode(uint8_t *out, size_t outCap, uint8_t msgType, uint8_t flags,
                       uint32_t seq, int64_t ts,
                       const uint8_t *payload, size_t payloadLen);

/**
 * Parse and validate a frame from @p buf.
 *
 * Validation performed, in order: non-NULL arguments; input covers the
 * fixed 22-byte prefix; magic byte; protocol version; reserved flag bits
 * are clear; payloadLen <= DH_MAX_PAYLOAD; input length equals
 * 22 + payloadLen; CRC-32 (when the has_crc flag is set) over
 * bytes [0..17] + payload; payload length valid for the message type.
 * Payload field values (metric ids, quality codes, ...) are validated by
 * the per-type payload decoders below.
 *
 * @param out  decoded frame (unchanged on failure)
 * @param buf  input bytes
 * @param len  number of input bytes
 * @return DH_OK on success, otherwise a DH_ERR_* code describing the failure
 */
DhDecodeResult dh_frame_decode(DhFrame *out, const uint8_t *buf, size_t len);

/* -------------------------------------------------------------------- */
/* Payload encode / decode helpers                                       */
/* -------------------------------------------------------------------- */

/**
 * Serialize a telemetry sample (11 bytes).
 * @return DH_TELEMETRY_PAYLOAD_SIZE, or 0 on invalid input or small buffer.
 */
size_t dh_telemetry_encode(uint8_t *out, size_t outCap, const DhTelemetry *in);

/**
 * Parse an 11-byte telemetry payload.  Validates the length, the metric id
 * (1..10) and the quality code (0..2).
 * @return DH_OK, DH_ERR_NULL, DH_ERR_PAYLOAD (wrong length) or DH_ERR_RANGE.
 */
DhDecodeResult dh_telemetry_decode(DhTelemetry *out, const uint8_t *buf, size_t len);

/**
 * Serialize a device status (12 bytes).
 * @return DH_STATUS_PAYLOAD_SIZE, or 0 on invalid input or small buffer.
 */
size_t dh_status_encode(uint8_t *out, size_t outCap, const DhStatus *in);

/**
 * Parse a 12-byte status payload.  Validates the length, the state code
 * (0..7) and the health percentage (0..100).
 * @return DH_OK, DH_ERR_NULL, DH_ERR_PAYLOAD (wrong length) or DH_ERR_RANGE.
 */
DhDecodeResult dh_status_decode(DhStatus *out, const uint8_t *buf, size_t len);

/**
 * Serialize an acknowledgement (3 + detailLen bytes).
 * @return number of bytes written, or 0 on invalid input or small buffer.
 */
size_t dh_ack_encode(uint8_t *out, size_t outCap, const DhAck *in);

/**
 * Parse an acknowledgement payload (>= 3 bytes).  Validates the length
 * (exactly 3 + detailLen) and the code (0..3).
 * @return DH_OK, DH_ERR_NULL, DH_ERR_PAYLOAD or DH_ERR_RANGE.
 */
DhDecodeResult dh_ack_decode(DhAck *out, const uint8_t *buf, size_t len);

/**
 * Serialize an error report (2 + messageLen bytes).
 * @return number of bytes written, or 0 on invalid input or small buffer.
 */
size_t dh_error_encode(uint8_t *out, size_t outCap, const DhError *in);

/**
 * Parse an error payload (>= 2 bytes).  Validates the length
 * (exactly 2 + messageLen).
 * @return DH_OK, DH_ERR_NULL or DH_ERR_PAYLOAD.
 */
DhDecodeResult dh_error_decode(DhError *out, const uint8_t *buf, size_t len);

/* -------------------------------------------------------------------- */
/* Helpers                                                               */
/* -------------------------------------------------------------------- */

/**
 * Canonical name of a metric id ("temperature", "humidity", ...).
 * @return static string, or NULL if @p metricId is not a known metric.
 */
const char *dh_metric_name(uint16_t metricId);

/**
 * Canonical name of a device state ("UNPROVISIONED", "PROVISIONED", ...).
 * @return static string, or NULL if @p state is not a known state.
 */
const char *dh_state_name(uint8_t state);

/**
 * Human-readable name of a decode result code (never NULL).
 */
const char *dh_decode_result_name(DhDecodeResult result);

/**
 * Convert a protocol timestamp (milliseconds since Unix epoch, UTC) into
 * fractional Unix seconds.
 * @return (double)tsMs / 1000.0
 */
double dh_ts_to_unix_seconds(int64_t tsMs);

#ifdef __cplusplus
}
#endif

#endif /* DH_PROTOCOL_H */
