import React, { useState } from 'react';
import { useStore } from '../state/store';
import { useT } from '../i18n';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { IcTrash } from './icons';
import type { World } from '../types';

const COLORS = ['#5b7c99', '#2f6fb0', '#7c5cbf', '#17805a', '#b4720d', '#b5352b', '#0e7c8a', '#8a6d3b'];

/**
 * 编辑已有世界的基本信息。
 * 新建世界不走这里 —— 那条路径是「投喂素材 → AI 统筹 → 你确认」的共创流程，
 * 见 components/WorldOnboarding.tsx。
 */
export function WorldEditor({ world, onClose }: { world: World; onClose: () => void }) {
  const store = useStore();
  const t = useT();
  const toast = useToast();

  const [form, setForm] = useState<Partial<World>>(world);

  const patch = (p: Partial<World>) => setForm({ ...form, ...p });

  const save = async () => {
    if (!form.name?.trim()) {
      toast.warn(t('world.err.nameRequired'));
      return;
    }
    await store.updateWorld(world.id, form);
    toast.success(t('common.saved'));
    onClose();
  };

  return (
    <Modal
      title={t('world.editor.title')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger sm"
            onClick={async () => {
              const n = store.entries.filter((e) => e.worldId === world.id).length;
              if (
                !confirm(
                  t('world.editor.deleteConfirm', { name: world.name, n }),
                )
              )
                return;
              await store.deleteWorld(world.id);
              toast.success(t('world.toast.deleted'));
              onClose();
            }}
          >
            <IcTrash size={14} /> {t('world.btn.deleteWorld')}
          </button>
          <div className="grow" />
          <button className="btn sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary sm" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">{t('world.editor.name')}</label>
        <input
          className="input"
          value={form.name ?? ''}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label">{t('world.editor.tagline')}</label>
        <input
          className="input"
          value={form.tagline ?? ''}
          onChange={(e) => patch({ tagline: e.target.value })}
        />
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="col" style={{ minWidth: 190 }}>
          <label className="field-label">{t('world.editor.genre')}</label>
          <input
            className="input"
            value={form.genre ?? ''}
            placeholder={t('world.editor.genrePlaceholder')}
            onChange={(e) => patch({ genre: e.target.value })}
          />
        </div>
        <div style={{ width: 200 }}>
          <label className="field-label">{t('world.editor.color')}</label>
          <div className="row wrap" style={{ gap: 5 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => patch({ themeColor: c })}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: c,
                  border:
                    form.themeColor === c ? '2px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="field mt12">
        <label className="field-label">{t('world.editor.summary')}</label>
        <textarea
          className="textarea"
          style={{ minHeight: 110 }}
          value={form.summary ?? ''}
          placeholder={t('world.editor.summaryPlaceholder')}
          onChange={(e) => patch({ summary: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label">{t('world.editor.tone')}</label>
        <textarea
          className="textarea"
          style={{ minHeight: 78 }}
          value={form.tone ?? ''}
          placeholder={t('world.editor.tonePlaceholder')}
          onChange={(e) => patch({ tone: e.target.value })}
        />
        <div className="field-hint">
          {t('world.editor.toneHint')}
        </div>
      </div>
    </Modal>
  );
}
