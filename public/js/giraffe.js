// "Raffi" — the Quest Log giraffe (original character). Returns SVG markup in a 0..150 x 0..200 box.
window.giraffeSVG = function (mood) {
  const k = '#16130f', y = '#ffc93c', p = '#e8892a', m = '#fff1d2';
  const happy = mood === 'happy';
  return `
<g class="g-tail"><path d="M32 140 Q20 150 18 168" fill="none" stroke="${k}" stroke-width="4" stroke-linecap="round"/><path d="M13 166 q5 -4 10 0 l-2 10 q-3 3 -6 0z" fill="${k}"/></g>
<g stroke="${k}" stroke-width="4" stroke-linejoin="round">
 <rect x="38" y="148" width="12" height="38" rx="5" fill="${y}"/><rect x="54" y="150" width="12" height="36" rx="5" fill="${y}"/>
 <rect x="80" y="150" width="12" height="36" rx="5" fill="${y}"/><rect x="96" y="148" width="12" height="38" rx="5" fill="${y}"/>
</g>
${[38, 54, 80, 96].map(x => `<rect x="${x}" y="183" width="12" height="9" rx="3" fill="${k}"/>`).join('')}
<ellipse cx="72" cy="146" rx="44" ry="25" fill="${y}" stroke="${k}" stroke-width="4"/>
<path d="M44 136q8-6 14 0t-2 12q-8 3-12-3z M66 150q7-5 13 0t-3 10q-7 2-10-3z M86 132q6-4 11 1t-3 9q-7 1-8-4z M54 157q4-3 8 0t-2 6q-5 1-6-2z" fill="${p}"/>
<g class="g-neck">
 <path d="M80 138 L95 56 L116 59 L106 140 Z" fill="${y}" stroke="${k}" stroke-width="4" stroke-linejoin="round"/>
 <path d="M96 118q5-3 8 1t-2 7q-5 1-6-3z M100 92q5-3 8 1t-2 7q-5 1-6-3z M103 70q4-2 7 1t-2 6q-4 1-5-2z" fill="${p}"/>
 <path d="M89 126 l-9 20 l10 1 l5-17z" fill="#ff6a1a" stroke="${k}" stroke-width="3.2" stroke-linejoin="round"/><path d="M82 114 Q95 121 109 117 L107 130 Q94 134 80 127 Z" fill="#ff6a1a" stroke="${k}" stroke-width="3.5" stroke-linejoin="round"/>
 <g transform="translate(106 44) scale(1.28) translate(-106 -44)">
  <g class="g-ear"><ellipse cx="80" cy="34" rx="11" ry="6" fill="${y}" stroke="${k}" stroke-width="3.5" transform="rotate(-20 80 34)"/></g>
  <line x1="98" y1="22" x2="95" y2="8" stroke="${k}" stroke-width="4" stroke-linecap="round"/><line x1="112" y1="22" x2="115" y2="8" stroke="${k}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="95" cy="7" r="5.5" fill="${p}" stroke="${k}" stroke-width="3"/><circle cx="115" cy="7" r="5.5" fill="${p}" stroke="${k}" stroke-width="3"/>
  <ellipse cx="106" cy="40" rx="25" ry="21" fill="${y}" stroke="${k}" stroke-width="4"/>
  <ellipse cx="121" cy="52" rx="17" ry="12.5" fill="${m}" stroke="${k}" stroke-width="4"/>
  <circle cx="124" cy="49" r="2" fill="${k}"/><circle cx="132" cy="50" r="2" fill="${k}"/>
  ${happy ? `<path d="M112 56 q8 9 17 1" fill="#ff6a1a" stroke="${k}" stroke-width="3" stroke-linejoin="round"/>` : `<path d="M114 57 q6 5 13 1" fill="none" stroke="${k}" stroke-width="3" stroke-linecap="round"/>`}
  ${happy ? `<path d="M94 38 q5-6 10 0 M110 36 q5-6 10 0" fill="none" stroke="${k}" stroke-width="3.4" stroke-linecap="round"/>`
          : `<g class="g-blink"><ellipse cx="99" cy="37" rx="4.6" ry="5.6" fill="${k}"/><ellipse cx="114" cy="35" rx="4.3" ry="5.4" fill="${k}"/></g><circle cx="100.6" cy="35" r="1.7" fill="#fff"/><circle cx="115.4" cy="33" r="1.6" fill="#fff"/>`}
  <circle cx="99" cy="37" r="8.5" fill="none" stroke="${k}" stroke-width="2.6"/><circle cx="115" cy="35" r="8.5" fill="none" stroke="${k}" stroke-width="2.6"/><line x1="107.4" y1="36" x2="106.6" y2="36" stroke="${k}" stroke-width="2.6"/>
  <ellipse cx="91" cy="48" rx="5" ry="3" fill="#ff6a1a55"/>
 </g>
</g>`;
};
