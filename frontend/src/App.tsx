import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { RequireRole } from "./auth";
import { Layout } from "./components/Layout";
import { FinishSignupPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "./pages/account";
import { AssistantPage } from "./pages/assistant";
import { LandingPage } from "./pages/landing";
import { JobDetailPage, JobSearchPage, LoginPage, RegisterPage } from "./pages/public";
import {
  CandidatesPage,
  JobEditPage,
  OrgSetupPage,
  PipelinePage,
  RecruiterJobsPage,
} from "./pages/recruiter";
import { ProfilePage } from "./pages/profile";
import { ApplicationsPage, MatchesPage, PrivacyPage } from "./pages/seeker";

// The hiring tools include the chart library, so only their users download it.
const InsightsPage = lazy(() => import("./pages/hiring").then((m) => ({ default: m.InsightsPage })));
const JobWriterPage = lazy(() => import("./pages/hiring").then((m) => ({ default: m.JobWriterPage })));
const loading = <p className="text-sm text-ink-muted">Loading…</p>;
const lazyPage = (page: React.ReactNode) => <Suspense fallback={loading}>{page}</Suspense>;

const seeker = (page: React.ReactNode) => <RequireRole role="seeker">{page}</RequireRole>;
const recruiter = (page: React.ReactNode) => <RequireRole role="recruiter">{page}</RequireRole>;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LandingPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="finish-signup" element={<FinishSignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="verify-email" element={<VerifyEmailPage />} />
          <Route path="jobs" element={<JobSearchPage />} />
          <Route path="jobs/:id" element={<JobDetailPage />} />
          <Route path="assistant" element={seeker(<AssistantPage />)} />
          <Route path="profile" element={seeker(<ProfilePage />)} />
          <Route path="matches" element={seeker(<MatchesPage />)} />
          <Route path="applications" element={seeker(<ApplicationsPage />)} />
          <Route path="privacy" element={seeker(<PrivacyPage />)} />
          <Route path="recruiter/setup" element={recruiter(<OrgSetupPage />)} />
          <Route path="recruiter/jobs" element={recruiter(<RecruiterJobsPage />)} />
          <Route path="recruiter/jobs/new" element={recruiter(lazyPage(<JobWriterPage />))} />
          <Route path="recruiter/jobs/:id/insights" element={recruiter(lazyPage(<InsightsPage />))} />
          <Route path="recruiter/jobs/:id/edit" element={recruiter(<JobEditPage />)} />
          <Route path="recruiter/jobs/:id/candidates" element={recruiter(<CandidatesPage />)} />
          <Route path="recruiter/jobs/:id/pipeline" element={recruiter(<PipelinePage />)} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
