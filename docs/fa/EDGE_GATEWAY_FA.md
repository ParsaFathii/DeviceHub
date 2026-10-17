# گیت‌وی لبه (Edge Gateway) — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

کد منبع: `mini-services/gateway/index.ts` — سرویس TypeScript روی پورت ۳۰۱۱.

> **یادداشت انطباق:** در سند معماری اولیه، این مؤلفه «گیت‌وی C++» توصیف شده بود. در همین ساخت، مسئولیت‌های آن (اعتبارسنجی پروتکل، dedup، بافر آفلاین، drain، اتوماسیون، مسیریابی فرمان) با یک سرویس TypeScript پیاده و آزمایش شده‌اند — همان مسئولیت‌ها، زبان اجرای متفاوت. کتابخانه پروتکل C (`protocol-c/`) واقعی و تست‌شده است ولی جزو مسیر اجرای زنده این استقرار نیست.

---

## ۱. جریان پردازش هر پیام

```
 پیام MQTT می‌رسد (device/{id}/telemetry|status|ack)
        │
        ├─ اندازه > ۶۴KiB؟ ──► رد + شمارنده rejected
        ├─ JSON نامعتبر؟ ──► رد + شمارنده rejected
        ▼
 telemetry؟ ──► اعتبارسنجی پروتکل v1 (بند ۲)
        │        └─ نامعتبر ──► رد + رخداد GATEWAY_REJECT روی realtime
        ├─ msgId تکراری؟ ──► drop بی‌صدا + شمارنده deduped
        ├─ touchSession (ONLINE در صورت نیاز)
        ├─ enqueue در صف ارسال (سقف ۱۰هزار)
        ├─ تجمیع برای realtime (flush هر ۱.۵ ثانیه)
        └─ evaluateRules (موتور اتوماسیون — AUTOMATION_FA.md)
 status؟  ──► heartbeat: touchSession + انتشار health به Backend
 ack؟     ──► handleAck: به‌روزرسانی چرخه حیات فرمان (بند ۵)
```

## ۲. اعتبارسنجی پروتکل v1

شرایط پذیرش یک envelope تله‌متری:

- `v === 1` و ساختار object؛
- `deviceId` ماچ با `^DH-[A-Z0-9-]+$` و هم‌خوان با تاپیک؛
- `msgId` رشته‌ای ۱ تا ۱۲۸ نویسه؛
- `seq` عدد صحیح در بازه [۰، ۱۰⁹]؛
- `ts` محدود (نه بیش از ۵ دقیقه آینده، نه بیش از ۲۴ ساعت گذشته)؛
- `metrics` آرایه‌ای ۱ تا ۱۶تایی با metric شناخته‌شده و quality معتبر.

**مقادیر خارج از محدوده فیزیکی رد نمی‌شوند** — پذیرفته و SUSPECT علامت می‌خورند. جدول محدوده‌ها (در گیت‌وی):

| metric | محدوده | واحد |
|---|---|---|
| temperature | −۶۰ تا ۱۵۰ | °C |
| humidity | ۰ تا ۱۰۰ | % |
| pressure | ۷۰۰ تا ۱۲۰۰ | hPa |
| motion | ۰ تا ۱۰۰ | events/min |
| power | ۰ تا ۲۰۰ | kW |
| energy | ۰ تا ۱۰⁹ | kWh |
| vibration | ۰ تا ۸۰ | mm/s |
| voltage | ۰ تا ۴۰۰ | V |
| current | ۰ تا ۲۰۰ | A |
| status | ۰ تا ۲۵۵ | code |

## ۳. صف ارسال و بافر پایدار

دو ساختار موازی:

1. **صف درون‌حافظه‌ای (forward queue):** سقف ۱۰هزار پیام؛ flush هر ۲ ثانیه، هر بار حداکثر ۲۵ پیام در یک batch به `POST /api/internal/telemetry`. سرریز: قدیمی‌ترین پیام drop می‌شود و شمارنده `dropped` بالا می‌رود.
2. **بافر پایدار SQLite (spool):** فایل `mini-services/gateway/data/edge.db` با **WAL**؛ جدول `buffer` با ستون‌های `msg_id` (یکتا)، `topic`، `payload`، `ts` (زمان مبدأ)، `tries`، `created_at`. سقف ۵۰۰۰ رکورد.

هر وقت Backend در دسترس نباشد (پاسخ ۵xx، تایم‌اوت یا حالت شبیه‌سازی قطعی)، پیام‌های صف به spool منتقل می‌شوند. پاسخ ۴۰۰ (batch خراب) هرگز retry نمی‌شود — به‌عنوان rejected شمرده و لاگ می‌شود.

### سرریز spool

اگر تعداد رکوردها به ۵۰۰۰ برسد، **قدیمی‌ترین** رکورد حذف و به‌عنوان LOST ثبت می‌شود (لاگ صریح با شناسه msg_id) و شمارنده dropped بالا می‌رود.

## ۴. Drain (تخلیه بافر)

دو ماشه:

- **بعد از بازیابی Backend** — heartbeat هر ۵ ثانیه وضعیت Backend را می‌سنجد؛ به‌محض سلامت، رخداد DRAINING ثبت و drain شروع می‌شود. همین‌طور وقتی پنجره تزریق قطعی (`POST /simulate-offline`) تمام شود.
- **هنگام boot** — در هندلر connect به broker، هرچه در spool مانده ارسال می‌شود (رفتار «drain on restart»).

الگوریتم drain:

```
تا وقتی رکوردی در spool هست:
    برداشتن ۲۰ رکورد قدیمی‌ترین‌به‌جدیدترین
    POST /api/internal/telemetry { messages, fromBuffer: true }
    اگر موفق: حذف آن ۲۰ رکورد از spool، شمارش uploadedFromBuffer
    اگر ناموفق: توقف (رکوردها برای تلاش بعدی می‌مانند)
    مکث ۵۰ms بین دسته‌ها
اگر چیزی drain شد:
    ثبت رخداد DRAINED (تعداد drained + pending باقی‌مانده)
    اعلان realtime «activity»
```

**حفظ timestamp مبدأ:** payload از اول ذخیره می‌شود و `sampleTs` همان `ts` دستگاه باقی می‌ماند — drain هیچ زمانی را بازنویسی نمی‌کند. در پایگاه‌داده مرکزی این رکوردها `receivedTs` جدید می‌گیرند و (چون بعد از نمونه‌های جدیدتر رسیده‌اند) پرچم `delayed` می‌خورند (بند ۶).

نتایج آزمایش واقعی: قطعی ۳۰ ثانیه‌ای Backend → ۸۹ رکورد spool → drain خودکار کامل → رخداد DRAINED. `kill -9` گیت‌وی با ۵۷ رکورد در بافر → ری‌استارت → drain کامل همان ۵۷ رکورد در boot (برهه‌ی WAL بودن دیتابیس ثابت ماند).

## ۵. مسیریابی فرمان و تایم‌اوت ack

`POST /dispatch` از سمت Backend (با توکن داخلی) فرمان را می‌گیرد:

- اگر دستگاه در ۶۰ ثانیه اخیر پیامی نداده باشد → پاسخ ۴۰۹ «device is not connected to this gateway».
- در غیر این صورت envelope فرمان روی `device/{id}/command` با QoS 1 منتشر می‌شود، وضعیت فرمان به SENT به‌روزرسانی و رخداد realtime ارسال می‌شود.
- تایمر ۳۰ ثانیه‌ای: اگر تا آن موقع ack نیاید، فرمان FAILED می‌شود (`no acknowledgement received within timeout`).
- ack دستگاه با `commandId` به pendingCommands نگاشت می‌شود؛ code=OK → SUCCEEDED، غیر آن → FAILED با ackCode و ackDetail. ackهای دیرهنگام/ناشناخته نادیده گرفته می‌شوند.

## ۶. مانیتور نشست و تایم‌اوت OFFLINE

- هر پیام معتبر (تله‌متری یا heartbeat) `lastSeen` دستگاه را تازه می‌کند؛ اولین مشاهده وضعیت را ONLINE می‌کند (PATCH داخلی + رخداد realtime).
- هر ۵ ثانیه بررسی می‌شود: اگر دستگاهی ONLINE باشد و **۴۵ ثانیه** است پیام نداشته → OFFLINE (PATCH داخلی با دلیل «no message for Ns» + رخداد realtime).
- پیام status با state=OFFLINE هم همین گذار را فوری ایجاد می‌کند.

آزمایش‌شده: pause دستگاه → ۴۵ ثانیه → OFFLINE → resume → اولین تله‌متری → ONLINE.

## ۷. متریک‌ها، API مدیریتی و heartbeat

شمارنده‌های گیت‌وی: `received`، `forwarded`، `deduped`، `rejected`، `buffered`، `uploadedFromBuffer`، `dropped`، `alertsFired`، `commandsRouted`، `queueDepth`، `pendingSpool`.

| Endpoint | کار |
|---|---|
| `GET /health` | سلامت ساده |
| `GET /status` | وضعیت کامل: mqttConnected، backendHealthy، متریک‌ها، وضعیت نشست دستگاه‌ها |
| `GET /buffer` | تا ۲۰۰ رکورد pending با `msgId`، تاپیک و زمان‌ها |
| `POST /simulate-offline {seconds}` | تزریق قطعی Backend (۵ تا ۶۰۰ ثانیه) — رخداد BUFFERING ثبت می‌شود |
| `POST /dispatch` | مسیریابی فرمان (فراخوانی Backend) |
| `POST /buffer/clear` | پاک‌کردن دستی spool — رخداد OVERFLOW با دلیل «manually cleared» |

heartbeat هر ۵ ثانیه: انتشار status retained روی `gateway/edge-gw-01/status` و ارسال وضعیت/متریک به `POST /api/internal/gateway/status`.

## ۸. تازگی قواعد و نگاشت دستگاه‌ها

- قواعد اتوماسیون هر ۱۵ ثانیه از `GET /api/internal/rules` تازه می‌شوند (بنابراین تغییر قاعده حداکثر ~۱۵ ثانیه بعد در لبه اعمال می‌شود).
- نگاشت نوع دستگاه‌ها هر ۶۰ ثانیه از `GET /api/internal/devices` تازه می‌شود (برای selector قواعد بر اساس نوع).

## ۹. خاموشی

`SIGINT` → انتشار وضعیت OFFLINE روی تاپیک retained، توقف سرور، بستن MQTT و خروج. داده بافر شده از بین نمی‌رود (SQLite) و بعد از اجرای بعدی drain می‌شود.
