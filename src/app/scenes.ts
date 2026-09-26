/**
 * Scene registry. Each scene lives in src/scenes/<Name>/index.tsx and exports a component
 * named <Name>Scene taking SceneProps. Scenes are code-split; the shutter transition covers
 * the load. `bgm` / `backdrop` are applied on enter (a scene may override them itself).
 */
import type { ComponentType } from 'preact';
import type { BgmId } from '../audio';
import type { BackdropTone } from '../fx/backdrop';
import type { SceneName, SceneProps } from './router';
import { TitleScene } from '../scenes/Title';

declare const __JANEDOE_EMBEDDED__: boolean | undefined;
/**
 * Online versus needs the server (room store): compiled out of the static build, where the
 * scene name falls back to the title (a stale #/versus link lands there).
 */
const VERSUS_BUILD = typeof __JANEDOE_EMBEDDED__ !== 'undefined' ? !__JANEDOE_EMBEDDED__ : true;

export interface SceneDef {
  label: string;
  load: () => Promise<ComponentType<SceneProps>>;
  /** Default BGM on enter. undefined = leave as is. */
  bgm?: BgmId | 'none';
  backdrop?: BackdropTone;
}

export const SCENES: Record<SceneName, SceneDef> = {
  title: { label: 'タイトル', load: async () => TitleScene, bgm: 'title', backdrop: 'formalin' },
  prologue: { label: 'プロローグ', load: () => import('../scenes/Prologue').then((m) => m.PrologueScene), backdrop: 'dim' },
  files: { label: '事件ファイル', load: () => import('../scenes/Files').then((m) => m.FilesScene), bgm: 'title', backdrop: 'formalin' },
  intro: { label: '事件の導入', load: () => import('../scenes/Intro').then((m) => m.IntroScene), bgm: 'investigation', backdrop: 'dim' },
  investigation: { label: '捜査', load: () => import('../scenes/Investigation').then((m) => m.InvestigationScene), bgm: 'investigation', backdrop: 'formalin' },
  inquest: { label: '死因審問', load: () => import('../scenes/Inquest').then((m) => m.InquestScene), bgm: 'inquest', backdrop: 'alarm' },
  resolution: { label: '身元回復', load: () => import('../scenes/Resolution').then((m) => m.ResolutionScene), bgm: 'truth', backdrop: 'truth' },
  science: { label: '科学解剖', load: () => import('../scenes/Science').then((m) => m.ScienceScene), bgm: 'science', backdrop: 'cyan' },
  quiz: { label: '記憶の定着', load: () => import('../scenes/Quiz').then((m) => m.QuizScene), bgm: 'science', backdrop: 'cyan' },
  result: { label: 'CASE COMPLETE', load: () => import('../scenes/Result').then((m) => m.ResultScene), bgm: 'truth', backdrop: 'formalin' },
  versus: VERSUS_BUILD
    ? { label: '対戦', load: () => import('../scenes/Versus').then((m) => m.VersusScene), bgm: 'inquest', backdrop: 'alarm' }
    : { label: 'タイトル', load: async () => TitleScene, bgm: 'title', backdrop: 'formalin' },
};
