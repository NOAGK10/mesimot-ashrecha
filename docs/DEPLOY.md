# העלאת האתר לאוויר — בחינם

| חלק | שירות | עלות | מגבלה שכדאי לדעת |
|---|---|---|---|
| האתר | Render (Free) | ₪0 | נרדם אחרי 15 דקות בלי כניסות; הכניסה הראשונה אחרי שינה לוקחת כדקה |
| מסד הנתונים | Neon (Free) | ₪0 | ‎0.5GB — מספיק לשנים של משימות |
| תזכורות ומשימות חוזרות | GitHub Actions | ₪0 | רץ כל 30 דקות, כך שתזכורת של 09:00 יוצאת עד 09:30 |
| גיבוי יומי | GitHub Actions | ₪0 | נשמר 30 יום |
| מיילים | Gmail | ₪0 | עד 500 מיילים ביום |
| כניסה עם Google | Google Cloud | ₪0 | — |

> את החשבונות והסיסמאות צריך ליצור ולהדביק בעצמכם. הקוד כבר מוכן לכל השאר.

---

## שלב 1 — מסד נתונים ב-Neon

1. נכנסים ל-https://neon.tech ונרשמים עם חשבון GitHub או Google.
2. **Create project** → שם: `ashrecha` → Region: **Europe (Frankfurt)** → Postgres 17.
3. בחלון **Connect**: מכבים את **Connection pooling**, ומעתיקים את מחרוזת החיבור (מתחילה ב-`postgresql://`). שומרים אותה בצד — זה `DATABASE_URL`.

## שלב 2 — כניסה עם Google (Google Cloud)

1. https://console.cloud.google.com → פרויקט חדש בשם `ashrecha`.
2. **APIs & Services → OAuth consent screen**: סוג **External**, שם האפליקציה "אשריך", מייל תמיכה = המייל שלכם. בסוף לוחצים **Publish app** (בלי זה רק "משתמשי בדיקה" יוכלו להיכנס).
3. **Credentials → Create credentials → OAuth client ID** → סוג **Web application**:
   - **Authorized JavaScript origins**: את כתובת האתר מ-Render (שלב 4), למשל `https://ashrecha.onrender.com`. אפשר להשלים אחרי שלב 4.
   - שומרים את **Client ID** ואת **Client secret**.
4. *(לא חובה — רק לבחירת קבצים מתוך Drive)*: מפעילים את **Google Drive API**, **Google Sheets API**, **Google Picker API**; יוצרים **API key** מוגבל ל-Picker API ולכתובת האתר; ואת **Project number** (בדף הבית של הפרויקט) שומרים — זה `GOOGLE_APP_ID`.

## שלב 3 — שליחת מיילים מ-Gmail

1. https://myaccount.google.com → **Security** → מפעילים **2-Step Verification** (אם עוד לא פעיל).
2. https://myaccount.google.com/apppasswords → יוצרים סיסמת אפליקציה בשם "אשריך" → מקבלים 16 אותיות. מורידים את הרווחים.
3. מרכיבים (מחליפים את החלקים באנגלית):
   - `SMTP_URL` = `smtps://YOUR_ADDRESS%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`
     (ה-`@` שבכתובת המייל נכתב `%40`)
   - `MAIL_FROM` = `אשריך <YOUR_ADDRESS@gmail.com>`

## שלב 4 — האתר ב-Render

1. https://render.com → נרשמים עם **GitHub** ומאשרים גישה למאגר `mesimot-ashrecha`.
2. **New → Blueprint** → בוחרים את המאגר. Render קורא את הקובץ `render.yaml` ומבקש למלא:

| משתנה | מה לשים |
|---|---|
| `DATABASE_URL` | מחרוזת החיבור משלב 1 |
| `APP_URL` | כתובת האתר, למשל `https://ashrecha.onrender.com` (אם השם תפוס, Render ייתן שם אחר — משתמשים בו) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | משלב 2 |
| `SMTP_URL`, `MAIL_FROM` | משלב 3 |
| `BOOTSTRAP_MANAGER_EMAILS` | כתובות ה-Gmail של המנהלים, מופרדות בפסיק |
| `GOOGLE_API_KEY`, `GOOGLE_APP_ID` | רק אם עשיתם את שלב 2.4; אחרת משאירים ריק |

3. **Apply**. הבנייה הראשונה לוקחת כמה דקות.
4. חוזרים ל-Google Cloud (שלב 2.3) ומוסיפים את כתובת האתר ל-**Authorized JavaScript origins**.

## שלב 5 — תזכורות וגיבוי (GitHub)

1. ב-Render: השירות → **Environment** → מעתיקים את הערך של `CRON_SECRET` (Render יצר אותו).
2. ב-GitHub: המאגר → **Settings → Secrets and variables → Actions**:
   - לשונית **Variables** → `APP_URL` = כתובת האתר.
   - לשונית **Secrets** → `CRON_SECRET` = הערך מ-Render; `DATABASE_URL` = מחרוזת החיבור משלב 1.
3. **Actions → Background tick → Run workflow**. אם הוא ירוק — התזכורות עובדות.
4. **Actions → Database backup → Run workflow** — בודק שהגיבוי עובד.

## שלב 6 — כניסה ראשונה

נכנסים לכתובת האתר ← "כניסה עם Google" עם אחד המיילים מ-`BOOTSTRAP_MANAGER_EMAILS`. משם: **אנשים** להוספת אנשים ותפקידים, **הגדרות** לשם הארגון ולזמני התזכורות.

---

## כדאי לדעת

- **שינה:** אחרי 15 דקות בלי כניסות האתר נרדם. הכניסה הבאה לוקחת כדקה — זה נורמלי.
- **GitHub משבית תזמונים** במאגר שלא היה בו שום שינוי 60 יום, ושולח על זה מייל. מפעילים מחדש בלחיצה (Actions → הפעולה → Enable).
- **עדכונים:** כל `git push` ל-`main` מעלה גרסה חדשה אוטומטית.
- **פרטיות:** הגיבויים (שמות, מיילים ומשימות) נשמרים במאגר ה-GitHub הפרטי, ורק מי שיש לו גישה למאגר יכול להוריד אותם.

## שחזור מגיבוי

1. GitHub → Actions → Database backup → הריצה הרצויה → מורידים את `backup-YYYY-MM-DD`.
2. יוצרים ב-Neon מסד נתונים ריק (branch חדש), ומריצים:
   ```bash
   docker run --rm -v "$PWD:/b" postgres:17 pg_restore --no-owner --clean --if-exists -d "NEW_DATABASE_URL" /b/backup.dump
   ```
3. מעדכנים את `DATABASE_URL` ב-Render לכתובת החדשה.
