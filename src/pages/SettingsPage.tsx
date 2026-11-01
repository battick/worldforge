import React, { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { IcCheck, IcEdit, IcPlus, IcGlobe, IcTrash, IcChevron } from '../components/icons';
import { PROVIDERS, PROVIDER_GROUPS, presetOf, switchProvider, urlOverridden, type ProviderGroup } from '../ai/providers';
import { testConnection, parseExtraObject } from '../ai/client';
import { ModelPicker } from '../components/ModelPicker';
import { readCloudConfig, writeCloudConfig } from '../storage';
import { download } from '../lib/export';
import { formatTime } from '../lib/id';
import { localeMeta, useI18n, useT } from '../i18n';
import { CHANGELOG, APP_VERSION, type ChangelogType } from '../lib/changelog';
import type { AIJsonMode } from '../types';
import type { MsgKey } from '../i18n/translate';

interface Props {
  onEditWorld: () => void;
  onNewWorld: () => void;
}

/** 下拉里那三段分组的标题。写成常量而不是拼字符串，这样键名打错会被类型检查逮住 */
const GROUP_KEYS: Record<ProviderGroup, MsgKey> = {
  main: 'ai.provider.group.main',
  aggregator: 'ai.provider.group.aggregator',
  local: 'ai.provider.group.local',
};

export function SettingsPage({ onEditWorld, onNewWorld }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();
  const { locale, pref, setPref, locales } = useI18n();
  const ai = store.settings.ai;
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [adv, setAdv] = useState(false);
  const [cloud, setCloud] = useState(readCloudConfig() ?? { baseUrl: '', token: '' });
  const importRef = useRef<HTMLInputElement>(null);
  const currentPreset = presetOf(ai.provider);

  // 这两栏是手写的 JSON，写歪是常态而不是异常 —— 界面上就地报红，别等到发请求才炸
  const headersParse = parseExtraObject(ai.extraHeaders, 'headers');
  const bodyParse = parseExtraObject(ai.extraBody, 'body');
  const advancedOn =
    (ai.jsonMode ?? 'auto') !== 'auto' ||
    Number(ai.maxTokens) > 0 ||
    Number(ai.topP ?? 1) < 1 ||
    ai.stream === false ||
    !!ai.extraHeaders?.trim() ||
    !!ai.extraBody?.trim();

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await testConnection(ai);
      setTestResult(t('settings.ai.testOk', { reply: reply.slice(0, 48) }));
      toast.success(t('settings.ai.testOkToast'));
    } catch (e) {
      setTestResult((e as Error).message);
      toast.error(t('settings.ai.testFailedToast'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-desc">{t('settings.desc')}</p>
        </div>
      </div>

      {/* ---------------- 界面语言 ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">
            <IcGlobe size={15} /> {t('settings.lang.title')}
          </h3>
          <div className="page-actions">
            <span className="pill canon">{localeMeta(locale).native}</span>
          </div>
        </div>
        <div className="field-hint" style={{ marginTop: 0 }}>
          {t('settings.lang.desc')}
        </div>
        <div className="row wrap mt12" style={{ gap: 8 }}>
          <button
            className={`btn sm ${pref === 'auto' ? 'primary' : ''}`}
            onClick={() => setPref('auto')}
          >
            {t('settings.lang.auto')}
          </button>
          {locales.map((l) => (
            <button
              key={l.id}
              className={`btn sm ${pref === l.id ? 'primary' : ''}`}
              onClick={() => setPref(l.id)}
            >
              {l.native}
            </button>
          ))}
        </div>
        {pref === 'auto' && (
          <div className="muted tiny mt8">
            {t('settings.lang.autoHint', { locale: localeMeta(locale).native })}
          </div>
        )}
      </div>

      {/* ---------------- AI ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{t('settings.ai.title')}</h3>
          <span className={`pill ${ai.apiKey ? 'canon' : 'draft'}`}>
            {ai.apiKey ? t('settings.ai.configured') : t('settings.ai.notConfigured')}
          </span>
          <div className="page-actions">
            <button className="btn sm" onClick={doTest} disabled={testing || !ai.baseUrl}>
              {testing ? <span className="spinner dark" /> : <IcCheck size={14} />}
              {t('settings.ai.test')}
            </button>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div className="col" style={{ minWidth: 200 }}>
            <label className="field-label">{t('settings.ai.provider')}</label>
            <select
              className="select"
              data-role="ai-provider"
              value={ai.provider}
              onChange={(e) => store.updateAI(switchProvider(ai, e.target.value))}
            >
              {PROVIDER_GROUPS.map((g) => {
                const list = PROVIDERS.filter((p) => p.group === g);
                if (!list.length) return null;
                return (
                  <optgroup key={g} label={t(GROUP_KEYS[g])}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(p.nameKey)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <div className="field-hint">{currentPreset ? t(currentPreset.hintKey) : ''}</div>
          </div>
          <div className="col grow" style={{ minWidth: 280 }}>
            <label className="field-label">{t('settings.ai.model')}</label>
            <ModelPicker settings={ai} onChange={(patch) => store.updateAI(patch)} />
          </div>
        </div>

        <div className="field mt12">
          <label className="field-label">{t('settings.ai.baseUrl')}</label>
          <input
            className="input"
            data-role="ai-base-url"
            value={ai.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) => store.updateAI({ baseUrl: e.target.value })}
          />
          <div className="field-hint">{t('settings.ai.baseUrlHint')}</div>
          {urlOverridden(ai) && (
            <button
              className="btn xs mt8"
              type="button"
              data-role="ai-base-url-reset"
              onClick={() => {
                const next = { ...(ai.baseUrlByProvider ?? {}) };
                delete next[ai.provider];
                store.updateAI({ baseUrl: currentPreset?.baseUrl ?? '', baseUrlByProvider: next });
              }}
            >
              {t('settings.ai.baseUrlReset', { url: currentPreset?.baseUrl ?? '' })}
            </button>
          )}
        </div>

        <div className="field">
          <label className="field-label">{t('settings.ai.apiKey')}</label>
          <div className="row">
            <input
              className="input grow"
              type={showKey ? 'text' : 'password'}
              value={ai.apiKey}
              placeholder="sk-…"
              onChange={(e) => store.updateAI({ apiKey: e.target.value.trim() })}
              autoComplete="off"
            />
            <button className="btn" onClick={() => setShowKey((s) => !s)}>
              {showKey ? t('settings.ai.hide') : t('settings.ai.show')}
            </button>
          </div>
          <div className="field-hint">{t('settings.ai.keyHint')}</div>
        </div>

        <div className="row wrap" style={{ gap: 16 }}>
          <div className="col" style={{ minWidth: 220 }}>
            <label className="field-label">
              {t('settings.ai.temperature', { value: ai.temperature.toFixed(2) })}
            </label>
            <input
              type="range"
              min={0}
              max={1.4}
              step={0.05}
              value={ai.temperature}
              style={{ width: '100%' }}
              data-role="ai-temperature"
              onChange={(e) => store.updateAI({ temperature: Number(e.target.value) })}
            />
            <div className="field-hint">{t('settings.ai.temperatureHint')}</div>
          </div>
          <div style={{ width: 200 }}>
            <label className="field-label">{t('settings.ai.contextLimit')}</label>
            <input
              className="input"
              type="number"
              min={5}
              max={400}
              value={ai.contextLimit}
              onChange={(e) => store.updateAI({ contextLimit: Number(e.target.value) || 60 })}
            />
            <div className="field-hint">{t('settings.ai.contextLimitHint')}</div>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 16 }}>
          <div style={{ width: 200 }}>
            <label className="field-label">{t('settings.ai.maxTokens')}</label>
            <input
              className="input"
              type="number"
              min={0}
              step={256}
              value={ai.maxTokens ?? 0}
              data-role="ai-max-tokens"
              onChange={(e) =>
                store.updateAI({ maxTokens: Math.max(0, Math.round(Number(e.target.value) || 0)) })
              }
            />
            <div className="field-hint">{t('settings.ai.maxTokensHint')}</div>
          </div>
          <div className="col" style={{ minWidth: 220 }}>
            <label className="field-label">
              {t('settings.ai.topP', { value: Number(ai.topP ?? 1).toFixed(2) })}
            </label>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={ai.topP ?? 1}
              style={{ width: '100%' }}
              data-role="ai-top-p"
              onChange={(e) => store.updateAI({ topP: Number(e.target.value) })}
            />
            <div className="field-hint">{t('settings.ai.topPHint')}</div>
          </div>
        </div>

        <label className="row mt12" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={ai.vision !== false}
            style={{ marginTop: 3 }}
            onChange={(e) => store.updateAI({ vision: e.target.checked })}
          />
          <span>
            <span className="bold" style={{ fontSize: 13 }}>
              {t('settings.ai.vision')}
            </span>
            <div className="field-hint" style={{ marginTop: 3 }}>
              {t('settings.ai.visionHint')}
            </div>
          </span>
        </label>

        <label className="row mt12" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={ai.stream !== false}
            style={{ marginTop: 3 }}
            data-role="ai-stream"
            onChange={(e) => store.updateAI({ stream: e.target.checked })}
          />
          <span>
            <span className="bold" style={{ fontSize: 13 }}>
              {t('settings.ai.stream')}
            </span>
            <div className="field-hint" style={{ marginTop: 3 }}>
              {t('settings.ai.streamHint')}
            </div>
          </span>
        </label>

        {/* ---------------- 高级：直接把请求体 / 请求头露出来 ---------------- */}
        <button
          className="adv-head mt12"
          type="button"
          data-role="ai-advanced-toggle"
          onClick={() => setAdv((v) => !v)}
        >
          <IcChevron size={14} />
          <span className="grow">{t('settings.ai.advanced')}</span>
          {advancedOn && <span className="adv-badge">{t('settings.ai.advancedOn')}</span>}
        </button>

        {adv && (
          <div data-role="ai-advanced">
            <div className="field">
              <label className="field-label">{t('settings.ai.jsonMode')}</label>
              <select
                className="select"
                data-role="ai-json-mode"
                value={ai.jsonMode ?? 'auto'}
                onChange={(e) => store.updateAI({ jsonMode: e.target.value as AIJsonMode })}
              >
                <option value="auto">{t('settings.ai.jsonMode.auto')}</option>
                <option value="always">{t('settings.ai.jsonMode.always')}</option>
                <option value="never">{t('settings.ai.jsonMode.never')}</option>
              </select>
              <div className="field-hint">{t('settings.ai.jsonModeHint')}</div>
            </div>

            <div className="field">
              <label className="field-label">{t('settings.ai.extraHeaders')}</label>
              <textarea
                className="textarea mono"
                rows={3}
                spellCheck={false}
                data-role="ai-extra-headers"
                value={ai.extraHeaders ?? ''}
                placeholder={'{ "X-Api-Version": "2024-01-01" }'}
                onChange={(e) => store.updateAI({ extraHeaders: e.target.value })}
              />
              <div className="field-hint">{t('settings.ai.extraHeadersHint')}</div>
              {!headersParse.ok && <div className="adv-warn">{headersParse.message}</div>}
            </div>

            <div className="field">
              <label className="field-label">{t('settings.ai.extraBody')}</label>
              <textarea
                className="textarea mono"
                rows={3}
                spellCheck={false}
                data-role="ai-extra-body"
                value={ai.extraBody ?? ''}
                placeholder={'{ "top_k": 40, "enable_thinking": false }'}
                onChange={(e) => store.updateAI({ extraBody: e.target.value })}
              />
              <div className="field-hint">{t('settings.ai.extraBodyHint')}</div>
              {!bodyParse.ok && <div className="adv-warn">{bodyParse.message}</div>}
            </div>
          </div>
        )}

        {testResult && (
          <div
            className={`banner ${testResult.startsWith(t('settings.ai.testOkPrefix')) ? 'info' : 'danger'} mt12`}
            data-role="ai-test-result"
            data-ok={testResult.startsWith(t('settings.ai.testOkPrefix')) ? '1' : '0'}
          >
            <div style={{ wordBreak: 'break-all' }}>{testResult}</div>
          </div>
        )}
      </div>

      {/* ---------------- 世界管理 ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">
            <IcGlobe size={15} /> {t('settings.world.title')}
          </h3>
          <div className="page-actions">
            <button className="btn sm" onClick={onNewWorld}>
              <IcPlus size={14} /> {t('settings.world.new')}
            </button>
          </div>
        </div>
        {store.db.worlds.map((w) => (
          <div
            key={w.id}
            className="row"
            style={{
              padding: '10px 0',
              borderTop: '1px solid var(--border)',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span className="world-dot" style={{ background: w.themeColor }} />
            <div className="grow">
              <div className="bold" style={{ fontSize: 13.5 }}>
                {w.name}
                {store.settings.activeWorldId === w.id && (
                  <span className="pill canon" style={{ marginLeft: 8 }}>
                    {t('settings.world.current')}
                  </span>
                )}
              </div>
              <div className="muted tiny mt8">
                {t('settings.world.stats', {
                  entries: store.db.entries.filter((e) => e.worldId === w.id).length,
                  relations: store.db.relations.filter((r) => r.worldId === w.id).length,
                  time: formatTime(w.updatedAt),
                })}
              </div>
            </div>
            {store.settings.activeWorldId !== w.id && (
              <button className="btn xs" onClick={() => store.setActiveWorld(w.id)}>
                {t('settings.world.switch')}
              </button>
            )}
            <button
              className="btn xs"
              onClick={() => {
                store.setActiveWorld(w.id);
                onEditWorld();
              }}
            >
              <IcEdit size={12} /> {t('settings.world.edit')}
            </button>
            <button
              className="btn xs ghost"
              onClick={async () => {
                const n = store.db.entries.filter((e) => e.worldId === w.id).length;
                if (!confirm(t('settings.world.confirmDelete', { name: w.name, n }))) return;
                await store.deleteWorld(w.id);
                toast.success(t('settings.world.deleted'));
              }}
            >
              <IcTrash size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* ---------------- 存储 ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{t('settings.storage.title')}</h3>
          <span className="pill">{store.storage.label}</span>
        </div>

        <div className="banner info">
          <div>{t('settings.storage.localBanner')}</div>
        </div>

        <div className="divider" />

        <div className="bold small" style={{ marginBottom: 8 }}>
          {t('settings.storage.upgrade')}
        </div>
        <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t('settings.storage.upgradeHint')}
          <br />
          <code>GET/PUT/DELETE {'{base}'}/:store[/:id]</code>
          {t('common.listSep')}
          <code>POST {'{base}'}/:store/bulk</code>
          {t('settings.storage.tableNames')}
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="col" style={{ minWidth: 220 }}>
            <label className="field-label">{t('settings.storage.baseUrl')}</label>
            <input
              className="input"
              placeholder="https://your-server.example.com/api"
              value={cloud.baseUrl}
              onChange={(e) => setCloud({ ...cloud, baseUrl: e.target.value })}
            />
          </div>
          <div style={{ width: 200 }}>
            <label className="field-label">{t('settings.storage.token')}</label>
            <input
              className="input"
              value={cloud.token ?? ''}
              onChange={(e) => setCloud({ ...cloud, token: e.target.value })}
            />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn"
              onClick={() => {
                writeCloudConfig(cloud.baseUrl ? cloud : null);
                toast.success(t('settings.storage.savedToast'));
                setTimeout(() => window.location.reload(), 500);
              }}
            >
              {t('settings.storage.save')}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- 备份 ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{t('settings.backup.title')}</h3>
        </div>

        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const payload = JSON.parse(await f.text());
              const replace = confirm(t('settings.backup.importConfirm'));
              await store.importBackup(payload, replace);
              toast.success(t('settings.backup.imported'));
            } catch (err) {
              toast.error(t('settings.backup.importFailed', { message: (err as Error).message }));
            }
            if (importRef.current) importRef.current.value = '';
          }}
        />

        <div className="row wrap" style={{ gap: 9 }}>
          <button
            className="btn"
            onClick={() => {
              const payload = {
                version: 1,
                exportedAt: new Date().toISOString(),
                ...store.db,
              };
              download(
                `worldforge_backup_${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(payload, null, 2),
                'application/json',
              );
              toast.success(t('settings.backup.downloaded'));
            }}
          >
            {t('settings.backup.export')}
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            {t('settings.backup.import')}
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(t('settings.backup.wipeConfirm1'))) return;
              if (!confirm(t('settings.backup.wipeConfirm2'))) return;
              await store.resetAll();
              toast.success(t('settings.backup.wiped'));
            }}
          >
            <IcTrash size={14} /> {t('settings.backup.wipe')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{t('settings.tips.title')}</h3>
        </div>
        <ul className="soft small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>
            {t('settings.tips.linkBefore')}
            <code>{t('settings.tips.linkSample')}</code>
            {t('settings.tips.linkAfter')}
          </li>
          <li>{t('settings.tips.tone')}</li>
          <li>{t('settings.tips.more')}</li>
          <li>{t('settings.tips.review')}</li>
          <li>{t('settings.tips.consistency')}</li>
        </ul>
      </div>

      {/* ---------------- 更新日志 ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{t('settings.changelog.title')}</h3>
          <span className="muted tiny" style={{ alignSelf: 'center' }}>
            {t('settings.changelog.current')} <span className="bold" style={{ color: 'var(--accent)' }}>v{APP_VERSION}</span>
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {CHANGELOG.map((rel) => (
            <div key={rel.version}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                <span className="bold" style={{ fontSize: 14 }}>v{rel.version}</span>
                <span className="muted tiny">{rel.date}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, fontSize: 13 }}>
                {rel.items.map((it, i) => (
                  <li key={i}>
                    <TypeTag type={it.type} t={t} />
                    <span>{locale === 'en-US' ? it.en : it.zh}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const TYPE_COLOR: Record<ChangelogType, string> = {
  feature: '#2f8f5f',
  fix: '#c0392b',
  improve: '#b4720d',
  refactor: '#5b7c99',
};

function TypeTag({ type, t }: { type: ChangelogType; t: ReturnType<typeof useT> }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 36,
        textAlign: 'center',
        marginRight: 8,
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 11,
        color: '#fff',
        background: TYPE_COLOR[type],
        verticalAlign: 'middle',
      }}
    >
      {t.dyn(`settings.changelog.type.${type}`)}
    </span>
  );
}
