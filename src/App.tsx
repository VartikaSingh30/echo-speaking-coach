import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { OverviewPage } from './components/OverviewPage';
import { LiveCoachStudio } from './components/LiveCoachStudio';
import { MockInterviewStudio } from './components/MockInterviewStudio';
import { ReportsHistoryPage } from './components/ReportsHistoryPage';
import { CoachingReportView } from './components/CoachingReportView';
import { AboutPage } from './components/AboutPage';
import {
  clearAllReports,
  deleteReportById,
  loadReports,
  saveReport,
} from './utils/storage';
import type { AppView, PracticeContext, StoredReport } from './types/echo';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('overview');
  const [liveContext, setLiveContext] = useState<PracticeContext>('Placement Interview');
  const [liveTopic, setLiveTopic] = useState<string | undefined>(undefined);
  const [liveLaunchKey, setLiveLaunchKey] = useState(0);
  const [interviewRole, setInterviewRole] = useState<string | undefined>(undefined);
  const [interviewLaunchKey, setInterviewLaunchKey] = useState(0);
  const [reports, setReports] = useState<StoredReport[]>(() => loadReports());
  const [selectedReport, setSelectedReport] = useState<StoredReport | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data && typeof data.aiConfigured === 'boolean') {
          setAiConfigured(data.aiConfigured);
        }
      })
      .catch(() => {
        if (mounted) setAiConfigured(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleStartLiveWithContext = (ctx: PracticeContext, topic?: string) => {
    setLiveContext(ctx);
    setLiveTopic(topic);
    setLiveLaunchKey((k) => k + 1);
    setActiveView('live');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleStartInterviewWithRole = (role?: string) => {
    setInterviewRole(role);
    setInterviewLaunchKey((k) => k + 1);
    setActiveView('interview');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleReportComplete = (report: StoredReport) => {
    const updated = saveReport(report);
    setReports(updated);
    setSelectedReport(report);
    setActiveView('report-detail');
  };

  const handleReportUpdated = (updatedReport: StoredReport) => {
    const updatedList = saveReport(updatedReport);
    setReports(updatedList);
    setSelectedReport(updatedReport);
  };

  const handleOpenReport = (report: StoredReport) => {
    setSelectedReport(report);
    setActiveView('report-detail');
  };

  const handleDeleteReport = (id: string) => {
    const updated = deleteReportById(id);
    setReports(updated);
    if (selectedReport?.id === id) {
      setSelectedReport(null);
      setActiveView('reports');
    }
  };

  const handleClearAllReports = () => {
    clearAllReports();
    setReports([]);
    setSelectedReport(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#070B09] text-[#ECF2EE]">
      <Navbar
        activeView={activeView}
        onNavigate={(view) => {
          setActiveView(view);
          window.scrollTo({ top: 0, behavior: 'instant' });
        }}
      />

      <main className="flex-1">
        {activeView === 'overview' && (
          <OverviewPage
            reports={reports}
            aiConfigured={aiConfigured}
            onStartLiveWithContext={handleStartLiveWithContext}
            onStartInterviewWithRole={handleStartInterviewWithRole}
            onNavigate={setActiveView}
            onOpenReport={handleOpenReport}
          />
        )}

        {activeView === 'live' && (
          <LiveCoachStudio
            key={`${liveContext}-${liveLaunchKey}`}
            initialContext={liveContext}
            initialTopic={liveTopic}
            onReportComplete={handleReportComplete}
          />
        )}

        {activeView === 'interview' && (
          <MockInterviewStudio
            key={interviewLaunchKey}
            initialRole={interviewRole}
            onInterviewComplete={handleReportComplete}
          />
        )}

        {activeView === 'reports' && (
          <ReportsHistoryPage
            reports={reports}
            onOpenReport={handleOpenReport}
            onDeleteReport={handleDeleteReport}
            onClearAll={handleClearAllReports}
            onStartLive={() => setActiveView('live')}
            onStartInterview={() => setActiveView('interview')}
          />
        )}

        {activeView === 'report-detail' && selectedReport && (
          <CoachingReportView
            report={selectedReport}
            onBack={() => setActiveView('reports')}
            onReportUpdated={handleReportUpdated}
            onStartNewLive={() => setActiveView('live')}
            onStartNewInterview={() => setActiveView('interview')}
          />
        )}

        {activeView === 'about' && <AboutPage onNavigate={setActiveView} />}
      </main>

      <footer className="no-print border-t border-white/[0.06] mt-12">
        <div className="mx-auto max-w-[1360px] px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#6B8075]">
          <span>Echo — AI-Powered Real-Time Speaking Coach</span>
          <span>
            Scores and visual estimates are directional coaching indicators · Video never leaves your browser
          </span>
        </div>
      </footer>
    </div>
  );
}
