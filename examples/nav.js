/**
 * Shared top nav bar for the five example pages — one line to wire up:
 *   import { initNav } from './nav.js';
 *   initNav('single');   // 'single' | 'lineup' | 'horde' | 'shooter' | 'gunpals'
 * A translucent strip fixed to the top of the viewport; the pages' top-left
 * #panel / top-right #hint are shifted down to make room.
 */
export function initNav(current) {
  const PAGES = [
    ['single', 'Single', 'single.html'],
    ['lineup', 'Lineup', 'lineup.html'],
    ['horde', 'Horde', 'horde.html'],
    ['shooter', 'Shooter', 'shooter.html'],
    ['gunpals', 'Gun pals', 'gunpals.html'],
  ];
  const style = document.createElement('style');
  style.textContent = [
    '#pmtkNav{position:fixed;top:0;left:0;right:0;height:34px;z-index:10;',
    'display:flex;align-items:center;gap:2px;padding:0 10px;box-sizing:border-box;',
    'background:#141410d9;backdrop-filter:blur(3px);',
    'border-bottom:1px solid #3a3a30;font:13px/1 system-ui,sans-serif}',
    '#pmtkNav b{color:#c9c4a8;font-size:12px;margin-right:10px;letter-spacing:1px}',
    '#pmtkNav a{color:#9a9878;text-decoration:none;padding:5px 10px;border-radius:4px}',
    '#pmtkNav a:hover{background:#2a2a20;color:#e8e4c8}',
    '#pmtkNav a.on{background:#4a5c28;color:#e8f0d0}',
    // 给原有左上角面板 / 右上提示让位
    '#panel{top:46px !important}',
    '#hint{top:44px !important}',
  ].join('');
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'pmtkNav';
  bar.innerHTML = '<b>procedural-3D</b>' + PAGES.map(([id, name, href]) =>
    `<a href="${href}"${id === current ? ' class="on"' : ''}>${name}</a>`).join('');
  document.body.prepend(bar);
}
