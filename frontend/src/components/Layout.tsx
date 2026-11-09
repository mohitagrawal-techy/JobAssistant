import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { send } from "../api/client";
import type { User } from "../api/types";
import { useCurrentUser, useLogout } from "../auth";
import { Logo } from "./Logo";
import { ErrorText } from "./ui";

const pillIdle = "text-white/90 hover:bg-white/15";
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-pill px-2 py-1.5 text-sm sm:px-3 ${isActive ? "bg-highlight font-semibold text-ink" : pillIdle}`;

function primaryLinks(user: User | null | undefined) {
  if (user?.role === "seeker") {
    return [
      { to: "/matches", label: "Matches" },
      { to: "/applications", label: "Applications" },
      { to: "/assistant", label: "Assistant" },
      { to: "/jobs", label: "Browse jobs" },
    ];
  }
  if (user?.role === "recruiter") {
    return [
      { to: "/recruiter/jobs", label: "Our jobs" },
      { to: "/jobs", label: "Browse jobs" },
    ];
  }
  return [{ to: "/jobs", label: "Browse jobs" }];
}

function VerifyEmailBanner({ email }: { email: string }) {
  const resend = useMutation({ mutationFn: () => send<void>("POST", "/auth/resend-verification") });
  return (
    <div className="mx-[3%] px-[3%] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-highlight px-4 py-3 text-sm text-ink">
        <p>
          Confirm your email. We sent a link to <strong>{email}</strong>.
        </p>
        {resend.isSuccess ? (
          <p role="status" className="font-semibold">
            Sent. Check your inbox.
          </p>
        ) : (
          <button
            type="button"
            className="font-semibold text-brand underline disabled:opacity-50"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            Send it again
          </button>
        )}
        <ErrorText error={resend.error} />
      </div>
    </div>
  );
}

function Avatar({ user }: { user: User }) {
  const [broken, setBroken] = useState(false);
  if (user.picture_url && !broken) {
    // Google's image host often refuses requests that carry a referrer.
    return (
      <img
        src={user.picture_url}
        alt=""
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return <>{(user.full_name || user.email)[0]}</>;
}

function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const logout = useLogout();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "block rounded-xl px-3 py-2 text-sm text-ink hover:bg-subtle";
  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-bold uppercase text-ink"
      >
        <Avatar user={user} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border-frame border-line bg-white p-2 text-ink shadow-raised">
          <div className="px-3 py-2 text-sm">
            {user.full_name && <p className="truncate font-semibold text-ink">{user.full_name}</p>}
            <p className="truncate text-ink-soft">{user.email}</p>
          </div>
          {user.role === "seeker" && (
            <>
              <Link to="/profile" className={item}>Profile</Link>
              <Link to="/privacy" className={item}>Privacy and data</Link>
            </>
          )}
          <div className="my-1 border-t border-ink/10" />
          <button
            type="button"
            className={`${item} w-full text-left`}
            onClick={() => logout.mutate()}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { data: user } = useCurrentUser();
  const links = primaryLinks(user);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <nav aria-label="Main" className="mx-[3%] px-[3%] pt-4">
        <div className="flex min-h-16 items-center gap-1 rounded-panel bg-ink px-4 py-3">
          <Link to="/" className="mr-1 flex items-center px-1 text-xl text-white sm:mr-3 sm:px-2">
            <Logo wordClassName="max-sm:sr-only" />
          </Link>
          <div className={`items-center gap-1 ${user ? "hidden md:flex" : "flex"}`}>
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={linkClass}>
                {link.label}
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <NavLink to="/login" className={linkClass}>
                  Log in
                </NavLink>
                <NavLink to="/register" className={linkClass}>
                  Sign up
                </NavLink>
              </>
            )}
          </div>
        </div>
      </nav>

      {user && !user.email_verified && <VerifyEmailBanner email={user.email} />}

      <main className={`mx-[3%] px-[3%] pt-8 ${user ? "pb-24 md:pb-8" : "pb-8"}`}>
        <Outlet />
      </main>

      {user && (
        <nav aria-label="Main, mobile" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-ink/15 bg-white md:hidden">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex-1 border-t-2 py-3 text-center text-xs font-medium ${
                  isActive ? "border-brand text-brand" : "border-transparent text-ink-soft"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
