import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/app.css';

import { ApiError, api, type SessionUser } from './lib/api.js';
import { AuthContext, SelectionContext, type AuthState, useAuth } from './lib/hooks.js';
import { AppShell } from './components/AppShell.js';
import { RequireHomeScope } from './components/ui.js';
import { LandingPage } from './pages/LandingPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { SignInPage } from './pages/SignInPage.js';
import { SignUpPage } from './pages/SignUpPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { SignalsPage } from './pages/SignalsPage.js';
import { ActionsPage } from './pages/ActionsPage.js';
import { IndicatorsPage } from './pages/IndicatorsPage.js';
import { TrendPage } from './pages/TrendPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { ComparePage } from './pages/ComparePage.js';
import { AssurancePage } from './pages/AssurancePage.js';
import { QualityPage } from './pages/QualityPage.js';
import { UploadPage } from './pages/UploadPage.js';
import { EvidencePage } from './pages/EvidencePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { CareHomesPage } from './pages/CareHomesPage.js';
import { LeadingLaggingPage } from './pages/LeadingLaggingPage.js';
import { WorkingDefaultsPage } from './pages/WorkingDefaultsPage.js';
import { BuildRulesPage } from './pages/BuildRulesPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        /* Retrying an authorisation failure just repeats it. */
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organisation, setOrganisation] = useState<AuthState['organisation']>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: SessionUser; organisation: AuthState['organisation'] }>('/api/auth/me');
      setUser(me.user);
      setOrganisation(me.organisation);
    } catch {
      setUser(null);
      setOrganisation(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setOrganisation(null);
      queryClient.clear();
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ user, organisation, loading, refresh, signOut }),
    [user, organisation, loading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function SelectionProvider({ children }: { children: React.ReactNode }) {
  /* The chosen home and period survive a reload, so a refresh does not throw
     the manager back to the top of the list. */
  const [careHomeId, setCareHomeIdState] = useState<string | null>(
    () => localStorage.getItem('cgi.careHomeId'),
  );
  const [period, setPeriodState] = useState<string | null>(() => localStorage.getItem('cgi.period'));
  /* Whether that period was picked deliberately or simply followed the data. */
  const [periodPinned, setPeriodPinned] = useState(() => localStorage.getItem('cgi.periodPinned') === '1');

  const setCareHomeId = useCallback((id: string) => {
    setCareHomeIdState(id);
    localStorage.setItem('cgi.careHomeId', id);
    /* A period from one home may not exist in another. */
    setPeriodState(null);
    setPeriodPinned(false);
    localStorage.removeItem('cgi.period');
    localStorage.removeItem('cgi.periodPinned');
  }, []);

  const setPeriod = useCallback((next: string, pinned = false) => {
    /* An empty string clears the selection — used when the chosen home has no
       reported periods at all, so nothing asks the server for one. */
    if (!next) {
      setPeriodState(null);
      setPeriodPinned(false);
      localStorage.removeItem('cgi.period');
      localStorage.removeItem('cgi.periodPinned');
      return;
    }
    setPeriodState(next);
    localStorage.setItem('cgi.period', next);
    setPeriodPinned(pinned);
    if (pinned) localStorage.setItem('cgi.periodPinned', '1');
    else localStorage.removeItem('cgi.periodPinned');
  }, []);

  const value = useMemo(
    () => ({ careHomeId, period, periodPinned, setCareHomeId, setPeriod }),
    [careHomeId, period, periodPinned, setCareHomeId, setPeriod],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="load-state" role="status">
        Checking your session…
      </div>
    );
  }
  if (!user) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

/**
 * Setup runs once.
 *
 * A manager who has not finished it is sent to it from wherever they land; a
 * manager who has is never shown it again, however they arrive. The flag lives
 * on the user record, so this holds across devices and across sessions — not
 * just for as long as this tab is open.
 */
function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user && !user.onboarding.completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={user.onboarding.completed ? '/dashboard' : '/onboarding'} replace />;
  return <LandingPage />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <SelectionProvider>
              <Routes>
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/*" element={
                  <RequireOnboarded>
                  <AppShell>
                    <Routes>
                      <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/signals" element={<RequireHomeScope><SignalsPage /></RequireHomeScope>} />
                  <Route path="/actions" element={<RequireHomeScope><ActionsPage /></RequireHomeScope>} />
                  <Route path="/indicators" element={<RequireHomeScope><IndicatorsPage /></RequireHomeScope>} />
                  <Route path="/indicators/:indicatorId" element={<RequireHomeScope><TrendPage /></RequireHomeScope>} />
                  <Route path="/assurance" element={<RequireHomeScope><AssurancePage /></RequireHomeScope>} />
                  <Route path="/reports" element={<RequireHomeScope><ReportsPage /></RequireHomeScope>} />
                  <Route path="/compare" element={<RequireHomeScope><ComparePage /></RequireHomeScope>} />
                  <Route path="/evidence" element={<RequireHomeScope><EvidencePage /></RequireHomeScope>} />
                  <Route path="/uploads" element={<UploadPage />} />
                      <Route path="/quality" element={<RequireHomeScope><QualityPage /></RequireHomeScope>} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/leading-lagging" element={<LeadingLaggingPage />} />
                      <Route path="/working-defaults" element={<WorkingDefaultsPage />} />
                      <Route path="/build-rules" element={<BuildRulesPage />} />
                      <Route path="/profile" element={<ProfilePage />} />
                      <Route path="/care-homes" element={<CareHomesPage />} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </AppShell>
                  </RequireOnboarded>
                } />
              </Routes>
            </SelectionProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
