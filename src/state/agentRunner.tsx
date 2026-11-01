/**
 * 工作台 agent 的「常驻运行器」。
 *
 * 放在 `Shell` 外面而不是页面里面，是这个需求的全部要点：
 *
 * **路由切换只卸载页面，不卸载 Shell。**
 * 原先 `useAgent` 在 `StudioPage` 里，切到别的页面时组件卸载 —— 而那个多步循环是个
 * 还没跑完的 async 函数，它照旧在跑、照旧往库里写，但界面上：
 *   - 流式预览、计划卡、进行中的回执全没了；
 *   - 切回来时 hook 重新初始化成 idle，看起来「它停过」；
 *   - 更糟的是 `phase === 'idle'` 会让输入框重新可用，再发一条就变成两个循环同时改库。
 *
 * 提到这一层之后，页面只是「一块显示屏」：它挂载时用 `attach(threadId)` 说明自己在看哪段
 * 会话，其余状态（忙不忙、流式文本、待拍板批次）都活在这里，切页不影响。
 */
import React, { createContext, useContext } from 'react';
import { useAgent } from './useAgent';

type AgentRunner = ReturnType<typeof useAgent>;

const Ctx = createContext<AgentRunner | null>(null);

export function AgentRunnerProvider({ children }: { children: React.ReactNode }) {
  const runner = useAgent();
  return <Ctx.Provider value={runner}>{children}</Ctx.Provider>;
}

export function useAgentRunner(): AgentRunner {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAgentRunner 必须放在 AgentRunnerProvider 里面'); // i18n-allow（开发者错误）
  return v;
}
