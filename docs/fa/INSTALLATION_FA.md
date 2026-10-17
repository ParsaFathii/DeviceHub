# نصب و راه‌اندازی — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

این سند راه‌اندازی کامل پلتفرم را در محیط توسعه توضیح می‌دهد. نسخه انگلیسی: [README.md → Quick start](../../README.md#quick-start).

---

## پیش‌نیازها

| ابزار | نسخه آزمایش‌شده | کاربرد |
|---|---|---|
| [Bun](https://bun.sh) | آخرین نسخه پایدار | اجرای وب و سرویس‌های TypeScript |
| Node/Next | Next.js 16 | به‌همراه Bun اجرا می‌شود (`next dev -p 3000`) |
| Python | 3.12 | سرویس تحلیل (FastAPI) |
| pip | همراه Python | نصب وابستگی‌های تحلیل |
| gcc | 14.2 (C11) | فقط برای ساخت `protocol-c/` |

پکیج‌های Python لازم برای سرویس تحلیل: `fastapi`، `uvicorn`، `scikit-learn`، `numpy`، `httpx` و برای تست‌ها `pytest` (همه در `mini-services/analytics/requirements.txt`).

---

## گام ۱ — وب و Backend

```bash
cd /home/z/my-project
bun install
```

فایل `.env` را بسازید (در همین محیط از این مسیر استفاده شده است):

```bash
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env
```

ساخت شِما و داده اولیه:

```bash
bunx prisma db push      # ساخت شِمای SQLite (۱۵ مدل)
bun prisma/seed.ts       # کاربرها، گیت‌وی، ۱۶ دستگاه، ۶ قاعده (idempotent)
```

seed با upsert کار می‌کند؛ اجرای دوباره آن داده تکراری نمی‌سازد.

اجرا:

```bash
bun run dev              # Next.js روی پورت 3000
```

## گام ۲ — MQTT broker

```bash
cd mini-services/broker
bun install
bun run dev              # aedes روی پورت 1883
```

## گام ۳ — ناوگان شبیه‌ساز دستگاه‌ها

```bash
cd mini-services/simulator
bun install
bun run dev              # کنترل API روی پورت 3012
```

۱۶ دستگاه seed-شده با ۶ پروفایل رفتاری شروع به انتشار تله‌متری روی broker می‌کنند.

## گام ۴ — گیت‌وی لبه

```bash
cd mini-services/gateway
bun install
bun run dev              # پورت 3011
```

گیت‌وی به broker وصل می‌شود، بافر پایدار SQLite خود را می‌سازد (`data/edge.db`) و اگر رکوردی از اجرای قبلی باقی مانده باشد، هنگام boot آن‌ها را drain می‌کند.

## گام ۵ — سرویس realtime

```bash
cd mini-services/realtime
bun install
bun run dev              # socket.io روی پورت 3013
```

## گام ۶ — سرویس تحلیل (Python)

```bash
cd mini-services/analytics
python3 -m pip install -r requirements.txt
bun run dev              # uvicorn روی پورت 3014
```

(اسکریپت `dev` در عمل `python3 -m uvicorn app.main:app --host 0.0.0.0 --port 3014 --reload` را اجرا می‌کند.)

## گام ۷ (اختیاری) — کتابخانه پروتکل C

```bash
cd protocol-c
make test               # ۲۶ تست / ۵۱۹ assertion
make test-asan          # بیلد با ASan+UBSan
```

---

## ترتیب اجرای سرویس‌ها

ترتیب درست:

```
broker (1883) → simulator (3012) → gateway (3011) → web (3000) → realtime (3013) → analytics (3014)
```

گیت‌وی به broker به‌صورت خودکار وصل مجدد می‌شود، پس ترتیب متفاوت هم بالاخره همگرا می‌شود؛ اما broker-first از نویز اولیه reconnect جلوگیری می‌کند.

بررسی سلامت (بعد از بالا آمدن همه):

```bash
curl http://localhost:3011/health   # {"status":"ok",...}
curl http://localhost:3012/health
curl http://localhost:3013/health
curl http://localhost:3014/health   # {"status":"ok","model":"isolation_forest",...}
curl http://localhost:3000/api/system/status   # با کوکی نشست (نیاز به login)
```

---

## حساب‌های نمایشی

| نام کاربری | رمز عبور | نقش |
|---|---|---|
| `admin` | `admin123` | ADMIN |
| `operator` | `operator123` | OPERATOR |
| `viewer` | `viewer123` | VIEWER |

این حساب‌ها فقط برای توسعه هستند؛ قبل از هر استقرار در دسترس، حتماً تغییرشان دهید.

---

## جدول پورت‌ها

| پورت | سرویس | توضیح |
|---|---|---|
| 3000 | وب + REST API | کلاینت تک‌صفحه‌ای در `/` + APIهای Next.js |
| 1883 | MQTT broker | aedes، TCP، بدون TLS در حالت توسعه |
| 3011 | گیت‌وی لبه | API مدیریتی: health/status/buffer/simulate-offline/dispatch |
| 3012 | شبیه‌ساز | API کنترل: pause/resume/duplicate/delayed/replay-late-batch |
| 3013 | realtime | socket.io برای رخدادهای زنده |
| 3014 | تحلیل | FastAPI: aggregate/detect/evaluate/model-info |

---

## متغیرهای محیطی

| متغیر | مقدار پیش‌فرض | استفاده |
|---|---|---|
| `DATABASE_URL` | — (الزامی) | Backend / Prisma |
| `DH_MQTT_URL` | `mqtt://localhost:1883` | گیت‌وی، شبیه‌ساز |
| `DH_BACKEND_URL` | `http://localhost:3000` | گیت‌وی، شبیه‌ساز، تحلیل |
| `DH_REALTIME_URL` | `http://localhost:3013` | گیت‌وی |
| `DH_INTERNAL_TOKEN` | `dev-internal-token` | همه فراخوان‌های API داخلی |

توکن داخلی فقط برای توسعه است؛ در استقرار واقعی باید به‌ازای هر سرویس یک credential یکتا و چرخشی قرار دهید (جزئیات در [SECURITY_FA.md](SECURITY_FA.md)).

---

## اجرای تست‌ها

سه مجموعه تست shell به **پلتفرم در حال اجرا** نیاز دارند:

```bash
bash tests/api.test.sh        # کارکردی — ۴۵/۴۵
bash tests/security.test.sh   # امنیت و ایمنی AI — ۳۷/۳۷
bash tests/failure.test.sh    # قابلیت اطمینان — حدود ۳ دقیقه
```

تست‌های واحد:

```bash
cd protocol-c && make test                    # 26 tests / 519 assertions
cd mini-services/analytics && python3 -m pytest tests/ -v   # 22/22
```

CI فقط مواردی را اجرا می‌کند که به پلتفرم زنده نیاز ندارند (کتابخانه C، pytest تحلیل، lint وب و بررسی نگارشی اسکریپت‌های shell) — این محدودیت صادقانه در خود فایل workflow مستند شده است.
