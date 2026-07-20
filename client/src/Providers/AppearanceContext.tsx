import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'interface-style';
const DEFAULT_STYLE = 'default';

export const interfaceStyles = ['default', 'claude', 'chatgpt'] as const;
export type InterfaceStyle = (typeof interfaceStyles)[number];

interface AppearanceContextValue {
  interfaceStyle: InterfaceStyle;
  setInterfaceStyle: (style: InterfaceStyle) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function isInterfaceStyle(value: string | null): value is InterfaceStyle {
  return interfaceStyles.some((style) => style === value);
}

function getStoredInterfaceStyle(): InterfaceStyle {
  if (typeof window === 'undefined') {
    return DEFAULT_STYLE;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isInterfaceStyle(stored) ? stored : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

function applyInterfaceStyle(style: InterfaceStyle): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.interfaceStyle = style;
}

export function initializeInterfaceStyle(): InterfaceStyle {
  const style = getStoredInterfaceStyle();
  applyInterfaceStyle(style);
  return style;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [interfaceStyle, setInterfaceStyleState] =
    useState<InterfaceStyle>(getStoredInterfaceStyle);

  const setInterfaceStyle = useCallback((style: InterfaceStyle) => {
    setInterfaceStyleState(style);
    applyInterfaceStyle(style);
    try {
      localStorage.setItem(STORAGE_KEY, style);
    } catch {
      // The visual preference still applies when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    applyInterfaceStyle(interfaceStyle);
  }, [interfaceStyle]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }
      setInterfaceStyleState(isInterfaceStyle(event.newValue) ? event.newValue : DEFAULT_STYLE);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = useMemo(
    () => ({ interfaceStyle, setInterfaceStyle }),
    [interfaceStyle, setInterfaceStyle],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error('useAppearance must be used within an AppearanceProvider');
  }
  return context;
}
