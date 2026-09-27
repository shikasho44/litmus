# -*- coding: utf-8 -*-
"""AIプレイテストの記録から、「審問を開いた時点で、所見が足りていたか」を人物×事件×モデルで集計する（2026-09-28）

  python scripts/playtest_sufficiency.py <reportDir> [<reportDir> ...] --out bench/reports/playtest/sufficiency_2026-09-28.html

ヨンサンの依頼（9/28 0:0x）：何も知らない状態から、水平思考の質問だけで、審問を開くのに足りる所見を
どれだけ集められるか。大人から子供まで、いろんな立場とモデルで確かめる。

■ 「足りる」の測り方
  審問（ノイズ・ブレイク）は事件ごとに数ラウンドあり、各ラウンドは撃ち抜くのに使える所見が決まっている
  （case.json の debate[].answer.fact と alsoAccept）。
  **最初に審問を開いた時点までに手に入れた所見**で、何ラウンド分を撃てたかを数える（= 審問カバー率）。
  あわせて次も記録する。
    ・審問を開くまでの質問数、ヒント数
    ・審問中に「救済」（詰まったときにゲームが所見を渡す grant）を使った回数
    ・死因宣告の最終結果（正解／ほぼ正解／不足）
  「解決」でも、救済やヒントに頼っていれば、所見を自力で集め切れていないことになる。
"""
import json, sys, argparse, html, glob, os
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]


def load_cases():
    cs = {}
    for p in glob.glob(str(ROOT / "content" / "cases" / "*" / "case.json")):
        c = json.load(open(p, encoding="utf-8"))
        rounds = [(r["id"], {r["answer"]["fact"], *r.get("alsoAccept", [])}) for r in c.get("debate", [])]
        ft = {f["id"]: f.get("cardTitle") or f.get("title") or f.get("text", "")[:24] for f in c["facts"]}
        rinfo = {r["id"]: {"title": r["title"], "span": r["answer"]["span"], "facts": [r["answer"]["fact"], *r.get("alsoAccept", [])]}
                 for r in c.get("debate", [])}
        cs[c["id"]] = {"title": c["title"], "rounds": rounds, "nfacts": len(c["facts"]), "ft": ft, "rinfo": rinfo}
    return cs


def analyse(run, case):
    opened = run["inquestOpenedAt"][0] if run["inquestOpenedAt"] else None
    held = set()
    for a in run["asks"]:
        if opened is not None and a["turn"] > opened:
            break
        for u in a.get("unlocked", []):
            held.add(u["id"])
    cover = sum(1 for _, ok in case["rounds"] if held & ok)
    per_round = {rid: bool(held & ok) for rid, ok in case["rounds"]}
    grants = sum(1 for s in run["shots"] if s.get("kind") == "grant")
    hints_before = sum(1 for h in run["hints"] if opened is None or h["turn"] <= opened)
    last = run["verdicts"][-1]["result"] if run["verdicts"] else "none"
    return {"opened": opened, "held": len(held), "cover": cover, "nrounds": len(case["rounds"]),
            "grants": grants, "hints": hints_before, "hints_all": len(run["hints"]),
            "verdict": last, "nverdicts": len(run["verdicts"]), "outcome": run["outcome"],
            "enough": cover == len(case["rounds"]) and grants == 0, "per_round": per_round}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    cases = load_cases()
    rows = []
    for d in a.dirs:
        for p in sorted(Path(d).glob("runs/*.json")):
            r = json.load(open(p, encoding="utf-8"))
            if r["caseId"] not in cases:
                continue
            x = analyse(r, cases[r["caseId"]])
            x.update(case=r["caseId"], persona=r["persona"], label=r["personaLabel"], model=r["model"].split("/")[-1],
                     cost=round(r["spend"]["jevUsd"] + r["spend"]["llmUsd"], 4))
            rows.append(x)
    json.dump(rows, open(Path(a.out).with_suffix(".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    models = sorted({r["model"] for r in rows})
    personas = []
    for r in rows:
        if (r["persona"], r["label"]) not in personas:
            personas.append((r["persona"], r["label"]))
    cids = sorted(cases)
    VJ = {"correct": "正解", "almost": "ほぼ", "missing": "不足", "none": "宣告なし"}

    def cell(r):
        if not r:
            return "<td class=na>—</td>"
        cls = "ok" if r["enough"] else ("mid" if r["cover"] >= r["nrounds"] - 1 else "ng")
        return (f"<td class={cls}><b>{r['cover']}/{r['nrounds']}</b> <span class=s>所見{r['held']}・Q{r['opened'] if r['opened'] is not None else '-'}"
                f"{'・ヒント' + str(r['hints']) if r['hints'] else ''}{'・救済' + str(r['grants']) if r['grants'] else ''}</span>"
                f"<br><span class=v>{VJ.get(r['verdict'], r['verdict'])}</span></td>")

    idx = {(r["case"], r["persona"], r["model"]): r for r in rows}
    h = ["""<!doctype html><html lang=ja><head><meta charset=utf-8><title>所見の集まり方 検証</title><style>
:root{--bg:#fbfaf7;--fg:#222;--sub:#777;--ok:#d9f2dc;--mid:#fff1c9;--ng:#f9d6d3;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#1b1b1d;--fg:#eee;--sub:#aaa;--ok:#1f4a2a;--mid:#4d4020;--ng:#552626;--line:#444}}
body{background:var(--bg);color:var(--fg);font-family:"Noto Sans JP",system-ui,sans-serif;margin:0}main{max-width:1300px;margin:auto;padding:16px}
table{border-collapse:collapse;margin:8px 0 24px}td,th{border:1px solid var(--line);padding:4px 6px;font-size:12px;text-align:center;vertical-align:top}
th{font-weight:normal;color:var(--sub)}.ok{background:var(--ok)}.mid{background:var(--mid)}.ng{background:var(--ng)}.s,.v{font-size:11px;color:var(--sub)}
.wrap{overflow-x:auto}p{line-height:1.7}</style></head><body><main>
<h1>リトマス審問：何も知らない人が、審問に足りる所見を集められるか</h1>
<p>AIに年齢・立場の違う9人を演じさせ、事件の導入文だけを見せて、はい／いいえの質問で遊ばせた（最大40問）。
<b>太字</b>は「最初に審問を開いた時点の所見で撃てたラウンド数／全ラウンド数」。
緑＝全ラウンド分そろっていて救済なし、黄＝1ラウンド足りない、赤＝2ラウンド以上足りない。
「救済」は、審問で詰まったときにゲームが所見を渡した回数。下段は死因宣告の最終結果。</p>"""]
    for m in models:
        mr = [r for r in rows if r["model"] == m]
        h.append(f"<h2>{html.escape(m)} <span class=s>{len(mr)}本・${sum(r['cost'] for r in mr):.3f}</span></h2><div class=wrap><table><tr><th>人物</th>"
                 + "".join(f"<th>{html.escape(cases[c]['title'])}</th>" for c in cids) + "<th>足りた</th></tr>")
        for pid, lab in personas:
            rs = [idx.get((c, pid, m)) for c in cids]
            ok = sum(1 for r in rs if r and r["enough"]); n = sum(1 for r in rs if r)
            h.append(f"<tr><th>{html.escape(lab)}</th>" + "".join(cell(r) for r in rs) + f"<td>{ok}/{n}</td></tr>")
        h.append("<tr><th>足りた</th>" + "".join(
            f"<td>{sum(1 for p, _ in personas if idx.get((c, p, m), {}).get('enough'))}/{sum(1 for p, _ in personas if (c, p, m) in idx)}</td>" for c in cids) + "<td></td></tr></table></div>")
    # ラウンドごと：どの所見が集まりにくいか（全モデル・全人物をまとめて）
    h.append("<h2>ラウンドごとの到達率（審問を開いた時点で、撃てる所見を持っていた割合）</h2><table><tr><th>事件</th><th>ラウンド</th><th>撃ち抜く発言</th><th>撃てる所見</th><th>到達</th></tr>")
    for c in cids:
        cr = [r for r in rows if r["case"] == c]
        for rid, info in cases[c]["rinfo"].items():
            n = sum(1 for r in cr if r["per_round"].get(rid))
            rate = n / len(cr) if cr else 0
            cls = "ok" if rate >= 0.7 else ("mid" if rate >= 0.4 else "ng")
            fs = "／".join(f"{fid} {html.escape(str(cases[c]['ft'].get(fid, '')))}" for fid in info["facts"])
            h.append(f"<tr><td>{html.escape(cases[c]['title'])}</td><td>{html.escape(info['title'])}</td><td>{html.escape(info['span'])}</td>"
                     f"<td class=s>{fs}</td><td class={cls}>{n}/{len(cr)}</td></tr>")
    h.append("</table>")
    h.append("</main></body></html>")
    Path(a.out).write_text("\n".join(h), encoding="utf-8")
    ok = sum(r["enough"] for r in rows)
    print(a.out, f"{len(rows)}本 足りた{ok}")


if __name__ == "__main__":
    main()
