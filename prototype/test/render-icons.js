// 渲染 favicon PNG：node test/render-icons.js <dir>
const { chromium } = require(process.env.PW);
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const jobs = [['favicon.svg',16,'favicon-16.png'],['favicon.svg',32,'favicon-32.png'],['favicon.svg',48,'favicon-48.png'],['favicon.svg',192,'icon-192.png'],['favicon.svg',512,'icon-512.png'],
  ['icon-full-bleed.svg',180,'apple-touch-icon.png'],['icon-full-bleed.svg',512,'icon-maskable-512.png']];
(async () => {
  const b = await chromium.launch();
  for (const [src, s, out] of jobs){
    const p = await b.newPage({ viewport:{width:s,height:s}, deviceScaleFactor:1 });
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    await p.screenshot({ path: path.join(dir, out), omitBackground: true, clip:{x:0,y:0,width:s,height:s} });
    await p.close();
  }
  // preview sheet on dark + light tabs
  const p = await b.newPage({ viewport:{width:640,height:220}, deviceScaleFactor:2 });
  const tab = (bg, fg) => `<div style="display:flex;align-items:center;gap:8px;background:${bg};color:${fg};padding:8px 14px;border-radius:10px 10px 0 0;font:13px -apple-system;width:220px"><img src="favicon-16.png" width="16" height="16">Personal Schedule</div>`;
  fs.writeFileSync(path.join(dir,'_preview.html'), `<body style="margin:0;padding:20px;background:#2a2d31;display:grid;gap:16px;grid-template-columns:auto auto;align-items:end">${tab('#1f2125','#e9ecef')}${tab('#f1f3f4','#202124')}
    <div style="display:flex;gap:16px;align-items:end">${[16,32,48].map(s=>`<img src="favicon-${s}.png" width="${s}" height="${s}">`).join('')}<img src="apple-touch-icon.png" width="60" style="border-radius:14px"><img src="icon-192.png" width="60"></div></body>`);
  await p.goto('file://' + path.resolve(dir, '_preview.html')); await p.screenshot({ path: path.join(dir, 'preview.png') });
  fs.unlinkSync(path.join(dir,'_preview.html'));
  await b.close();
})();
