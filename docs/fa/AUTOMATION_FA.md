# اتوماسیون — DeviceHub

حق نشر © ۲۰۲۶ پارسا فتحی — Apache-2.0.

موتور اتوماسیون **در گیت‌وی لبه و به‌صورت قطعی** اجرا می‌شود: با ورودی یکسان همیشه خروجی یکسان. کد: بخش «Automation engine» در `mini-services/gateway/index.ts`؛ مدل داده: `AutomationRule` و `RuleExecution` در `prisma/schema.prisma`.

---

## ۱. مدل قاعده

| فیلد | توضیح |
|---|---|
| `ruleId` | شناسه یکتا (مثل `rule-temp-high`) |
| `name` | نام نمایشی |
| `enabled` | فعال/غیرفعال |
| `deviceSelector` | JSON: `{deviceId}` یا `{type}` — قاعده به یک دستگاه یا یک نوع دستگاه می‌خورد |
| `metric` | متریک مورد نظر |
| `condition` | `ABOVE` یا `BELOW` |
| `threshold` | مقدار آستانه |
| `durationSec` | شرط باید این‌قدر **پیوسته برقرار بماند** تا FIRE شود |
| `severity` | CRITICAL / WARNING / INFO |
| `cooldownSec` | بعد از هر FIRE، این‌قدر ثانیه تریگر بعدی سرکوب می‌شود |
| `priority` | اولویت |
| `version` | **نسخه قاعده** — هر به‌روزرسانی نسخه را افزایش می‌دهد |
| `lastTriggeredAt` | زمان آخرین FIRE (برای cooldown) |

اکشن فعلی: `CREATE_ALERT` (ساخت هشدار با evidence).

## ۲. معناشناسی ارزیابی

روی هر batch تله‌متری معتبر، برای هر جفت (قاعده فعال، دستگاه منطبق):

```
شرط برقرار نیست (مقدار سمت امن آستانه)
    → گذار به NOT_MET (فقط هنگام تغییر از وضعیت دیگر ثبت می‌شود)
    → ریست تایمر برقراری (heldSince)

شرط برای بار اول برقرار شد
    → CONDITION_MET_WAITING (ثبت با مقدار مشاهده‌شده و durationSec لازم)

شرط برقرار مانده و heldSec ≥ durationSec
    → اگر داخل پنجره cooldown آخرین تریگر: SUPPRESSED_COOLDOWN (ثبت یک‌بار در هر گذار)
    → در غیر این صورت: FIRE
```

نکات معنایی مهم:

- **آستانه + مدت:** یک spike گذرا (کوتاه‌تر از `durationSec`) هشدار نمی‌سازد؛ فقط `CONDITION_MET_WAITING` ثبت می‌شود. این عمدی است تا نویز سنسور هشدار کاذب نسازد.
- **cooldown بعد از FIRE:** اگر شرط همچنان برقرار بماند، تریگر بعدی فقط بعد از `cooldownSec` مجاز است — در فاصله آن، `SUPPRESSED_COOLDOWN` ثبت می‌شود (قابل مشاهده در تاریخچه اجرا).
- **بعد از FIRE تایمر ریست می‌شود**، یعنی برای هشدار بعدی، دوباره `durationSec` برقراری لازم است.
- **هر خروجی ثبت می‌شود** (`RuleExecution`): `FIRED | SUPPRESSED_COOLDOWN | CONDITION_MET_WAITING | NOT_MET | ERROR` — تاریخچه کامل تصمیم‌های موتور قابل ممزی است.

## ۳. هشدار حاصل از FIRE

```
title:   «{نام قاعده}: {metric} above/below {threshold}{unit}»
message: «{metric} held {condition} {threshold}{unit} برای {heldSec} ثانیه
          (مشاهده‌شده {value}{unit}). قاعده v{version}، اولویت {priority}.»
evidence: {
  observed: مقدار مشاهده‌شده,
  threshold: آستانه,
  heldSec: مدت برقراری (ثانیه، گردشده),
  ruleVersion: نسخه قاعده,
  sampleTs: زمان نمونه,
  quality: کیفیت نمونه
}
severity: از تعریف قاعده
state:    ACTIVE (چرخه حیات: ACTIVE → ACKNOWLEDGED → RESOLVED)
```

## ۴. نسخه‌بندی و تازگی

- قواعد از `GET /api/internal/rules` هر **۱۵ ثانیه** در گیت‌وی تازه می‌شوند؛ تغییر قاعده حداکثر با همین تأخیر در لبه اعمال می‌شود.
- هر به‌روزرسانی (از API عمومی، با نقش مناسب) نسخه قاعده را افزایش می‌دهد؛ هشدارها و اجراها نسخه‌ای را که با آن ساخته شده‌اند در evidence/detail ثبت می‌کنند — یعنی می‌دانید هر هشدار با کدام نسخه قاعده تولید شده است.

## ۵. قواعد پیش‌فرض seed

| قاعده | انتخابگر | متریک | شرط | مدت | شدت | cooldown |
|---|---|---|---|---|---|---|
| High Temperature Alert | type=ENV_SENSOR | temperature | > 85°C | 120s | CRITICAL | 300s |
| High Temperature (Temp/Humidity) | type=TEMP_HUM | temperature | > 80°C | 120s | CRITICAL | 300s |
| High Vibration Alert | type=VIBRATION | vibration | > 8 mm/s | 60s | CRITICAL | 240s |
| Power Overload Alert | type=POWER_METER | power | > 15kW | 180s | WARNING | 600s |
| Low Humidity Alert | type=TEMP_HUM | humidity | < 25% | 300s | INFO | 900s |
| Voltage Sag Alert | type=VOLTAGE | voltage | < 207V | 120s | WARNING | 600s |

دستگاه `DH-ENV-003` با پروفایل `THRESHOLD_VIOLATION` به‌طور قطعی دما را بالا می‌برد تا قواعد دما واقعاً FIRE شوند — در دموی زنده قابل مشاهده است.

## ۶. چرا در لبه؟

- حتی وقتی Backend قطع است، ارزیابی ادامه دارد و هشدارها بعد از بازیابی (از مسیر forwarding) ایجاد می‌شوند.
- تصمیم‌گیری نزدیک منبع داده انجام می‌شود؛ هیچ وابستگی مداومی به دسترس‌پذیری مرکز ندارد.
- قطعیت: برای ممزی و بازپخش، رفتار موتور قابل بازتولید است.

محدودیت صادقانه: این موتور الگوی فعلی (آستانه + مدت + cooldown) را پوشش می‌دهد؛ الگوهای پیچیده‌تر (روند، ترکیب چند متریک) به مدل‌های ML سپرده می‌شود که خودشان محدودیت‌های مستندشده دارند ([MACHINE_LEARNING_FA.md](MACHINE_LEARNING_FA.md)).
