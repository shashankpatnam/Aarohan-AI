import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft, Menu, Sparkles, X } from "lucide-react";

const NAV_ITEMS = [
  { id: "hero", label: "Home" },
  { id: "projects", label: "Projects" },
  { id: "contact", label: "Contact Us" },
];
const LANDING_HEADER_SURFACE = "public-glass-navbar border-b border-white/10 text-white";

function PublicLayout() {
  const location = useLocation();
  const isLanding = location.pathname === "/" || location.pathname === "/explore";
  const isGuestChat = location.pathname === "/explore/chat";
  const isLogin = location.pathname === "/login";
  const headerRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const headerScrolled = isGuestChat ? false : !isLanding || scrolled;

  useEffect(() => {
    if (!isLanding) return undefined;
    const root = document.documentElement;
    root.classList.add("landing-scrollbar-hidden");
    return () => root.classList.remove("landing-scrollbar-hidden");
  }, [isLanding]);

  useEffect(() => {
    if (!isLanding) {
      return undefined;
    }

    function updateScrollState() {
      setScrolled(window.scrollY > 24);
    }

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, [isLanding]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;

    function updateHeaderOffset() {
      document.documentElement.style.setProperty(
        "--public-header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    }

    updateHeaderOffset();
    const observer = new ResizeObserver(updateHeaderOffset);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--public-header-height");
    };
  }, [isLanding]);

  useEffect(() => {
    if (!isLanding) return undefined;

    let frame = 0;
    function updateActiveSection() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sections = NAV_ITEMS
          .map(({ id }) => document.getElementById(id))
          .filter(Boolean);
        if (!sections.length) return;

        const marker = (headerRef.current?.getBoundingClientRect().height ?? 0) + 1;
        let current = sections[0];
        for (const section of sections) {
          if (section.getBoundingClientRect().top <= marker) current = section;
        }
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
          current = sections[sections.length - 1];
        }
        setActiveSection(current.id);
      });
    }

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [isLanding]);

  function navigateToSection(event, id) {
    event.preventDefault();
    setActiveSection(id);
    closeMobileMenu();
    window.history.replaceState(null, "", `#${id}`);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  const headerClass = isGuestChat || isLogin
    ? `${LANDING_HEADER_SURFACE} shadow-sm`
    : headerScrolled
      ? "border-b border-gray-200/80 bg-white/95 text-gray-900 shadow-sm backdrop-blur-md"
      : isLanding
        ? LANDING_HEADER_SURFACE
        : "border-b border-transparent bg-transparent text-white";

  return (
    <div className={`flex min-h-[100dvh] flex-col bg-[#FAFAF8] ${isGuestChat ? "md:h-[100dvh] md:overflow-hidden" : ""}`}>
      <header ref={headerRef} className={`fixed inset-x-0 top-0 z-50 transition-colors duration-200 ${headerClass}`}>
        <div className={`relative mx-auto flex items-center justify-between gap-4 py-3 ${isGuestChat
          ? "w-full max-w-none px-5 sm:px-8 md:px-5 lg:px-10 xl:px-16"
          : isLanding || isLogin
            ? "w-full max-w-[1600px] px-5 sm:px-8 sm:py-4 lg:px-12"
            : "max-w-[1440px] px-4 sm:px-8 sm:py-4 lg:px-12"}`}>
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            {isGuestChat ? (
              <Link
                to="/explore"
                aria-label="Back to Home"
                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-white/95 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#17231c]"
              >
                <ArrowLeft size={18} aria-hidden />
                <span className="hidden sm:inline">Back to Home</span>
              </Link>
            ) : null}
            {!isGuestChat ? (
              <Link
                to="/"
                onClick={closeMobileMenu}
                className="flex shrink-0 items-center gap-2.5 no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] focus-visible:ring-offset-2"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${headerScrolled ? "bg-[#EDF3EE] text-[#527A65]" : "bg-white/15 text-white"}`}>
                  <Sparkles size={18} strokeWidth={1.75} aria-hidden />
                </span>
                <span>
                  <span className={`block tracking-tight ${isLanding || isLogin ? "text-xl font-semibold" : "text-sm font-semibold"}`}>Aarohan</span>
                  <span className={`block ${isLanding || isLogin ? "text-[12px]" : "text-xs"} ${headerScrolled ? "text-gray-500" : "text-white/75"}`}>
                    Property Concierge
                  </span>
                </span>
              </Link>
            ) : null}
          </div>

          {isLanding ? (
            <nav aria-label="Main navigation" className="hidden items-center gap-10 md:flex">
              {NAV_ITEMS.map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={(event) => navigateToSection(event, id)}
                  aria-current={activeSection === id ? "location" : undefined}
                  className={`border-b py-1.5 text-base font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] ${
                    activeSection === id
                      ? `border-[#527A65] font-medium ${headerScrolled ? "text-[#42634F]" : "text-white"}`
                      : `border-transparent ${headerScrolled ? "text-gray-600 hover:text-[#42634F]" : "text-white/85 hover:text-white"}`
                  }`}
                >
                  {label}
                </a>
              ))}
            </nav>
          ) : isLogin ? (
            <span className="hidden sm:block text-xs text-white/80">Aarohan Sales Workspace</span>
          ) : (
            <span className={`hidden text-xs ${isGuestChat
              ? "left-1/2 -translate-x-1/2 text-white/90 lg:absolute lg:block"
              : `sm:block ${scrolled ? "text-gray-500" : "text-white/80"}`}`}>
              AI-guided property enquiries
            </span>
          )}

          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/login"
              className={`inline-flex items-center rounded-lg transition focus:outline-none focus-visible:ring-2 ${isLanding && !headerScrolled ? "focus-visible:ring-white" : "focus-visible:ring-[#527A65]"} focus-visible:ring-offset-2 ${isLanding
                ? "min-h-10 px-3 py-1.5 text-sm font-medium"
                : "min-h-9 px-3 py-1 text-xs font-medium"} ${
                isGuestChat
                  ? "border border-white/50 bg-black/10 text-white shadow-sm hover:bg-white/15"
                  : isLanding
                    ? headerScrolled
                      ? "text-[#365744] hover:text-[#244331]"
                      : "text-white/95 hover:text-white hover:underline hover:underline-offset-4"
                    : headerScrolled ? "text-gray-600 hover:text-[#42634F]" : "text-white/90 hover:text-white"
              }`}
            >
              Staff Login
            </Link>
            {isLanding ? (
              <button
                type="button"
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-expanded={mobileMenuOpen}
                aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] md:hidden ${
                  headerScrolled ? "text-gray-700 hover:bg-gray-100" : "text-white hover:bg-white/15"
                }`}
              >
                {mobileMenuOpen ? <X size={19} aria-hidden /> : <Menu size={19} aria-hidden />}
              </button>
            ) : null}
          </div>
        </div>

        {isLanding && mobileMenuOpen ? (
          <nav aria-label="Mobile navigation" className="border-t border-gray-100 bg-white px-4 py-2 text-gray-800 shadow-lg md:hidden">
            {NAV_ITEMS.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(event) => navigateToSection(event, id)}
                aria-current={activeSection === id ? "location" : undefined}
                className={`block rounded-lg border-l-2 px-3 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] ${
                  activeSection === id
                    ? "border-[#527A65] bg-[#FAFAF8] text-[#42634F]"
                    : "border-transparent text-gray-700 hover:bg-[#FAFAF8] hover:text-[#42634F]"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>

      <main className={isLanding ? "w-full" : isGuestChat ? "flex min-h-0 w-full flex-1 flex-col pt-[var(--public-header-height,4rem)] md:overflow-hidden" : isLogin ? "relative flex min-h-[100dvh] w-full flex-1 flex-col pt-[var(--public-header-height,4rem)]" : "mx-auto flex w-full max-w-3xl flex-col px-4 pb-8 pt-24 sm:px-6 sm:pt-28"}>
        <Outlet />
      </main>
    </div>
  );
}

export default PublicLayout;
