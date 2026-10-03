# エンジン設計メモ（server / api / src/api）

「リトマス審問」の判定エンジン・HTTP 層・クライアントの説明書。
正本は `docs/design-bible.md`（体験）と `shared/*.ts`（データ・API の約束）。ここは実装側の地図。

---

## 1. 全体図

```
 ブラウザ (src/**)
   │  import { api } from 'src/api'        ← UI は GameApi だけを見る
   ▼
 src/api/index.ts ── __JANEDOE_EMBEDDED__（ビルド時定数）で分岐
   ├─ http.ts      fetch('/api/…')  12秒タイムアウト・通信/5xx は1回再試行・ApiError へ変換
   └─ embedded.ts  エンジンをブラウザ内で実行（rules 固定・事件データ同梱）※ static ビルドのみ
                                   │
 ─────────────── HTTP ─────────────┼──────────────────────────────────────────
                                   ▼
 Vite dev / preview : server/node/vite-plugin.ts ─┐
 Vercel            : api/router.ts ────────────┤→ server/node/handler.ts  handleApi(request, env)
                                                   │     ├ content-fs.ts   content/ を読む（dev は変更を自動再読込）
                                                   │     ├ trace-file.ts   logs/trace-YYYY-MM-DD.jsonl（dev のみ）
                                                   │     └ bench-reports.ts bench/reports/*.json 一覧
                                                   ▼
                              server/http/handler.ts  ルーティング・入力制限・レート制限・管理 API・エラー JSON
                              server/http/runtime.ts  設定 + 部品の組み立て
                                                   ▼
                              server/engine/game.ts   GameService（GameApi の全メソッドの本体）
                                                   ▼
   ┌──────────────────────── server/engine（純粋 TS。Node API なし。ブラウザでも動く）─────────────────────┐
   │ registry.ts   事件の読込・zod 検証・壊れた事件はスキップして報告        lines.ts / default-lines.ts 定型文 │
   │ safety.ts     自傷・方法・加害の質問を最初に止める（モデルに渡さない）                                       │
   │ normalize.ts  正規化・分割・否定・疑問詞・メタ・命題の極性             case-index.ts 事件ごとの前計算       │
   │ retrieve.ts   所見（キーワード＋bigram）と想定質問（Dice）の候補        rules-judge.ts オフライン判定        │
   │ pipeline.ts   ask の流れ（判定→規則→返答→検査→トレース）             policy.ts  所見を開けてよいかの規則   │
   │ verdict.ts    死因宣告の判定（自由記述）                              token.ts / sha256.ts  進行トークン   │
   │ verdict-modes.ts 難易度別の宣告（選択式 choice・穴埋め cloze）の判定。表示は public-view.ts の verdictSetupView │
   │ public-view.ts ブラウザへ出す形（秘密はここを通らない）                 state.ts   進行状態・進捗・破片     │
   │ factory.ts    env → 判定部品（Jev / LLM / 検査）                      budget.ts  1日の費用上限             │
   │ judge-types.ts 差し替え可能な Judge / VerdictJudge / Renderer / PostChecker の約束                          │
   │ ai/*, providers/*  ← 次の担当が実装（今はスタブ。factory が rules に落とす）                                │
   │ validate.ts   事件の検査（npm run validate と /api/admin/cases で共用）  trace.ts  計測                   │
   └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

import は `server/**` と `api/**` では **`.js` 拡張子付きの相対パス**（例 `'./normalize.js'`）。
TypeScript の bundler 解決・Vite・tsx・vitest はそのまま `.ts` を見つけ、Vercel の Node 関数（ESM）でも解決できる。

---

## 2. ask の流れ（design bible §5-2）

```
質問(≤200字)
 → 分割（？ / ? / 。 / ！ / 改行 / 「それと」「あと」、最大3問。4問目以降は捨てて trace に dropped:n。
    「はい/いいえで答えてください。」「正直に答えて。」のような答え方の指示だけのパートは、ほかに質問があれば捨てる）
 → 安全フィルター safety.ts（メッセージ全体と各パート。当たればターン全体を下の「安全フィルター」の返答にして終了）
 → 正規化（NFKC・小文字・カタカナ→ひらがな・記号/絵文字/空白を除去。表示用の原文は保持）
 → 候補（所見: キーワード命中＋bigram 包含率 上位8 / 想定質問: Dice 類似 上位5）
 → 判定（mode に応じて rules / Jev / LLM。モデル失敗は1回再試行 → rules に退避）
 → 規則 policy.ts（開示してよいか: 回答種別・確信度・spoilerLevel・requires・1回2枚まで）
 → 返答（定型文 FAST PATH / LLM 言い換え → 漏洩語チェック → mode C は Jev 検査・NG なら1回作り直し → 定型文）
 → 状態更新（所見・科学メモ・nearCore・質問数・質問枠の消費）→ 新しいトークン → TurnTrace
```

### 質問枠（2026-09-28、`shared/budget.ts`）
- **数え方**: `asked`（質問数）はこれまでどおり空・長すぎ以外の全パート。別に `spent`（質問枠に数える数）を持つ。
  数えるのは「はい／いいえ／一部そう／関係ない」で、判定に meta（askAnswer・askHint・offtopic・aboutHolma・rude・manner・culprit・open・empty・tooLong）が付いていないパートだけ（`isCharged`・pipeline の `chargedDecision`）。
  安全フィルターの返答も数えない。数えないパートの `AskAnswer` には `free: true`。**数えないパートは所見を開けない**（開示は はい／いいえ／一部そう だけ。全事件の全想定質問で `tests/engine/budget.test.ts` が確認）。
- **締切**（教授）: `AskRequest.limit` が来たら（または部屋に結びついたトークンで部屋の難易度が教授なら、`limit` を無視して部屋の枠で）、
  判定のあと「数えるパート」を残りの枠の分だけ残し、後ろのパートは捨てる（trace `budget-dropped:n`）。無料のパートは切れ目までは答える。
  すでに `spent ≥ limit` なら判定もモデルも呼ばず、数えずに `cannot`（`BUDGET_CLOSED_LINE`、`free: true`）を返す。見習い・審問官の枠は締め切らない（減点はブラウザのランク計算）。

### 安全フィルター（safety.ts・公開の必須条件）
- **判定より前に**走る（想定質問・rules・Jev・LLM のどれよりも先）。当たった質問は**モデルに一切送らない**。
- 対象: 死にたい・消えたい・自殺したい などの打ち明け（`selfHarm`）／死ねる・楽に死ぬ・死に方・致死量・何分で死ぬ・どのくらいで死ぬ・何時間はさまれたら死ぬ／何キロ乗ったら止まる（時間・重さを条件にした問い、2026-10-04 の規則 `how-long-if`）・吸ったら死ぬ・同じ方法で／真似して・自殺に使える・○○死する方法 など（`method`）／殺せる・殺し方・人を殺す・毒を盛る方法・心臓を止められる・わざと起こせる など（`harmOthers`）。
- 誤検知を避ける設計: 過去形（「毒で死んだ？」「苦しまずに死んだ？」）、被害者についての問い（「自殺ですか」「彼女の死に方は」「死にたいと言っていた？」）、話題語だけ（「窒素は関係ありますか」）では**鳴らない**（「自殺ですか」は下の 1c 死の種類の封印で、support カードなしに断る）。鳴るのは可能形（死ねる／殺せる）・方法／量／時間の語・一人称の願い・「〜に使える」「〜したら死ぬ」の形。`tests/engine/safety.test.ts` が**全事件の全想定質問**（SAFETY 以外）で鳴らないことを毎回確かめる。
- 返答: メッセージ全体で1つの答え。`answerClass: 'cannot'`・`mood: 'serious'`・`notice: 'support'`（UI は相談窓口カードを出す）・所見もメモも開かない・nearCore も変えない・質問数は1。台詞は固定（ホルマの声だが冗談なし。`SAFETY_LINES`: selfHarm / method / harmOthers の3種）。
- モデル判定の `JudgeDecision.flags.selfHarm ≥ 0.5` も同じ扱い（`safety:model:judge-flag`）。LLM の言い換えは呼ばない。
- 記録: trace には規則名だけ（`fallback: safety:<kind>:<rule>`、`parts[0].meta: 'safety'`）。質問文は trace・JSONL・管理 API に残さない（`[safety]` に置き換え）。
- 200字を超えても、安全フィルターに当たる質問は 400 にせず上の返答を返す。
- 死因宣告の欄に「死にたい」などの打ち明け（`selfHarm`）が書かれたら、判定せず（モデルにも送らず、回数にも数えず）同じ真剣な台詞を返す。宣告は死に方を説明する文なので `method` の語では止めない。
- 既知の限界: c01「酸欠死は苦しくないですか？」（被害者の体験を問う正当な質問、partial）と c03「凍死は苦しくないのですか？」（SAFETY）は同じ形で、エンジンでは分けられない。c03 のものは想定質問（cannot）で答えるが、support カードは出ない。

### 通信失敗の印
- モデルの失敗で rules に退避したパートは `notice: 'degraded'`（従来どおり `error.degraded` の一言も前置）。
- **判定モデルの目覚まし**（2026-09-25）: 約25分アクセスが無いと Jev の最初の数回が 4.5 秒の締切を超えた（AI プレイテストで最初の3問が連続タイムアウト → 1問目が簡易判定）。
  `GameService.newToken`（事件を始めたとき）で `judge.warm()`（約60トークン・約$0.000003）を裏で1回投げる。サーバーごとに2分に1回まで、費用は予算に加算、失敗しても何もしない。導入の演出の間に温まる。
  Vercel では応答後の処理が止められることがあり、その場合は効かない（害もない）。

### rules 判定の順番（rules-judge.ts）
0. 安全フィルター（pipeline が先に処理。上記）
1. 空・長すぎ → `vague`（質問数に数えない）
1c. **死の種類の封印**（`manner.ts`、2026-09-26〜27、**2026-09-30 にふたたび**。docs/decisions.md）: 殺人・他殺・自殺・事故・事件・犯人・犯行・故意・わざと〜した（害のある動詞）・人のせい／人が悪い・誰かが〜を開けた／抜いた／割った（第三者の細工）・誰かのいたずら・毒を盛られた／飲まされた、などの質問 → `cannot`（`meta: 'manner'`、`guard: 'manner'`、モデルも言い換えも呼ばない）。
   殺人か事故かを捜査中に答えない（監修者 くられ先生の方針）。事故の事件でも殺人の事件でも同じ台詞（`meta.manner`＝「宣告まで封印。証拠なら答える」）なので、断ること自体は何も匂わせない。
   **質問枠に数えない**（meta 付きは `isCharged` が false）。所見も開かない。
   証拠の質問は答える: 「争った跡は？」「部屋に他の人はいた？」「毒は検出された？」「誰かが部屋に入ってきた？」「熊に襲われた？」「暑さのせい？」「わざと服を脱いだ？」。「事故の前」「事件当日」のように出来事を指す名詞も答える。
   2026-09-27 追加: 名指しの人（役割語・〜さん）のせい／悪い、名指しの暴力（「男に殴られた？」）、責任・責める・悪気・関与・逮捕、人が主語の「関係ある？」「怪しい？」、「脱がされた」「押し込まれた」、CASE 04 の混入（「誰かが混ぜた？」も封印）・「〜がやったの？」・見せかけ・採り違え。「その人／あの人」は被害者の主語として取り除かない（事件に2人目の人物がいるため。normalize.ts COMMON_SUBJECT）。
   2026-09-30 追加: 入門事件（物が被害者）の「誰かのいたずら？」「誰かが割った／折った？」。
   2（想定質問）より先に走るので、各事件の想定質問のうち該当するものは `cannot`・`kind: "meta"`・`note: "MANNER: …"` にしてある（`tests/engine/manner.test.ts` が全事件の全想定質問で、MANNER の印と封印の判定が一致することを確かめる）。答えを聞く質問（askAnswer）と暴言（rude）はそちらが優先。安全フィルター（0）はさらに前。
   **死の種類の所見**（`fact.manner`、各事件に1枚。c01 F47・c02 F54・c03 F50・c04 F53・c05 F24・c06 F23・c07 F24・c08 F26）は残すが、捜査中はどの問いからも届かない: `case-index.ts` が検索対象（`index.facts`）から外し、`policy.ts` はモデルがその id を挙げても開かない（`blocked: manner`）、Jev・LLM 判定の所見一覧にも入れない、破片の重み（`shardWeights`）と所見の総数（`totalFacts`）にも数えない。validate は、想定質問・審問の証拠・requires・開始時カードに使っていないことを確かめる。
   **スペシャルヒントの口**（未実装）: 長めの広告を見たら死の種類だけを明かす予定。`manner.ts` の `mannerReveal(case)` が `{ factId, manner, fact }` を返すので、将来のエンドポイントは広告の確認 → `factId` を `state.unlocked` に足す（質問にもヒント回数にも数えない）→ `publicFact(fact)` を返す、だけでよい。広告と UI はまだ作らない。
   （2026-09-28〜29 は死の種類を事実どおり答え、死の種類の所見を開いていた。2026-09-30 に監修者の提案へ戻した。）
1d. **犯人の名指しの封印**（`culprit.ts`、2026-09-28。**`truth.culpritSeal` のある事件だけ**＝宣告で犯人を名指す事件。いまは c04）: 1c が拾わない言い方で犯人を特定する質問（「老人は無実？」「友人は潔白？」「幼なじみは怪しい？」）→ `cannot`（`meta: 'culprit'`、`guard: 'culprit'`、モデルは呼ばない。台詞は `meta.culprit`＝「名指しは宣告で。証拠なら答える」）。
   人の語は `manner.ts` の役割語（編集者・老人・友人・男・女性…）＋事件の `truth.culpritSeal.people`（お隣・幼なじみ・看護師・名前など）。被害者は含めない。名指しの人についての証拠（「編集者が盛り付けをしましたか？」「老人はおひたしを食べた？」「編集者ははさみを持っていた？」）は答える。
   該当する想定質問は `note: "CULPRIT: …"`（1c が先に拾うものは MANNER）。
1b. **被害者の本名**（漢字・かなの姓名、漢字の姓、姓名＋さん/ちゃん/くん/氏…）を含む質問 → `cannot`（askAnswer の台詞）。モデルも呼ばない（`guard: 'secretName'`、trace は `skipped:secretName`）。
   Jev は真相の要約で名前を知っているので「白石さんですか？」に「はい」と答えていた（ベンチで確認）。かなだけの名（しいな・はるか）は普通の語に紛れるので敬称つきだけ見る
2. 想定質問とほぼ同文（類似 ≥ 0.9）→ その正解ラベル（作者のラベルが最優先）
3. メタ: 答えを聞く・名前を聞く→`cannot` / ヒント（「ヒント」、または全文が「わからん」「わからない」「もう無理」「詰んだ」「降参」「何を聞けばいい？」など）→`cannot` /
   **ゲームの進め方**（「あと何問で解ける？」「あといくつ所見がある？」「審問はいつ開けばいい？」「遊び方を教えて」「質問の仕方は？」、30字以内。「ルール」「やり方」は事件の語が無いときだけ）→ ヒントと同じ `cannot`（『ホルマの囁き』へ案内。以前は「具体的に」だった） /
   雑談・ホルマ自身→`irrelevant` / 暴言→`cannot`。
   「犯人は誰？」「誰が殺した？」「犯人を教えて」は 1c の封印で `cannot`（事故の事件でも同じ返答なので、犯人がいるとは匂わせない）。
4. 想定質問と類似 ≥ 0.6 → そのラベル。**命題が逆なら反転**（「なかったですよね」⇔「ありましたか」、「回って」⇔「止まって」）。
   軸が違う述語（「壊れていた」と「止まっていた」）は反転せず類似度 ×0.85。
   事件の内容語（キーワード）が片方にしか無い場合は類似度 ×0.65（「一酸化炭素」と「二酸化炭素」を取り違えない）
5. 疑問詞だけの質問（何/なぜ/誰/どこ/いつ…。「何か」「誰か」「誰にも」「何者か」は除く）と、
   **値を問う名詞だけの「〜は？」**（死亡推定時刻は？／気温は？／死因は？／犯人は？／〜とは？）→ `vague`（はい/いいえで訊いて）。
   「毒は？」「外傷は？」のような有無の省略形は はい/いいえ の質問のまま。
   **はい／いいえで答えようのない質問**（`isWhQuestion`: 「犯人は誰ですか」「なぜ〜」に加えて、疑問詞が述語の項になっている「どこで見つかったの？」「いつ倒れた？」「何を吸ったの？」「誰がやったの？」「どんな音？」「どうなっていた？」。
   「何か・誰も・どこにも・いつも・何分も・何となく・誰のせい・〜かどうか」は除く）は、**2 や 4 の想定質問に はい/いいえ/一部 のラベルがあっても** `vague`＋meta `open`（2026-09-25。c02 の「犯人は誰ですか？」→いいえ、c03「どこで見つかったの？」→「裸で見つかった？」の いいえ を拾っていた）。Jev の答えにも同じガード。
   返答は `answer.vague` の「具体的に」ではなく、**疑問詞ごとの言い直し方**（`default-lines.ts` の `OPEN_LINES`: なぜ→『〜のせいですか？』、どこ→『〜でしたか？』、いつ→『〜より前ですか？』、誰→『〜はそこにいましたか？』、何・どう→『それは〜ですか？』など。事件の中身は書かない。line bank に `meta.open.<種類>` があればそちらを使う）
6. 「〜は関係ありますか」→ 指す所見が重要（importance ≥2）なら `yes`、否定済み（ifAsked=no）なら `no`、それ以外 `irrelevant`
7. キーワード所見。どの所見の話かは次の順で決める（routing）。
   キーワードの当たり方（`retrieve.ts`、2026-09-25）: 漢字＋カタカナの複合語は「の」を挟んだ言い方にも当たる（「酸素メーター」→「酸素のメーター」）。
   別の所見の**2文字以上長い**キーワードの中に丸ごと入っている当たりは捨てる（「酸素のメーター」の中の「メーター」は供給容器の残量計の語ではない。1文字差は助詞のことが多いので捨てない: 「暑さが原因」の「暑さ」）。
   想定質問の類似度は、片方だけが状態の述語（動いていた・止まっていた・鳴った）を持つとき ×0.85（「酸素のメーターはありましたか」≠「動いていましたか」）。
   どの所見の話か:
   1. **因果・責め**（「Xのせい／Xが原因／Xのため／Xによって」「Xが悪い／Xは悪くない」）:
      因果そのものを含むキーワード（「弟のせい」「暑さが原因」）があればそれ。X が**人**（弟・家族・友人・大人・同僚・警備員・捜索隊・通行人…）なら
      その事件の「誰のせいでもない」所見（キーワードに 誰のせい／誰かのせい／誰も悪／責め／責任／過失 を持つ否定所見）、無ければ「事件性なし」所見。
      それ以外は目印の直前の語の所見。「Xは悪くない？」は責めの否定なので答えを反転
   2. **意図・行為者**（わざと・故意・意図的・誰かが・何者か・殺され・犯人・事件・第三者…）: その語を含むキーワードの所見を話題の所見より優先。
      無ければ（殺・犯人・事件・何者か・第三者 などの行為者語があるとき）「事件性なし」所見（ifAsked≠yes でキーワードに 殺され/殺人/他殺/犯人/事件/襲われ/故意/わざと… を2つ以上持つもの）
   3. それ以外は得点1位。**1位と同点（差 ≤0.02）の上位3件**では、質問の状態と比べられる所見 → まだ開いていない所見（visibleFromStart でない）→ キーワードの長さ の順で選ぶ
   答え: 質問の述語の極性と、所見のそのキーワードを含む節の極性を**同じ軸で**比べる。比べられないときは `fact.ifAsked`（否定確認・責めの否定なら反転）。
   - **状態の兄弟所見**（2026-09-25）: 状態を問う質問（動いていた？）が「物がある」だけの所見（「酸素濃度計が取り付けられていた」）に当たり比べられないとき、
     その所見の物の名前（所見のキーワードで本文にもある3字以上の語）を含み、その節の状態がはっきりしている別の所見（「酸素濃度計は電池が切れて…」）で答える（全部が同じ向きのときだけ）。
     以前は「酸素の計器は動いていましたか？」→ ifAsked の はい（嘘）。今は いいえ＋その所見のカード。
   - **打ち消された修飾語**（2026-09-25）: 「はい」になった質問に、事件が否定している性質の語（毒・有毒・毒性・有害・劇物・可燃・燃え・引火・放射…）が別の否定所見（ifAsked=no）のキーワードとして当たっていて、
     その語が肯定の形なら、修飾（「毒ガスが出ていましたか？」＝ガスは出た・毒ではない）→ `partial`、述語（「窒素ガスは有毒ですか？」）→ `no`。否定所見のカードを先に付ける（trace の `qualifier`）。
     以前は「毒ガスが出ていましたか？」「何か有毒なガスが出ていましたか？」→ はい（ガスの所見）で、科学解説・誤解リスト・クイズと矛盾していた（ホルマは嘘をつかない、が崩れる）。
     「危険なガス」は対象外（窒素ガスは実際に危険。毒ではないだけ）。Jev が はい と答えても同じ答えに下げる（`raw.qualifierGuard`）
   - 軸: 動く/止まる・鳴る・点く・電池が切れる・足りる/減る・ある/ない（state）と 開く/閉まる（open）は互いに比べる。**壊れる/故障（broken）は別の軸**。
   - 「壊れていた？」に対し所見に壊れた話が無いとき: 所見が「動いていない（止まっていた・電池切れ）」なら `partial`、それ以外は `no`（壊れていない）
   - 「閉め忘れ／止め忘れ／消し忘れ」は逆の状態（閉め忘れた＝開いたまま）。「鳴らなかった」「動かなくなった」は止まった側の状態語として読む
8. 類似 0.45 以上の想定質問が `irrelevant` → `irrelevant`
9. それ以外 → `vague`

汎化性能（想定質問を1問ずつ抜いて当てる leave-one-out。2026-09-24、同じ事件データで比較）:
| 事件 | 自己一致 | leave-one-out（修正前 → 修正後） | 2026-09-25（上の追加後） |
|---|---|---|---|
| c01 | 100% | 61.8% → 67.5% | 68.1% → **68.4%** |
| c02 | 100% | 56.7% → 59.7% | 60.1% → 60.1%（自己一致 99.6%: 「犯人は誰ですか？」のラベル いいえ を疑問詞ガードが vague にする。ラベルを vague に直すのが正しい） |
| c03 | 100% | 75.4% → 76.8% | 76.8% → **77.3%** |

全 823 問のベンチ（leave-one-out、rules）: 73.2% → **73.4%**、所見一致 77.5 → 77.7%、質問の型 87.9 → 88.0%。

（ほぼ同文なら 100%。レビューで足した想定質問の多くは rules が一般化できない言い回しを個別に塞ぐものなので、LOO は低めに出る。）
キーワードの読み・言い換え・表記ゆれを事件データに足すほど上がる。

### 開示の規則（policy.ts）
| 条件 | 内容 |
|---|---|
| 回答 | `yes` / `no` / `partial` のみ開示。`irrelevant` `cannot` `vague` は開示しない |
| 確信度 | 0.5 以上（spoilerLevel 2 は 0.6 以上かつ当て推量でない） |
| spoilerLevel 3 | 確信度 0.75 以上 **かつ** その所見への一致の強さ 0.7 以上 |
| spoilerLevel 4 | **カードにならない**。はい/いいえの答えは返す（正解の確認がゲーム）→ `nearCore` |
| requires | 前提の所見がすべて開示済み |
| 枚数 | 1回答で最大2枚 |
| 科学メモ | `fact.scienceMemo`（scienceMemos の id）が所見と一緒に開く |

進捗 = 開示済み所見の破片重み / 全体。重み: importance 0→0, 1→1, 2→2, 3→3, 4→0。解決後は 1。
`progress.nearCore`（状態・以後ずっと点灯）は「spoilerLevel 4 の話題を**正しく確認**した」「closeness 3 で はい/一部そう（否定確認への いいえ）」「進捗 75% 以上」で点灯。
「正しく確認」= 答えがその所見の向き（`ifAsked`、否定確認なら反転、一部そう≒はい）と合うこと。**「毒ですか？」→いいえ に判定モデルが死因の所見を付けても、核心には近くない**（以前はこれでも点灯して「近い」と言っていた）。

`AskAnswer.nearCore`（この答えが核心に迫った瞬間。ホルマの反応・破片の明滅の合図）は、次のどれか:
- まだ確認していない spoilerLevel 4 の所見を**初めて**正しく確認した（確認済みはトークンの `k` に記録）
- 状態がまだ消えているときに closeness 3 で はい/一部そう
- この答えで状態が点灯した（進捗 75% を超えた など）
同じ核心を何度確認しても2回目以降は立たない。AI プレイテストで Jev は話題に乗った質問の最大 25/40 問に closeness 3 を付けたので、毎回だとホルマが毎ターン「近い」と言うことになる。
**定型文の「核心接近」の一言も同じ条件**で付く（旗と台詞が必ず一致する）。trace の各パートにも `nearCore`。

---

## 3. モード（PIPELINE_MODE）

| mode | 判定 | 返答 | 用途 |
|---|---|---|---|
| `rules` | rules-judge | 定型文 | オフライン・QA・退避先・静的版 |
| `jev` | JevJudge | 定型文 | 本番の既定 |
| `jev+llm` | JevJudge | LlmRenderer | 表現比較 |
| `jev+llm+check` | JevJudge | LlmRenderer → JevPostChecker | MODE C |
| `llm` | LlmJudge（行も返す） | 判定モデルの行 | MODE A（基準線） |

- 組めない部品（キー無し・スタブ）は factory が外し、実際に組めたモードに**降格**（`warnings` と `/api/admin/status` に出る）。
- 想定質問とほぼ同文（≥0.97）・空/長すぎ/暴言はモデルを呼ばない。
- モデル失敗（timeout / 429 / 5xx / network）は1回再試行 → その問だけ rules（`error.degraded` の一言を前置、trace に `degraded`）。config / bad_request は即退避。
- 1ターン 9 秒の締切（ブラウザ側は 12 秒）。締切が近いとモデルを呼ばない。
- `DAILY_COST_LIMIT_USD` を超えたら当日（UTC）中は rules（前置きなし、trace に `budget`）。インスタンスごとのメモリ集計なので目安。

### 死因宣告の判定（verdict.ts）
- 文を「。」などで文に、「、」と接続（〜たが・けど・ので・のに・〜ではなく）で節に分ける。
- **否定は言及ごと**に見る: キーワードの直後が「ではない／じゃない／ではなく／は関係ない／無関係／とは違う／のせいではない／はいない／は検出されなかった／〜ていない／わけではない／〜の形跡はない／AもBもなく／と思われた・だと思い込んだ（他人の誤解）」なら、その言及は否定。
  複合語の中のキーワード（「毒物は認められなかった」の「毒」）は複合語ごと判定。「A、B、Cはいずれも認められなかった」の A・B も否定。
  **「酸素がなくなった」「足りなくなった」「少なくなる」は否定ではない**（答えそのものの描写）。「暑いと思い込んで」のような本人の錯覚も否定ではない。
- 答えの要素（answerElements）も誤主張（wrongClaims）も、**否定されていない言及**だけで一致する（「液体窒素は関係ない」は要素 B にならない）。
- **誤主張が1つでも肯定されたら、結果は最良でも `missing`**（要素が1つも無ければ `wrong`）。返答は `verdictWrong` の一言＋その誤主張の `feedback`（最大2つ）。要素の不足ヒントは添えない。
- VerdictJudge（モデル）: 要素の確率 **≥0.85**（2026-09-25 に 0.7 から変更）は一致を**足せる**。誤主張の確率 ≥0.7 は**それだけで止める**。rules が肯定した誤主張は、モデルが 0.4 未満と言ったときだけ取り消す。
  0.85 の根拠: 回帰の宣告 144 文＋AI プレイテストの宣告 20 文（手でラベル付け）で、Jev の 0.7〜0.85 は誤った仕組み（「力んで迷走神経反射」「錯乱して脱いだ」）を `correct` にしただけで、正しい宣告を救った例は無かった（回帰 141→142/144、プレイテスト 15→17/20、正解の取りこぼし 0）。
  rules の一致をモデルの低確率で取り消す案（veto）は正解を落とすので採らない（veto 0.2 で回帰 137/144）。
- 回帰: `tests/engine/verdict.test.ts`（c01 査読の3文・各事件の真相文が `correct`）、`tests/content/regression/*.json` の宣告セット。

### 難易度別の宣告（verdict-modes.ts・2026-09-25）
難易度はブラウザの保存に持つ（サーバーは知らない）。`VERDICT_MODE_BY_DIFFICULTY`: 見習い easy→`choice`、審問官 normal→`cloze`、教授 hard→`free`（従来の自由記述）。
事件データは `verdictModes`（秘密。`shared/case-schema.ts`）。無い事件は `verdictSetup` が `available:false`＋free の形を返し、UI は自由記述に戻す。
- **表示の順番**: 選択肢も穴埋めの候補も、再構成と同じ `optionOrder` で事件ごとに固定の並べ替え（鍵 `<caseId>:verdict:choice` / `<caseId>:verdict:cloze:<blankId>`）。
  作者が正解を先頭に書いても、表示で先頭に固定されない。`verdictSetup` と判定は同じ並べ替えを使うので、ブラウザは正解を知らずに**表示順の番号**を送ればよい。
- **議論の助け（assists）**: 突破したラウンド（トークンの `r`）の assist だけ効く。choice＝**誤りの**選択肢を `removed:true`（正解は絶対に消さない。データが正解を指していても無視）、
  cloze＝その空欄の `filled`＝正解の表示番号、free＝`revealed` に要素 id（ラベルだけ。要素の説明・キーワードは出ない）。
  `assistsEarned / assistsTotal` はそのモードで効く**対象の数**（重複・無効な参照は数えない）。
- **choice の判定**: 正解の選択肢 → `correct`（matched＝全要素、labels＝要素ラベル）、それ以外 → `wrong`（matched 空）。
  外れの選択肢の文が誤主張（wrongClaims）に当たれば、その `feedback` を台詞に添える（自由記述と同じ。答えは言わない）。
- **cloze の判定**: 全空欄正解 → `correct` / 一部 → `missing`（matched＝正解した空欄 id、labels＝空欄 id→空欄ラベル）/ 0 → `wrong`。assist で埋まった空欄は送らなくてよい（正解として扱う）。
- どのモードも `verdictAttempts` を1増やし、`correct` で `solved`・`nearCore` を立てる（解決済みなら数えずに `correct`）。台詞は line bank の verdictCorrect / Missing / Wrong。
- **不正な入力は 400 `bad_request`（数えない）**: 不明な mode、choice が無い／不明／assist で消えた選択肢、blanks が無い・配列・不明な空欄・範囲外・整数でない・（assist 以外の）空欄の欠け、verdictModes の無い事件への choice/cloze。
- 安全フィルター（`selfHarm`）と 600 字の上限は自由記述だけ（choice / cloze に文章は無い）。trace は `choice:<id>` / `cloze:place=0,…` だけを記録。

### AI 部品（実装済み・詳細は docs/ai.md）
`server/engine/judge-types.ts` の冒頭コメントが契約。実装ファイルとシグネチャ（旧スタブはすべて置き換え済み）:
- `server/engine/providers/jev.ts` → `createJevProvider(env): DecisionProvider`
- `server/engine/providers/openrouter-llm.ts` → `createOpenRouterLlm(env): LlmProvider`
- `server/engine/providers/codex.ts` → `createCodexLlm(env): LlmProvider`（Node 専用処理は server/node/ に置き動的 import）
- `server/engine/ai/jev-judge.ts` → `new JevJudge({ provider, model, strategy?, prompt? })`（`warm()` で目覚まし）, `new JevVerdictJudge({ provider, model })`, `new JevPostChecker({ provider, model })`
- `server/engine/ai/llm-renderer.ts` → `new LlmRenderer({ llm })`（`canned = false`）
- `server/engine/ai/llm-judge.ts` → `new LlmJudge({ llm })`（`JudgeDecision.line` に一言を入れてよい）

`JudgeDecision.flags.selfHarm ≥ 0.5` を返すと pipeline は安全フィルターと同じ返答にする（所見・言い換えなし、notice 'support'）。
守ること: 失敗は `ProviderError` を投げる（握りつぶさない）/ `usage` を返す / `raw` に生の判断を入れる /
`signal`・`timeoutMs` を尊重 / モデルに渡す所見は `candidates`（判定）か `allowedFacts`（言い換え）だけ。
開示の可否は policy.ts が決めるので、Judge は「どの所見の話か・どれだけ確かか」を正直に返せばよい。
テストでは `makeService({ components: { mode: 'jev', judge: <偽物>, warnings: [] } })` で差し込める（tests/engine/pipeline.test.ts 参照）。

---

## 4. 事件の追加（コード修正なし）

1. `content/cases/<id>/case.json` を置く（`id` はフォルダ名と同じ。形式は `shared/case-schema.ts`）
2. `npm run validate` — エラー 0 まで直す（警告は通る）
3. `npm run dev` — dev サーバーは case.json の変更を次のリクエストで自動再読込
4. `publish: false` の間は本番の一覧に出ない（dev と管理者には見える）
5. 試作の事件（`proto: "seeds"`・`proto: "tsukuru"`、2026-10-04〜）は、プレイヤーの切り替え `?proto=seeds`・`?proto=tsukuru` があるときだけ一覧・取得できる（`publish` によらず、dev と管理者でも同じ。管理 API の mint-token・ask-debug と管理画面の一覧は全部見える）。ブラウザはヘッダー `x-janedoe-proto` で切り替えを送り、静的版は埋め込みエンジンに渡す。オンライン対戦の部屋には使えない。正本は `shared/proto.ts`・`registry.ts` の `list(includeUnpublished, protos)` / `get(id, includeUnpublished, protos)`。ブラウザ側の写し `PROTO_CASES` と case.json の `proto` は validate とテストが一致を確かめる

読込経路:
| 実行環境 | 読み方 |
|---|---|
| vite dev / preview、tsx スクリプト、テスト | `server/node/content-fs.ts`（fs。`CONTENT_ROOT` か自動検出） |
| Vercel | 同上。`vercel.json` の `includeFiles: "content/**"` で関数に同梱 |
| 静的版（`--mode static`） | `src/api/embedded.ts` の `import.meta.glob('../../content/cases/*/case.json')` |

壊れた事件（JSON 不正・スキーマ違反・id 重複）は**その事件だけ**スキップし、`GET /api/admin/cases` の `issues`、
サーバーのコンソール、`npm run validate` に出る。ほかの事件は動き続ける。
`content/holma-lines.json` が無い・一部不正 → 使えない節だけ内蔵の既定セリフ（`default-lines.ts`）で補う。

### validate の検査項目
スキーマ / 真相・死因あり / 核心所見（importance ≥3）あり / ヒントちょうど3つ（1,2,3）/ 答えの要素と solveRule の id /
出典 3件以上・https / id の重複 / 参照先の所見が存在（想定質問・requires・related・議論の答え・alsoAccept・伏線）/
requires の循環 / 議論の答えの span が `[[...]]` の中にあり、その所見が証拠として使える（spoilerLevel ≤3・importance ≥1）/
議論の各ラウンドの成功台詞（success）が空でない（wrongShot・hint の空は警告）/
再構成の選択肢の正解がちょうど1つ / クイズの答え番号 / 公開欄（導入・**内容の注意書き contentWarning・場所 intro.location・時刻 intro.time**・ナレーション・例チップ・ジェーンとホルマの台詞・事件ごとのホルマの台詞（holmaLines.idle / nearCore）・科学メモ・
spoilerLevel ≤2 の所見文とカード名）に `leakTerms` が無い / 画像ファイルの存在（背景・肖像・再構成コマの `image` → `public/<path>`。無ければ**警告**。
`npm run validate` と管理 API が確認する。純粋関数の validate.ts には `assetExists` で注入）/ 想定質問の種類（yes/no/irrelevant/core/spoiler-bait/paraphrase/typo/negated）/
**verdictModes**（選択肢の正解ちょうど1つ・id 重複なし・**正解を匂わせる id（correct / wrong / answer / dummy / seikai / hazure…）はエラー**＝ブラウザに出るため・
空欄の `{{id}}` とテンプレートが双方向に一致・答えの番号・候補の重複、assist のラウンド／**誤りの**選択肢／空欄／要素の参照。
警告: 公開事件に verdictModes が無い・誤りの選択肢が自由記述の判定で `correct` になる（ラベルの付け間違い？）・正解だけ極端に長い・assist が誤りの選択肢を全部消す／空欄を全部埋める。
情報: 正解で埋めたテンプレートが自由記述の判定で `correct` にならない。**verdictModes の中の leakTerms は検査しない**（宣告の場面でしか出ないため）） /
**rules 自己一致率 ≥95%**（想定質問をそのまま rules に通して正解ラベルが出るか。外れは警告に列挙）/
真相の文章そのものが死因宣告で `correct` になるか（警告）/ 想定質問が一つも触れない所見（警告）/ leave-one-out 汎化率（情報）。

---

## 5. HTTP API

| メソッド | パス | 本体 → 応答 |
|---|---|---|
| GET | `/api/health` | 公開: `{ok, version}` だけ（設定不備の本番は 503 `{ok:false}`）。dev・管理者: mode・事件数・秘密鍵・予算・稼働時間 |
| GET | `/api/cases` | `CaseSummary[]` |
| GET | `/api/cases/:id` | `CasePublic` |
| POST | `/api/token` | `{caseId}` → `{token, progress}` |
| POST | `/api/ask` | `AskRequest` → `AskResponse`（token 省略可 = 新規。`limit` は教授の質問枠、§2 質問枠） |
| POST | `/api/hint` | `HintRequest` → `HintResponse`（1→2→3、以後3） |
| POST | `/api/inquest/start` | → `InquestStartResponse`（証拠 = 開示済み importance ≥1） |
| POST | `/api/inquest/shot` | `ShotRequest` → `ShotResponse`（同ラウンド2回外すと `hint`） |
| POST | `/api/inquest/grant` | `GrantRequest` → `ShotResponse`（`granted`。持っていれば減点なしでヒントだけ） |
| POST | `/api/inquest/verdict-setup` | `VerdictSetupRequest`（`mode` 必須）→ `VerdictSetupResponse`（トークン検証のみ・新トークンは返さない。§3 難易度別の宣告） |
| POST | `/api/inquest/verdict` | `VerdictRequest` → `VerdictResponse`。`mode` 省略＝`free`（`text` ≤600字）/ `choice`（`choice`＝選択肢 id）/ `cloze`（`blanks`＝空欄 id→表示順の番号） |
| POST | `/api/reconstruction` | 解決済みのみ。空白コマは caption/scene/image を隠し、選択肢は事件ごとに固定の並べ替え。再構成完了後は全部見せる |
| POST | `/api/reconstruction/submit` | `picks`（表示順の番号）→ コマごとの正誤・`allCorrect`・`finale` |
| POST | `/api/solution` | 解決済みのみ `SolutionResponse` |
| GET | `/api/admin/status` | 実際の mode・警告・費用 |
| GET | `/api/admin/cases` | 全データ＋検査結果＋読込エラー |
| GET | `/api/admin/traces?limit=&caseId=` | 直近 300 ターン |
| POST | `/api/admin/ask-debug` | `{caseId, question, token?, mode?}` → trace 付き（mode を一時上書き） |
| POST | `/api/admin/mint-token` | `{caseId, stage, asked?}` → `{token, progress}`（`asked` を渡すと質問数と質問枠の消費をその数にする。QA 用）。QA・画面作りの近道。stage: `fresh`（初期）/ `investigated`（spoilerLevel ≤3 の所見とメモを全部・質問数20）/ `debated`（＋全ラウンド突破）/ `solved`（＋宣告正解）/ `reconstructed`（＋再構成完了）。不明な stage は `investigated`。管理 API と同じく dev か `x-admin-token` のときだけ（本番の通常利用者には 404） |
| GET | `/api/admin/bench` | `bench/reports/*.json` の一覧（無ければ `[]`） |
| GET / POST | `/api/versus/config` ・ `/api/versus/{create,join,start,state,run,progress,leave}` | オンライン対戦（2026-09-27）。部屋・席・部屋に結びついたトークン・勝敗。詳細は **`docs/versus.md` §3**。`/api/inquest/verdict` の応答は対戦の部屋にも記録される（`observeVerdict`） |
| POST | `/api/admin/versus-bind` | `{seat, token}` → 部屋に結びつけたトークン。**dev サーバーだけ**（QA 用。本番は管理トークンがあっても 404） |

- エラーは `{ "error": { "code", "message", "retryable" } }`。code は `ApiError` と同じ:
  400/404/405/413/403 → `bad_request`、401 → `bad_token`、429 → `rate_limited`（`Retry-After` 付き）、5xx → `server`。
- 管理 API は dev では常に開く。本番は `x-admin-token` ヘッダーが `ADMIN_TOKEN`（**32文字以上**。短いと管理 API は無効のまま・起動時にエラーログ）と一致したときだけ（それ以外は 404）。
  比較は固定長の HMAC 同士（長さを漏らさない）。**間違ったトークンは IP ごとに 10回/分・50回/日まで**（どのルートでも数える）。超えたらその IP のトークン付きリクエストは正しいトークンでも 429。
- **設定不備の本番は閉じる（fail closed、2026-09-25）**: 本番（`APP_ENV=production`）で `SESSION_SECRET` が未設定・.env.example の値・32文字未満なら、
  すべての POST（トークンを作る・検証するルート: token / ask / hint / inquest/* / reconstruction/* / solution、管理の mint-token / ask-debug）が
  `503 {code:'server', message:'server misconfigured', retryable:false}`。公開の `/api/health` も 503 `{ok:false}`。`/api/cases` は動く（タイトルは出る）。
  署名鍵は公開の開発用固定値ではなくプロセスごとの乱数になる（どこかが漏れても偽造できない）。以前は開発用固定値で署名して警告を出すだけで、`/api/health` の `secretConfigured:false` を見た誰でも解決済みトークンを作って真相を読めた（監査 qa/audit/forge.mjs）。
  `vite preview`（ローカル）は `SESSION_SECRET` が無ければプロセスごとの乱数鍵を自動で入れる（再起動でトークンが無効になるだけ）。Vercel では入らない。
- `trace` は dev か管理者のときだけ応答に入る。
- `/api` より前にパスが付いていても動く（例 `/games/janedoe/api/cases`）。

### 制限
| 項目 | 値 |
|---|---|
| 質問 | 200 字（超えると 400。エンジン直呼びでは「長すぎ」の一言） |
| 死因宣告 | 600 字 |
| リクエスト本文 | 8 KB（413） |
| ask | IP ごと 30回/分・600回/日 |
| verdict | 12回/分・200回/日 |
| その他の POST | 120回/分・3000回/日、GET 240回/分（公開 health も）、管理 120回/分 |
| 間違った `x-admin-token` | 10回/分・50回/日（超えたら正しいトークンでも 429） |
| 1トークンあたりの質問 | 400（`QUESTION_CAP`。超えると 429 `rate_limited`, retryable=false） |
| IP | `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for` 先頭（ローカルはソケットのアドレス） |

レート制限はインスタンスごとのメモリ（スライディングウィンドウ）。本気の乱用対策は Vercel WAF と OpenRouter キーの上限で。

---

## 6. 進行トークンと秘密の守り方

- 形式 `j1.<payload base64url>.<HMAC-SHA256 base64url>`。payload は
  `{v, c: 事件id, u: 開示所見, m: 科学メモ, n: [質問数, ヒント, 反証の外れ（反応なし）, 泣きつき, 宣告回数], rm: ラウンド別ミス, r: 突破ラウンド, f: 解決1|再構成2|nearCore4, k?: 確認済みの spoilerLevel 4 所見, t: 発行秒}`。
  `k` は空なら省く（旧トークンは `[]` として読む）。
  `q`（省略可能、2026-09-28）: 質問枠に数えた数 `spent`。`asked` と同じなら省く（旧トークンは `spent = asked`）。`asked` より大きいと不正なトークン。
  `vs`（省略可能、2026-09-27）: オンライン対戦の部屋の結びつけ `<部屋コード>.<nonce>.<プレイヤーid>.<e|n|h>`（`server/engine/room-binding.ts`）。
  対戦の開始時にだけサーバーが付け、以後の操作は状態を引き継ぐので残る。付いたトークンは部屋の難易度の宣告形式でしか宣告できない（`game.ts` `checkRoomMode`）。無いトークンは従来どおり。`docs/versus.md` §6。
- 毎回の呼び出しで検証（改ざん・別事件・形式違い・未来/期限切れ 120日 → 401 `bad_token`）し、毎回新しいトークンを返す（使っている限り期限は延びる）。
- 事件データが後から変わっても、存在しない id はトークン読込時に捨てる（エラーにしない）。
- 署名は WebCrypto（Node 20+ / ブラウザ）。安全でない http の LAN などで `crypto.subtle` が無いブラウザでは純 JS の HMAC（テストで一致を確認）。
- 鍵は `SESSION_SECRET`（本番は **32文字以上の乱数**）。dev で未設定なら開発用の固定値（警告）。**本番で未設定・短い・.env.example のままなら 503 で閉じる**（§5。以前は開発用固定値で署名していたので、解決済みトークンを偽造して真相を読めた）。
- ブラウザに出るのは `public-view.ts` を通ったものだけ: 事件の公開情報、開示済みの所見と科学メモ、解決済みトークンがあるときの真相・科学解説。
  真相・全所見・想定質問・判定メモ・正解要素・再構成の正解・被害者の名前・leakTerms は出ない（テストで確認）。
- LLM の言い換えは、まだ開示していない所見に含まれる `leakTerms` が混じったら捨てて定型文に戻す（mode C ではさらに Jev 検査）。
- **静的版（`npm run build:static`）は秘密を守れない**。エンジン・全事件データ・固定鍵 `janedoe-embedded-insecure-key` を同梱する（オフライン・QA・静的ホスティング用）。
  http 版のビルドには埋め込みエンジンは入らない（`__JANEDOE_EMBEDDED__` が false の分岐はビルド時に消える。確認済み: http 版 2KB / static 版は embedded チャンク約450KB）。

---

## 7. 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `OPENROUTER_API_KEY` | — | サーバーだけが読む。ログにも応答にも出さない |
| `SESSION_SECRET` | dev: 開発用固定値 | トークンの HMAC 鍵。**本番必須・32文字以上**（無い・短いとトークンを扱う全ルートが 503） |
| `PIPELINE_MODE` | キーあり→`jev` / なし→`rules` | §3 |
| `DECISION_PROVIDER` | `jev` | `rules` にすると判定モデルを呼ばない |
| `JEV_MODEL` | `typesafe/jev-1.13` | |
| `JEV_CANDIDATES` | `all+prior` | 判定に渡す所見（docs/ai.md §3-2。`topk+prior` で費用 1/4・正答率 −3.6pt） |
| `JEV_PROMPT` | `v2` | 判定の基準文と下書きの書き方（`v1` = 2026-09-24 版。比較・切り戻し用。docs/ai.md §5-6） |
| `LLM_PROVIDER` | `none` | `openrouter` / `codex` / `none` |
| `LLM_MODEL` | — | OpenRouter のモデル名 |
| `DAILY_COST_LIMIT_USD` | `1` | 0 = 有料モデルを使わない、負 = 無制限 |
| `ADMIN_TOKEN` | — | 本番の管理 API 用。**32文字以上**（短いと管理 API は無効） |
| `APP_ENV` | vite dev→`development`、preview/Vercel→`production` | dev は管理 API 開放・trace 返却・JSONL ログ・非公開事件表示 |
| `QUESTION_CAP` | `400` | 1トークンの質問上限 |
| `CONTENT_ROOT` | 自動 | content/ の場所 |
| `TRACE_FILE` | — | `0` で dev の JSONL ログを止める |
| `VITE_API_MODE` / `VITE_API_BASE` | — / `/api` | ブラウザ側（ビルド時） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | — | オンライン対戦の部屋の置き場所（Upstash Redis REST）。Vercel の連携が入れる `KV_REST_API_URL` / `KV_REST_API_TOKEN` でも可。本番で無ければ対戦は無効 |
| `VERSUS_STORE` | — | `memory` で1プロセスのメモリに部屋を置く（`vite preview` 用。Vercel では無視）。dev は常にメモリ |
| `VERSUS_ENABLED` | — | `false` で対戦を止める |

`.env` / `.env.local` / `.env.[mode]` は Vite プラグインが `loadEnv(mode, root, '')` で読む（process.env が優先）。

---

## 8. 配備

- **Vercel**: `vercel.json` — build `npm run build`、出力 `dist`、関数 `api/router.ts`（Node、15秒、1GB、`content/**` 同梱）、
  拡張子の無いパスは `index.html` へ（`/api` 除く）、セキュリティヘッダー（CSP・HSTS・nosniff 等）、`/assets` は長期キャッシュ。
  環境変数は §7 を Vercel の Project Settings に入れる（`SESSION_SECRET` 必須・32文字以上。無いと token 系ルートが 503 — 配備直後に `/api/health` が 200 か確かめる）。
  事件開始時の Jev の目覚まし（§2）は応答後の非同期処理なので、Vercel では止められて効かないことがある（`@vercel/functions` の `waitUntil` を使えば確実だが、依存追加は持ち主の判断待ち）。
- **静的ホスティング**（fourthplace43.com/games/ など）: `npm run build:static` の `dist/` をそのまま置く（`base: './'`）。API 不要・rules 固定。
- ローカル: `npm run dev`（5190、API 付き）/ `npm run preview`（4191、API 付き・本番相当）/ `npm run dev:static`（埋め込みエンジン）。
  ※ 4190 は Chromium・Node `fetch` の「危険ポート」なので preview は 4191 に変更済み（vite.config.ts）。

---

## 9. UI 実装者へ（src/**）

- `import { api } from '../api'` だけを使う。失敗は `ApiError`（`code` で分岐: `network`/`timeout` → 再送ボタン、`rate_limited` → 少し待つ、`bad_token` → その事件のセーブをリセットして `newToken`）。
- 通信（`src/api/http.ts`、2026-09-25）: 1回の呼び出し全体で約12秒（`REQUEST_DEADLINE_MS`。1回目 11秒）。サーバーは1手を9秒で打ち切るので、それ以上待っても来ない。
  自動の再送は1回だけ、**2秒以内に失敗したとき**（接続できない・500/502/503・本文が壊れている）に限る。タイムアウト・504・`retryable:false`（設定不備の 503 など）は再送しない。以前は 12秒×2＋再送で、止まった要求のエラー表示まで 24.6秒かかった。
- `slowRequests`（`src/api` から export、`@preact/signals`）: 5秒を超えて待っている HTTP 呼び出しの数。0 より大きい間、検分中の行にホルマの「まだ調べています」の一言を出せる（`error.network` の台詞を流用してよい）。埋め込み版では常に 0。
- 返ってきた `token` は毎回保存し直す（localStorage、try/catch）。`progress` がそのまま画面の状態。
- `AskAnswer.line` は複数の一言を `\n` で連結していることがある（前置き・本体・所見入手・核心接近）。`white-space: pre-line` で表示。
- はい／いいえで答えられない質問（「なぜ倒れたの？」「どこに当たったんですか」「犯人は誰？」）は `answerClass: 'vague'` で、`line` は疑問詞ごとの言い直し方（『〜のせいですか？』のような型。事件の中身は含まない）。書き直し案を札にして出す API はまだ無い。
- `AskAnswer.nearCore`: この答えで核心に迫った瞬間だけ `true`（§2 開示の規則）。ホルマの驚き・破片の明滅はこれで出す（台詞本文の照合は不要）。`progress.nearCore` は「もう核心の近くにいる」状態。
- `ShotResponse.speaker`: `'jane'` = `lines` は所見を正しく当てた（反応あり）ときのジェーンの記憶（突破済みラウンドにもう一度当てたときも同じ）、`'holma'` = 外れ・ヒント・泣きつきのホルマの台詞。
- `SolutionResponse.reviewStatus`: 事件の `reviewStatus`。`human-reviewed` 以外なら科学解説に「専門家確認前の下書き」を出す。
- `AskAnswer.notice`: `'support'`（安全フィルター。真剣な台詞の横に相談窓口カード https://www.mhlw.go.jp/mamorouyokokoro/ を出す。スタンプや茶化し演出は出さない）/ `'degraded'`（簡易判定で答えた。控えめな印）。安全フィルターの返答は `answers` が1つだけ（質問文はメッセージ全体）。
- 複数質問は `answers[]` に分割された順で返る。`question` は分割後の原文（先頭の「それと」「あと」は除去済み）。
- 質問数（`progress.asked`）は空入力・長すぎを数えない。質問枠の消費は `progress.spent`（省略されていれば `asked`）、数えないパートは `AskAnswer.free`。
- 集中力（5）とラウンド中の演出は UI 側で管理（サーバーは `correct` と `hint` を返すだけ）。泣きつき回数は `ProgressSnapshot` に無いので UI 側で数える（トークン内部には記録）。
- 再構成の `picks` は**表示された順番の番号**。完了後に `reconstruction()` を呼び直すと空白コマの caption / image も返る。
- 死因宣告が `correct` になるまで `reconstruction` / `solution` は 403（`bad_request`）。
- 難易度別の宣告: 宣告画面を開くたびに `api.verdictSetup({caseId, token, mode: VERDICT_MODE_BY_DIFFICULTY[difficulty]})`。`available:false` なら自由記述の画面（返る `mode` は `'free'`）。
  choice は `options[].id` をそのまま `verdict({mode:'choice', choice})` へ（`removed:true` は押せなくする。送ると 400）。
  cloze は `blanks[].options` の**表示順の番号**を `verdict({mode:'cloze', blanks:{[id]: index}})` へ（`filled` のある空欄は固定表示。送っても省いてもよい）。
  cloze の `missing` は `matched`（正解した空欄 id）と `labels`（空欄ラベル）で空欄ごとの正誤を出せる。ライフ（`LIVES_BY_DIFFICULTY`）は UI が数える（サーバーは `verdictAttempts` だけ）。

---

## 10. 検証

```
npx tsc --noEmit            型
npm run test:engine         エンジンのテスト（tests/engine/**。実事件の想定質問も rules で流す）
npm run validate            事件の検査（エラーで exit 1）
npm run build / build:static
npm run qa                  通しプレイ（タイトル→…→事件ファイルのランク、rules モード、:5198、qa/flow/）
npm run qa:mobile           同じく 390x844
```
計測: dev は `logs/trace-YYYY-MM-DD.jsonl`、本番は 1ターン1行の JSON をコンソールへ、管理 API で直近 300 件。
dev の JSONL は**90日より古いファイルを起動時に削除**（`server/node/trace-file.ts` の `pruneTraceFiles`。プライバシーの約束「90日以内」）。
安全フィルターに当たった質問の本文はどこにも記録しない。

AI にケースを遊ばせる（公開前の確認。docs/playtest-report.md）:
```
npx tsx scripts/playtest.ts --dry-run                  無料（rules 判定＋台本プレイヤー）で配線だけ確認
npx tsx scripts/playtest.ts --max-usd 0.3              5人物 × 3事件（約$0.2）→ bench/reports/playtest/<日時>/
npx tsx scripts/playtest.ts --case c02 --persona clumsy,adversarial --max-usd 0.05
npx tsx scripts/playtest.ts --analyze bench/reports/playtest/<日時>   保存済みの記録を分析し直す（無料）
```

回帰:
```
npx vitest run tests/engine/safety.test.ts    安全フィルター（全事件の想定質問で誤検知なし）
npx vitest run tests/engine/verdict.test.ts   宣告の否定・誤主張の優先
npx vitest run tests/engine/routing.test.ts   因果・責め・意図・軸・名詞だけの問い
npx vitest run tests/content                  事件ごとの回帰セット（STRICT_PENDING=1 で保留分も検査）
```
