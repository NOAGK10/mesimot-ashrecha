import { Link } from 'react-router';
import { useAuthConfig } from '../api';

/**
 * Public privacy policy and terms of use. Google requires both links to publish the sign-in app,
 * so these pages are reachable without signing in. They describe what this system actually does.
 */
function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  const config = useAuthConfig();
  const org = config.data?.orgName ?? 'הארגון';
  return (
    <main className="content legal">
      <p className="muted small">
        <Link to="/">← {org}</Link>
      </p>
      <h1>{title}</h1>
      {children}
      <p className="muted small">עודכן: אוקטובר 2026</p>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="מדיניות פרטיות">
      <p>
        האתר הוא מערכת פנימית לניהול משימות של הארגון. הגישה אליו מוגבלת לאנשים שמנהלי הארגון הוסיפו. מדיניות זו מסבירה איזה מידע נשמר ולמה.
      </p>
      <h2>איזה מידע נשמר</h2>
      <ul>
        <li>
          <strong>פרטי זיהוי:</strong> שם, כתובת מייל, ובכניסה עם Google גם מזהה החשבון של Google. לא נשמרת סיסמה.
        </li>
        <li>
          <strong>תוכן העבודה:</strong> משימות, סטטוסים והערות, הודעות צ'אט, פידבקים, תמונת פרופיל ותחומי אחריות שהמשתמשים מזינים.
        </li>
        <li>
          <strong>היסטוריה:</strong> מי שינה מה ומתי במשימות, לצורך מעקב ובקרה.
        </li>
        <li>
          <strong>קבצי Google:</strong> רק אם משתמש בוחר במפורש קובץ מ-Google Drive. המערכת מקבלת גישה לקבצים שנבחרו בלבד, שומרת את שמם והקישור אליהם, וקוראת את תוכנם רק לצורך ייבוא משימות שהמשתמש מאשר.
        </li>
      </ul>
      <h2>למה המידע משמש</h2>
      <p>
        אך ורק לתפעול המערכת: הצגת משימות, שליחת תזכורות והתראות במייל ובאתר, וחישוב ציון הביצוע שמוצג בפרופיל. המידע לא נמכר, לא משמש לפרסום ולא מועבר לגורמים אחרים, למעט ספקי
        התשתית שמפעילים את האתר.
      </p>
      <h2>איפה המידע נשמר</h2>
      <p>
        האתר מתארח ב-Vercel ומסד הנתונים ב-Neon, בשרתים באירופה (פרנקפורט). מיילים נשלחים דרך Gmail. הגיבויים נשמרים במאגר קוד פרטי של הארגון.
      </p>
      <h2>מי רואה מה</h2>
      <p>
        מנהלים ומשתמשים קבועים רואים את כל משימות הארגון. אורחים רואים רק משימות שהם מעורבים בהן. פרופילים, ציוני ביצוע ופידבקים גלויים לכל מי שנכנס לאתר.
      </p>
      <h2>מחיקה ותיקון</h2>
      <p>
        אפשר לבקש ממנהלי הארגון לתקן פרטים או להשבית חשבון. משתמשים יכולים בעצמם לערוך את הפרופיל שלהם, למחוק תמונה ולמחוק הודעות ופידבקים שכתבו. אפשר גם לבטל בכל עת את
        הגישה של האתר לחשבון Google בהגדרות החשבון (myaccount.google.com/permissions).
      </p>
      <h2>Summary (English)</h2>
      <p dir="ltr">
        This is an internal task-management system for the organisation, available only to people the organisation adds. We store names, e-mail addresses and the Google
        account ID used for sign-in, plus the tasks, comments, chat messages, feedback and profile pictures users enter. Google Drive files are accessed only when a user
        explicitly picks them. Data is used only to run the system, is not sold or shared except with the hosting providers (Vercel, Neon, Gmail), and is stored in the EU.
        Contact the organisation's managers to correct or remove data.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="תנאי שימוש">
      <ul>
        <li>האתר מיועד לשימוש פנימי של הארגון בלבד, על ידי אנשים שמנהלי הארגון הוסיפו.</li>
        <li>כל משתמש אחראי לתוכן שהוא כותב: משימות, הודעות ופידבקים. יש לכתוב בכבוד ובענייניות.</li>
        <li>מנהלי הארגון רשאים לערוך ולמחוק תוכן, ולהשבית גישה של משתמשים.</li>
        <li>אין להעלות לאתר מידע רגיש שאינו נחוץ לעבודה.</li>
        <li>האתר ניתן כפי שהוא. הארגון עושה מאמץ לשמור על זמינות וגיבויים, אך אינו מתחייב לזמינות רציפה.</li>
      </ul>
      <p>
        המידע נשמר ומשמש כמתואר ב<Link to="/privacy">מדיניות הפרטיות</Link>.
      </p>
      <p dir="ltr" className="muted small">
        Internal use only, by people the organisation adds. Users are responsible for what they post; managers may edit or remove content and accounts. Provided as is.
      </p>
    </LegalShell>
  );
}
