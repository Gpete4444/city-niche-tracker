import { keepMaterialsRowCount, healMaterialsCompleteRows } from '../ops/lib/content-markdown.mjs';

const expected = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 3, 5: 3, 6: 6, 7: 6, 8: 6, 9: 6 };
for (const [n, want] of Object.entries(expected)) {
  const got = keepMaterialsRowCount(Number(n));
  if (got !== want) {
    console.error(`keepMaterialsRowCount(${n}) = ${got}, want ${want}`);
    process.exit(1);
  }
}

const md = `---
title: Test
materialsImages:
  - src: /images/a.jpg
    alt: a
  - src: /images/b.jpg
    alt: b
  - src: /images/c.jpg
    alt: c
  - src: /images/d.jpg
    alt: d
---

Intro.

## Materials and methods we use

We use these.

- **Alpha** — first product that lasts.
- **Bravo** — second product that lasts.
- **Charlie** — third product that lasts.
- **Delta** — leftover fourth card.

## Timeline

Next section.
`;
const out = healMaterialsCompleteRows(md);
const bullets = (out.markdown.match(/^[-*] /gm) || []).length;
const images = (out.markdown.match(/- src:/g) || []).length;
if (!out.healed || bullets !== 3 || images !== 3 || out.markdown.includes('Delta') || out.markdown.includes('d.jpg')) {
  console.error({ healed: out.healed, bullets, images, md: out.markdown });
  process.exit(1);
}
if (!out.markdown.includes('Charlie') || !out.markdown.includes('c.jpg')) {
  console.error('did not keep third card');
  process.exit(1);
}

const six = `---
title: T
---

## Materials

- **A** — a.
- **B** — b.
- **C** — c.
- **D** — d.
- **E** — e.
- **F** — f.
- **G** — g.
`;
const sixOut = healMaterialsCompleteRows(six);
const sixN = (sixOut.markdown.match(/^- \*\*/gm) || []).length;
if (sixN !== 6 || sixOut.markdown.includes('**G**')) {
  console.error({ sixN, md: sixOut.markdown });
  process.exit(1);
}

const seo = `---
title: T
---

## Foam Concrete Lifting Near Me: Materials and Methods We Use

- **A** — a.
- **B** — b.
- **C** — c.
- **D** — leftover.
`;
const seoOut = healMaterialsCompleteRows(seo);
const seoN = (seoOut.markdown.match(/^- \*\*/gm) || []).length;
if (!seoOut.healed || seoN !== 3 || seoOut.markdown.includes('leftover')) {
  console.error({ seoN, healed: seoOut.healed, md: seoOut.markdown });
  process.exit(1);
}

console.log('PASS');
