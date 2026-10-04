/**
 * 「謎を作る」 on the リトマス・ラボ tab (?proto=lab, 2026-10-04): an honest 準備中 panel — nothing can
 * be made yet. It names the three planned routes of docs/ideas/I-001-tsukuru.html (the owner's
 * direction of 2026-10-04). No button, no form: when creation exists, this panel becomes its door.
 */
const ROUTES: { key: string; title: string; text: string }[] = [
  {
    key: 'A',
    title: 'ゲームの中でAIに頼む',
    text: '「こんな結末の謎にしたい」と話すと、ホルマ（AI）が謎に組み立てて検査します。1人3問まで。それより多く作るときは、クレジットか月額プランで。',
  },
  {
    key: 'B',
    title: '自分のAIで作る',
    text: 'ゲームで配るプロンプトを、自分の ChatGPT や Claude に貼って作ります。できた謎を JSON で取り込んで、項目ごとに自分で直せます。',
  },
  {
    key: 'C',
    title: '自分の ChatGPT をつなぐ（将来）',
    text: '仕組みが整ったら、自分の ChatGPT をゲームにつないで、その場で作れるようにします。',
  },
];

export function LabMakePanel() {
  return (
    <aside class="labmake" aria-labelledby="labmake-title" data-lab-make>
      <header class="labmake__head">
        <h3 class="labmake__title" id="labmake-title">
          謎を作る
        </h3>
        <span class="labmake__state">準備中</span>
      </header>
      <p class="labmake__lead">自分で謎を作って、友だちに送れるようにする準備をしています。いまはまだ作れません。作り方は、次の3つを考えています。</p>
      <ol class="labmake__routes">
        {ROUTES.map((r) => (
          <li key={r.key} class="labmake__route">
            <span class="labmake__key" aria-hidden="true">
              {r.key}
            </span>
            <div>
              <p class="labmake__route-title">
                <span class="sr-only">{r.key}. </span>
                {r.title}
              </p>
              <p class="labmake__route-text">{r.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p class="labmake__foot">どの作り方でも、公開の前に安全と答えのもれを検査し、作った人が自分で1回解いてから送る形にする予定です。</p>
    </aside>
  );
}
