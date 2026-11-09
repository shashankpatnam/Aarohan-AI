import { Building2 } from "lucide-react";

function ChatBubble({ msg, animate = false, id }) {
  return (
    <div
      id={id}
      className={`flex items-end gap-2 ${msg.from === "buyer" ? "justify-end" : "justify-start"} ${animate ? "guest-chat-message-enter" : ""}`}
    >
      {msg.from !== "buyer" ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EDF3EE] text-[#527A65]">
          <Building2 size={14} aria-hidden />
        </span>
      ) : null}
      <div
        className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[80%] ${
          msg.from === "buyer"
            ? "rounded-br-md bg-[#527A65] text-white"
            : "rounded-bl-md border border-gray-100 bg-white text-gray-800 shadow-sm"
        }`}
      >
        {msg.from === "ai" && (
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[#527A65]">
            Aarohan AI
          </p>
        )}
        {msg.text}
        {msg.time ? (
          <p
            className={`mt-1.5 text-right text-[10px] ${
              msg.from === "buyer" ? "text-white/70" : "text-gray-400"
            }`}
          >
            {msg.time}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default ChatBubble;
