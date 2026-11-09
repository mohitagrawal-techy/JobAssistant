import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api, send } from "../api/client";
import type { Role, User } from "../api/types";
import { Button, ErrorText, LinkButton, PageTitle, TextInput } from "../components/ui";
import { RoleAndConsentFields, useFinishAuth } from "./public";

const backToLogin = (
  <Link to="/login" className="font-semibold text-brand underline">
    Back to log in
  </Link>
);

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const request = useMutation({
    mutationFn: () => send<void>("POST", "/auth/forgot-password", { email }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };

  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Reset your password</PageTitle>
      {request.isSuccess ? (
        <div role="status" className="space-y-4 text-ink-soft">
          <p>
            If <strong className="text-ink">{email}</strong> has a Khoj account, a link to reset the
            password is on its way. The link expires in 1 hour.
          </p>
          <p className="text-sm">{backToLogin}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-ink-soft">Enter your email and we'll send you a link to choose a new password.</p>
          <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <ErrorText error={request.error} />
          <Button disabled={request.isPending} className="w-full">
            Send reset link
          </Button>
          <p className="text-center text-sm">{backToLogin}</p>
        </form>
      )}
    </div>
  );
}

export function FinishSignupPage() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "recruiter" ? "recruiter" : "seeker");
  const [consent, setConsent] = useState(false);
  const finish = useFinishAuth();
  const pending = useQuery({
    queryKey: ["google-pending"],
    queryFn: () => api<{ email: string; name: string | null; picture_url: string | null }>("/auth/google/pending"),
    retry: false,
  });
  const complete = useMutation({
    mutationFn: () => send<User>("POST", "/auth/google/complete", { role, consent }),
    onSuccess: finish,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    complete.mutate();
  };

  if (pending.isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (pending.isError) {
    return (
      <div className="mx-auto max-w-sm">
        <PageTitle>Finish signing up</PageTitle>
        <ErrorText error={pending.error} />
        <p className="mt-4 text-sm">{backToLogin}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Finish signing up</PageTitle>
      <div className="mb-4 flex items-center gap-3">
        {pending.data.picture_url && (
          <img
            src={pending.data.picture_url}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 shrink-0 rounded-full object-cover"
            onError={(event) => event.currentTarget.remove()}
          />
        )}
        <p className="min-w-0 break-words text-ink-soft">
          {pending.data.name && <strong className="block text-ink">{pending.data.name}</strong>}
          {pending.data.email}
        </p>
      </div>
      <p className="mb-4 text-sm text-ink-soft">
        We'll use your name and photo from Google. If you're looking for work, your name starts
        your profile and you can change it anytime. Only you see your photo.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <RoleAndConsentFields role={role} consent={consent} onRole={setRole} onConsent={setConsent} />
        <ErrorText error={complete.error} />
        <Button disabled={complete.isPending} className="w-full">
          Create my account
        </Button>
      </form>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const client = useQueryClient();
  const navigate = useNavigate();
  const reset = useMutation({
    mutationFn: () => send<void>("POST", "/auth/reset-password", { token, password }),
    onSuccess: () => {
      // Every session ended with the reset, so nothing cached about this user still applies.
      client.clear();
      navigate("/login?reset=1", { replace: true });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reset.mutate();
  };

  if (!token) {
    return (
      <div className="mx-auto max-w-sm">
        <PageTitle>Choose a new password</PageTitle>
        <p className="text-ink-soft">This link is missing its code. Open the link from your email, or request a new one.</p>
        <div className="mt-4">
          <LinkButton to="/forgot-password">Request a new link</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Choose a new password</PageTitle>
      <form onSubmit={submit} className="space-y-4">
        <TextInput
          label="New password (at least 8 characters)"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorText error={reset.error} />
        <Button disabled={reset.isPending} className="w-full">
          Save new password
        </Button>
        {reset.isError && (
          <p className="text-center text-sm">
            <Link to="/forgot-password" className="font-semibold text-brand underline">
              Request a new link
            </Link>
          </p>
        )}
      </form>
      <p className="mt-3 text-sm text-ink-muted">This signs you out on all your devices.</p>
    </div>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const client = useQueryClient();
  const verify = useMutation({
    mutationFn: () => send<void>("POST", "/auth/verify-email", { token }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
  const started = useRef(false);

  useEffect(() => {
    // Links work once, and React runs effects twice in development.
    if (token && !started.current) {
      started.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Confirm your email</PageTitle>
      {!token && <p className="text-ink-soft">This link is missing its code. Open the link from your email.</p>}
      {token && verify.isPending && <p role="status" className="text-ink-soft">Confirming your email…</p>}
      {verify.isSuccess && <p role="status" className="text-ink-soft">Your email is confirmed.</p>}
      <ErrorText error={verify.error} />
      {(!token || verify.isSuccess || verify.isError) && (
        <div className="mt-4">
          <LinkButton to="/">Go to Khoj</LinkButton>
        </div>
      )}
    </div>
  );
}
