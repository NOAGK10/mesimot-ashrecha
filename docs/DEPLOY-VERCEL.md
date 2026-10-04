# העלאה לאוויר ב-Vercel — בחינם

| חלק | שירות | הערות |
|---|---|---|
| האתר | Vercel (Hobby, חינם) | השרת רץ כ"פונקציה" שמתעוררת בכל בקשה |
| מסד נתונים | Neon דרך Vercel (חינם) | נוצר מתוך Vercel ומתחבר לבד |
| תזכורות ומשימות חוזרות | GitHub Actions | כל 30 דקות (ב-Vercel החינמי אפשר רק פעם ביום) |
| גיבוי יומי | GitHub Actions | נשמר 30 יום |
| מיילים | Gmail | עד 500 ביום |
| כניסה | Google | |

> את ההרשמות והסיסמאות עושים בעצמכם. לא להדביק סיסמאות בצ'אט.

---

## שלב 1 — חיבור הפרויקט ל-Vercel

1. https://vercel.com/signup → **Continue with GitHub** (תוכנית **Hobby**).
2. **Add New… → Project** → ליד `mesimot-ashrecha` לוחצים **Import**. אם המאגר לא מופיע: **Adjust GitHub App Permissions** ומאשרים גישה אליו.
3. במסך ההגדרות: **Framework Preset: Other**. לא לשנות את Build/Install — הם מגיעים מהקובץ `vercel.json`.
4. **Deploy**. הבנייה תצליח, אבל האתר עוד לא יעבוד — חסרים מסד נתונים והגדרות. זה צפוי.
5. רושמים את כתובת האתר שמופיעה (למשל `https://mesimot-ashrecha.vercel.app`). זו **כתובת האתר**.

## שלב 2 — מסד נתונים

1. בפרויקט ב-Vercel: לשונית **Storage** → **Create Database** → **Neon** → **Continue**.
2. אזור: **Frankfurt (eu-central-1)** → תוכנית **Free** → **Create**.
3. **Connect Project** → בוחרים את הפרויקט → מסמנים **Production** ו-**Preview** → **Connect**.
   Vercel מוסיף לבד את `DATABASE_URL` ו-`DATABASE_URL_UNPOOLED`.

## שלב 3 — כניסה עם Google

1. https://console.cloud.google.com → פרויקט חדש `ashrecha`.
2. **APIs & Services → OAuth consent screen**: External, שם "אשריך", מייל תמיכה. בסוף **Publish app**.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   **Authorized JavaScript origins** = כתובת האתר משלב 1.
4. שומרים **Client ID** ו-**Client secret**.

## שלב 4 — מיילים מ-Gmail

1. https://myaccount.google.com → Security → להפעיל **2-Step Verification**.
2. https://myaccount.google.com/apppasswords → סיסמת אפליקציה בשם "אשריך" → 16 אותיות בלי רווחים.

## שלב 5 — משתני סביבה ב-Vercel

בפרויקט: **Settings → Environment Variables** (סביבה: Production). מוסיפים:

| שם | ערך |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | כתובת האתר משלב 1 (בלי `/` בסוף) |
| `GOOGLE_CLIENT_ID` | משלב 3 |
| `GOOGLE_CLIENT_SECRET` | משלב 3 |
| `MAIL_TRANSPORT` | `smtp` |
| `SMTP_URL` | `smtps://YOUR_ADDRESS%40gmail.com:APP_PASSWORD@smtp.gmail.com:465` |
| `MAIL_FROM` | `אשריך <YOUR_ADDRESS@gmail.com>` |
| `BOOTSTRAP_MANAGER_EMAILS` | מיילי ה-Gmail של המנהלים, מופרדים בפסיק |
| `CRON_SECRET` | מחרוזת אקראית של 32 תווים לפחות (למשל ממחולל סיסמאות). שומרים אותה גם לשלב 6 |
| `WORKER_MODE` | `separate` |
| `CRON_INTERVAL_MINUTES` | `30` |
| `PG_POOL_MAX` | `3` |
| `MAX_UPLOAD_MB` | `4` (מגבלה של Vercel) |

אחרי ההוספה: **Deployments** → על הפריסה האחרונה **⋯ → Redeploy**.
בפריסה הזו גם נבנות הטבלאות במסד הנתונים.

## שלב 6 — תזכורות וגיבוי (GitHub)

במאגר ב-GitHub: **Settings → Secrets and variables → Actions**:
- **Variables** → `APP_URL` = כתובת האתר.
- **Secrets** → `CRON_SECRET` = אותו ערך כמו ב-Vercel.
- **Secrets** → `DATABASE_URL` = הערך של `DATABASE_URL_UNPOOLED` מ-Vercel (Settings → Environment Variables → עין לצפייה).

**Actions → Background tick → Run workflow** — אם ירוק, התזכורות עובדות.

## שלב 7 — כניסה ופרסום

1. נכנסים לכתובת האתר עם Google, עם אחד ממיילי המנהלים.
2. **צוות → ניהול אנשים**: מוסיפים כל אדם עם המייל שלו וסוג הגישה. **רק מי שנוסף יוכל להיכנס.**
3. שולחים לאנשים את הקישור.

---

## כדאי לדעת

- כל `git push` ל-`main` מעלה גרסה חדשה לבד, כולל עדכון מבנה מסד הנתונים.
- הבקשה הראשונה אחרי זמן שקט לוקחת כשנייה-שתיים יותר.
- העלאת קבצים לייבוא מוגבלת ל-4MB (מגבלה של Vercel).
- בחירת קבצים מ-Google Drive (לא חובה): ראו את שלב 2.4 ב-[DEPLOY.md](DEPLOY.md) ומוסיפים גם `GOOGLE_API_KEY`, `GOOGLE_APP_ID`, `TOKEN_ENCRYPTION_KEY`.
