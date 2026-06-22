import React, { useState } from 'react';
import Requests from './Requests';
import Schedule from './Schedule';
import Staff from './Staff';
import ShiftConfig from './ShiftConfig';
import OvertimeLog from './OvertimeLog';
import WorkRules from './WorkRules';
import BalanceTable from './BalanceTable';
import AreaDashboard from './AreaDashboard';

function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('schedule');

  const isCoordinator = user.role === 'coordinator' || user.role === 'admin';
  const isAreaManager = user.role === 'area_manager' || user.role === 'admin';

  const tabs = [
    { id: 'schedule', label: 'Planning', icon: '📅', always: true },
    { id: 'requests', label: 'Richieste', icon: '📝', always: true },
    { id: 'staff', label: 'Personale', icon: '👥', role: 'coordinator' },
    { id: 'shifts', label: 'Config. Turni', icon: '⚙️', role: 'coordinator' },
    { id: 'overtime', label: 'Straordinari', icon: '⏱️', always: true },
    { id: 'workrules', label: 'Regole lavoro', icon: '📋', role: 'coordinator' },
    { id: 'area', label: 'Area', icon: '🏥', role: 'area_manager' },
    { id: 'balance', label: 'Bilancio ore', icon: '⚖️', always: true },
  ];

  const visibleTabs = tabs.filter(t => 
    t.always || 
    (t.role === 'coordinator' && isCoordinator) || 
    (t.role === 'area_manager' && isAreaManager)
  );

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'admin': return 'badge-error';
      case 'area_manager': return 'badge-warning';
      case 'coordinator': return 'badge-primary';
      case 'staff': return 'badge-success';
      default: return 'badge-secondary';
    }
  };

  return (
    <div className="min-h-screen bg-secondary-50">
      {/* Header Abbraccio */}
      <header className="bg-gradient-to-r from-primary-600 to-primary-500 shadow-medium">
        <div className="container">
          <div className="flex items-center justify-between py-3">
            {/* Logo + titolo */}
            <div className="flex items-center space-x-3">
              <div className="bg-white rounded-xl px-3 py-1.5 shadow-soft">
                <img src="/logo.png" alt="Abbraccio" className="h-7 w-auto" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-none">Abbraccio Gestione Turni</h1>
                <p className="text-xs text-primary-200 mt-0.5">Gestione turni infermieristici</p>
              </div>
            </div>

            {/* User info + logout */}
            <div className="flex items-center space-x-3">
              <div className="hidden sm:flex items-center space-x-2 bg-white bg-opacity-15 rounded-xl px-3 py-1.5 border border-white border-opacity-20">
                <div className="w-7 h-7 bg-white bg-opacity-25 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold text-white">
                    {user.first_name?.[0]}{user.last_name?.[0]}
                  </span>
                </div>
                <div className="leading-none">
                  <p className="text-sm font-semibold text-white">{user.first_name} {user.last_name}</p>
                  <p className="text-xs text-primary-200 mt-0.5">{user.role.replace('_', ' ')}</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="flex items-center space-x-1.5 px-3 py-2 bg-white bg-opacity-15 hover:bg-opacity-25 text-white text-sm font-medium rounded-xl border border-white border-opacity-20 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Esci</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-secondary-200 sticky top-0 z-10 shadow-soft">
        <div className="container">
          <div className="flex space-x-0.5 overflow-x-auto py-1.5">
            {visibleTabs.map((tabItem) => (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id)}
                className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-150 whitespace-nowrap ${
                  tab === tabItem.id
                    ? 'bg-primary-50 text-primary-600 border border-primary-200 shadow-soft'
                    : 'text-secondary-500 hover:text-secondary-800 hover:bg-secondary-50'
                }`}
              >
                <span>{tabItem.icon}</span>
                <span>{tabItem.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="container py-6">
        <div className="animate-fade-in">
          {tab === 'schedule' && <Schedule user={user} isCoordinator={isCoordinator} />}
          {tab === 'requests' && <Requests user={user} isCoordinator={isCoordinator} />}
          {tab === 'staff' && isCoordinator && <Staff currentUser={user} />}
          {tab === 'shifts' && isCoordinator && <ShiftConfig />}
          {tab === 'overtime' && <OvertimeLog user={user} isCoordinator={isCoordinator} />}
          {tab === 'workrules' && isCoordinator && <WorkRules />}
          {tab === 'area' && isAreaManager && <AreaDashboard user={user} />}
          {tab === 'balance' && <BalanceTable isCoordinator={isCoordinator} />}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
