import React, { useState } from 'react';
import { login } from '../services/api';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(username, password);
      onLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Errore di accesso');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Pannello sinistro Abbraccio */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-600 via-primary-500 to-primary-400 flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Cerchi decorativi */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/3 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-white opacity-5 rounded-full translate-y-1/3 -translate-x-1/3"></div>

        <div className="relative z-10 text-center text-white max-w-sm">
          {/* Logo Abbraccio */}
          <div className="inline-flex items-center justify-center bg-white rounded-2xl mb-8 px-6 py-4 shadow-large">
            <img src="/logo.png" alt="Abbraccio" className="h-16 w-auto" />
          </div>
          <h2 className="text-xl font-semibold mb-4 opacity-90">Abbraccio Gestione Turni</h2>
          <p className="text-base opacity-75 leading-relaxed">
            Sistema integrato di gestione turni e pianificazione del personale infermieristico
          </p>

          <div className="mt-10 grid grid-cols-3 gap-4 text-center">
            <div className="bg-white bg-opacity-15 rounded-xl p-4">
              <div className="text-2xl font-bold">24/7</div>
              <div className="text-xs opacity-75 mt-1">Copertura</div>
            </div>
            <div className="bg-white bg-opacity-15 rounded-xl p-4">
              <div className="text-2xl font-bold">AI</div>
              <div className="text-xs opacity-75 mt-1">Pianificatore</div>
            </div>
            <div className="bg-white bg-opacity-15 rounded-xl p-4">
              <div className="text-2xl font-bold">∞</div>
              <div className="text-xs opacity-75 mt-1">Reparti</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pannello destro — form login */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-secondary-50 px-6 py-12">
        <div className="w-full max-w-md">
          {/* Header mobile */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center bg-white rounded-2xl mb-4 px-5 py-3 shadow-soft border border-secondary-100">
              <img src="/logo.png" alt="Abbraccio" className="h-10 w-auto" />
            </div>
            <h1 className="text-2xl font-bold text-secondary-900">Abbraccio Gestione Turni</h1>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-large p-8">
            <div className="mb-8">
              <div className="hidden lg:flex justify-center mb-5">
                <img src="/logo.png" alt="Abbraccio" className="h-12 w-auto" />
              </div>
              <h2 className="text-2xl font-bold text-secondary-900">Bentornato</h2>
              <p className="text-secondary-500 mt-1">Accedi al tuo account per continuare</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-error-50 border border-error-200 rounded-xl flex items-start">
                <svg className="w-5 h-5 text-error-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-error-700 text-sm font-medium">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="username" className="block text-sm font-semibold text-secondary-700 mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <svg className="h-4.5 w-4.5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 border border-secondary-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition bg-secondary-50 hover:bg-white"
                    placeholder="es. mario.rossi"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-secondary-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <svg className="h-4.5 w-4.5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 border border-secondary-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition bg-secondary-50 hover:bg-white"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-xl transition-all shadow-medium hover:shadow-large disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center text-sm"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Accesso in corso...
                  </>
                ) : 'Accedi'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-secondary-100 text-center">
              <p className="text-xs text-secondary-400">
                Demo: <span className="font-mono bg-primary-50 text-primary-700 px-2 py-0.5 rounded-lg">admin / Admin1234!</span>
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-secondary-400 mt-6">
            © 2026 Abbraccio Cure Domiciliari · Gestione Turni
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
