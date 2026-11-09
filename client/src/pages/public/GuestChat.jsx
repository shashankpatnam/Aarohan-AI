import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Loader2, MessageCircle, PhoneCall, RotateCcw, Send, UserRound } from "lucide-react";
import ChatBubble from "../../components/chat/ChatBubble.jsx";
import GuestContactPanel from "../../components/public/GuestContactPanel.jsx";
import GuestCallbackPanel from "../../components/public/GuestCallbackPanel.jsx";
import GuestProjectShowcase from "../../components/public/GuestProjectShowcase.jsx";
import GuestSiteVisitBooking from "../../components/public/GuestSiteVisitBooking.jsx";
import { GUEST_PROJECTS } from "../../constants/projects.js";
import { ApiError } from "../../services/api.js";
import {
  clearGuestBookingDraft,
  clearGuestSession,
  readGuestBookingDraft,
  readGuestSession,
} from "../../services/guestSessionStorage.js";
import { fetchGuestSession, fetchPublicProjects, sendGuestChatMessage } from "../../services/publicApi.js";
import {
  asksToVisitAnotherProject,
  formatVisitDate,
  isBookingResumeRequest,
  isSiteVisitAvailabilityQuestion,
  isSiteVisitIntent,
  projectsMentioned,
} from "../../utils/guestVisitBooking.js";
import { guestMessageKey as messageKey, mergeBookingChatEvents } from "../../utils/guestChatTimeline.js";

const SESSION_INVALID_STATUSES = new Set([401, 404, 410]);

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3" role="status" aria-label="Aarohan is typing">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EDF3EE] text-[#527A65]"><Building2 size={16} aria-hidden /></span>
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
        {[0, 1, 2].map((dot) => <span key={dot} className="guest-chat-typing-dot h-1.5 w-1.5 rounded-full bg-[#78917E]" />)}
        <span className="sr-only">Aarohan is typing</span>
      </span>
    </div>
  );
}

function GuestChat() {
  const navigate = useNavigate();
  const [storedSession] = useState(() => readGuestSession());
  const [initialProject, setInitialProject] = useState(storedSession?.project || null);
  const [displayedProject, setDisplayedProject] = useState(storedSession?.project || null);
  const [projectFacts, setProjectFacts] = useState({});
  const [messages, setMessages] = useState([]);
  const [animatedMessageKeys, setAnimatedMessageKeys] = useState([]);
  const [needsHumanHandoff, setNeedsHumanHandoff] = useState(false);
  const [draft, setDraft] = useState("");
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [bookingRevealPending, setBookingRevealPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [contactCaptured, setContactCaptured] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [contactName, setContactName] = useState(null);
  const [interestedProjects, setInterestedProjects] = useState([]);
  const [callbackRequested, setCallbackRequested] = useState(false);
  const [callbackPending, setCallbackPending] = useState(false);
  const [contactExpandRequest, setContactExpandRequest] = useState(0);
  const [advisorExpanded, setAdvisorExpanded] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingPending, setBookingPending] = useState(() => Boolean(
    storedSession?.sessionId && readGuestBookingDraft(storedSession.sessionId),
  ));
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingRequestText, setBookingRequestText] = useState("");
  const [bookingMessages, setBookingMessages] = useState([]);
  const [bookingChatEvents, setBookingChatEvents] = useState([]);
  const bookingChatEventId = useRef(0);
  const bookingRevealLock = useRef(false);
  const handledBookingTurns = useRef(new Set());
  const bookingPromptedProjects = useRef(new Set());
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);

  const greeting = initialProject
    ? `Hi, I'm Aarohan. Ask me anything about ${initialProject}.`
    : "Hi, I'm Aarohan, your property concierge.";
  const greetingSupport = initialProject
    ? "Layouts, amenities, possession, or how site visits work. I'm happy to help."
    : "Tell me what you're looking for, or ask about any of our communities. I can cover layouts, amenities and possession timelines, and help you plan a site visit.";
  const suggestions = useMemo(() => initialProject
    ? ["Tell me about the layouts", "What amenities are available?", "I'd like to visit the site"]
    : ["Help me find the right home", "Compare your communities", "I'd like to visit the site"], [initialProject]);
  const renderedMessages = useMemo(
    () => mergeBookingChatEvents(storedSession?.sessionId, messages, bookingChatEvents),
    [bookingChatEvents, messages, storedSession?.sessionId],
  );

  function appendBookingChatEvent(text) {
    const lastIndex = messages.length - 1;
    const afterMessageKey = lastIndex >= 0
      ? messageKey(storedSession.sessionId, messages[lastIndex], lastIndex)
      : null;
    const time = new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    bookingChatEventId.current += 1;
    setBookingChatEvents((events) => [...events, {
      id: `booking-chat-event-${bookingChatEventId.current}`,
      from: "ai",
      text,
      time,
      afterMessageKey,
    }]);
  }

  function handleBookingConfirmed(booking) {
    appendBookingChatEvent(`Your site visit is confirmed for ${booking.project} on ${formatVisitDate(booking.date)} at ${booking.slot} IST. Status: ${booking.status}.`);
  }

  const handleInvalidSession = useCallback(() => {
    const session = storedSession ?? readGuestSession();
    if (session?.sessionId) clearGuestBookingDraft(session.sessionId);
    clearGuestSession();
    setSessionExpired(true);
    setLoadState("expired");
  }, [storedSession]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicProjects().then((data) => {
      if (cancelled) return;
      const projects = Array.isArray(data?.projects) ? data.projects : Array.isArray(data) ? data : [];
      const approved = new Set(GUEST_PROJECTS);
      setProjectFacts(Object.fromEntries(projects.filter((fact) => approved.has(fact.projectName)).map((fact) => [fact.projectName, fact])));
    }).catch(() => {
      if (!cancelled) setProjectFacts({});
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const session = storedSession ?? readGuestSession();
    if (!session) {
      navigate("/explore", { replace: true });
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchGuestSession(session.sessionId, session.sessionToken);
        if (cancelled) return;
        const restored = data.session;
        const restoredProject = restored?.project || null;
        setInitialProject(restoredProject);
        setDisplayedProject(restoredProject);
        setMessages(Array.isArray(restored?.messages) ? restored.messages : []);
        setNeedsHumanHandoff(restored?.needsHumanHandoff === true);
        setContactCaptured(restored?.contactCaptured === true);
        setHasPhone(restored?.hasPhone === true);
        setContactName(restored?.contactName ?? null);
        setInterestedProjects(Array.isArray(restored?.interestedProjects) ? restored.interestedProjects : []);
        setCallbackRequested(restored?.callbackRequested === true);
        setCallbackPending(restored?.callbackPending === true);
        const bookingDraft = readGuestBookingDraft(session.sessionId);
        if (bookingDraft) {
          setBookingPending(true);
          setBookingMessages(Array.isArray(restored?.messages) ? restored.messages : []);
          setBookingRequestText("");
          setBookingOpen(true);
        }
        setLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && SESSION_INVALID_STATUSES.has(error.status)) {
          handleInvalidSession();
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load your conversation. Please try again.");
        setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [handleInvalidSession, navigate, storedSession]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ top: container.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [bookingOpen, messages, sendPending]);

  useEffect(() => {
    if (!bookingSubmitting) return undefined;
    function preventInternalNavigation(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link || link.target === "_blank") return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setChatError("Please wait for the booking request to finish before leaving this conversation.");
    }
    document.addEventListener("click", preventInternalNavigation, true);
    return () => document.removeEventListener("click", preventInternalNavigation, true);
  }, [bookingSubmitting]);

  async function sendMessage(text = draft) {
    const trimmed = text.trim();
    if (!trimmed || sendPending || bookingRevealLock.current || !storedSession || loadState !== "ready") return;
    let bookingStart = null;
    setSendPending(true);
    setChatError("");
    try {
      const data = await sendGuestChatMessage(storedSession.sessionId, storedSession.sessionToken, trimmed);
      const savedMessages = Array.isArray(data.messages) ? data.messages : data.session?.messages;
      if (Array.isArray(savedMessages)) {
        const known = new Set(messages.map((message, index) => messageKey(storedSession.sessionId, message, index)));
        setAnimatedMessageKeys(savedMessages.map((message, index) => messageKey(storedSession.sessionId, message, index)).filter((key) => !known.has(key)));
        setMessages(savedMessages);
        if (isSiteVisitIntent(trimmed)) {
          const isBookingResume = isBookingResumeRequest(trimmed) || isSiteVisitAvailabilityQuestion(trimmed);
          if (!bookingOpen && bookingPending && !isBookingResume) {
            const currentBooking = readGuestBookingDraft(storedSession.sessionId);
            const requestedProjects = projectsMentioned(trimmed);
            const requestsDifferentProject = asksToVisitAnotherProject(trimmed) || requestedProjects.some((name) => name !== currentBooking?.project);
            if (requestsDifferentProject) clearGuestBookingDraft(storedSession.sessionId);
          }
          let buyerIndex = -1;
          for (let index = savedMessages.length - 1; index >= 0; index -= 1) {
            if (savedMessages[index]?.from === "buyer" && savedMessages[index]?.text === trimmed) {
              buyerIndex = index;
              break;
            }
          }
          const buyerMessage = buyerIndex >= 0 ? savedMessages[buyerIndex] : null;
          const turnKey = buyerMessage?.id
            ? String(buyerMessage.id)
            : messageKey(storedSession.sessionId, buyerMessage ?? { from: "buyer", text: trimmed }, buyerIndex);
          if (!handledBookingTurns.current.has(turnKey)) {
            handledBookingTurns.current.add(turnKey);
            bookingRevealLock.current = true;
            setBookingRevealPending(true);
            const hasAssistantReply = buyerIndex >= 0 && savedMessages.slice(buyerIndex + 1).some((message) => message?.from === "ai");
            bookingStart = { isBookingResume, messages: savedMessages, requestText: trimmed, hasAssistantReply };
          }
        }
      }
      setNeedsHumanHandoff(data.needsHumanHandoff === true || data.session?.needsHumanHandoff === true);
      if (data.session?.contactCaptured === true) setContactCaptured(true);
      if (typeof data.session?.hasPhone === "boolean") setHasPhone(data.session.hasPhone);
      if (data.session?.contactName) setContactName(data.session.contactName);
      if (Array.isArray(data.session?.interestedProjects)) setInterestedProjects(data.session.interestedProjects);
      setDraft("");
    } catch (error) {
      if (error instanceof ApiError && SESSION_INVALID_STATUSES.has(error.status)) {
        handleInvalidSession();
        return;
      }
      setChatError(error instanceof ApiError ? error.message : "Could not send your message. Please try again.");
    } finally {
      setSendPending(false);
    }
    if (bookingStart) {
      if (!bookingStart.hasAssistantReply) {
        setChatError("I couldn't finish responding to that request. Please try again.");
        setBookingRevealPending(false);
        bookingRevealLock.current = false;
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 240));
      if (!bookingOpen) setBookingMessages(bookingStart.messages);
      else if (!bookingStart.isBookingResume) setBookingMessages(bookingStart.messages);
      if (!bookingStart.isBookingResume || !bookingPending) setBookingRequestText(bookingStart.requestText);
      setBookingPending(true);
      setBookingOpen(true);
      setBookingRevealPending(false);
      bookingRevealLock.current = false;
    }
  }

  function handleProjectSelect(value) {
    const nextProject = value || null;
    if (nextProject === displayedProject) return;
    setDisplayedProject(nextProject);
  }

  function handleContactCaptured(contact) {
    setContactCaptured(true);
    if (contact?.hasPhone === true) setHasPhone(true);
    if (contact?.contactName) setContactName(contact.contactName);
  }

  function hideBooking() {
    if (bookingSubmitting) return;
    setBookingOpen(false);
    setBookingPending(true);
  }

  function cancelBooking() {
    if (bookingSubmitting) return;
    if (storedSession?.sessionId) clearGuestBookingDraft(storedSession.sessionId);
    bookingPromptedProjects.current.clear();
    setBookingOpen(false);
    setBookingPending(false);
    setBookingRequestText("");
    setBookingMessages([]);
  }

  function completeBooking() {
    if (storedSession?.sessionId) clearGuestBookingDraft(storedSession.sessionId);
    setBookingOpen(false);
    setBookingPending(false);
    setBookingRequestText("");
    setBookingMessages([]);
  }

  function handleContactPrompt(project) {
    if (bookingPromptedProjects.current.has(project)) return;
    bookingPromptedProjects.current.add(project);
    appendBookingChatEvent(`Please share your contact details so we can coordinate your site visit to ${project}.`);
  }

  function handleSubmit(event) { event.preventDefault(); void sendMessage(); }
  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  }
  function startFresh() { clearGuestSession(); navigate("/explore", { replace: true }); }

  if (!storedSession && loadState !== "expired") return null;
  if (loadState === "loading") return <div className="flex flex-1 items-center justify-center gap-3 py-16 text-gray-600"><Loader2 size={24} className="animate-spin" aria-hidden /><p className="text-sm">Loading your conversation…</p></div>;
  if (loadState === "expired" || sessionExpired) return <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 py-12 text-center"><RotateCcw size={26} className="text-amber-700" aria-hidden /><h1 className="text-xl font-semibold text-gray-900">Conversation unavailable</h1><p className="text-sm leading-relaxed text-gray-600">This chat session has expired or is no longer valid. Start a fresh conversation anytime.</p><Link to="/explore" className="rounded-lg bg-[#527A65] px-5 py-2.5 text-sm font-medium text-white">Explore communities</Link></div>;
  if (loadState === "error") return <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 py-12 text-center"><p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{loadError}</p><button type="button" onClick={() => window.location.reload()} className="text-sm font-medium text-[#527A65] hover:underline">Retry</button><button type="button" onClick={startFresh} className="text-sm text-gray-500 hover:text-gray-700">Start a new conversation</button></div>;

  return (
    <div className="relative grid min-h-[calc(100dvh-var(--public-header-height,4rem))] grid-cols-1 grid-rows-[auto_auto] overflow-x-hidden bg-[#252a26] md:h-[calc(100dvh-var(--public-header-height,4rem))] md:min-h-0 md:grid-cols-[minmax(240px,0.8fr)_minmax(360px,1fr)] md:grid-rows-1 md:gap-4 md:overflow-hidden md:px-5 md:py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,1.05fr)] lg:gap-10 lg:px-10 xl:gap-16 xl:px-16">
      <GuestProjectShowcase displayedProject={displayedProject} projectFacts={projectFacts} onSelectProject={handleProjectSelect} />

      <section className="relative z-10 flex min-h-[72dvh] min-w-0 flex-col overflow-hidden rounded-[28px] border border-gray-200/90 bg-white shadow-[0_-12px_32px_rgba(0,0,0,0.14)] md:col-start-2 md:row-start-1 md:h-full md:min-h-0 md:shadow-[0_18px_55px_rgba(0,0,0,0.24)]" aria-label="Aarohan property concierge chat">
        <header className="shrink-0 border-b border-gray-200/80 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EDF3EE] text-[#527A65]"><MessageCircle size={20} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#527A65]">{displayedProject ? "Current community" : "Aarohan property concierge"}</p>
              <h1 className="truncate text-base font-semibold text-gray-900">{displayedProject || "Explore all communities"}</h1>
            </div>
            <p className="hidden text-xs text-gray-500 sm:block">All six communities, one conversation</p>
          </div>
          <p className="mt-2 text-xs text-gray-600 sm:hidden">Ask about any Aarohan community in this chat.</p>
        </header>

        <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-8 text-center sm:py-12">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EDF3EE] text-[#527A65]"><MessageCircle size={24} aria-hidden /></span>
              <div><h2 className="text-lg font-semibold leading-6 text-gray-900">{greeting}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600">{greetingSupport}</p></div>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void sendMessage(suggestion)} disabled={sendPending || bookingRevealPending} className="min-h-10 rounded-full border border-[#527A65]/20 bg-white px-3.5 py-2 text-xs font-medium text-[#42634F] transition hover:border-[#527A65]/50 hover:bg-[#EDF3EE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65]/40 disabled:opacity-50">{suggestion}</button>)}
              </div>
            </div>
          ) : <div className="mx-auto max-w-3xl space-y-4">{renderedMessages.map((msg, index) => {
            const key = msg.id || messageKey(storedSession.sessionId, msg, index);
            return <ChatBubble key={key} msg={msg} animate={animatedMessageKeys.includes(key)} />;
          })}</div>}
          {bookingOpen ? <GuestSiteVisitBooking
            key={storedSession.sessionId}
            sessionId={storedSession.sessionId}
            sessionToken={storedSession.sessionToken}
            messages={bookingMessages.length ? bookingMessages : messages}
            interestedProjects={interestedProjects}
            requestText={bookingRequestText}
            contactCaptured={contactCaptured}
            hasPhone={hasPhone}
            contactName={contactName}
            onContactCaptured={handleContactCaptured}
            onSubmittingChange={setBookingSubmitting}
            onContactPrompt={handleContactPrompt}
            onBookingConfirmed={handleBookingConfirmed}
            onSessionInvalid={handleInvalidSession}
            isBusy={bookingSubmitting}
            onHide={hideBooking}
            onCancel={cancelBooking}
            onComplete={completeBooking}
          /> : null}
          {sendPending ? <TypingIndicator /> : null}
          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 border-t border-gray-200/80 bg-white px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
          {needsHumanHandoff ? <p className="mb-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status"><span className="font-medium">We&apos;ll have someone reach out.</span> A member of our sales team will follow up. You can keep asking questions here.</p> : null}
          <button type="button" aria-expanded={advisorExpanded} onClick={() => setAdvisorExpanded((expanded) => !expanded)} className="mb-2 inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-[#42634F] transition hover:bg-[#EDF3EE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65]/40">
            {contactCaptured ? <PhoneCall size={15} aria-hidden /> : <UserRound size={15} aria-hidden />}
            {contactCaptured ? "Talk to an advisor" : "Talk to an advisor or request a callback"}
          </button>
          {advisorExpanded && storedSession ? <div className="mb-2 max-h-[30dvh] space-y-2 overflow-y-auto"><GuestContactPanel sessionId={storedSession.sessionId} sessionToken={storedSession.sessionToken} project={initialProject} contactCaptured={contactCaptured} hasPhone={hasPhone} contactName={contactName} expandRequest={contactExpandRequest} onContactCaptured={handleContactCaptured} onSessionInvalid={handleInvalidSession} /><GuestCallbackPanel sessionId={storedSession.sessionId} sessionToken={storedSession.sessionToken} contactCaptured={contactCaptured} callbackPending={callbackPending} callbackRequested={callbackRequested} onContactRequired={() => setContactExpandRequest((count) => count + 1)} onCallbackUpdated={(data) => { setCallbackRequested(true); if (data.session?.callbackPending === true) setCallbackPending(true); }} onSessionInvalid={handleInvalidSession} /></div> : null}
          <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-end gap-2">
            <label htmlFor="guest-message-input" className="sr-only">Your message</label>
            <textarea id="guest-message-input" rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask about our communities…" disabled={sendPending || bookingRevealPending} className="min-h-11 min-w-0 flex-1 resize-y rounded-xl border border-gray-200 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50" />
            <button type="submit" aria-label={sendPending ? "Sending message" : "Send message"} disabled={!draft.trim() || sendPending || bookingRevealPending} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#527A65] text-white transition hover:bg-[#42634F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65]/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><Send size={18} aria-hidden /></button>
          </form>
          {chatError ? <p className="mx-auto mt-2 max-w-3xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{chatError}</p> : null}
          <p className="mt-2 text-center text-[10px] leading-4 text-gray-500">Aarohan AI uses approved project information. Please contact our team to confirm details.</p>
        </div>
      </section>
    </div>
  );
}

export default GuestChat;
