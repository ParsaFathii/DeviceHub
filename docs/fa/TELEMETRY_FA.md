# تله‌متری — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

شِمای ذخیره: مدل `TelemetrySample` در `prisma/schema.prisma`؛ مسیر ingest: `POST /api/internal/telemetry`.

---

## ۱. فیلدهای هر نمونه

| فیلد | توضیح |
|---|---|
| `deviceId` | دستگاه مبدأ (کلید خارجی به Device) |
| `gatewayId` | گیت‌وی ارسال‌کننده (در این استقرار: `edge-gw-01`) |
| `metric` | temperature / humidity / pressure / motion / power / energy / vibration / voltage / current / status |
| `value` | مقدار عددی |
| `unit` | واحد (°C، %، kW، …) |
| `quality` | `GOOD` / `SUSPECT` / `BAD` |
| `sampleTs` | **زمان مبدأ** — همان `ts` دستگاه؛ از بافر و drain هم بدون تغییر رد می‌شود |
| `receivedTs` | زمان رسیدن به سرور (پیش‌فرض: now) |
| `messageId` | `msgId` منطقی پیام (برای dedup گیت‌وی) |
| `sequence` | `seq` دستگاه — بخشی از کلید یکتا |
| `delayed` | `true` اگر بعد از نمونه‌های جدیدترِ همان (device، metric) رسیده باشد |
| `simulated` | `true` برای داده شبیه‌ساز (`sim: true` روی wire) |
| `schemaVersion` | ۱ |

ایندکس‌ها: `(deviceId, metric, sampleTs)`، `receivedTs`، `gatewayId`؛ **قید یکتا روی `(deviceId, metric, sequence)`**.

## ۲. زمان‌های دوگانه — چرا؟

مسئله کلاسیک سیستم‌های تله‌متری: وقتی داده‌ای مدتی در گیت‌وی بافر شده و بعداً رسیده، «وقتی رخ داده» و «وقتی رسیده» دو چیزند.

- `sampleTs` زمان واقعی اندازه‌گیری است و برای نمودارها، aggregation و تحلیل ML استفاده می‌شود. **هیچ‌جا بازنویسی نمی‌شود.**
- `receivedTs` برای مشاهده‌پذیری (که چه زمانی به مرکز رسید) و تشخیص تأخیر نگه داشته می‌شود.

در تست قابلیت اطمینان، داده delayed بعد از قطعی Backend دقیقاً با `sampleTs` اصلی ذخیره شد و فقط `receivedTs` جدید گرفت.

## ۳. پرچم delayed

هنگام ingest، Backend آخرین `sampleTs` هر `(deviceId, metric)` را می‌داند (کش داخل همان batch + پرس‌وجوی DB). اگر نمونه‌ای با `sampleTs` **کوچک‌تر از آخرین دیده‌شده** برسد:

- ذخیره می‌شود (هرگز دور ریخته نمی‌شود)؛
- `delayed: true` می‌گیرد؛
- «آخرین» فقط اگر بزرگ‌تر باشد جابه‌جا می‌شود.

سرویس تحلیل هم در aggregation شمارش `outOfOrder` را بر اساس ترتیب fetch گزارش می‌کند.

## ۴. dedup دو لایه

| لایه | کجا | کلید | نتیجه تکرار |
|---|---|---|---|
| ۱ | گیت‌وی (درون‌حافظه) | `msgId` (پنجره ۸۰۰۰تایی) | drop بی‌صدا + شمارنده `deduped` |
| ۲ | Backend (پایگاه‌داده) | `(deviceId, metric, sequence)` — قید یکتا | exception → شمارنده `duplicates`؛ ذخیره نمی‌شود |

پاسخ ingest همیشه `{accepted, duplicates, rejected, errors}` برمی‌گرداند تا رفتار شفاف باشد.

## ۵. محدودیت‌های batch و پیام

- هر فراخوانی ingest حداکثر **۵۰۰ پیام** — بیشتر از آن → `413` (در تست امنیت/قابلیت اطمینات بررسی شده).
- هر پیام MQTT بیش از **۶۴KiB** در گیت‌وی رد می‌شود.
- هر envelope حداکثر **۱۶ metric**.

## ۶. استخراج داده (برای تحلیل)

`GET /api/internal/telemetry?deviceId=&metric=&from=&to=&hours=&limit=` (با توکن داخلی):

- فیلتر اختیاری دستگاه/metric/بازه؛ `hours` یعنی «N ساعت اخیر»؛
- خروجی مرتب صعودی بر اساس `sampleTs`؛ سقف `limit` برابر ۵۰۰۰؛
- هر نمونه شامل `quality`، `sequence`، `delayed`، `simulated` است.

سرویس تحلیل (پورت ۳۰۱۴) همین endpoint را مصرف می‌کند: `POST /aggregate` (بکت‌بندی هم‌تراز با epoch با min/max/avg/count، تشخیص bucketهای جاافتاده و بازه‌های gap ادغام‌شده) و `POST /detect` (دو مدل ناهنجاری — [MACHINE_LEARNING_FA.md](MACHINE_LEARNING_FA.md)).

## ۷. رخداد realtime مرتبط

- هر ۱.۵ ثانیه گیت‌وی نمونه‌های معتبر را تجمیع و رخداد `telemetry` می‌فرستد (`{devices: {deviceId: [...]}}`).
- داده backfill بعد از drain با `{backfill: true, samples}` ارسال می‌شود تا کلاینت‌ها تاریخچه بازیابی را ببینند.
- رخداد `activity` تعداد نمونه‌های ذخیره‌شده از بافر را اعلان می‌کند.
