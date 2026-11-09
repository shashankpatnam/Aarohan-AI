import { memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { GUEST_PROJECTS } from "../../constants/projects.js";
import {
  cleanPossession,
  cleanRera,
  formatIndicativePrice,
  projectImagePaths,
} from "../../utils/projectPresentation.js";

function projectImageSource(project, imageIndex) {
  return { key: `${project}-${imageIndex}`, ...projectImagePaths(project, imageIndex) };
}

function preloadImage(source) {
  let image = null;
  let resolvePromise;
  let settled = false;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    image = new Image();
    image.onload = () => finish(source.webp);
    image.onerror = () => {
      image = new Image();
      image.onload = () => finish(source.png);
      image.onerror = () => finish(null);
      image.src = source.png;
    };
    image.src = source.webp;
  });

  function finish(url) {
    if (settled) return;
    settled = true;
    resolvePromise(url);
  }

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
      resolvePromise(null);
    },
  };
}

export const BackgroundSlideshow = memo(function BackgroundSlideshow({ project, reducedMotion }) {
  const images = useMemo(() => {
    if (project) return [projectImageSource(project, 1), projectImageSource(project, 2)];
    return [1, 2].flatMap((imageIndex) => GUEST_PROJECTS.map((name) => projectImageSource(name, imageIndex)));
  }, [project]);
  const [activeImage, setActiveImage] = useState(() => ({ index: 0, url: images[0].webp }));
  const [incomingImage, setIncomingImage] = useState(null);
  const [activeImageReady, setActiveImageReady] = useState(false);
  const [activeImageFailed, setActiveImageFailed] = useState(false);

  useEffect(() => {
    if (reducedMotion || images.length < 2 || (!activeImageReady && !activeImageFailed)) return undefined;

    let cancelled = false;
    let currentIndex = 0;
    let holdTimer;
    let crossfadeTimer;
    let preload = preloadImage(images[(currentIndex + 1) % images.length]);

    function showNextImage() {
      holdTimer = window.setTimeout(async () => {
        const nextIndex = (currentIndex + 1) % images.length;
        const nextUrl = await preload.promise;
        if (cancelled) return;

        if (!nextUrl) {
          currentIndex = nextIndex;
          preload = preloadImage(images[(currentIndex + 1) % images.length]);
          showNextImage();
          return;
        }

        setIncomingImage({ index: nextIndex, url: nextUrl });
        crossfadeTimer = window.setTimeout(() => {
          if (cancelled) return;
          currentIndex = nextIndex;
          setActiveImage({ index: nextIndex, url: nextUrl });
          setActiveImageFailed(false);
          setIncomingImage(null);
          preload = preloadImage(images[(currentIndex + 1) % images.length]);
          showNextImage();
        }, 1200);
      }, project ? 7000 : 6000);
    }

    showNextImage();
    return () => {
      cancelled = true;
      window.clearTimeout(holdTimer);
      window.clearTimeout(crossfadeTimer);
      preload.cancel();
    };
  }, [activeImageFailed, activeImageReady, images, project, reducedMotion]);

  function handleActiveImageError() {
    const source = images[activeImage.index];
    if (activeImage.url === source.webp) {
      setActiveImage({ ...activeImage, url: source.png });
      setActiveImageReady(false);
    } else {
      setActiveImageFailed(true);
    }
  }

  return (
    <>
      <div className="absolute inset-0 bg-[#303a33]" />
      {!activeImageFailed ? (
        <img
          key={`${images[activeImage.index].key}-${activeImage.url}`}
          src={activeImage.url}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-center"
          onLoad={() => setActiveImageReady(true)}
          onError={handleActiveImageError}
        />
      ) : null}
      {incomingImage ? (
        <img
          key={`${images[incomingImage.index].key}-${incomingImage.url}`}
          src={incomingImage.url}
          alt=""
          aria-hidden="true"
          className="guest-chat-background-enter absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/25 md:from-black/65 md:via-black/35 md:to-black/45" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/20 md:bg-gradient-to-b md:from-black/25 md:via-transparent md:to-black/30" />
    </>
  );
});

export function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (event) => setReducedMotion(event.matches);
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return reducedMotion;
}

function ProjectSelector({ value, onChange }) {
  return (
    <label className="block max-w-sm">
      <span className="mb-1.5 block text-xs font-medium text-white/75">Explore communities</span>
      <span className="relative block">
        <select
          aria-label="Explore communities"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 w-full appearance-none rounded-lg border border-white/30 bg-black/25 px-3.5 py-2.5 pr-10 text-sm font-medium text-white shadow-sm outline-none backdrop-blur-sm transition hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-white/80 [&>option]:bg-white [&>option]:text-gray-900"
        >
          <option value="">All projects</option>
          {GUEST_PROJECTS.map((project) => <option key={project} value={project}>{project}</option>)}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/80" aria-hidden />
      </span>
    </label>
  );
}

function ProjectFacts({ facts }) {
  if (!facts) return null;
  const startingPrice = formatIndicativePrice(facts.priceInformation?.startingFrom);
  return (
    <dl className="mt-4 grid max-w-lg grid-cols-1 gap-x-6 gap-y-2 text-sm leading-5 text-white/90 sm:grid-cols-2">
      {facts.location ? <div className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-white/75" aria-hidden /><dd>{facts.location}</dd></div> : null}
      {facts.propertyConfigurations?.length ? <div><dt className="text-xs text-white/60">Configurations</dt><dd>{facts.propertyConfigurations.join(", ")}</dd></div> : null}
      {startingPrice ? <div><dt className="text-xs text-white/60">Indicative starting price</dt><dd>{startingPrice}</dd></div> : null}
      {facts.possessionTimeline ? <div><dt className="text-xs text-white/60">Possession</dt><dd>{cleanPossession(facts.possessionTimeline)}</dd></div> : null}
      {facts.reraInformation ? <div className="sm:col-span-2"><dt className="text-xs text-white/60">RERA registration</dt><dd className="break-words">{cleanRera(facts.reraInformation)}</dd></div> : null}
    </dl>
  );
}

function GuestProjectShowcase({
  displayedProject,
  projectFacts,
  onSelectProject,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const facts = displayedProject ? projectFacts[displayedProject] : null;
  const headline = "Find your place. We'll help you find your home.";

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden bg-[#303a33] md:inset-0 md:h-auto" aria-hidden="true">
        <BackgroundSlideshow key={`${displayedProject || "portfolio"}-${reducedMotion ? "reduced" : "motion"}`} project={displayedProject} reducedMotion={reducedMotion} />
      </div>
      <section className="relative z-10 flex min-h-[360px] flex-col justify-center px-5 pb-10 pt-7 text-white sm:px-8 md:min-h-0 md:justify-center md:px-0 md:py-8" aria-label="Property information">
        <div className="max-w-[540px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/75 sm:text-xs">Aarohan Property Concierge</p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl xl:text-5xl">
            {headline}
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/85 sm:text-base">
            {displayedProject
              ? "Explore this community and compare it with other Aarohan homes, all in the same conversation."
              : "Explore Aarohan's residential communities, compare your options, and discover a home that fits your needs."}
          </p>
          <div className="mt-5">
            <ProjectSelector value={displayedProject} onChange={onSelectProject} />
          </div>
          {displayedProject ? (
            <div className="mt-5">
              <h3 className="text-xl font-medium text-white sm:text-2xl">{displayedProject}</h3>
              <ProjectFacts facts={facts} />
            </div>
          ) : (
            <div className="mt-5 flex max-w-lg flex-wrap gap-2" aria-label="Aarohan projects">
              {GUEST_PROJECTS.map((project) => (
                <button key={project} type="button" onClick={() => onSelectProject(project)} className="min-h-9 rounded-full border border-white/25 bg-black/20 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
                  {project}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default GuestProjectShowcase;
