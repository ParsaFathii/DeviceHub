# پروتکل DeviceHub نسخه ۱

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

پروتکل DeviceHub v1 دو نمایش دارد: **پاکت JSON** (روی مسیر MQTT زنده همین استقرار) و **فریم باینری** (پیاده‌سازی مرجع C11 در `protocol-c/`). هر دو یک معناشناسی را حمل می‌کنند.

مرجع کامل سطح بایت: [protocol-c/README.md](../../protocol-c/README.md).

---

## ۱. پاکت JSON (envelope)

قالب پیام تله‌متری که دستگاه‌ها روی `device/{id}/telemetry` منتشر می‌کنند:

```json
{
  "v": 1,
  "deviceId": "DH-ENV-001",
  "msgId": "DH-ENV-001-000123",
  "seq": 123,
  "ts": 1760112000000,
  "metrics": [
    { "metric": "temperature", "value": 22.5, "unit": "°C", "quality": "GOOD" }
  ],
  "sim": true
}
```

| فیلد | نوع | شرح |
|---|---|---|
| `v` | عدد | نسخه شِما؛ باید `1` باشد |
| `deviceId` | رشته | شناسه منطقی یکتا، ماچ با `^DH-[A-Z0-9-]+$` و با تاپیک هم‌خوان |
| `msgId` | رشته | شناسه منطقی پایدار پیام؛ dedup گیت‌وی روی همین انجام می‌شود |
| `seq` | عدد | توالی یکنوا به‌ازای دستگاه؛ dedup نهایی با کلید یکتا `(deviceId, metric, sequence)` |
| `ts` | عدد | میلی‌ثانیه از epoch یونیکس (UTC)؛ اگر بیش از ۵ دقیقه در آینده یا بیش از ۲۴ ساعت در گذشته باشد رد می‌شود |
| `metrics` | آرایه | ۱ تا ۱۶ مورد: `{metric, value, unit, quality}` |
| `sim` | بولین | `true` یعنی داده شبیه‌ساز؛ همین‌طور ذخیره و نمایش داده می‌شود |

**اعتبارسنجی (در گیت‌وی):**

- ساختار envelope و نسخه؛
- تطابق `deviceId` با تاپیک؛
- طول `msgId` (۱ تا ۱۲۸) و بازه `seq` (۰ تا ۱۰⁹)؛
- انحراف زمانی `ts`؛
- شناخته‌بودن metric و enum بودن quality (`GOOD`/`SUSPECT`/`BAD`)؛
- سقف اندازه پیام ۶۴KiB.

نکته مهم: مقدار **خارج از محدوده فیزیکی، رد نمی‌شود** — پذیرفته و `SUSPECT` علامت می‌خورد (سنسور ممکن است معیوب باشد). فقط خطاهای ساختاری باعث ردّ پیام می‌شوند.

**پیام وضعیت (روی `device/{id}/status`، retained):** شامل `deviceId`، `state` (مثل ONLINE/MAINTENANCE/OFFLINE) و `health` (۰ تا ۱۰۰).

**فرمان (روی `device/{id}/command`):**

```json
{
  "v": 1,
  "commandId": "CMD-1A2B3C4D",
  "deviceId": "DH-ENV-001",
  "action": "SET_INTERVAL",
  "payload": { "intervalSec": 10 },
  "issuedAt": 1760112000000,
  "expiresAt": 1760112120000
}
```

**ack (روی `device/{id}/ack`):** `{commandId, code, detail}` که `code` یکی از `OK` / `REJECTED` / `UNSUPPORTED` / `ERROR` است.

---

## ۲. فریم باینری (پیاده‌سازی C11)

کل کتابخانه در `protocol-c/` قرار دارد: بدون وابستگی خارجی، بدون فرض درباره endianness یا چیدمان struct ساخت بایت‌به‌بایت انجام می‌شود. همه اعداد چندبایتی **little-endian** هستند. اندازه کل فریم = ۲۲ + payloadLen.

### ۲.۱. سرصفحه (۲۲ بایت)

| آفست | اندازه | فیلد | توضیح |
|---|---|---|---|
| 0 | 1 | magic | `0xD4` |
| 1 | 1 | version | نسخه پروتکل؛ فعلاً 1 |
| 2 | 1 | msgType | 1=TELEMETRY، 2=STATUS، 3=COMMAND، 4=ACK، 5=ERROR |
| 3 | 1 | flags | بیت ۰: has_crc؛ بقیه رزرو (۰) |
| 4 | 2 | payloadLen | uint16 LE؛ حداکثر ۱۰۲۴ |
| 6 | 4 | seq | uint32 LE؛ یکنوا به‌ازای دستگاه |
| 10 | 8 | ts | int64 LE؛ میلی‌ثانیه از epoch یونیکس UTC |
| 18 | 4 | crc32 | CRC-32 (IEEE 802.3، چندجمله‌ای 0xEDB88320، init و final-XOR برابر 0xFFFFFFFF) روی بایت‌های [0..17] + payload |

### ۲.۲. payload تله‌متری (msgType=1 — دقیقاً ۱۱ بایت)

| آفست | اندازه | فیلد |
|---|---|---|
| 0 | 2 | metricId (uint16 LE): 1=temperature، 2=humidity، 3=pressure، 4=motion، 5=power، 6=energy، 7=vibration، 8=voltage، 9=current، 10=status |
| 2 | 1 | quality: 0=GOOD، 1=SUSPECT، 2=BAD |
| 3 | 8 | value — double شناور IEEE754 (little-endian، بازنمایی بیتی دقیق، شامل NaN) |

### ۲.۳. payload وضعیت (msgType=2 — دقیقاً ۱۲ بایت)

| آفست | اندازه | فیلد |
|---|---|---|
| 0 | 1 | state: 0=UNPROVISIONED، 1=PROVISIONED، 2=ONLINE، 3=OFFLINE، 4=DEGRADED، 5=MAINTENANCE، 6=ERROR، 7=RETIRED |
| 1 | 1 | health (درصد، ۰ تا ۱۰۰) |
| 2 | 8 | نسخه firmware به‌صورت ۴ مؤلفه uint16 LE (major، minor، patch، build) |
| 10 | 2 | رزرو — encoder صفر می‌نویسد، decoder نادیده می‌گیرد |

> **یادداشت آشتی‌دادن مشخصات:** مشخصات پروتکل مجموع فیلدهای status را ۱۰ بایت توصیف می‌کند ولی طول payload را «دقیقاً ۱۲» الزام کرده است. پیاده‌سازی مرجع طول الزامی ۱۲ بایت را رعایت می‌کند و ۲ بایت آخر را رزرو می‌داند. این تصمیم در README کتابخانه C، هدر و مستندات ثبت شده تا پیاده‌سازی‌های خواهرخوانده (TS/Python) سازگاری بایتی داشته باشند.

### ۲.۴. payload فرمان (msgType=3)

بایت‌های opaque؛ هر طولی از ۰ تا ۱۰۲۴ معتبر است.

### ۲.۵. payload قدم (msgType=4 — متغیر، حداقل ۳ بایت)

| آفست | اندازه | فیلد |
|---|---|---|
| 0 | 1 | code: 0=OK، 1=REJECTED، 2=UNSUPPORTED، 3=ERROR |
| 1 | 2 | detailLen (uint16 LE) |
| 3 | detailLen | بایت‌های ASCII جزئیات |

### ۲.۶. payload خطا (msgType=5 — متغیر، حداقل ۲ بایت)

| آفست | اندازه | فیلد |
|---|---|---|
| 0 | 2 | errorCode (uint16 LE) |
| 2 | باقی | پیام ASCII (طول = payloadLen − ۲) |

---

## ۳. کتابخانه C و کیفیت آزمون

- `make test` → **۲۶ تابع تست / ۵۱۹ assertion** همه قبول (gcc 14.2 با `-std=c11 -Wall -Wextra -Werror -O2`).
- `make test-asan` → بیلد با `-fsanitize=address,undefined` بدون هیچ خطای sanitizer.
- پوشش تست‌ها: بردارهای معلوم CRC-32 (مثلاً `CRC32("123456789") = 0xCBF43926`)، فریم طلایی مستقل، رفت‌وبرگشت همه انواع پیام، ردّ magic/نسخه/flags/طول/CRC خراب، مقادیر مرزی double (شامل حفظ بیتی NaN)، `seq` در مرزها، `ts` در مرزها، ماتریس خطاهای encode، نگاشت اسم‌ها و تبدیل زمان.
- سازگاری فریم در هر دو جهت با یک پیاده‌سازی مستقل Python (struct + zlib) تأیید شده است.

## ۴. رابطه دو نمایش در همین استقرار

- مسیر MQTT زنده (شبیه‌ساز → گیت‌وی) از **پاکت JSON** استفاده می‌کند.
- `protocol-c/` مرجع **فریم باینری** است و برای پیاده‌سازی سمت firmware/دستگاه در نظر گرفته شده؛ در این محیط با سخت‌افزار فیزیکی آزمایش نشده است.
- معناشناسی (شناسه‌ها، کیفیت‌ها، توالی، زمان‌ها) بین دو نمایش یکسان است.
