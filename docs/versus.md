# オンライン対戦（VERSUS）

2026-09-27 追加。くられ先生の提案「同時プレイに対応して、どちらが先に答えにたどり着くかを競えると、実況者にも受けが良い」から。
持ち主の選択は**オンライン**: それぞれの端末で部屋コードを共有し、同じ事件を同じ瞬間に始め、相手の進み具合を見ながら、**死因宣告を先に通した人が勝ち**。実況者のコラボ配信を想定している。

- 使えるのは **API のある版**（Cloudflare 版・Vercel 版）だけ。静的版（`build:static`）には対戦のコードも入口も入らない（§8）。
- **Cloudflare 版 https://litmus.fourthplace43.com/ で動いている**（2026-09-28〜。部屋は Cloudflare D1。`docs/DEPLOY.md` §3）。
- Vercel で使うには **Upstash Redis をつなぐ必要がある**（`docs/DEPLOY.md` §1-6）。未接続なので Vercel 版（janedoe-mauve.vercel.app）には対戦が出ない（タイトルに項目が出ない）。`npm run dev` ではメモリで動く。

---

## 1. 遊び方（画面）

```
タイトル「対戦」 → 名前 → 部屋を作る（事件・難易度） / 部屋に入る（6文字のコード）
  → ロビー（大きな部屋コード・コピー・招待リンク・配信用にコードを隠す・参加者2〜4人）
  → ホストが「審問を開始」 → 3・2・1（全員の画面がサーバーの時刻に合わせて同時に数える）
  → 捜査から始まる（導入は飛ばす。全員が同じ瞬間に質問を始める）＋ 画面上端の VERSUS HUD
  → だれかの死因宣告が通る → 全員にカットイン「〇〇が先に真相にたどり着いた！」（本人は「勝利！」）
  → そのまま続けてよい（解けた順に2位・3位…）。灯が尽きたら「脱落」（観戦できる）
  → 対戦結果（順位・タイム・質問数）
```

- **VERSUS HUD**（`src/features/versus/Hud.tsx`）: 事件の場面の上端に細い帯。左に「VS」と経過時間（勝者が出たら王冠と名前）、右に相手ごとの名前・解明度の棒・段階の印（虫眼鏡＝捜査／木槌＝審問／王冠＝解明／×＝脱落）・質問数。
  帯の高さだけ場面全体を下げる（`#app[data-vs-hud]` で `.scene-host` の top をずらす）ので、**ゲームの文字に重ならない**（PC 50px・スマホ 46px）。帯を押すと順位の一覧。
- **配信用にコードを隠す**: ロビーのスイッチ。画面のコードを ●●●●●● に伏せる（コピーはできる）。見る人ごとの設定（localStorage `janedoe:vs:hide`）。
- **招待リンク**: `…/#/versus?join=ABC234` を開くとコードが入った状態で「部屋に入る」が先に出る。
- **名前**は 1〜12 文字。制御文字・書式文字（右から左の上書き・ゼロ幅など）・見えない文字は取り除く。同じ名前は「名前2」にする。名前はほかの参加者にだけ見える（サーバーの部屋データに3時間）。
- **再読み込み**: 同じタブなら部屋に戻れる（sessionStorage）。対戦の途中の記録（質問ログ・所見）もタブごとに保存し、再読み込みで続きから。**別のタブ・閉じたタブからは戻れない**（仕様の「sessionStorage から」）。
- 部屋を出る: ロビーでは枠が空く（ホストが出ると部屋が閉じる）。開始後は「退出」と順位表に残る。確認の小窓あり。
- タイトルに戻ると、対戦の記録は一旦しまわれる（§4）。タイトルの「対戦に戻る」→「捜査に戻る」で再開。

## 2. 仕組み（全体）

```
ブラウザ（http 版だけ）                         サーバー（dev: vite プラグイン / Vercel: api/router.ts / Cloudflare: server/cloudflare/worker.ts → 同じ handler）
 src/scenes/Versus        画面                   server/http/versus-routes.ts   /api/versus/*（zod で入力検査・レート制限）
 src/features/versus/                            server/versus/service.ts       VersusService（部屋の規則・勝敗・派生した進み具合）
   client.ts   fetch                             server/versus/store.ts         RoomStore（メモリ）
   session.ts  部屋・ポーリング・時計補正・告知   server/versus/upstash.ts       RoomStore（Upstash Redis REST, fetch だけ）
                                                 server/versus/d1.ts            RoomStore（Cloudflare D1）
   slot.ts     セーブの差し替え（§4）            server/engine/room-binding.ts  トークンの部屋の結びつけ
   Hud.tsx     VERSUS HUD                        server/engine/token.ts         ペイロードに省略可能な `vs`
   Standings   順位表                            server/engine/game.ts          部屋の難易度の宣告形式を強制
 src/state/runMode.ts  事件の場面が見る汎用の口（§5）
```

- 各プレイヤーは**普通の事件の流れ**をそのまま遊ぶ。違うのは、使う進行トークンが**部屋に結びついた**トークンであることだけ。
- サーバーは「だれがどこまで進んだか」を**署名つきトークンから計算する**（解明度 0..1、段階 捜査／審問／解明、質問数）。ブラウザの自己申告は使わない。ほかの人に見えるのはこの集計だけで、事件の中身やどの所見を持っているかは出ない。

## 3. API

すべて JSON。失敗は他の API と同じ `{ error: { code, message, retryable } }`（message は `shared/versus.ts` の `VERSUS_ERR`、画面が日本語に直す）。

| メソッド | パス | 本体 → 応答 | 備考 |
|---|---|---|---|
| GET | `/api/versus/config` | → `{enabled, minPlayers, maxPlayers, nameMax, countdownMs}` | 使えないときは `{enabled:false}`（タイトルは項目を出さない） |
| POST | `/api/versus/create` | `{caseId, difficulty, name, cid?}` → `{seat, room}` | `difficulty` は easy / normal / hard |
| POST | `/api/versus/join` | `{code, name, cid?}` → `{seat, room}` | 開始後は 409。満員 409。無い 404。閉じた 410 |
| POST | `/api/versus/start` | `{seat}` → `{room}` | ホストだけ（403）。2人未満は 409。`startAt = now + 3.5秒`（HSETNX なので二度押ししても動かない） |
| POST | `/api/versus/state` | `{seat}` → `{room}` | ポーリング。ロビー1秒・対戦中2秒・終了後5秒・タブが隠れていたら8秒、失敗は倍々で最大10秒 |
| POST | `/api/versus/run` | `{seat}` → `{token, progress, room}` | `startAt` の 0.4 秒前から。**部屋に結びついた**新しいトークン。脱落者は 403。1人6回まで（失くしたときの再発行。質問数と宣告回数は引き継ぐ） |
| POST | `/api/versus/progress` | `{seat, token}` → `{room}` | 最新のトークンを送る（1.5秒にまとめる。解決したら即時）。古いトークンで棒は戻らない |
| POST | `/api/versus/leave` | `{seat}` → `{ok}` | 何度呼んでもよい |
| POST | `/api/admin/versus-bind` | `{seat, token}` | **dev サーバーだけ**（本番は管理トークンがあっても 404）。mint したトークンを部屋に結びつける QA 用 |

- `room`（`VersusRoomView`）: `code, caseId, difficulty, status(lobby|countdown|playing|finished|closed), startAt, now, you, players[], winner?`。
  `players[]`: `name, host, you, online, stage, progress, asked, finishMs?, rank?, out?, left?`。`now` はサーバーの時刻で、ブラウザは往復時間の短い応答から時計のずれを直し、3・2・1 をそろえる。
- **seat**（席）= `<部屋コード>.<プレイヤーid>.<署名>`。`SESSION_SECRET` から作る HMAC（部屋ごとの nonce 入り）。プレイヤー id だけでは何もできない。本体で送る（URL には入れない）。
- **cid**: タブごとの乱数。応答が途中で失われて join を送り直しても、同じ席が返る。
- 部屋コード: `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（0・O・1・I・L なし）から6文字、偏りのない乱数。約 8.9億通り。
- レート制限（IP ごと・インスタンスごと）: 作成 6回/分・60回/日、入室 20回/分・300回/日（コードの総当たりも抑える）、ポーリング 240回/分、その他 120回/分・5000回/日。宣告は既存の 12回/分。
- 検証の失敗は 400（`invalid name` などは画面の日本語に対応）。本体 8KB の上限・本番の設定不備の 503 は他の POST と同じ。

## 4. 保存 — 対戦がひとりのセーブを壊さない仕組み（`src/features/versus/slot.ts`）

事件の場面はどれも `saveData.cases[caseId]` を読み書きする（`useCaseProgress`・`getCaseProgress`・`updateCase`・`completeCase`・直接の `saveData.value.cases[...]` が十数か所）。
場面を対戦用に書き換えるのはいちばん大きな変更になるので、**場面には手を入れず、保存の側で差し替える**方式にした:

1. 対戦が始まると、その事件の `cases[caseId]`（ひとりの進行）と `meta` を**しまい**（stash）、メモリの中だけ対戦用の `CaseProgress`（部屋のトークン・部屋の難易度・捜査から）に入れ替える。
2. その間、localStorage に書く内容は `setPersistFilter`（`src/state/save.ts` に足した小さな口）で**しまった元の内容**に差し替える。
   → 途中でタブが落ちても、再読み込みしても、**本物のセーブには対戦の記録が一度も書かれない**。
3. 対戦の記録はタブの sessionStorage（`janedoe:vs:run`）に写し、再読み込みで戻す（`main.tsx` が最初の描画の前に `features/versus/boot` を読む。対戦中のタブだけ）。
4. 事件の場面から離れたら（タイトル・事件ファイル・別の事件）、しまっていた内容をメモリに戻す。タイトルは描画の前に `caseRunMode.release()` を呼ぶ（「続きから」が対戦の記録を指さない）。
5. 結果画面の `completeCase`（最高ランク・クリア回数・名探偵度数 `bestPoints`・`gameOversAtClear`）は対戦用の写しに書かれ、写しと一緒に消える → **ひとりの最高ランク・記録・名探偵度数は変わらない**。
   チュートリアル（コーチマーク）は対戦中は出さない（メモリの `meta.tutorial` だけ done にし、保存されるのは元の値）。

QA（`npm run qa:versus`）で、対戦の前後・途中・再読み込み後に localStorage の該当事件が1バイトも変わらないこと、タイトルに戻るとメモリにも元の進行（トークン・ランク・度数）が戻ることを確かめている。

**セーブの項目は増やしていない**（`src/state/types.ts` は触っていない）。

## 5. 事件の場面との接点（`src/state/runMode.ts`）

場面側に対戦のコードは入れていない。代わりに汎用の `caseRunMode`（null ＝ いつものひとり遊び）を置き、対戦中だけ次を差し込む:

| 項目 | 使う場所 | 対戦での中身 |
|---|---|---|
| `newToken` | `caseData.freshToken`（`ensureToken`・トークン不良からのやり直し）、審問の読み込み | `/api/versus/run`（部屋に結びついたトークン） |
| `lockDifficulty` | `canChangeDifficulty`（メニュー・難易度の変更） | 部屋の難易度から変えられない |
| `gameOver` | `InquestSession.applyGameOver` → `'end'`、`GameOverOverlay` | やり直さずに「脱落」。ボタンは「観戦する」→ 対戦の画面 |
| `release` | タイトル | 対戦の記録をしまう |

## 6. 不正の防ぎ方

- **勝ちの条件**（`VersusService.record`）: トークンの署名が正しい（`SESSION_SECRET`）／事件が部屋の事件／トークンの `vs` が**この部屋のこの回（コード＋nonce）のこのプレイヤー**と一致／解決済みの印／**宣告の回数が部屋の難易度の灯の数以内**（見習い10・審問官3・教授3）。
  - `vs` はペイロードの省略可能な項目（`<コード>.<nonce>.<プレイヤーid>.<e|n|h>`）。サーバーが開始時（`run`）にだけ付け、以後のすべての操作は状態を引き継ぐので付いたまま（`game.ts` の ask でも念のため付け直す）。
  - ひとりで前に解いたトークン・別の部屋・同じコードの別の回・他人のトークン・署名の違うトークン → すべて拒否（テストあり）。
  - 以前のトークン（`vs` なし）は今までどおり有効。
- **宣告はサーバーが直接見る**: `/api/inquest/verdict` の応答のあと、HTTP 層が `observeVerdict` を呼ぶ。前後のトークンを比べて宣告回数が増えていれば部屋の `a:<枠>` を +1（HINCRBY）。灯の数に達したら**脱落**（`x:<枠>`）、解決なら**その場で勝敗を記録**。
  ブラウザが進み具合を送らなくても勝敗はサーバーで決まり、失敗を隠してトークンを取り直しても回数は残る（取り直したトークンにも回数を引き継ぐ。脱落者には発行しない）。
- **宣告の形式も部屋が決める**: 部屋に結びついたトークンは、部屋の難易度の形式（選択式／穴埋め／自由記述）でしか宣告できない（`game.ts` `checkRoomMode`、違えば 400）。途中で見習いに変えて選択式にする、はできない。
- **開始より前には何もできない**: 部屋のトークンは `startAt` の 0.4 秒前まで発行しない。タイムは開始時刻からサーバーが測る。
- **最初に解いた人が勝ち**: `win` を HSETNX（Redis では原子的。メモリの店は単一スレッド）。同時に届いても勝者は1人（テストで3人同時に送って確認）。順位は勝者が1位、残りは解いた時刻順。
- 見えるのは集計（解明度・段階・質問数・タイム）だけ。所見の id・事件の文章はどの応答にも入らない（テストで確認）。
- 席は HMAC 署名。部屋の nonce が入るので、期限切れのあと同じコードの部屋ができても古い席・古いトークンは使えない。
- 残る穴（割り切り）: 同じ事件をひとりで先に解いて答えを知っている人は速い（遊び方の範囲）。改造したブラウザは自分の進み具合を送らないことはできる（棒が進まないだけで、勝敗と脱落はサーバーが見ている）。

## 7. 部屋の保存（RoomStore）

新しい npm 依存は無し。`server/versus/store.ts` の小さな口（HGETALL / HSETNX / HSET / HDEL / HINCRBY、書き込みに TTL 付き）を3通りで実装:

- **メモリ**（`MemoryRoomStore`）: dev サーバー・テスト・`VERSUS_STORE=memory`（`vite preview` のような1プロセスのとき）。サーバーを再起動すると部屋は消える。
- **Upstash Redis**（`UpstashRoomStore`）: REST の `/pipeline` を fetch で呼ぶ。環境変数は `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`、または Vercel の連携が入れる `KV_REST_API_URL` + `KV_REST_API_TOKEN`。https 以外は使わない。トークンはログにも応答にも出さない。障害は 503（再試行可）。

- **Cloudflare D1**（`D1RoomStore`、`server/versus/d1.ts`、2026-09-28）: Cloudflare Worker の D1 バインディング `VERSUS_DB`（データベース `litmus-versus`）。表は `cloudflare/migrations/0001_init.sql`:
  `vs_keys(k, exp)`（部屋のキー1つ＝1行、期限はミリ秒）と `vs_fields(k, f, v)`（ハッシュの1項目＝1行）。Redis と同じ意味になるように:
  - **書き込み1回＝D1 の batch 1回**（D1 では batch が1つのトランザクション）。中身は「期限切れのキーを消す → 操作 → 期限を付け直す」。期限切れのキーへの書き込みは新しいハッシュから始まる（Redis と同じ）。
  - HSETNX は `INSERT … ON CONFLICT (k, f) DO NOTHING RETURNING 1`: 行が返ってきた1人だけが取れる（勝者 `win`・空き枠 `p:<枠>`・`start`・`meta`）。D1 は書き込みが1か所に集まるので、同時に届いても1人。
  - HINCRBY は `INSERT … ON CONFLICT DO UPDATE SET v = CAST(v AS INTEGER) + ? RETURNING v`（値は Redis と同じく文字列で持つ）。HDEL で項目が0になったキーは消える。
  - 期限切れの部屋は読んでも見えない。実際の削除は次の書き込みか、Worker の Cron（毎時17分）。
  - 障害は 503（再試行可）、理由はログだけ。
  - テスト: `tests/cloudflare/d1-store.test.ts`（メモリと D1 に同じ契約のテスト）、`tests/cloudflare/service-d1.test.ts`（§9 の service のテスト一式を D1 でもう一度）。SQL は Node 24 内蔵の SQLite（`node:sqlite`）で本物を流す（依存の追加なし）。
  - 目安: 4人・30分の対戦でポーリング約3,600回 × 約25行 ≈ 9万行の読み取り。Workers Paid の込み分（月250億行）に対してごくわずか。

選び方（`server/http/runtime.ts` `versusStoreFor`）: Upstash があればそれ → 無ければ D1（Cloudflare の `VERSUS_DB`）→ 無ければ dev はメモリ → 本番は**無効**（Vercel の関数・Workers のインスタンスどうしはメモリを共有しないので、メモリで動かすと部屋が見えたり消えたりする）。`VERSUS_ENABLED=false` で止められる。Vercel 上と Cloudflare 上では `VERSUS_STORE=memory` も無視する。

部屋 = ハッシュ1つ `jd:vs:<コード>`。項目:

| 項目 | 中身 | 書く人 |
|---|---|---|
| `meta` | `{v, code, nonce, caseId, difficulty, createdAt, host}` | 作成（HSETNX でコードの衝突を避ける） |
| `start` | 開始時刻 | ホスト（HSETNX） |
| `win` | `{id, at}` | 最初に解いた人（HSETNX） |
| `closed` | 閉じた時刻 | ホスト（ロビーで退出） |
| `p:<枠>` | `{id, name, at, c(cid のハッシュ)}` | 入室（空き枠を HSETNX で取り合う） |
| `g:<枠>` | 進み具合 `{p, st, q, at, t}` | その人のトークンからサーバーが計算 |
| `s:<枠>` | 最後に見えた時刻（8秒に1回まで） | その人のポーリング |
| `f:<枠>` / `x:<枠>` / `l:<枠>` | 解いた／脱落／退出の時刻 | HSETNX |
| `a:<枠>` / `k:<枠>` | 宣告回数／トークン発行回数 | HINCRBY |

**1人は自分の枠の項目しか書かない**ので、同時の更新で他人の値を上書きしない（1つの塊を読んで書き戻す方式は使っていない）。
部屋は**最後の書き込みから3時間**で消える（書き込みのたびに EXPIRE／D1 では `vs_keys.exp` を付け直す。どの書き込みも期限なしのキーを残さない）。作成から8時間を過ぎた部屋は使えない。

Upstash の無料枠（月 50万コマンド）の目安: 4人・30分の対戦で約5,000コマンド（ほぼポーリングの HGETALL。見えた時刻の書き込みは8秒に1回）。月100試合程度まで無料。

## 8. 静的版には入らない

`__JANEDOE_EMBEDDED__`（ビルド時の定数）で、`scenes.ts` の対戦の場面・タイトルの項目・`main.tsx` の再開処理を切り落とす。静的版で `#/versus` を開くとタイトルになる。
確認: `npm run build:static` のあと `grep -r "versus/\|janedoe:vs\|対戦" dist/` → 何も出ない（場面名の配列にある語 `versus` だけ残る）。
エンジン（`game.ts`・`token.ts`）には部屋の結びつけを読む数行が入るが、静的版では部屋のトークンが作られないので働かない。

## 9. 確かめ方

```
npx vitest run tests/versus          単体（部屋の一連・コードの文字・名前・席の署名・トークンの結びつけと偽造・同時の解決・脱落・
                                     進み具合の計算・入力検査・無効時・Upstash の REST の形（偽の Redis）・静的な判定）
npm run qa:versus                    実ブラウザ2台（PC 1440×900 ＋ スマホ 390×844）で対戦を通し、qa/versus/ に写真
npx vitest run tests/cloudflare      D1 の部屋（本物の SQL を node:sqlite で）・service 一式を D1 で・Worker 経由の作成→入室→開始→ポーリング→退出
npm run smoke:cf                     本番の Cloudflare 版に2クライアントで部屋を作って一通り（AI は使わない・無料）
```

`qa:versus` の流れ: ひとりの進行をセーブに置く → タイトルの「対戦」→ 作成（見習い）→ スマホが招待リンクで入室・API で2人追加して4人（5人目は満員）→ コードを隠す・コピー →
開始 → 3・2・1 → 両方が捜査＋HUD → スマホが本物の質問 → PC の HUD が追う → スマホを再読み込みしても続きから → PC が宣告（dev で結びつけた 'debated' トークン）→ サーバーが勝敗を記録 →
「勝利！」と「〇〇が先に真相にたどり着いた！」→ HUD の順位 → 2人が退出・スマホが2位 → 対戦結果 → ひとりの進行が保存にもメモリにも無傷 → スマホ退出（PC に「退出」）→
2部屋目（審問官）: 捜査の途中でタイトルへ直行（ひとりの進行は遊んだ時間まで無傷）→「対戦に戻る」→「捜査に戻る」で再開 →
API で2回外し、画面で最後の灯を外す → 脱落（観戦する）→ 観戦画面・相手の HUD に脱落 → 脱落者にトークンは出ない。
QA は自前の dev サーバーを **:5199** で立てる（`npm run qa` の :5198 と同時に動かせる）。

## 10. まだやっていないこと・割り切り

- 同じ部屋のホストの交代（ホストがロビーで抜けると部屋は閉じる）、キック、開始前の事件・難易度の変更。
- 閉じたタブからの復帰（sessionStorage のため）。
- 対戦中の「リアルタイム」はポーリング（2秒）。WebSocket は Vercel の関数では持てないので使っていない（Cloudflare なら Durable Objects で持てるが、今はポーリングのまま。D1 の読み取りはごく安い）。
- レート制限はインスタンスごとのメモリ（他の API と同じ）。本気の乱用対策は Vercel の Firewall／Cloudflare の WAF で `/api/versus/*` を絞る。
