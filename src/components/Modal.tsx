import React, { useEffect } from 'react';
import { IcClose } from './icons';
import { useT } from '../i18n';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

export function Modal({ title, onClose, children, footer, size = 'md' }: Props) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : ''}`}>
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <IcClose size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({
  icon = '📭',
  title,
  desc,
  action,
}: {
  icon?: string;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action}
    </div>
  );
}

/**
 * 状态胶囊：把数据里的英文枚举值（draft / canon / high …）翻成当前语言的显示名。
 * 文案在 `kind.*` 命名空间里（见 i18n/locales/zh/kind.ts），此处只做「枚举值 → key」的映射。
 */
const STATUS_MSG_KEYS: Record<string, string> = {
  draft: 'kind.status.draft',
  pending: 'kind.status.pending',
  canon: 'kind.status.canon',
  accepted: 'kind.status.accepted',
  rejected: 'kind.status.rejected',
  pendingReview: 'kind.status.pendingReview',
  high: 'kind.severity.short.high',
  medium: 'kind.severity.short.medium',
  low: 'kind.severity.short.low',
};

export function StatusPill({ status }: { status: string }) {
  const t = useT();
  const key = STATUS_MSG_KEYS[status];
  return <span className={`pill ${status}`}>{key ? t.dyn(key) : status}</span>;
}
