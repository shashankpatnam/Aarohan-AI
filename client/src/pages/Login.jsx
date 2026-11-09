import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { ApiError } from "../services/api.js";
import { useAuth } from "../context/useAuth.js";
import { BackgroundSlideshow, usePrefersReducedMotion } from "../components/public/GuestProjectShowcase.jsx";

function loginErrorMessage(error) {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "Invalid email or password.";
    if (typeof error.message === "string" && error.message.trim()) return error.message;
  }
  return "Could not sign in. Please try again.";
}

function Login() {
  const { ready, isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const reducedMotion = usePrefersReducedMotion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const from = location.state?.from?.pathname || "/dashboard";

  if (ready && isAuthenticated) return <Navigate to={from} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-[#303a33]">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <BackgroundSlideshow key={`login-${reducedMotion ? "reduced" : "motion"}`} reducedMotion={reducedMotion} />
      </div>
      <Link
        to="/"
        className="absolute left-5 top-5 z-20 inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-white/90 transition hover:text-white hover:underline hover:underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-10 sm:top-10"
      >
        <span aria-hidden="true">←</span> Back to Home
      </Link>
      <div className="login-content relative z-10 mx-auto grid w-full max-w-[1600px] flex-1 items-center px-5 py-10 sm:px-8 sm:py-12 lg:px-12">
        <section className="login-welcome max-w-[650px] py-5 text-white sm:py-8 lg:py-12" aria-labelledby="welcome-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75 sm:text-sm">AAROHAN SALES WORKSPACE</p>
          <h1 id="welcome-heading" className="mt-4 max-w-[620px] text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[60px]">
            Welcome back to Aarohan
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/85 sm:text-lg sm:leading-8">
            Manage leads, conversations, site visits and buyer relationships from one intelligent workspace.
          </p>
        </section>

        <section className="login-card w-full justify-self-center rounded-[22px] border border-white/70 bg-[#fffefa] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-9 lg:p-10" aria-labelledby="signin-heading">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#527A65]">Aarohan team</p>
            <h2 id="signin-heading" className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 sm:text-[30px]">Staff Sign In</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">Sign in to your sales workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">Email address</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="min-h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-[#527A65] focus:ring-4 focus:ring-[#527A65]/12"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">Password</span>
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="min-h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-12 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-[#527A65] focus:ring-4 focus:ring-[#527A65]/12"
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-xl text-gray-500 transition hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#527A65]">
                  {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </span>
            </label>

            {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-800" role="alert">{error}</p> : null}

            <button type="submit" disabled={submitting} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#42634F] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#365744] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70">
              {submitting ? <><Loader2 size={17} className="animate-spin" aria-hidden />Signing in…</> : <>Sign In<ArrowRight size={17} aria-hidden /></>}
            </button>
          </form>
          <p className="mt-7 border-t border-gray-100 pt-5 text-center text-xs leading-5 text-gray-500">A secure workspace for the Aarohan sales team</p>
        </section>
      </div>
    </div>
  );
}

export default Login;
