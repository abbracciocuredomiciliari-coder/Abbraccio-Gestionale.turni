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

  return (
    <div>
      <header style={{ background: '#1976d2', color: 'white', padding: '15px 20px' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px' }}>OPBGestionale</h1>
            <small>{user.first_name} {user.last_name} - {user.role}</small>
          </div>
          <button onClick={onLogout} className="danger">Logout</button>
        </div>
      </header>

      <div className="container">
        <div style={{ marginBottom: '20px' }}>
          <button
            className={tab === 'schedule' ? 'primary' : ''}
            onClick={() => setTab('schedule')}
            style={{ marginRight: '10px' }}
          >
            Planning
          </button>
          <button
            className={tab === 'requests' ? 'primary' : ''}
            onClick={() => setTab('requests')}
            style={{ marginRight: '10px' }}
          >
            Richieste
          </button>
          {isCoordinator && (
            <button
              className={tab === 'staff' ? 'primary' : ''}
              onClick={() => setTab('staff')}
              style={{ marginRight: '10px' }}
            >
              Personale
            </button>
          )}
          {isCoordinator && (
            <button
              className={tab === 'shifts' ? 'primary' : ''}
              onClick={() => setTab('shifts')}
              style={{ marginRight: '10px' }}
            >
              ⚙ Config. Turni
            </button>
          )}
          <button
            className={tab === 'overtime' ? 'primary' : ''}
            onClick={() => setTab('overtime')}
            style={{ marginRight: '10px' }}
          >
            ⏱ Straordinari
          </button>
          {isCoordinator && (
            <button
              className={tab === 'workrules' ? 'primary' : ''}
              onClick={() => setTab('workrules')}
              style={{ marginRight: '10px' }}
            >
              📋 Regole lavoro
            </button>
          )}
          {isAreaManager && (
            <button
              className={tab === 'area' ? 'primary' : ''}
              onClick={() => setTab('area')}
              style={{ marginRight: '10px' }}
            >
              🏥 Area
            </button>
          )}
          <button
            className={tab === 'balance' ? 'primary' : ''}
            onClick={() => setTab('balance')}
          >
            ⚖️ Bilancio ore
          </button>
        </div>

        {tab === 'schedule' && <Schedule user={user} isCoordinator={isCoordinator} />}
        {tab === 'requests' && <Requests user={user} isCoordinator={isCoordinator} />}
        {tab === 'staff' && isCoordinator && <Staff />}
        {tab === 'shifts' && isCoordinator && <ShiftConfig />}
        {tab === 'overtime' && <OvertimeLog user={user} isCoordinator={isCoordinator} />}
        {tab === 'workrules' && isCoordinator && <WorkRules />}
        {tab === 'area' && isAreaManager && <AreaDashboard user={user} />}
        {tab === 'balance' && <BalanceTable isCoordinator={isCoordinator} />}
      </div>
    </div>
  );
}

export default Dashboard;
