import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Building2,
  Clock3,
  Loader2,
  MapPin,
  MessageCircle,
  UserRound,
} from "lucide-react";
import { GUEST_PROJECTS } from "../../constants/projects.js";
import { ApiError } from "../../services/api.js";
import { writeGuestSession } from "../../services/guestSessionStorage.js";
import {
  cleanPossession,
  cleanPrice,
  cleanRera,
  projectImagePaths,
} from "../../utils/projectPresentation.js";
import {
  createGuestSession,
  fetchPublicProjects,
} from "../../services/publicApi.js";

function ProjectImage({ project }) {
  const [failed, setFailed] = useState(false);
  const [usePngFallback, setUsePngFallback] = useState(false);
  const paths = projectImagePaths(project, 1);

  return (
    <div className="aspect-[4/3] overflow-hidden bg-[#F1F3F0]">
      {failed ? (
        <div
          className="flex h-full w-full items-center justify-center text-[#87978B]"
          role="img"
          aria-label={`Illustration unavailable for ${project}`}
        >
          <Building2 size={42} strokeWidth={1.2} aria-hidden />
        </div>
      ) : (
        <picture>
          {!usePngFallback ? <source srcSet={paths.webp} type="image/webp" /> : null}
          <img
            src={usePngFallback ? paths.png : paths.webp}
            alt={`Illustration of ${project}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
            onError={() => {
              if (!usePngFallback) setUsePngFallback(true);
              else setFailed(true);
            }}
          />
        </picture>
      )}
    </div>
  );
}

function ProjectCard({ project, facts, pending, onChat }) {
  const isPending = pending === project;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-[#527A65]/30 hover:shadow-lg hover:shadow-gray-900/[0.06] focus-within:ring-2 focus-within:ring-[#527A65]/35">
      <ProjectImage project={project} />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h3 className="text-lg font-semibold tracking-tight text-gray-900">
          {project}
        </h3>

        {facts ? (
          <div className="mt-4 flex-1 space-y-2.5 text-sm leading-5 text-gray-600">
            {facts.location ? (
              <p className="flex items-start gap-2">
                <MapPin
                  size={16}
                  className="mt-0.5 shrink-0 text-[#527A65]"
                  aria-hidden
                />
                <span>{facts.location}</span>
              </p>
            ) : null}
            {facts.propertyConfigurations?.length ? (
              <p>
                <span className="font-medium text-gray-700">Configurations:</span>{" "}
                {facts.propertyConfigurations.join(", ")}
              </p>
            ) : null}
            {facts.priceInformation?.startingFrom ? (
              <p className="font-medium text-gray-800">
                From about {cleanPrice(facts.priceInformation.startingFrom)} (indicative)
              </p>
            ) : null}
            {facts.possessionTimeline ? (
              <p>
                <span className="font-medium text-gray-700">Possession:</span>{" "}
                {cleanPossession(facts.possessionTimeline)}
              </p>
            ) : null}
            {facts.reraInformation ? (
              <p className="break-words text-xs text-gray-500">
                <span className="font-medium text-gray-600">RERA:</span>{" "}
                {cleanRera(facts.reraInformation)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => onChat({ intent: "project", project })}
            disabled={Boolean(pending)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#527A65] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#42634F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          >
            {isPending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <MessageCircle size={16} aria-hidden />
            )}
            {isPending ? "Starting chat…" : "Explore with AI"}
          </button>
        </div>
      </div>
    </article>
  );
}

function Hero({ onGeneralChat, error, pending }) {
  const imageRef = useRef(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    function updateParallax() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!imageRef.current) return;
        if (reduceMotion.matches) {
          imageRef.current.style.transform = "scale(1.04)";
          return;
        }
        const mobile = window.innerWidth < 640;
        const distance = Math.min(window.scrollY * (mobile ? 0.035 : 0.05), mobile ? 12 : 18);
        imageRef.current.style.transform = `translate3d(0, ${-distance}px, 0) scale(1.04)`;
      });
    }

    updateParallax();
    window.addEventListener("scroll", updateParallax, { passive: true });
    reduceMotion.addEventListener?.("change", updateParallax);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateParallax);
      reduceMotion.removeEventListener?.("change", updateParallax);
    };
  }, []);

  return (
    <section
      id="hero"
      className="relative isolate flex min-h-[100svh] flex-col scroll-mt-0 overflow-hidden bg-[#202823]"
      aria-labelledby="hero-heading"
    >
      <picture className="absolute inset-0 block h-full w-full overflow-hidden">
        <source srcSet="/images/aarohan-hero.webp" type="image/webp" />
        <img
          ref={imageRef}
          src="/images/aarohan-hero.png"
          alt="Illustrative view of a contemporary residential community"
          fetchPriority="high"
          decoding="async"
          className="h-full w-full scale-[1.04] object-cover object-center"
        />
      </picture>
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/15" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-5 pb-5 pt-24 sm:px-8 sm:pb-6 sm:pt-28 lg:px-12">
        <div className="my-auto py-10 sm:py-12">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.19em] text-white/85 sm:text-sm">
          Aarohan Property Concierge
        </p>
        <h1
          id="hero-heading"
          className="max-w-[760px] text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-[54px] lg:text-[60px] xl:text-[64px]"
        >
          Find your home. Get answers in minutes, any hour.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/85 sm:text-lg sm:leading-8">
          Explore thoughtfully designed properties, discover the details that matter and get guidance from our AI property concierge.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href="#projects"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#527A65] px-6 py-3 text-[17px] font-semibold text-white transition hover:bg-[#42634F] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#42634F]"
          >
            Explore Properties
          </a>
          <button
            type="button"
            onClick={onGeneralChat}
            disabled={pending}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/70 bg-white/5 px-6 py-3 text-[17px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <MessageCircle size={17} aria-hidden />
            {pending ? "Starting chat…" : "General Chat"}
          </button>
        </div>
        {error ? (
          <p className="mt-5 text-sm text-white" role="alert">{error}</p>
        ) : null}
        </div>

      </div>

      <div className="relative z-10 mt-auto border-t border-white/20 bg-black/20 px-5 py-3 backdrop-blur-sm sm:px-8 sm:py-3.5 lg:px-12">
        <div className="mx-auto grid max-w-[1600px] items-center gap-3 sm:grid-cols-3 sm:gap-5">
          <TrustPoint icon={Clock3} text="Replies in minutes, day or night" />
          <TrustPoint icon={BadgeCheck} text="Clear information based on approved project details" />
          <TrustPoint icon={UserRound} text="A human advisor whenever you need one" />
        </div>
      </div>
    </section>
  );
}

function TrustPoint({ icon: Icon, text }) {
  return (
    <p className="flex min-h-12 items-center justify-center gap-2.5 text-center text-xs leading-5 text-white/90 sm:text-sm">
      <Icon size={17} className="shrink-0 text-white" strokeWidth={1.7} aria-hidden />
      <span>{text}</span>
    </p>
  );
}

function ExploreProjects() {
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState(null);
  const [error, setError] = useState("");
  const [projectFacts, setProjectFacts] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetchPublicProjects()
      .then((response) => {
        if (cancelled) return;
        setProjectFacts(
          Object.fromEntries(
            (response.projects ?? []).map((facts) => [facts.projectName, facts]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setProjectFacts({});
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function startChat(intent) {
    if (pendingKey) return;

    const project = intent.intent === "project" ? intent.project : "";
    const pending = project || "general";

    setPendingKey(pending);
    setError("");

    try {
      const data = await createGuestSession(intent);
      const sessionId = data.session?.id;
      const sessionToken = data.sessionToken;

      if (!sessionId || !sessionToken) throw new Error("Invalid session response");

      writeGuestSession({
        sessionId,
        sessionToken,
        project: data.session?.project ?? project,
      });
      navigate("/explore/chat");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Could not start a chat. Check that the server is running and try again.";
      setError(message);
      setPendingKey(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Hero
        onGeneralChat={() => startChat({ intent: "general" })}
        error={error}
        pending={Boolean(pendingKey)}
      />

      <section className="bg-[#FAFAF8] py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
          <div className="mb-8 max-w-2xl sm:mb-10">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#527A65]">
              Find the right fit
            </p>
            <h2 id="projects" className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
              Discover Your Next Home
            </h2>
            <p className="mt-3 text-sm leading-6 text-gray-600 sm:text-base sm:leading-7">
              Explore thoughtfully selected residential communities and find the one that fits your lifestyle.
            </p>
          </div>

          <ul className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3 xl:gap-6">
            {GUEST_PROJECTS.map((project) => (
              <li key={project}>
                <ProjectCard
                  project={project}
                  facts={projectFacts[project]}
                  pending={pendingKey}
                  onChat={startChat}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-white px-5 py-14 sm:px-8 sm:py-18 lg:px-12 lg:py-20">
        <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-6 rounded-2xl bg-[#EDF3EE] px-6 py-8 sm:flex-row sm:items-center sm:px-10 sm:py-10">
          <div className="max-w-2xl">
            <h2 id="contact" className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              Let&apos;s find your next home.
            </h2>
            <p className="mt-3 text-sm leading-6 text-gray-600 sm:text-base">
              Have questions about a property? Start a conversation and let our property concierge guide you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startChat({ intent: "general" })}
            disabled={Boolean(pendingKey)}
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#527A65] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#42634F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] focus-visible:ring-offset-2 disabled:opacity-70"
          >
            {pendingKey === "general" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <MessageCircle size={16} aria-hidden />
            )}
            General Chat
          </button>
        </div>
      </section>
    </div>
  );
}

export default ExploreProjects;
