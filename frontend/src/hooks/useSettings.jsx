import { useState, createContext, useContext, useEffect } from 'react';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [animations, setAnimations] = useState(
    () => localStorage.getItem('kp_animations') !== '0'
  );

  useEffect(() => {
    localStorage.setItem('kp_animations', animations ? '1' : '0');
    if (!animations) {
      document.documentElement.classList.add('no-animations');
    } else {
      document.documentElement.classList.remove('no-animations');
    }
  }, [animations]);

  return (
    <SettingsContext.Provider value={{ animations, setAnimations }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
