import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle, X, Send, Bot, Users, Lock,
  ChevronDown, Loader2, Trash2, Sparkles
} from 'lucide-react';
import api from '../lib/api';

// ─── MARKDOWN-LIKE RENDERER ──────────────────────────────

function ChatMessageContent({ content }) {
  const navigate = useNavigate();
  const target = localStorage.getItem('kp_target') || 'accueil';

  if (!content) return null;

  // Escape HTML, then add safe formatting
  let html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Ticket links /tickets/{id}
  html = html.replace(
    /\/tickets\/(\d+)/g,
    `<a href="/${target}/ticket/$1" class="text-brand-600 underline font-medium hover:text-brand-700" data-ticket-link="$1">Voir ticket #$1</a>`
  );

  // KP-XXXXXX codes
  html = html.replace(
    /(KP-\d{6})/g,
    '<span class="text-brand-600 font-mono font-bold bg-brand-50 px-1 rounded">$1</span>'
  );

  // Line breaks
  html = html.replace(/\n/g, '<br/>');

  const handleClick = (e) => {
    const link = e.target.closest('[data-ticket-link]');
    if (link) {
      e.preventDefault();
      navigate(`/${target}/ticket/${link.dataset.ticketLink}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="prose-sm break-words [&_strong]:font-bold [&_a]:cursor-pointer"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── AI SUGGESTIONS ──────────────────────────────────────

const SUGGESTIONS = [
  { icon: '📊', text: 'Combien de tickets en cours ?' },
  { icon: '🔍', text: 'Quels tickets sont en attente de diagnostic ?' },
  { icon: '🔧', text: 'Comment changer l\'ecran d\'un iPhone 15 ?' },
  { icon: '💰', text: 'Quel est le CA du jour ?' },
  { icon: '📱', text: 'Quels tickets sont assignes a Marina ?' },
];

// ─── CHAT ASSISTANT TAB ──────────────────────────────────

function TabAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [convId, setConvId] = useState(null);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const data = await api.chatAI(msg, currentUser, convId);
      setConvId(data.conversation_id);
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (err) {
      setError(err.message || 'Erreur de connexion');
      setMessages(prev => [...prev, { role: 'assistant', content: `Erreur : ${err.message || 'connexion impossible'}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    if (convId) api.clearAIConversation(convId).catch(() => {});
    setMessages([]);
    setConvId(null);
    setError('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-7 h-7 text-brand-600" />
            </div>
            <h3 className="font-bold text-slate-700 text-sm">Assistant Klikphone</h3>
            <p className="text-xs text-slate-400 mt-1 mb-4">Pose-moi une question technique ou sur la base !</p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s.text)}
                  className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition"
                >
                  {s.icon} {s.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center mr-2 mt-1 shrink-0">
                <Bot className="w-3.5 h-3.5 text-brand-600" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
              msg.role === 'user'
                ? 'bg-brand-600 text-white rounded-br-md'
                : 'bg-slate-100 text-slate-700 rounded-bl-md'
            }`}>
              {msg.role === 'user' ? msg.content : <ChatMessageContent content={msg.content} />}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center mr-2 mt-1 shrink-0">
              <Bot className="w-3.5 h-3.5 text-brand-600" />
            </div>
            <div className="bg-slate-100 rounded-2xl px-4 py-3 rounded-bl-md">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white">
        {messages.length > 0 && (
          <button onClick={clearChat} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 mb-2 transition">
            <Trash2 className="w-3 h-3" /> Nouvelle conversation
          </button>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Pose une question..."
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm
                       focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700
                       disabled:opacity-40 transition shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TEAM CHAT TAB ───────────────────────────────────────

function TabTeam({ onReadMessages }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [recipient, setRecipient] = useState('all');
  const [team, setTeam] = useState([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  // Load team members
  useEffect(() => {
    api.getActiveTeam().then(setTeam).catch(() => {});
  }, []);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await api.chatTeamMessages(currentUser);
      setMessages(msgs);
    } catch { /* silent */ }
  }, [currentUser]);

  // Poll every 5 seconds
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Mark as read when viewing
  useEffect(() => {
    api.chatTeamMarkRead(currentUser).then(() => onReadMessages?.()).catch(() => {});
  }, [messages.length, currentUser, onReadMessages]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.chatTeamSend(msg, currentUser, recipient);
      setInput('');
      fetchMessages();
    } catch { /* silent */ }
    setSending(false);
    inputRef.current?.focus();
  };

  const roleIcon = (name) => {
    const member = team.find(t => t.nom === name);
    if (!member) return '';
    const role = (member.role || '').toLowerCase();
    if (role.includes('manager')) return '👔';
    if (role.includes('accueil')) return '📋';
    return '🔧';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Recipient selector */}
      <div className="border-b border-slate-100 px-3 py-2 bg-slate-50/50">
        <select
          value={recipient}
          onChange={e => setRecipient(e.target.value)}
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:border-brand-400 outline-none"
        >
          <option value="all">📢 Tout le monde</option>
          {team.map(t => (
            <option key={t.id} value={t.nom}>
              {(t.role || '').toLowerCase().includes('manager') ? '👔' :
               (t.role || '').toLowerCase().includes('accueil') ? '📋' : '🔧'} {t.nom}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Aucun message pour le moment</p>
          </div>
        )}

        {messages.map(msg => {
          const isMine = msg.sender === currentUser;
          const isPrivate = msg.is_private;

          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${isMine ? 'items-end' : 'items-start'}`}>
                {/* Header: sender -> recipient */}
                <div className={`flex items-center gap-1 text-[10px] mb-0.5 ${isMine ? 'justify-end' : ''} text-slate-400`}>
                  <span className="font-medium">{roleIcon(msg.sender)} {msg.sender}</span>
                  {msg.recipient !== 'all' && (
                    <>
                      <span>→</span>
                      <span>{roleIcon(msg.recipient)} {msg.recipient}</span>
                    </>
                  )}
                  {isPrivate && <Lock className="w-2.5 h-2.5 text-brand-400" />}
                </div>

                {/* Bubble */}
                <div className={`rounded-2xl px-3.5 py-2 text-sm ${
                  isMine
                    ? 'bg-brand-600 text-white rounded-br-md'
                    : isPrivate
                      ? 'bg-brand-50 text-slate-700 border border-brand-100 rounded-bl-md'
                      : 'bg-slate-100 text-slate-700 rounded-bl-md'
                }`}>
                  {msg.message}
                </div>

                {/* Time */}
                <div className={`text-[10px] text-slate-300 mt-0.5 ${isMine ? 'text-right' : ''}`}>
                  {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={`Message ${recipient === 'all' ? 'a tous' : 'a ' + recipient}...`}
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm
                       focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            disabled={sending}
          />
          <button
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            className="px-3 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700
                       disabled:opacity-40 transition shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN CHAT WIDGET ────────────────────────────────────

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ai'); // 'ai' | 'team'
  const [unread, setUnread] = useState(0);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  // Poll unread count
  useEffect(() => {
    const fetchUnread = () => {
      api.chatTeamUnread(currentUser).then(data => setUnread(data.unread || 0)).catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const handleReadMessages = useCallback(() => {
    setUnread(0);
  }, []);

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[100] w-14 h-14 rounded-full bg-brand-600 text-white
                     shadow-lg shadow-brand-600/30 hover:bg-brand-700 hover:scale-105
                     transition-all flex items-center justify-center"
        >
          <MessageCircle className="w-6 h-6" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white
                           text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[100] w-[380px] h-[560px] bg-white rounded-2xl
                        shadow-2xl border border-slate-200 flex flex-col overflow-hidden
                        animate-in"
             style={{ animationName: 'chatSlideUp', animationDuration: '250ms' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-brand-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              <span className="font-display font-bold text-sm">Chat Klikphone</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-white/20 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 shrink-0">
            <button
              onClick={() => setTab('ai')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                tab === 'ai'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50/30'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Assistant IA
            </button>
            <button
              onClick={() => { setTab('team'); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition relative ${
                tab === 'team'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50/30'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Equipe
              {unread > 0 && tab !== 'team' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unread}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {tab === 'ai' ? <TabAssistant /> : <TabTeam onReadMessages={handleReadMessages} />}
          </div>
        </div>
      )}

      {/* Animation */}
      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
