import React, { createContext, useCallback, useContext, useState } from 'react';
import { uid } from '../lib/id';

type ToastType = 'info' | 'success' | 'error' | 'warn';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  warn: (m: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const item: ToastItem = { id: uid('t'), type, message };
    setItems((prev) => [...prev, item]);
    const ttl = type === 'error' ? 7000 : 3600;
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== item.id)), ttl);
  }, []);

  const value: ToastCtx = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
    warn: (m) => toast(m, 'warn'),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用'); // i18n-allow（开发者错误）
  return ctx;
}
