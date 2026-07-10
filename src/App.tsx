import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { CycleDetails } from './components/CycleDetails';
import { CheckInConsole } from './components/CheckInConsole';
import { SystemSettings } from './components/SystemSettings';
import { supabase } from './supabaseClient';
import type { Meeting } from './types';
import { LayoutDashboard, Settings } from 'lucide-react';

type ActiveScreen = 'dashboard' | 'cycle-details' | 'operation-hub' | 'settings';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>('dashboard');
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [loadingOperation, setLoadingOperation] = useState(false);
  const [managementYear, setManagementYear] = useState(2026);

  /**
   * Sélectionne un cycle et bascule sur la vue de détails.
   */
  const handleSelectCycle = (id: string) => {
    setSelectedCycleId(id);
    setCurrentScreen('cycle-details');
  };

  /**
   * Initie les opérations pour une instance donnée via Supabase.
   */
  const handleStartOperation = async (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setLoadingOperation(true);

    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();

    setLoadingOperation(false);

    if (error || !data) {
      alert('会議情報の読み込みに失敗しました。');
      return;
    }

    setActiveMeeting(data as Meeting);
    setCurrentScreen('operation-hub');
  };

  /**
   * Réinitialise l'application à son état d'accueil.
   */
  const resetToHome = () => {
    setCurrentScreen('dashboard');
    setSelectedCycleId(null);
    setSelectedMeetingId(null);
    setActiveMeeting(null);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#334155',
        fontFamily: "'Yu Gothic', 'Meiryo', 'Hiragino Sans', sans-serif",
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* HEADER JCI JAPAN */}
      <header
        style={{
          backgroundColor: '#fff',
          borderBottom: '3px solid #0B1F3A',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '0 24px',
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          {/* Identité de Marque */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
            onClick={resetToHome}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                backgroundColor: '#0B1F3A',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#F5C842',
                fontWeight: '900',
                fontSize: '18px',
                letterSpacing: '0.5px'
              }}
            >
              JCI
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  color: '#0B1F3A',
                  letterSpacing: '0.5px'
                }}
              >
                Junior Chamber International Japan
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#00A3E0',
                  letterSpacing: '0.3px'
                }}
              >
                総務委員会 — SOUMU ENGINE v2
              </p>
            </div>
          </div>

          {/* Navigation & Contrôles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px'
              }}
            >
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>年度</span>
              <select
                value={managementYear}
                onChange={(e) => {
                  setManagementYear(parseInt(e.target.value, 10));
                  resetToHome();
                }}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#0B1F3A',
                  fontWeight: '900',
                  fontSize: '14px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {[2024, 2025, 2026, 2027, 2028].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <nav style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={resetToHome}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  backgroundColor: (currentScreen === 'dashboard' || currentScreen === 'cycle-details') ? '#e0f2fe' : 'transparent',
                  color: (currentScreen === 'dashboard' || currentScreen === 'cycle-details') ? '#00A3E0' : '#475569'
                }}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>ダッシュボード</span>
              </button>

              <button
                onClick={() => setCurrentScreen('settings')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  backgroundColor: currentScreen === 'settings' ? '#e0f2fe' : 'transparent',
                  color: currentScreen === 'settings' ? '#00A3E0' : '#475569'
                }}
              >
                <Settings className="w-4 h-4" />
                <span>システム設定</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* COMPOSANT CENTRAL */}
      <main
        style={{
          flex: 1,
          maxWidth: '1280px',
          width: '100%',
          margin: '0 auto',
          padding: '32px 24px'
        }}
      >
        {currentScreen === 'dashboard' && (
          <Dashboard
            onSelectCycle={handleSelectCycle}
            managementYear={managementYear}
          />
        )}

        {currentScreen === 'cycle-details' && selectedCycleId && (
          <CycleDetails
            cycleId={selectedCycleId}
            onBack={() => setCurrentScreen('dashboard')}
            onStartOperation={handleStartOperation}
          />
        )}

        {/* VUE OPÉRATIONNELLE : ACCUEIL PRÉSIDENTIEL */}
        {currentScreen === 'operation-hub' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <button
              onClick={() => setCurrentScreen('cycle-details')}
              style={{
                alignSelf: 'flex-start',
                background: 'none',
                border: 'none',
                color: '#00A3E0',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
            >
              ← サイクルに戻る
            </button>

            {loadingOperation ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                読み込み中...
              </div>
            ) : (
              activeMeeting && (
                <CheckInConsole
                  activeMeeting={activeMeeting}
                  activeYear={managementYear}
                />
              )
            )}
          </div>
        )}

        {currentScreen === 'settings' && (
          <SystemSettings activeYear={managementYear} />
        )}
      </main>
    </div>
  );
}
