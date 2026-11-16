import { useSyncExternalStore } from "react";
import * as S from "./state";

/** 订阅全局 store; 任意变化(轮询/交互)都会让组件重渲染并重新读取最新状态 */
export function useStore() {
  const version = useSyncExternalStore(S.subscribe, S.getVersion);
  return {
    version,
    last: S.LAST,
    health: S.HEALTH,
    paused: S.paused,
    refreshMs: S.refreshMs,
    chatShowAll: S.chatShowAll,
    theme: S.theme,
    drawerTaskId: S.drawerTaskId,
    drawerSessionId: S.drawerSessionId,
    workerPageId: S.workerPageId,
    configOpen: S.configOpen,
  };
}