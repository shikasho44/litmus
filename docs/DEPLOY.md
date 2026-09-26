# 公開の手順（DEPLOY）

このゲームは2つの形で公開できます。**答え（真相）を守れるのは Vercel 版だけ**です。

| | Vercel 版（おすすめ・本番） | 静的版（オフライン版） |
|---|---|---|
| 作り方 | `npm run build`（Vercel が自動で実行） | `npm run build:static` |
| 判定 | Jev（AI）＋失敗時は rules | rules だけ（AI なし・無料） |
| 答えの秘密 | サーバーにだけ置く（守られる） | **ブラウザに全部入る（守られない）** |
| 費用 | 1問 約0.045円＋Vercel の料金 | 0円（置き場所の料金だけ） |
| 管理画面 | `ADMIN_TOKEN` を入れたときだけ | 入らない |

> 2026-09-25 時点で、どちらもまだ**配備していません**。以下は手順書です。

---

## 1. Vercel 版

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

---

## 2. 静的版（fourthplace43.com/games/janedoe/ など）

```bash
npm run build:static
```
`dist/` の**中身**を、サーバーの `games/janedoe/` フォルダにそのままアップロードします（どのフォルダでも動くよう `base: './'` にしてあります）。
アップロードは、いつものサーバーへの手順（SSH／ファイルマネージャー）で。

- **判定は rules だけ**（外部 AI を使わない・費用 0・キー不要）。正答率は Jev 版より低い（約73%、Jev 版 約91%）。
- **答えは守られない**: 事件データ（真相・想定質問・被害者の名前・正解の条件…）を JavaScript に同梱している。調べれば誰でも読める。オフラインのお試し版・展示用と割り切る。
- 管理画面は入らない。進行トークンの鍵もブラウザ内の固定値。
- `dist/index.html` をダブルクリックしても動かない（ブラウザの制限）。サーバーに置くか `npm run preview` で見る。
- 通常ビルド（`npm run build`）と同じ `dist/` を使うので、**最後にどちらのビルドをしたか**に注意（静的版を上げたいなら直前に `build:static`）。
- どちらを「公式の公開版」にするかは未決定（`docs/decisions.md` 2026-09-25）。答えを守る必要があるので、提案は **Vercel 版を公式、静的版は体験版**。

---

## 3. 公開前チェックリスト

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
- [ ] OpenRouter の本番キーに Credit limit、`DAILY_COST_LIMIT_USD` を決める、Vercel の Firewall で `/api/*` にレート制限。
- [ ] `/api/health` が 200。管理画面の概要に警告が無い。
- [ ] 共有カード（OG 画像 `og.jpg`・題名・説明）を X・LINE で確認。
- [ ] 実機（iPhone Safari・Android Chrome）で最後まで遊べる。音が出る。文字が読める。
