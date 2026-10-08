/**
 * Generates KESTREL's icons from one description of the bird, so the activity
 * bar mark and the marketplace icon can never drift apart.
 *
 * Run with:  npm i -D @resvg/resvg-js && node media/generate-icons.js <preview-dir> media
 * The rasteriser is only needed to regenerate the assets, never to build or
 * run the extension.
 */
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const r2 = (n) => Math.round(n * 100) / 100;

/** Body outline as (y, half-width) samples, mirrored around x = 12. */
const PROFILE = [
  [4.0, 0.0],    // crown
  [4.4, 0.92],
  [5.2, 1.28],
  [6.2, 1.46],
  [7.2, 1.78],   // head flows into the shoulders
  [8.6, 2.14],
  [10.4, 2.32],  // chest
  [12.6, 2.1],
  [14.2, 1.68],
  [15.6, 1.5],   // tail base
  [17.2, 2.2],
  [19.2, 3.05],
  [20.9, 3.5],   // fanned tail
];

/** Right wing: broad at the arm, swept to a pointed hand. */
const WING =
  'M12.8 7.15 C15.5 6.85 18.2 7.5 20.3 8.55 C21.2 9.0 21.85 9.4 22.3 9.75 ' +
  'C19.95 10.1 16.75 11.2 14.5 12.5 C13.85 12.9 13.4 13.2 13.2 13.35 ' +
  'C13.0 11.3 12.85 9.2 12.8 7.15 Z';

function bodyPath(profile) {
  const pts = profile.map(([y, w]) => [12 + w, y]);
  const side = (points) => {
    let d = '';
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
    }
    return d;
  };
  const right = pts.map((p) => [...p]);
  const left = [...pts].reverse().map(([x, y]) => [24 - x, y]);
  return (
    `M${r2(right[0][0])} ${r2(right[0][1])}` +
    side(right) +
    ` Q12 ${r2(left[0][1] + 0.5)} ${r2(left[0][0])} ${r2(left[0][1])}` +
    side(left) +
    ' Z'
  );
}

const bird = (fill) =>
  `<g fill="${fill}">
      <path d="${bodyPath(PROFILE)}" />
      <path id="wing" d="${WING}" />
      <use href="#wing" transform="translate(24,0) scale(-1,1)" />
    </g>`;

/** Activity bar: one monochrome shape VS Code recolours with the theme. */
const activityBar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  ${bird('currentColor')}
</svg>
`;

/** Marketplace: the same bird in kestrel rufous on slate. */
const scale = 5.0;
const gallery = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="26" fill="#16202B" />
  <g transform="translate(${r2(64 - 12 * scale)} ${r2(64 - 12.3 * scale)}) scale(${scale})">
    ${bird('#D9793F')}
  </g>
</svg>
`;

const out = process.argv[2];
const media = process.argv[3];

fs.writeFileSync(`${media}/kestrel.svg`, activityBar);
fs.writeFileSync(`${out}/gallery.svg`, gallery);

const png = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

fs.writeFileSync(`${media}/icon.png`, png(gallery, 128));
fs.writeFileSync(`${out}/preview-gallery.png`, png(gallery, 256));
fs.writeFileSync(
  `${out}/preview-bar.png`,
  new Resvg(activityBar.replace(/currentColor/g, '#CCCCCC'), {
    fitTo: { mode: 'width', value: 24 }, background: '#333333',
  }).render().asPng(),
);
fs.writeFileSync(
  `${out}/preview-bar-large.png`,
  new Resvg(activityBar.replace(/currentColor/g, '#CCCCCC'), {
    fitTo: { mode: 'width', value: 256 }, background: '#333333',
  }).render().asPng(),
);
console.log('written');
