# DeviceHub C Protocol Library

Copyright © 2026 Parsa Fathi — Apache-2.0

Portable C11 implementation of the DeviceHub binary wire protocol: frame
encode/decode with CRC-32 integrity checking, typed payload helpers for
telemetry, status, ACK and ERROR messages. No external dependencies, no
assumptions about host endianness or struct layout.

## Build & test

Requires gcc (or any C11 compiler) and make.

```sh
make            # build build/libdh_protocol.a + build/test_protocol
make test       # run the test suite (also saved to tests/test_output.txt)
make test-asan  # rebuild with -fsanitize=address,undefined and run tests
make clean      # remove build artifacts
```

To use the library from your own code:

```sh
gcc -std=c11 -Iinclude my_code.c libdh_protocol.a -lm -o my_app
```

```c
#include "dh_protocol.h"

DhTelemetry t = { DH_METRIC_TEMPERATURE, DH_QUALITY_GOOD, 22.5 };
uint8_t payload[DH_TELEMETRY_PAYLOAD_SIZE];
dh_telemetry_encode(payload, sizeof payload, &t);

uint8_t frame[DH_HEADER_SIZE + DH_TELEMETRY_PAYLOAD_SIZE];
size_t n = dh_frame_encode(frame, sizeof frame, DH_MSG_TELEMETRY,
                           DH_FLAG_HAS_CRC, 12345, 1730000000123LL,
                           payload, DH_TELEMETRY_PAYLOAD_SIZE);

DhFrame f;
if (dh_frame_decode(&f, frame, n) == DH_OK) { /* ... */ }
```

## Protocol — byte-level documentation

All multi-byte integers are **little-endian**. Total frame size = 22 + payloadLen.

### Frame

| Offset | Size | Field      | Notes                                                              |
|--------|------|------------|--------------------------------------------------------------------|
| 0      | 1    | magic      | 0xD4                                                               |
| 1      | 1    | version    | protocol version, currently 1                                      |
| 2      | 1    | msgType    | 1=TELEMETRY, 2=STATUS, 3=COMMAND, 4=ACK, 5=ERROR                  |
| 3      | 1    | flags      | bit0: has_crc, others reserved 0                                  |
| 4      | 2    | payloadLen | uint16 LE, max 1024                                                |
| 6      | 4    | seq        | uint32 LE, monotonically increasing per device                     |
| 10     | 8    | ts         | int64 LE, milliseconds since Unix epoch UTC                        |
| 18     | 4    | crc32      | CRC-32 (IEEE 802.3, poly 0xEDB88320, init 0xFFFFFFFF, final XOR 0xFFFFFFFF) over bytes [0..17] plus payload (header-without-crc + payload) |
| 22     | payloadLen | payload | interpretation depends on msgType                           |

### Telemetry payload (msgType=1, length exactly 11)

| Offset | Size | Field                                            |
|--------|------|--------------------------------------------------|
| 0      | 2    | metricId (uint16 LE): 1=temperature, 2=humidity, 3=pressure, 4=motion, 5=power, 6=energy, 7=vibration, 8=voltage, 9=current, 10=status |
| 2      | 1    | quality: 0=GOOD, 1=SUSPECT, 2=BAD                |
| 3      | 8    | value (IEEE754 double, little-endian)            |

### Status payload (msgType=2, length exactly 12)

| Offset | Size | Field                                                        |
|--------|------|--------------------------------------------------------------|
| 0      | 1    | state: 0=UNPROVISIONED, 1=PROVISIONED, 2=ONLINE, 3=OFFLINE, 4=DEGRADED, 5=MAINTENANCE, 6=ERROR, 7=RETIRED |
| 1      | 1    | health percent (0-100)                                       |
| 2      | 8    | firmware version as 4 uint16 LE components (major, minor, patch, build) |
| 10     | 2    | reserved (written as 0 by the encoder, ignored by the decoder) |

> **Spec reconciliation note:** the protocol specification describes status
> fields totalling 10 bytes (1 + 1 + 8) while mandating a payload length of
> exactly 12. This reference implementation honours the mandated 12-byte
> length and treats the final two bytes as reserved (zero on encode, ignored
> on decode). The first 10 bytes match the documented field layout exactly.

### ACK payload (msgType=4, variable length ≥ 3)

| Offset | Size | Field                                       |
|--------|------|---------------------------------------------|
| 0      | 1    | code: 0=OK, 1=REJECTED, 2=UNSUPPORTED, 3=ERROR |
| 1      | 2    | detailLen (uint16 LE)                       |
| 3      | detailLen | detailLen ASCII bytes                   |

### ERROR payload (msgType=5, variable length ≥ 2)

| Offset | Size    | Field             |
|--------|---------|-------------------|
| 0      | 2       | errorCode (uint16 LE) |
| 2      | rest    | ASCII message (length = payloadLen − 2) |

### COMMAND payload (msgType=3)

Opaque bytes; any length from 0 to 1024 is valid.

## API overview

- `uint32_t dh_crc32(const uint8_t *data, size_t len)` — CRC-32 ("123456789" → 0xCBF43926).
- `size_t dh_frame_encode(...)` — serialize a frame; returns total size or 0 on invalid input / small buffer.
- `DhDecodeResult dh_frame_decode(DhFrame *out, const uint8_t *buf, size_t len)` — validate and parse; checks magic, version, reserved flags, payloadLen ≤ 1024, input length consistency, CRC (when has_crc), and payload length per type.
- `dh_telemetry_encode/decode`, `dh_status_encode/decode`, `dh_ack_encode/decode`, `dh_error_encode/decode` — typed payload helpers (payload decoders also validate field ranges such as metric ids, quality codes, states and health).
- `dh_metric_name`, `dh_state_name`, `dh_decode_result_name` — human-readable names.
- `double dh_ts_to_unix_seconds(int64_t tsMs)` — ms → seconds.

Decode result codes: `DH_OK`, `DH_ERR_NULL`, `DH_ERR_SHORT`, `DH_ERR_MAGIC`,
`DH_ERR_VERSION`, `DH_ERR_FLAGS`, `DH_ERR_LENGTH`, `DH_ERR_TRUNCATED`,
`DH_ERR_CRC`, `DH_ERR_PAYLOAD`, `DH_ERR_RANGE`.

## License

Apache-2.0, Copyright © 2026 Parsa Fathi.
