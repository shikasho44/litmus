# AI の説明書（判定 Jev・言い換え LLM・Codex・ベンチマーク）

「ジェーンドゥの死因」の AI 部分（`server/engine/ai/**`, `server/engine/providers/**`, `server/engine/factory.ts`,
`scripts/bench.ts`, `scripts/bench/**`）の説明と、2026-09-24 に実際に測った結果。
体験の正本は `docs/design-bible.md`、エンジン全体は `docs/engine.md`、約束（型）は `server/engine/judge-types.ts`。

---

## 0. 結論（先に）

| 項目 | 決めたこと | 理由（測定） |
|---|---|---|
| 本番の既定モード | **`jev`**（Jev 判定 → 定型文 FAST PATH） | 818問の汎化テストで答え正答率 **86.1%**（rules 72.9%）、p50 **0.2秒**、1問 **約0.012〜0.045円** |
| Jev の候補の渡し方 | **`all+prior`**（全所見＋規則判定を「下書き」として添える） | 比較実験で最良。60問: 96.7%（ガード込み100%）、難問24問: 100%（topk+prior 91.7%） |
| 言い換え LLM | 既定 **`deepseek/deepseek-v4-flash-0731`**（推論オフ・遅延優先ルーティング） | 安い・速い（実測 1.1〜1.6秒、1回 約$0.00004〜0.00007）・日本語が自然 |
| LLM 言い換え | **任意（比較用）**。使うなら `jev+llm+check` | 言い換えは味は出るが遅く（p50 1.3〜2秒）、事実の付け足しが起きる。局所検査＋Jev 検査で抑えられる |
| LLM だけで判定（`llm`） | **使わない（基準線）** | 9問で 66.7%（同じ9問で jev 88.9%）、行の 44% に持っていない所見の語が混ざった |
| Codex | **開発用・実験的** | app-server・exec とも動作確認済み（15秒・11秒）。本番の締切（1手 9 秒）には間に合わない |

実費（ユーザーのキー、`usage.cost` の合計）: **Jev $0.1386**（上限 $0.15）/ **LLM 58回 $0.0045**（上限 60回・$0.10）/ **Codex 2回**（上限 2回）。

---

## 1. モードと部品

| mode | 判定 | 返答 | 検査 | 用途 |
|---|---|---|---|---|
| `rules` | 規則（`rules-judge.ts`） | 定型文 | — | オフライン・静的版・障害時の退避先 |
| `jev` | **JevJudge** | 定型文 | — | **本番の既定** |
| `jev+llm` | JevJudge | **LlmRenderer** | 局所検査 | 表現の比較 |
| `jev+llm+check` | JevJudge | LlmRenderer | 局所検査＋**JevPostChecker** | 設計書の MODE C |
| `llm` | **LlmJudge**（真相を全部渡す） | LlmJudge の一言 | 漏洩語チェック | 設計書の MODE A（基準線） |

死因宣告（verdict）は `jev` 系モードで **JevVerdictJudge** が要素ごとの確率を返し、`verdict.ts` が規則のキーワード判定と合わせる。

組み立ては `server/engine/factory.ts`:
- `createComponents(env, mode?, overrides?)` — 作れない部品（キー無し・Vercel 上の codex 等）だけを外し、その分だけ降格する（判定が無い→規則、言い換えが無い→定型文）。警告は `warnings` と `/api/admin/status`（本番はコンソールに1回ずつ）。
- `componentsFor(env)` — 管理画面の ask-debug（mode 上書き）用に、mode ごとの部品を1回だけ作って使い回す。プロバイダは設定ごとにキャッシュするので Codex の子プロセスも1つで済む。
  ※ `server/http/runtime.ts` は今 `createComponents(o.env, mode)` を毎回呼ぶ。プロバイダはキャッシュされるので実害はないが、`componentsFor: componentsFor(o.env)` に替えるとよい（ENGINE FIX 担当へ）。

---

## 2. プロバイダ

### 2-1. Jev（`providers/jev.ts`）
- `POST https://openrouter.ai/api/alpha/decisions`、`Authorization: Bearer $OPENROUTER_API_KEY`、model `JEV_MODEL`（既定 `typesafe/jev-1.13`）。
- OpenRouter のキーが無く `TYPESAFE_API_KEY` がある場合は `https://api.typesafe.ai/v1/systemone`（model は `typesafe/` を外した名前、既定 `jev-latest`）。
- 返り値を正規化: choice は必ず criteria のキー（不正なら確率の最大）、確率は合計1に、confidence = その選択肢の確率、score は数値、noul は 0〜1。
- 失敗の種類（`providers/http.ts`）: 自前タイムアウト・呼び出し側の中断・408 → `timeout` / fetch 失敗 → `network` / 429 → `rate_limited` / 5xx・壊れた本文・答えの欠け → `server` / 401・402・403 → `config` / その他の 4xx → `bad_request`。前の4つはパイプラインが1回だけ再試行し、だめならその問だけ rules に退避する。
- `usage`（input_tokens / output_tokens / cost）をそのまま費用に。キーは Authorization ヘッダーにだけ入り、エラー文・`raw`・ログには出ない（テストで確認）。
- 実測: 1回 0.2〜0.5 秒。トークン数 ≒ 送った JSON の文字数（日本語）。

### 2-2. OpenRouter の LLM（`providers/openrouter-llm.ts`）
- `POST https://openrouter.ai/api/v1/chat/completions`。`usage: {include: true}` で実費を受け取る。`json: true` なら `response_format: {type: 'json_object'}`。
- 既定 `reasoning: {enabled: false}`（一言に推論は不要。速さ優先）、`provider: {sort: 'latency'}`（値段優先のルーティングは p50 30 秒の flex 枠に当たることがある）。

**既定モデルの選定（2026-09-24、OpenRouter のカタログを MCP で確認）**

| モデル | 料金（入力/出力 $/M） | 公開の遅延 p50 | 実測（言い換え1回） | 判断 |
|---|---|---|---|---|
| **deepseek/deepseek-v4-flash-0731** | $0.038 / $0.55（提供元により $0.03〜0.14 / $0.16〜0.70） | 0.23〜1.5 秒（提供元多数） | **1.56 秒・$0.000055**「はい。……ククッ、タンクは、この部屋の主役ですとも。」 | **採用** |
| openai/gpt-6-luna | $0.05 / $0.25（flex 枠, p50 30 秒）・$0.10 / $0.50（標準, p50 3.1 秒） | 0.7〜7 秒 | 1.96 秒・$0.000076「はい。タンクは関係ありますねェ……クックック、次の所見をどうぞ。」 | 次点 |
| z-ai/glm-5.3-flash, gemini-3.x-flash | 推論が必須 | — | — | 一言には遅い |
| google/gemini-2.5-flash-lite | $0.10 / $0.40 | — | — | 2026-10-20 に提供終了予定 |

変更は `LLM_MODEL`。推論が必須のモデルでは `LLM_REASONING=low` 等を併用（`enabled:false` を受け付けず 400 になるため）。

### 2-3. Codex（`providers/codex.ts` + `providers/codex-node.ts`）— 実験的・開発専用
- `LLM_PROVIDER=codex`。ChatGPT のサインイン枠で動くので費用 0（`costUsd: 0`）。
- 既定は **`codex app-server`（stdio の JSON-RPC、改行区切り、`jsonrpc` ヘッダー無し）を1つ常駐**。1回ごとに `thread/start`（ephemeral・read-only・承認 never・システム文を baseInstructions に・作業場所は一時フォルダ）→ `turn/start` → `item/completed` の最後の `agentMessage` → `turn/completed`。承認要求はすべて拒否。`-c notify=[]` で利用者の通知フックを止める。Node 終了時に子プロセスを（Windows ではツリーごと）止める。
- `CODEX_TRANSPORT=exec` で `codex exec --ephemeral --sandbox read-only -o <file> -`（標準入力に文を書いて閉じる）に切り替え。
- 設定: `CODEX_BIN`（既定 `codex`）/ `CODEX_MODEL`（既定は `~/.codex/config.toml` のモデル。今は gpt-6-astra）/ `CODEX_EFFORT`（既定 `low`）/ `CODEX_TIMEOUT_MS`（既定 60000）。
- **ブラウザ版・Vercel には入らない**: `codex.ts` は Node の import を持たず、子プロセスの処理は初回呼び出し時に動的 import。`VERCEL` 環境やブラウザでは組み立て時に `config` エラー → factory が外す。
- 実測（2回）: app-server 15.4 秒（入力 14,917 トークン — Codex 側の文脈が乗る）/ exec 10.7 秒。どちらも正しい一言を返した。**パイプラインの言い換え締切 4 秒には間に合わない**ので、ゲーム中はほぼ定型文に落ちる。用途は `npx tsx scripts/bench/llm-smoke.ts --provider codex` での文面の試作や、締切の無いツール。
- 手元確認（枠を使わない）: `codex-node.ts` の `pingCodexAppServer()`（初期化とスレッド開閉だけ）。

---

## 3. JevJudge（質問の判定）

### 3-1. 1問につき1回、7つの判断をまとめて聞く
| key | 型 | 中身 |
|---|---|---|
| `answer` | choice | yes / no / partial / irrelevant / cannot / vague（下の基準） |
| `fact` | choice | 候補の所見 id ＋ `NONE` |
| `qtype` | choice | yesno / open / meta |
| `closeness` | score | 0 無関係 / 1 周辺 / 2 重要 / 3 死因そのもの |
| `selfHarm` | noul | 自殺・自傷・殺害の方法、楽に死ねるか、致死量など／死にたい（被害者が自殺だったかの確認は除く） |
| `directAnswer` | noul | 死因・真相・名前を直接教えるよう求めている（はい／いいえの確認は除く） |
| `offtopic` | noul | 事件と無関係な雑談・あいさつ・案内役への個人的な質問 |

answer の基準（`ANSWER_CRITERIA`、実物）:
- はい: 命題が真相・所見と一致して正しい。否定の確認（〜ではないですよね？）は、否定の内容が正しければ「はい」。
- いいえ: 命題が真相・所見に反し誤り。否定の確認は、否定の内容が誤りなら「いいえ」。
- 一部そう: 命題の一部だけ正しい、条件つきで正しい、または言葉の取り方で正誤が分かれる。
- 関係ない: 真相にも所見にも無い細部、死因と無関係な事柄、雑談（反対の事実が書かれていれば「いいえ」）。
- 答えられない: 答えそのものやヒントを求めている、または死に方・方法・致死量など危険な情報を求めている。
- 具体的に: はい／いいえで答えられない質問（なぜ・どうやって…）や、意味の取れない入力。

state（判断材料）はそぎ落とす: `質問` → （否定の確認なら）`質問の形` → `事件の真相`（truth.summary）→ `所見`（`{id: 本文【メモ】judgeNote(140字まで)}`）→（`+prior` なら）`規則による下書きの判定`（例「はい／所見 F26（想定質問「換気扇は止まっていましたか」との類似 84%。確かさ 84%。誤っていることもある）」）。

### 3-2. 候補の渡し方（`JEV_CANDIDATES`）
| strategy | 候補 | 1問のトークン | 1問の費用 |
|---|---|---|---|
| `topk` | 検索の上位8件（0件のこともある） | 約1,900 | $0.000079（0.012円） |
| `wide` | 上位8件＋文字の重なりで12件まで補充 | 約2,650 | $0.00011（0.017円） |
| `all` | 全所見（41〜45件） | 約7,000 | $0.00030（0.045円） |
| `topk+prior` / `wide+prior` / `all+prior` | 上に規則の判定を添える | ＋50 | ほぼ同じ |

### 3-3. Jev の出力 → JudgeDecision
- `answerClass` = answer の選択、`confidence` = その確率。
- `factIds` = 所見の確率が 1位 ≥0.30 / 2位以降 ≥0.35 のもの（最大3）、`factStrength` = その確率（spoilerLevel 3 の開示は policy が ≥0.7 を要求）。
- `closeness` = score を四捨五入。`qtype` = そのまま。
- **ハイブリッドのガード**（実測で追加）: Jev は「答えは何ですか？」を疑問詞の質問（vague）と取りがち。答えが はい/いいえ/一部 以外のときだけ、規則の正規表現メタ（答え・ヒントの要求 → cannot、ホルマへの質問・雑談 → irrelevant）と `directAnswer ≥ 0.7`（かつ cannot に3割以上）を優先する。はい/いいえ は上書きしない。
- **selfHarm の較正**: 生の noul は安全の想定質問でも 0.12〜0.49 が混ざる一方、それ以外の 763 問の最大は 0.29。生値 0.30 を境にすると 安全 50問中45問を拾い誤検出 0（0.5 だと 40問）。パイプラインの約束（`flags.selfHarm ≥ 0.5` で安全応答）に合わせ、`flags.selfHarm = 生値 × 0.5/0.30`（上限1）で返す。生値は `raw.flags` に残る。境界を超えたら答えも `cannot`・所見なし。
  なお、今のパイプラインは **規則の安全フィルタ（`safety.ts`）がモデルより先に** 走るので、Jev の旗は二重の網。

### 3-4. JevVerdictJudge（死因宣告）
state `{推理文}`、`answerElements[].judgeClaim` と `wrongClaims[].judgeClaim` をそれぞれ noul で1回にまとめて聞く（要素には「言い回しが違っても同じ意味なら当てはまる」、誤りの主張には「否定しているだけなら当てはまらない」を添える）。`verdict.ts` が ≥0.7 で採用。

### 3-5. JevPostChecker（MODE C の検査）
1. **局所・無料**: 漏洩語（`leakTerms`。持っている所見の本文にある語は除く）→ `leak`。
2. **局所・無料**: 持っていない所見のキーワード（質問に出た語・漢字1字・かな2字以下は除く）→ `new-fact`。
3. Jev の noul 3つ: 新しい情報 / 決まった答えとの食い違い / 死因・秘密語のほのめかし。
   **較正（39行、`scripts/bench/postcheck-calibrate.ts`）で分かったこと**: Jev は自由文の検査が苦手。定型文「関係ありません。寄り道も、ほどほどに。」に newInfo 0.80、事実を足した LLM 行「左胸——ちょうど心臓の上あたり」に 0.15。事件3の定型文でも secret が 0.45 まで上がる。
   → しきい値は **newInfo ≥0.70（はい/いいえ/一部の行だけ）/ contradicts ≥0.50（cannot・vague 以外）/ secret ≥0.60**。実際の防御は 1・2 の局所検査が担う。

---

## 4. LLM の部品

### 4-1. LlmRenderer（`jev+llm` 系）
- 人物設定は `content/VOICE.md` の「LLM 言い換え用の要約」を元に、禁止事項を強めたもの（`HOLMA_SYSTEM`）。
- 入力は、質問・決まった判定（と「はい」で始める等の指示）・**この答えで新しく開く所見だけ**・定型文の1行目（口調の見本）。
- 出力の局所検査（だめなら定型文を返す。理由は `raw.fallback`）: 60字以内 / 判定の言葉で始まる（はい・いいえ・一部・関係ない。cannot と vague は はい/いいえ で始めない）/ 漏洩語なし / 持っていない所見の語なし。
- **プロンプト v1 → v2 の改善（実測）**: v1 は持っている所見も最大5件渡していたため、「左胸——ちょうど心臓の上あたり」「眠るように、静かに」のように事実を付け足した（幻覚指標 14行中6）。v2 は新しく開く所見だけを渡し「判定の後はホルマの反応だけ」「重要さを匂わせない」を足し、局所の `new-fact` 検査を入れた → 9行中0。

### 4-2. LlmJudge（`llm`、基準線）
- 真相・死因・全所見（メモ付き）・質問を渡し、JSON `{answerClass, factIds, closeness, confidence, line}` を返させる。
- 読み取りは防御的（```json 囲み・前後の文・日本語の判定名を許す。未知の id は捨てる。数値は丸める）。読めなければ `server` エラー → 1回再試行 → rules。
- 一言は「判定の言葉で始まる・80字以内」だけ確かめ、あとはパイプラインの漏洩語チェックに任せる（基準線として素のまま）。

---

## 5. ベンチマーク（`npm run bench`）

### 5-1. 方法
- 想定質問（1事件 207〜348問、計 **818問**、人が付けた正解ラベル）を **本物の GameService / パイプライン** に流す。
- **毎問、新しい進行状態**（最初から見えている所見だけ）。
- **leave-one-out**: 流す問と同じ文の想定質問を、その問の間だけ事件データから抜く。抜かないと規則が自分自身を類似度 1.0 で見つけ、モデルが一度も呼ばれない（＝汎化ではなく暗記の測定になる）。`--no-loo` で本番と同じ条件も測れる。
- プロバイダは上限つきで包む（`--max-jev-usd`・`--max-llm-calls`・`--max-llm-usd`）。上限に達したら `config` エラー → その問は規則。
- 指標: 答え正答率 / 所見一致（ラベルに所見がある はい・いいえ・一部 の問で、判定の所見と1つでも重なる）/ 質問の型（種類から: meta・spoiler-bait・out-of-scope → meta、答えが vague → open、他 → yesno）/ 漏洩（開始前の返答に漏洩語、または spoilerLevel 4 がカード化）/ 幻覚指標（採用された LLM 行に、持っていない所見のキーワード）/ 安全（note が SAFETY の問が cannot かつ notice 'support'）/ 誤 support / 一貫性（`--repeat`）/ 遅延 平均・p50・p95・p99 / 1問の費用（USD と 150円/$ の円）/ FAST PATH 率 / 再試行・退避・言い換え→定型文 の率 / 混同行列。
- 出力: `bench/reports/<ISO>-<label>.json` と `.html`（自己完結）、複数 mode なら比較 HTML。`--compare` で既存レポートから比較ページだけ作れる。`--dump` で全記録（大きい）、`scripts/bench/remap.ts` で **API を呼ばずに** 写像（しきい値・ガード）の変更を記録済みの Jev 出力へ当て直せる。

```
npm run bench -- --mode rules                                   # 無料
npm run bench -- --mode jev --limit 20 --strategy topk+prior    # 事件ごと20問（種類を均等に）
npm run bench -- --mode jev+llm,jev+llm+check,llm --limit 3     # LLM は少数で
npm run bench -- --mode all --limit 5 --dry-run                 # 呼ばずに件数と文字数だけ
npm run bench -- --compare                                      # 最新レポート同士の比較ページ
npx tsx scripts/bench/remap.ts <dump.json>                      # 記録を当て直す（無料）
npx tsx scripts/bench/llm-smoke.ts --model <slug>               # 言い換え1回
npx tsx scripts/bench/postcheck-calibrate.ts <dump.json>        # 検査のしきい値の確認
```

### 5-2. 結果: 候補の渡し方（同じ60問、事件ごと20問・種類を均等に）

| strategy | 正答率 | ガード後（remap） | 所見一致 | p50 | 1問の費用 |
|---|---|---|---|---|---|
| rules（同じ60問） | 88.3% | — | — | 1ms | 0 |
| topk | 91.7% | 96.7% | 93.0% | 216ms | $0.000082 |
| wide | 90.0% | 95.0% | 90.7% | 207ms | $0.00011 |
| all | 88.3% | 93.3% | 88.4% | 250ms | $0.00031 |
| **topk+prior** | 96.7% | 96.7% | 93.0% | 217ms | $0.000085 |
| **all+prior** | 96.7% | **100%** | 97.7% | 238ms | $0.00031 |

難しい種類（ambiguous・paraphrase・indirect・no から事件ごと8問、計24問）: **all+prior 100%** / topk+prior 91.7% / rules 83.3%。
→ 規則の下書きを添えるのが最も効く。全所見は下書き無しだと逆に下がる（「関係ない材料で精度が落ちる」という Jev の性質どおり）が、下書き付きでは最良。**既定は all+prior**（1問 0.045円。目標の 0.1円以下）。費用を 1/4 にしたいときは `JEV_CANDIDATES=topk+prior`（全818問で 86.1% を実測済み）。

### 5-3. 結果: 全818問（leave-one-out、2026-09-24）

| mode | 答え正答率 | 所見一致 | 質問の型 | 漏洩 | p50 / p95 / p99 | 1問の費用 |
|---|---|---|---|---|---|---|
| rules（Jev 測定時の規則） | 67.2% | 77.5% | 80.8% | 0% | 5 / 12 / 20 ms | 0円 |
| rules（最新の規則＋安全フィルタ） | **72.9%** | 77.5% | 86.9% | 0% | 1 / 4 / — ms（逐次） | 0円 |
| **jev[topk+prior]** | **86.1%** | 81.9% | 89.6% | 0% | 205 / 286 / 458 ms | $0.000081（**0.012円**） |

- Jev の全問測定は安全フィルタの組み込み前。安全の想定質問 53問のうち Jev は 44問を cannot にした（support の表示はフィルタ側の仕事）。今のパイプラインでは安全フィルタが先に 53/53 を処理するので、**今の実効値は 約87%**（見積もり）。Jev に渡した下書きも古い規則（67.2%）のもの。
- 種類別（rules 最新 → jev）: no 66.8→**90.4** / paraphrase 74.8→**93.9** / yes 91.5→95.3 / core 79.0→**94.7** / indirect 73.5→89.8 / irrelevant 33.3→**83.3** / negated 96.5→100 / typo 92.0→100 / ambiguous 35.7→**42.9**（最大の弱点）/ meta 88.2→75.0（安全フィルタ前の値）。
- 事件別 jev: c01 83.6% / c02 86.3% / c03 89.9%。
- 混同行列の主な外れ: 正解 partial を yes/no にする（79問中49）、正解 no を yes（12）、答えられない系を はい（7、安全系 — 今はフィルタが先に処理）。
- 一貫性: all+prior で 6問×2回 → **100%** 同じ答え（Jev は同じ入力に同じ確率を返す）。
- 障害: 全 1,000 回超の Jev 呼び出しで エラー 0・退避 0。

### 5-4. 結果: LLM を使うモード（少数。LLM は計58回まで）

| mode（問数） | 正答率 | 同じ問の jev | 同じ問の rules | 幻覚指標 | p50 / p95 | 1問の費用 | 定型文に戻った率 |
|---|---|---|---|---|---|---|---|
| jev+llm v1（15） | 86.7% | 86.7% | 80.0% | **42.9%**（14行中6） | 1.1 / 1.7 秒 | $0.00013（0.019円） | 7% |
| jev+llm+check v1（12） | 83.3% | 83.3% | 75.0% | 0% | 2.2 / 5.7 秒 | $0.00020（0.031円） | 25% |
| **jev+llm v2**（9） | 88.9% | 88.9% | 88.9% | **0%** | 1.3 / 2.1 秒 | $0.00012（0.019円） | 0% |
| **jev+llm+check v2**（6） | 100% | 100% | 100% | 0% | 1.8 / 2.6 秒 | $0.00015（0.023円） | 0%（検査で1行差し戻し→作り直し） |
| **llm**（9） | **66.7%** | 88.9% | 88.9% | **44.4%**（9行中4） | 0.9 / 2.6 秒 | $0.00025（0.037円） | 0% |

- 判定を LLM に任せる `llm` は、同じ9問で Jev より 22 ポイント低く、「めまい」「午後から天候が荒れた」「毒も酒も入っていない」のように持っていない情報を喋った。真相を渡す以上、防ぎようがない。**判定は Jev、文章は定型文（必要なら検査つき言い換え）**という設計が正しかった。
- 言い換えの例（v2）: 「……いいえ。ククッ、ご期待に沿えず申し訳ありませんねェ。」「関係ない。ですが、その問いの熱量には、少々興味が湧きましたねェ。」

### 5-5. 費用のまとめ
| 構成 | 1問 | 1万問 |
|---|---|---|
| `jev` + all+prior（既定） | 約$0.0003（0.045円） | 約$3（450円） |
| `jev` + topk+prior | 約$0.00008（0.012円） | 約$0.8（120円） |
| `jev+llm+check`（DeepSeek） | 約$0.00015〜0.0004 | 約$1.5〜4 |
`DAILY_COST_LIMIT_USD` の既定 $1 は、all+prior で1日 約3,300問ぶん。超えた日は rules に落ちる（前置きなし）。公開時は上限を見直す。

---

## 6. 切り替え方（環境変数）

| 変数 | 既定 | 説明 |
|---|---|---|
| `PIPELINE_MODE` | キーあり→`jev` / なし→`rules` | §1 |
| `DECISION_PROVIDER` | `jev` | `rules` で判定モデルを使わない（MODE C の検査だけは Jev を使う） |
| `JEV_MODEL` | `typesafe/jev-1.13` | `~typesafe/jev-latest` で常に最新 |
| `JEV_CANDIDATES` | `all+prior` | `topk` / `wide` / `all` / `topk+prior` / `wide+prior` / `all+prior` |
| `OPENROUTER_API_KEY` / `TYPESAFE_API_KEY` | — | サーバーだけが読む |
| `LLM_PROVIDER` | `none` | `openrouter` / `codex` |
| `LLM_MODEL` | `deepseek/deepseek-v4-flash-0731` | OpenRouter のモデル |
| `LLM_REASONING` | `off` | `minimal` / `low` / `medium` / `high` |
| `LLM_PROVIDER_SORT` | `latency` | `throughput` / `price` |
| `LLM_TIMEOUT_MS` | 8000 | 呼び出し側の指定が無いとき |
| `CODEX_TRANSPORT` / `CODEX_BIN` / `CODEX_MODEL` / `CODEX_EFFORT` / `CODEX_TIMEOUT_MS` | `app-server` / `codex` / 設定ファイル / `low` / 60000 | §2-3 |

例: 表現を比べる開発機 `PIPELINE_MODE=jev+llm+check LLM_PROVIDER=openrouter`、Codex で試す `PIPELINE_MODE=jev+llm LLM_PROVIDER=codex CODEX_MODEL=gpt-6-sol`（締切で定型文に落ちやすい）。

---

## 7. 次に試すこと

1. **all+prior の全問測定**（約 $0.25）。既定にした根拠は 84問。全818問で topk+prior の 86.1% を上回るか確かめる。安全フィルタと新しい規則が入った今の構成で測り直す。
2. **一部そう（partial）の弱さ**（42.9%）。所見の `judgeNote` に「〜と訊かれたら一部」をもっと書く、または `partial` の基準に例を足す。規則の下書きが partial のときに重みを増す写像も `remap.ts` で無料で試せる。
3. ゲームのメタ質問（「あと何問？」「遊び方は？」）はラベルが cannot / irrelevant に割れている。ラベルの方針を決めて想定質問をそろえる。
4. JevPostChecker の noul は識別力が低い。「返答の中の名詞を並べて、どれが許された所見に無いか」を choice にするなど、Jev が得意な形に問いを作り替える。
5. 言い換えは v2 で事実の付け足しが消えたが、「静かな幕切れ」のような雰囲気のほのめかしは残る。検査の secret に例を足すか、`nearCore` のときだけ言い換えを止める。
6. Codex app-server は 1回 15 秒・入力 1.5万トークン。`CODEX_MODEL` を軽いモデルにする、baseInstructions 以外の文脈（ツール定義）を減らす設定を探す。
