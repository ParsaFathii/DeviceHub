# MQTT در DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

Broker این استقرار **aedes** است (embedded، پورت ۱۸۸۳، TCP). کد منبع: `mini-services/broker/index.ts`. کلاینت‌ها: شبیه‌ساز (هر دستگاه یک کلاینت) و گیت‌وی لبه.

---

## ۱. سلسله‌طبقات تاپیک‌ها

| تاپیک | جهت | QoS | retained | payload |
|---|---|---|---|---|
| `device/{id}/telemetry` | دستگاه → گیت‌وی | 1 | خیر | envelope پروتکل v1 (JSON) |
| `device/{id}/status` | دستگاه → گیت‌وی | 1 | **بله** | heartbeat: `{deviceId, state, health, …}` |
| `device/{id}/command` | گیت‌وی → دستگاه | 1 | خیر | `{v, commandId, deviceId, action, payload, issuedAt, expiresAt}` |
| `device/{id}/ack` | دستگاه → گیت‌وی | 1 | خیر | `{commandId, code, detail}` با code ∈ OK/REJECTED/UNSUPPORTED/ERROR |
| `gateway/{gatewayId}/status` | گیت‌وی → broker | 1 | **بله** | وضعیت + متریک‌های گیت‌وی |

نمونه واقعی: `device/DH-ENV-001/telemetry` و `gateway/edge-gw-01/status`.

اشتراک گیت‌وی: `device/+/telemetry`، `device/+/status`، `device/+/ack` — هر سه با QoS 1.

## ۲. QoS

همه تاپیک‌های پلتفرم با **QoS 1** (at-least-once) کار می‌کنند. انتخاب عمدی است:

- تله‌متری نباید گم شود (پایین‌دست بافر پایدار دارد)؛
- QoS 1 یعنی تحویل تکراری ممکن است — برای همین **دو لایه dedup** وجود دارد: پنجره `msgId` در گیت‌وی (۸۰۰۰ شناسه) و کلید یکتا `(deviceId, metric, sequence)` در پایگاه‌داده. تحویل تکراری در تست واقعی بررسی و dedup شده است.

## ۳. پیام‌های retained

- `device/{id}/status` — آخرین وضعیت دستگاه retained می‌شود تا مشترک تازه‌وارد بلافاصله وضعیت فعلی را ببیند.
- `gateway/{id}/status` — آخرین وضعیت گیت‌وی retained می‌شود (CONNECTED/BUFFERING/ONLINE/OFFLINE همراه متریک‌ها).

## ۴. رفتار نشست (session)

کلاینت MQTT گیت‌وی با این تنظیمات وصل می‌شود:

| پارامتر | مقدار | نتیجه |
|---|---|---|
| clientId | `gateway-edge-gw-01` | شناسه پایدار |
| clean | `false` | **نشست پایدار** — broker پیام‌های QoS 1 را تا وصل مجدد گیت‌وی نگه می‌دارد |
| keepalive | ۳۰ ثانیه | — |
| reconnectPeriod | ۳۰۰۰ms | تلاش وصل مجدد خودکار |
| connectTimeout | ۸۰۰۰ms | — |

اعداد broker: concurrency برابر ۱۰۰، heartbeatInterval برابر ۶۰ ثانیه، connectTimeout برابر ۳۰ ثانیه.

## ۵. پایداری زیر خطا (آزمایش‌شده)

| رخداد | رفتار |
|---|---|
| ری‌استارت broker | کلاینت‌ها (شبیه‌ساز و گیت‌وی) خودکار وصل مجدد می‌شوند؛ نشست پایدار گیت‌وی تحویل‌های عقب‌مانده QoS 1 را از سر می‌گیرد |
| قطع موقت شبکه بین دستگاه و broker | با QoS 1، پیام به‌ازای هر دستگاه دوباره تحویل می‌شود؛ dedup گیت‌وی نسخه تکراری را می‌گیرد |
| قطع گیت‌وی از broker | گیت‌وی status «DISCONNECTED» منتشر می‌کند، بعد از وصل مجدد «CONNECTED» و spool را drain می‌کند |

این‌ها صرفاً ادعا نیستند — سناریوی ری‌استارت broker بخشی از مجموعه تست قابلیت اطمینان است و سبز شده.

## ۶. محدودیت‌های امنیتی این پیکربندی (مهم)

پیکربندی توسعه این استقرار:

- **بدون TLS** — TCP خام روی ۱۸۸۳؛
- **کلاینت‌های بی‌نام مجازند** — احراز هویت MQTT وجود ندارد؛
- ACL تاپیک وجود ندارد.

برای استقرار عملیاتی الزامات در [SECURITY_FA.md](SECURITY_FA.md) آمده است: listener با TLS (مثلاً 8883) و گواهی سرور، گواهی کلاینت به‌ازای دستگاه/گیت‌وی، credential یکتا برای هر کلاینت و ACL تاپیک‌ها.

## ۷. اندازه‌گیری‌ها و مشاهده

- broker آمار اتصال/انتشار/تحویل/خطا را هر ۳۰ ثانیه در stdout لاگ می‌کند.
- گیت‌وی وضعیت retained خود را همراه متریک‌ها (received، forwarded، deduped، rejected، buffered، uploadedFromBuffer، dropped، queueDepth، pendingSpool) منتشر می‌کند.
- `GET :3011/status` همان اطلاعات را JSON برمی‌گرداند.
