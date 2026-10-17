# راهنمای توسعه‌دهندگان — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

نسخه انگلیسی: [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## ۱. محیط توسعه

| ابزار | برای |
|---|---|
| Bun | وب (`/home/z/my-project`) و mini-serviceهای TypeScript |
| Python 3.12 (+ venv) | سرویس تحلیل (`mini-services/analytics`) |
| gcc (C11) | کتابخانه پروتکل (`protocol-c/`) |
| make | ساخت و تست `protocol-c/` |

راه‌اندازی اولیه:

```bash
bun install
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env
bunx prisma db push
bun prisma/seed.ts
```

ترتیب اجرای سرویس‌ها: broker → شبیه‌ساز → گیت‌وی → وب (پورت ۳۰۰۰) → realtime → تحلیل. جزئیات کامل: [INSTALLATION_FA.md](INSTALLATION_FA.md).

حساب‌های توسعه: `admin/admin123`، `operator/operator123`، `viewer/viewer123`.

## ۲. سبک کد

- **TypeScript (وب و سرویس‌ها):** TS سخت‌گیر؛ برای UI کامپوننت‌های تابعی با hookها؛ `any` ضمنی تا جایی که می‌شود ممنوع. `bun run lint` باید پاک باشد.
- **Python (تحلیل):** type hint روی توابع عمومی؛ در تست‌های واحد هیچ شبکه‌ای واقعی نباید در کار باشد (تعاملات Backend با httpx `MockTransport` ماک می‌شوند).
- **C (`protocol-c/`):** بیلد باید با `-std=c11 -Wall -Wextra -Werror -O2` پاک باشد. بدون وابستگی خارجی، بدون فرض endianness/alignment/aliasing. هر مسیر جدید حداقل یک تست موفق و در صورت امکان یک تست شکست‌خورده می‌گیرد.
- **عمومی:** سرصفحه فایل‌ها خط کوتاه حق نشر را نگه می‌دارند. credential و خروجی build (`build/`، `build-asan/`، `.next/`، `data/*.db`) هرگز commit نمی‌شوند.

## ۳. سیاست «تست قبل از merge»

یک pull request تا زمانی که این‌ها سبز نباشند قابل merge نیست:

1. `bun run lint` (وب).
2. `cd protocol-c && make test` — و برای تغییر پروتکل، `make test-asan` (باید بدون خطای sanitizer باشد).
3. `cd mini-services/analytics && python3 -m pytest tests/ -v` — خط پایه ۲۲/۲۲.
4. اگر مسیر داده، API، auth یا گیت‌وی را تغییر داده‌اید، سه مجموعه زنده را روی پلتفرم در حال اجرا اجرا کنید و خط نتیجه را در PR بچسبانید:
   - `bash tests/api.test.sh` (خط پایه ۴۵/۴۵)
   - `bash tests/security.test.sh` (خط پایه ۳۷/۳۷)
   - `bash tests/failure.test.sh` (حدود ۳ دقیقه؛ همه گروه‌ها سبز)
5. قابلیت‌هایی که رفتار مستندشده را تغییر می‌دهند باید مستندات مربوطه را به‌روز کنند (README / ARCHITECTURE / SECURITY / `docs/fa/`) — با اعداد واقعی. اگر مدل‌ای ارزیابی می‌کنید، precision/recall/F1 را از یک اجرای واقعی گزارش کنید؛ عددی از خود درنیاورید.

CI (`.github/workflows/ci.yml`) موارد ۱ تا ۳ به‌علاوه بررسی نگارشی shell را اجرا می‌کند. مجموعه‌های زنده در CI اجرا نمی‌شوند (نیازمند کل پلتفرم بالاست) — این محدودیت در خود workflow مستند شده و اجرای محلی با مسئولیت نویسنده PR است.

## ۴. قواعد commit

- وجه امری، موضوع ≤ ۷۲ نویسه، body برای موارد نامشهود: `fix(gateway): preserve source ts during spool drain`.
- scopeهای متداول: `web`، `api`، `gateway`، `simulator`، `broker`، `realtime`، `analytics`، `protocol-c`، `docs`، `tests`، `ci`.
- یک تغییر منطقی در هر commit؛ تست و کدِ زیر پوششش در همان commit.
- بدون `--no-verify` و بدون force-push روی شاخه‌های مشترک.

## ۵. حوزه‌های مشارکت

- **`protocol-c/`** — کتابخانه پروتکل C11 با محدودیت‌های سازگاری بایتی و تست فریم طلایی؛ بررسی‌های متقابل بین پیاده‌سازی‌ها (Python/TS) ارزشمند است.
- **`mini-services/gateway/`** — مسیر داده لبه. تغییرها باید مجموعه failure را دوباره اجرا کنند؛ معناشناسی قابلیت اطمینان (حفظ timestamp مبدأ، دور نریختن داده delayed، drain-on-boot) قراردادی و نقض‌ناپذیر است.
- **تحلیل** — ویژگی‌ها، کار روی کالیبراسیون، دیتاست‌های ارزیابی. هر ادعای مدل، یک اجرای ارزیابی با اعداد واقعی می‌خواهد.
- **وب/API (`src/`)** — نماها و routeها. اعمال نقش سمت سرور می‌ماند؛ مرز evidence مسیر AI ضعیف‌تر نمی‌شود.
- **مستندات** — به‌ویژه مجموعه فارسی `docs/fa/`؛ زبان طبیعی، اعداد واقعی.
- **تست‌ها** — سناریوهای جدید خطا برای مجموعه‌های زنده از ارزشمندترین مشارکت‌هاست.

## ۶. گزارش اشکال

از قالب‌های issue استفاده کنید (`.github/ISSUE_TEMPLATE/`). برای موارد امنیتی ترجیحاً گزارش خصوصی به نگهدارنده؛ مراحل بازتولید روی نمونه محلی را بنویسید. حساب‌های دمو و توکن توسعه به‌طرز طراحی عمومی هستند — فرض کردن آن‌ها در گزارش اشکال مشکلی ندارد.

## ۷. نکات محیطی این سندباکس (برای توسعه در همین محیط)

- پورت ۳۰۱۴ سرویس تحلیل fixed است (قرارداد پلتفرم) و قابل تغییر نیست.
- برای دسترسی مرورگر به سرویس‌های mini، از پارامتر `XTransformPort` (روتینگ Caddy) استفاده می‌شود — مثلاً اتصال socket.io با `io("/?XTransformPort=3013")`.
- اگر سرویسی را با `nohup … &` اجرا می‌کنید و بین فراخوانی‌ها reaped می‌شود، با setsid orphan اجرایش کنید (PPID=1) تا زنده بماند.
