/**
 * PLACEHOLDER — the engine builder replaces this file with the real client selection
 * (http vs embedded, based on APP_CONFIG.API_MODE). UI code must only ever import
 * `api` from here and program against the `GameApi` interface.
 */
import type { GameApi, CaseSummary } from '../../shared/api';
import { ApiError } from '../../shared/api';

const MOCK_CASES: CaseSummary[] = [
  { id: 'c01-room-without-breath', number: 1, title: '息のない部屋', titleEn: 'THE ROOM WITHOUT BREATH', difficulty: 1, categories: ['化学', '生理学'], estimatedMinutes: 15, summary: '深夜の大学棟の地下で、若い研究者が眠るように死んでいた。外傷はなく、争った跡もない。彼女はなぜ死んだのか？', codename: 'ジェーン・ドゥ #01', background: 'cases/c01/bg.webp', accent: '#3DE0FF', portrait: 'cases/c01/portrait.webp' },
  { id: 'c02-ball-at-dusk', number: 2, title: '夕暮れの白球', titleEn: 'THE BALL AT DUSK', difficulty: 2, categories: ['物理', '生理学'], estimatedMinutes: 20, summary: '夏の夕方、河川敷でキャッチボールをしていた少女が突然倒れた。目立った傷はない。彼女はなぜ死んだのか？', codename: 'ジェーン・ドゥ #02', background: 'cases/c02/bg.webp', accent: '#FFB020', portrait: 'cases/c02/portrait.webp' },
  { id: 'c03-shed-in-snow', number: 3, title: '雪に脱ぎ捨てたもの', titleEn: 'WHAT SHE SHED IN THE SNOW', difficulty: 3, categories: ['生理学', '法医学'], estimatedMinutes: 25, summary: '冬山の岩陰で、薄着の女性が見つかった。周りの雪には上着や手袋が点々と落ちていた。彼女はなぜ死んだのか？', codename: 'ジェーン・ドゥ #03', background: 'cases/c03/bg.webp', accent: '#C6FF3D', portrait: 'cases/c03/portrait.webp' },
];

const notReady = () => Promise.reject(new ApiError('server', 'engine not wired yet', false));

export const api: GameApi = {
  listCases: async () => MOCK_CASES,
  getCase: notReady,
  newToken: notReady,
  ask: notReady,
  hint: notReady,
  inquestStart: notReady,
  shot: notReady,
  grant: notReady,
  verdict: notReady,
  reconstruction: notReady,
  submitReconstruction: notReady,
  solution: notReady,
};
