# 公開の手順（DEPLOY）

このゲームは3つの形で公開しています。**答え（真相）を守れるのは API のある版（Cloudflare 版・Vercel 版）だけ**です。

| | Cloudflare 版（本番・正本） | Vercel 版（監修者向けに継続） | 静的版（体験版） |
|---|---|---|---|
| URL（2026-09-28） | **https://litmus.fourthplace43.com/** | https://janedoe-mauve.vercel.app/ | https://fourthplace43.com/games/litmus/ |
| 作り方 | `npm run deploy:cf`（§3） | `npm run build`（Vercel が自動で実行） | `npm run build:static`（§2） |
| 判定 | Jev（AI）＋失敗時は rules | Jev（AI）＋失敗時は rules | rules だけ（AI なし・無料） |
| 答えの秘密 | サーバーにだけ置く（守られる） | サーバーにだけ置く（守られる） | **ブラウザに全部入る（守られない）** |
| オンライン対戦 | **あり**（部屋は D1） | なし（Upstash 未接続。§1-6） | 入らない |
| 1日の費用上限 | 全インスタンスの合計（D1） | サーバー1台ごと（おおよそ） | — |
| 費用 | 1問 約0.045〜0.06円＋Workers Paid（既存の $5/月に含まれる範囲） | 1問 約0.045円＋Vercel の料金 | 0円 |
| 管理画面 | 入れていない（`ADMIN_TOKEN` 未設定） | 入れていない（同） | 入らない |

- 旧URL https://fourthplace43.com/games/janedoe/ は games/litmus/ への転送ページ（2026-09-28）。セーブ（localStorage）は同じサイト内なので引き継がれる。
- **セーブは URL（オリジン）ごと**: litmus.fourthplace43.com・janedoe-mauve.vercel.app・fourthplace43.com はそれぞれ別のセーブ。版を移ると最初からになる。
- 題名は『リトマス審問』。正式公開まで `VITE_OFFICIAL_RELEASE_ENABLED=false`（PREVIEW 表示・noindex）のまま。

---

## 1. Vercel 版

> 2026-09-28 から本番は Cloudflare 版（§3）。Vercel 版（https://janedoe-mauve.vercel.app/）は監修者が使っているので止めずに残す。

### 1-1. 最初の配備
どちらかの方法で。

**A. 画面から（おすすめ）**
1. このフォルダを GitHub の非公開リポジトリに push する（`.env.local` は `.gitignore` 済みで上がらない）。
2. vercel.com → Add New → Project → そのリポジトリを Import。
3. Framework Preset は「Other」のまま。ビルドの設定は `vercel.json` に書いてあるので変えない（`npm ci` → `npm run build` → `dist/`、API は `api/router.ts`）。
4. Deploy の前に、下の「環境変数」を Settings → Environment Variables に入れる。

**B. コマンドから**
```bash
npx vercel login
npx vercel link                 # プロジェクトを作る／選ぶ
npx vercel env add SESSION_SECRET production    # 値を聞かれるので貼る（以下の変数も同様）
npx vercel                      # プレビュー配備（URL が出る）
npx vercel --prod               # 本番配備
```
（`vercel` CLI はこのプロジェクトの依存には入れていません。`npx` がその場で取ってきます。）

### 1-2. 環境変数

| 変数 | 値 | 注意 |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter のキー（**本番専用に新しく作る**） | Sensitive にする。サーバーだけが読む |
| `SESSION_SECRET` | 32文字以上の乱数。作り方: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` | **必須**。無い・短い・例のままだと、トークンを使う API がすべて 503 で止まる（安全側）。**変えると全プレイヤーの途中データが無効**になる（事件のやり直しになる）ので、むやみに変えない |
| `PIPELINE_MODE` | `jev` | 既定と同じ。止めたいときは `rules`（無料） |
| `DAILY_COST_LIMIT_USD` | `1`〜`3` など | UTC の1日・**サーバー1台ごと**の上限。超えたらその台は rules に落ちる |
| `ADMIN_TOKEN` | 32文字以上の乱数（上と同じ作り方で別の値） | 本番の `admin.html` のパスワード。**ビルド時にも見える設定にする**（Vercel の既定どおりなら見える）。無いと管理画面はビルドに入らず、管理 API も 404 |
| `VITE_SITE_URL` | 公開URL（例 `https://janedoe.example.com/`） | SNS で共有したときの画像（OG）を絶対URLにする。正式公開では必須 |
| `VITE_OFFICIAL_RELEASE_ENABLED` | **`false`**（権利者の確認が取れるまで） | `true` で PREVIEW 表示と検索よけ（noindex）が外れる |
| `VITE_APP_TITLE` / `VITE_GAME_TITLE` / `VITE_SUBTITLE` / `VITE_COPYRIGHT_NOTICE` / `VITE_SITE_DESCRIPTION` | 画面と共有カードの題名・説明 | 名前を差し替えるときに使う。未設定なら「リトマス審問」 |
| `VITE_CONTACT_URL` | お問い合わせ先 | 変えたら `public/contact.html` のリンクも直す |
| `VITE_INCLUDE_ADMIN` | 通常は未設定 | `false` で管理画面をビルドから外す |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash をつなぐと自動で入る（§1-6） | オンライン対戦の部屋の置き場所。手で入れるなら `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` でも可。無ければ対戦は出ない |
| `VERSUS_ENABLED` | 通常は未設定 | `false` で対戦を止める |

- `VITE_` で始まる変数は**ビルドのときに画面へ焼き込まれる**ので、変えたら再デプロイが要る。それ以外（キー・鍵・モード・上限）はサーバーが読むので、変えたら再デプロイ（Redeploy）で反映。
- 秘密の値（キー・`SESSION_SECRET`・`ADMIN_TOKEN`）は `VITE_` を付けない。付けると画面に出てしまう。

### 1-3. 費用とアクセスの上限（必ず設定する）
- **OpenRouter 側の上限が本当の歯止め**: openrouter.ai → Keys → 本番用キーに Credit limit（例: 月 $5）を付ける。`DAILY_COST_LIMIT_USD` はサーバー1台ごとの見積もりで、Vercel は負荷に応じて台数を増やすので、合計は上限を超えうる。
- **連打の制限（レート制限）もサーバー1台ごとのメモリ**で数えている。本気の乱用対策は Vercel の Firewall（WAF）のレート制限ルールで `/api/*` を絞る（使えるかはプランによる。無ければ OpenRouter 側の上限が最後の歯止め）。
- 目安: 既定の設定で1問 約$0.0003。1日 $1 ≒ 3,300問。

### 1-4. 配備したら確かめること
1. `https://<URL>/api/health` が `{"ok":true,...}`（503 なら `SESSION_SECRET` を見直す）。
2. ゲームで1事件の最初の数問を訊く。返事に「簡易判定」の印が続くなら Jev に届いていない（キー・上限・OpenRouter の障害）。
3. `https://<URL>/admin.html` を開き `ADMIN_TOKEN` で入る → 概要で「実行モード jev」「秘密鍵 設定済み」「本日の費用」を確認。
4. スマホ実機で、タイトル → 捜査 → 審問 → 結果まで。
5. 共有カード: X・LINE・Facebook に URL を貼って画像と説明が出るか（`VITE_SITE_URL` が必要）。

### 1-5. 知っておくこと
- 関数は最大15秒・1GB・`content/**` を同梱（`vercel.json`）。事件を足したら再デプロイで反映。
- 事件開始時に Jev を「起こす」小さな呼び出しをしているが、Vercel は応答後の処理を止めることがあるので効かない場合がある（直すには `@vercel/functions` の追加が要る＝依存の追加なので持ち主の判断）。1問目だけ少し遅い・簡易判定になることがある。
- プレビュー配備は Vercel の Deployment Protection（ログインが必要）が既定。人に試してもらうときは共有リンクを発行するか、本番に出す。
- 判定の記録（どの質問にどう答えたか）は Vercel のログに1ターン1行で出る。個人を特定する情報は入れていない。安全フィルターに当たった質問の本文は記録しない。

### 1-6. オンライン対戦を使えるようにする（Upstash Redis をつなぐ）

対戦（`docs/versus.md`）は、部屋の情報を置く場所として **Upstash Redis** が要ります。つなぐまでは本番のタイトルに「対戦」は出ません（ほかの遊び方には影響なし）。
Vercel の関数はサーバーが何台にも分かれて動き、メモリを共有しないため、メモリだけで部屋を持つことはできません。

手順（Vercel の画面、5分ほど・無料）:
1. vercel.com でプロジェクト **`janedoe`** を開く → 上のタブ **Storage**（または **Marketplace**）。
2. **Create Database**（Marketplace では検索欄に「Upstash」）→ **Upstash for Redis** を選ぶ → **Continue**。
3. プランは **Free**（月 50万コマンド・256MB・カード不要）。リージョンは Vercel の関数と同じ地域（例: 東京 `ap-northeast-1`）。名前は `janedoe-versus` など。→ **Create**。
4. 「Connect Project」でプロジェクト **`janedoe`** を選び、環境は **Production と Preview** にチェック → **Connect**。
5. **Settings → Environment Variables** に次が自動で入ったことを確かめる（値は見ない・貼らない。秘密の値です）:
   `KV_REST_API_URL`・`KV_REST_API_TOKEN`（ほかに `KV_REST_API_READ_ONLY_TOKEN`・`KV_URL`・`REDIS_URL` が入ることもある。使うのは最初の2つだけ）。
   Upstash の画面で作った DB を手で入れる場合は、代わりに `UPSTASH_REDIS_REST_URL`・`UPSTASH_REDIS_REST_TOKEN` でも動きます。
6. **Deployments → 最新の配備の「…」→ Redeploy**（環境変数は再デプロイで反映）。
7. 確かめる: `https://<URL>/api/versus/config` が `{"enabled":true,...}`。タイトルに「対戦」が出る。PC とスマホで部屋を作って入れる。
   `{"enabled":false}` のままなら、5 の変数が Production に入っているか、`SESSION_SECRET` が設定済みか（未設定だと対戦も止まる）を見る。

- 止めたいときは `VERSUS_ENABLED=false` を入れて再デプロイ（Upstash はつないだままでよい）。
- 目安: 4人・30分の対戦1回で約5,000コマンド。無料枠で月100回ほど。超えそうなら Upstash の従量課金（10万コマンドあたり約 $0.2）に上げるか、Upstash の管理画面で上限を決める。部屋は最後の操作から3時間で自動で消える。
- 対戦の API にもインスタンスごとのレート制限がある（作成 6回/分・IP）。本気の乱用対策は Firewall で `/api/versus/*` を絞る。
- `SESSION_SECRET` を変えると、進行中の対戦の席とトークンも無効になる（部屋から入り直し）。

---

## 2. 静的版（fourthplace43.com/games/litmus/）

```bash
VITE_SITE_URL=https://fourthplace43.com/games/litmus/ npm run build:static
python C:/Users/sikas/.claude/skills/server-deploy/scripts/deploy.py --src dist --dest games/litmus --dry-run   # 送る中身の確認
python C:/Users/sikas/.claude/skills/server-deploy/scripts/deploy.py --src dist --dest games/litmus             # ConoHa の原稿置き場へ
cd /c/coding/workspace/01_active-projects/fourthplace43-cloudflare && bash scripts/publish.sh                # Cloudflare で公開
```
`dist/` の**中身**を、サーバーの `games/litmus/` フォルダにそのままアップロードします（どのフォルダでも動くよう `base: './'` にしてあります）。
fourthplace43.com は 2026-09-28 から Cloudflare 配信なので、ConoHa へ送ったあと**必ず `publish.sh`**（ConoHa の中身を取り直して Cloudflare へ deploy）。
`tar: file changed as we read it` で止まったら、別の作業が ConoHa を書き換え中。数分待ってやり直す。
確認は**ブラウザの User-Agent 付きの curl**で（Python の urllib は 403 になる）。

- 2026-09-28 に題名に合わせて `games/janedoe/` → `games/litmus/` へ移した。`games/janedoe/index.html` は転送ページ（JS で `#/…` と `?…` を付けたまま移る＋meta refresh＋リンク）。古い `assets/` などは残っているが、どこからも読まれない。
- セーブは fourthplace43.com の localStorage（パスに関係なく同じ）なので、移転後もそのまま。

- **判定は rules だけ**（外部 AI を使わない・費用 0・キー不要）。正答率は Jev 版より低い（約73%、Jev 版 約91%）。
- **答えは守られない**: 事件データ（真相・想定質問・被害者の名前・正解の条件…）を JavaScript に同梱している。調べれば誰でも読める。オフラインのお試し版・展示用と割り切る。
- 管理画面は入らない。進行トークンの鍵もブラウザ内の固定値。
- **オンライン対戦は入らない**（サーバーが要るため。ビルド時に対戦のコードごと外れ、タイトルにも出ない）。
- `dist/index.html` をダブルクリックしても動かない（ブラウザの制限）。サーバーに置くか `npm run preview` で見る。
- 通常ビルド（`npm run build`）と同じ `dist/` を使うので、**最後にどちらのビルドをしたか**に注意（静的版を上げたいなら直前に `build:static`）。
- 公式の公開版は **Cloudflare 版**（答えを守れる・対戦あり）。静的版は体験版（`docs/decisions.md` 2026-09-28）。
- fourthplace43.com 全体に Cloudflare Web Analytics（自動挿入のビーコン）が効いているため、**静的版にもビーコンが入る**（プライバシーポリシーの「アクセス解析なし」と食い違う。§3-6）。

---

## 3. Cloudflare 版（https://litmus.fourthplace43.com/）

2026-09-28 に Vercel から移した AI 判定版の本番。Vercel のプロジェクトはそのまま動いている（§3-7）。

### 3-1. 構成

```
ブラウザ ─→ Worker「litmus-shinmon」（独自ドメイン litmus.fourthplace43.com、Workers Paid）
              ├─ 静的ファイル（dist/、Workers Static Assets）… Worker を起動せずに Cloudflare が返す（無料・無制限）
              │    知らないパスは index.html（SPA）。応答ヘッダーは cloudflare/_headers（vercel.json と同じ CSP など）
              └─ /api, /api/* だけ Worker（server/cloudflare/worker.ts）
                   └─ server/http/handler.ts（Vercel・開発サーバーと同じ）
                        ├─ 事件データ: server/cloudflare/content.generated.ts（content/** を JSON import でビルド時に同梱。Workers に fs は無い）
                        ├─ オンライン対戦の部屋: D1「litmus-versus」（binding VERSUS_DB、server/versus/d1.ts）
                        ├─ 1日の AI 費用の合計: 同じ D1 の budget_daily（server/cloudflare/budget-d1.ts）
                        └─ 質問・宣告の IP ごとの上限: Rate Limiting binding AI_RATE_LIMITER（40回/60秒）
Cron（毎時17分）: 期限切れの部屋と62日より古い費用の行を消す
```

- 設定はすべて `wrangler.jsonc`（プロジェクト直下）。`workers_dev` と `preview_urls` は閉じている（独自ドメインだけ）。
- wrangler はプロジェクトの依存に入れていない（`npx --yes wrangler@4 …`）。この PC はログイン済み（`npx wrangler@4 whoami`）。
- Codex（開発用の LLM）が使う Node の組み込みモジュールは `server/cloudflare/node-stub.ts` に差し替えて束ねる（`nodejs_compat` 不要）。
- 部屋の置き場所の選び方: Upstash の環境変数があれば Upstash → 無ければ D1（VERSUS_DB）→ 開発サーバーはメモリ → どれも無ければ対戦なし。Worker ではメモリは使わない（`VERSUS_STORE=memory` も無視）。
- クライアントの IP は `CF-Connecting-IP`。利用者が送れる `X-Forwarded-For` などは Worker が捨ててから共通の処理に渡す（レート制限のすり抜け防止）。

### 3-2. 配備・更新（ほかのブランチを取り込んだあとも同じ）

```bash
cd /c/coding/workspace/GameCreate/projects/janedoe   # master（ブランチを取り込んだあと）の作業ツリー。リモートは無い
npm ci                                    # 依存が変わったとき
npm run deploy:cf                         # 事件データの埋め込み → http ビルド → _headers → D1 マイグレーション → wrangler deploy
npm run smoke:cf                          # 確認（無料）: 画面・ヘッダー・API・対戦を2クライアントで一通り
npm run smoke:cf -- --ask --browser       # ＋ Jev に1問（約 $0.0004）＋ 見えない Chromium でコンソールエラー 0
```

- `deploy:cf` のビルド設定: `VITE_SITE_URL=https://litmus.fourthplace43.com/`・`VITE_OFFICIAL_RELEASE_ENABLED=false`・`VITE_API_MODE=http`・`VITE_INCLUDE_ADMIN=false`（環境変数で上書き可）。別の URL で作った `dist/` や静的版の `dist/` は上げない（スクリプトが確かめて止まる）。
- 事件を足した・消したとき: `deploy:cf` が `server/cloudflare/content.generated.ts` を作り直す。**作り直したファイルも commit する**（`tests/cloudflare/worker.test.ts` が内容のずれで失敗する。単独で作るなら `npm run cf:content`）。
- 束ねた大きさだけ見る: `npm run deploy:cf -- --dry-run`（アップロードしない。`dist-worker/` に出る）。
- ログ: `npx wrangler@4 tail litmus-shinmon`（1問1行の判定記録 `{"type":"turn",…,"mode":"jev","costUsd":…}`。個人を特定する情報は入れていない）。ダッシュボードの Workers → litmus-shinmon → Logs でも見られる。
- 新しく足した独自ドメインは、手元の DNS がしばらく「無い」と覚えていることがある。`smoke:cf` は Cloudflare の DNS で引き直して確かめる（curl なら `--resolve litmus.fourthplace43.com:443:<IP>`）。

### 3-3. シークレットと変数

| 名前 | 種類 | 値 | 注意 |
|---|---|---|---|
| `SESSION_SECRET` | secret | 32バイトの乱数（2026-09-28 に作って直接登録。**どこにも控えていない**） | Vercel とは別の値。変えると Cloudflare 版の途中データと対戦の席が無効 |
| `OPENROUTER_API_KEY` | secret | OpenRouter のキー（2026-09-28 は開発機の環境変数のキーを登録） | §3-6 の「専用キー」を推奨 |
| `APP_ENV` / `PIPELINE_MODE` / `DAILY_COST_LIMIT_USD` | var（`wrangler.jsonc`） | `production` / `jev` / `1` | 変えたら `npm run deploy:cf` |
| `ADMIN_TOKEN` | secret（任意） | 未設定 | Vercel と同じく管理 API は閉じている（404） |
| `VERSUS_ENABLED` | var（任意） | 未設定 | `false` で対戦を止める |

値は画面にもログにも出さない。登録は標準入力から:
```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler@4 secret put SESSION_SECRET
printf '%s' "$OPENROUTER_API_KEY" | npx wrangler@4 secret put OPENROUTER_API_KEY
npx wrangler@4 secret list          # 名前だけ出る
```
- var はダッシュボードで変えても次の `deploy:cf` で `wrangler.jsonc` の値に戻る。secret は deploy で消えない。
- `SESSION_SECRET` が無い・短いと、Vercel と同じく進行トークンを使う API はすべて 503、`/api/versus/config` は `enabled:false`（安全側）。

### 3-4. D1「litmus-versus」

- 2026-09-28 作成、場所 APAC（`npx wrangler@4 d1 create litmus-versus --location apac`）。id は `wrangler.jsonc`。
- 表は `cloudflare/migrations/0001_init.sql`（テストも同じ SQL を Node 内蔵の SQLite で流す）。`deploy:cf` が毎回 `d1 migrations apply litmus-versus --remote` を実行（済みなら何もしない）。
  - `vs_keys`（部屋のキーと期限）・`vs_fields`（部屋のハッシュの1項目＝1行）: Redis と同じ意味の RoomStore。勝者の記録は `INSERT … ON CONFLICT DO NOTHING RETURNING` で1人だけが取れる（`docs/versus.md` §7）。部屋は最後の書き込みから3時間で見えなくなり、Cron が消す。
  - `budget_daily`（UTC の日ごとの AI 費用と回数）: `DAILY_COST_LIMIT_USD` を全インスタンスの合計で効かせる。各インスタンスは AI を呼ぶ前に15秒に1回まで読み直し、応答のあとに足し込む（`ctx.waitUntil`）。同時に大勢が来ると15秒ぶんほど上限を超えうる。**本当の歯止めは OpenRouter のキーの上限**。
- 中を見る:
```bash
npx wrangler@4 d1 execute litmus-versus --remote --command "SELECT * FROM budget_daily ORDER BY day DESC LIMIT 7"
npx wrangler@4 d1 execute litmus-versus --remote --command "SELECT COUNT(*) FROM vs_keys"
```

### 3-5. Workers の制限と費用（2026-09-28 の実測）

| 項目 | 実測 | 上限・料金（Workers Paid） |
|---|---|---|
| Worker の大きさ | 2.4MB（gzip 445KB）。大半は事件データ（JSON が文字エスケープされるので1件 約0.5MB） | gzip 10MB まで → 事件は数十件まで余裕 |
| 起動時間 | 24〜29ms | 1秒まで。事件データの検査（zod）は最初のリクエストで1回だけ |
| CPU 時間 | 1リクエスト数ms〜数十ms（AI の返事を待つ時間は数えない） | 既定 30秒（`limits.cpu_ms`） |
| 静的ファイル | 565ファイル・約21MB、最大 1.3MB（og.png） | 1ファイル 25MiB・1版 2万ファイルまで。**静的ファイルへのアクセスは無料・無制限** |
| Worker の呼び出し | `/api` だけ。1問＝1回、対戦のポーリング＝1〜2秒に1回 | 月1,000万回まで込み、超過 $0.30/100万回 |
| D1 | 対戦4人30分 ≈ 3,600回の読み取り × 約25行 ≈ 9万行 | 読み取り 月250億行・書き込み 月5,000万行・5GB まで込み |
| ログ（observability） | 1問1行 | 月2,000万件まで込み |
| Rate Limiting binding・Cron | — | 追加料金なし |

- AI の費用は別（OpenRouter）。Jev 1問 約 $0.0003〜0.0004、決まった言い回しの質問は AI を呼ばない（無料）。上限 `DAILY_COST_LIMIT_USD=1`（1日 約2,500〜3,300問）を超えると rules に落ちる。
- Workers はモジュールの読み込み時（グローバルスコープ）に乱数を作れない。`server/engine/env.ts`・`server/http/handler.ts` の鍵は最初の利用時に作る（`tests/cloudflare/worker.test.ts` が見張る）。
- アプリ内のレート制限（`server/http/rate-limit.ts`）は Vercel と同じくインスタンスごとのメモリ。質問・宣告だけは Rate Limiting binding（拠点ごと・IP ごと 40回/分）を前に置いた。
- 事件開始時に Jev を「起こす」呼び出しは、応答のあとに打ち切られることがある（Vercel と同じ。1問目だけ少し遅いことがある）。

### 3-6. 持ち主がダッシュボードでやること

- **必須はなし**（ドメイン・証明書・DNS・D1・シークレット・Cron は設定済み）。
- **推奨**: OpenRouter で Cloudflare 版専用のキーを作り、Credit limit（例: 月 $5）を付けて `printf '%s' '<新しいキー>' | npx wrangler@4 secret put OPENROUTER_API_KEY` で差し替える（今は開発機のキー。使い道ごとに止められるようにする）。
- **確認**: Cloudflare Web Analytics の自動挿入（ゾーン全体）。litmus では `Cache-Control: no-transform` で入らないようにした（CSP が外部スクリプトを止め、プライバシーポリシーも「アクセス解析なし」のため）。**fourthplace43.com/games/litmus/（静的版）には入っている** → ポリシーを直すか、Web Analytics の設定で `/games/` を除く。
- 任意: セキュリティ → WAF のレート制限ルールで `litmus.fourthplace43.com/api/*` を絞る（本気の乱用対策）。

### 3-7. Vercel に戻す（ロールバック）

- Vercel のプロジェクト `janedoe` は触っていない。https://janedoe-mauve.vercel.app/ は今も同じ版で動いている（対戦なし）。
- Cloudflare 版の直前の版に戻す: `npx wrangler@4 deployments list` → `npx wrangler@4 rollback`（コードと静的ファイル。D1 の中身は戻らない）。
- AI だけ止める: `wrangler.jsonc` の `PIPELINE_MODE` を `rules` にして `npm run deploy:cf`（費用 0）。
- 独自ドメインを Vercel に向ける: ① Cloudflare の Workers → litmus-shinmon → Settings → Domains & Routes で litmus.fourthplace43.com を外す ② Vercel → janedoe → Settings → Domains に litmus.fourthplace43.com を足す ③ Cloudflare の DNS に Vercel の指示どおりの CNAME（プロキシなし・灰色の雲）④ Vercel で `VITE_SITE_URL=https://litmus.fourthplace43.com/` にして再デプロイ。同じオリジンなのでセーブは残る。Vercel 版には対戦が無い（Upstash をつなぐまで）。
- Cloudflare 版をやめるなら、最後に Worker `litmus-shinmon` と D1 `litmus-versus` を削除（元に戻せない。持ち主の判断）。

---

## 4. 公開前チェックリスト

**権利・表示**
- [x] 題名を「ジェーンドゥの死因」から『リトマス審問』に変更（2026-09-26。元の名前は薬理凶室さんの企画と重なるため）。
- [ ] 作中の呼び名「ジェーン・ドゥ」を変えるか、くられ先生に確認する。
- [ ] 確認が取れたら `VITE_OFFICIAL_RELEASE_ENABLED=true` と `VITE_SITE_URL` を入れて再デプロイ（`true` なのに URL が無いとビルドが止まる＝仕様）。
- [ ] 画像の出どころ（`art-src/CREDITS.md`）と、他作品に似すぎていないかを人の目で最終確認。

**内容**
- [ ] 3事件の科学解説を**人の専門家**（医師・法医学・化学の分かる人）に読んでもらう。済んだら事件ごとに `reviewStatus` を `human-reviewed` に（画面の「専門家確認前の下書き」が消える）。
- [ ] 人間のプレイテスト（最低 3〜5人、PC とスマホ）。詰まり・ヒントの使われ方・審問2ラウンド目の「泣きつき」率を見る。
- [ ] 安全: 自傷や死に方の質問に相談窓口カードが出ることを本番で1回確かめる。

**法務・プライバシー**
- [ ] `public/privacy.html`（プライバシーポリシー）と `public/terms.html`（利用規約）を持ち主が読み、実態と合っているか確認する。特に: 外部AI（OpenRouter 経由の Jev）へ質問文を送ること／記録の保存期間「90日以内」と Vercel のログ保持の設定／静的版は外部送信なし。
- [ ] お問い合わせ先（`public/contact.html`・`VITE_CONTACT_URL`）が生きているか。

**技術**
- [ ] 検証のひとそろいが全部通る: `npx tsc --noEmit && npx vitest run && npm run validate && npx vite build && npm run qa -- --case all && npm run qa:mobile -- --case all`
- [ ] `SESSION_SECRET`・`ADMIN_TOKEN` が32文字以上の乱数で、開発用と別の値。
- [ ] OpenRouter の本番キーに Credit limit、`DAILY_COST_LIMIT_USD` を決める、Vercel の Firewall で `/api/*` にレート制限（Cloudflare 版は §3-6）。
- [ ] `/api/health` が 200。管理画面の概要に警告が無い。Cloudflare 版は `npm run smoke:cf -- --ask --browser` が全部 ok。
- [ ] 共有カード（OG 画像 `og.jpg`・題名・説明）を X・LINE で確認。
- [ ] 実機（iPhone Safari・Android Chrome）で最後まで遊べる。音が出る。文字が読める。
