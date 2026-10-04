import { ChatPanel } from '../components/ChatPanel';

export function ChatPage() {
  return (
    <section>
      <h1>צ'אט כללי</h1>
      <p className="muted small">שיחה של כל הארגון. כדי לתייג מישהו כותבים @ ובוחרים שם; הוא יקבל התראה בעמוד הבית שלו.</p>
      <ChatPanel />
    </section>
  );
}
