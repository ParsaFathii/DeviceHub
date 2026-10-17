# معماری — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

این سند سیستم را **همان‌طور که در همین مخزن ساخته و آزمایش شده** توصیف می‌کند. هرجا مؤلفه‌ای با سند طراحی اولیه فرق دارد (مثلاً گیت‌وی TypeScript به‌جای گیت‌وی C++)، صریحاً ذکر شده است.

نسخه انگلیسی با جزئیات بیشتر: [ARCHITECTURE.md](../../ARCHITECTURE.md).

---

## ۱. مؤلفه‌ها و مسئولیت‌ها

| مؤلفه | مسیر | پورت | مسئولیت |
|---|---|---|---|
| شبیه‌ساز دستگاه | `mini-services/simulator` | 3012 | ۱۶ دستگاه قطعی با ۶ پروفایل + API کنترل و تزریق خطا |
| MQTT broker | `mini-services/broker` | 1883 | broker واقعی (aedes)، QoS 1، statusهای retained |
| گیت‌وی لبه | `mini-services/gateway` | 3011 | اعتبارسنجی، dedup، بافر پایدار، drain، اتوماسیون، مسیریابی فرمان |
| Backend + وب | `src/` (Next.js) | 3000 | REST API، نقش‌ها، Prisma+SQLite، ۱۱ نمای وب |
| realtime | `mini-services/realtime` | 3013 | socket.io، پخش رخداد به مرورگر |
| تحلیل | `mini-services/analytics` | 3014 | FastAPI: aggregation، تشخیص ناهنجاری، ارزیابی |
| کتابخانه پروتکل C | `protocol-c/` | — | codec مرجع فریم باینری C11 (۲۶ تست / ۵۱۹ assertion) |

### پروفایل‌های شبیه‌ساز

| پروفایل | رفتار |
|---|---|
| `STABLE` | مقادیر اسمی با نویز سنسور |
| `GRADUAL_DRIFT` | روند کند دور شدن از خط پایه |
| `THRESHOLD_VIOLATION` | بالا رفتن از آستانه قواعد (هشدار واقعی تولید می‌کند) |
| `INTERMITTENT` | قطعی‌های دوره‌ای اتصال، وصل مجدد و ادامه |
| `SENSOR_FAULT` | spikeهای گاه‌به‌گاه خارج از محدوده با کیفیت SUSPECT/BAD |
| `STALE` | چند نمونه می‌فرستد و بعد ساکت می‌شود (دستگاه OFFLINE) |

هر پیام `sim: true` دارد. API کنترل: `pause`، `resume`، `duplicate-last`، `delayed`، `replay-late-batch`، `profile` (به تفکیک دستگاه) و `pause/resume/restart` ناوگان.

### گیت‌وی لبه — به ترتیب پردازش

1. **اعتبارسنجی پروتکل v1** — ساختار envelope، تطابق deviceId/تاپیک، `msgId`، `seq`، انحراف زمانی (ردّ > ۵ دقیقه آینده / > ۲۴ ساعت گذشته)، ۱ تا ۱۶ metric، کیفیت enum، سقف ۶۴KiB. مقادیر خارج از محدوده **پذیرفته و SUSPECT علامت می‌خورند**؛ فقط پیام‌های ازنظر ساختاری نامعتبر رد می‌شوند (با شمارنده).
2. **Dedup** — پنجره درون‌حافظه‌ای ۸۰۰۰تایی `msgId` (هر وقت پُر شد، قدیمی‌ترین ربع حذف می‌شود). تحویل تکراری MQTT بی‌صدا drop و شمارش می‌شود.
3. **صف ارسال (forward queue)** — سقف ۱۰هزار (سرریز: قدیمی‌ترین drop و شمارش)، flush هر ۲ ثانیه در دسته‌های ۲۵تایی به `POST /api/internal/telemetry`.
4. **بافر پایدار (spool)** — وقتی Backend در دسترس نیست، پیام‌ها به SQLite با WAL می‌روند (سقف ۵۰۰۰ رکورد) و از `kill -9` جان سالم به در می‌برند.
5. **Drain خودکار** — بعد از بازیابی Backend یا هنگام boot، رکوردها در دسته‌های ۲۰تایی (با مکث ۵۰ms) و با **حفظ timestamp مبدأ** ارسال و رخداد DRAINED ثبت می‌شود.
6. **مانیتور نشست** — استتنتاج ONLINE/OFFLINE هر دستگاه از فعالیت پیام‌ها؛ تایم‌اوت سکوت ۴۵ ثانیه؛ تغییر وضعیت به Backend و realtime اعلام می‌شود.
7. **موتور اتوماسیون** — ارزیابی قطعی قواعد روی هر batch معتبر (بند ۳).
8. **مسیریابی فرمان** — انتشار روی `device/{id}/command` (QoS 1)، انتظار ack روی `device/{id}/ack`، تایم‌اوت ۳۰ ثانیه، به‌روزرسانی چرخه حیات فرمان.
9. **متریک و status** — انتشار retained روی `gateway/edge-gw-01/status` و heartbeat هر ۵ ثانیه به Backend.

API مدیریتی گیت‌وی: `GET /health`، `GET /status`، `GET /buffer`، `POST /simulate-offline`، `POST /dispatch`، `POST /buffer/clear`.

### Backend و وب

Next.js 16 + TypeScript + Tailwind + shadcn/ui + recharts؛ کلاینت تک‌صفحه‌ای با ۱۱ نما. مسئولیت‌های سرور: نشست و نقش‌ها (سمت سرور، روی همه routeها)، Prisma+SQLite با ۱۵ مدل، REST عمومی (با نشست) و داخلی (`/api/internal/*` با X-Internal-Token)، ingest تله‌متری با dedup نهایی (کلید یکتا `(deviceId, metric, sequence)`) و محاسبه پرچم delayed، مدیریت چرخه حیات فرمان با اعتبارسنجی قابلیت و audit، هشدارها، قواعد (CRUD + نسخه‌بندی + اجراها)، audit، ذخیره یافته‌های ناهنجاری، proxy تحلیل و AI diagnostics.

### realtime

سرور socket.io. تولیدکننده‌های سمت سرور (گیت‌وی، Backend، تحلیل) با `POST /emit` و توکن داخلی رخداد می‌فرستند؛ مرورگرها fan-out می‌گیرند. کلاینت‌ها می‌توانند اتاق هر دستگاه را join کنند (`subscribe-device` با id ماچ‌شده با `^DH-[A-Z0-9-]+$`).

### تحلیل

FastAPI با endpointهای `GET /health`، `POST /aggregate` (بکت‌بندی هم‌تراز با epoch، تشخیص gap، شمارش out-of-order)، `POST /detect` (هر دو مدل)، `POST /evaluate`، `GET /model-info`. ارتباط با Backend فقط از مسیر APIهای داخلی با httpx (تایم‌اوت ۱۰ ثانیه، ۲ retry با backoff).

---

## ۲. جریان داده سرتاسری

```
 دستگاه (شب)        broker            گیت‌وی لبه               Backend               کلاینت‌ها
────────────  ─────────────────  ──────────────────────  ─────────────────────  ─────────────
 انتشار          مسیریابی QoS 1    اعتبارسنجی v1           POST /api/internal/     رخداد
 device/{id}/                      dedup (msgId)           telemetry (دسته ۲۵)     socket.io
 telemetry    ──────────────►      enqueue ── flush 2s ──►  کلید یکتا              ──► نماهای وب
                                                           (device, metric,
                                                            sequence)
                                                           sampleTs حفظ می‌شود،
                                                           receivedTs = اکنون،
                                                           محاسبه پرچم delayed
                                     │
                                     ├─ ارزیابی قواعد ────► POST rule-executions
                                     │   (در لبه)            └─ fire ──► POST alerts
                                     ├─ مانیتور نشست ─────► PATCH devices/{id}
                                     │   (تایم‌اوت ۴۵s)        ONLINE/OFFLINE
                                     └─ Backend قطع؟ ──► بافر SQLite (WAL، ۵۰۰۰)
                                         بازیابی/boot: drain دسته‌های ۲۰تایی،
                                         حفظ timestamp مبدأ، رخداد DRAINED
```

مسیر وضعیت: دستگاه‌ها heartbeat با status retained می‌فرستند؛ گیت‌وی برای keep-alive نشست و انتشار health از آن استفاده می‌کند. مسیر فرمان برعکس است: Backend → `/dispatch` گیت‌وی → `device/{id}/command` → اجرای دستگاه → `device/{id}/ack` → گیت‌وی → به‌روزرسانی وضعیت در Backend → realtime + audit.

---

## ۳. ماشین حالت بافر آفلاین

هر رکورد بافر (که در store مرکزی هم به‌صورت `BufferRecord` برای audit آینه می‌شود):

```
                رسیدن تله‌متری، Backend در دسترس نیست
                              │
                              ▼
                          PENDING ──────────────┐
                    (بافر SQLite، حفظ ts)        │ سرریز بافر (۵۰۰۰):
                              │                  │ قدیمی‌ترین رکورد → LOST
              Backend سالم    │  یا boot         │ (ثبت lossReason)
                              ▼                   │
 drain: دسته‌های ۲۰،    ┌──────────┐              │
 مکث ۵۰ms، حفظ        │ UPLOADED │              │
 sampleTs ───────────►└──────────┘              │
                              ▲                  │
                  POST /api/internal/telemetry    │
                  با fromBuffer: true             │
                              │                  │
                              │  پاک‌کردن دستی ───┘
                              │  (POST /buffer/clear → LOST)
```

دو ماشه drain: **drain بعد از وصل مجدد** (heartbeat هر ۵ ثانیه سلامت Backend را تشخیص می‌دهد → رخداد DRAINING → drain → DRAINED) و **drain هنگام boot** (در هندلر connect، هرچه در بافر هست ارسال می‌شود).

رفتار آزمایش‌شده: قطعی ۳۰ ثانیه‌ای → ۸۹ رکورد spool → drain خودکار → رخداد DRAINED؛ `kill -9` گیت‌وی با ۵۷ رکورد در بافر → ری‌استارت → drain کامل در boot؛ batchهای خراب هرگز retry نمی‌شوند (به‌عنوان rejected شمرده می‌شوند)؛ خطای transport باعث spool و retry می‌شود.

---

## ۴. حلقه ارزیابی موتور اتوماسیون

در گیت‌وی، روی هر batch معتبر، برای هر جفت قاعده/دستگاه تطبیق‌یافته:

```
            رسیدن نمونه برای metric قاعده
                          │
                 مقایسه مقدار با آستانه
                          │
          ┌─────────── برقرار ──────────┐
          ▼                             ▼
       نقض شرط                       برقرار
          │                             │
   ریست heldSince ──► NOT_MET     heldSince ست شده؟ ──نه──► CONDITION_MET_WAITING
   (ثبت هنگام گذار)                │ بله
                                   ▼
                       heldSec ≥ durationSec؟ ──نه──► ادامه انتظار
                                   │ بله
                                   ▼
                       داخل cooldownSec از آخرین
                       تریگر؟ ──بله──► SUPPRESSED_COOLDOWN
                                   │ نه
                                   ▼
                                 FIRE
             ساخت هشدار (شدت + evidence: مقدار مشاهده‌شده، آستانه،
             heldSec، نسخه قاعده، sampleTs، کیفیت)
             ریست heldSince، ست شدن lastTriggeredAt
             هر خروجی → رکورد RuleExecution
```

قواعد هر ۱۵ ثانیه و نگاشت نوع دستگاه‌ها هر ۶۰ ثانیه از Backend تازه می‌شوند. چون ارزیابی در لبه است، هشداردهی در قطعی Backend هم (بعد از بازیابی، از مسیر forwarding) ادامه دارد. موتور قطعی است: ورودی یکسان، خروجی یکسان.

---

## ۵. ماشین حالت فرمان

```
                  POST /api/commands (با نقش OPERATOR/ADMIN)
                              │ اعتبارسنجی اکشن با قابلیت‌های دستگاه
                              │ + اعتبارسنجی payload (رد شدن‌ها audited، 422)
                              ▼
        ┌────────────── REQUESTED ──────────────┐
        │        (ایجاد، expiresAt = +۱۲۰ ثانیه) │
        ▼                                       │
    AUTHORIZED (نقش تأیید شد)                   │ ارسال به /dispatch گیت‌وی
        │                                       ▼
        │                                  QUEUED (گیت‌وی پذیرفت)
        │                                       │ انتشار روی
        │                                       │ device/{id}/command (QoS 1)
        │                                       ▼
        │                                     SENT
        │                                       │
        │                     ┌── ack روی device/{id}/ack ──┐
        │                     ▼                             ▼
        │              ACKNOWLEDGED code=OK           code≠OK یا نبودِ ack
        │                     │                        تا ۳۰ ثانیه
        │                     ▼                             │
        │                SUCCEEDED                      FAILED
        │            (completedAt، result،            (ackCode، result،
        │             audit)                             audit)
        │
        └── گیت‌وی در دسترس نیست / دستگاه آفلاین ──► FAILED (خطای dispatch)
        └── ارسال نشدن قبل از انقضا ────────────────► EXPIRED
```

هر گذار در audit ثبت و روی رخداد realtime `command` منتشر می‌شود. پیشنهادهای AI مستقیماً وارد این ماشین نمی‌شوند — اپراتور باید آن‌ها را از مسیر ممیزی‌شده عادی ثبت کند (آزمایش‌شده: صفر فرمان با منشأ AI در audit).

---

## ۶. کاتالوگ رخدادهای realtime

| رخداد | payload | تولیدکننده |
|---|---|---|
| `telemetry` | زنده: `{devices: {deviceId: [نمونه‌ها]}}` (تجمیع ۱.۵ ثانیه‌ای)؛ backfill: `{backfill: true, samples}` | گیت‌وی / Backend |
| `device-state` | `{deviceId, state, lastSeenAt}` | گیت‌وی |
| `alert` | رکورد هشدار جدید | Backend |
| `alert-updated` | گذارهای ack/resolve | Backend |
| `command` | گذارهای چرخه حیات فرمان | Backend / گیت‌وی |
| `gateway` | `{gatewayId, state, buffering, pending, drained?}` | گیت‌وی |
| `rule-execution` | رکوردهای خروجی قاعده | Backend |
| `anomaly` | یافته‌های ML | Backend / تحلیل |
| `activity` | موارد feed فعالیت (متن انسانی) | Backend / گیت‌وی |
| `buffer` | تغییرهای وضعیت بافر | Backend |

ارسال رخداد به توکن داخلی و allow-list اسم رخداد (سمت سرور) نیاز دارد؛ payloadهای مرورگر هیچ credentialای ندارند.

---

## ۷. حالات خطا

| خطا | رفتار سیستم | آزمایش |
|---|---|---|
| تحویل تکراری MQTT | drop با `msgId` در گیت‌وی؛ کلید یکتا در Backend به‌عنوان خط آخر دفاع | R1 |
| تله‌متری تأخیری | ذخیره با `delayed: true` و حفظ `sampleTs`؛ هرگز دور ریخته نمی‌شود | R2 |
| قطعی Backend (۳۰ ثانیه) | spool محلی (۸۹ رکورد در تست)، drain خودکار، رخداد DRAINED | R3 |
| کرش گیت‌وی (`kill -9`) با بافر پُر | spool با WAL زنده می‌ماند؛ drain در boot (۵۷ رکورد در تست) | R4 |
| تله‌متری خراب | رد در اعتبارسنجی با شمارنده؛ batch خراب retry نمی‌شود | R5 |
| batch بزرگ | 413 از Backend (سقف ۵۰۰ پیام) | تست امنیت |
| سکوت دستگاه | تایم‌اوت ۴۵ ثانیه → OFFLINE؛ ادامه → ONLINE | R6 |
| ری‌استارت broker | وصل مجدد خودکار شبیه‌ساز و گیت‌وی؛ نشست پایدار گیت‌وی از سر گرفته می‌شود | R7 |
| قطع سرویس تحلیل | aggregation به پیاده‌سازی TypeScript داخل Backend fallback می‌کند | تست کارکردی |
| در دسترس نبودن سرویس AI | فقط `/api/ai/diagnostics` افت می‌کند؛ بقیه پلتفرم سالم | حین ساخت آزمایش شد |
| سرریز spool (>۵۰۰۰) | drop قدیمی‌ترین، ثبت LOST/OVERFLOW، شمارش در متریک‌ها | پیاده‌سازی گیت‌وی |
| تایم‌اوت ack فرمان (۳۰ ثانیه) | فرمان → FAILED با جزئیات خطا | تست کارکردی |

---

## ۸. انطباق‌های مستندشده این ساخت

- SQLite (Prisma) به‌جای PostgreSQL — شِما با Prisma قابل انتقال است؛ فقط SQLite ساخته و تست شده.
- گیت‌وی لبه یک سرویس TypeScript است؛ گیت‌وی C++ سند معماری به همین مؤلفه نگاشت می‌شود (همان مسئولیت‌ها).
- کتابخانه C11 پروتکل واقعی و تست‌شده است، ولی مسیر MQTT زنده، شکل JSON پروتکل v1 را جابه‌جا می‌کند.
- بدون کلاینت موبایل، بدون Spring Boot، بدون Docker، بدون سخت‌افزار فیزیکی؛ همه داده ناوگان، داده شبیه‌ساز است.
