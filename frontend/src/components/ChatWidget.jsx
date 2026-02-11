import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle, X, Send, Bot, Users, Lock, ArrowLeft,
  Loader2, Trash2, Sparkles, Megaphone
} from 'lucide-react';
import api from '../lib/api';

// ─── MARKDOWN-LIKE RENDERER ──────────────────────────────

function ChatMessageContent({ content }) {
  const navigate = useNavigate();
  const target = localStorage.getItem('kp_target') || 'accueil';

  if (!content) return null;

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
  { icon: '🔧', text: "Comment changer l'ecran d'un iPhone 15 ?" },
  { icon: '💰', text: 'Quel est le CA du jour ?' },
  { icon: '📱', text: 'Quels tickets sont assignes a Marina ?' },
];

// ─── HELPER: format time ────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function roleIcon(role) {
  if (!role) return '🔧';
  const r = role.toLowerCase();
  if (r.includes('manager')) return '👔';
  if (r.includes('accueil')) return '📋';
  return '🔧';
}

// ═════════════════════════════════════════════════════════
// TAB 1: ASSISTANT IA
// ═════════════════════════════════════════════════════════

function TabAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [convId, setConvId] = useState(null);
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
    setLoading(true);

    try {
      const data = await api.chatAI(msg, currentUser, convId);
      setConvId(data.conversation_id);
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (err) {
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
  };

  return (
    <div className="flex flex-col h-full">
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

// ═════════════════════════════════════════════════════════
// TAB 2: GENERAL (public messages)
// ═════════════════════════════════════════════════════════

function TabGeneral({ onReadMessages }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await api.chatTeamMessages(currentUser, 'general');
      setMessages(msgs);
    } catch { /* silent */ }
  }, [currentUser]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Mark general messages as read
  useEffect(() => {
    api.chatTeamMarkRead(currentUser).then(() => onReadMessages?.()).catch(() => {});
  }, [messages.length, currentUser, onReadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.chatTeamSend(msg, currentUser, 'all');
      setInput('');
      fetchMessages();
    } catch { /* silent */ }
    setSending(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Megaphone className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Aucun message pour le moment</p>
          </div>
        )}

        {messages.map(msg => {
          const isMine = msg.sender === currentUser;
          const color = msg.sender_color || '#94a3b8';

          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${isMine ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-center gap-1 text-[10px] mb-0.5 ${isMine ? 'justify-end' : ''} text-slate-400`}>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="font-medium">{msg.sender}</span>
                  <span>{fmtTime(msg.created_at)}</span>
                </div>
                <div className={`rounded-2xl px-3.5 py-2 text-sm ${
                  isMine
                    ? 'bg-brand-600 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                }`}>
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-200 p-3 bg-white flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Message a tout le monde..."
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
  );
}

// ═════════════════════════════════════════════════════════
// TAB 3: PRIVE (WhatsApp-style contacts + conversations)
// ═════════════════════════════════════════════════════════

function TabPrivate({ onReadMessages }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  // Fetch contacts list
  const fetchContacts = useCallback(async () => {
    try {
      const data = await api.chatTeamContacts(currentUser);
      setContacts(data);
    } catch { /* silent */ }
  }, [currentUser]);

  useEffect(() => {
    fetchContacts();
    const interval = setInterval(fetchContacts, 5000);
    return () => clearInterval(interval);
  }, [fetchContacts]);

  // Fetch conversation when contact selected
  const fetchConversation = useCallback(async (contact) => {
    try {
      const data = await api.chatTeamConversation(currentUser, contact);
      setMessages(data);
    } catch { /* silent */ }
  }, [currentUser]);

  useEffect(() => {
    if (!selectedContact) return;
    fetchConversation(selectedContact);
    // Mark as read
    api.chatTeamMarkRead(currentUser, selectedContact).then(() => {
      onReadMessages?.();
      fetchContacts();
    }).catch(() => {});
    const interval = setInterval(() => fetchConversation(selectedContact), 3000);
    return () => clearInterval(interval);
  }, [selectedContact, fetchConversation, currentUser, onReadMessages, fetchContacts]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendPrivateMessage = async () => {
    const msg = input.trim();
    if (!msg || !selectedContact || sending) return;
    setSending(true);
    try {
      await api.chatTeamSend(msg, currentUser, selectedContact);
      setInput('');
      fetchConversation(selectedContact);
    } catch { /* silent */ }
    setSending(false);
    inputRef.current?.focus();
  };

  // ─── CONTACT LIST VIEW ──────────────────────
  if (!selectedContact) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-brand-500" />
            Messages prives
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 && (
            <div className="text-center py-8">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Aucun contact</p>
            </div>
          )}
          {contacts.map(contact => (
            <button
              key={contact.name}
              onClick={() => setSelectedContact(contact.name)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition border-b border-slate-50"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ background: contact.color || '#94a3b8' }}
              >
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-sm text-slate-700">
                    {roleIcon(contact.role)} {contact.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {contact.last_message_time || ''}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {contact.last_message || 'Pas de message'}
                </p>
              </div>
              {contact.unread > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                  {contact.unread > 9 ? '9+' : contact.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── CONVERSATION VIEW ──────────────────────
  const contactInfo = contacts.find(c => c.name === selectedContact);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/50 shrink-0">
        <button
          onClick={() => { setSelectedContact(null); setMessages([]); }}
          className="text-slate-400 hover:text-slate-600 transition p-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
          style={{ background: contactInfo?.color || '#94a3b8' }}
        >
          {selectedContact.charAt(0).toUpperCase()}
        </div>
        <span className="font-semibold text-sm text-slate-700">{selectedContact}</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-slate-400">Commencez une conversation avec {selectedContact}</p>
          </div>
        )}
        {messages.map(msg => {
          const isMine = msg.sender === currentUser;
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                  isMine
                    ? 'bg-brand-600 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                }`}>
                  {msg.message}
                </div>
                <div className={`text-[10px] text-slate-300 mt-0.5 ${isMine ? 'text-right' : ''}`}>
                  {fmtTime(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white flex gap-2 shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendPrivateMessage()}
          placeholder={`Message a ${selectedContact}...`}
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm
                     focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          disabled={sending}
        />
        <button
          onClick={sendPrivateMessage}
          disabled={sending || !input.trim()}
          className="px-3 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700
                     disabled:opacity-40 transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// MAIN CHAT WIDGET
// ═════════════════════════════════════════════════════════

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ai'); // 'ai' | 'general' | 'private'
  const [unreadGeneral, setUnreadGeneral] = useState(0);
  const [unreadPrivate, setUnreadPrivate] = useState(0);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  // Poll total unread count
  useEffect(() => {
    const fetchUnread = () => {
      api.chatTeamUnreadTotal(currentUser)
        .then(data => {
          setUnreadGeneral(data.general || 0);
          setUnreadPrivate(data.private || 0);
        })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 8000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const totalUnread = unreadGeneral + unreadPrivate;

  const handleReadGeneral = useCallback(() => setUnreadGeneral(0), []);
  const handleReadPrivate = useCallback(() => {
    // Re-fetch to update per-contact counts
    api.chatTeamUnreadTotal(currentUser)
      .then(data => setUnreadPrivate(data.private || 0))
      .catch(() => {});
  }, [currentUser]);

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
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white
                           text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-[100] w-[380px] h-[560px] bg-white rounded-2xl
                     shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ animation: 'chatSlideUp 250ms ease-out' }}
        >
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

          {/* 3 Tabs */}
          <div className="flex border-b border-slate-100 shrink-0">
            {/* Assistant IA */}
            <button
              onClick={() => setTab('ai')}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition ${
                tab === 'ai'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50/30'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Assistant
            </button>

            {/* General */}
            <button
              onClick={() => setTab('general')}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition relative ${
                tab === 'general'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50/30'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Megaphone className="w-3.5 h-3.5" />
              General
              {unreadGeneral > 0 && tab !== 'general' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadGeneral > 9 ? '9+' : unreadGeneral}
                </span>
              )}
            </button>

            {/* Prive */}
            <button
              onClick={() => setTab('private')}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition relative ${
                tab === 'private'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50/30'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              Prive
              {unreadPrivate > 0 && tab !== 'private' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadPrivate > 9 ? '9+' : unreadPrivate}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {tab === 'ai' && <TabAssistant />}
            {tab === 'general' && <TabGeneral onReadMessages={handleReadGeneral} />}
            {tab === 'private' && <TabPrivate onReadMessages={handleReadPrivate} />}
          </div>
        </div>
      )}

      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
