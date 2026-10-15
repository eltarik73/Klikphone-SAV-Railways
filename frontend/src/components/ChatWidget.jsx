import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle, X, Send, Bot, Users, Lock, ArrowLeft,
  Loader2, Trash2, Sparkles, Megaphone, VolumeX, Volume2
} from 'lucide-react';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';

// ─── NOTIFICATION SOUND (Web Audio API) ─────────────────
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* silent fallback */ }
}

function isMuted(channel) {
  try {
    const muted = JSON.parse(localStorage.getItem('kp_chat_muted') || '{}');
    return !!muted[channel];
  } catch { return false; }
}

function toggleMute(channel) {
  try {
    const muted = JSON.parse(localStorage.getItem('kp_chat_muted') || '{}');
    muted[channel] = !muted[channel];
    localStorage.setItem('kp_chat_muted', JSON.stringify(muted));
    return muted[channel];
  } catch { return false; }
}

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// Zone lue par les lecteurs d'écran : seulement les messages arrivés après le premier chargement
// (une liste entière en aria-live ferait lire tout l'historique à l'ouverture).
function LiveAnnounce({ text }) {
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{text}</div>;
}

// Nouveaux messages des autres, entre deux lectures de la même conversation
function newMessagesFrom(prev, next, currentUser) {
  const known = new Set(prev.map(m => m.id));
  return next.filter(m => !known.has(m.id) && m.sender !== currentUser);
}

const announceText = (msgs) => {
  if (msgs.length === 0) return '';
  if (msgs.length === 1) return `Nouveau message de ${msgs[0].sender} : ${msgs[0].message}`;
  const last = msgs[msgs.length - 1];
  return `${msgs.length} nouveaux messages. Dernier de ${last.sender} : ${last.message}`;
};

// ─── MARKDOWN-LIKE RENDERER ──────────────────────────────

function ChatMessageContent({ content }) {
  const navigate = useNavigate();
  const target = localStorage.getItem('kp_target') || 'accueil';

  if (!content) return null;

  let html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
  const [announce, setAnnounce] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';
  const currentRole = localStorage.getItem('kp_role') || '';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setInput('');
    setLoading(true);

    try {
      const data = await api.chatAI(msg, currentUser, convId, currentRole);
      setConvId(data.conversation_id);
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      setAnnounce(`Réponse de l'assistant : ${data.response || ''}`);
    } catch (err) {
      const texte = `Erreur : ${err.message || 'connexion impossible'}`;
      setMessages(prev => [...prev, { role: 'assistant', content: texte }]);
      setAnnounce(texte);
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
      <LiveAnnounce text={announce} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-7 h-7 text-brand-600" aria-hidden="true" />
            </div>
            <h3 className="font-bold text-slate-700 text-sm">Assistant Klikphone</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">Pose-moi une question technique ou sur la base !</p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => sendMessage(s.text)}
                  className="block w-full min-h-[44px] text-left text-xs px-3 py-2 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span aria-hidden="true">{s.icon}</span> {s.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center mr-2 mt-1 shrink-0" aria-hidden="true">
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
          <div className="flex justify-start" role="status" aria-label="L'assistant rédige sa réponse">
            <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center mr-2 mt-1 shrink-0" aria-hidden="true">
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
          <button type="button" onClick={clearChat} className="min-h-[44px] -mt-2 px-1 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 transition rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <Trash2 className="w-3 h-3" aria-hidden="true" /> Nouvelle conversation
          </button>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Pose une question..."
            aria-label="Question pour l'assistant"
            className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 text-sm
                       focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            aria-label="Envoyer la question"
            className="min-w-[44px] min-h-[44px] px-3 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700
                       disabled:opacity-40 transition shrink-0 flex items-center justify-center"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Rafraîchissement : un seul minuteur pour tout le widget ─────────
// Fermé : compteur de non-lus toutes les 30 s. Ouvert : non-lus + vue affichée toutes les 10 s.
// Onglet masqué : rien (usePolling). Après un envoi : rechargement immédiat de la vue.
const CHAT_POLL_CLOSED_MS = 30_000;
const CHAT_POLL_OPEN_MS = 10_000;

// Empreinte d'une liste de messages : si elle ne change pas, ni rendu ni scroll
const messagesSig = (list) => {
  const last = list[list.length - 1];
  return `${list.length}:${last?.id ?? ''}:${last?.created_at ?? ''}`;
};

// Liste de messages qui ne descend en bas que si l'utilisateur y était déjà (ou vient d'écrire)
function useStickyScroll(messages, currentUser) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (stickRef.current || last?.sender === currentUser) {
      el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      stickRef.current = true;
    }
  }, [messages, currentUser]);
  return { scrollRef, onScroll, stickToBottom: () => { stickRef.current = true; } };
}

// ═════════════════════════════════════════════════════════
// TAB 2: GENERAL (public messages)
// ═════════════════════════════════════════════════════════

function TabGeneral({ onReadMessages, registerPoll }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(() => isMuted('general'));
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef(null);
  const sigRef = useRef(null);
  const listRef = useRef([]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';
  const { scrollRef, onScroll, stickToBottom } = useStickyScroll(messages, currentUser);

  const fetchMessages = useCallback(async () => {
    try {
      const data = await api.chatTeamMessages(currentUser, 'general');
      const msgs = Array.isArray(data) ? data : [];
      const sig = messagesSig(msgs);
      if (sig === sigRef.current) return;
      const firstLoad = sigRef.current === null;
      sigRef.current = sig;
      const lastMsg = msgs[msgs.length - 1];
      if (!firstLoad && lastMsg && lastMsg.sender !== currentUser && !mutedRef.current) {
        playNotificationSound();
      }
      if (!firstLoad) {
        const nouveaux = newMessagesFrom(listRef.current, msgs, currentUser);
        if (nouveaux.length) setAnnounce(announceText(nouveaux));
      }
      listRef.current = msgs;
      setMessages(msgs);
    } catch { /* silent */ }
  }, [currentUser]);

  useEffect(() => {
    fetchMessages();
    return registerPoll?.(fetchMessages);
  }, [fetchMessages, registerPoll]);

  // Mark general messages as read
  useEffect(() => {
    api.chatTeamMarkRead(currentUser).then(() => onReadMessages?.()).catch(() => {});
  }, [messages.length, currentUser, onReadMessages]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.chatTeamSend(msg, currentUser, 'all');
      setInput('');
      stickToBottom();
      fetchMessages();
    } catch { /* silent */ }
    setSending(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-1 border-b border-slate-50">
        <span className="text-[11px] text-slate-500">{messages.length} message(s)</span>
        <button
          type="button"
          onClick={() => setMuted(toggleMute('general'))}
          className="w-11 h-11 -mr-3 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          title="Son coupé (canal général)"
          aria-label="Son coupé pour le canal général"
          aria-pressed={muted}
        >
          {muted
            ? <VolumeX className="w-4 h-4 text-slate-500" aria-hidden="true" />
            : <Volume2 className="w-4 h-4 text-slate-500" aria-hidden="true" />
          }
        </button>
      </div>
      <LiveAnnounce text={announce} />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 space-y-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300"
        role="region" aria-label="Messages du canal général" tabIndex={0}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Megaphone className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
            <p className="text-xs text-slate-500">Aucun message pour le moment</p>
          </div>
        )}

        {messages.map(msg => {
          const isMine = msg.sender === currentUser;
          const color = msg.sender_color || '#94a3b8';

          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${isMine ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-center gap-1 text-[10px] mb-0.5 ${isMine ? 'justify-end' : ''} text-slate-500`}>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: color }}
                    aria-hidden="true"
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
          aria-label="Message à toute l'équipe"
          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 text-sm
                     focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          disabled={sending}
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          aria-label="Envoyer le message"
          className="min-w-[44px] min-h-[44px] px-3 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700
                     disabled:opacity-40 transition shrink-0 flex items-center justify-center"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// TAB 3: PRIVE (WhatsApp-style contacts + conversations)
// ═════════════════════════════════════════════════════════

function TabPrivate({ onReadMessages, registerPoll }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [contactMuted, setContactMuted] = useState(false);
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef(null);
  const contactsSigRef = useRef('');
  const convSigRef = useRef(null);
  const convListRef = useRef([]);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';
  const { scrollRef, onScroll, stickToBottom } = useStickyScroll(messages, currentUser);

  // Fetch contacts list
  const fetchContacts = useCallback(async () => {
    try {
      const data = await api.chatTeamContacts(currentUser);
      const list = Array.isArray(data) ? data : [];
      const sig = JSON.stringify(list);
      if (sig === contactsSigRef.current) return;
      contactsSigRef.current = sig;
      setContacts(list);
    } catch { /* silent */ }
  }, [currentUser]);

  // Liste des contacts : rafraîchie seulement quand elle est affichée
  useEffect(() => {
    if (selectedContact) return undefined;
    fetchContacts();
    return registerPoll?.(fetchContacts);
  }, [selectedContact, fetchContacts, registerPoll]);

  // Fetch conversation when contact selected
  const fetchConversation = useCallback(async (contact) => {
    try {
      const data = await api.chatTeamConversation(currentUser, contact);
      const msgs = Array.isArray(data) ? data : [];
      const sig = messagesSig(msgs);
      if (sig === convSigRef.current) return;
      const firstLoad = convSigRef.current === null;
      convSigRef.current = sig;
      const lastMsg = msgs[msgs.length - 1];
      if (!firstLoad && lastMsg && lastMsg.sender !== currentUser && !isMuted(`private_${contact}`)) {
        playNotificationSound();
      }
      if (!firstLoad) {
        const nouveaux = newMessagesFrom(convListRef.current, msgs, currentUser);
        if (nouveaux.length) setAnnounce(announceText(nouveaux));
      }
      convListRef.current = msgs;
      setMessages(msgs);
    } catch { /* silent */ }
  }, [currentUser]);

  useEffect(() => {
    if (!selectedContact) return undefined;
    setContactMuted(isMuted(`private_${selectedContact}`));
    convSigRef.current = null;
    convListRef.current = [];
    setAnnounce('');
    fetchConversation(selectedContact);
    // Mark as read
    api.chatTeamMarkRead(currentUser, selectedContact).then(() => {
      onReadMessages?.();
    }).catch(() => {});
    return registerPoll?.(() => fetchConversation(selectedContact));
  }, [selectedContact, fetchConversation, currentUser, onReadMessages, registerPoll]);

  const sendPrivateMessage = async () => {
    const msg = input.trim();
    if (!msg || !selectedContact || sending) return;
    setSending(true);
    try {
      await api.chatTeamSend(msg, currentUser, selectedContact);
      setInput('');
      stickToBottom();
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
            <Lock className="w-3.5 h-3.5 text-brand-500" aria-hidden="true" />
            Messages privés
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 && (
            <div className="text-center py-8">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
              <p className="text-xs text-slate-500">Aucun contact</p>
            </div>
          )}
          {contacts.map(contact => (
            <button
              type="button"
              key={contact.name}
              onClick={() => setSelectedContact(contact.name)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition border-b border-slate-50 focus:outline-none focus-visible:bg-slate-100"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ background: contact.color || '#94a3b8' }}
                aria-hidden="true"
              >
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-sm text-slate-700">
                    {roleIcon(contact.role)} {contact.name}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {contact.last_message_time || ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {contact.last_message || 'Pas de message'}
                </p>
              </div>
              {contact.unread > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  aria-label={`${contact.unread} non lu${contact.unread > 1 ? 's' : ''}`}>
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
      <div className="flex items-center gap-2 px-2 py-0.5 border-b border-slate-100 bg-slate-50/50 shrink-0">
        <button
          type="button"
          onClick={() => { setSelectedContact(null); setMessages([]); convSigRef.current = null; }}
          aria-label="Retour à la liste des contacts"
          className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
          style={{ background: contactInfo?.color || '#94a3b8' }}
          aria-hidden="true"
        >
          {selectedContact.charAt(0).toUpperCase()}
        </div>
        <span className="font-semibold text-sm text-slate-700 flex-1">{selectedContact}</span>
        <button
          type="button"
          onClick={() => setContactMuted(toggleMute(`private_${selectedContact}`))}
          className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          title={`Son coupé (${selectedContact})`}
          aria-label={`Son coupé pour ${selectedContact}`}
          aria-pressed={contactMuted}
        >
          {contactMuted
            ? <VolumeX className="w-4 h-4 text-slate-500" aria-hidden="true" />
            : <Volume2 className="w-4 h-4 text-slate-500" aria-hidden="true" />
          }
        </button>
      </div>

      {/* Messages */}
      <LiveAnnounce text={announce} />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300"
        role="region" aria-label={`Conversation avec ${selectedContact}`} tabIndex={0}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-slate-500">Commencez une conversation avec {selectedContact}</p>
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
                <div className={`text-[10px] text-slate-500 mt-0.5 ${isMine ? 'text-right' : ''}`}>
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
          aria-label={`Message privé à ${selectedContact}`}
          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 text-sm
                     focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          disabled={sending}
        />
        <button
          type="button"
          onClick={sendPrivateMessage}
          disabled={sending || !input.trim()}
          aria-label="Envoyer le message"
          className="min-w-[44px] min-h-[44px] px-3 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700
                     disabled:opacity-40 transition shrink-0 flex items-center justify-center"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// MAIN CHAT WIDGET
// ═════════════════════════════════════════════════════════

const TABS = ['ai', 'general', 'private'];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ai'); // 'ai' | 'general' | 'private'
  const [unreadGeneral, setUnreadGeneral] = useState(0);
  const [unreadPrivate, setUnreadPrivate] = useState(0);
  const currentUser = localStorage.getItem('kp_user') || 'Utilisateur';

  // Panneau non modal : focus sur l'onglet actif à l'ouverture, retour au bouton flottant à la fermeture
  const launcherRef = useRef(null);
  const tabRefs = useRef({});
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) tabRefs.current[tab]?.focus();
    else if (wasOpenRef.current) launcherRef.current?.focus();
    wasOpenRef.current = open;
  // focus seulement au changement d'ouverture, pas à chaque changement d'onglet
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Onglets : flèches gauche/droite, Début/Fin (focus et sélection suivent)
  const onTabKeyDown = (e) => {
    const i = TABS.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const tabProps = (id) => ({
    id: `chat-tab-${id}`,
    ref: (el) => { tabRefs.current[id] = el; },
    type: 'button',
    role: 'tab',
    'aria-selected': tab === id,
    'aria-controls': 'chat-tabpanel',
    tabIndex: tab === id ? 0 : -1,
    onClick: () => setTab(id),
    onKeyDown: onTabKeyDown,
  });

  const prevTotalRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;
  // Rafraîchissement de la vue affichée (général, contacts ou conversation), enregistré par l'onglet
  const tabPollRef = useRef(null);
  const registerPoll = useCallback((fn) => {
    tabPollRef.current = fn;
    return () => { if (tabPollRef.current === fn) tabPollRef.current = null; };
  }, []);

  const fetchUnread = useCallback(() => (
    api.chatTeamUnreadTotal(currentUser)
      .then(data => {
        const newTotal = (data?.general || 0) + (data?.private || 0);
        // Son si le nombre de non-lus augmente pendant que le chat est fermé (pas au premier chargement)
        if (prevTotalRef.current !== null && newTotal > prevTotalRef.current && !openRef.current && !isMuted('global')) {
          playNotificationSound();
        }
        prevTotalRef.current = newTotal;
        setUnreadGeneral(data?.general || 0);
        setUnreadPrivate(data?.private || 0);
      })
      .catch(() => {})
  ), [currentUser]);

  const tick = useCallback(() => api.background(() => {
    const tabPoll = openRef.current ? tabPollRef.current : null;
    return Promise.all([fetchUnread(), tabPoll?.()]);
  }), [fetchUnread]);

  usePolling(tick, open ? CHAT_POLL_OPEN_MS : CHAT_POLL_CLOSED_MS);

  const totalUnread = unreadGeneral + unreadPrivate;

  const handleReadGeneral = useCallback(() => setUnreadGeneral(0), []);
  const handleReadPrivate = useCallback(() => {
    // Re-fetch to update per-contact counts
    api.chatTeamUnreadTotal(currentUser)
      .then(data => setUnreadPrivate(data?.private || 0))
      .catch(() => {});
  }, [currentUser]);

  const tabClass = (id) => `flex-1 min-h-[44px] flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition relative focus:outline-none focus-visible:bg-brand-50 ${
    tab === id
      ? 'text-brand-700 border-b-2 border-brand-600 bg-brand-50/30'
      : 'text-slate-500 hover:text-slate-700'
  }`;

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={totalUnread > 0 ? `Ouvrir le chat (${totalUnread} message${totalUnread > 1 ? 's' : ''} non lu${totalUnread > 1 ? 's' : ''})` : 'Ouvrir le chat'}
          className="fixed bottom-5 right-5 z-[100] w-14 h-14 rounded-full bg-brand-600 text-white
                     shadow-lg shadow-brand-600/30 hover:bg-brand-700 motion-safe:hover:scale-105
                     transition-all flex items-center justify-center
                     focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          <MessageCircle className="w-6 h-6" aria-hidden="true" />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white
                           text-[10px] font-bold flex items-center justify-center ring-2 ring-white" aria-hidden="true">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-labelledby="chat-titre"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
          className="fixed bottom-5 right-5 z-[100] w-[calc(100vw-40px)] sm:w-[380px] h-[calc(100vh-100px)] sm:h-[560px] bg-white rounded-2xl
                     shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ animation: 'chatSlideUp 250ms ease-out' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pl-4 pr-1 py-0.5 bg-brand-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" aria-hidden="true" />
              <h2 id="chat-titre" className="font-display font-bold text-sm">Chat Klikphone</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer le chat"
              className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* 3 Tabs */}
          <div className="flex border-b border-slate-100 shrink-0" role="tablist" aria-label="Canaux du chat">
            {/* Assistant IA */}
            <button {...tabProps('ai')} className={tabClass('ai')}>
              <Bot className="w-3.5 h-3.5" aria-hidden="true" />
              Assistant
            </button>

            {/* General */}
            <button {...tabProps('general')} className={tabClass('general')}>
              <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />
              Général
              {unreadGeneral > 0 && tab !== 'general' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
                  aria-label={`${unreadGeneral} non lu${unreadGeneral > 1 ? 's' : ''}`}>
                  {unreadGeneral > 9 ? '9+' : unreadGeneral}
                </span>
              )}
            </button>

            {/* Prive */}
            <button {...tabProps('private')} className={tabClass('private')}>
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              Privé
              {unreadPrivate > 0 && tab !== 'private' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
                  aria-label={`${unreadPrivate} non lu${unreadPrivate > 1 ? 's' : ''}`}>
                  {unreadPrivate > 9 ? '9+' : unreadPrivate}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div id="chat-tabpanel" role="tabpanel" aria-labelledby={`chat-tab-${tab}`} className="flex-1 overflow-hidden">
            {tab === 'ai' && <TabAssistant />}
            {tab === 'general' && <TabGeneral onReadMessages={handleReadGeneral} registerPoll={registerPoll} />}
            {tab === 'private' && <TabPrivate onReadMessages={handleReadPrivate} registerPoll={registerPoll} />}
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
