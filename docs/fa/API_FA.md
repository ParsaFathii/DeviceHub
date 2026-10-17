# مرجع API — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

پایه: `http://localhost:3000`. دو خانواده endpoint وجود دارد:

- **عمومی** — نیاز به کوکی نشست (`dh_session` از `POST /api/auth/login`)؛ کنترل نقش سمت سرور.
- **داخلی** (`/api/internal/*`) — بدون نشست؛ نیاز به هدر `X-Internal-Token`؛ فقط برای سرویس‌های زیرین (گیت‌وی، شبیه‌ساز، تحلیل).

این سند نقشه کامل است، نه مستندات فیلدبه‌فیلد؛ برای جزئیات payload به کد routeها در `src/app/api/` مراجعه کنید.

---

## ۱. احراز هویت

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `POST /api/auth/login` | — | `{username, password}` → set-cookie نشست |
| `POST /api/auth/logout` | — | حذف نشست (کوکی قبلی نامعتبر می‌شود) |
| `GET /api/auth/me` | همه | اطلاعات کاربر جاری |

## ۲. ناوگان و دستگاه‌ها

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `GET /api/overview` | همه | KPIها و خلاصه ناوگان |
| `GET /api/devices` | همه | فهرست دستگاه‌ها (فیلتر/صفحه‌بندی) |
| `GET /api/devices/{deviceId}` | همه | جزئیات + تله‌متری اخیر + رخدادها + هشدارها |
| `GET /api/gateways` | همه | فهرست گیت‌وی‌ها با متریک‌ها و رخدادها |
| `GET /api/gateways/{gatewayId}` | همه | جزئیات یک گیت‌وی |
| `POST /api/gateways/{gatewayId}/outage` | ADMIN | تزریق قطعی Backend (پروکسی به `POST :3011/simulate-offline`) |

## ۳. تله‌متری و تحلیل

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `GET /api/telemetry` | همه | کاوشگر تله‌متری (پارامترهای دستگاه/متریک/بازه) |
| `GET /api/anomalies` | همه | یافته‌های ناهنجاری ذخیره‌شده |
| `POST /api/analytics/detect` | همه | اجرای تشخیص (پروکسی به سرویس ۳۰۱۴) |
| `POST /api/analytics/evaluate` | همه | اجرای ارزیابی مدل‌ها |
| `GET /api/analytics/model-info` | همه | فراداده و محدودیت مدل‌ها |

## ۴. اتوماسیون

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `GET /api/rules` | همه | فهرست قواعد |
| `POST /api/rules` | OPERATOR/ADMIN | ایجاد قاعده |
| `GET/PATCH/DELETE /api/rules/{ruleId}` | OPERATOR/ADMIN (خواندن: همه) | جزئیات/به‌روزرسانی (نسخه‌بندی خودکار)/حذف |
| `GET /api/rules/{ruleId}/executions` | همه | تاریخچه اجرای قاعده |

## ۵. هشدارها

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `GET /api/alerts` | همه | فهرست هشدارها |
| `POST /api/alerts/{alertId}/ack` | OPERATOR/ADMIN | پذیرش هشدار (ACKNOWLEDGED) |
| `POST /api/alerts/{alertId}/resolve` | OPERATOR/ADMIN | رفع هشدار (RESOLVED) |

## ۶. فرمان‌ها

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `GET /api/commands` | همه | تاریخچه فرمان‌ها (فیلتر دستگاه/وضعیت) |
| `POST /api/commands` | OPERATOR/ADMIN | `{deviceId, action, payload, source?}` → اعتبارسنجی قابلیت → dispatch از مسیر گیت‌وی → QUEUED/FAILED |
| `GET /api/commands/{commandId}` | همه | وضعیت یک فرمان |

نکته: موفقیت هرگز هنگام پذیرش API اعلام نمی‌شود — وضعیت نهایی فقط با ack واقعی دستگاه کامل می‌شود.

## ۷. AI، ممیزی، سیستم و شبیه‌ساز

| متد و مسیر | نقش | توضیح |
|---|---|---|
| `POST /api/ai/diagnostics` | همه | `{question, deviceId?}` → پاسخ evidence-grounded و advisory-only |
| `GET /api/ai/status` | همه | وضعیت سرویس AI |
| `GET /api/audit` | همه | رخدادهای audit (فیلتر/صفحه‌بندی) |
| `GET /api/system/status` | همه | سلامت پنج سرویس زیرین + آمار DB |
| `GET /api/simulator/status` | همه | وضعیت ناوگان شبیه‌ساز |
| `POST /api/simulator/control` | ADMIN | کنترل دستگاه/ناوگان (pause/resume/…) |
| `GET /api/users` | ADMIN | فهرست کاربران |

---

## ۸. API داخلی (X-Internal-Token)

| متد و مسیر | فراخوان | توضیح |
|---|---|---|
| `POST /api/internal/telemetry` | گیت‌وی | ingest batch (سقف ۵۰۰ پیام؛ پاسخ `{accepted, duplicates, rejected}`) |
| `GET /api/internal/telemetry` | تحلیل | export نمونه‌ها با فیلتر (سقف ۵۰۰۰) |
| `PATCH /api/internal/devices/{deviceId}` | گیت‌وی | به‌روزرسانی وضعیت/سلامت/lastSeen |
| `GET /api/internal/devices` | گیت‌وی | فهرست دستگاه‌ها (برای نگاشت نوع) |
| `GET /api/internal/rules` | گیت‌وی | قواعد فعال برای موتور لبه |
| `POST /api/internal/rule-executions` | گیت‌وی | ثبت خروجی ارزیابی قاعده |
| `POST /api/internal/alerts` | گیت‌وی | ایجاد هشدار هنگام FIRE |
| `POST /api/internal/gateway/status` | گیت‌وی | heartbeat وضعیت/متریک گیت‌وی |
| `POST /api/internal/gateway/event` | گیت‌وی | رخدادهای CONNECTED/BUFFERING/DRAINING/DRAINED/OVERFLOW |
| `POST /api/internal/commands/{commandId}/state` | گیت‌وی | گذار وضعیت فرمان (SENT/SUCCEEDED/FAILED) |

---

## ۹. سرویس‌های mini-service (خارج از Next.js)

### گیت‌وی لبه (:3011)

| متد و مسیر | توضیح |
|---|---|
| `GET /health` | سلامت |
| `GET /status` | وضعیت کامل + متریک‌ها + نشست دستگاه‌ها |
| `GET /buffer` | رکوردهای pending بافر |
| `POST /simulate-offline` | `{seconds}` (۵ تا ۶۰۰) — تزریق قطعی Backend |
| `POST /dispatch` | مسیریابی فرمان به MQTT |
| `POST /buffer/clear` | پاک‌کردن دستی بافر (ثبت LOST) |

### شبیه‌ساز (:3012)

| متد و مسیر | توضیح |
|---|---|
| `GET /health` | سلامت |
| `GET /status` | وضعیت ناوگان |
| `POST /control` | `{deviceId, action}` — pause / resume / duplicate-last / delayed / replay-late-batch / profile |
| `POST /fleet` | `{action}` — pause / resume / restart (ری‌ست seedها → بازپخش قطعی) |

### realtime (:3013)

| متد و مسیر | توضیح |
|---|---|
| `GET /health` | سلامت + تعداد کلاینت/emit |
| `POST /emit` | (با X-Internal-Token) `{event, data}` — فقط رخدادهای allow-list شده |

### تحلیل (:3014)

| متد و مسیر | توضیح |
|---|---|
| `GET /health` | سلامت + نسخه مدل |
| `POST /aggregate` | بکت‌بندی + gap + outOfOrder |
| `POST /detect` | اجرای هر دو مدل ناهنجاری |
| `POST /evaluate` | ارزیابی روی دیتاست برچسب‌دار |
| `GET /model-info` | فراداده و محدودیت‌ها |

---

## ۱۰. قراردادهای کلی

- پاسخ‌ها JSON؛ خطاها به شکل `{"error": "..."}` با کد وضعیت مناسب (400/401/403/404/409/413/422/502/503).
- نقش‌های لازم: خواندن = همه؛ نوشتن عملیاتی = OPERATOR یا ADMIN؛ کنترل زیرساخت = ADMIN.
- همه رفتارهای نوشتاری و رد شدن‌ها در audit ثبت می‌شوند.
- سقف‌ها: batch ingest ۵۰۰ پیام؛ پیام MQTT ۶۴KiB؛ بدنه emit ۲MB؛ سؤال AI ۵۰۰ نویسه.
