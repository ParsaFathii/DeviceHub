# انتشار — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

نسخه انگلیسی: [CHANGELOG.md](../../CHANGELOG.md).

---

## v1.0.0 — ۲۰۲۶-۱۰-۱۷

اولین انتشار یکپارچه پلتفرم. همه اجزای زیر با هم و در همین محیط ساخته و آزمایش شده‌اند؛ تاریخچه نسخه قبلی‌ای برای گزارش وجود ندارد.

### پلتفرم
- وب: Next.js 16 + TypeScript + Tailwind + shadcn/ui + recharts؛ کلاینت تک‌صفحه‌ای در `/` با ۱۱ نما و تم تیره صنعتی؛ به‌روزرسانی realtime با socket.io.
- احراز هویت: کوکی نشست + اعمال نقش سمت سرور (ADMIN / OPERATOR / VIEWER)؛ هش PBKDF2-SHA256؛ ابطال با logout.
- داده: Prisma + SQLite (انطباق مستندشده از PostgreSQL برای همین محیط ساخت) با ۱۵ مدل.

### مسیر داده لبه
- شبیه‌ساز: ۱۶ دستگاه قطعی seed-شده در ۶ پروفایل + API کنترل برای تزریق خطا.
- MQTT: broker واقعی (aedes، ۱۸۸۳) با سلسله‌تاپیک `device/{id}/telemetry|status|command|ack` و `gateway/{id}/status`، QoS 1، retained برای statusها، نشست پایدار گیت‌وی.
- گیت‌وی لبه (TypeScript، ۳۰۱۱): اعتبارسنجی پروتکل v1، dedup با msgId، بافر پایدار SQLite (سقف ۵۰۰۰، WAL، مقاوم به `kill -9`)، drain خودکار با حفظ timestamp مبدأ، مانیتور تایم‌اوت ۴۵ ثانیه‌ای OFFLINE، موتور اتوماسیون قطعی (آستانه + مدت + cooldown) در لبه، مسیریابی فرمان با ack دستگاه.
- قابلیت اطمینان زیر تزریق خطا: dedup تحویل تکراری؛ حفظ و پرچم‌گذاری تله‌متری تأخیری؛ قطعی ۳۰ ثانیه‌ای Backend → ۸۹ رکورد spool → drain خودکار → رخداد DRAINED؛ `kill -9` گیت‌وی با ۵۷ رکورد → ری‌استارت → drain در boot؛ رد ورودی خراب؛ batch بزرگ → 413؛ سکوت دستگاه → OFFLINE → ادامه → ONLINE؛ ری‌استارت broker → وصل مجدد.

### پروتکل
- envelope پروتکل v1 (JSON) روی مسیر زنده: `{v, deviceId, msgId, seq, ts, metrics[…], sim}`.
- codec فریم باینری C11 در `protocol-c/` (سرصفحه ۲۲ بایتی little-endian، CRC-32، payloadهای typed) — ۲۶ تست / ۵۱۹ assertion قبول روی gcc 14.2، پاک با ASan+UBSan.

### تحلیل / ML
- سرویس FastAPI (۳۰۱۴): aggregation زمان‌بکتی با تشخیص gap، تشخیص ناهنجاری با IsolationForest (`if-v1.0`؛ ویژگی‌های `[value, |Δ|, rolling-mean₅]`؛ حداقل ۴۰ نمونه در هر سری) و baseline قطعی z-score (|z|>3).
- ارزیابی روی دیتاست سنتتیک برچسب‌دار (۱۱۷۹ نمونه، ۱۴۶ ناهنجاری، ۸ الگو) — اعداد واقعی: IsolationForest با precision 0.365 / recall 0.158 / F1 0.220 (spike با recall کامل، تأخیر ≈ ۱.۲ نمونه)؛ z-score با precision 0.909 / recall 0.069 / F1 0.127 (کامل روی spike، کور نسبت به drift). pytest: ۲۲/۲۲.

### لایه AI
- `/api/ai/diagnostics` با provider z-ai-chat: evidence-grounded، برچسب‌گذاری خروجی، advisory-only. آزمایش‌شده: امکان اجرای فرمان ندارد (رد می‌کند و تأیید اپراتور را پیشنهاد می‌دهد؛ صفر فرمان AI در audit). پلتفرم بدون AI هم کاملاً کار می‌کند.

### فرمان‌ها
- چرخه حیات REQUESTED → AUTHORIZED → QUEUED → SENT → (ACKNOWLEDGED) → SUCCEEDED / FAILED / EXPIRED با ack واقعی دستگاه روی MQTT، اعتبارسنجی قابلیت و audit روی هر گذار.

### تست
- `tests/api.test.sh` — ۴۵/۴۵.
- `tests/security.test.sh` — ۳۷/۳۷.
- `tests/failure.test.sh` — همه سناریوها سبز.
- workflow CI با تست‌های protocol-c، pytest تحلیل، lint وب و بررسی نگارشی shell (مجموعه‌های زنده به پلتفرم در حال اجرا نیاز دارند — مستندشده).

### محدودیت‌های شناخته‌شده (مستند و عمدی)
- SQLite به‌جای PostgreSQL؛ گیت‌وی لبه TypeScript (نگاشت مؤلفه گیت‌وی C++ سند معماری)؛ بدون کلاینت Flutter/Kotlin؛ بدون Spring Boot؛ بدون Docker؛ بدون آزمایش سخت‌افزار فیزیکی؛ پیکربندی توسعه MQTT بدون TLS. کتابخانه C پروتکل واقعی و تست‌شده است. همه داده ناوگان، داده شبیه‌ساز است.
