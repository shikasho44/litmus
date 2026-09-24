# 管理コンソール（admin.html）

事件データの検査結果・判定の中身（トレース）・ベンチ結果・進行トークンを、ブラウザで見るための開発者向けページ。
プレイヤーには見せない。事件の**秘密（真相・全所見・想定質問・漏洩語）をすべて表示する**ので、本番では必ず `ADMIN_TOKEN` で守る。

- 入口: `admin.html` → `src/admin/main.tsx`（Preact。ゲームと同じ色・書体トークン `src/styles/tokens.css` を使う）
- 使う API: `/api/health`（公開）と `/api/admin/*`（管理者のみ。`docs/engine.md` §5）
- エンジンのコードは同梱しない（型だけ参照）。画面が持つ秘密は、管理 API が返したものだけ。

---

## 1. 開き方

### 開発（`npm run dev`）
```
npm run dev
→ http://127.0.0.1:5190/admin.html
```
dev サーバーでは管理 API が常に開いているので、トークン入力なしでそのまま使える。
`vite preview`（本番相当）は `npm run preview` → `http://127.0.0.1:4191/admin.html`（**4190 はブラウザが拒否する番号なので 4191 に変更**）。
preview は `dist/` をそのまま配信するので、admin.html を入れてビルドしておく（下の「ビルドに含める条件」。例: `VITE_INCLUDE_ADMIN=true npm run build`）。

### 本番（Vercel）
1. Vercel の Project Settings → Environment Variables に `ADMIN_TOKEN`（長いランダム文字列）を入れて再デプロイ（**ビルド時にも見える設定にする**。Vercel の既定どおりなら見える）。
2. `https://<ドメイン>/admin.html` を開く → 「ADMIN_TOKEN」欄に入力 → 接続。
3. トークンは**このタブの `sessionStorage` にだけ**保存され（タブを閉じると消える）、各リクエストの `x-admin-token` ヘッダーで送る。URL には載せない。左下「トークンを消す」で即削除。

- `ADMIN_TOKEN` が未設定の本番、またはトークン違いのときは、管理 API が 404 を返す（存在を隠す）。画面は「トークンが違うか、管理 API が無効」と表示する。
- `admin.html` には `noindex` を固定で付けている。

#### ビルドに含める条件（`vite.config.ts`）
管理画面の JS には管理 API の道筋と項目名が入るので、**使えない配備には置かない**。

| ビルド | admin.html / `assets/admin-*.js` |
|---|---|
| 静的版（`npm run build:static`、embedded） | 常に含めない（API が無い）。dev の `npm run dev:static` で開いても接続エラーの画面になる |
| http 版で `VITE_INCLUDE_ADMIN=true`（または `1`） | 含める |
| http 版で `VITE_INCLUDE_ADMIN=false`（または `0`） | 含めない（`ADMIN_TOKEN` があっても。管理画面を別プロジェクトで配る場合など） |
| http 版で `VITE_INCLUDE_ADMIN` 未設定 | **ビルド時に `ADMIN_TOKEN` があるときだけ**含める（無ければ本番の管理 API は 404 なので、画面を置いても使えない） |

- 判定は `.env*` とビルド時の環境変数（サーバーと同じ `loadEnv`）。`ADMIN_TOKEN` の値はバンドルに入らない（有無を見るだけ）。
- 含めないビルドでは `/admin.html` は 404（`vercel.json` の書き換えは拡張子つきの道を対象にしない）。
- dev サーバー（`npm run dev`）はこの設定に関係なく `admin.html` を配信する。
- サブフォルダ配備で API の場所が違うときは、ゲームと同じ `VITE_API_BASE` がそのまま効く。

---

## 2. 画面

左の縦メニュー（スマホでは上の横スクロールの帯。まだ隠れたタブがある側の端は薄れて消え、開いているタブは帯の中央に寄る。トークンで入った本番では帯の右端に「トークンを消す」の鍵アイコン）で切り替える。URL は `#/<セクション>/<引数>?…` なので、再読込やブックマークで同じ画面に戻れる。右上「再読込」で全データを取り直す。

### 概要 OVERVIEW
| 表示 | 中身 |
|---|---|
| 実行モード | 実際の `mode` と、要求した `PIPELINE_MODE`。部品が組めず**降格**していれば黄色で「要求 X から降格」 |
| 秘密鍵 | `SESSION_SECRET` が設定済みか（本番で未設定なら赤: トークンを偽造できる） |
| 本日の費用 | UTC 日ごとの使用額 / `DAILY_COST_LIMIT_USD`、消化率バー、有料呼び出し回数、超過中か（超過中は rules に退避） |
| 事件 | 読み込めた事件数と読込エラー数（`/api/health`） |
| 稼働時間 | サーバー（インスタンス）の起動からの時間、API 版、development / production |
| 警告 | factory・runtime が出した警告（キー無しで降格、秘密鍵未設定 など） |
| 判定パイプライン | 判定プロバイダ・Jev モデル・LLM プロバイダ／モデル・OpenRouter キーの有無・レート制限の追跡キー数 |
| 事件データの検査 | 事件ごとの公開・確認状態・所見数・想定質問数・エラー/警告数・**rules 自己一致率**（基準 95%）・汎化率（1問抜き）。行クリックで事件へ |
| 読込時の問題 | 壊れてスキップされた事件、台詞バンク・プロローグの問題 |

### 事件データ CASES
上のカードで事件を選ぶ（NG なら赤）。見出しに難易度・分野・所要・公開・確認状態・自己一致率。
「この事件で質問テスト」で質問テストへ移る。タブ:

| タブ | 中身 |
|---|---|
| 検査 | `validateParsedCase` の結果（エラー・警告・情報）、想定質問の種類の数（必須の種類が 0 なら赤）、**自己一致の外れ**と**1問抜きの外れ**の表（正解ラベル / rules の答え / 判定元 / 類似度、「試す」で質問テストへ） |
| 所見 | 全所見の表。カード名・本文・分類・重要度（■4段）・spoilerLevel・ifAsked・前提・キーワード・科学メモ・判定メモ・その所見に触れる想定質問の数（0 は黄色）。本文/キーワード検索、分類・重要度・ネタバレ度で絞り込み。核心（重要度 3 以上）は左に赤線 |
| 想定質問 | 全想定質問。種類・正解・所見で絞り込み、「外れのみ」。正解ラベルの分布ボタン。各行に rules の自己一致（✓ / ✗）と 1問抜きの外れ、「試す」 |
| 審問 | ラウンドごとの導入、発言（ノイズ `[[…]]` を黄色、正解の一撃を赤）、正解の所見・別解・ヒント・成功/失敗の台詞 |
| 再構成 | コマ（画像・番号・空白コマ）、キャプション、選択肢（正解に ✓）、画像生成ブリーフ、締めのナレーション |
| 真相・正解・ヒント | 真相（死因・要約・仕組み・被害者・時系列）、答えの要素（キーワード群・判定モデルへの命題・欠けたときの一言）と解決/惜しいの条件、誤った主張、ヒント Lv.1〜3 |
| 出典・漏洩語 | 出典（https でなければ赤）、`leakTerms`、科学メモとそれを開く所見 |

### 質問テスト ASK PLAYGROUND
`POST /api/admin/ask-debug` で本物のパイプラインに質問を通し、答えと**トレース全体**を見る。

- 入力: 事件 / mode の一時上書き（既定 = サーバーの mode。`rules` を選べば費用ゼロ）/ 質問（200字、Ctrl+Enter）/ 進行トークン（空 = 新規）。
  「発行して入れる」でステージを選んでトークンを作れる。「返ってきたトークンを次の質問に引き継ぐ」で続けて捜査できる。
- 候補チップ: 事件の `starterQuestions` と、核心・引っかけ・否定・誤字の想定質問。
- 結果: 分割された各問の答え（種類・ホルマの一言・表情・notice・開いた所見と科学メモ）、進行（進捗・質問数・開示所見・nearCore・費用）。
- トレース:
  - 帯: 実際の mode（降格なら「要求 → 実際」）、FAST PATH / MODEL PHRASING、DEGRADED、確信度、合計時間、トークン in/out、費用（$ と円）
  - 退避・注記（`fallback`: `budget`, `dropped:n`, `judge:timeout`, `render:rejected` など）
  - 段階ごとの時間（積み上げバー＋段階ごとのバー。並列した段階は合計を超えることがある）
  - 候補の所見（スコアのバー＋カード名）、最も近い想定質問、正規化した文
  - 分割された質問ごと: 判定元（probe / keyword / meta / model）、確信度、核心への近さ、対象・開示・保留（理由つき）、近い想定質問（flip = 命題の反転）、ホルマの一言（定型文 / モデル）、判定の生データ、検査（post-check）
  - LLM 入力（prompt）/ 出力、検査、判定の生データ（折りたたみ・コピー可）、TurnTrace 全体の JSON
- 実行履歴はこのタブの中だけに残る（最大30件、セクションを移っても消えない。再読込で消える）。

### トレース TRACES
サーバーのメモリにある直近のターン（最大 300、新しい順）。`GET /api/admin/traces`。
- 絞り込み: 入力文・事件・種類（ask / verdict）・mode・結果・条件（退避あり / モデル言い換え / 所見が開いた / 費用あり）・件数（50/100/300）。5秒ごとの自動更新。
- 行クリックで質問テストと同じトレース表示が開く。
- メモリなのでサーバー再起動で消える。dev ではエンジンのファイルを編集すると（ホットリロードで）消える。dev は `logs/trace-YYYY-MM-DD.jsonl` にも残る。本番はコンソールに1ターン1行の JSON。Vercel ではインスタンスごとに別の記録になる。

### ベンチ BENCH
`npm run bench` が書いた `bench/reports/*.json` を一覧する（`GET /api/admin/bench`。2 MB を超えるレポートは本文を読まない）。
- 一覧: ラベル・ファイル・更新・mode・正答率・所見一致・漏洩・P95・費用/問・状態（dry-run、警告）・HTML へのリンク。dry-run（通信なし）は薄く表示、「dry-run を隠す」で除外。
- レポート: 実行条件（ラベル・mode・strategy・models・options）、費用（Jev / LLM の回数・エラー・金額）、指標の表（↑ = 大きいほど良い、↓ = 小さいほど良い。正答率が低い・漏洩があると色付き）、想定質問の種類ごと・事件ごとの内訳、混同行列（正解 × 判定。対角が緑、外れが赤）、外れの一覧（judge の生データつき）、JSON 全体。
- 比較: 任意の2つの実行（A / B）を並べ、差（割合は pt）と「どちらが良いか」を出す。
- HTML レポート（`bench/reports/*.html`）は、そのファイルを実際に配信しているサーバー（dev サーバー）でだけリンクを出す。`--compare` の比較 HTML（`*-compare.html`）は JSON が無いので一覧には出ない（dev なら `/bench/reports/<名前>-compare.html` を直接開ける）。
- 本番（Vercel）には `bench/` が無いので空。ベンチは開発機で見る。

### トークン TOKEN TOOL
- `POST /api/admin/mint-token {caseId, stage}` で、指定の段階まで進めた署名つき進行トークンを発行する（QA の近道）。
  | stage | 状態 |
  |---|---|
  | `fresh` | 開始直後（最初から見える所見だけ） |
  | `investigated` | spoilerLevel ≤3 の所見と科学メモを全部開示・質問 20 回 |
  | `debated` | ＋審問の全ラウンド突破 |
  | `solved` | ＋死因宣告が通った（真相・解説が読める） |
  | `reconstructed` | ＋真相の再構成まで完了 |
- 発行したトークンの進行（ProgressSnapshot）と中身（payload: 事件・開示所見・科学メモ・カウンタ・突破ラウンド・フラグ・発行時刻）を表示。コピー、「質問テストで使う」。
- 「トークンを読む」: 任意のトークンを貼ると payload を表示する（**署名は確かめない**。改ざん・期限切れはサーバーが 401 で弾く）。

---

## 3. ファイルと方針

| ファイル | 役割 |
|---|---|
| `admin.html` | 入口。`noindex`、`%VITE_APP_TITLE%` は `src/build/html-env.ts` が埋める |
| `src/admin/main.tsx` / `App.tsx` | 起動・認証ゲート・左メニュー・セクション切替 |
| `src/admin/api.ts` | 管理 API クライアント（`x-admin-token`、sessionStorage、30秒タイムアウト）、トークン payload の表示用デコード |
| `src/admin/store.ts` | ハッシュルート・認証状態・共有データ（health / status / cases）の signal |
| `src/admin/types.ts` | 管理 API の応答の型（server 側の型を type-only で参照） |
| `src/admin/TraceView.tsx` | TurnTrace の表示（質問テストとトレースで共用） |
| `src/admin/bench-parse.ts`（＋`.test.ts`） | ベンチレポートの寛容な読み取り（形式が変わっても落ちない）、指標の向きと表示形式 |
| `src/admin/sections/*.tsx` | 各セクション |
| `src/admin/admin.css` | `.adm-` 接頭辞の utilitarian なダークスタイル |

- 画面の文字は日本語（技術的なキー名・mode 名はそのまま）。
- 事件の編集はしない（閲覧・検査・試験まで。`docs/decisions.md`「今回やらないこと」）。
- 検証: `npx tsc --noEmit` / `npx vitest run src/admin` / dev サーバーで `node qa/admin/admin-shots.mjs http://127.0.0.1:<port>`（全セクションのスクリーンショットを `qa/admin/` に保存。`--mock-bench` で見本のベンチを差し込む）/ 本番ゲートは `ADMIN_TOKEN=… npx vite build` → `ADMIN_TOKEN=… npx vite preview` に対して `node qa/admin/admin-gate.mjs <url> <token>`（`qa/` は git 管理外のローカル補助。残すなら `scripts/` へ移す）。

## 4. ビルド設定のメモ（vite.config.ts）
- 入口は `index.html`（ゲーム）＋ `admin.html`（管理。静的版では除外、http 版は `VITE_INCLUDE_ADMIN` か ビルド時の `ADMIN_TOKEN` があるときだけ。§1「ビルドに含める条件」）。
- `htmlEnvDefaults()` が HTML の `%VITE_*%` の既定値を埋め、`VITE_OFFICIAL_RELEASE_ENABLED=true` のときゲームの `noindex` を外す（admin.html の `noindex` は固定）。
- `preview.port` は 4191（4190 は Chromium の危険ポート）。
- dev サーバーは `bench/reports`・`logs`・`qa`・`dist` を監視しない（ベンチの HTML 書き出しでページが再読込されないように。配信はされる）。

## 5. .gitignore の方針
- `qa/`・`logs/`・`dist/`・`.vercel`・`.env*`（`.env.example` だけは管理）を無視。
- **`bench/reports/` は JSON も HTML も無視**。どちらも想定質問と正解ラベル（事件の秘密）とモデル出力を含み、ベンチのたびに作り直すため。
  節目の結果を残したいときは、`bench/baselines/` などにコピーしてからコミットする。
